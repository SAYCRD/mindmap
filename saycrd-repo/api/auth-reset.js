// api/auth-reset.js — generates a password-recovery link via
// supabase.auth.admin.generateLink() and emails it ourselves via Resend
// (api/_email.js), instead of letting Supabase's own mailer send it. See
// api/auth-signup.js's header comment for why generateLink is the right
// seam for a custom email provider.
//
// The client used to call sb.auth.resetPasswordForEmail() directly from
// public/index.html; that path is retired in favor of this endpoint.
// resetPasswordForEmail() never reveals whether an account exists (it
// always reports success) — generateLink is a privileged admin call that
// DOES error for an unknown email ("User with this email not found", 404).
// We reproduce the non-revealing behavior here by treating "not found" as
// success from the caller's point of view, same as before.
import { getServiceClient, setCors } from "./_lib.js";
import { sendPasswordResetEmail } from "./_email.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_CHARS = 254;

// Best-effort, per-instance-only throttle — see api/auth-signup.js for why
// this is needed now that Supabase's own client-side email rate limiter no
// longer applies (generateLink is a privileged call that bypasses it).
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX_PER_EMAIL = 3;
const _sendLog = new Map();

function isRateLimited(key) {
  const now = Date.now();
  const hits = (_sendLog.get(key) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  hits.push(now);
  _sendLog.set(key, hits);
  return hits.length > RATE_LIMIT_MAX_PER_EMAIL;
}

// Dependency-injected so tests can exercise every branch (invalid input,
// unknown email, generateLink failure, rate limit) against a mock Supabase
// client and a fake email sender, with no real database or Resend call —
// same pattern as createBookmarksHandler in api/bookmarks.js.
export function createAuthResetHandler({ getServiceClient, sendPasswordResetEmail }) {
  return async function handler(req, res) {
    setCors(res);
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

    const body = req.body || {};
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const redirectTo = typeof body.redirectTo === "string" ? body.redirectTo : "";

    if (!email || email.length > MAX_EMAIL_CHARS || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "invalid_email" });
    }
    if (!redirectTo || !/^https?:\/\//.test(redirectTo)) {
      return res.status(400).json({ error: "invalid_redirect" });
    }

    if (isRateLimited("reset:" + email)) {
      // Reported as success to the caller — the whole point of this limit is
      // to stop an attacker from using response differences to enumerate
      // accounts or from spamming a real user's inbox, not to tell them why.
      return res.status(200).json({ ok: true });
    }

    try {
      const sb = getServiceClient();
      const { data, error } = await sb.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo },
      });

      if (error) {
        const msg = String(error.message || "").toLowerCase();
        if (msg.indexOf("not found") !== -1) {
          // Unknown email: report success anyway, matching
          // resetPasswordForEmail()'s non-revealing behavior.
          return res.status(200).json({ ok: true });
        }
        console.error("auth-reset generateLink error:", error.message);
        return res.status(500).json({ error: "reset_failed" });
      }

      const actionLink = data && data.properties && data.properties.action_link;
      if (!actionLink) {
        console.error("auth-reset: generateLink returned no action_link");
        return res.status(500).json({ error: "reset_failed" });
      }

      await sendPasswordResetEmail({ to: email, actionLink });
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("auth-reset failed:", err.message);
      return res.status(500).json({ error: "reset_failed" });
    }
  };
}

const handler = createAuthResetHandler({ getServiceClient, sendPasswordResetEmail });
export default handler;
