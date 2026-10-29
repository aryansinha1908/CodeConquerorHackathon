// Why can't the server reach Redis? Run with: npm run check:redis (it loads server/.env).
// Prints the URL's scheme, port and host suffix only (never the password), then tries DNS, a plain TCP
// connection and a TLS handshake separately, so the failing layer is visible.
const net = require("node:net");
const tls = require("node:tls");
const dns = require("node:dns").promises;

const raw = process.env.REDIS_URL;
if (!raw) {
  console.log("REDIS_URL is not set in this .env file.");
  process.exit(1);
}
let url;
try {
  url = new URL(raw);
} catch {
  console.log("REDIS_URL isn't a valid URL (it should look like redis://default:<password>@<host>:<port>).");
  process.exit(1);
}
const host = url.hostname;
const port = Number(url.port) || 6379;
console.log(`scheme: ${url.protocol}//   port: ${url.port || "(none, so 6379)"}   host: …${host.split(".").slice(-4).join(".")}`);
console.log(`user: ${url.username || "(none)"}   password: ${url.password ? "set" : "MISSING"}`);

const timeoutMs = 8000;

function tcp() {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: timeoutMs });
    s.on("connect", () => { s.end(); resolve("ok"); });
    s.on("timeout", () => { s.destroy(); resolve("timeout"); });
    s.on("error", (e) => resolve(e.code ?? e.message));
  });
}

function handshake() {
  return new Promise((resolve) => {
    const t = tls.connect({ host, port, servername: host, timeout: timeoutMs });
    t.on("secureConnect", () => { t.end(); resolve("ok"); });
    t.on("timeout", () => { t.destroy(); resolve("timeout"); });
    t.on("error", (e) => resolve(e.code ?? e.message));
  });
}

(async () => {
  try {
    const { address } = await dns.lookup(host);
    console.log(`DNS: ${host.split(".")[0]}… resolves to ${address}`);
  } catch (e) {
    console.log(`DNS: failed (${e.code}). The host name is wrong: copy the endpoint again from the Redis Cloud console.`);
    return;
  }
  const t = await tcp();
  if (t !== "ok") {
    console.log(`TCP to port ${port}: ${t}.`);
    console.log(
      t === "timeout"
        ? "→ Nothing answered. Either this network blocks outgoing connections to that port (common on campus and office Wi-Fi: try a phone hotspot), or the port is wrong (Redis Cloud's is the database's own, usually 5 digits, not 6379)."
        : "→ The connection was refused or reset: check the port.",
    );
    return;
  }
  console.log(`TCP to port ${port}: connected.`);
  const h = await handshake();
  if (h === "ok") {
    console.log("TLS: handshake ok, so the database has TLS on.");
    console.log(url.protocol === "rediss:" ? "→ Scheme rediss:// is right. If the server still fails, check the password and the user's permissions." : "→ Change the URL to start with rediss:// (TLS).");
  } else {
    console.log(`TLS: ${h}, so the database has TLS off.`);
    console.log(url.protocol === "redis:" ? "→ Scheme redis:// is right. If the server still fails, check the password and the user's permissions." : "→ Change the URL to start with redis:// (no TLS).");
  }
})();
