/**
 * Signaling connection manager.
 *
 * Responsibilities:
 *  - one WebSocket at a time (never duplicates, even under React re-renders)
 *  - observable status: idle / connecting / connected / reconnecting / offline
 *  - controlled exponential backoff with jitter, paused while the browser is
 *    offline and cancelled entirely on an intentional leave
 *  - a `resume` hook so the meeting layer can restore its room state after a
 *    reconnect without the transport knowing anything about meetings
 */
import { Emitter } from '../../utils/emitter.js';
import { createLogger } from '../../utils/logger.js';
import { SignalingStatus } from '../../config.js';

const log = createLogger('signaling');

const DEFAULTS = {
  url: '',
  baseDelayMs: 600,
  maxDelayMs: 8000,
  maxAttempts: Infinity,
  appPingIntervalMs: 25000,
};

export function resolveSignalingUrl() {
  const configured = import.meta.env?.VITE_SIGNALING_URL;
  if (typeof configured === 'string' && configured.trim()) return configured.trim();
  if (typeof window === 'undefined') return 'ws://localhost:4000/ws';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // Same-origin by default: the dev server and the production server both
  // expose the signaling endpoint at /ws.
  return `${protocol}//${window.location.host}/ws`;
}

export class SignalingClient extends Emitter {
  #url;

  #options;

  #socket = null;

  #status = SignalingStatus.IDLE;

  #intentionalClose = false;

  #attempt = 0;

  #reconnectTimer = null;

  #pingTimer = null;

  #onlineHandler = null;

  #offlineHandler = null;

  #manualOfflinePause = false;

  constructor(options = {}) {
    super();
    this.#options = { ...DEFAULTS, ...options };
    this.#url = options.url || resolveSignalingUrl();
  }

  get status() {
    return this.#status;
  }

  get url() {
    return this.#url;
  }

  get isConnected() {
    return this.#status === SignalingStatus.CONNECTED;
  }

  #setStatus(status, detail) {
    if (this.#status === status) return;
    const previous = this.#status;
    this.#status = status;
    log.debug('status', { from: previous, to: status, ...detail });
    this.emit('status', { status, previous, detail });
  }

