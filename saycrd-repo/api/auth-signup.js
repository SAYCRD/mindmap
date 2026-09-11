// api/auth-signup.js — creates a new Supabase user and emails the
// confirmation link ourselves via Resend (api/_email.js), instead of
// letting Supabase's own mailer send it. supabase.auth.admin.generateLink()
// creates/looks up the user and returns the link WITHOUT ever emailing it —
// this is the seam Supabase documents for handing delivery to a custom
// email provider (see api/_email.js's header comment for the doc link).
//
// The client used to call sb.auth.signUp() directly from public/index.html;
// that path is retired in favor of this endpoint so Supabase never sends
// its own confirmation email. Behavior for the caller is unchanged: a
// generateLink(type:'signup') on an already-confirmed email still errors
// ("already registered"), and on an existing but *unconfirmed* email it
// quietly succeeds and mints a fresh confirmation token — matching what
// signUp() itself did before.
import { getServiceClient, setCors } from "./_lib.js";
import { sendSignupConfirmationEmail } from "./_email.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_CHARS = 254;
const MIN_PASSWORD_CHARS = 6;
const MAX_PASSWORD_CHARS = 128;

// Best-effort, per-instance-only throttle. This project has no shared store
// (Redis/Upstash) wired up, so this resets on cold start and does not
// coordinate across concurrent instances. It exists only to blunt trivial
// single-instance abuse, since this endpoint — unlike Supabase's own
// signUp() — is not behind Supabase's built-in client-side email rate
// limiter (admin.generateLink is a privileged call that bypasses it).
// Revisit with a real shared limiter if abuse is observed.
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
// already-registered, generateLink failure, send failure, rate limit)
// against a mock Supabase client and a fake email sender, with no real
// database or Resend call — same pattern as createBookmarksHandler in
// api/bookmarks.js.
export function createAuthSignupHandler({ getServiceClient, sendSignupConfirmationEmail }) {
  return async function handler(req, res) {
    setCors(res);
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

    const body = req.body || {};
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const redirectTo = typeof body.redirectTo === "string" ? body.redirectTo : "";

    if (!email || email.length > MAX_EMAIL_CHARS || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "invalid_email" });
    }
    if (!password || password.length < MIN_PASSWORD_CHARS || password.length > MAX_PASSWORD_CHARS) {
      return res.status(400).json({ error: "invalid_password" });
    }
    if (!redirectTo || !/^https?:\/\//.test(redirectTo)) {
      return res.status(400).json({ error: "invalid_redirect" });
    }

    if (isRateLimited("signup:" + email)) {
      return res.status(429).json({ error: "rate_limited" });
    }

    try {
      const sb = getServiceClient();
      const { data, error } = await sb.auth.admin.generateLink({
        type: "signup",
        email,
        password,
        options: { redirectTo },
      });

      if (error) {
        const msg = String(error.message || "").toLowerCase();
        if (msg.indexOf("already") !== -1 && msg.indexOf("regist") !== -1) {
          return res.status(409).json({ error: "already_registered" });
        }
        console.error("auth-signup generateLink error:", error.message);
        return res.status(500).json({ error: "signup_failed" });
      }

      const actionLink = data && data.properties && data.properties.action_link;
      if (!actionLink) {
        console.error("auth-signup: generateLink returned no action_link");
        return res.status(500).json({ error: "signup_failed" });
      }

      // The account is created at this point regardless of what happens
      // next. A broken email provider (bad API key, unverified sending
      // domain, provider outage, etc.) must never turn into a failed
      // signup for the user — it only means the confirmation email didn't
      // go out. Swallow and log the email error, report success either way.
      let emailSent = true;
      try {
        await sendSignupConfirmationEmail({ to: email, actionLink });
      } catch (emailErr) {
        emailSent = false;
        console.error("auth-signup: confirmation email failed, account created anyway:", emailErr.message);
      }

      return res.status(200).json({ ok: true, emailSent });
    } catch (err) {
      console.error("auth-signup failed:", err.message);
      return res.status(500).json({ error: "signup_failed" });
    }
  };
}

const handler = createAuthSignupHandler({ getServiceClient, sendSignupConfirmationEmail });
export default handler;
