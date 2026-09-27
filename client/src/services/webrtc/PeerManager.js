import { Emitter } from '../../utils/emitter.js';
import { createLogger } from '../../utils/logger.js';
import PeerLink from './PeerLink.js';
import rtcConfig from './rtcConfig.js';

const STATS_INTERVAL_MS = 2500;
const log = createLogger('rtc:manager');

/**
 * Owns every RTCPeerConnection for the current meeting.
 *
 * Keyed strictly by remote participant id - never by array index - so
 * participants can join and leave at any time without stale or duplicated
 * connections. Everything above this class speaks in participant ids, streams
 * and media state, which is also the seam where a future SFU would be swapped
 * in without touching the UI.
 */
export class PeerManager extends Emitter {
  #links = new Map();

  /** Roster the UI last asked for; guards against resurrecting departed peers. */
  #intended = new Set();

  #selfId = null;

  #getLocalMedia;

  #send;

  #statsTimer = null;

  #config;

  #disposed = false;

  constructor({ send, getLocalMedia, config = rtcConfig }) {
    super();
    this.#send = send;
    this.#getLocalMedia = getLocalMedia;
    this.#config = config;
  }

  get size() {
    return this.#links.size;
  }

  get selfId() {
    return this.#selfId;
  }

  peerIds() {
    return [...this.#links.keys()];
  }

  has(peerId) {
    return this.#links.has(peerId);
  }

  setSelfId(selfId) {
    this.#selfId = selfId;
  }

  /** Makes the live connection set match `peerIds` exactly. */
  sync(peerIds) {
    if (this.#disposed) return;
    const wanted = new Set(
      (Array.isArray(peerIds) ? peerIds : []).filter(
        (id) => typeof id === 'string' && Boolean(id) && id !== this.#selfId,
      ),
    );
    this.#intended = wanted;

    for (const [peerId, link] of [...this.#links]) {
      if (!wanted.has(peerId)) {
        log.debug('closing link for departed participant', { peerId });
        link.close();
        this.#links.delete(peerId);
        this.emit('peer-removed', { peerId });
      }
    }
    for (const peerId of wanted) {
      if (!this.#links.has(peerId)) this.#createLink(peerId);
    }
  }

  #createLink(peerId, { autoNegotiate = true } = {}) {
    if (this.#disposed) return null;
    const link = new PeerLink({
      selfId: this.#selfId ?? '~',
      peerId,
      getLocalMedia: this.#getLocalMedia,
      sendSignal: (signal) => this.#send(peerId, signal),
      config: this.#config,
      autoNegotiate,
    });

    link.on('stream', (stream) => this.emit('stream', { peerId, stream }));
    link.on('screen-audio', (stream) => this.emit('screen-audio', { peerId, stream }));
    link.on('state', (state) => this.emit('state', { peerId, ...state }));
    link.on('quality', (payload) => this.emit('quality', { peerId, ...payload }));
    link.on('track-mute', (payload) => this.emit('track-mute', { peerId, ...payload }));
    link.on('recovering', (payload) => this.emit('recovering', { peerId, ...payload }));
    link.on('rebuild', () => this.#rebuild(peerId));

    this.#links.set(peerId, link);
    link.start();
    log.debug('link created', { peerId, polite: link.polite, total: this.#links.size });
    this.emit('peer-added', { peerId });
    return link;
  }

  #rebuild(peerId) {
    const existing = this.#links.get(peerId);
    if (!existing || this.#disposed) return;
    log.info('rebuilding peer connection', { peerId });
    existing.close();
    this.#links.delete(peerId);
    // The peer may have left while the rebuild was queued.
    if (this.#intended.has(peerId)) this.#createLink(peerId);
  }

  async handleSignal({ from, type, description, candidate }) {
    if (this.#disposed || typeof from !== 'string' || !from) return;
    if (!this.#links.has(from)) {
      // The offer can legitimately beat the roster update, so create the link
      // on demand. It is created without auto-negotiation to avoid glare, and
      // the next sync() drops it if the participant has actually left.
      this.#createLink(from, { autoNegotiate: false });
    }
    const link = this.#links.get(from);
    if (!link) return;
    try {
      await link.handleSignal({ type, description, candidate });
    } catch (error) {
      log.warn('signal handling failed', { from, type, error: error?.message });
    }
  }

  /** Swaps one outgoing track on every connection without renegotiating. */
  async setTrack(kind, track) {
    const results = [];
    for (const [peerId, link] of this.#links) {
      // eslint-disable-next-line no-await-in-loop -- bounded by participant count
      const ok = await link.setTrack(kind, track);
      results.push({ peerId, ok });
    }
    return results;
  }

  setScreenAudioTrack(track) {
    const results = [];
    for (const [peerId, link] of this.#links) {
      results.push(link.setScreenAudioTrack(track).then((ok) => ({ peerId, ok })));
    }
    return Promise.all(results);
  }

  startStatsSampling() {
    if (this.#statsTimer || this.#disposed) return;
    this.#statsTimer = setInterval(() => {
      for (const link of this.#links.values()) {
        void link.sampleQuality();
      }
    }, STATS_INTERVAL_MS);
  }

  stopStatsSampling() {
    if (this.#statsTimer) {
      clearInterval(this.#statsTimer);
      this.#statsTimer = null;
    }
  }

  close(peerId) {
    const link = this.#links.get(peerId);
    if (!link) return;
    link.close();
    this.#links.delete(peerId);
    this.emit('peer-removed', { peerId });
  }

  /** Read-only view of every connection, for dev tooling and diagnostics. */
  debugSnapshot() {
    return [...this.#links.entries()].map(([peerId, link]) => ({
      peerId,
      connection: link.connectionState,
      remoteTracks: link.remoteStream.getTracks().map((track) => `${track.kind}:${track.readyState}:${track.muted}`),
      hasVideoSender: link.hasVideoSenderTrack(),
    }));
  }

  /** Full ICE detail for one peer, used when debugging connectivity. */
  debugStats(peerId) {
    return this.#links.get(peerId)?.debugStats() ?? null;
  }

  peerStats() {
    return Promise.all([...this.#links.keys()].map(async (peerId) => ({ peerId, ...(await this.debugStats(peerId)) })));
  }

  closeAll() {
    this.stopStatsSampling();
    for (const link of this.#links.values()) link.close();
    this.#links.clear();
    this.#intended = new Set();
  }

  dispose() {
    this.#disposed = true;
    this.closeAll();
    this.clear();
  }
}

export default PeerManager;
