// api/__tests__/_http.js — minimal fake Vercel-style req/res for exercising
// route handlers directly in tests, with no real HTTP server involved.

export function makeReq({ method = "GET", query = {}, body = undefined, headers = {} } = {}) {
  return { method, query, body, headers };
}

export function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
  return res;
}
