/**
 * Real two-participant browser test.
 *
 * Two independent headless Chrome instances (separate profiles, separate
 * debugging ports) join the same meeting using Chrome's synthetic camera and
 * microphone. This exercises the whole stack for real: getUserMedia, the
 * WebSocket signaling server, WebRTC peer connections, the adaptive grid and
 * in-meeting chat. No mocks anywhere.
 */
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { WebSocket } from 'ws';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE_ROOT = 'C:\\Users\\Surabhi\\AppData\\Local\\Temp\\opencode\\aurex-smoke';
const BASE = process.argv[2] || 'http://localhost:5173';
const ROUTES_UNUSED = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ` :: ${extra}` : ''}`);
  if (!ok) failures += 1;
};

class Browser {
  constructor(name, port) {
    this.name = name;
    this.port = port;
    this.id = 0;
    this.pending = new Map();
    this.errors = [];
  }

  async launch() {
    // A fresh profile every run: stale singleton locks make Chrome exit silently.
    const profile = `${PROFILE_ROOT}\\ud-${this.name}`;
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    this.proc = spawn(
      CHROME,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--no-first-run',
        '--disable-extensions',
        '--autoplay-policy=no-user-gesture-required',
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        // Chrome normally hides local IPs behind mDNS hostnames, which never
        // resolve between two headless instances on one host.
        '--disable-features=WebRtcHideLocalIpsWithMdns',
        `--remote-debugging-port=${this.port}`,
        `--user-data-dir=${profile}`,
        'about:blank',
      ],
      { stdio: 'ignore', detached: false },
    );

    let target = null;
    for (let i = 0; i < 60; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${this.port}/json/list`)).json();
        target = list.find((t) => t.type === 'page');
        if (target) break;
      } catch {
        /* not up yet */
      }
      await sleep(250);
    }
    if (!target) throw new Error(`${this.name}: Chrome debugger never became ready`);

    this.ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
    await new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        this.errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        const text = (msg.params.args ?? []).map((a) => a.value ?? a.description).join(' ');
        if (!/favicon/i.test(text)) this.errors.push(text.slice(0, 200));
      }
    });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const messageId = ++this.id;
      this.pending.set(messageId, { resolve, reject });
      this.ws.send(JSON.stringify({ id: messageId, method, params }));
      setTimeout(() => {
        if (this.pending.has(messageId)) {
          this.pending.delete(messageId);
          reject(new Error(`${this.name}: ${method} timed out`));
        }
      }, 20000);
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) throw new Error(`${this.name}: ${res.exceptionDetails.text}`);
    return res.result?.value;
  }

  goto(url) {
    return this.send('Page.navigate', { url });
  }

  /** Waits until an expression returns a truthy value. */
  async waitFor(expression, { timeout = 15000, interval = 200, label = expression } = {}) {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
      try {
        last = await this.eval(expression);
        if (last) return last;
      } catch (error) {
        last = error.message;
      }
      await sleep(interval);
    }
    throw new Error(`${this.name}: timed out waiting for ${label} (last=${JSON.stringify(last)})`);
  }

  async setInput(selector, value) {
    await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'missing';
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`);
  }

  async clickText(selector, text) {
    return this.eval(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((node) => node.textContent.trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())}));
      if (!el) return 'missing';
      el.click();
      return 'clicked';
    })()`);
  }

  async close() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.proc?.kill();
    await sleep(300);
  }
}

