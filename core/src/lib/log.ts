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

/**
 * The process logger. `pretty` routes through pino-pretty (development). `stderr` writes synchronously to fd 2 instead
 * of stdout: a CLI whose stdout is its answer (JSON piped into another program) keeps its log lines out of it, and a
 * warning is on the terminal before `process.exit`.
 */
export function createLogger(level: string, pretty: boolean, opts: { stderr?: boolean } = {}): Logger {
  const options = {
    level,
    redact: { paths: REDACT, censor: '[redacted]' },
    ...(pretty
      ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
      : {}),
  };
  return opts.stderr && !pretty ? pino(options, pino.destination({ fd: 2, sync: true })) : pino(options);
}
