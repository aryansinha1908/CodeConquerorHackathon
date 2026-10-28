// MongoDB connection (architecture.md §12, §18). MONGODB_URI is required: unlike Redis, the API
// can't run in a degraded mode without its database.
import mongoose from "mongoose";
import { log } from "../lib/log.js";

// A filter field that isn't in the schema throws. With strictQuery: true it would be dropped
// silently, and a typo in deleteMany({ ... }) would then match every document.
// sanitizeFilter stays off: it rewrites every $-operator, including the services' own $in and $lt,
// into a literal match, so those queries fail. Untrusted input is checked by the Zod validators
// (ObjectIds, enums, plain strings) before it reaches a query.
export function configureMongoose() {
  mongoose.set("strictQuery", "throw");
}

// dbName overrides the database in the URI (the integration tests use a throwaway one).
export async function connectDb({
  uri = process.env.MONGODB_URI,
  dbName,
  timeoutMs = 10_000,
} = {}) {
  if (!uri) {
    throw new Error(
      "MONGODB_URI is not set. Add your MongoDB Atlas connection string to server/.env (see .env.example).",
    );
  }
  configureMongoose();
  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: timeoutMs });
  log.info({ db: mongoose.connection.name }, "MongoDB connected");
  return mongoose.connection;
}

export const disconnectDb = () => mongoose.disconnect();
