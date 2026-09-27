import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { WebSocket } from "ws";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ROOT = "C:\\Users\\Surabhi\\AppData\\Local\\Temp\\opencode\\aurex-smoke";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class B {
  constructor(name, port) { this.name = name; this.port = port; this.id = 0; this.pend = new Map(); }
  async launch() {
    const P = `${ROOT}\\ud-${this.name}`;
    rmSync(P, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    this.proc = spawn(CHROME, ["--headless=new","--disable-gpu","--no-sandbox","--no-first-run",
      "--disable-extensions","--autoplay-policy=no-user-gesture-required",
      "--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream",
      "--disable-features=WebRtcHideLocalIpsWithMdns",
      `--remote-debugging-port=${this.port}`,`--user-data-dir=${P}`,"about:blank"], { stdio: "ignore" });
    let t = null;
    for (let i = 0; i < 60; i += 1) {
      try { const l = await (await fetch(`http://localhost:${this.port}/json/list`)).json(); t = l.find((x) => x.type === "page"); if (t) break; } catch {}
      await sleep(250);
    }
    this.ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
    await new Promise((r) => { this.ws.once("open", r); });
    this.ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && this.pend.has(m.id)) { const { resolve } = this.pend.get(m.id); this.pend.delete(m.id); resolve(m.result); }
      if (m.method === "Runtime.exceptionThrown") console.log(`[${this.name}] EXC`, m.params.exceptionDetails.exception?.description?.slice(0, 200));
      if (m.method === "Runtime.consoleAPICalled") { const t = (m.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" "); if (true) console.log(`[${this.name}] ${m.params.type}: ${t.slice(0,200)}`); }
    });
    await this.send("Runtime.enable");
    await this.send("Page.enable");
  }
  send(method, params = {}) {
    return new Promise((res) => { const i = ++this.id; this.pend.set(i, { resolve: res }); this.ws.send(JSON.stringify({ id: i, method, params })); });
  }
  async ev(e) { const r = await this.send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return "EXC:" + r.exceptionDetails.text; return r.result?.value; }
  async wait(e, t = 20000) { const end = Date.now() + t; while (Date.now() < end) { const v = await this.ev(e); if (v) return v; await sleep(250); } return null; }
  setInput(s, v) { return this.ev(`(() => { const el = document.querySelector(${JSON.stringify(s)}); if (!el) return 'missing';
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(v)});
    el.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`); }
  clickText(s, t) { return this.ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(s)})].find(n => n.textContent.trim().toLowerCase().includes(${JSON.stringify(t.toLowerCase())})); if (!el) return 'missing'; el.click(); return 'clicked'; })()`); }
  kill() { try { this.ws.close(); } catch {} this.proc?.kill(); }
}

const A = new B("dga", 9440);
const C = new B("dgb", 9441);

const run = async () => {
  await A.launch(); await C.launch();
  await A.ev("location.href='http://localhost:5173/create'");
  await A.wait('!!document.querySelector("#display-name")');
  await sleep(2500);
  await A.setInput("#display-name", "Ada");
  await A.clickText("button", "Create meeting");
  await A.wait('!!document.querySelector(".meeting")');
  const roomId = await A.ev('document.querySelector(".meeting__id")?.textContent?.trim()');
  console.log("room:", roomId);

  await C.ev(`location.href='http://localhost:5173/meeting/${roomId}'`);
  await C.wait('!!document.querySelector("#display-name")');
  await sleep(2500);
  await C.setInput("#display-name", "Grace");
  await C.clickText("button", "Join meeting");
  await C.wait('!!document.querySelector(".meeting")');
  console.log("both in meeting");

  for (const t of [3000]) {
    await sleep(t);
    for (const b of [A, C]) {
      const dbg = await b.ev('JSON.stringify(window.__AUREX__?.peersDebug?.() ?? "no hook")');
      const st = await b.ev('JSON.stringify({phase: window.__AUREX__?.getState()?.phase, sig: window.__AUREX__?.getState()?.signalingStatus, remote: Object.keys(window.__AUREX__?.getState()?.remoteStreams ?? {}).length})');
      const vids = await b.ev('(() => [...document.querySelectorAll(".tile video")].map(v => (v.closest(".tile--local")?"LOCAL":"REMOTE")+":"+v.videoWidth+"x"+v.videoHeight).join(" "))()');
      const ice = await b.ev('(async () => JSON.stringify(await window.__AUREX__.peerStats()))()');
      console.log(`[${b.name}] ${st}`);
      console.log(`[${b.name}] peers=${dbg}`);
      console.log(`[${b.name}] videos=${vids}`);
      console.log(`[${b.name}] ICE=${ice}`);
    }
  }
  A.kill(); C.kill();
  process.exit(0);
};
run().catch((e) => { console.error("FATAL", e.message); A.kill(); C.kill(); process.exit(1); });