  connect() {
    if (this.#socket) return;
    this.#intentionalClose = false;
    this.#manualOfflinePause = false;
    this.#attachNetworkListeners();
    this.#open();
  }

  #open() {
    if (typeof WebSocket === 'undefined') {
      this.#setStatus(SignalingStatus.FAILED, { reason: 'unsupported' });
      this.emit('unavailable', { reason: 'This browser cannot open a WebSocket connection.' });
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.#manualOfflinePause = true;
      this.#setStatus(SignalingStatus.OFFLINE);
      return;
    }

    this.#clearReconnectTimer();
    this.#setStatus(this.#attempt === 0 ? SignalingStatus.CONNECTING : SignalingStatus.RECONNECTING, {
      attempt: this.#attempt,
    });

    let socket;
    try {
      socket = new WebSocket(this.#url);
    } catch (error) {
      log.warn('construct failed', { error: error?.message });
      this.#scheduleReconnect();
      return;
    }
    this.#socket = socket;

    socket.onopen = () => {
      if (this.#socket !== socket) return;
      this.#attempt = 0;
      this.#setStatus(SignalingStatus.CONNECTED);
      this.#startAppPing();
      this.emit('open', { attempt: this.#attempt });
    };

    socket.onmessage = (event) => {
      if (this.#socket !== socket) return;
      let payload;
      try {
        payload = JSON.parse(typeof event.data === 'string' ? event.data : '');
      } catch {
        return; // Ignore garbage rather than destabilising the session.
      }
      if (!payload || typeof payload !== 'object' || typeof payload.type !== 'string') return;
      log.debug(`recv ${payload.type}`);
      this.emit('message', payload);
      this.emit(`message:${payload.type}`, payload);
    };

    socket.onerror = () => {
      // `onclose` always follows; recovery is handled there so we never create
      // two sockets from one failure.
      if (this.#socket === socket) this.emit('socket-error', {});
    };

    socket.onclose = (event) => {
      if (this.#socket !== socket) return;
      this.#socket = null;
      this.#stopAppPing();
      const wasIntentional = this.#intentionalClose;
      this.emit('close', { code: event?.code ?? 1006, wasIntentional });

      if (wasIntentional) {
        this.#setStatus(SignalingStatus.DISCONNECTED);
        this.#detachNetworkListeners();
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        this.#manualOfflinePause = true;
        this.#setStatus(SignalingStatus.OFFLINE);
        return;
      }
      this.#setStatus(SignalingStatus.RECONNECTING, { code: event?.code ?? 1006 });
      this.#scheduleReconnect();
    };
  }

  #scheduleReconnect() {
    if (this.#intentionalClose) return;
    if (this.#manualOfflinePause) return;
    if (this.#reconnectTimer) return;
    if (this.#attempt >= this.#options.maxAttempts) {
      this.#setStatus(SignalingStatus.FAILED, { attempts: this.#attempt });
      this.emit('unavailable', { reason: 'Could not reach the meeting server.' });
      return;
    }
    const exponential = Math.min(this.#options.maxDelayMs, this.#options.baseDelayMs * 2 ** this.#attempt);
    // Jitter avoids a thundering herd when a server comes back up.
    const delay = Math.round(exponential * (0.7 + Math.random() * 0.6));
    this.#attempt += 1;
    log.info('reconnecting', { attempt: this.#attempt, delayMs: delay });
    this.emit('reconnect-attempt', { attempt: this.#attempt, delayMs: delay });
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#open();
    }, delay);
  }

  #startAppPing() {
    this.#stopAppPing();
    this.#pingTimer = setInterval(() => {
      this.send('ping', {});
    }, this.#options.appPingIntervalMs);
  }

  #stopAppPing() {
    if (this.#pingTimer) {
      clearInterval(this.#pingTimer);
      this.#pingTimer = null;
    }
  }

  send(type, payload = {}) {
    if (!this.#socket || this.#socket.readyState !== 1) return false;
    try {
      this.#socket.send(JSON.stringify({ type, ...payload }));
      log.debug(`send ${type}`);
      return true;
    } catch (error) {
      log.warn('send failed', { type, error: error?.message });
      return false;
    }
  }

  /** Intended shutdown: no reconnect, no resume, listeners detached. */
  close() {
    this.#intentionalClose = true;
    this.#clearReconnectTimer();
    this.#stopAppPing();
    this.#detachNetworkListeners();
    const socket = this.#socket;
    this.#socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close(1000, 'client left');
      } catch {
        /* already closing */
      }
    }
    this.#setStatus(SignalingStatus.DISCONNECTED);
  }

  #clearReconnectTimer() {
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }

  #attachNetworkListeners() {
    if (this.#onlineHandler || typeof window === 'undefined') return;
    this.#onlineHandler = () => {
      log.info('network online');
      this.emit('network', { online: true });
      if (!this.#socket && !this.#intentionalClose) {
        this.#manualOfflinePause = false;
        this.#attempt = 0;
        this.#open();
      }
    };
    this.#offlineHandler = () => {
      log.info('network offline');
      this.emit('network', { online: false });
      if (this.#socket) return; // the socket close handler will pause retries
      this.#manualOfflinePause = true;
      this.#clearReconnectTimer();
      this.#setStatus(SignalingStatus.OFFLINE);
    };
    window.addEventListener('online', this.#onlineHandler);
    window.addEventListener('offline', this.#offlineHandler);
  }

  #detachNetworkListeners() {
    if (typeof window === 'undefined') return;
    if (this.#onlineHandler) window.removeEventListener('online', this.#onlineHandler);
    if (this.#offlineHandler) window.removeEventListener('offline', this.#offlineHandler);
    this.#onlineHandler = null;
    this.#offlineHandler = null;
  }

  dispose() {
    this.close();
    this.clear();
  }
}

export default SignalingClient;
