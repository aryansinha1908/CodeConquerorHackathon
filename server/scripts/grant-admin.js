// `npm run grant-admin -- <email> [--revoke]`: make a real account an admin, or take the role away.
//
// While DEMO_MODE is on, anyone can be the seeded demo admin with one click, so demo staff only ever
// see demo accounts: real members' ID cards, evidence and requests stay out of their queues
// (verificationService.js, badgeService.js). Reviewing a real member therefore needs a real admin, and
// there is no admin page for roles yet (frontend.md §6.4 /admin/users isn't built). This script is
// that one step, against the database in MONGODB_URI (server/.env, or DOTENV_PATH).
//
// Only an existing, email-verified account outside the demo domain qualifies. The change is audited
// (user.roles_changed, as the system), and the person picks the role up on their next page load: the
// app refreshes its session then, and a refreshed session carries the user's current roles.
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { connectDb, disconnectDb } from "../src/config/db.js";
import { setLogger } from "../src/lib/log.js";
import { User } from "../src/models/index.js";
import { DEMO_EMAIL } from "../src/services/authService.js";
import { SYSTEM_ACTOR, record } from "../src/services/auditService.js";

// → { user, changed, roles } or throws an Error whose message is meant for the person running it.
export async function grantAdmin({ email, revoke = false }) {
  const address = String(email ?? "").trim().toLowerCase();
  if (!address.includes("@")) throw new Error("Give the account's email address.");
  if (DEMO_EMAIL.test(address))
    throw new Error("That's a demo account: the seed sets demo roles (npm run seed).");
  const user = await User.findOne({ email: address });
  if (!user) throw new Error(`No account has the email ${address}.`);
  if (!revoke && !user.emailVerified)
    throw new Error(`${address} hasn't verified its email yet, so it can't sign in. Finish signing up first.`);

  const before = [...(user.roles ?? [])];
  const after = revoke
    ? before.filter((role) => role !== "admin")
    : [...new Set([...before, "admin"])];
  if (after.length === before.length && after.every((role, i) => role === before[i]))
    return { user, changed: false, roles: before };

  user.roles = after;
  await user.save();
  await record({
    actor: SYSTEM_ACTOR,
    action: "user.roles_changed",
    entity: { type: "user", id: user._id },
    reason: revoke ? "npm run grant-admin -- --revoke" : "npm run grant-admin",
    changes: { roles: [before, after] },
  });
  return { user, changed: true, roles: after };
}

async function main(args) {
  // Loaded here, not at the top, so a test importing grantAdmin() never reads server/.env.
  await import("dotenv/config");
  const revoke = args.includes("--revoke");
  const email = args.find((arg) => !arg.startsWith("--"));
  if (!email) {
    console.error("Usage: npm run grant-admin -- <email> [--revoke]");
    return 1;
  }
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI is not set: add it to server/.env.");
    return 1;
  }
  // Only this script's own lines: the app logger's "MongoDB connected" would just be noise here.
  setLogger({ info() {}, warn: (_, message) => console.warn(message), error: (_, message) => console.error(message) });
  try {
    const connection = await connectDb();
    const { user, changed, roles } = await grantAdmin({ email, revoke });
    const who = `${user.name} (${user.email})`;
    if (!changed) console.log(`${who} ${revoke ? "isn't an admin" : "is already an admin"} in "${connection.name}". Nothing changed.`);
    else
      console.log(
        `${who} ${revoke ? "is no longer an admin" : "is now an admin"} in "${connection.name}" (roles: ${roles.join(", ")}). ` +
          "They pick it up on their next page load.",
      );
    return 0;
  } catch (err) {
    console.error(err?.message ?? String(err));
    return 1;
  } finally {
    await disconnectDb().catch(() => {});
  }
}

function invokedDirectly() {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  process.exitCode = await main(process.argv.slice(2));
}
