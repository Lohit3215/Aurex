/**
 * In-memory meeting room state.
 *
 * A room holds only metadata: participant identity, media toggles and the
 * host. No audio, video or chat history is persisted here beyond the small
 * per-room chat buffer used to re-hydrate a reconnecting client.
 */
export class Room {
  constructor(id, createdAt = Date.now()) {
    this.id = id;
    this.createdAt = createdAt;
    this.updatedAt = createdAt;
    this.hostParticipantId = null;
    this.locked = false;
    this.waitingRoomEnabled = false;
    /** @type {Map<string, object>} participantId -> participant record */
    this.participants = new Map();
    /** @type {Map<string, object>} participantId -> waiting record */
    this.waiting = new Map();
    /** Small rolling buffer so a client that reconnects does not lose context. */
    this.chatLog = [];
    this.emptySince = null;
    this.lastActivityAt = createdAt;
  }

  get size() {
    return this.participants.size;
  }

  get isEmpty() {
    return this.participants.size === 0;
  }

  get presenterParticipantId() {
    for (const participant of this.participants.values()) {
      if (participant.sharingScreen) return participant.id;
    }
    return null;
  }

  touch(now = Date.now()) {
    this.updatedAt = now;
    this.lastActivityAt = now;
  }

  publicParticipant(participant) {
    return {
      participantId: participant.id,
      displayName: participant.displayName,
      joinedAt: participant.joinedAt,
      audioEnabled: participant.audioEnabled,
      videoEnabled: participant.videoEnabled,
      handRaised: participant.handRaised,
      sharingScreen: participant.sharingScreen,
      isHost: participant.id === this.hostParticipantId,
    };
  }

  publicWaiting(waiting) {
    return {
      participantId: waiting.id,
      displayName: waiting.displayName,
      waitingSince: waiting.joinedAt,
    };
  }

  /** Ordered by join time, then by id, so every client renders the same order. */
  listParticipants() {
    return [...this.participants.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((participant) => this.publicParticipant(participant));
  }

  listWaiting() {
    return [...this.waiting.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((waiting) => this.publicWaiting(waiting));
  }

  /**
   * Full synchronised state. Only ever sent to participants that are actually
   * inside the room.
   */
  snapshot() {
    return {
      roomId: this.id,
      createdAt: this.createdAt,
      hostParticipantId: this.hostParticipantId,
      locked: this.locked,
      waitingRoomEnabled: this.waitingRoomEnabled,
      presenterParticipantId: this.presenterParticipantId,
      participants: this.listParticipants(),
      waiting: this.listWaiting(),
    };
  }

  getParticipant(participantId) {
    return this.participants.get(participantId) ?? null;
  }

  getWaiting(participantId) {
    return this.waiting.get(participantId) ?? null;
  }

  hasParticipant(participantId) {
    return this.participants.has(participantId);
  }

  hasConnection(connectionId) {
    for (const participant of this.participants.values()) {
      if (participant.connectionId === connectionId) return participant;
    }
    for (const waiting of this.waiting.values()) {
      if (waiting.connectionId === connectionId) return waiting;
    }
    return null;
  }

  addParticipant(participant, now = Date.now()) {
    this.participants.set(participant.id, participant);
    this.touch(now);
    this.emptySince = null;
    return participant;
  }

  addWaiting(waiting, now = Date.now()) {
    this.waiting.set(waiting.id, waiting);
    this.touch(now);
    return waiting;
  }

  removeParticipant(participantId) {
    const participant = this.participants.get(participantId) ?? null;
    this.participants.delete(participantId);
    if (participant && this.hostParticipantId === participantId) this.hostParticipantId = null;
    return participant;
  }

  removeWaiting(participantId) {
    const waiting = this.waiting.get(participantId) ?? null;
    this.waiting.delete(participantId);
    return waiting;
  }

  /**
   * Deterministic host succession: earliest joined participant still in the
   * room wins. Ties break on participant id so every replica agrees.
   */
  electHost() {
    if (this.participants.has(this.hostParticipantId)) return this.hostParticipantId;
    const candidates = [...this.participants.values()].sort(
      (a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    this.hostParticipantId = candidates.length ? candidates[0].id : null;
    return this.hostParticipantId;
  }

  appendChat(entry) {
    this.chatLog.push(entry);
    if (this.chatLog.length > 200) this.chatLog.splice(0, this.chatLog.length - 200);
  }

  recentChat(limit = 50) {
    return this.chatLog.slice(-limit);
  }
}

export default Room;
