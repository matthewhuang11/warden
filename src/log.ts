type LogFields = Record<string, unknown>;

function emit(level: 'info' | 'warn' | 'error', event: string, fields: LogFields = {}): void {
  const line = {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  };
  const out = level === 'error' ? console.error : console.log;
  out(JSON.stringify(line));
}

export const logger = {
  info: (event: string, fields?: LogFields) => emit('info', event, fields),
  warn: (event: string, fields?: LogFields) => emit('warn', event, fields),
  error: (event: string, fields?: LogFields) => emit('error', event, fields),
};
