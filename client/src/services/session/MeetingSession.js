import { Emitter } from '../../utils/emitter.js';
import { createLogger } from '../../utils/logger.js';
import { ErrorCode, messageFor } from '../../utils/errors.js';
import { ClientMessage, MediaState, PHASE, Quality, ServerMessage, SignalingStatus } from '../../config.js';
import SignalingClient from '../signaling/SignalingClient.js';
import PeerManager from '../webrtc/PeerManager.js';
import {
  getDisplayMediaUnsupportedReason,
  listDevices,
  mediaSupport,
  requestDisplayMedia,
  requestSingleTrack,
  requestUserMedia,
  setSinkId,
  stopStream,
  stopTrack,
  supports,
} from '../webrtc/mediaDevices.js';
import { clearIdentity, readIdentity, rememberDisplayName, saveIdentity } from './identity.js';

const log = createLogger('session');
const CHAT_LIMIT = 300;
const FATAL_JOIN_ERRORS = new Set([
  ErrorCode.ROOM_NOT_FOUND,
  ErrorCode.ROOM_LOCKED,
  ErrorCode.ROOM_ENDED,
  ErrorCode.INVALID_ROOM_ID,
  ErrorCode.INVALID_DISPLAY_NAME,
  ErrorCode.ALREADY_IN_ROOM,
  ErrorCode.SERVER_ERROR,
  ErrorCode.CONNECTION_FAILED,
]);

const initialMedia = () => ({
  audioEnabled: true,
  videoEnabled: true,
  hasAudio: false,
  hasVideo: false,
  state: MediaState.IDLE,
  audioDeviceId: '',
  videoDeviceId: '',
  outputDeviceId: 'default',
  error: null,
});

/**
 * Orchestrates one meeting session: signaling, WebRTC, local media, chat and
 * host actions. It owns the authoritative meeting state and emits shallow
 * patches; React only renders what it is told.
 *
 * The UI never calls getUserMedia, never builds an RTCPeerConnection and never
 * touches a WebSocket - it only calls the intent methods below.
 */
export class MeetingSession extends Emitter {
  #signaling;

  #peers;

  #state;

  #audioTrack = null;

  #cameraTrack = null;

  #displayStream = null;

  #displayAudioTrack = null;

  #localStream = null;

  /** What the outgoing video sender should currently carry. */
  #outgoingVideoTrack = null;

  #audioEnabled = true;

  #cameraEnabled = true;

  /** Camera preference captured when a screen share started, restored on stop. */
  #cameraEnabledBeforeShare = true;

  #intent = null;

  #joinedOnce = false;

  #leaving = false;

  #audioElements = new Map();

  constructor({ signalingUrl } = {}) {
    super();
    this.#state = {
      phase: PHASE.IDLE,
      roomId: null,
      self: null,
      participants: {},
      hostParticipantId: null,
      locked: false,
      waitingRoomEnabled: false,
      presenterParticipantId: null,
      waiting: [],
      chat: [],
      unread: 0,
      signalingStatus: SignalingStatus.IDLE,
      reconnectAttempts: 0,
      serverReachable: null,
      localStream: null,
      remoteStreams: {},
      screenAudioStreams: {},
      media: initialMedia(),
      connection: {},
      screenShare: {
        supported: supports.getDisplayMedia(),
        unsupportedReason: getDisplayMediaUnsupportedReason(),
        sharing: false,
        presenting: false,
      },
      panel: { open: false, tab: null },
      pinnedParticipantId: null,
      notice: null,
      error: null,
      deviceSupport: mediaSupport(),
      mediaRecovered: false,
    };

