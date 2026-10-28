import logger from '../lib/logger.js';

export function notFoundHandler(req, res) {
  return res.status(404).json({
    error: 'Not found',
    requestId: req.id,
  });
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600
    ? err.status
    : Number.isInteger(err.statusCode) && err.statusCode >= 400 && err.statusCode < 600
      ? err.statusCode
      : 500;
  const requestLogger = req.log || logger;

  if (status >= 500) {
    requestLogger.error({
      errorName: err.name,
      errorCode: err.code,
      stack: err.stack,
      requestId: req.id,
    }, 'Request failed');
  }

  const safeMessage = status >= 500
    ? 'Internal server error'
    : (status === 400 ? 'Invalid request' : err.message || 'Request failed');

  return res.status(status).json({ error: safeMessage, requestId: req.id });
}
