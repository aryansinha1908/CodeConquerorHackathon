import "dotenv/config";

import { once } from "node:events";
import app from "./app.js";
import { connectDb, disconnectDb } from "./config/db.js";
import { checkDemoMode, reportEnv } from "./config/env.js";
import { connectRedis, disconnectRedis } from "./config/redis.js";
import { startSweeper, stopSweeper } from "./jobs/sweeper.js";
import { setLogger } from "./lib/log.js";
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
    if (error)
      // pino's err serializer: the type survives the "*.name" redaction, a copied err.name doesn't.
      logger.fatal({ err: error }, "Fatal process error");
    else logger.info({ signal }, "Shutdown requested");
    const forceExit = setTimeout(() => {
      logger.error("Graceful shutdown timed out; forcing exit");
      process.exit(1);
    }, 10000);
    forceExit.unref();
    if (server?.listening)
      await new Promise((resolve) => server.close(resolve));
    await stopSweeper().catch((closeError) =>
      logger.error({ err: closeError }, "Sweeper shutdown failed"),
    );
    await Promise.allSettled([disconnectRedis(), disconnectDb()]);
    clearTimeout(forceExit);
    if (error) process.exitCode = 1;
  })();
  return shutdownPromise;
}

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("uncaughtException", (error) => {
  void shutdown("uncaughtException", error);
});
process.once("unhandledRejection", (reason) => {
  const error =
    reason instanceof Error ? reason : new Error("Unhandled promise rejection");
  void shutdown("unhandledRejection", error);
});

// MongoDB is required. Redis isn't: without it the API still starts, with no cache, and bookings
// answer 503 until it reconnects. The sweeper starts after MongoDB, because it queries bookings.
async function start() {
  await connectDb();
  if (shuttingDown) return;
  const demoWarning = await checkDemoMode();
  if (demoWarning) logger.warn(demoWarning);
  if (shuttingDown) return;
  await connectRedis({ logger });
  if (shuttingDown) return;
  startSweeper();
  server = app.listen(PORT, () =>
    logger.info({ port: PORT }, "HTTP server listening"),
  );
  server.once("error", (error) => {
    void shutdown("serverError", error);
  });
  await once(server, "listening");
}

// config/env.js: in production a missing setting or a short secret stops the boot before anything
// connects; elsewhere it's a warning. Nothing is open yet, so setting the exit code is enough.
if (reportEnv(logger)) {
  start().catch((error) => {
    void shutdown("startupFailure", error);
  });
} else {
  process.exitCode = 1;
}
