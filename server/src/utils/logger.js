const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

let current = LEVELS.info;

export function setLogLevel(name) {
  current = LEVELS[String(name || '').toLowerCase()] ?? LEVELS.info;
}

export function getLogLevel() {
  return Object.keys(LEVELS).find((key) => LEVELS[key] === current) ?? 'info';
}

const stamp = () => new Date().toISOString();

function emit(level, scope, message, meta) {
  if (LEVELS[level] > current) return;
  const line = `${stamp()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
  const writer = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (meta === undefined) writer(line);
  else writer(line, meta);
}

export function createLogger(scope) {
  return {
    error: (message, meta) => emit('error', scope, message, meta),
    warn: (message, meta) => emit('warn', scope, message, meta),
    info: (message, meta) => emit('info', scope, message, meta),
    debug: (message, meta) => emit('debug', scope, message, meta),
  };
}
