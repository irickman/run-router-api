type LogLevel = 'info' | 'warn' | 'error';

type LogPayload = Record<string, unknown>;

function write(level: LogLevel, message: string, payload?: LogPayload) {
  const base = {
    level,
    message,
    timestamp: new Date().toISOString(),
  };
  const line = payload ? { ...base, ...payload } : base;
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  sink(JSON.stringify(line));
}

export function logInfo(message: string, payload?: LogPayload) {
  write('info', message, payload);
}

export function logWarn(message: string, payload?: LogPayload) {
  write('warn', message, payload);
}

export function logError(message: string, payload?: LogPayload) {
  write('error', message, payload);
}

export function logExternalError(service: string, err: unknown, extra?: LogPayload) {
  const maybeErr = err as {
    message?: string;
    response?: { status?: number; data?: unknown };
    code?: string;
  };
  logError(`${service} request failed`, {
    service,
    error: maybeErr?.message || String(err),
    code: maybeErr?.code,
    status: maybeErr?.response?.status,
    response: maybeErr?.response?.data,
    ...extra,
  });
}
