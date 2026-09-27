import {
  ClientMessage,
  HOST_ONLY_TYPES,
  PRE_ROOM_TYPES,
  ServerMessage,
} from './protocol.js';
import { ErrorCode, SignalingError, toClientError, Errors } from '../utils/errors.js';
import {
  isIceCandidate,
  isPlainObject,
  isSessionDescription,
  normalizeDisplayName,
  normalizeRoomId,
  sanitizeText,
} from '../utils/validate.js';
import { createMessageId } from '../utils/ids.js';
import config from '../config.js';

export const CLOSE_CODE = {
  MEETING_ENDED: 4002,
  REMOVED: 4001,
  DENIED: 4003,
  RATE_LIMITED: 4008,
};

/**
 * All signaling business logic, free of transport concerns: every socket
 * read/write goes through the helpers below, which keeps the protocol fully
 * testable without a browser.
 */
export class SignalingHandlers {
  #roomManager;

  #log;

  constructor({ roomManager, logger }) {
    this.#roomManager = roomManager;
    this.#log = logger;
  }

  // ---------------------------------------------------------------- helpers

  send(socket, type, payload) {
    if (!socket || socket.readyState !== 1) return false;
    try {
      socket.send(JSON.stringify({ type, ...payload }));
      return true;
    } catch (error) {
      this.#log.debug('send failed', { type, error: error.message });
      return false;
    }
  }

  sendError(ctx, error) {
    const { code, message } = toClientError(error);
    this.#log.debug('room-error', { code, connectionId: ctx.connectionId, type: ctx.currentType });
    this.send(ctx.socket, ServerMessage.ROOM_ERROR, { code, message });
  }

  broadcast(room, type, payload, { excludeConnectionId = null } = {}) {
    for (const participant of room.participants.values()) {
      if (excludeConnectionId && participant.connectionId === excludeConnectionId) continue;
      this.send(participant.socket, type, payload);
    }
  }

  broadcastToHost(room, type, payload) {
    if (!room.hostParticipantId) return;
    const host = room.getParticipant(room.hostParticipantId);
    if (host) this.send(host.socket, type, payload);
  }

  systemNotice(room, kind, text) {
    const entry = { id: createMessageId(), kind, text, timestamp: Date.now() };
    room.appendChat(entry);
    this.broadcast(room, ServerMessage.CHAT_SYSTEM, { message: entry });
    return entry;
  }

  /** Push authoritative state to everyone still inside the room. */
  syncRoom(room, reason) {
    this.#log.debug('room sync', { roomId: room.id, reason, participants: room.size });
    this.broadcast(room, ServerMessage.ROOM_STATE, { room: room.snapshot() });
  }

  // ------------------------------------------------------------- entrypoint

  handleMessage(ctx, type, payload) {
    if (typeof type !== 'string' || type.length > 64) {
      ctx.currentType = 'unknown';
      this.sendError(ctx, Errors.invalidMessage());
      return;
    }
    ctx.currentType = type;

    if (payload !== undefined && !isPlainObject(payload)) {
      this.sendError(ctx, Errors.invalidMessage());
      return;
    }

    const method = this[`handle_${type.replace(/-/g, '_')}`];
    if (typeof method !== 'function') {
      this.sendError(ctx, Errors.invalidMessage());
      return;
    }

    if (!ctx.roomId && !PRE_ROOM_TYPES.has(type)) {
      this.sendError(ctx, Errors.notInRoom());
      return;
    }
    if (HOST_ONLY_TYPES.has(type)) {
      try {
        this.assertHost(ctx);
      } catch (error) {
        this.sendError(ctx, error);
        return;
      }
    }

    try {
      method.call(this, ctx, payload ?? {});
    } catch (error) {
      if (!(error instanceof SignalingError)) {
        this.#log.error('unhandled signaling error', { type, error: error.message });
      }
      this.sendError(ctx, error);
    }
  }

  // ------------------------------------------------------------- validation

  requireParticipant(ctx) {
    const room = this.#roomManager.getRoom(ctx.roomId);
    if (!room) throw Errors.notInRoom();
    const participant = room.getParticipant(ctx.participantId);
    if (!participant) throw Errors.notInRoom();
    return { room, participant };
  }

