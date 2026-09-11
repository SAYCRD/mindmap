import test from "node:test";
import assert from "node:assert/strict";
import { createAuthSignupHandler } from "../auth-signup.js";
import { makeReq, makeRes } from "./_http.js";

function fakeServiceClient({
  error = null,
  actionLink = "https://blindspotup.com/verify?token=abc",
  userId = "user-123",
  confirmThrows = false,
} = {}) {
  const calls = [];
  const confirmCalls = [];
  return {
    calls,
    confirmCalls,
    auth: {
      admin: {
        async generateLink(params) {
          calls.push(params);
          if (error) return { data: null, error };
          return {
            data: { user: userId ? { id: userId } : null, properties: { action_link: actionLink } },
            error: null,
          };
        },
        async updateUserById(id, attrs) {
          confirmCalls.push({ id, attrs });
          if (confirmThrows) throw new Error("boom: could not auto-confirm");
          return { data: { user: { id } }, error: null };
        },
      },
    },
  };
}

function fakeEmailSender({ throws = false } = {}) {
  const sent = [];
  return {
    sent,
    async send({ to, actionLink }) {
      if (throws) throw new Error("resend_send_failed: boom");
      sent.push({ to, actionLink });
    },
  };
}

function handlerFor(sb, sender) {
  return createAuthSignupHandler({
    getServiceClient: () => sb,
    sendSignupConfirmationEmail: sender.send,
  });
}

const VALID_BODY = { email: "new@example.com", password: "secret123", redirectTo: "https://blindspotup.com" };

test("auth-signup: rejects an unsupported method with 405", async () => {
  const sb = fakeServiceClient();
  const res = makeRes();
  await handlerFor(sb, fakeEmailSender())(makeReq({ method: "GET" }), res);
  assert.equal(res.statusCode, 405);
});

