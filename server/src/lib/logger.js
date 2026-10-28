import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

export const loggerRedaction = {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["set-cookie"]',
    'res.headers["set-cookie"]',
    'req.body.password',
    'req.body.confirmPassword',
    'req.body.otp',
    'req.body.token',
    'req.body.accessToken',
    'req.body.refreshToken',
    'req.body.email',
    'req.body.name',
    'req.body.phone',
    'req.body.phoneNumber',
    'req.body.idCardNumber',
    'req.body.studentId',
    'req.body.rollNumber',
    'req.body.address',
    'password',
    'passwordHash',
    'confirmPassword',
    'otp',
    'token',
    'accessToken',
    'refreshToken',
    'email',
    'name',
    'phone',
    'phoneNumber',
    'mobile',
    'idCardNumber',
    'studentId',
    'rollNumber',
    'address',
    'aadhaar',
    'pan',
    '*.password',
    '*.passwordHash',
    '*.confirmPassword',
    '*.otp',
    '*.token',
    '*.accessToken',
    '*.refreshToken',
    '*.email',
    '*.name',
    '*.phone',
    '*.phoneNumber',
    '*.mobile',
    '*.idCardNumber',
    '*.studentId',
    '*.rollNumber',
    '*.address',
    '*.aadhaar',
    '*.pan',
  ],
  censor: '[REDACTED]',
};

const options = {
  level: logLevel,
  redact: loggerRedaction,
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
};

const transport = !isProduction
  ? {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
    }
  : undefined;

const logger = pino(options, transport ? pino.transport(transport) : undefined);

export default logger;
