// Start-up checks (src/config/env.js): what stops a production boot, what only warns, and that no
// message ever carries a setting's value. The DEMO_MODE check also runs against a real MongoDB when
// TEST_MONGODB_URI is set (see test/integration/fixtures.js).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MIN_SECRET_LENGTH,
  REQUIRED_IN_PRODUCTION,
  checkDemoMode,
  checkEnv,
  reportEnv,
  trustProxyHops,
} from "../../src/config/env.js";
import { User } from "../../src/models/index.js";
import { skip, useTestDatabase } from "../integration/fixtures.js";

const SERVER = fileURLToPath(new URL("../../src/server.js", import.meta.url));

// Distinctive values, so a test can tell if one ever reaches a message.
const secret = (tag) => `${tag}-${"s".repeat(MIN_SECRET_LENGTH)}`;
const complete = () => ({
  NODE_ENV: "production",
  MONGODB_URI: "mongodb://user-uri-value@127.0.0.1:1/campuscommons",
  REDIS_URL: "redis://redis-url-value@127.0.0.1:1",
  ACCESS_TOKEN_SECRET: secret("access"),
  REFRESH_TOKEN_SECRET: secret("refresh"),
  OTP_PEPPER: secret("pepper"),
  CLIENT_URL: "https://campuscommons.example",
  CLOUDINARY_CLOUD_NAME: "cloud-name-value",
  CLOUDINARY_API_KEY: "cloud-key-value",
  CLOUDINARY_API_SECRET: "cloud-secret-value",
  SMTP_HOST: "smtp.example.com",
  SMTP_USER: "smtp-user-value",
  SMTP_PASS: "smtp-pass-value",
  MAIL_FROM: "CampusCommons <codes@example.com>",
});

function assertNoValues(env, result) {
  const text = JSON.stringify(result);
  for (const [name, value] of Object.entries(env))
    if (value && !["NODE_ENV", "TRUST_PROXY_HOPS"].includes(name))
      assert.equal(text.includes(value), false, `${name}'s value was logged`);
}

describe("checkEnv", () => {
  test("a complete production environment passes with no warnings", () => {
    assert.deepEqual(checkEnv(complete()), {
      production: true,
      errors: [],
      warnings: [],
    });
  });

  test("in production every missing required setting is an error", () => {
    for (const name of REQUIRED_IN_PRODUCTION) {
      for (const value of [undefined, "", "   "]) {
        const env = { ...complete(), [name]: value };
        const { errors } = checkEnv(env);
        assert.deepEqual(errors, [`${name} is not set.`], `${name}=${value}`);
      }
    }
    assert.equal(checkEnv({ NODE_ENV: "production" }).errors.length, 6);
  });

  test("in production a secret shorter than 32 characters is an error that never shows the secret", () => {
    for (const name of [
      "ACCESS_TOKEN_SECRET",
      "REFRESH_TOKEN_SECRET",
      "OTP_PEPPER",
    ]) {
      const env = { ...complete(), [name]: "x".repeat(MIN_SECRET_LENGTH - 1) };
      const result = checkEnv(env);
      assert.equal(result.errors.length, 1);
      assert.match(
        result.errors[0],
        new RegExp(`^${name} is shorter than 32 characters`),
      );
      assertNoValues(env, result);
    }
    const exactly = {
      ...complete(),
      OTP_PEPPER: "p".repeat(MIN_SECRET_LENGTH),
    };
    assert.deepEqual(checkEnv(exactly).errors, []);
  });

  test("outside production the same problems are only warnings", () => {
    for (const NODE_ENV of [undefined, "development", "test"]) {
      const env = {
        ...complete(),
        NODE_ENV,
        MONGODB_URI: "",
        OTP_PEPPER: "short",
      };
      const result = checkEnv(env);
      assert.equal(result.production, false);
      assert.deepEqual(result.errors, []);
      assert.ok(result.warnings.includes("MONGODB_URI is not set."));
      assert.ok(result.warnings.some((w) => /^OTP_PEPPER is shorter/.test(w)));
    }
  });

  test("Cloudinary and SMTP only ever warn, in production too, saying what stops working", () => {
    const env = complete();
    delete env.CLOUDINARY_API_SECRET;
    delete env.SMTP_HOST;
    const result = checkEnv(env);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, [
      "Cloudinary isn't configured (CLOUDINARY_API_SECRET not set): ID-card, photo and evidence uploads answer 503.",
      "SMTP_HOST is not set: no email is sent, so new members never get their sign-up codes.",
    ]);
    const local = checkEnv({ ...env, NODE_ENV: "development" });
    assert.ok(
      local.warnings.includes(
        "SMTP_HOST is not set: emails, sign-up codes included, are written to the log instead of sent.",
      ),
    );
  });

  test("an SMTP setup missing its password or sender warns", () => {
    const env = { ...complete(), SMTP_PASS: "", MAIL_FROM: "" };
    const { errors, warnings } = checkEnv(env);
    assert.deepEqual(errors, []);
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /Only one of SMTP_USER and SMTP_PASS/);
    assert.match(warnings[1], /^MAIL_FROM is not set/);
    // No credentials at all is fine: a local SMTP server may need none.
    assert.deepEqual(
      checkEnv({ ...complete(), SMTP_USER: "", SMTP_PASS: "" }).warnings,
      [],
    );
  });

  test("the same value for both token secrets warns without showing it", () => {
    const env = { ...complete(), REFRESH_TOKEN_SECRET: secret("access") };
    const result = checkEnv(env);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, [
      "ACCESS_TOKEN_SECRET and REFRESH_TOKEN_SECRET are the same. Use two different values.",
    ]);
    assertNoValues(env, result);
  });

  test("no message carries any setting's value", () => {
    const env = complete();
    env.ACCESS_TOKEN_SECRET = "short-access-secret";
    env.MAIL_FROM = "";
    delete env.CLOUDINARY_CLOUD_NAME;
    const result = checkEnv(env);
    assert.ok(result.errors.length + result.warnings.length >= 3);
    assertNoValues(env, result);
  });
});

