/**
 * Headless smoke test: loads each AUREX MEET route in real Chrome and reports
 * any console error, page exception or failed request. Uses the CDP over the
 * `ws` package that already ships with the server.
 */
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9222;
const BASE = process.argv[2] || 'http://127.0.0.1:5173';
const ROUTES = ['/', '/create', '/join', '/meeting/abc234jkmnpq', '/nope'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--no-first-run',
  '--disable-extensions',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=C:\\Users\\Surabhi\\AppData\\Local\\Temp\\opencode\\aurex-smoke\\ud-cdp',
  'about:blank',
], { stdio: 'ignore' });

let ws;
let id = 0;
const pending = new Map();
const problems = [];
let currentRoute = '';

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const messageId = ++id;
    pending.set(messageId, { resolve, reject });
    ws.send(JSON.stringify({ id: messageId, method, params }));
  });

const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result?.value;
};

const run = async () => {
  // Wait for the debugger endpoint.
  let target = null;
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  if (!target) throw new Error('Chrome debugger never became ready');

  ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
      return;
    }
    const { method, params } = msg;
    if (method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(params.type)) {
      const text = (params.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(' ');
      if (/favicon|Download the React DevTools|\[vite\]/i.test(text)) return;
      problems.push({ route: currentRoute, kind: `console.${params.type}`, text: text.slice(0, 300) });
    }
    if (method === 'Runtime.exceptionThrown') {
      const d = params.exceptionDetails;
      problems.push({
        route: currentRoute,
        kind: 'exception',
        text: `${d.text} ${d.exception?.description ?? ''}`.slice(0, 400),
      });
    }
    if (method === 'Log.entryAdded' && ['error'].includes(params.entry.level)) {
      if (/favicon/i.test(params.entry.text)) return;
      problems.push({ route: currentRoute, kind: `log.${params.entry.source}`, text: params.entry.text.slice(0, 300) });
    }
  });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Browser.grantPermissions', {
    origin: BASE,
    permissions: ['audioCapture', 'videoCapture'],
  }).catch(() => {});

  for (const route of ROUTES) {
    currentRoute = route;
    await send('Page.navigate', { url: `${BASE}${route}` });
    await sleep(2600);
    const h1 = await evaluate('document.querySelector("h1")?.textContent ?? ""');
    const buttons = await evaluate('[...document.querySelectorAll("button")].length');
    const inputs = await evaluate('[...document.querySelectorAll("input,textarea,select")].length');
    const unlabeled = await evaluate(
      '[...document.querySelectorAll("button")].filter(b => !b.textContent.trim() && !b.getAttribute("aria-label") && !b.getAttribute("title")).length',
    );
    const emptyRoot = await evaluate('document.getElementById("root").children.length === 0');
    console.log(
      `${route.padEnd(24)} h1="${h1}" buttons=${buttons} inputs=${inputs} unlabeledIconButtons=${unlabeled} emptyRoot=${emptyRoot}`,
    );
    if (emptyRoot) problems.push({ route, kind: 'render', text: 'React root stayed empty' });
  }

  console.log('\n--- diagnostics ---');
  if (problems.length === 0) console.log('No console errors, exceptions or failed requests.');
  for (const p of problems) console.log(`[${p.route}] ${p.kind}: ${p.text}`);
  const fatal = problems.filter((p) => p.kind !== 'console.warning');
  process.exitCode = fatal.length === 0 ? 0 : 1;
};

run()
  .catch((e) => {
    console.error('FATAL', e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    chrome.kill();
    await sleep(200);
    process.exit(process.exitCode ?? 0);
  });
