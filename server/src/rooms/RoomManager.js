import { Room } from './Room.js';
import { createParticipantId, createResumeToken, createRoomId } from '../utils/ids.js';
import config from '../config.js';

const makeParticipant = ({ roomId, displayName, connectionId, socket, joinedAt }) => ({
  id: createParticipantId(),
  roomId,
  displayName,
  connectionId,
  socket,
  joinedAt,
  audioEnabled: true,
  videoEnabled: true,
  handRaised: false,
  sharingScreen: false,
  resumeToken: createResumeToken(),
});

/**
 * Owns the whole in-memory room table.
 *
 * Rooms exist only while participants are connected (plus a short grace window
 * so a refresh or a quick rejoin keeps working). There is no meeting timer and
 * no participant cap: capacity is bounded only by the host machine.
 */
export class RoomManager {
  #rooms = new Map();

  /** @type {Map<string, object>} resumeToken -> detached participant snapshot */
  #detached = new Map();

  constructor({ roomIdLength = config.roomIdLength, roomTtlMs = config.roomTtlMs, resumeTtlMs = config.resumeTtlMs } = {}) {
    this.roomIdLength = roomIdLength;
    this.roomTtlMs = roomTtlMs;
    this.resumeTtlMs = resumeTtlMs;
  }

  createRoom() {
    let id = createRoomId(this.roomIdLength);
    let attempts = 0;
    while (this.#rooms.has(id) && attempts < 8) {
      id = createRoomId(this.roomIdLength);
      attempts += 1;
    }
    const room = new Room(id);
    this.#rooms.set(id, room);
    return room;
  }

  getRoom(roomId) {
    return this.#rooms.get(roomId) ?? null;
  }

  hasRoom(roomId) {
    return this.#rooms.has(roomId);
  }

  deleteRoom(roomId) {
    return this.#rooms.delete(roomId);
  }

  get roomCount() {
    return this.#rooms.size;
  }

  stats() {
    let participants = 0;
    let waiting = 0;
    for (const room of this.#rooms.values()) {
      participants += room.participants.size;
      waiting += room.waiting.size;
    }
    return { rooms: this.#rooms.size, participants, waiting };
  }

  createParticipant({ roomId, displayName, connectionId, socket, joinedAt = Date.now() }) {
    return makeParticipant({ roomId, displayName, connectionId, socket, joinedAt });
  }

  createWaiting({ roomId, displayName, connectionId, socket, joinedAt = Date.now() }) {
    return { ...makeParticipant({ roomId, displayName, connectionId, socket, joinedAt }), waitingSince: joinedAt };
  }

  /**
   * Records a participant that dropped so the same browser tab can resume its
   * identity after a refresh or a short network drop. The token is a server
   * issued capability - the client cannot mint one.
   */
  rememberDetached(participant, roomId) {
    if (!participant?.resumeToken) return;
    this.#detached.set(participant.resumeToken, {
      roomId,
      participantId: participant.id,
      displayName: participant.displayName,
      joinedAt: participant.joinedAt,
      audioEnabled: participant.audioEnabled,
      videoEnabled: participant.videoEnabled,
      handRaised: participant.handRaised,
      sharingScreen: false,
      resumeToken: participant.resumeToken,
      expiresAt: Date.now() + this.resumeTtlMs,
    });
  }

  takeDetached(resumeToken, roomId) {
    if (typeof resumeToken !== 'string' || resumeToken.length < 16 || resumeToken.length > 128) return null;
    const record = this.#detached.get(resumeToken);
    if (!record) return null;
    if (record.expiresAt <= Date.now()) {
      this.#detached.delete(resumeToken);
      return null;
    }
    if (roomId && record.roomId !== roomId) return null;
    // One-shot: prevents two live sockets from sharing one identity.
    this.#detached.delete(resumeToken);
    return record;
  }

  /** Re-issues a resume token for a participant that is still connected. */
  refreshDetached(record) {
    if (!record) return;
    this.#detached.set(record.resumeToken, { ...record, expiresAt: Date.now() + this.resumeTtlMs });
  }

  /** Drops empty rooms past their grace window and expired resume records. */
  sweep(now = Date.now()) {
    let removedRooms = 0;
    for (const [id, room] of this.#rooms) {
      if (room.participants.size === 0) {
        if (room.emptySince === null) room.emptySince = now;
        else if (now - room.emptySince >= this.roomTtlMs) {
          this.#rooms.delete(id);
          room.chatLog.length = 0;
          removedRooms += 1;
        }
      } else {
        room.emptySince = null;
      }
    }
    for (const [token, record] of this.#detached) {
      if (record.expiresAt <= now) this.#detached.delete(token);
    }
    return { removedRooms };
  }

  clear() {
    for (const room of this.#rooms.values()) {
      for (const participant of room.participants.values()) {
        try {
          participant.socket?.close(1000, 'server shutting down');
        } catch {
          /* socket already gone */
        }
      }
      room.participants.clear();
      room.waiting.clear();
      room.chatLog.length = 0;
    }
    this.#rooms.clear();
    this.#detached.clear();
  }
}

export default RoomManager;
