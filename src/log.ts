type LogFields = Record<string, unknown>;

// Structured JSON logging is opt-in (WARDEN_VERBOSE=1) rather than the
// default output — the default experience is the polished console output
// in consoleOutput.ts instead. Nothing here changes what's logged, only
// whether it's printed.
const VERBOSE = process.env.WARDEN_VERBOSE === '1';

function emit(level: 'info' | 'warn' | 'error', event: string, fields: LogFields = {}): void {
  if (!VERBOSE) return;
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
