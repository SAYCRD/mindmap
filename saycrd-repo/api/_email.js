// api/_email.js — sends SAYCRD's branded transactional auth emails (signup
// confirmation, password reset) through Resend, from understand@<domain>,
// replacing Supabase's own default-styled mailer entirely.
//
// Supabase still GENERATES the underlying link (via admin.generateLink in
// api/auth-signup.js / api/auth-reset.js) — that call creates/verifies the
// user and returns an action_link without ever emailing it (this is the
// seam Supabase documents for handing delivery to a custom provider:
// https://supabase.com/docs/reference/javascript/auth-admin-generatelink).
// This module only builds the HTML and hands that link to Resend.
import { createHash } from "node:crypto";
import { Resend } from "resend";

let _resend = null;
function getResendClient() {
  if (_resend) return _resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set — cannot send auth emails.");
  _resend = new Resend(key);
  return _resend;
}

function fromAddress() {
  const domain = process.env.RESEND_EMAIL_DOMAIN;
  if (!domain) throw new Error("RESEND_EMAIL_DOMAIN is not set — cannot send auth emails.");
  return `BLINDSPOT <understand@${domain}>`;
}

function actionLinkIdempotencyKey(prefix, actionLink) {
  // Each generateLink() call mints a brand-new one-time token, so hashing the
  // link itself gives a key that is stable across retries of the *same*
  // send (network retry) but distinct for every new link a user requests
  // (a legitimately new email) — exactly the behavior Resend's idempotency
  // keys are meant to key on.
  const hash = createHash("sha256").update(actionLink).digest("hex").slice(0, 40);
  return `${prefix}/${hash}`;
}

function shell(title, bodyHtml) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0b0d12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0d12;padding:40px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#12151c;border-radius:12px;border:1px solid rgba(255,255,255,0.08);">
            <tr>
              <td style="padding:36px 40px 28px;text-align:center;">
                <div style="font-size:13px;letter-spacing:0.2em;color:rgba(255,255,255,0.4);text-transform:uppercase;margin-bottom:24px;">BLINDSPOT</div>
                <div style="font-size:20px;color:#f2f2f5;font-weight:600;margin-bottom:16px;">${title}</div>
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:0 40px 32px;text-align:center;">
                <div style="font-size:12px;color:rgba(255,255,255,0.3);">If you didn't request this, you can safely ignore this email.</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function button(href, label) {
  return `<a href="${href}" style="display:inline-block;margin:12px 0 8px;padding:14px 32px;background:#e84393;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">${label}</a>`;
}

export async function sendSignupConfirmationEmail({ to, actionLink }) {
  const html = shell(
    "Confirm your email",
    `<div style="font-size:14px;color:rgba(255,255,255,0.6);line-height:1.6;margin-bottom:8px;">One step left before your first session.</div>
     ${button(actionLink, "Confirm email")}`
  );
  return sendMail({
    to,
    subject: "Confirm your email — BLINDSPOT",
    html,
    idempotencyKey: actionLinkIdempotencyKey("signup-confirm", actionLink),
  });
}

export async function sendPasswordResetEmail({ to, actionLink }) {
  const html = shell(
    "Reset your password",
    `<div style="font-size:14px;color:rgba(255,255,255,0.6);line-height:1.6;margin-bottom:8px;">Click below to choose a new password.</div>
     ${button(actionLink, "Reset password")}`
  );
  return sendMail({
    to,
    subject: "Reset your password — BLINDSPOT",
    html,
    idempotencyKey: actionLinkIdempotencyKey("password-reset", actionLink),
  });
}

async function sendMail({ to, subject, html, idempotencyKey }) {
  const resend = getResendClient();
  const { data, error } = await resend.emails.send(
    { from: fromAddress(), to: [to], subject, html },
    { idempotencyKey }
  );
  if (error) throw new Error("resend_send_failed: " + error.message);
  return data;
}