describe("trustProxyHops", () => {
  test("one hop (Render's proxy) unless TRUST_PROXY_HOPS says otherwise; never true", () => {
    assert.equal(trustProxyHops({}), 1);
    assert.equal(trustProxyHops({ TRUST_PROXY_HOPS: "2" }), 2);
    assert.equal(trustProxyHops({ TRUST_PROXY_HOPS: " 0 " }), 0);
    for (const bad of ["true", "-1", "1.5", "11", "two"]) {
      assert.equal(trustProxyHops({ TRUST_PROXY_HOPS: bad }), 1, bad);
      assert.deepEqual(
        checkEnv({ ...complete(), TRUST_PROXY_HOPS: bad }).warnings,
        ["TRUST_PROXY_HOPS must be a whole number from 0 to 10; using 1."],
        bad,
      );
    }
  });
});

describe("reportEnv", () => {
  const recorder = () => {
    const lines = { warn: [], fatal: [] };
    return {
      lines,
      warn: (message) => lines.warn.push(message),
      fatal: (message) => lines.fatal.push(message),
    };
  };

  test("production with a problem: logged as fatal, and the server must not start", () => {
    const logger = recorder();
    const env = { ...complete(), CLIENT_URL: "" };
    assert.equal(reportEnv(logger, env), false);
    assert.deepEqual(logger.lines.fatal, [
      "CLIENT_URL is not set.",
      "Refusing to start in production with this problem. Set the variables on the host (server/.env.example lists them).",
    ]);
  });

  test("elsewhere: warnings only, and the server starts", () => {
    const logger = recorder();
    assert.equal(reportEnv(logger, { NODE_ENV: "development" }), true);
    assert.deepEqual(logger.lines.fatal, []);
    assert.ok(logger.lines.warn.includes("ACCESS_TOKEN_SECRET is not set."));
  });

  test("server.js exits 1 in production before connecting anything, without printing a secret", () => {
    // A fresh directory as the working directory, so dotenv finds no .env file to load.
    const cwd = mkdtempSync(join(tmpdir(), "campuscommons-env-"));
    try {
      const env = {
        ...complete(),
        ACCESS_TOKEN_SECRET: "too-short-secret-value",
        MONGODB_URI: "",
      };
      const run = spawnSync(process.execPath, [SERVER], {
        cwd,
        env: { PATH: process.env.PATH, ...env },
        encoding: "utf8",
        timeout: 15_000,
      });
      assert.equal(run.status, 1, run.stderr);
      assert.match(run.stdout, /MONGODB_URI is not set/);
      assert.match(run.stdout, /ACCESS_TOKEN_SECRET is shorter than 32/);
      assert.match(run.stdout, /Refusing to start in production/);
      assert.doesNotMatch(
        run.stdout,
        /HTTP server listening|MongoDB connected/,
      );
      assertNoValues(env, run.stdout + run.stderr);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("checkDemoMode", () => {
  test("nothing to say while DEMO_MODE is off; the users aren't even counted", async () => {
    let counted = false;
    const count = async () => {
      counted = true;
      return 5;
    };
    assert.equal(await checkDemoMode({ on: false, count }), null);
    assert.equal(counted, false);
  });

  test("DEMO_MODE on with real accounts warns with how many, never who", async () => {
    assert.equal(await checkDemoMode({ on: true, count: async () => 0 }), null);
    const one = await checkDemoMode({ on: true, count: async () => 1 });
    assert.match(
      one,
      /^DEMO_MODE is true, but 1 account outside the demo domain exists\./,
    );
    const many = await checkDemoMode({ on: true, count: async () => 42 });
    assert.match(many, /42 accounts outside the demo domain exist\./);
    assert.match(many, /demo admin or manager/);
    assert.match(
      many,
      /Keep this deployment demo-only, or set DEMO_MODE=false\.$/,
    );
  });

  test("a failed count is a warning, never a failed boot", async () => {
    const warning = await checkDemoMode({
      on: true,
      count: async () => {
        throw new Error("not connected");
      },
    });
    assert.match(warning, /couldn't be counted/);
  });

  describe("against MongoDB", { skip }, () => {
    useTestDatabase(() => {});

    test("the seeded demo users alone are fine; one real member is reported", async () => {
      assert.equal(await checkDemoMode({ on: true }), null);
      await User.create({
        name: "Kabir Singh",
        email: "2024ugcs999@nitjsr.ac.in",
        passwordHash: "x".repeat(60),
      });
      assert.match(
        await checkDemoMode({ on: true }),
        /but 1 account outside the demo domain exists/,
      );
    });
  });
});
