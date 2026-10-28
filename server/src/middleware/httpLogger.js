import pinoHttp from 'pino-http';
import logger from '../lib/logger.js';

// The route as Express matched it ("/api/v1/auth/login"), never the URL itself.
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
  // req is serialized when the request arrives, before routing, so the route is added once the
  // response is done, to the "request completed" record.
  serializers: {
    req: (req) => ({ id: req.id, method: req.method }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
  customSuccessObject: (req, _res, value) => ({ ...value, route: routeFor(req) }),
  customErrorObject: (req, _res, _err, value) => ({ ...value, route: routeFor(req) }),
  customLogLevel: (_req, res, err) => {
    if (err) return 'error';
    if (res.statusCode >= 500) return 'info'; // The error middleware emits the single error record.
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  autoLogging: {
    ignore: (req) => req.url?.split('?')[0] === '/health',
  },
});
