import pinoHttp from 'pino-http';
import logger from '../lib/logger.js';

function routeFor(req) {
  const routePath = req.route?.path;
  if (routePath) return `${req.baseUrl || ''}${routePath}`;
  // Never include query parameters or path values that may contain personal data.
  return req.path === '/health' ? '/health' : '[unmatched route]';
}

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => req.id,
  customProps: (req) => ({ requestId: req.id }),
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, route: routeFor(req) }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
  customLogLevel: (_req, res, err) => {
    if (err) return 'error';
    if (res.statusCode >= 500) return 'info'; // The error middleware emits the single error record.
    if (res.statusCode === 403 || res.statusCode === 429 || res.statusCode >= 400) return 'warn';
    return 'info';
  },
  autoLogging: {
    ignore: (req) => req.url?.split('?')[0] === '/health',
  },
});
