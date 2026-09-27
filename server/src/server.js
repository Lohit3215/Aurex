import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cors from 'cors';
import express from 'express';

import config from './config.js';
import { createLogger, setLogLevel } from './utils/logger.js';
import { RoomManager } from './rooms/RoomManager.js';
import { attachSignaling } from './signaling/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const clientDist = path.resolve(serverRoot, '..', 'client', 'dist');

setLogLevel(config.logLevel);
const log = createLogger('server');

export function createApp({ roomManager, signaling, env = config.env }) {
  const app = express();
  app.disable('x-powered-by');

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin requests and non-browser clients send no Origin header.
        if (!origin) return callback(null, true);
        if (config.corsOrigins.includes(origin) || config.corsOrigins.includes('*')) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      credentials: false,
    }),
  );

  app.use(express.json({ limit: '16kb' }));

  const startedAt = Date.now();

  app.get(['/health', '/api/health'], (_req, res) => {
    res.json({
      status: 'ok',
      service: 'aurex-meet-signaling',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      signalingPath: config.wsPath,
      ...signaling.stats(),
    });
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Unknown endpoint.' });
  });

  const hasClientBuild = config.serveClient && fs.existsSync(path.join(clientDist, 'index.html'));
  if (hasClientBuild) {
    app.use(express.static(clientDist, { index: false, maxAge: env === 'production' ? '1h' : 0 }));
    // SPA fallback for every non-API route.
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (req.path.startsWith('/api') || req.path === config.wsPath) return next();
      return res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use((error, _req, res, _next) => {
    log.error('unhandled http error', { error: error?.message });
    res.status(500).json({ code: 'SERVER_ERROR', message: 'Unexpected server error.' });
  });

  return app;
}

export function createServer(overrides = {}) {
  const roomManager = overrides.roomManager ?? new RoomManager();
  const httpServer = http.createServer();
  const signaling = attachSignaling(httpServer, { roomManager, logger: log, config });
  const app = createApp({ roomManager, signaling, env: config.env });
  httpServer.on('request', app);

  const sweeper = setInterval(() => {
    const { removedRooms } = roomManager.sweep();
    if (removedRooms > 0) log.info('swept empty rooms', { removedRooms, rooms: roomManager.roomCount });
  }, config.sweepIntervalMs);
  sweeper.unref?.();

  return { app, httpServer, signaling, roomManager, stopSweeper: () => clearInterval(sweeper) };
}

export async function start() {
  const { httpServer, signaling, roomManager, stopSweeper } = createServer();

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.port, config.host, () => {
      httpServer.removeListener('error', reject);
      resolve();
    });
  });

  log.info('AUREX MEET signaling server listening', {
    url: `http://localhost:${config.port}`,
    websocket: `ws://localhost:${config.port}${config.wsPath}`,
    env: config.env,
    clientBuildServed: config.serveClient && fs.existsSync(path.join(clientDist, 'index.html')),
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutting down', { signal });
    stopSweeper();
    try {
      await signaling.close();
    } catch (error) {
      log.warn('signaling close failed', { error: error?.message });
    }
    roomManager.clear();
    await new Promise((resolve) => httpServer.close(() => resolve()));
    log.info('shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('uncaughtException', (error) => {
    log.error('uncaught exception', { error: error?.message });
  });
  process.on('unhandledRejection', (reason) => {
    log.error('unhandled rejection', { reason: reason?.message ?? String(reason) });
  });

  return { httpServer, shutdown };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  start().catch((error) => {
    log.error('failed to start', { error: error?.message });
    process.exit(1);
  });
}

export default createServer;