  assertHost(ctx) {
    const { room, participant } = this.requireParticipant(ctx);
    if (room.hostParticipantId !== participant.id) throw Errors.notHost();
    return { room, participant };
  }

  readDisplayName(payload) {
    const name = normalizeDisplayName(payload?.displayName, {
      min: config.minNameLength,
      max: config.maxNameLength,
    });
    if (!name.ok) throw Errors.invalidDisplayName();
    return name.value;
  }

  readRoomId(payload) {
    const roomId = normalizeRoomId(payload?.roomId, config.roomIdLength);
    if (!roomId) throw Errors.invalidRoomId();
    return roomId;
  }

  readTarget(ctx, payload) {
    const { room, participant } = this.requireParticipant(ctx);
    const targetId = typeof payload?.targetParticipantId === 'string' ? payload.targetParticipantId : '';
    if (!targetId || targetId.length > 64) throw Errors.invalidParticipant();
    const target = room.getParticipant(targetId);
    if (!target) throw Errors.invalidParticipant();
    if (target.id === participant.id) throw Errors.invalidParticipant();
    return { room, participant, target };
  }

  readWaiting(ctx, payload) {
    const { room, participant } = this.assertHost(ctx);
    const targetId = typeof payload?.targetParticipantId === 'string' ? payload.targetParticipantId : '';
    const target = targetId ? room.getWaiting(targetId) : null;
    if (!target) throw Errors.invalidParticipant();
    return { room, participant, target };
  }

  // ------------------------------------------------------------ room create

