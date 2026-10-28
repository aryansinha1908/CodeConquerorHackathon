// Logger used by the domain modules. console until lib/logger.js (pino) exists; server.js then
// calls setLogger(logger) once at boot (connectRedis({ logger }) does it too). Calls use the pino
// style: log.warn({ err, ...context }, "message").
let logger = console;

export const log = {
  info: (...args) => logger.info(...args),
  warn: (...args) => logger.warn(...args),
  error: (...args) => logger.error(...args),
};

export const setLogger = (next) => {
  logger = next;
};
