import { WebSocketServer } from 'ws';
import { SignalingHandlers, CLOSE_CODE } from './handlers.js';
import { createWindowLimiter, RATE_LIMIT_WINDOW_MS } from './rateLimiter.js';
import { createConnectionId } from '../utils/ids.js';
import { ErrorCode, Errors } from '../utils/errors.js';
import config from '../config.js';

/**
 * WebSocket transport for the signaling protocol.
 *
 * Responsibilities kept here: connection lifecycle, framing, size limits,
 * heartbeats, per-IP connection caps and rate limiting. Everything about
 * meetings lives in SignalingHandlers / RoomManager.
 */
export function attachSignaling(httpServer, { roomManager, logger, config: cfg = config }) {
  const wss = new WebSocketServer({
    server: httpServer,
    path: cfg.wsPath,
    maxPayload: cfg.maxMessageBytes,
    perMessageDeflate: false,
  });

  const handlers = new SignalingHandlers({ roomManager, logger });
  /** @type {Set<object>} */
  const connections = new Set();
  /** @type {Map<string, number>} */
  const ipCounts = new Map();

  const trackIp = (ip, delta) => {
    if (!ip) return;
    const next = (ipCounts.get(ip) ?? 0) + delta;
    if (next <= 0) ipCounts.delete(ip);
    else ipCounts.set(ip, next);
  };

  wss.on('connection', (socket, request) => {
    const ip = normalizeIp(request.socket.remoteAddress);
    if ((ipCounts.get(ip) ?? 0) >= cfg.maxConnectionsPerIp) {
      logger.warn('connection rejected (per-ip limit)', { ip });
      safeSendError(socket, Errors.rateLimited());
      socket.close(CLOSE_CODE.RATE_LIMITED, 'too many connections');
      return;
    }
    trackIp(ip, 1);

    const ctx = {
      connectionId: createConnectionId(),
      socket,
      ip,
      roomId: null,
      participantId: null,
      isHost: false,
      status: 'idle',
      joinedAt: 0,
      currentType: null,
      isAlive: true,
      allowMessages: createWindowLimiter({
        windowMs: RATE_LIMIT_WINDOW_MS,
        max: cfg.rateLimitMaxMessages,
      }),
      allowChat: createWindowLimiter({
        windowMs: RATE_LIMIT_WINDOW_MS,
        max: cfg.rateLimitChatMax,
      }),
    };

    connections.add(ctx);
    logger.info('ws connected', { connectionId: ctx.connectionId, ip, connections: connections.size });

    handlers.send(socket, 'welcome', {
      connectionId: ctx.connectionId,
      serverTime: Date.now(),
      limits: {
        maxMessageLength: cfg.chatMaxLength,
        maxDisplayNameLength: cfg.maxNameLength,
        roomIdLength: cfg.roomIdLength,
      },
    });

    socket.on('pong', () => {
      ctx.isAlive = true;
    });

    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        handlers.sendError(ctx, Errors.invalidMessage());
        return;
      }
      // Budget check: a small overshoot earns a warning, a sustained flood
      // gets the connection dropped.
      const seen = ctx.allowMessages.take();
      if (seen > ctx.allowMessages.max) {
        if (seen <= ctx.allowMessages.max * 2) {
          handlers.sendError(ctx, Errors.rateLimited());
        } else {
          logger.warn('ws closed (flood)', { connectionId: ctx.connectionId, ip, seen });
          socket.close(CLOSE_CODE.RATE_LIMITED, 'rate limit exceeded');
        }
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(typeof data === 'string' ? data : data.toString('utf8'));
      } catch {
        handlers.sendError(ctx, Errors.invalidMessage());
        return;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        handlers.sendError(ctx, Errors.invalidMessage());
        return;
      }
      const { type, ...payload } = parsed;
      if (type === 'chat-message' && ctx.allowChat.take() > ctx.allowChat.max) {
        handlers.sendError(ctx, Errors.rateLimited());
        return;
      }
      try {
        handlers.handleMessage(ctx, type, payload);
      } catch (error) {
        logger.error('dispatch failure', { type, error: error?.message });
        safeSendError(socket, Errors.serverError());
      }
    });

    const teardown = (reason) => {
      if (!connections.has(ctx)) return;
      connections.delete(ctx);
      trackIp(ip, -1);
      try {
        handlers.removeConnection(ctx, { reason });
      } catch (error) {
        logger.error('cleanup failure', { connectionId: ctx.connectionId, error: error?.message });
      }
      logger.info('ws closed', {
        connectionId: ctx.connectionId,
        reason,
        roomId: ctx.roomId,
        connections: connections.size,
      });
    };

    socket.on('close', (code) => teardown(code === 1000 ? 'normal' : 'dropped'));
    socket.on('error', (error) => {
      logger.warn('ws error', { connectionId: ctx.connectionId, error: error?.message });
      teardown('error');
    });
  });

  wss.on('error', (error) => {
    logger.error('websocket server error', { error: error.message });
  });

  // Lightweight keep-alive: native ping frames, one per interval, terminated
  // when a connection misses two consecutive beats.
  const heartbeat = setInterval(() => {
    for (const ctx of connections) {
      if (!ctx.isAlive) {
        logger.debug('ws reaped (no pong)', { connectionId: ctx.connectionId });
        try {
          ctx.socket.terminate();
        } catch {
          /* already gone */
        }
        continue;
      }
      ctx.isAlive = false;
      try {
        ctx.socket.ping();
      } catch {
        /* already gone */
      }
    }
  }, cfg.heartbeatIntervalMs);
  heartbeat.unref?.();

  return {
    wss,
    get connectionCount() {
      return connections.size;
    },
    stats() {
      return { connections: connections.size, ...roomManager.stats() };
    },
    close() {
      clearInterval(heartbeat);
      for (const ctx of [...connections]) {
        try {
          ctx.socket.close(1001, 'server shutting down');
        } catch {
          /* already gone */
        }
      }
      connections.clear();
      ipCounts.clear();
      return new Promise((resolve) => wss.close(() => resolve()));
    },
  };
}

function normalizeIp(address) {
  if (!address) return 'unknown';
  if (address.startsWith('::ffff:')) return address.slice(7);
  if (address === '::1') return '127.0.0.1';
  return address;
}

function safeSendError(socket, error) {
  if (!socket || socket.readyState !== 1) return;
  try {
    socket.send(JSON.stringify({ type: 'room-error', code: error.code ?? ErrorCode.SERVER_ERROR, message: error.message }));
  } catch {
    /* socket already gone */
  }
}

export default attachSignaling;