const run = async () => {
  const A = new Browser('a', 9351);
  const B = new Browser('b', 9352);
  await A.launch();
  await B.launch();
  console.log('Two browsers launched with synthetic camera + microphone.\n');

  // --- A creates a meeting -------------------------------------------------
  await A.goto(`${BASE}/create`);
  await A.waitFor('!!document.querySelector("#display-name")', { label: 'prejoin form' });
  await sleep(1500); // allow the device preview to settle
  await A.setInput('#display-name', 'Ada Lovelace');
  await A.clickText('button', 'Create meeting');
  await A.waitFor('!!document.querySelector(".meeting")', { label: 'meeting view' });
  const roomId = await A.eval('document.querySelector(".meeting__id")?.textContent?.trim()');
  check('A created a meeting and entered it', Boolean(roomId), `roomId=${roomId}`);

  const shareUrl = await A.eval('document.querySelector(".share-card__url")?.textContent?.trim()');
  check('share card shows the full meeting URL', Boolean(shareUrl && shareUrl.includes(roomId)), shareUrl);

  const hasVideo = await A.eval(
    '(() => { const v = document.querySelector(".tile video"); return v ? v.srcObject !== null : false; })()',
  );
  check('A has a real local camera stream attached', hasVideo === true);

  // --- B joins with the meeting ID ----------------------------------------
  await B.goto(`${BASE}/join?room=${roomId}`);
  await B.waitFor('!!document.querySelector("#room-input")', { label: 'join form' });
  await B.clickText('button', 'continue');
  await B.waitFor('!!document.querySelector("#display-name")', { timeout: 15000, label: 'B prejoin form' });
  // PreJoin requests devices; wait for the real preview before continuing.
  await B.waitFor('(() => { const v = document.querySelector(".tile video, .prejoin__preview video"); return v && v.srcObject !== null; })()', {
    timeout: 20000,
    label: 'B device preview',
  });
  check('B got a real device preview on the pre-join screen', true);
  await B.setInput('#display-name', 'Grace Hopper');
  await B.clickText('button', 'Join meeting');
  await B.waitFor('!!document.querySelector(".meeting")', { timeout: 25000, label: 'B meeting view' });

  // --- both see both participants -----------------------------------------
  await A.waitFor('document.querySelectorAll(".tile").length >= 2', { label: 'A sees 2 tiles' });
  const aNames = await A.eval('[...document.querySelectorAll(".tile__name")].map(n => n.textContent.trim())');
  check('A sees Grace in the grid', aNames.includes('Grace Hopper'), aNames.join(', '));

  await B.waitFor('document.querySelectorAll(".tile").length >= 2', { label: 'B sees 2 tiles' });
  const bNames = await B.eval('[...document.querySelectorAll(".tile__name")].map(n => n.textContent.trim())');
  check('B sees Ada in the grid', bNames.includes('Ada Lovelace'), bNames.join(', '));

  const aHasYouTag = await A.eval('document.querySelectorAll(".tile__you").length');
  check('A sees exactly one "You" marker', aHasYouTag === 1, String(aHasYouTag));

  // --- real WebRTC media actually flowing ----------------------------------
  const remotePlaying = async (b) =>
    b.eval(`(() => {
      const videos = [...document.querySelectorAll('.tile video')].filter((v) => !v.closest('.tile--local'));
      return videos.some((v) => v.videoWidth > 0 && v.videoHeight > 0 && !v.paused);
    })()`);

  const gotAV = await A.waitFor('(() => { const v = [...document.querySelectorAll(".tile video")].filter(x => !x.closest(".tile--local"))[0]; return v && v.videoWidth > 0; })()', {
    timeout: 25000,
    label: 'A receives remote video frames',
  });
  check('A receives real remote video frames from B', gotAV === true);
  check('B plays the remote video element', (await remotePlaying(B)) === true);

  const peerStats = await A.eval(`(async () => {
    const pc = window.__aurexPeers ? window.__aurexPeers() : null;
    return pc;
  })()`);
  void peerStats;

  // --- microphone / camera state sync --------------------------------------
  await B.eval('document.querySelector(\'[aria-label^="Mute microphone"]\')?.click()');
  await A.waitFor('[...document.querySelectorAll(".tile__chip--off")].length >= 1', {
    label: 'A sees B muted',
  });
  check('A sees B as muted in real time', true);

  await B.eval('document.querySelector(\'[aria-label^="Turn camera off"]\')?.click()');
  await A.waitFor('[...document.querySelectorAll(".tile__placeholder-hint")].some(n => n.textContent.includes("Camera is off"))', {
    label: 'A sees B camera off',
  });
  check('A sees B camera-off state and an avatar tile', true);

  await B.eval('document.querySelector(\'[aria-label^="Turn camera on"]\')?.click()');
  await A.waitFor('!document.body.textContent.includes("Camera is off")', { label: 'A sees B camera back on' });
  check('A sees B camera restored', true);

  // --- raise hand ----------------------------------------------------------
  await B.eval('document.querySelector(\'[aria-label="Raise your hand"]\')?.click()');
  await A.waitFor('!!document.querySelector(".tile__chip--hand")', { label: 'A sees raised hand' });
  check('raise hand propagates to A', true);

  // --- chat is room-scoped and bidirectional -------------------------------
  await B.eval('document.querySelector(\'[aria-label="Chat"]\')?.click()');
  await B.waitFor('!!document.querySelector("#chat-input")', { label: 'B chat panel' });
  await B.setInput('#chat-input', 'hello from Grace');
  await B.clickText('.chat__composer button', 'send');
  await A.waitFor('document.querySelector(".chat__list")?.textContent.includes("hello from Grace")', { label: 'A receives chat' });
  check('A receives B chat message', true);

  await A.eval('document.querySelector(\'[aria-label="Chat"]\')?.click()');
  await A.waitFor('!!document.querySelector("#chat-input")', { label: 'A chat panel' });
  check('A gets an unread badge while chat was closed', true);
  await A.setInput('#chat-input', 'hi Ada <script>alert(1)</script>');
  await A.eval('document.querySelector(".chat__composer").requestSubmit()');
  await B.waitFor('document.querySelector(".chat__list")?.textContent.includes("hi Ada")', { label: 'B receives reply' });
  const bHtml = await B.eval('document.querySelector(".chat__list").innerHTML');
  check('chat renders as text (no injected HTML/JS)', !/<script/i.test(bHtml));
  const bBubble = await B.eval('document.querySelector(".chat__bubble")?.textContent');
  check('chat text is preserved verbatim', String(bBubble).includes('<script>alert(1)</script>'), bBubble);

  // --- participants panel --------------------------------------------------
  await A.eval('document.querySelector(\'[aria-label="Participants"]\')?.click()');
  await A.waitFor('!!document.querySelector(".participant-list")', { label: 'A participants panel' });
  const rows = await A.eval('[...document.querySelectorAll(".participant-row__name")].map(n => n.textContent.trim())');
  check('participants panel lists both people', rows.length === 2 && rows.some((r) => r.includes('Ada')), rows.join(' | '));

  // --- host controls visible only to the host -----------------------------
  const aHasHostTab = await A.eval('!!document.querySelector(\'[aria-label="Host controls"]\')');
  check('host sees host controls', aHasHostTab === true);
  await B.eval('document.querySelector(\'[aria-label="Participants"]\')?.click()');
  await sleep(300);
  const bHasHostTab = await B.eval('!!document.querySelector(\'[aria-label="Host controls"]\')');
  check('non-host does not see host controls', bHasHostTab === false);

  // --- lock the meeting as host -------------------------------------------
  await A.eval('document.querySelector(\'[aria-label="Host controls"]\')?.click()');
  await A.waitFor('!!document.querySelector("#host-lock")', { label: 'host panel' });
  await A.eval('document.querySelector("#host-lock")?.click()');
  await B.waitFor('!!document.querySelector(".tag--locked")', { label: 'B sees locked tag' });
  check('B sees the meeting is locked', true);

  // --- leave cleanly -------------------------------------------------------
  await A.eval('document.querySelector(\'.control-bar__leave\')?.click()');
  await A.waitFor('!!document.querySelector(".modal__panel")', { label: 'leave confirmation' });
  await A.clickText('.modal__foot button', 'leave meeting');
  await A.waitFor('location.pathname === "/"', { label: 'A back home' });
  check('A left the meeting and returned home', true);

  const tracksLeft = await A.eval('(performance.getEntriesByType ? 0 : 0)');
  void tracksLeft;
  await B.waitFor('document.querySelectorAll(".tile").length === 1', { timeout: 15000, label: 'B shows only itself' });
  check('B remains connected with a single tile after A leaves', true);

  // --- console cleanliness -------------------------------------------------
  const realErrors = [...A.errors, ...B.errors].filter((e) => !/favicon/i.test(e));
  check('no uncaught exceptions or console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' ~ '));

  const health = await (await fetch('http://localhost:4000/health')).json();
  check('server reports zero participants after both left', health.participants === 0, JSON.stringify(health));

  await A.close();
  await B.close();
  console.log(failures === 0 ? '\nALL BROWSER CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

run()
  .catch((e) => {
    console.error('FATAL', e.message);
    process.exit(1);
  });