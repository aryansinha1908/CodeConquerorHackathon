// Logger used by the domain modules: console until server.js calls setLogger() with the pino logger
// from lib/logger.js at boot, so services and tests never load pino themselves. Calls use the pino
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
