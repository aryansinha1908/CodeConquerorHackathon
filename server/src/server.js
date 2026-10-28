import "dotenv/config";

import { once } from "node:events";
import app from "./app.js";
import { connectDb, disconnectDb } from "./config/db.js";
import { connectRedis, disconnectRedis } from "./config/redis.js";
import { startSweeper, stopSweeper } from "./jobs/sweeper.js";
import { log, setLogger } from "./lib/log.js";
import logger from "./lib/logger.js";

setLogger(logger);
const PORT = process.env.PORT || 5000;
let server;
let shuttingDown = false;
let shutdownPromise;

async function shutdown(signal, error) {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  shutdownPromise = (async () => {
    if (error) logger.fatal({ err: { name: error.name, code: error.code, stack: error.stack } }, "Fatal process error");
    else logger.info({ signal }, "Shutdown requested");
    const forceExit = setTimeout(() => {
      logger.error("Graceful shutdown timed out; forcing exit");
      process.exit(1);
    }, 10000);
    forceExit.unref();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await stopSweeper().catch((closeError) => logger.error({ err: closeError }, "Sweeper shutdown failed"));
    await Promise.allSettled([disconnectRedis(), disconnectDb()]);
    clearTimeout(forceExit);
    if (error) process.exitCode = 1;
  })();
  return shutdownPromise;
}

process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
process.once("SIGINT", () => { void shutdown("SIGINT"); });
process.once("uncaughtException", (error) => { void shutdown("uncaughtException", error); });
process.once("unhandledRejection", (reason) => {
  const error = reason instanceof Error ? reason : new Error("Unhandled promise rejection");
  void shutdown("unhandledRejection", error);
});

async function start() {
  await connectDb();
  if (shuttingDown) return;
  await connectRedis({ logger });
  if (shuttingDown) return;
  startSweeper();
  server = app.listen(PORT, () => logger.info({ port: PORT }, "HTTP server listening"));
  server.once("error", (error) => { void shutdown("serverError", error); });
  await once(server, "listening");
}

start().catch((error) => { void shutdown("startupFailure", error); });
