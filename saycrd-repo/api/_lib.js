// api/_lib.js — shared helpers for the session-pack payments API routes.
import { createClient } from "@supabase/supabase-js";

let cachedClient = null;

// Service-role Supabase client. Bypasses RLS — only ever used server-side,
// and only for the specific tables/RPCs each route needs.
export function getServiceClient() {
  if (cachedClient) return cachedClient;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase service credentials are not configured");
  }
  cachedClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

// Verifies the caller's Supabase access token (sent as
// "Authorization: Bearer <jwt>") and returns { id, email }, or null if the
// header is missing or the token is invalid/expired. Never trust a
// client-supplied user id — this is the only source of truth for "who is
// making this request."
export async function getAuthedUser(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;
  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data || !data.user) return null;
    return { id: data.user.id, email: data.user.email || "" };
  } catch (err) {
    console.error("[payments] getAuthedUser failed:", err);
    return null;
  }
}

export function isAdminEmail(email) {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(String(email).toLowerCase());
}

export function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
