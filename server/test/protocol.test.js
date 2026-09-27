import test from 'node:test';
import assert from 'node:assert/strict';

import { createServer } from '../src/server.js';
import { ClientMessage, ServerMessage } from '../src/signaling/protocol.js';
import { createLogger, setLogLevel } from '../src/utils/logger.js';
import { RoomManager } from '../src/rooms/RoomManager.js';
import { Room } from '../src/rooms/Room.js';
import { normalizeRoomId, sanitizeText, normalizeDisplayName } from '../src/utils/validate.js';
import config from '../src/config.js';

setLogLevel('error');

/**
 * Minimal protocol client: lets the tests read exactly the messages they care
 * about without racing on timing.
 */
class TestClient {
  constructor(ws) {
    this.ws = ws;
    this.messages = [];
    this.waiters = [];
    ws.on('message', (raw) => {
      const parsed = JSON.parse(raw.toString('utf8'));
      this.messages.push(parsed);
      for (const waiter of [...this.waiters]) {
        if (waiter.predicate(parsed)) {
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          clearTimeout(waiter.timer);
          waiter.resolve(parsed);
        }
      }
    });
  }

  static async connect(port) {
    const { WebSocket } = await import('ws');
    const ws = new WebSocket(`ws://127.0.0.1:${port}${config.wsPath}`);
    // Attach listeners before waiting for `open` so the welcome frame that the
    // server sends immediately after the handshake is never missed.
    const client = new TestClient(ws);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    await client.waitFor((m) => m.type === ServerMessage.WELCOME);
    return client;
  }

  send(type, payload = {}) {
    this.ws.send(JSON.stringify({ type, ...payload }));
  }

  sendRaw(raw) {
    this.ws.send(raw);
  }

