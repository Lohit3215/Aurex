import { Emitter } from '../../utils/emitter.js';
import { createLogger } from '../../utils/logger.js';
import { Quality } from '../../config.js';
import { QualityTracker, classify, readStats } from './quality.js';
import rtcConfig from './rtcConfig.js';

/**
 * One RTCPeerConnection between the local participant and exactly one remote
 * participant.
 *
 * Design notes:
 *  - Perfect negotiation (polite/impolite decided by a deterministic id
 *    comparison) removes glare, so both join orders work without bookkeeping.
 *  - A sendrecv transceiver is always created for audio and video, even when the
 *    local track is missing. That way a participant who joins without a camera
 *    can switch devices later with replaceTrack() and no renegotiation.
 *  - ICE candidates that arrive before the remote description are queued.
 *  - Recovery is bounded: grace period -> ICE restart -> single controlled
 *    rebuild. Never an unbounded loop.
 */
const RECOVERY_GRACE_MS = 8000;
const RECOVERY_MIN_INTERVAL_MS = 6000;
const MAX_RECOVERY_ATTEMPTS = 2;

const serializeDescription = (description) =>
  description && typeof description.toJSON === 'function'
    ? description.toJSON()
    : { type: description?.type, sdp: description?.sdp };

export class PeerLink extends Emitter {
  #pc = null;

  #selfId;

  #peerId;

  #polite;

  #getLocalMedia;

  #sendSignal;

  #config;

  #log;

  /** @type {Map<string, RTCRtpTransceiver>} */
  #transceivers = new Map();

  #remoteStream = new MediaStream();

  #screenAudioStream = new MediaStream();

  #sawPrimaryAudio = false;

  #pendingCandidates = [];

  #makingOffer = false;

  #ignoreOffer = false;

  #isSettingRemoteAnswer = false;

  #quality = new QualityTracker();

  #recoveryTimer = null;

  #lastRecoveryAt = 0;

  #recoveryAttempts = 0;

  #closed = false;

  #escalating = false;

  /**
   * A link created lazily from an inbound offer must never open with its own
   * offer - that would just glare. It flips to true after the first remote
   * description lands, so later local changes (e.g. adding a screen-audio
   * transceiver) can still renegotiate normally.
   */
  #autoNegotiate = true;

  constructor({ selfId, peerId, getLocalMedia, sendSignal, config = rtcConfig, logger, autoNegotiate = true }) {
    super();
    this.#selfId = selfId;
    this.#peerId = peerId;
    // The participant with the lower id is the impolite side: it always makes
    // the first offer, which makes the handshake deterministic.
    this.#polite = String(selfId) > String(peerId);
    this.#getLocalMedia = getLocalMedia;
    this.#sendSignal = sendSignal;
    this.#config = config;
    this.#autoNegotiate = autoNegotiate;
    this.#log = logger ?? createLogger(`rtc:${peerId.slice(-4)}`);
  }

  get peerId() {
    return this.#peerId;
  }

  get polite() {
    return this.#polite;
  }

  get connectionState() {
    return this.#pc?.connectionState ?? 'closed';
  }

  get remoteStream() {
    return this.#remoteStream;
  }

  get screenAudioStream() {
    return this.#screenAudioStream;
  }

  get quality() {
    return this.#quality.current;
  }

  start() {
    if (this.#pc) return this.#pc;
    const pc = new RTCPeerConnection(this.#config);
    this.#pc = pc;
    this.#wire(pc);
    this.#ensureTransceivers();
    return pc;
  }

  #ensureTransceivers() {
    const { audioTrack, videoTrack } = this.#getLocalMedia();
    this.#ensureTransceiver('audio', audioTrack);
    this.#ensureTransceiver('video', videoTrack);
  }

  #ensureTransceiver(kind, track) {
    const existing = this.#transceivers.get(kind);
    if (existing) return existing;
    const pc = this.#pc;
    if (!pc) return null;
    const transceiver = track
      ? pc.addTransceiver(track, { direction: 'sendrecv' })
      : pc.addTransceiver(kind, { direction: 'sendrecv' });
    this.#transceivers.set(kind, transceiver);
    return transceiver;
  }

