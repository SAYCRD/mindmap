// api/session-log-anonymous.js — records that a GUEST (non-logged-in) device
// completed a session. No auth, no PII: device_id is the same random,
// locally-generated id already used for localStorage session storage
// (see _sessionKey() in app.jsx) — it identifies a browser, never a person.
// This exists so the admin panel can answer "is anyone actually using this
// thing before they ever create an account" without tracking who they are.
import { getServiceClient, setCors } from "./_lib.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body || {};
  const deviceId = String(body.device_id || "").trim();
  const sessionNumber = parseInt(body.session_number, 10);

  // device_id is attacker-controlled (no auth), so keep this strictly a
  // coarse usage counter: bound its length and reject anything that isn't a
  // small positive integer for session_number, but don't treat failures
  // here as meaningful errors to the client — this beacon must never block
  // or surface anything to a real user's session flow.
  if (!deviceId || deviceId.length > 128) {
    return res.status(400).json({ error: "device_id is required" });
  }
  if (!Number.isInteger(sessionNumber) || sessionNumber <= 0 || sessionNumber > 100000) {
    return res.status(400).json({ error: "session_number must be a positive integer" });
  }

  try {
    const sb = getServiceClient();
    const { error } = await sb.from("anonymous_session_log").insert({
      device_id: deviceId,
      session_number: sessionNumber,
    });
    if (error) throw error;
    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error("session-log-anonymous error:", err.message);
    // Fail quiet — this is a fire-and-forget beacon, not part of the real
    // session-completion path.
    return res.status(500).json({ ok: false });
  }
}
