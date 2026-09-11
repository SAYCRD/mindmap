import test from "node:test";
import assert from "node:assert/strict";
import { createAuthResetHandler } from "../auth-reset.js";
import { makeReq, makeRes } from "./_http.js";

function fakeServiceClient({ error = null, actionLink = "https://blindspotup.com/verify?token=abc" } = {}) {
  const calls = [];
  return {
    calls,
    auth: {
      admin: {
        async generateLink(params) {
          calls.push(params);
          if (error) return { data: null, error };
          return { data: { properties: { action_link: actionLink } }, error: null };
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
  return createAuthResetHandler({
    getServiceClient: () => sb,
    sendPasswordResetEmail: sender.send,
  });
}

const VALID_BODY = { email: "someone@example.com", redirectTo: "https://blindspotup.com" };

test("auth-reset: rejects an unsupported method with 405", async () => {
  const sb = fakeServiceClient();
  const res = makeRes();
  await handlerFor(sb, fakeEmailSender())(makeReq({ method: "GET" }), res);
  assert.equal(res.statusCode, 405);
});

test("auth-reset: rejects a malformed email", async () => {
  const sb = fakeServiceClient();
  const res = makeRes();
  await handlerFor(sb, fakeEmailSender())(makeReq({ method: "POST", body: { ...VALID_BODY, email: "not-an-email" } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "invalid_email");
  assert.equal(sb.calls.length, 0);
});

test("auth-reset: rejects a missing/invalid redirectTo", async () => {
  const sb = fakeServiceClient();
  const res = makeRes();
  await handlerFor(sb, fakeEmailSender())(makeReq({ method: "POST", body: { ...VALID_BODY, redirectTo: "not-a-url" } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "invalid_redirect");
});

test("auth-reset: generates a recovery link and emails it via Resend, never via Supabase's mailer", async () => {
  const sb = fakeServiceClient({ actionLink: "https://blindspotup.com/verify?token=recover" });
  const sender = fakeEmailSender();
  const res = makeRes();
  await handlerFor(sb, sender)(makeReq({ method: "POST", body: VALID_BODY }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(sb.calls.length, 1);
  assert.equal(sb.calls[0].type, "recovery");
  assert.equal(sb.calls[0].email, "someone@example.com");
  assert.equal(sender.sent.length, 1);
  assert.equal(sender.sent[0].to, "someone@example.com");
  assert.equal(sender.sent[0].actionLink, "https://blindspotup.com/verify?token=recover");
});

test("auth-reset: reports success (never leaks that the email is unregistered) when generateLink says 'not found'", async () => {
  const sb = fakeServiceClient({ error: { message: "User with this email not found", status: 404 } });
  const sender = fakeEmailSender();
  const res = makeRes();
  await handlerFor(sb, sender)(makeReq({ method: "POST", body: { ...VALID_BODY, email: "nobody@example.com" } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(sender.sent.length, 0);
});

test("auth-reset: surfaces any other generateLink error as a generic 500", async () => {
  const sb = fakeServiceClient({ error: { message: "Something else broke", status: 500 } });
  const sender = fakeEmailSender();
  const res = makeRes();
  await handlerFor(sb, sender)(makeReq({ method: "POST", body: { ...VALID_BODY, email: "server-error@example.com" } }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, "reset_failed");
});

test("auth-reset: still reports success when the Resend send itself fails — a broken email provider must never surface as a reset failure", async () => {
  const sb = fakeServiceClient();
  const sender = fakeEmailSender({ throws: true });
  const res = makeRes();
  await handlerFor(sb, sender)(makeReq({ method: "POST", body: { ...VALID_BODY, email: "resend-fails@example.com" } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(sb.calls.length, 1);
});

test("auth-reset: rate-limits repeated reset attempts for the same email, but still reports success", async () => {
  const sb = fakeServiceClient();
  const sender = fakeEmailSender();
  const handler = handlerFor(sb, sender);
  const email = "rate-limited-reset-" + Date.now() + "@example.com";
  const body = { ...VALID_BODY, email };

  for (let i = 0; i < 3; i++) {
    const res = makeRes();
    await handler(makeReq({ method: "POST", body }), res);
    assert.equal(res.statusCode, 200);
  }

  const throttledRes = makeRes();
  await handler(makeReq({ method: "POST", body }), throttledRes);
  assert.equal(throttledRes.statusCode, 200);
  assert.deepEqual(throttledRes.body, { ok: true });
  assert.equal(sender.sent.length, 3);
});
