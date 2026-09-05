// api/_lib.js — shared helpers for the session-pack/paywall serverless functions.
// Never expose the service-role key to the client; every function in this file
// only runs server-side (Vercel serverless / the local dev-server shim).
import { createClient } from "@supabase/supabase-js";

let _serviceClient = null;

// Service-role client: bypasses RLS, so every caller MUST scope queries by
// the authed user's id manually (see getAuthedUser below) rather than relying
// on row-level security to do it for them.
export function getServiceClient() {
  if (_serviceClient) return _serviceClient;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase service credentials are not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  }
  _serviceClient = createClient(url, key, { auth: { persistSession: false } });
  return _serviceClient;
}

// Verifies the caller's Supabase JWT (sent as `Authorization: Bearer <token>`
// by the client — see window._saycrdToken in index.html) and returns the
// real Supabase user, or null. This is the only trustworthy source of
// "who is calling this endpoint" — never trust a client-supplied user id.
export async function getAuthedUser(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (!token) return null;
  try {
    const sb = getServiceClient();
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data || !data.user) return null;
    return data.user;
  } catch (e) {
    console.error("getAuthedUser failed:", e.message);
    return null;
  }
}

export function isAdminEmail(email) {
  if (!email) return false;
  const raw = process.env.ADMIN_EMAILS || "";
  const list = raw
    .split(",")
    .map(function (s) {
      return s.trim().toLowerCase();
    })
    .filter(Boolean);
  return list.includes(String(email).toLowerCase());
}

export function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