  waitFor(predicate, timeoutMs = 2000) {
    const existing = this.messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve };
      waiter.timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error('timed out waiting for message'));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  received(type) {
    return this.messages.filter((m) => m.type === type);
  }

  waitForClose(timeoutMs = 3000) {
    if (this.ws.readyState === this.ws.CLOSED) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.ws.removeListener('close', onClose);
        reject(new Error('timed out waiting for socket close'));
      }, timeoutMs);
      const onClose = () => {
        clearTimeout(timer);
        resolve();
      };
      this.ws.once('close', onClose);
    });
  }

  clear() {
    this.messages = [];
  }

  close() {
    return new Promise((resolve) => {
      if (this.ws.readyState === this.ws.CLOSED) return resolve();
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }
}

let ctx;

test.before(async () => {
  const port = 4900 + Math.floor(Math.random() * 90);
  const server = createServer({ roomManager: new RoomManager() });
  await new Promise((resolve) => server.httpServer.listen(port, '127.0.0.1', resolve));
  ctx = { port, server, url: `http://127.0.0.1:${port}` };
});

test.after(async () => {
  await ctx.server.signaling.close();
  await new Promise((resolve) => ctx.server.httpServer.close(resolve));
});

const connect = () => TestClient.connect(ctx.port);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --------------------------------------------------------------------- units

test('normalizeRoomId accepts ids, links and rejects junk', () => {
  const id = 'abc234jkmnpq';
  assert.equal(normalizeRoomId(id, 12), id);
  assert.equal(normalizeRoomId(`http://localhost:5173/meeting/${id}`, 12), id);
  assert.equal(normalizeRoomId(`https://meet.example.com/meeting/${id}?x=1#y`, 12), id);
  assert.equal(normalizeRoomId(`/meeting/${id}`, 12), id);
  assert.equal(normalizeRoomId(`https://a.b/join?room=${id}`, 12), id);
  assert.equal(normalizeRoomId(`ABC 234-JKMNPQ`, 12), id);
  assert.equal(normalizeRoomId('too-short', 12), null);
  assert.equal(normalizeRoomId(`${id}extra`, 12), null);
  assert.equal(normalizeRoomId('', 12), null);
  assert.equal(normalizeRoomId(null, 12), null);
  assert.equal(normalizeRoomId('../../etc/passwd', 12), null);
});

test('display names are collapsed and length checked', () => {
  assert.deepEqual(normalizeDisplayName('  Ada   Lovelace ', { min: 2, max: 48 }), {
    ok: true,
    value: 'Ada Lovelace',
  });
  assert.equal(normalizeDisplayName('  ', { min: 2, max: 48 }).ok, false);
  assert.equal(normalizeDisplayName('x', { min: 2, max: 48 }).ok, false);
  assert.equal(normalizeDisplayName('a'.repeat(49), { min: 2, max: 48 }).ok, false);
  assert.equal(normalizeDisplayName('a'.repeat(48), { min: 2, max: 48 }).ok, true);
});

test('chat text is stripped of control characters and truncated', () => {
  assert.equal(sanitizeText('  hello\u0000\u0007 world  ', { maxLength: 100 }), 'hello world');
  assert.equal(sanitizeText('line1\nline2', { maxLength: 100 }), 'line1 line2'.replace(' ', '\n'));
  assert.equal(sanitizeText('abc', { maxLength: 2 }), 'ab');
});

test('room elects the earliest participant as host', () => {
  const room = new Room('r');
  room.addParticipant({ id: 'b', joinedAt: 20, displayName: 'B' });
  room.addParticipant({ id: 'a', joinedAt: 10, displayName: 'A' });
  room.addParticipant({ id: 'c', joinedAt: 5, displayName: 'C' });
  assert.equal(room.electHost(), 'c');
  room.hostParticipantId = 'c';
  room.removeParticipant('c');
  assert.equal(room.electHost(), 'a');
});

test('health endpoint reports signaling state', async () => {
  const response = await fetch(`${ctx.url}/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'aurex-meet-signaling');
  assert.equal(typeof body.rooms, 'number');
});

// ----------------------------------------------------------------- protocol

test('create-room: host joins an empty room and gets a shareable id', async () => {
  const host = await connect();
  host.send(ClientMessage.CREATE_ROOM, { displayName: 'Ada' });
  const created = await host.waitFor((m) => m.type === ServerMessage.ROOM_CREATED);

  assert.equal(created.room.hostParticipantId, created.self.participantId);
  assert.equal(created.self.isHost, true);
  assert.equal(created.self.displayName, 'Ada');
  assert.equal(created.room.participants.length, 1);
  assert.equal(created.room.locked, false);
  assert.equal(created.room.waitingRoomEnabled, false);
  assert.match(created.room.roomId, /^[a-z2-9]{12}$/);
  assert.ok(created.self.resumeToken.length > 20);
  await host.close();
});

test('join-room: broadcasts presence, media state and system notices', async () => {
  const host = await connect();
  host.send(ClientMessage.CREATE_ROOM, { displayName: 'Ada' });
  const created = await host.waitFor((m) => m.type === ServerMessage.ROOM_CREATED);

  const guest = await connect();
  guest.send(ClientMessage.JOIN_ROOM, { roomId: created.room.roomId, displayName: 'Grace' });
  const joined = await guest.waitFor((m) => m.type === ServerMessage.ROOM_JOINED);

  assert.equal(joined.room.participants.length, 2);
  assert.equal(joined.self.isHost, false);
  assert.equal(joined.room.hostParticipantId, created.self.participantId);

  const presence = await host.waitFor((m) => m.type === ServerMessage.PARTICIPANT_JOINED);
  assert.equal(presence.participant.displayName, 'Grace');
  assert.equal(presence.participant.isHost, false);
  await host.waitFor((m) => m.type === ServerMessage.CHAT_SYSTEM && m.message.kind === 'join');
  const state = await host.waitFor((m) => m.type === ServerMessage.ROOM_STATE);
  assert.equal(state.room.participants.length, 2);

  const left = { host, guest, roomId: created.room.roomId };
  await guest.send(ClientMessage.MEDIA_STATE_CHANGED, { audioEnabled: false, videoEnabled: true });
  const media = await host.waitFor((m) => m.type === ServerMessage.MEDIA_STATE_CHANGED);
  assert.equal(media.participantId, joined.self.participantId);
  assert.equal(media.audioEnabled, false);

  await guest.send(ClientMessage.HAND_STATE_CHANGED, { raised: true });
  const hand = await host.waitFor((m) => m.type === ServerMessage.HAND_STATE_CHANGED);
  assert.equal(hand.raised, true);
  assert.equal(hand.participantId, joined.self.participantId);

  // The sender never receives its own echo.
  assert.equal(guest.received(ServerMessage.MEDIA_STATE_CHANGED).length, 0);

  await guest.close();
  const gone = await host.waitFor((m) => m.type === ServerMessage.PARTICIPANT_LEFT);
  assert.equal(gone.participantId, joined.self.participantId);
  assert.equal(left.roomId, created.room.roomId);
  await host.close();
});

test('join-room: unknown room, invalid id and invalid name are rejected', async () => {
  const client = await connect();

  client.send(ClientMessage.JOIN_ROOM, { roomId: 'zzzzzzzzzzzz', displayName: 'Nobody' });
  const notFound = await client.waitFor((m) => m.type === ServerMessage.ROOM_ERROR);
  assert.equal(notFound.code, 'ROOM_NOT_FOUND');

  client.send(ClientMessage.JOIN_ROOM, { roomId: 'bad', displayName: 'Nobody' });
  const invalid = await client.waitFor((m) => m.type === ServerMessage.ROOM_ERROR && m.code === 'INVALID_ROOM_ID');
  assert.equal(invalid.code, 'INVALID_ROOM_ID');

  client.send(ClientMessage.JOIN_ROOM, { roomId: 'zzzzzzzzzzzz', displayName: ' ' });
  const badName = await client.waitFor((m) => m.type === ServerMessage.ROOM_ERROR && m.code === 'INVALID_DISPLAY_NAME');
  assert.equal(badName.code, 'INVALID_DISPLAY_NAME');

  client.send('nonsense-type', {});
  const unknown = await client.waitFor((m) => m.type === ServerMessage.ROOM_ERROR && m.code === 'INVALID_MESSAGE');
  assert.equal(unknown.code, 'INVALID_MESSAGE');

  client.sendRaw('{"type": "create-room", ');
  await client.waitFor((m) => m.type === ServerMessage.ROOM_ERROR && m.code === 'INVALID_MESSAGE');

  client.sendRaw('[]');
  await client.waitFor((m) => m.type === ServerMessage.ROOM_ERROR && m.code === 'INVALID_MESSAGE');

  client.send(ClientMessage.CHAT_MESSAGE, { text: 'orphan message' });
  const notInRoom = await client.waitFor((m) => m.type === ServerMessage.ROOM_ERROR && m.code === 'NOT_IN_ROOM');
  assert.equal(notInRoom.code, 'NOT_IN_ROOM');

  assert.equal(client.ws.readyState, client.ws.OPEN, 'server must survive malformed traffic');
  await client.close();
});

test('chat: validated, room scoped, ordered and never echoed twice', async () => {
  const host = await connect();
  host.send(ClientMessage.CREATE_ROOM, { displayName: 'Ada' });
  const created = await host.waitFor((m) => m.type === ServerMessage.ROOM_CREATED);
  const roomId = created.room.roomId;

  const a = await connect();
  const b = await connect();
  const outsider = await connect();
  a.send(ClientMessage.JOIN_ROOM, { roomId, displayName: 'Grace' });
  await a.waitFor((m) => m.type === ServerMessage.ROOM_JOINED);
  b.send(ClientMessage.JOIN_ROOM, { roomId, displayName: 'Alan' });
  await b.waitFor((m) => m.type === ServerMessage.ROOM_JOINED);

  a.send(ClientMessage.CHAT_MESSAGE, { text: 'hello <script>alert(1)</script>' });
  const first = await b.waitFor((m) => m.type === ServerMessage.CHAT_MESSAGE);
  assert.equal(first.message.text, 'hello <script>alert(1)</script>');
  assert.equal(first.message.senderDisplayName, 'Grace');
  assert.equal(first.message.roomId, roomId);
  assert.ok(first.message.id && first.message.timestamp);
  // Sender receives exactly one copy (the server echo).
  assert.equal(a.received(ServerMessage.CHAT_MESSAGE).length, 1);

  b.send(ClientMessage.CHAT_MESSAGE, { text: 'hi back' });
  await a.waitFor((m) => m.type === ServerMessage.CHAT_MESSAGE && m.message.senderDisplayName === 'Alan');

  a.send(ClientMessage.CHAT_MESSAGE, { text: '   ' });
  await a.waitFor((m) => m.type === ServerMessage.ROOM_ERROR && m.code === 'INVALID_MESSAGE');
  a.send(ClientMessage.CHAT_MESSAGE, { text: 'x'.repeat(config.chatMaxLength + 50) });
  const echoed = await a.waitFor((m) => m.type === ServerMessage.CHAT_MESSAGE && m.message.text.length === config.chatMaxLength);
  assert.equal(echoed.message.text.length, config.chatMaxLength);

  // A different room must not see any of it.
  assert.equal(outsider.received(ServerMessage.CHAT_MESSAGE).length, 0);

  await Promise.all([host.close(), a.close(), b.close(), outsider.close()]);
});

test('webrtc signaling is relayed only between room members and validated', async () => {
  const host = await connect();
  host.send(ClientMessage.CREATE_ROOM, { displayName: 'Ada' });
  const created = await host.waitFor((m) => m.type === ServerMessage.ROOM_CREATED);
  const roomId = created.room.roomId;
  const guest = await connect();
  guest.send(ClientMessage.JOIN_ROOM, { roomId, displayName: 'Grace' });
  const joined = await guest.waitFor((m) => m.type === ServerMessage.ROOM_JOINED);
  const hostId = created.self.participantId;
  const guestId = joined.self.participantId;

  guest.send(ClientMessage.OFFER, { to: hostId, description: { type: 'offer', sdp: 'v=0\r\n' } });
  const offer = await host.waitFor((m) => m.type === ServerMessage.OFFER);
  assert.equal(offer.from, guestId);
  assert.equal(offer.roomId, roomId);
  assert.equal(offer.description.type, 'offer');

  host.send(ClientMessage.ANSWER, { to: guestId, description: { type: 'answer', sdp: 'v=0\r\n' } });
  const answer = await guest.waitFor((m) => m.type === ServerMessage.ANSWER);
  assert.equal(answer.from, hostId);

  host.send(ClientMessage.ICE_CANDIDATE, { to: guestId, candidate: { candidate: 'candidate:1 1 udp', sdpMid: '0' } });
  const ice = await guest.waitFor((m) => m.type === ServerMessage.ICE_CANDIDATE);
  assert.equal(ice.from, hostId);

  // Relaying a fake participantId is not trusted: the target must exist.
  host.send(ClientMessage.OFFER, { to: 'p_doesnotexist', description: { type: 'offer', sdp: 'v=0\r\n' } });
  const badTarget = await host.waitFor((m) => m.type === ServerMessage.ROOM_ERROR && m.code === 'INVALID_PARTICIPANT');
  assert.equal(badTarget.code, 'INVALID_PARTICIPANT');

  host.send(ClientMessage.OFFER, { to: guestId, description: { type: 'offer' } });
  await host.waitFor((m) => m.type === ServerMessage.ROOM_ERROR && m.code === 'INVALID_MESSAGE');

  host.send(ClientMessage.OFFER, { to: hostId, description: { type: 'offer', sdp: 'v=0' } });
  await host.waitFor((m) => m.type === ServerMessage.ROOM_ERROR && m.code === 'INVALID_PARTICIPANT');

  await Promise.all([host.close(), guest.close()]);
});

test('host controls are enforced server-side', async () => {
  const host = await connect();
  host.send(ClientMessage.CREATE_ROOM, { displayName: 'Ada' });
  const created = await host.waitFor((m) => m.type === ServerMessage.ROOM_CREATED);
  const roomId = created.room.roomId;
  const hostId = created.self.participantId;

  const guest = await connect();
  guest.send(ClientMessage.JOIN_ROOM, { roomId, displayName: 'Grace' });
  const joined = await guest.waitFor((m) => m.type === ServerMessage.ROOM_JOINED);
  const guestId = joined.self.participantId;

  // Non-host host commands are refused.
  guest.send(ClientMessage.LOCK_ROOM, { locked: true });
  const denied = await guest.waitFor((m) => m.type === ServerMessage.ROOM_ERROR && m.code === 'NOT_HOST');
  assert.equal(denied.code, 'NOT_HOST');
  guest.send(ClientMessage.END_MEETING, {});
  await guest.waitFor((m) => m.type === ServerMessage.ROOM_ERROR && m.code === 'NOT_HOST');
  guest.send(ClientMessage.REMOVE_PARTICIPANT, { targetParticipantId: hostId });
  await guest.waitFor((m) => m.type === ServerMessage.ROOM_ERROR && m.code === 'NOT_HOST');

  // Remote mute is a request, not a forced hardware change.
  host.send(ClientMessage.MUTE_REQUEST, { targetParticipantId: guestId });
  const mute = await guest.waitFor((m) => m.type === ServerMessage.MUTE_REQUEST);
  assert.equal(mute.byParticipantId, hostId);

  // Lock blocks new joins, existing participants stay connected.
  host.send(ClientMessage.LOCK_ROOM, { locked: true });
  const settings = await guest.waitFor((m) => m.type === ServerMessage.ROOM_SETTINGS_CHANGED);
  assert.equal(settings.locked, true);
  const late = await connect();
  late.send(ClientMessage.JOIN_ROOM, { roomId, displayName: 'Late' });
  const locked = await late.waitFor((m) => m.type === ServerMessage.ROOM_ERROR && m.code === 'ROOM_LOCKED');
  assert.equal(locked.code, 'ROOM_LOCKED');
  await late.close();

  host.send(ClientMessage.LOCK_ROOM, { locked: false });
  await guest.waitFor((m) => m.type === ServerMessage.ROOM_SETTINGS_CHANGED && m.locked === false);

  // Removal notifies both sides and the socket is closed.
  host.send(ClientMessage.REMOVE_PARTICIPANT, { targetParticipantId: guestId });
  const removed = await guest.waitFor((m) => m.type === ServerMessage.PARTICIPANT_REMOVED);
  assert.equal(removed.byDisplayName, 'Ada');
  await guest.waitForClose();
  const goneNotice = await host.waitFor((m) => m.type === ServerMessage.PARTICIPANT_LEFT && m.reason === 'removed');
  assert.equal(goneNotice.participantId, guestId);
  const after = await host.waitFor((m) => m.type === ServerMessage.ROOM_STATE && m.room.participants.length === 1);
  assert.equal(after.room.participants.length, 1);

  await host.close();
});

test('waiting room isolates non-admitted participants', async () => {
  const host = await connect();
  host.send(ClientMessage.CREATE_ROOM, { displayName: 'Ada' });
  const created = await host.waitFor((m) => m.type === ServerMessage.ROOM_CREATED);
  const roomId = created.room.roomId;
  const hostId = created.self.participantId;

  const member = await connect();
  member.send(ClientMessage.JOIN_ROOM, { roomId, displayName: 'Grace' });
  await member.waitFor((m) => m.type === ServerMessage.ROOM_JOINED);

  host.send(ClientMessage.SET_WAITING_ROOM, { enabled: true });
  await member.waitFor((m) => m.type === ServerMessage.ROOM_SETTINGS_CHANGED && m.waitingRoomEnabled === true);

  const waiter = await connect();
  waiter.send(ClientMessage.JOIN_ROOM, { roomId, displayName: 'Alan' });
  const waiting = await waiter.waitFor((m) => m.type === ServerMessage.WAITING_ROOM_STATE);
  assert.equal(waiting.status, 'waiting');
  // Nothing about the active room leaks to the waiting client.
  assert.equal(waiter.received(ServerMessage.ROOM_STATE).length, 0);
  assert.equal(waiter.received(ServerMessage.ROOM_JOINED).length, 0);
  assert.equal(waiting.room, undefined);

  const queue = await host.waitFor((m) => m.type === ServerMessage.WAITING_ROOM_UPDATED && m.waiting.length === 1);
  assert.equal(queue.waiting.length, 1);
  assert.equal(queue.waiting[0].displayName, 'Alan');

  // Chat is blocked for waiting participants.
  waiter.send(ClientMessage.CHAT_MESSAGE, { text: 'let me in' });
  await waiter.waitFor((m) => m.type === ServerMessage.ROOM_ERROR && m.code === 'NOT_IN_ROOM');
  assert.equal(member.received(ServerMessage.CHAT_MESSAGE).length, 0);

  host.send(ClientMessage.ADMIT_PARTICIPANT, { targetParticipantId: waiting.self.participantId });
  const admitted = await waiter.waitFor((m) => m.type === ServerMessage.ROOM_JOINED);
  assert.equal(admitted.self.participantId, waiting.self.participantId);
  assert.equal(admitted.room.participants.length, 3);
  const seen = await member.waitFor(
    (m) => m.type === ServerMessage.PARTICIPANT_JOINED && m.participant.displayName === 'Alan',
  );
  assert.equal(seen.participant.isHost, false);

  // Second waiter gets denied.
  const waiter2 = await connect();
  waiter2.send(ClientMessage.JOIN_ROOM, { roomId, displayName: 'Edsger' });
  const waiting2 = await waiter2.waitFor((m) => m.type === ServerMessage.WAITING_ROOM_STATE);
  host.send(ClientMessage.DENY_PARTICIPANT, { targetParticipantId: waiting2.self.participantId });
  const denial = await waiter2.waitFor((m) => m.type === ServerMessage.WAITING_ROOM_DENIED);
  assert.equal(denial.byDisplayName, 'Ada');
  await waiter2.waitForClose();

  // Host transfer to the earliest remaining participant, then end the meeting.
  host.send(ClientMessage.TRANSFER_HOST, { targetParticipantId: admitted.self.participantId });
  const hostChanged = await member.waitFor((m) => m.type === ServerMessage.HOST_CHANGED);
  assert.equal(hostChanged.hostParticipantId, admitted.self.participantId);

  const newHostConn = waiter;
  newHostConn.send(ClientMessage.END_MEETING, {});
  const ended = await member.waitFor((m) => m.type === ServerMessage.MEETING_ENDED);
  assert.equal(ended.reason, 'host-ended');
  await member.waitForClose();
  await host.waitForClose();

  // The room is gone, so a later join is rejected.
  const after = await connect();
  after.send(ClientMessage.JOIN_ROOM, { roomId, displayName: 'Late' });
  const gone = await after.waitFor((m) => m.type === ServerMessage.ROOM_ERROR && m.code === 'ROOM_NOT_FOUND');
  assert.equal(gone.code, 'ROOM_NOT_FOUND');
  await Promise.all([after.close(), host.close(), waiter.close()]);
  void hostId;
});

test('host is transferred automatically when the host leaves', async () => {
  const host = await connect();
  host.send(ClientMessage.CREATE_ROOM, { displayName: 'Ada' });
  const created = await host.waitFor((m) => m.type === ServerMessage.ROOM_CREATED);
  const roomId = created.room.roomId;

  const first = await connect();
  first.send(ClientMessage.JOIN_ROOM, { roomId, displayName: 'Grace' });
  const firstJoined = await first.waitFor((m) => m.type === ServerMessage.ROOM_JOINED);
  await sleep(15);
  const second = await connect();
  second.send(ClientMessage.JOIN_ROOM, { roomId, displayName: 'Alan' });
  await second.waitFor((m) => m.type === ServerMessage.ROOM_JOINED);

  await host.close();
  // Deterministic succession: the earliest remaining participant (Grace) wins.
  const state = await first.waitFor(
    (m) => m.type === ServerMessage.ROOM_STATE && m.room.hostParticipantId !== created.self.participantId,
  );
  assert.equal(state.room.hostParticipantId, firstJoined.self.participantId);
  assert.equal(state.room.participants.filter((p) => p.isHost).length, 1, 'exactly one host');
  assert.equal(
    state.room.participants.filter((p) => p.isHost).length,
    1,
    'the old host must not linger',
  );

  // The promoted participant really has the powers.
  first.send(ClientMessage.LOCK_ROOM, { locked: true });
  const locked = await second.waitFor((m) => m.type === ServerMessage.ROOM_SETTINGS_CHANGED);
  assert.equal(locked.locked, true);

  // A brand new participant cannot use host commands.
  first.send(ClientMessage.LOCK_ROOM, { locked: false });
  await second.waitFor((m) => m.type === ServerMessage.ROOM_SETTINGS_CHANGED && m.locked === false);
  const impostor = await connect();
  impostor.send(ClientMessage.JOIN_ROOM, { roomId, displayName: 'Mallory' });
  const impostorJoined = await impostor.waitFor((m) => m.type === ServerMessage.ROOM_JOINED);
  assert.equal(impostorJoined.self.isHost, false);
  impostor.send(ClientMessage.LOCK_ROOM, { locked: false });
  await impostor.waitFor((m) => m.type === ServerMessage.ROOM_ERROR && m.code === 'NOT_HOST');
  impostor.send(ClientMessage.END_MEETING, {});
  await impostor.waitFor((m) => m.type === ServerMessage.ROOM_ERROR && m.code === 'NOT_HOST');
  impostor.send(ClientMessage.ADMIT_PARTICIPANT, { targetParticipantId: firstJoined.self.participantId });
  await impostor.waitFor((m) => m.type === ServerMessage.ROOM_ERROR && m.code === 'NOT_HOST');

  // The new host can hand the role on, and only one host remains.
  first.send(ClientMessage.TRANSFER_HOST, { targetParticipantId: impostorJoined.self.participantId });
  const handed = await second.waitFor((m) => m.type === ServerMessage.HOST_CHANGED);
  assert.equal(handed.hostParticipantId, impostorJoined.self.participantId);

  await Promise.all([first.close(), second.close(), impostor.close()]);
});

test('only one participant may present at a time', async () => {
  const host = await connect();
  host.send(ClientMessage.CREATE_ROOM, { displayName: 'Ada' });
  const created = await host.waitFor((m) => m.type === ServerMessage.ROOM_CREATED);
  const roomId = created.room.roomId;
  const a = await connect();
  a.send(ClientMessage.JOIN_ROOM, { roomId, displayName: 'Grace' });
  await a.waitFor((m) => m.type === ServerMessage.ROOM_JOINED);
  const b = await connect();
  b.send(ClientMessage.JOIN_ROOM, { roomId, displayName: 'Alan' });
  await b.waitFor((m) => m.type === ServerMessage.ROOM_JOINED);

  a.send(ClientMessage.SCREEN_SHARE_STATE_CHANGED, { sharing: true });
  const sharing = await b.waitFor((m) => m.type === ServerMessage.SCREEN_SHARE_STATE_CHANGED);
  assert.equal(sharing.sharing, true);

  b.send(ClientMessage.SCREEN_SHARE_STATE_CHANGED, { sharing: true });
  const conflict = await b.waitFor((m) => m.type === ServerMessage.ROOM_ERROR && m.code === 'PRESENTER_ACTIVE');
  assert.equal(conflict.code, 'PRESENTER_ACTIVE');
  assert.match(conflict.message, /Grace/);

  a.send(ClientMessage.SCREEN_SHARE_STATE_CHANGED, { sharing: false });
  await b.waitFor((m) => m.type === ServerMessage.SCREEN_SHARE_STATE_CHANGED && m.sharing === false);
  b.send(ClientMessage.SCREEN_SHARE_STATE_CHANGED, { sharing: true });
  await a.waitFor((m) => m.type === ServerMessage.SCREEN_SHARE_STATE_CHANGED && m.participantId !== created.self.participantId);

  await Promise.all([host.close(), a.close(), b.close()]);
});

test('a refreshed tab resumes its identity instead of duplicating it', async () => {
  const host = await connect();
  host.send(ClientMessage.CREATE_ROOM, { displayName: 'Ada' });
  const created = await host.waitFor((m) => m.type === ServerMessage.ROOM_CREATED);
  const roomId = created.room.roomId;

  const guest = await connect();
  guest.send(ClientMessage.JOIN_ROOM, { roomId, displayName: 'Grace' });
  const joined = await guest.waitFor((m) => m.type === ServerMessage.ROOM_JOINED);
  const guestId = joined.self.participantId;

  // Grace refreshes: media state first, then the socket drops.
  guest.send(ClientMessage.MEDIA_STATE_CHANGED, { audioEnabled: false, videoEnabled: false });
  await host.waitFor((m) => m.type === ServerMessage.MEDIA_STATE_CHANGED && m.audioEnabled === false);
  await guest.close();
  const left = await host.waitFor((m) => m.type === ServerMessage.PARTICIPANT_LEFT);
  assert.equal(left.participantId, guestId);
  const cleaned = await host.waitFor((m) => m.type === ServerMessage.ROOM_STATE && m.room.participants.length === 1);
  assert.equal(cleaned.room.participants.length, 1);

  const again = await connect();
  again.send(ClientMessage.JOIN_ROOM, {
    roomId,
    displayName: 'Grace',
    resumeToken: joined.self.resumeToken,
  });
  const resumed = await again.waitFor((m) => m.type === ServerMessage.ROOM_JOINED);
  assert.equal(resumed.self.participantId, guestId, 'identity must be stable across a refresh');
  assert.equal(resumed.self.audioEnabled, false);
  assert.equal(resumed.self.videoEnabled, false);
  assert.equal(resumed.room.participants.length, 2);

  // A second use of the same token must not hand out the same identity.
  const third = await connect();
  third.send(ClientMessage.JOIN_ROOM, { roomId, displayName: 'Grace', resumeToken: joined.self.resumeToken });
  const replay = await third.waitFor((m) => m.type === ServerMessage.ROOM_JOINED);
  assert.notEqual(replay.self.participantId, guestId);

  await Promise.all([host.close(), again.close(), third.close()]);
});

test('oversized frames are rejected without killing the server', async () => {
  const client = await connect();
  client.sendRaw('x'.repeat(config.maxMessageBytes + 2048));
  await client.waitForClose(3000);
  const survivor = await connect();
  survivor.send(ClientMessage.CREATE_ROOM, { displayName: 'Ada' });
  const created = await survivor.waitFor((m) => m.type === ServerMessage.ROOM_CREATED);
  assert.ok(created.room.roomId);
  await survivor.close();
});

test('flooding a connection is rate limited and eventually dropped', async () => {
  const client = await connect();
  const host = await connect();
  host.send(ClientMessage.CREATE_ROOM, { displayName: 'Ada' });
  await host.waitFor((m) => m.type === ServerMessage.ROOM_CREATED);

  for (let i = 0; i < config.rateLimitMaxMessages * 3; i += 1) {
    client.send(ClientMessage.PING, {});
  }
  const limited = await client.waitFor((m) => m.type === ServerMessage.ROOM_ERROR && m.code === 'RATE_LIMITED', 4000);
  assert.equal(limited.code, 'RATE_LIMITED');
  await client.waitForClose(4000);
  await host.close();
});

test('empty rooms are removed from memory and leave no ghost participants', async () => {
  const manager = new RoomManager({ roomTtlMs: 0 });
  const room = manager.createRoom();
  const participant = manager.createParticipant({
    roomId: room.id,
    displayName: 'Ada',
    connectionId: 'c1',
    socket: null,
  });
  room.addParticipant(participant);
  room.hostParticipantId = participant.id;
  assert.equal(manager.stats().participants, 1);

  room.removeParticipant(participant.id);
  room.emptySince = Date.now() - 1000;
  const swept = manager.sweep();
  assert.equal(swept.removedRooms, 1);
  assert.equal(manager.getRoom(room.id), null);
  assert.equal(manager.stats().rooms, 0);
  assert.equal(manager.stats().participants, 0);
});

test('room ids are unpredictable and never sequential', async () => {
  const manager = new RoomManager();
  const ids = new Set();
  for (let i = 0; i < 200; i += 1) ids.add(manager.createRoom().id);
  assert.equal(ids.size, 200, 'room ids must not collide');
  for (const id of ids) assert.match(id, /^[a-z2-9]{12}$/);
});

void createLogger;
