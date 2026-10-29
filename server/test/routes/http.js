// Shared HTTP helper for the route tests: the real app on port 0, called with fetch, signed in as any
// fixture user. Call useApi() inside the top-level describe, after useTestDatabase().
//   const api = useApi();
//   const res = await api.call("GET", "/resources", { user: f.student });
//   res → { status, body, headers }, body being the parsed envelope.
import { after, before } from "node:test";
import { once } from "node:events";
import app from "../../src/app.js";
import { signAccessToken } from "../../src/services/authTokens.js";

process.env.ACCESS_TOKEN_SECRET ??= "test-access-secret";
process.env.REFRESH_TOKEN_SECRET ??= "test-refresh-secret";
// The fixture users live on the demo domain, whose sessions only work while DEMO_MODE is on.
process.env.DEMO_MODE ??= "true";

export function useApi() {
  let server;
  let origin;
  before(async () => {
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    origin = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server.close();
    await once(server, "close");
  });

  // user: a fixture user document (signed in with a real access token); token: a raw token instead;
  // json: a JSON body; form: a FormData body (multipart); headers: extra request headers (for example
  // X-Forwarded-For). Without user or token, no Authorization.
  async function call(method, path, { user, token, json, form, headers: extra = {} } = {}) {
    const headers = { ...extra };
    if (user) headers.authorization = `Bearer ${signAccessToken(user)}`;
    if (token) headers.authorization = `Bearer ${token}`;
    if (json !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${origin}/api/v1${path}`, {
      method,
      headers,
      body: form ?? (json === undefined ? undefined : JSON.stringify(json)),
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: res.status, body, headers: res.headers };
  }

  return { call };
}
