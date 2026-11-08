import { pino, type Logger as PinoLogger } from 'pino';

export function createLogger(level: string, pretty: boolean): PinoLogger {
  return pino({
    level,
    base: { service: 'tracemark-worker' },
    ...(pretty ? { transport: { target: 'pino-pretty' } } : {}),
  });
}