test("auth-signup: rejects a malformed email", async () => {
  const sb = fakeServiceClient();
  const res = makeRes();
  await handlerFor(sb, fakeEmailSender())(makeReq({ method: "POST", body: { ...VALID_BODY, email: "not-an-email" } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "invalid_email");
  assert.equal(sb.calls.length, 0);
});

test("auth-signup: rejects a password under 6 chars", async () => {
  const sb = fakeServiceClient();
  const res = makeRes();
  await handlerFor(sb, fakeEmailSender())(makeReq({ method: "POST", body: { ...VALID_BODY, password: "123" } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "invalid_password");
});

test("auth-signup: rejects a missing/invalid redirectTo", async () => {
  const sb = fakeServiceClient();
  const res = makeRes();
  await handlerFor(sb, fakeEmailSender())(makeReq({ method: "POST", body: { ...VALID_BODY, redirectTo: "javascript:alert(1)" } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "invalid_redirect");
});

test("auth-signup: creates the user via generateLink and emails the action_link via Resend, never via Supabase's mailer", async () => {
  const sb = fakeServiceClient({ actionLink: "https://blindspotup.com/verify?token=xyz" });
  const sender = fakeEmailSender();
  const res = makeRes();
  await handlerFor(sb, sender)(makeReq({ method: "POST", body: VALID_BODY }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, emailSent: true });
  assert.equal(sb.calls.length, 1);
  assert.equal(sb.calls[0].type, "signup");
  assert.equal(sb.calls[0].email, "new@example.com");
  assert.equal(sender.sent.length, 1);
  assert.equal(sender.sent[0].to, "new@example.com");
  assert.equal(sender.sent[0].actionLink, "https://blindspotup.com/verify?token=xyz");
  assert.equal(sb.confirmCalls.length, 1);
  assert.equal(sb.confirmCalls[0].id, "user-123");
  assert.deepEqual(sb.confirmCalls[0].attrs, { email_confirm: true });
});

test("auth-signup: auto-confirms the email so login is never blocked on the confirmation link, regardless of email delivery", async () => {
  const sb = fakeServiceClient();
  const sender = fakeEmailSender({ throws: true });
  const res = makeRes();
  await handlerFor(sb, sender)(makeReq({ method: "POST", body: { ...VALID_BODY, email: "unconfirmed-but-fine@example.com" } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, emailSent: false });
  assert.equal(sb.confirmCalls.length, 1);
  assert.deepEqual(sb.confirmCalls[0].attrs, { email_confirm: true });
});

test("auth-signup: signup still succeeds even if the auto-confirm call itself throws", async () => {
  const sb = fakeServiceClient({ confirmThrows: true });
  const sender = fakeEmailSender();
  const res = makeRes();
  await handlerFor(sb, sender)(makeReq({ method: "POST", body: { ...VALID_BODY, email: "confirm-throws@example.com" } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, emailSent: true });
});

test("auth-signup: lowercases and trims the email before calling generateLink", async () => {
  const sb = fakeServiceClient();
  const sender = fakeEmailSender();
  const res = makeRes();
  await handlerFor(sb, sender)(makeReq({ method: "POST", body: { ...VALID_BODY, email: "  Mixed.Case@Example.com  " } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(sb.calls[0].email, "mixed.case@example.com");
});

test("auth-signup: maps an already-registered generateLink error to 409 without sending an email", async () => {
  const sb = fakeServiceClient({ error: { message: "A user with this email address has already been registered", status: 422 } });
  const sender = fakeEmailSender();
  const res = makeRes();
  await handlerFor(sb, sender)(makeReq({ method: "POST", body: { ...VALID_BODY, email: "existing@example.com" } }), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, "already_registered");
  assert.equal(sender.sent.length, 0);
});

test("auth-signup: surfaces any other generateLink error as a generic 500", async () => {
  const sb = fakeServiceClient({ error: { message: "Something else broke", status: 500 } });
  const sender = fakeEmailSender();
  const res = makeRes();
  await handlerFor(sb, sender)(makeReq({ method: "POST", body: VALID_BODY }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, "signup_failed");
  assert.equal(sender.sent.length, 0);
});

test("auth-signup: account creation still succeeds (emailSent: false) when the Resend send itself fails — a broken email provider must never block signup", async () => {
  const sb = fakeServiceClient();
  const sender = fakeEmailSender({ throws: true });
  const res = makeRes();
  await handlerFor(sb, sender)(makeReq({ method: "POST", body: { ...VALID_BODY, email: "resend-fails@example.com" } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, emailSent: false });
  assert.equal(sb.calls.length, 1);
});

test("auth-signup: rate-limits repeated signup attempts for the same email within the window", async () => {
  const sb = fakeServiceClient();
  const sender = fakeEmailSender();
  const handler = handlerFor(sb, sender);
  const email = "rate-limited-" + Date.now() + "@example.com";
  const body = { ...VALID_BODY, email };

  for (let i = 0; i < 3; i++) {
    const res = makeRes();
    await handler(makeReq({ method: "POST", body }), res);
    assert.equal(res.statusCode, 200);
  }

  const blockedRes = makeRes();
  await handler(makeReq({ method: "POST", body }), blockedRes);
  assert.equal(blockedRes.statusCode, 429);
  assert.equal(blockedRes.body.error, "rate_limited");
  assert.equal(sender.sent.length, 3);
});

test("auth-signup: repeated attempts after an email-provider failure still count toward the rate limit", async () => {
  const sb = fakeServiceClient();
  const sender = fakeEmailSender({ throws: true });
  const handler = handlerFor(sb, sender);
  const email = "rate-limited-broken-email-" + Date.now() + "@example.com";
  const body = { ...VALID_BODY, email };

  for (let i = 0; i < 3; i++) {
    const res = makeRes();
    await handler(makeReq({ method: "POST", body }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, emailSent: false });
  }

  const blockedRes = makeRes();
  await handler(makeReq({ method: "POST", body }), blockedRes);
  assert.equal(blockedRes.statusCode, 429);
  assert.equal(blockedRes.body.error, "rate_limited");
});
