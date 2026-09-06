import pino, { type Logger } from 'pino';

export type { Logger };

const REDACT = [
  'config',
  '*.config',
  '*.cookieJar',
  '*.cookieHeader',
  '*.password',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["cf-access-jwt-assertion"]',
  'req.headers["x-collected-key"]',
];

export function createLogger(level: string, pretty: boolean): Logger {
  return pino({
    level,
    redact: { paths: REDACT, censor: '[redacted]' },
    ...(pretty
      ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
      : {}),
  });
}
