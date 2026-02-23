import { appendFile, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './paths.js';

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type Level = (typeof LEVELS)[number];

const levelPriority: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function getLogLevel(): Level {
  const env = process.env.LOG_LEVEL?.toLowerCase();
  return LEVELS.includes(env as Level) ? (env as Level) : 'info';
}

function getLogFile(): string {
  const date = new Date().toISOString().split('T')[0];
  return join(paths.backlogDataDir, 'logs', `backlog-${date}.log`);
}

function write(level: Level, message: string, data?: Record<string, unknown>): void {
  if (levelPriority[level] < levelPriority[getLogLevel()]) return;

  const logDir = join(paths.backlogDataDir, 'logs');
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data,
  });

  appendFile(getLogFile(), entry + '\n', (err) => {
    if (err) {
      process.stderr.write(`Logger error: ${err.message}\n`);
    }
  });
}

export const logger = {
  debug: (message: string, data?: Record<string, unknown>) => write('debug', message, data),
  info: (message: string, data?: Record<string, unknown>) => write('info', message, data),
  warn: (message: string, data?: Record<string, unknown>) => write('warn', message, data),
  error: (message: string, data?: Record<string, unknown>) => write('error', message, data),
};
