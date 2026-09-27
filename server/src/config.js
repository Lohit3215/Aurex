import { loadEnvFile } from './utils/env.js';

loadEnvFile();

const int = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const bool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
};

const list = (value, fallback) => {
  const source = value === undefined || value === '' ? fallback : value;
  return String(source)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 4000),
  host: process.env.HOST || '0.0.0.0',
  logLevel: process.env.LOG_LEVEL || 'info',
  corsOrigins: list(process.env.CORS_ORIGINS, ['http://localhost:5173', 'http://127.0.0.1:5173']),
  wsPath: process.env.WS_PATH || '/ws',

  maxMessageBytes: int(process.env.MAX_MESSAGE_BYTES, 32 * 1024),
  heartbeatIntervalMs: int(process.env.HEARTBEAT_INTERVAL_MS, 30_000),
  maxConnectionsPerIp: int(process.env.MAX_CONNECTIONS_PER_IP, 64),
  rateLimitMaxMessages: int(process.env.RATE_LIMIT_MAX_MESSAGES, 400),
  rateLimitChatMax: int(process.env.RATE_LIMIT_CHAT_MAX, 40),

  maxNameLength: int(process.env.MAX_NAME_LENGTH, 48),
  minNameLength: int(process.env.MIN_NAME_LENGTH, 2),
  roomIdLength: int(process.env.ROOM_ID_LENGTH, 12),
  chatMaxLength: int(process.env.CHAT_MAX_LENGTH, 2000),
  resumeTtlMs: int(process.env.RESUME_TTL_MS, 90_000),
  roomTtlMs: int(process.env.ROOM_TTL_MS, 60_000),
  sweepIntervalMs: 15_000,

  serveClient: bool(process.env.SERVE_CLIENT, true),
};

export default config;
