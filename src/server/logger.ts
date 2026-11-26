type LogLevel = 'info' | 'warn' | 'error';

function writeLog(level: LogLevel, event: string, meta?: Record<string, unknown>) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(meta ? meta : {}),
  };
  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (event: string, meta?: Record<string, unknown>) => writeLog('info', event, meta),
  warn: (event: string, meta?: Record<string, unknown>) => writeLog('warn', event, meta),
  error: (event: string, meta?: Record<string, unknown>) => writeLog('error', event, meta),
};