  handle_create_room(ctx, payload) {
    if (ctx.roomId) throw Errors.alreadyInRoom();
    const displayName = this.readDisplayName(payload);
    const room = this.#roomManager.createRoom();
    const participant = this.#roomManager.createParticipant({
      roomId: room.id,
      displayName,
      connectionId: ctx.connectionId,
      socket: ctx.socket,
    });
    room.addParticipant(participant);
    room.hostParticipantId = participant.id;

    this.#activateContext(ctx, room, participant);

    this.#log.info('room created', { roomId: room.id, participantId: participant.id, size: room.size });
    this.send(ctx.socket, ServerMessage.ROOM_CREATED, {
      room: room.snapshot(),
      self: this.selfPayload(room, participant),
      chat: room.recentChat(),
    });
  }

  #activateContext(ctx, room, participant) {
    ctx.roomId = room.id;
    ctx.participantId = participant.id;
    ctx.status = 'active';
    ctx.isHost = room.hostParticipantId === participant.id;
    ctx.joinedAt = participant.joinedAt;
  }

  selfPayload(room, participant) {
    return {
      participantId: participant.id,
      displayName: participant.displayName,
      isHost: room.hostParticipantId === participant.id,
      joinedAt: participant.joinedAt,
      audioEnabled: participant.audioEnabled,
      videoEnabled: participant.videoEnabled,
      handRaised: participant.handRaised,
      // Server-issued capability used to resume this identity after a refresh
      // or a short network drop. Clients can never mint one themselves.
      resumeToken: participant.resumeToken,
    };
  }

  // -------------------------------------------------------------- room join

  handle_join_room(ctx, payload) {
    if (ctx.roomId) throw Errors.alreadyInRoom();
    const displayName = this.readDisplayName(payload);
    const roomId = this.readRoomId(payload);
    const room = this.#roomManager.getRoom(roomId);
    if (!room) {
      this.#log.info('join rejected (unknown room)', { roomId, connectionId: ctx.connectionId });
      throw Errors.roomNotFound();
    }
    if (room.locked) {
      this.#log.info('join rejected (locked)', { roomId, connectionId: ctx.connectionId });
      throw Errors.roomLocked();
    }

    const detached = payload?.resumeToken ? this.#roomManager.takeDetached(payload.resumeToken, roomId) : null;

    if (room.waitingRoomEnabled) {
      this.#addToWaitingRoom(ctx, room, { displayName, detached });
      return;
    }

    this.#admitIntoRoom(ctx, room, {
      displayName,
      detached,
      joinedAt: detached?.joinedAt ?? Date.now(),
      responseType: ServerMessage.ROOM_JOINED,
    });
  }

  #addToWaitingRoom(ctx, room, { displayName, detached }) {
    const now = Date.now();
    const waiting = this.#roomManager.createWaiting({
      roomId: room.id,
      displayName,
      connectionId: ctx.connectionId,
      socket: ctx.socket,
      joinedAt: detached?.joinedAt ?? now,
    });
    if (detached) {
      if (detached.participantId && !room.hasParticipant(detached.participantId)) {
        waiting.id = detached.participantId;
      }
      waiting.audioEnabled = detached.audioEnabled !== false;
      waiting.videoEnabled = detached.videoEnabled !== false;
      if (detached.resumeToken) waiting.resumeToken = detached.resumeToken;
    }
    waiting.ctx = ctx;
    room.addWaiting(waiting);

    ctx.roomId = room.id;
    ctx.participantId = waiting.id;
    ctx.status = 'waiting';
    ctx.isHost = false;
    ctx.joinedAt = waiting.joinedAt;

    this.#log.info('waiting room add', { roomId: room.id, participantId: waiting.id });
    this.send(ctx.socket, ServerMessage.WAITING_ROOM_STATE, {
      roomId: room.id,
      status: 'waiting',
      self: {
        participantId: waiting.id,
        displayName: waiting.displayName,
        audioEnabled: waiting.audioEnabled,
        videoEnabled: waiting.videoEnabled,
        resumeToken: waiting.resumeToken,
      },
    });
    // Only the room side sees the queue - a waiting client never gets room state.
    this.broadcastToHost(room, ServerMessage.WAITING_ROOM_UPDATED, { roomId: room.id, waiting: room.listWaiting() });
  }

  /** Places a connection into the active participant list of `room`. */
  #admitIntoRoom(ctx, room, { displayName, detached, joinedAt, responseType }) {
    const participant = this.#roomManager.createParticipant({
      roomId: room.id,
      displayName,
      connectionId: ctx.connectionId,
      socket: ctx.socket,
      joinedAt,
    });
    // Defensive: never let a resumed identity collide with a live participant.
    if (detached?.participantId && !room.hasParticipant(detached.participantId)) {
      participant.id = detached.participantId;
    }
    if (detached) {
      participant.audioEnabled = detached.audioEnabled !== false;
      participant.videoEnabled = detached.videoEnabled !== false;
      participant.handRaised = Boolean(detached.handRaised);
      if (detached.resumeToken) participant.resumeToken = detached.resumeToken;
    }

    room.addParticipant(participant);
    room.electHost();
    this.#activateContext(ctx, room, participant);

    this.#log.info('participant joined', {
      roomId: room.id,
      participantId: participant.id,
      size: room.size,
      resumed: Boolean(detached),
    });

    this.send(ctx.socket, responseType, {
      room: room.snapshot(),
      self: this.selfPayload(room, participant),
      chat: room.recentChat(),
    });
    this.broadcast(
      room,
      ServerMessage.PARTICIPANT_JOINED,
      { participant: room.publicParticipant(participant) },
      { excludeConnectionId: ctx.connectionId },
    );
    this.systemNotice(room, 'join', `${participant.displayName} joined the meeting`);
    this.syncRoom(room, 'join');
  }

  // -------------------------------------------------------------- leave/room

  handle_leave_room(ctx) {
    this.removeConnection(ctx, { reason: 'left' });
    this.closeSocket(ctx, 1000, 'left meeting');
  }

  handle_ping(ctx) {
    this.send(ctx.socket, ServerMessage.PONG, { timestamp: Date.now() });
  }

  closeSocket(ctx, code, reason) {
    try {
      ctx.socket.close(code, reason);
    } catch {
      /* already closing */
    }
  }

  /**
   * Detaches a connection from whatever it belonged to and tells the room.
   * Idempotent: safe to call from the message handler and from socket close.
   */
  removeConnection(ctx, { reason = 'closed' } = {}) {
    const previousStatus = ctx.status;
    const roomId = ctx.roomId;
    const participantId = ctx.participantId;

    ctx.status = 'closed';
    ctx.roomId = null;
    ctx.participantId = null;
    ctx.isHost = false;

    if (!roomId || !participantId) return null;
    const room = this.#roomManager.getRoom(roomId);
    if (!room) return null;

    if (previousStatus === 'waiting' || room.getWaiting(participantId)) {
      const waiting = room.removeWaiting(participantId);
      if (waiting) {
        this.#roomManager.rememberDetached(waiting, room.id);
        this.#log.info('waiting participant left', { roomId: room.id, participantId, reason });
        this.broadcastToHost(room, ServerMessage.WAITING_ROOM_UPDATED, {
          roomId: room.id,
          waiting: room.listWaiting(),
        });
      }
    } else {
      const participant = room.removeParticipant(participantId);
      if (participant) {
        this.#roomManager.rememberDetached(participant, room.id);
        this.#log.info('participant left', {
          roomId: room.id,
          participantId,
          reason,
          remaining: room.size,
        });
        this.broadcast(room, ServerMessage.PARTICIPANT_LEFT, { participantId, reason });
        this.systemNotice(room, 'leave', `${participant.displayName} left the meeting`);
      }
    }

    const previousHost = room.hostParticipantId;
    room.electHost();
    if (room.hostParticipantId && room.hostParticipantId !== previousHost) {
      const host = room.getParticipant(room.hostParticipantId);
      this.systemNotice(room, 'host', `${host ? host.displayName : 'A participant'} is now the meeting host`);
    }

    room.touch();
    if (room.participants.size === 0) room.emptySince = Date.now();
    this.syncRoom(room, `leave:${reason}`);
    return room;
  }

  // ---------------------------------------------------------------- WebRTC

  handle_offer(ctx, payload) {
    this.#relay(ctx, payload, 'description', isSessionDescription, ServerMessage.OFFER);
  }

  handle_answer(ctx, payload) {
    this.#relay(ctx, payload, 'description', isSessionDescription, ServerMessage.ANSWER);
  }

  handle_ice_candidate(ctx, payload) {
    this.#relay(ctx, payload, 'candidate', isIceCandidate, ServerMessage.ICE_CANDIDATE);
  }

  #relay(ctx, payload, field, validate, outboundType) {
    const { room, participant } = this.requireParticipant(ctx);
    const targetId = typeof payload?.to === 'string' ? payload.to : '';
    if (!targetId || targetId.length > 64) throw Errors.invalidParticipant();
    const target = room.getParticipant(targetId);
    if (!target) throw Errors.invalidParticipant();
    if (target.id === participant.id) throw Errors.invalidParticipant();
    if (!validate(payload?.[field])) throw Errors.invalidMessage();

    this.send(target.socket, outboundType, {
      from: participant.id,
      roomId: room.id,
      [field]: payload[field],
    });
  }

  // ---------------------------------------------------- participant state

  handle_media_state_changed(ctx, payload) {
    const { room, participant } = this.requireParticipant(ctx);
    const { audioEnabled, videoEnabled } = payload ?? {};
    if (typeof audioEnabled !== 'boolean' || typeof videoEnabled !== 'boolean') {
      throw Errors.invalidMessage();
    }
    if (participant.audioEnabled === audioEnabled && participant.videoEnabled === videoEnabled) return;
    participant.audioEnabled = audioEnabled;
    participant.videoEnabled = videoEnabled;
    this.broadcast(
      room,
      ServerMessage.MEDIA_STATE_CHANGED,
      { participantId: participant.id, audioEnabled, videoEnabled },
      { excludeConnectionId: ctx.connectionId },
    );
  }

  handle_screen_share_state_changed(ctx, payload) {
    const { room, participant } = this.requireParticipant(ctx);
    const sharing = payload?.sharing;
    if (typeof sharing !== 'boolean') throw Errors.invalidMessage();

    if (sharing) {
      const presenterId = room.presenterParticipantId;
      if (presenterId && presenterId !== participant.id) {
        throw Errors.presenterActive(room.getParticipant(presenterId)?.displayName);
      }
    }
    if (participant.sharingScreen === sharing) return;

    participant.sharingScreen = sharing;
    this.#log.info('screen share state', { roomId: room.id, participantId: participant.id, sharing });
    this.broadcast(
      room,
      ServerMessage.SCREEN_SHARE_STATE_CHANGED,
      { participantId: participant.id, sharing },
      { excludeConnectionId: ctx.connectionId },
    );
  }

  handle_hand_state_changed(ctx, payload) {
    const { room, participant } = this.requireParticipant(ctx);
    const raised = payload?.raised;
    if (typeof raised !== 'boolean') throw Errors.invalidMessage();
    if (participant.handRaised === raised) return;
    participant.handRaised = raised;
    this.broadcast(
      room,
      ServerMessage.HAND_STATE_CHANGED,
      { participantId: participant.id, raised },
      { excludeConnectionId: ctx.connectionId },
    );
  }

  // ------------------------------------------------------------------ chat

  handle_chat_message(ctx, payload) {
    const { room, participant } = this.requireParticipant(ctx);
    const text = sanitizeText(payload?.text, { maxLength: config.chatMaxLength, allowNewlines: true });
    if (!text) throw Errors.invalidMessage();

    const message = {
      id: createMessageId(),
      roomId: room.id,
      senderParticipantId: participant.id,
      senderDisplayName: participant.displayName,
      text,
      timestamp: Date.now(),
    };
    room.appendChat({
      id: message.id,
      kind: 'chat',
      text: `${participant.displayName}: ${text}`,
      timestamp: message.timestamp,
    });
    this.broadcast(room, ServerMessage.CHAT_MESSAGE, { message });
  }

  // ---------------------------------------------------------- host controls

  handle_mute_request(ctx, payload) {
    const { target } = this.readTarget(ctx, payload);
    this.#log.info('host requested mute', { roomId: ctx.roomId, by: ctx.participantId, target: target.id });
    this.send(target.socket, ServerMessage.MUTE_REQUEST, { byParticipantId: ctx.participantId });
  }

  handle_remove_participant(ctx, payload) {
    const { room, participant, target } = this.readTarget(ctx, payload);
    if (room.hostParticipantId === target.id) {
      throw new SignalingError(
        ErrorCode.INVALID_PARTICIPANT,
        'The host cannot be removed. Transfer the host role or leave the meeting first.',
      );
    }
    room.removeParticipant(target.id);
    this.#roomManager.rememberDetached(target, room.id);
    this.send(target.socket, ServerMessage.PARTICIPANT_REMOVED, {
      reason: 'removed-by-host',
      byDisplayName: participant.displayName,
    });
    this.closeSocket(
      { socket: target.socket },
      CLOSE_CODE.REMOVED,
      'removed by host',
    );
    this.broadcast(room, ServerMessage.PARTICIPANT_LEFT, { participantId: target.id, reason: 'removed' });
    this.systemNotice(room, 'moderation', `${target.displayName} was removed by the host`);
    room.touch();
    this.syncRoom(room, 'remove-participant');
    this.#log.info('participant removed by host', { roomId: room.id, participantId: target.id });
  }

  handle_lock_room(ctx, payload) {
    const { room } = this.assertHost(ctx);
    const locked = payload?.locked;
    if (typeof locked !== 'boolean') throw Errors.invalidMessage();
    room.locked = locked;
    this.#log.info('room lock changed', { roomId: room.id, locked });
    this.broadcast(room, ServerMessage.ROOM_SETTINGS_CHANGED, {
      roomId: room.id,
      locked: room.locked,
      waitingRoomEnabled: room.waitingRoomEnabled,
    });
    this.syncRoom(room, 'lock');
  }

  handle_set_waiting_room(ctx, payload) {
    const { room } = this.assertHost(ctx);
    const enabled = payload?.enabled;
    if (typeof enabled !== 'boolean') throw Errors.invalidMessage();
    room.waitingRoomEnabled = enabled;
    this.#log.info('waiting room changed', { roomId: room.id, enabled });
    this.broadcast(room, ServerMessage.ROOM_SETTINGS_CHANGED, {
      roomId: room.id,
      locked: room.locked,
      waitingRoomEnabled: room.waitingRoomEnabled,
    });
    this.broadcastToHost(room, ServerMessage.WAITING_ROOM_UPDATED, {
      roomId: room.id,
      waiting: room.listWaiting(),
    });
    this.syncRoom(room, 'waiting-room');
  }

  handle_admit_participant(ctx, payload) {
    const { room, target } = this.readWaiting(ctx, payload);
    if (room.locked) throw Errors.roomLocked();

    room.removeWaiting(target.id);
    this.#log.info('admitted from waiting room', { roomId: room.id, participantId: target.id });

    const admitted = {
      id: target.id,
      roomId: room.id,
      displayName: target.displayName,
      connectionId: target.connectionId,
      socket: target.socket,
      joinedAt: target.joinedAt,
      audioEnabled: target.audioEnabled,
      videoEnabled: target.videoEnabled,
      handRaised: false,
      sharingScreen: false,
      resumeToken: target.resumeToken,
      ctx: target.ctx,
    };
    room.addParticipant(admitted);
    room.electHost();

    // The waiting socket's own context has to be promoted to active as well.
    if (admitted.ctx) this.#activateContext(admitted.ctx, room, admitted);

    this.send(target.socket, ServerMessage.ROOM_JOINED, {
      room: room.snapshot(),
      self: this.selfPayload(room, admitted),
      chat: room.recentChat(),
    });
    this.broadcast(
      room,
      ServerMessage.PARTICIPANT_JOINED,
      { participant: room.publicParticipant(admitted) },
      { excludeConnectionId: admitted.connectionId },
    );
    this.systemNotice(room, 'join', `${admitted.displayName} joined the meeting`);
    this.broadcastToHost(room, ServerMessage.WAITING_ROOM_UPDATED, {
      roomId: room.id,
      waiting: room.listWaiting(),
    });
    this.syncRoom(room, 'admit');
  }

  handle_deny_participant(ctx, payload) {
    const { room, participant, target } = this.readWaiting(ctx, payload);
    room.removeWaiting(target.id);
    this.#roomManager.rememberDetached(target, room.id);
    this.send(target.socket, ServerMessage.WAITING_ROOM_DENIED, {
      byDisplayName: participant.displayName,
    });
    this.closeSocket({ socket: target.socket }, CLOSE_CODE.DENIED, 'not admitted');
    this.broadcastToHost(room, ServerMessage.WAITING_ROOM_UPDATED, {
      roomId: room.id,
      waiting: room.listWaiting(),
    });
    this.#log.info('waiting participant denied', { roomId: room.id, participantId: target.id });
  }

  handle_end_meeting(ctx, payload) {
    const { room } = this.assertHost(ctx);
    this.#log.info('meeting ended by host', { roomId: room.id });
    for (const participant of room.participants.values()) {
      this.send(participant.socket, ServerMessage.MEETING_ENDED, { reason: 'host-ended' });
      this.#roomManager.rememberDetached(participant, room.id);
      this.closeSocket({ socket: participant.socket }, CLOSE_CODE.MEETING_ENDED, 'meeting ended');
    }
    for (const waiting of room.waiting.values()) {
      this.send(waiting.socket, ServerMessage.MEETING_ENDED, { reason: 'host-ended' });
      this.closeSocket({ socket: waiting.socket }, CLOSE_CODE.MEETING_ENDED, 'meeting ended');
    }
    room.participants.clear();
    room.waiting.clear();
    room.chatLog.length = 0;
    this.#roomManager.deleteRoom(room.id);
  }

  handle_transfer_host(ctx, payload) {
    const { room, target } = this.readTarget(ctx, payload);
    room.hostParticipantId = target.id;
    this.systemNotice(room, 'host', `${target.displayName} is now the meeting host`);
    this.broadcast(room, ServerMessage.HOST_CHANGED, { hostParticipantId: target.id });
    this.syncRoom(room, 'transfer-host');
    this.#log.info('host transferred', { roomId: room.id, hostParticipantId: target.id });
  }

  /** Unknown-but-well-formed types never reach here; kept for completeness. */
  handle_unknown(ctx) {
    this.sendError(ctx, Errors.invalidMessage());
  }
}

export { ClientMessage };
export default SignalingHandlers;
