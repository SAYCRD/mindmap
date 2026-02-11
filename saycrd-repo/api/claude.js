// api/claude.js — Vercel serverless function
// Proxies requests to Anthropic API, keeping the key server-side

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "API key not configured" });
  }

  // Optional: verify the user is authenticated via Supabase JWT
  const authHeader = req.headers.authorization;
  if (process.env.REQUIRE_AUTH === "true" && !authHeader) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const body = req.body;

    // Basic rate limiting — allow max 2500 max_tokens
    if (body.max_tokens && body.max_tokens > 3000) {
      body.max_tokens = 3000;
    }

    // Force model to allowed list
    const allowedModels = [
      "claude-sonnet-4-20250514",
      "claude-haiku-4-5-20251001",
    ];
    if (!allowedModels.includes(body.model)) {
      body.model = "claude-sonnet-4-20250514";
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: "Proxy error: " + err.message });
  }
}