  #wire(pc) {
    pc.onnegotiationneeded = async () => {
      if (this.#closed || !this.#autoNegotiate) return;
      try {
        this.#makingOffer = true;
        await pc.setLocalDescription();
        this.#sendSignal({
          type: 'offer',
          description: serializeDescription(pc.localDescription),
        });
      } catch (error) {
        this.#log.warn('setLocalDescription(offer) failed', { error: error?.message });
      } finally {
        this.#makingOffer = false;
      }
    };

    pc.onicecandidate = (event) => {
      const candidate = event.candidate;
      if (!candidate || this.#closed) return;
      this.#sendSignal({ type: 'ice-candidate', candidate: candidate.toJSON ? candidate.toJSON() : candidate });
    };

    pc.onicegatheringstatechange = () => {
      this.#log.debug('ice gathering', { state: pc.iceGatheringState });
    };

    pc.ontrack = (event) => {
      const track = event.track;
      if (!track) return;
      if (track.kind === 'audio') {
        if (!this.#sawPrimaryAudio) {
          this.#sawPrimaryAudio = true;
          this.#remoteStream.addTrack(track);
        } else {
          // Second audio m-line = the presenter's tab/system audio.
          this.#screenAudioStream.addTrack(track);
          this.emit('screen-audio', this.#screenAudioStream);
        }
      } else if (track.kind === 'video') {
        this.#remoteStream.addTrack(track);
      }
      track.onmute = () => this.emit('track-mute', { track, muted: true });
      track.onunmute = () => this.emit('track-mute', { track, muted: false });
      this.emit('stream', this.#remoteStream);
    };

    pc.onconnectionstatechange = () => this.#reportState();
    pc.oniceconnectionstatechange = () => this.#reportState();
    pc.onsignalingstatechange = () => {
      this.emit('state', this.#snapshotState());
    };
  }

  #snapshotState() {
    return {
      peerId: this.#peerId,
      connection: this.#pc?.connectionState ?? 'closed',
      ice: this.#pc?.iceConnectionState ?? 'closed',
      signaling: this.#pc?.signalingState ?? 'stable',
      quality: this.#quality.current,
    };
  }

  #reportState() {
    const state = this.#snapshotState();
    this.emit('state', state);
    const connection = state.connection;
    if (connection === 'connected') {
      this.#clearRecoveryTimer();
      this.#recoveryAttempts = 0;
      this.#escalating = false;
      this.#lastRecoveryAt = Date.now();
      return;
    }
    if (connection === 'disconnected') {
      this.#beginGrace();
      return;
    }
    if (connection === 'failed') {
      this.#escalate('failed');
      return;
    }
    if (connection === 'closed') this.emit('closed', state);
  }

  // ------------------------------------------------------------------ signal

  /** Entry point for offer / answer / ice-candidate messages from the server. */
  async handleSignal(message) {
    if (this.#closed) return;
    if (!this.#pc) this.start();
    if (message.description) {
      this.#log.debug(`apply remote ${message.description.type} (polite=${this.#polite}, state=${this.#pc?.signalingState})`);
      await this.#onDescription(message.description);
    } else if (message.candidate) {
      await this.#onCandidate(message.candidate);
    }
  }

  async #onDescription(description) {
    const pc = this.#pc;
    if (!pc) return;
    const readyForOffer = !this.#makingOffer && (pc.signalingState === 'stable' || this.#isSettingRemoteAnswer);
    const offerCollision = description.type === 'offer' && !readyForOffer;
    this.#ignoreOffer = !this.#polite && offerCollision;
    if (this.#ignoreOffer) {
      this.#log.debug('ignoring colliding offer');
      return;
    }
    try {
      this.#isSettingRemoteAnswer = description.type === 'answer';
      await pc.setRemoteDescription(description);
      this.#isSettingRemoteAnswer = false;
      this.#autoNegotiate = true;
      await this.#flushCandidates();
      if (description.type === 'offer') {
        await pc.setLocalDescription();
        this.#sendSignal({
          type: 'answer',
          description: serializeDescription(pc.localDescription),
        });
      }
    } catch (error) {
      this.#isSettingRemoteAnswer = false;
      this.#log.warn(`setRemoteDescription failed (${description.type}): ${error?.message}`);
      this.#escalate('sdp-error');
    }
  }

  async #onCandidate(candidate) {
    if (this.#ignoreOffer) return;
    if (!this.#pc) return;
    if (this.#pc.remoteDescription) {
      try {
        await this.#pc.addIceCandidate(candidate);
      } catch (error) {
        // A stale or duplicate candidate must never break the connection.
        this.#log.debug('addIceCandidate rejected', { error: error?.message });
      }
      return;
    }
    if (this.#pendingCandidates.length < 64) this.#pendingCandidates.push(candidate);
  }

  async #flushCandidates() {
    if (!this.#pendingCandidates.length || !this.#pc?.remoteDescription) return;
    const queued = this.#pendingCandidates;
    this.#pendingCandidates = [];
    for (const candidate of queued) {
      try {
        // eslint-disable-next-line no-await-in-loop -- order matters for ICE
        await this.#pc.addIceCandidate(candidate);
      } catch (error) {
        this.#log.debug('queued candidate rejected', { error: error?.message });
      }
    }
  }

  // ------------------------------------------------------------------- media

  /**
   * Swaps the outgoing track for a kind without touching the connection.
   * Returns true when the sender now carries the new track.
   */
  async setTrack(kind, track) {
    if (this.#closed) return false;
    if (!this.#pc) {
      if (track) this.start();
      else return false;
    }
    const transceiver = this.#ensureTransceiver(kind, track);
    if (!transceiver?.sender) return false;
    try {
      if (typeof transceiver.sender.replaceTrack === 'function') {
        await transceiver.sender.replaceTrack(track ?? null);
      }
      // No renegotiation needed: the transceiver was created sendrecv up front.
      return true;
    } catch (error) {
      this.#log.warn('replaceTrack failed', { kind, error: error?.message });
      return false;
    }
  }

  /** Optional system/tab audio from a screen share; null removes it. */
  async setScreenAudioTrack(track) {
    if (this.#closed) return false;
    if (!track && !this.#transceivers.has('screenAudio')) return true;
    const transceiver = this.#ensureTransceiver('screenAudio', track);
    if (!transceiver?.sender) return false;
    try {
      await transceiver.sender.replaceTrack(track ?? null);
      return true;
    } catch (error) {
      this.#log.warn('screen audio replaceTrack failed', { error: error?.message });
      return false;
    }
  }

  hasVideoSenderTrack() {
    const sender = this.#transceivers.get('video')?.sender;
    return Boolean(sender?.track);
  }

  // ---------------------------------------------------------------- recovery

  #beginGrace() {
    if (this.#closed || this.#recoveryTimer) return;
    this.emit('recovering', { peerId: this.#peerId, phase: 'grace' });
    this.#recoveryTimer = setTimeout(() => {
      this.#recoveryTimer = null;
      this.#escalate('grace-expired');
    }, RECOVERY_GRACE_MS);
  }

  #clearRecoveryTimer() {
    if (this.#recoveryTimer) {
      clearTimeout(this.#recoveryTimer);
      this.#recoveryTimer = null;
    }
  }

  #escalate(reason) {
    if (this.#closed || this.#escalating) return;
    const since = Date.now() - this.#lastRecoveryAt;
    if (since < RECOVERY_MIN_INTERVAL_MS && this.#recoveryAttempts > 0) {
      this.#recoveryTimer = setTimeout(() => {
        this.#recoveryTimer = null;
        this.#escalate(reason);
      }, RECOVERY_MIN_INTERVAL_MS - since);
      return;
    }
    this.#escalating = true;
    this.#clearRecoveryTimer();

    if (this.#recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
      this.#log.warn('recovery exhausted, requesting rebuild', { reason, attempts: this.#recoveryAttempts });
      this.emit('rebuild', { peerId: this.#peerId, reason });
      this.#escalating = false;
      return;
    }
    this.#recoveryAttempts += 1;
    this.#lastRecoveryAt = Date.now();
    this.emit('recovering', { peerId: this.#peerId, phase: 'restart', attempt: this.#recoveryAttempts, reason });

    const pc = this.#pc;
    if (pc && typeof pc.restartIce === 'function' && this.#recoveryAttempts === 1) {
      try {
        pc.restartIce();
        this.#log.info('ice restart requested', { attempt: this.#recoveryAttempts });
        this.#escalating = false;
        // If the restart does not help, escalate again on the next state change.
        this.#recoveryTimer = setTimeout(() => {
          this.#recoveryTimer = null;
          if (this.#pc?.connectionState !== 'connected') this.#escalate('restart-timeout');
        }, RECOVERY_GRACE_MS);
        return;
      } catch (error) {
        this.#log.warn('restartIce failed', { error: error?.message });
      }
    }
    this.emit('rebuild', { peerId: this.#peerId, reason });
    this.#escalating = false;
  }

  // ------------------------------------------------------------------ stats

  /** Raw ICE/candidate view for dev tooling. Never shown to end users. */
  async debugStats() {
    const pc = this.#pc;
    if (!pc) return { connection: 'closed' };
    const out = {
      connection: pc.connectionState,
      iceGathering: pc.iceGatheringState,
      iceConnection: pc.iceConnectionState,
      signaling: pc.signalingState,
      hasLocalDescription: Boolean(pc.localDescription),
      hasRemoteDescription: Boolean(pc.remoteDescription),
      pendingCandidates: this.#pendingCandidates.length,
      pairs: [],
      local: [],
      remote: [],
    };
    try {
      const report = await pc.getStats();
      report.forEach((stat) => {
        if (stat.type === 'candidate-pair') {
          out.pairs.push({
            state: stat.state,
            nominated: stat.nominated,
            bytesSent: stat.bytesSent,
            bytesReceived: stat.bytesReceived,
            localId: stat.localCandidateId,
            remoteId: stat.remoteCandidateId,
          });
        } else if (stat.type === 'local-candidate') {
          out.local.push({ id: stat.id, type: stat.candidateType, address: stat.address, port: stat.port, protocol: stat.protocol });
        } else if (stat.type === 'remote-candidate') {
          out.remote.push({ id: stat.id, type: stat.candidateType, address: stat.address, port: stat.port, protocol: stat.protocol });
        }
      });
    } catch (error) {
      out.error = error?.message;
    }
    return out;
  }

  async sampleQuality() {
    if (this.#closed || !this.#pc || this.#pc.connectionState === 'closed') return null;
    if (typeof this.#pc.getStats !== 'function') return null;
    let report;
    try {
      report = await this.#pc.getStats();
    } catch (error) {
      this.#log.debug('getStats failed', { error: error?.message });
      return null;
    }
    const measured = readStats(report);
    if (this.#pc.connectionState === 'connected' || this.#pc.connectionState === 'connecting') {
      const sample = classify(measured);
      const quality = this.#quality.push(sample);
      this.emit('quality', {
        peerId: this.#peerId,
        quality,
        rtt: sample.rtt,
        lossRatio: sample.lossRatio,
        jitter: sample.jitter,
      });
      return quality;
    }
    this.#quality.push({ quality: Quality.RECONNECTING });
    return Quality.RECONNECTING;
  }

  // ------------------------------------------------------------------ teardown

  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#clearRecoveryTimer();
    const pc = this.#pc;
    this.#pc = null;
    if (pc) {
      pc.onnegotiationneeded = null;
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.onsignalingstatechange = null;
      pc.onicegatheringstatechange = null;
      try {
        pc.getTransceivers().forEach((transceiver) => {
          if (transceiver.stop) transceiver.stop();
        });
      } catch {
        /* ignore */
      }
      try {
        pc.close();
      } catch {
        /* already closed */
      }
    }
    for (const stream of [this.#remoteStream, this.#screenAudioStream]) {
      for (const track of stream.getTracks()) {
        try {
          track.onmute = null;
          track.onunmute = null;
          track.stop();
        } catch {
          /* already stopped */
        }
      }
      stream.getTracks().forEach((track) => {
        try {
          stream.removeTrack(track);
        } catch {
          /* ignore */
        }
      });
    }
    this.#pendingCandidates = [];
    this.#transceivers.clear();
    this.#quality.reset();
    this.clear();
  }
}

export default PeerLink;