    this.#signaling = new SignalingClient({ url: signalingUrl });
    this.#peers = new PeerManager({
      send: (peerId, signal) => this.#sendSignal(peerId, signal),
      getLocalMedia: () => ({ audioTrack: this.#audioTrack, videoTrack: this.#outgoingVideoTrack }),
    });
  }

  get state() {
    return this.#state;
  }

  get signaling() {
    return this.#signaling;
  }

  get peers() {
    return this.#peers;
  }

  // ------------------------------------------------------------------ patch

  #patch(partial) {
    this.#state = { ...this.#state, ...partial };
    this.emit('change', partial);
  }

  #patchMedia(partial) {
    this.#patch({ media: { ...this.#state.media, ...partial } });
  }

  #notify(code, message, tone = 'info') {
    this.#patch({ notice: { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, code, message, tone } });
  }

  clearNotice = () => {
    if (this.#state.notice) this.#patch({ notice: null });
  };

  // ------------------------------------------------------------- transport

  #wireSignaling() {
    const signaling = this.#signaling;

    signaling.on('status', ({ status }) => {
      this.#patch({
        signalingStatus: status,
        serverReachable: status === SignalingStatus.CONNECTED ? true : status === SignalingStatus.OFFLINE ? false : this.#state.serverReachable,
      });
    });

    signaling.on('reconnect-attempt', ({ attempt }) => this.#patch({ reconnectAttempts: attempt }));

    signaling.on('open', () => {
      this.#patch({ reconnectAttempts: 0 });
      this.#restoreAfterReconnect();
    });

    signaling.on('message', (message) => this.#onMessage(message));

    signaling.on('unavailable', ({ reason }) => {
      this.#patch({ error: { code: ErrorCode.CONNECTION_FAILED, message: reason ?? messageFor(ErrorCode.CONNECTION_FAILED) } });
    });
  }

  #wirePeers() {
    this.#peers.on('stream', ({ peerId, stream }) => {
      this.#patch({ remoteStreams: { ...(this.#state.remoteStreams ?? {}), [peerId]: stream } });
    });
    this.#peers.on('screen-audio', ({ peerId, stream }) => {
      this.#patch({ screenAudioStreams: { ...(this.#state.screenAudioStreams ?? {}), [peerId]: stream } });
    });
    this.#peers.on('state', ({ peerId, connection, ice, signaling: signalingState, quality }) => {
      const previous = this.#state.connection[peerId] ?? {};
      this.#patch({
        connection: {
          ...this.#state.connection,
          [peerId]: { ...previous, connection, ice, signaling: signalingState, quality: quality ?? previous.quality },
        },
      });
    });
    this.#peers.on('quality', ({ peerId, quality, rtt, lossRatio }) => {
      const previous = this.#state.connection[peerId] ?? {};
      this.#patch({
        connection: {
          ...this.#state.connection,
          [peerId]: { ...previous, quality, rtt, lossRatio },
        },
      });
    });
    this.#peers.on('peer-removed', ({ peerId }) => {
      const remoteStreams = { ...(this.#state.remoteStreams ?? {}) };
      delete remoteStreams[peerId];
      const screenAudioStreams = { ...(this.#state.screenAudioStreams ?? {}) };
      delete screenAudioStreams[peerId];
      const connection = { ...this.#state.connection };
      delete connection[peerId];
      this.#detachScreenAudio(peerId);
      this.#patch({ remoteStreams, screenAudioStreams, connection });
    });
    this.#peers.on('recovering', ({ peerId, phase }) => {
      const previous = this.#state.connection[peerId] ?? {};
      this.#patch({
        connection: {
          ...this.#state.connection,
          [peerId]: { ...previous, quality: Quality.RECONNECTING, recoveryPhase: phase },
        },
      });
    });
  }

  // ------------------------------------------------------------------ start

  /** Opens the signaling connection. Media is requested separately. */
  connect() {
    this.#wireSignaling();
    this.#wirePeers();
    this.#signaling.connect();
  }

  #requireConnected() {
    if (!this.#signaling.isConnected) throw new Error('signaling not connected');
  }

  #setIntent(intent) {
    this.#intent = intent;
    if (intent?.displayName) rememberDisplayName(intent.displayName);
  }

  /**
   * Requests camera + microphone. Failure is not fatal: the participant can
   * still join with whatever the device manager could give us.
   */
  async prepareMedia({ audioDeviceId, videoDeviceId, audio = true, video = true } = {}) {
    this.#patchMedia({ state: MediaState.REQUESTING, error: null });
    try {
      const result = await requestUserMedia({ audioDeviceId, videoDeviceId, audio, video });
      this.#localStream = result.stream;
      this.#audioTrack = result.audioTrack;
      this.#cameraTrack = result.videoTrack;
      this.#outgoingVideoTrack = result.videoTrack;
      this.#audioEnabled = Boolean(result.audioTrack);
      this.#cameraEnabled = Boolean(result.videoTrack);
      if (result.audioTrack) result.audioTrack.enabled = true;
      if (result.videoTrack) result.videoTrack.enabled = true;
      this.#wireLocalTracks();
      this.#patch({ localStream: result.stream });
      this.#patchMedia({
        state: result.degraded ? MediaState.PARTIAL : MediaState.READY,
        hasAudio: Boolean(result.audioTrack),
        hasVideo: Boolean(result.videoTrack),
        audioEnabled: Boolean(result.audioTrack),
        videoEnabled: Boolean(result.videoTrack),
        audioDeviceId: result.audioTrack?.getSettings?.().deviceId ?? audioDeviceId ?? '',
        videoDeviceId: result.videoTrack?.getSettings?.().deviceId ?? videoDeviceId ?? '',
      });
      await this.refreshDevices();
      return { ok: true, degraded: result.degraded };
    } catch (error) {
      const described = error?.userFacing ?? { code: ErrorCode.MEDIA_FAILED, message: messageFor(ErrorCode.MEDIA_FAILED) };
      this.#localStream = null;
      this.#audioTrack = null;
      this.#cameraTrack = null;
      this.#outgoingVideoTrack = null;
      this.#patch({ localStream: null });
      this.#patchMedia({ state: MediaState.ERROR, hasAudio: false, hasVideo: false, error: described });
      log.warn('prepareMedia failed', { code: described.code });
      return { ok: false, error: described };
    }
  }

  #wireLocalTracks() {
    for (const track of [this.#audioTrack, this.#cameraTrack]) {
      if (!track) continue;
      track.onended = () => this.#onLocalTrackEnded(track);
    }
  }

  #onLocalTrackEnded(track) {
    if (this.#leaving) return;
    if (track === this.#cameraTrack) {
      this.#cameraTrack = null;
      if (!this.#displayStream) this.#outgoingVideoTrack = null;
      this.#patchMedia({ hasVideo: false, videoEnabled: false });
      this.#publishMediaState();
      this.#notify(ErrorCode.DEVICE_UNAVAILABLE, 'Your camera stopped working. Check the device and try again.', 'warning');
      void this.refreshDevices();
    } else if (track === this.#audioTrack) {
      this.#audioTrack = null;
      this.#patchMedia({ hasAudio: false, audioEnabled: false });
      this.#publishMediaState();
      this.#notify(ErrorCode.DEVICE_UNAVAILABLE, 'Your microphone stopped working. Check the device and try again.', 'warning');
      void this.refreshDevices();
    }
  }

  async createMeeting({ displayName }) {
    this.#setIntent({ type: 'create', displayName });
    this.#patch({ phase: PHASE.JOINING, error: null });
    this.#requireConnected();
    this.#signaling.send(ClientMessage.CREATE_ROOM, { displayName });
    return { ok: true };
  }

  async joinMeeting({ roomId, displayName }) {
    this.#setIntent({ type: 'join', roomId, displayName });
    this.#patch({ phase: PHASE.JOINING, roomId, error: null });
    this.#requireConnected();
    this.#sendJoin(roomId, displayName);
    return { ok: true };
  }

  #sendJoin(roomId, displayName) {
    const identity = readIdentity(roomId);
    this.#signaling.send(ClientMessage.JOIN_ROOM, {
      roomId,
      displayName,
      ...(identity?.resumeToken ? { resumeToken: identity.resumeToken } : {}),
    });
  }

  /**
   * After a signaling drop the meeting is re-entered with the *same* room id
   * and resume token, never by creating a new room.
   */
  #restoreAfterReconnect() {
    if (this.#leaving) return;
    const intent = this.#intent;
    if (!intent?.roomId) return;
    if (this.#state.phase === PHASE.WAITING || this.#state.phase === PHASE.ACTIVE) {
      this.#sendJoin(intent.roomId, intent.displayName);
    }
  }

  // ---------------------------------------------------------------- inbound

  #onMessage(message) {
    const { type } = message;
    switch (type) {
      case ServerMessage.WELCOME:
        this.#patch({ serverReachable: true });
        break;
      case ServerMessage.ROOM_CREATED:
      case ServerMessage.ROOM_JOINED:
        this.#onRoomEntered(message);
        break;
      case ServerMessage.ROOM_STATE:
        this.#onRoomState(message.room);
        break;
      case ServerMessage.ROOM_SETTINGS_CHANGED:
        this.#patch({ locked: message.locked, waitingRoomEnabled: message.waitingRoomEnabled });
        break;
      case ServerMessage.PARTICIPANT_JOINED:
        // The authoritative ROOM_STATE that follows carries the same update.
        this.#onParticipantJoined(message.participant);
        break;
      case ServerMessage.PARTICIPANT_LEFT:
        this.#onParticipantLeft(message.participantId, message.reason);
        break;
      case ServerMessage.HOST_CHANGED:
        this.#patch({ hostParticipantId: message.hostParticipantId });
        this.#syncPeers();
        break;
      case ServerMessage.WAITING_ROOM_STATE:
        this.#onWaiting(message);
        break;
      case ServerMessage.WAITING_ROOM_UPDATED:
        this.#patch({ waiting: Array.isArray(message.waiting) ? message.waiting : [] });
        break;
      case ServerMessage.WAITING_ROOM_DENIED:
        this.#patch({
          phase: PHASE.DENIED,
          error: { code: 'DENIED', message: `${message.byDisplayName ?? 'The host'} did not let you into this meeting.` },
        });
        break;
      case ServerMessage.PARTICIPANT_REMOVED:
        this.#patch({
          phase: PHASE.REMOVED,
          error: { code: 'REMOVED', message: `${message.byDisplayName ?? 'The host'} removed you from the meeting.` },
        });
        this.#teardownLocalMedia();
        break;
      case ServerMessage.MEETING_ENDED:
        this.#patch({ phase: PHASE.ENDED, error: { code: 'ENDED', message: 'The host ended the meeting.' } });
        this.#teardownLocalMedia();
        break;
      case ServerMessage.MUTE_REQUEST:
        void this.#handleMuteRequest();
        break;
      case ServerMessage.OFFER:
      case ServerMessage.ANSWER:
      case ServerMessage.ICE_CANDIDATE:
        void this.#peers.handleSignal({
          from: message.from,
          type,
          description: message.description,
          candidate: message.candidate,
        });
        break;
      case ServerMessage.MEDIA_STATE_CHANGED:
        this.#onMediaStateChanged(message);
        break;
      case ServerMessage.SCREEN_SHARE_STATE_CHANGED:
        this.#onScreenShareStateChanged(message);
        break;
      case ServerMessage.HAND_STATE_CHANGED:
        this.#onHandStateChanged(message);
        break;
      case ServerMessage.CHAT_MESSAGE:
        this.#appendChat({ ...message.message, mine: message.message.senderParticipantId === this.#state.self?.participantId });
        break;
      case ServerMessage.CHAT_SYSTEM:
        this.#appendChat({ ...message.message, kind: message.message.kind ?? 'system' });
        break;
      case ServerMessage.ROOM_ERROR:
        this.#onRoomError(message);
        break;
      default:
        break;
    }
  }

  #onRoomEntered(message) {
    const { room, self, chat } = message;
    const rejoining = this.#joinedOnce;
    this.#joinedOnce = true;
    this.#intent = { ...(this.#intent ?? {}), roomId: room.roomId, displayName: self.displayName };
    this.#setIntent(this.#intent);

    saveIdentity(room.roomId, {
      participantId: self.participantId,
      resumeToken: self.resumeToken,
      displayName: self.displayName,
    });

    if (rejoining) {
      // A reconnected socket must not keep links that the other side already
      // tore down: start from a clean slate and renegotiate.
      this.#peers.closeAll();
      this.#patch({ remoteStreams: {}, screenAudioStreams: {}, connection: {}, chat: [], unread: 0 });
    }

    this.#patch({
      phase: PHASE.ACTIVE,
      roomId: room.roomId,
      self: {
        participantId: self.participantId,
        displayName: self.displayName,
        isHost: Boolean(self.isHost),
        audioEnabled: self.audioEnabled !== false,
        videoEnabled: self.videoEnabled !== false,
        handRaised: Boolean(self.handRaised),
      },
      error: null,
      mediaRecovered: rejoining,
    });

    this.#peers.setSelfId(self.participantId);
    this.#onRoomState(room);
    this.#hydrateChat(chat);
    this.#publishMediaState();
    this.#peers.startStatsSampling();
  }

  #onRoomState(room) {
    if (!room || typeof room !== 'object') return;
    const participants = {};
    for (const entry of room.participants ?? []) {
      if (!entry?.participantId) continue;
      participants[entry.participantId] = {
        participantId: entry.participantId,
        displayName: entry.displayName,
        isHost: Boolean(entry.isHost),
        joinedAt: entry.joinedAt ?? 0,
        audioEnabled: entry.audioEnabled !== false,
        videoEnabled: entry.videoEnabled !== false,
        handRaised: Boolean(entry.handRaised),
        sharingScreen: Boolean(entry.sharingScreen),
      };
    }
    this.#patch({
      roomId: room.roomId ?? this.#state.roomId,
      participants,
      hostParticipantId: room.hostParticipantId ?? null,
      locked: Boolean(room.locked),
      waitingRoomEnabled: Boolean(room.waitingRoomEnabled),
      presenterParticipantId: room.presenterParticipantId ?? null,
      waiting: Array.isArray(room.waiting) ? room.waiting : this.#state.waiting,
      screenShare: { ...this.#state.screenShare, presenting: Boolean(room.presenterParticipantId) },
    });
    this.#reconcileSelf(participants);
    this.#syncPeers();
  }

  #reconcileSelf(participants) {
    const self = this.#state.self;
    if (!self) return;
    const server = participants[self.participantId];
    if (!server) return;
    if (server.displayName === self.displayName && server.isHost === self.isHost) return;
    this.#patch({ self: { ...self, displayName: server.displayName, isHost: server.isHost } });
  }

  #onParticipantJoined(participant) {
    if (!participant?.participantId) return;
    if (participant.participantId === this.#state.self?.participantId) return;
    this.#patch({
      participants: {
        ...this.#state.participants,
        [participant.participantId]: { joinedAt: Date.now(), audioEnabled: true, videoEnabled: true, ...participant },
      },
    });
    this.#syncPeers();
  }

  #onParticipantLeft(participantId, reason) {
    if (!participantId) return;
    if (!this.#state.participants[participantId]) return;
    const participants = { ...this.#state.participants };
    delete participants[participantId];
    this.#peers.close(participantId);
    this.#patch({ participants, pinnedParticipantId: this.#state.pinnedParticipantId === participantId ? null : this.#state.pinnedParticipantId });
    this.#syncPeers();
    log.debug('participant left', { participantId, reason });
  }

  #onWaiting(message) {
    saveIdentity(message.roomId, {
      participantId: message.self?.participantId,
      resumeToken: message.self?.resumeToken,
      displayName: message.self?.displayName,
    });
    this.#patch({
      phase: PHASE.WAITING,
      roomId: message.roomId,
      self: {
        participantId: message.self?.participantId ?? null,
        displayName: message.self?.displayName ?? this.#intent?.displayName ?? '',
        isHost: false,
        audioEnabled: message.self?.audioEnabled !== false,
        videoEnabled: message.self?.videoEnabled !== false,
        handRaised: false,
      },
      participants: {},
      error: null,
    });
  }

  #onMediaStateChanged({ participantId, audioEnabled, videoEnabled }) {
    const participant = this.#state.participants[participantId];
    if (!participant) return;
    this.#patch({
      participants: {
        ...this.#state.participants,
        [participantId]: { ...participant, audioEnabled, videoEnabled },
      },
    });
  }

  #onScreenShareStateChanged({ participantId, sharing }) {
    const participant = this.#state.participants[participantId];
    if (participant) {
      this.#patch({
        participants: {
          ...this.#state.participants,
          [participantId]: { ...participant, sharingScreen: sharing },
        },
      });
    }
    this.#patch({
      presenterParticipantId: sharing ? participantId : null,
      screenShare: { ...this.#state.screenShare, presenting: Boolean(sharing) },
    });
    if (sharing) {
      this.#notify('PRESENTING', `${participant?.displayName ?? 'Someone'} is presenting.`, 'info');
    }
  }

  #onHandStateChanged({ participantId, raised }) {
    const participant = this.#state.participants[participantId];
    if (!participant) return;
    this.#patch({
      participants: {
        ...this.#state.participants,
        [participantId]: { ...participant, handRaised: raised },
      },
    });
  }

  #onRoomError(message) {
    const code = message?.code ?? ErrorCode.SERVER_ERROR;
    const text = message?.message ?? messageFor(code);
    log.warn('room error', { code });

    if (FATAL_JOIN_ERRORS.has(code) && this.#state.phase !== PHASE.ACTIVE && this.#state.phase !== PHASE.WAITING) {
      this.#patch({ phase: PHASE.ERROR, error: { code, message: text } });
      return;
    }
    if (this.#state.phase === PHASE.JOINING) {
      this.#patch({ phase: PHASE.ERROR, error: { code, message: text } });
      return;
    }
    this.#notify(code, text, code === ErrorCode.PRESENTER_ACTIVE || code === ErrorCode.NOT_HOST ? 'warning' : 'error');
  }

  // ------------------------------------------------------------------- chat

  #hydrateChat(entries) {
    if (!Array.isArray(entries) || !entries.length) {
      if (!this.#state.chat.length) return;
      this.#patch({ chat: [] });
      return;
    }
    const mapped = entries.map((entry) => ({
      id: entry.id,
      kind: entry.kind ?? 'chat',
      text: entry.text,
      timestamp: entry.timestamp,
    }));
    this.#patch({ chat: mapped.slice(-CHAT_LIMIT) });
  }

  #appendChat(entry) {
    if (!entry?.id) return;
    if (this.#state.chat.some((item) => item.id === entry.id)) return;
    const next = [...this.#state.chat, entry].slice(-CHAT_LIMIT);
    const panel = this.#state.panel;
    const readingChat = panel.open && panel.tab === 'chat';
    this.#patch({ chat: next, unread: readingChat ? 0 : this.#state.unread + 1 });
  }

  sendChat(text) {
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (!trimmed) return false;
    return this.#signaling.send(ClientMessage.CHAT_MESSAGE, { text: trimmed });
  }

  clearChat() {
    this.#patch({ chat: [], unread: 0 });
  }

  // ------------------------------------------------------------------ panel

  setPanel(open, tab = null) {
    this.#patch({ panel: { open: Boolean(open), tab: open ? tab : null } });
    if (open && tab === 'chat') this.#patch({ unread: 0 });
  }

  togglePanel(tab) {
    const panel = this.#state.panel;
    if (panel.open && panel.tab === tab) this.setPanel(false);
    else this.setPanel(true, tab);
  }

  setPinnedParticipant(participantId) {
    this.#patch({ pinnedParticipantId: this.#state.pinnedParticipantId === participantId ? null : participantId });
  }

  // ------------------------------------------------------------------ media

  #publishMediaState() {
    if (!this.#state.self) return;
    this.#signaling.send(ClientMessage.MEDIA_STATE_CHANGED, {
      audioEnabled: Boolean(this.#audioTrack) && this.#audioEnabled,
      videoEnabled: Boolean(this.#cameraTrack) && this.#cameraEnabled,
    });
  }

  async setMicrophone(enabled) {
    const target = Boolean(enabled) && Boolean(this.#audioTrack);
    if (!this.#audioTrack) {
      if (enabled) {
        const result = await this.#recoverDevice('audio');
        if (!result) return;
      } else {
        return;
      }
    }
    this.#audioEnabled = target;
    if (this.#audioTrack) this.#audioTrack.enabled = target;
    this.#patchMedia({ audioEnabled: target, hasAudio: Boolean(this.#audioTrack) });
    if (this.#state.self) this.#patch({ self: { ...this.#state.self, audioEnabled: target } });
    this.#publishMediaState();
  }

  toggleMicrophone() {
    return this.setMicrophone(!(this.#audioTrack && this.#audioEnabled));
  }

  async setCamera(enabled) {
    const target = Boolean(enabled) && Boolean(this.#cameraTrack);
    if (!this.#cameraTrack && enabled) {
      const result = await this.#recoverDevice('video');
      if (!result) return;
    }
    this.#cameraEnabled = target;
    if (this.#cameraTrack) this.#cameraTrack.enabled = target;
    this.#patchMedia({ videoEnabled: target, hasVideo: Boolean(this.#cameraTrack) });
    if (this.#state.self) this.#patch({ self: { ...this.#state.self, videoEnabled: target } });
    this.#publishMediaState();
  }

  toggleCamera() {
    return this.setCamera(!(this.#cameraTrack && this.#cameraEnabled));
  }

  /** Re-acquires a device that is missing (unplugged, revoked, failed start). */
  async #recoverDevice(kind) {
    try {
      const stream = await requestSingleTrack(kind, null);
      const track = kind === 'audio' ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
      if (!track) throw new Error('no track');
      if (kind === 'audio') {
        stopTrack(this.#audioTrack);
        this.#audioTrack = track;
        this.#audioEnabled = true;
        track.enabled = true;
        track.onended = () => this.#onLocalTrackEnded(track);
        this.#localStream = this.#mergeIntoLocalStream(this.#localStream, track);
        await this.#peers.setTrack('audio', track);
        this.#patchMedia({ hasAudio: true, audioEnabled: true, state: MediaState.READY, error: null });
      } else {
        const previous = this.#cameraTrack;
        this.#cameraTrack = track;
        this.#cameraEnabled = true;
        track.enabled = true;
        track.onended = () => this.#onLocalTrackEnded(track);
        this.#localStream = this.#mergeIntoLocalStream(this.#localStream, track);
        if (!this.#displayStream) {
          this.#outgoingVideoTrack = track;
          await this.#peers.setTrack('video', track);
        }
        stopTrack(previous);
        this.#patchMedia({ hasVideo: true, videoEnabled: true, state: MediaState.READY, error: null });
      }
      this.#patch({ localStream: this.#localStream, mediaRecovered: true });
      this.#publishMediaState();
      await this.refreshDevices();
      return true;
    } catch (error) {
      const described = error?.userFacing ?? { code: ErrorCode.DEVICE_UNAVAILABLE, message: messageFor(ErrorCode.DEVICE_UNAVAILABLE) };
      this.#patchMedia({ hasAudio: kind === 'audio' ? false : this.#state.media.hasAudio, hasVideo: kind === 'video' ? false : this.#state.media.hasVideo, state: MediaState.ERROR, error: described });
      this.#notify(described.code, described.message, 'error');
      return false;
    }
  }

  #mergeIntoLocalStream(stream, track) {
    if (stream && typeof stream.addTrack === 'function') {
      stream.addTrack(track);
      return stream;
    }
    const next = new MediaStream();
    if (this.#audioTrack) next.addTrack(this.#audioTrack);
    if (this.#cameraTrack) next.addTrack(this.#cameraTrack);
    next.addTrack(track);
    return next;
  }

  async switchDevice(kind, deviceId) {
    if (kind !== 'audio' && kind !== 'video') return { ok: false };
    try {
      const stream = await requestSingleTrack(kind, deviceId);
      const track = kind === 'audio' ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
      if (!track) throw new Error('no track');
      stopStream(stream.getTracks().filter((candidate) => candidate !== track));

      if (kind === 'audio') {
        const previous = this.#audioTrack;
        this.#audioTrack = track;
        this.#audioEnabled = true;
        track.enabled = true;
        track.onended = () => this.#onLocalTrackEnded(track);
        this.#localStream = this.#mergeIntoLocalStream(this.#localStream, track);
        // replaceTrack keeps every peer connection alive.
        await this.#peers.setTrack('audio', track);
        stopTrack(previous);
        this.#patchMedia({ hasAudio: true, audioEnabled: true, audioDeviceId: deviceId, state: MediaState.READY, error: null });
      } else {
        const previous = this.#cameraTrack;
        this.#cameraTrack = track;
        this.#cameraEnabled = true;
        track.enabled = true;
        track.onended = () => this.#onLocalTrackEnded(track);
        this.#localStream = this.#mergeIntoLocalStream(this.#localStream, track);
        if (!this.#displayStream) {
          this.#outgoingVideoTrack = track;
          await this.#peers.setTrack('video', track);
        }
        stopTrack(previous);
        this.#patchMedia({ hasVideo: true, videoEnabled: true, videoDeviceId: deviceId, state: MediaState.READY, error: null });
      }
      this.#patch({ localStream: this.#localStream });
      this.#publishMediaState();
      await this.refreshDevices();
      return { ok: true };
    } catch (error) {
      const described = error?.userFacing ?? { code: ErrorCode.DEVICE_UNAVAILABLE, message: messageFor(ErrorCode.DEVICE_UNAVAILABLE) };
      this.#notify(described.code, described.message, 'error');
      return { ok: false, error: described };
    }
  }

  async setOutputDevice(deviceId) {
    this.#patchMedia({ outputDeviceId: deviceId });
    if (!supports.setSinkId()) {
      this.#notify('OUTPUT_UNSUPPORTED', 'This browser cannot choose an audio output device.', 'warning');
      return { ok: false, supported: false };
    }
    for (const element of this.#audioElements.values()) {
      // eslint-disable-next-line no-await-in-loop -- a handful of elements at most
      await setSinkId(element, deviceId);
    }
    return { ok: true, supported: true };
  }

  /** Registers a remote <audio> element so output device changes apply to it. */
  registerScreenAudioElement(peerId, element) {
    if (!element) {
      this.#audioElements.delete(peerId);
      return;
    }
    this.#audioElements.set(peerId, element);
    if (supports.setSinkId() && this.#state.media.outputDeviceId && this.#state.media.outputDeviceId !== 'default') {
      void setSinkId(element, this.#state.media.outputDeviceId);
    }
  }

  #detachScreenAudio(peerId) {
    const element = this.#audioElements.get(peerId);
    if (element) {
      try {
        element.pause();
        element.srcObject = null;
      } catch {
        /* ignore */
      }
    }
    this.#audioElements.delete(peerId);
  }

  async refreshDevices() {
    const devices = await listDevices();
    this.#patchMedia({ devices });
    return devices;
  }

  // ----------------------------------------------------------- screen share

  async startScreenShare() {
    if (!supports.getDisplayMedia()) {
      this.#notify(ErrorCode.SCREEN_SHARE_FAILED, getDisplayMediaUnsupportedReason() ?? 'Screen sharing is unavailable.', 'warning');
      return { ok: false };
    }
    if (this.#displayStream) return { ok: true };

    const result = await requestDisplayMedia({ withAudio: true });
    if (result.cancelled) return { ok: false, cancelled: true };
    if (result.error) {
      this.#notify(result.error.code, result.error.message, 'error');
      return { ok: false, error: result.error };
    }

    const stream = result.stream;
    const screenTrack = stream.getVideoTracks()[0] ?? null;
    if (!screenTrack) {
      stopStream(stream);
      this.#notify(ErrorCode.SCREEN_SHARE_FAILED, 'The browser did not provide a screen to share.', 'error');
      return { ok: false };
    }

    this.#displayStream = stream;
    this.#displayAudioTrack = stream.getAudioTracks()[0] ?? null;
    this.#cameraEnabledBeforeShare = this.#cameraEnabled;

    // The browser's own "Stop sharing" control must be honoured.
    screenTrack.onended = () => {
      void this.stopScreenShare({ fromBrowser: true });
    };

    // One replaceTrack per peer connection: audio stays untouched.
    this.#outgoingVideoTrack = screenTrack;
    await this.#peers.setTrack('video', screenTrack);
    if (this.#displayAudioTrack) await this.#peers.setScreenAudioTrack(this.#displayAudioTrack);

    this.#patch({ screenShare: { ...this.#state.screenShare, sharing: true, presenting: true } });
    this.#signaling.send(ClientMessage.SCREEN_SHARE_STATE_CHANGED, { sharing: true });
    log.info('screen share started', { withAudio: Boolean(this.#displayAudioTrack) });
    return { ok: true };
  }

  async stopScreenShare({ fromBrowser = false } = {}) {
    if (!this.#displayStream) return { ok: true };
    const stream = this.#displayStream;
    this.#displayStream = null;
    for (const track of stream.getTracks()) {
      track.onended = null;
      try {
        track.stop();
      } catch {
        /* already stopped */
      }
    }
    this.#displayAudioTrack = null;

    const restoreTrack = this.#cameraEnabledBeforeShare && this.#cameraTrack ? this.#cameraTrack : null;
    this.#outgoingVideoTrack = restoreTrack;
    await this.#peers.setTrack('video', restoreTrack);
    await this.#peers.setScreenAudioTrack(null);

    this.#patch({ screenShare: { ...this.#state.screenShare, sharing: false, presenting: false } });
    if (this.#state.phase === PHASE.ACTIVE) {
      this.#signaling.send(ClientMessage.SCREEN_SHARE_STATE_CHANGED, { sharing: false });
    }
    log.info('screen share stopped', { fromBrowser });
    return { ok: true };
  }

  get isSharing() {
    return Boolean(this.#displayStream);
  }

  // ------------------------------------------------------------------- hand

  toggleHand() {
    const current = Boolean(this.#state.self?.handRaised);
    const next = !current;
    if (this.#state.self) this.#patch({ self: { ...this.#state.self, handRaised: next } });
    this.#signaling.send(ClientMessage.HAND_STATE_CHANGED, { raised: next });
    return next;
  }

  async #handleMuteRequest() {
    if (this.#audioTrack && this.#audioEnabled) {
      await this.setMicrophone(false);
      this.#notify('MUTE_REQUEST', 'The host asked you to mute your microphone.', 'warning');
    }
  }

  // -------------------------------------------------------------- host acts

  requestMute(participantId) {
    this.#signaling.send(ClientMessage.MUTE_REQUEST, { targetParticipantId: participantId });
  }

  removeParticipant(participantId) {
    this.#signaling.send(ClientMessage.REMOVE_PARTICIPANT, { targetParticipantId: participantId });
  }

  setLocked(locked) {
    this.#signaling.send(ClientMessage.LOCK_ROOM, { locked: Boolean(locked) });
  }

  setWaitingRoomEnabled(enabled) {
    this.#signaling.send(ClientMessage.SET_WAITING_ROOM, { enabled: Boolean(enabled) });
  }

  admitParticipant(participantId) {
    this.#signaling.send(ClientMessage.ADMIT_PARTICIPANT, { targetParticipantId: participantId });
  }

  denyParticipant(participantId) {
    this.#signaling.send(ClientMessage.DENY_PARTICIPANT, { targetParticipantId: participantId });
  }

  transferHost(participantId) {
    this.#signaling.send(ClientMessage.TRANSFER_HOST, { targetParticipantId: participantId });
  }

  endMeeting() {
    this.#signaling.send(ClientMessage.END_MEETING, {});
  }

  // ------------------------------------------------------------- signalling

  #sendSignal(peerId, signal) {
    if (signal.type === 'offer') {
      this.#signaling.send(ClientMessage.OFFER, { to: peerId, description: signal.description });
    } else if (signal.type === 'answer') {
      this.#signaling.send(ClientMessage.ANSWER, { to: peerId, description: signal.description });
    } else if (signal.type === 'ice-candidate') {
      this.#signaling.send(ClientMessage.ICE_CANDIDATE, { to: peerId, candidate: signal.candidate });
    }
  }

  #syncPeers() {
    const selfId = this.#state.self?.participantId;
    if (!selfId) return;
    this.#peers.sync(Object.keys(this.#state.participants).filter((id) => id !== selfId));
  }

  // ------------------------------------------------------------------ leave

  async leave({ notifyServer = true } = {}) {
    if (this.#leaving) return;
    this.#leaving = true;
    if (notifyServer) this.#signaling.send(ClientMessage.LEAVE_ROOM, {});
    this.#teardownLocalMedia();
    this.#peers.dispose();
    this.#signaling.dispose();
    const roomId = this.#state.roomId;
    if (roomId) clearIdentity(roomId);
    log.info('session left', { roomId });
    this.emit('left', { roomId });
    this.clear();
  }

  #teardownLocalMedia() {
    void this.stopScreenShare().catch(() => {});
    stopTrack(this.#audioTrack);
    stopTrack(this.#cameraTrack);
    if (this.#localStream) stopStream(this.#localStream);
    this.#audioTrack = null;
    this.#cameraTrack = null;
    this.#outgoingVideoTrack = null;
    this.#localStream = null;
    for (const peerId of [...this.#audioElements.keys()]) this.#detachScreenAudio(peerId);
    this.#patch({ localStream: null });
  }

  /**
   * Synchronous hardware release for `pagehide` / tab close, where awaiting
   * anything is pointless. Idempotent.
   */
  releaseHardware() {
    if (this.#displayStream) {
      for (const track of this.#displayStream.getTracks()) {
        track.onended = null;
        try {
          track.stop();
        } catch {
          /* already stopped */
        }
      }
      this.#displayStream = null;
      this.#displayAudioTrack = null;
    }
    stopTrack(this.#audioTrack);
    stopTrack(this.#cameraTrack);
    if (this.#localStream) stopStream(this.#localStream);
    this.#audioTrack = null;
    this.#cameraTrack = null;
    this.#outgoingVideoTrack = null;
    this.#localStream = null;
  }

  dispose() {
    void this.leave({ notifyServer: false });
  }
}

export default MeetingSession;
