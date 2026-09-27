import { WebSocket } from 'ws';

const URL = 'ws://127.0.0.1:4000/ws';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ` :: ${extra}` : ''}`);
  if (!ok) failures += 1;
};

class C {
  constructor(name) { this.name = name; this.msgs = []; this.waiters = []; }
  static async open(name) {
    const c = new C(name);
    c.ws = new WebSocket(URL);
    c.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      c.msgs.push(m);
      for (const w of [...c.waiters]) if (w.p(m)) { c.waiters.splice(c.waiters.indexOf(w), 1); clearTimeout(w.t); w.r(m); }
    });
    await new Promise((res, rej) => { c.ws.once('open', res); c.ws.once('error', rej); });
    await c.wait((m) => m.type === 'welcome');
    return c;
  }
  send(type, p = {}) { this.ws.send(JSON.stringify({ type, ...p })); }
  wait(p, ms = 4000) {
    const hit = this.msgs.find(p);
    if (hit) return Promise.resolve(hit);
    return new Promise((res, rej) => {
      const w = { p, r: res }; w.t = setTimeout(() => rej(new Error(`${this.name}: timeout`)), ms); this.waiters.push(w);
    });
  }
  got(type, p) { return this.msgs.some((m) => m.type === type && (!p || p(m))); }
  async close() { if (this.ws.readyState === 1) { this.ws.close(); await sleep(60); } }
}

const run = async () => {
  // A creates the room
  const A = await C.open('A');
  A.send('create-room', { displayName: 'Ada' });
  const created = await A.wait((m) => m.type === 'room-created');
  const roomId = created.room.roomId;
  check('A creates room + becomes host', created.self.isHost && created.room.participants.length === 1, roomId);
  const hostId = created.self.participantId;

  // B, C, D join
  const B = await C.open('B');
  const Cc = await C.open('C');
  const D = await C.open('D');
  for (const [c, n] of [[B, 'Grace'], [Cc, 'Alan'], [D, 'Edsger']]) c.send('join-room', { roomId, displayName: n });
  const jb = await B.wait((m) => m.type === 'room-joined');
  const jc = await Cc.wait((m) => m.type === 'room-joined');
  const jd = await D.wait((m) => m.type === 'room-joined');
  const aState = await A.wait((m) => m.type === 'room-state' && m.room.participants.length === 4);
  // Each joiner receives the snapshot as of their own join, so the counts grow.
  check('roster converges to 4 participants', aState.room.participants.length === 4);
  check(
    'join snapshots are consistent and ordered',
    jb.room.participants.length === 2 && jc.room.participants.length === 3 && jd.room.participants.length === 4,
    `${jb.room.participants.length}/${jc.room.participants.length}/${jd.room.participants.length}`,
  );
  check('exactly one host in state', aState.room.participants.filter((p) => p.isHost).length === 1);
  check('B is not host', jb.self.isHost === false);
  check('A saw 3 join events', A.msgs.filter((m) => m.type === 'participant-joined').length === 3);

  // Full mesh WebRTC: every pair exchanges offer/answer/candidate
  const peers = { A, B, C: Cc, D };
  const ids = { A: hostId, B: jb.self.participantId, C: jc.self.participantId, D: jd.self.participantId };
  const names = Object.keys(peers);
  for (let i = 0; i < names.length; i += 1) {
    for (let k = i + 1; k < names.length; k += 1) {
      const x = names[i]; const y = names[k];
      const offerer = ids[x] < ids[y] ? x : y;      // impolite side = lower id
      const answerer = offerer === x ? y : x;
      peers[offerer].send('offer', { to: ids[answerer], description: { type: 'offer', sdp: `v=0 o=- ${x}${y}` } });
      const gotOffer = await peers[answerer].wait((m) => m.type === 'offer' && m.from === ids[offerer]);
      peers[answerer].send('answer', { to: ids[offerer], description: { type: 'answer', sdp: 'v=0 o=-' } });
      await peers[offerer].wait((m) => m.type === 'answer' && m.from === ids[answerer]);
      peers[answerer].send('ice-candidate', { to: ids[offerer], candidate: { candidate: 'candidate:1 1 udp', sdpMid: '0' } });
      await peers[offerer].wait((m) => m.type === 'ice-candidate' && m.from === ids[answerer]);
      check(`pair ${x}<->${k} negotiated`, gotOffer.description.type === 'offer');
    }
  }
  check('all 6 pairs negotiated', true);

  // Media state + hand + screen share
  B.send('media-state-changed', { audioEnabled: false, videoEnabled: true });
  check('A sees B muted', (await A.wait((m) => m.type === 'media-state-changed' && m.participantId === ids.B)).audioEnabled === false);
  Cc.send('hand-state-changed', { raised: true });
  check('A sees C hand raised', (await A.wait((m) => m.type === 'hand-state-changed' && m.participantId === ids.C)).raised === true);
  B.send('screen-share-state-changed', { sharing: true });
  const share = await A.wait((m) => m.type === 'screen-share-state-changed' && m.participantId === ids.B);
  check('A sees B presenting', share.sharing === true);
  Cc.send('screen-share-state-changed', { sharing: true });
  const clash = await Cc.wait((m) => m.type === 'room-error' && m.code === 'PRESENTER_ACTIVE');
  check('second presenter rejected', clash.code === 'PRESENTER_ACTIVE', clash.message);

  // Chat reaches everyone exactly once, is room-scoped
  const outsider = await C.open('outsider');
  A.send('chat-message', { text: 'hello <b>team</b>' });
  const rx = await Promise.all([B.wait((m) => m.type === 'chat-message'), Cc.wait((m) => m.type === 'chat-message'), D.wait((m) => m.type === 'chat-message')]);
  check('chat reached all three others', rx.every((m) => m.message.text === 'hello <b>team</b>'), `sender=${rx[0].message.senderDisplayName}`);
  check('chat not leaked to other room', !outsider.got('chat-message'));
  A.send('chat-message', { text: '   ' });
  await A.wait((m) => m.type === 'room-error' && m.code === 'INVALID_MESSAGE');
  check('empty chat rejected', true);

  // Host: lock blocks new joins
  A.send('lock-room', { locked: true });
  await B.wait((m) => m.type === 'room-settings-changed' && m.locked === true);
  const late = await C.open('late');
  late.send('join-room', { roomId, displayName: 'Late' });
  check('locked room rejects join', (await late.wait((m) => m.type === 'room-error' && m.code === 'ROOM_LOCKED')).code === 'ROOM_LOCKED');
  A.send('lock-room', { locked: false });
  await B.wait((m) => m.type === 'room-settings-changed' && m.locked === false);

  // Waiting room
  A.send('set-waiting-room', { enabled: true });
  await B.wait((m) => m.type === 'room-settings-changed' && m.waitingRoomEnabled === true);
  late.send('join-room', { roomId, displayName: 'Late' });
  const waiting = await late.wait((m) => m.type === 'waiting-room-state');
  check('late participant waits', waiting.status === 'waiting' && !late.got('room-state') && !late.got('room-joined'));
  A.send('admit-participant', { targetParticipantId: waiting.self.participantId });
  const admitted = await late.wait((m) => m.type === 'room-joined');
  check('admitted participant joins the room', admitted.room.participants.length === 5);
  await B.wait((m) => m.type === 'room-state' && m.room.participants.length === 5);
  check('existing participants learn about the admission', true);

  // Non-host commands rejected
  B.send('end-meeting', {});
  check('non-host cannot end meeting', (await B.wait((m) => m.type === 'room-error' && m.code === 'NOT_HOST')).code === 'NOT_HOST');
  B.send('remove-participant', { targetParticipantId: ids.C });
  await B.wait((m) => m.type === 'room-error' && m.code === 'NOT_HOST');
  check('non-host cannot remove', true);

  // Host mute request
  A.send('mute-request', { targetParticipantId: ids.D });
  check('mute request reaches D', (await D.wait((m) => m.type === 'mute-request')).byParticipantId === hostId);

  // Host leaves -> deterministic transfer to earliest remaining
  await A.close();
  const promoted = await B.wait((m) => m.type === 'room-state' && m.room.hostParticipantId !== hostId);
  check('host transferred to earliest participant (B)', promoted.room.hostParticipantId === ids.B, `${promoted.room.hostParticipantId} vs ${ids.B}`);
  check('exactly one host after transfer', promoted.room.participants.filter((p) => p.isHost).length === 1);
  B.send('lock-room', { locked: true });
  await Cc.wait((m) => m.type === 'room-settings-changed' && m.locked === true);
  check('new host can use host controls', true);
  B.send('lock-room', { locked: false });
  await Cc.wait((m) => m.type === 'room-settings-changed' && m.locked === false);

  // D refreshes -> resumes identity, no duplicate (waiting room off first)
  B.send('set-waiting-room', { enabled: false });
  await Cc.wait((m) => m.type === 'room-settings-changed' && m.waitingRoomEnabled === false);
  const dToken = jd.self.resumeToken;
  await D.close();
  await B.wait((m) => m.type === 'room-state' && !m.room.participants.some((p) => p.participantId === ids.D));
  check('D removed after disconnect', true);
  const D2 = await C.open('D2');
  D2.send('join-room', { roomId, displayName: 'Edsger', resumeToken: dToken });
  const resumed = await D2.wait((m) => m.type === 'room-joined');
  check('D resumes same identity after refresh', resumed.self.participantId === ids.D);
  await B.wait((m) => m.type === 'room-state' && m.room.participants.length === 4);
  check('no duplicate D tile', B.msgs.filter((m) => m.type === 'participant-joined' && m.participant.displayName === 'Edsger').length >= 1);

  // New host ends the meeting
  B.send('end-meeting', {});
  await Cc.wait((m) => m.type === 'meeting-ended');
  await D2.wait((m) => m.type === 'meeting-ended');
  check('meeting-ended reaches everyone', true);
  await sleep(200);
  const after = await C.open('after');
  after.send('join-room', { roomId, displayName: 'Ghost' });
  check('ended room rejects new joins', (await after.wait((m) => m.type === 'room-error' && m.code === 'ROOM_NOT_FOUND')).code === 'ROOM_NOT_FOUND');

  // Server still healthy
  const health = await (await fetch('http://127.0.0.1:4000/health')).json();
  check('server still healthy after full flow', health.status === 'ok');

  await Promise.all([B.close(), Cc.close(), late.close(), outsider.close(), after.close()]);
  console.log(failures === 0 ? '\nALL LIVE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
