// End-to-end verification: serves the project, drives it in headless
// Chromium over CDP, and checks the behaviours that unit tests cannot see.
// Usage: npm run verify   (needs a chromium binary; override with $CHROME)
// Exits non-zero if any check fails or the page logs a console error.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const CHROME = process.env.CHROME ?? "chromium";
const PORT = 8642;
const CDP_PORT = 9333;

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".md": "text/plain",
};

// --- Static server ----------------------------------------------------------

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
  const file = join(ROOT, path === "/" ? "index.html" : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(PORT, r));

// --- Chromium + CDP ---------------------------------------------------------

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    `--remote-debugging-port=${CDP_PORT}`,
    "--window-size=1440,900",
    `http://localhost:${PORT}/`,
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let page = null;
for (let tries = 0; tries < 40 && !page; tries++) {
  await sleep(250);
  try {
    const tabs = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
    page = tabs.find((t) => t.type === "page");
  } catch {
    /* not up yet */
  }
}
if (!page) {
  console.error("verify: could not reach headless chromium");
  process.exit(2);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();
const consoleErrors = [];

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg.result);
  if (msg.method === "Runtime.exceptionThrown")
    consoleErrors.push(msg.params.exceptionDetails.text);
  if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error")
    consoleErrors.push(msg.params.entry.text);
};
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
await send("Log.enable");

const evaluate = async (expression) => {
  const res = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.result?.subtype === "error") consoleErrors.push(res.result.description);
  return res.result?.value;
};
const wake = () => evaluate(`window.dispatchEvent(new PointerEvent('pointermove')); 0`);
const press = (key) =>
  evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', {key: '${key}'})); 0`);

// --- Checks -----------------------------------------------------------------

const failures = [];
function check(name, ok, detail = "") {
  console.log(`${ok ? " ok " : "FAIL"}  ${name}${ok ? "" : `  — ${detail}`}`);
  if (!ok) failures.push(name);
}

await sleep(600); // first frames

check("page exposes the state handle", (await evaluate(`typeof window.__state`)) === "object");

// Idle fade both ways.
const idleOn = await evaluate(
  `new Promise((r) => setTimeout(() => r(document.body.classList.contains('idle')), 3400))`,
);
check("idle fade engages after 3s", idleOn === true);
await wake();
check("pointer wakes the chrome", (await evaluate(`document.body.classList.contains('idle')`)) === false);

// Structure panel.
await evaluate(`document.getElementById('panel-toggle').click(); 0`);
const counts = await evaluate(
  `[...document.querySelectorAll('#panel tr')].map((r) => r.textContent.replace(/\\s+/g, '')).join('|')`,
);
check("n=4 counts and symmetries", counts === "vertices16|edges32|faces24|cells8|symmetries384", counts);
await evaluate(`document.getElementById('panel-toggle').click(); 0`);

// The B_n grid across dimensions: C(n,2) dots + n mirrors.
for (const [n, dots, mirrors] of [[5, 10, 5], [6, 15, 6], [4, 6, 4]]) {
  await press(String(n));
  const d = await evaluate(`document.querySelectorAll('.plane-dot:not(.mirror)').length`);
  const m = await evaluate(`document.querySelectorAll('.plane-dot.mirror').length`);
  check(`grid at n=${n} is ${dots}+${mirrors}`, d === dots && m === mirrors, `${d}+${m}`);
}

// Exact quarter-turn: dblclick composes R(i,j,pi/2) onto Q.
await press(" "); // freeze the preset motion so only the turn changes Q
const before = await evaluate(`JSON.stringify(window.__state.Q)`);
await evaluate(`
  document.querySelector('.plane-dot:not(.mirror)')
    .dispatchEvent(new MouseEvent('dblclick', {bubbles: true})); 0
`);
await sleep(1000);
const after = await evaluate(`JSON.stringify(window.__state.Q)`);
{
  const A = JSON.parse(before);
  const B = JSON.parse(after);
  // First grid dot is plane (0,1): rows 0 and 1 rotate, row 2+ unchanged.
  const close = (x, y) => Math.abs(x - y) < 1e-9;
  const rowsSwap = A[0].every((x, k) => close(B[0][k], -A[1][k]) && close(B[1][k], A[0][k]));
  const restFixed = A.slice(2).every((row, r) => row.every((x, k) => close(B[r + 2][k], x)));
  check("dblclick performs an exact quarter-turn in (x,y)", rowsSwap && restFixed);
}
check("paused indicator visible", (await evaluate(`document.getElementById('paused').hidden`)) === false);
await press(" ");
check("paused indicator clears", (await evaluate(`document.getElementById('paused').hidden`)) === true);

// Net view: mirrors leave, geometry swaps, 'within' pulls back to solid.
await press("u");
check("net view pressed", (await evaluate(`window.__state.view`)) === "net");
check(
  "mirrors hidden in net view",
  (await evaluate(`document.querySelectorAll('.plane-dot.mirror').length`)) === 0,
);
await evaluate(
  `[...document.querySelectorAll('#bar button')].find((b) => b.textContent === 'within').click(); 0`,
);
const pulled = await evaluate(`window.__state.view + '/' + window.__state.projection`);
check("'within' preset returns to the solid object", pulled === "solid/schlegel", pulled);
await press("p");

// Fit snap: right after switching geometry (solid n=5 -> net), nothing may
// overflow the frame — a slewing fit would leave border pixels lit.
await press("5");
await sleep(150);
await press("u");
await sleep(150);
const lit = await evaluate(`(() => {
  const c = document.getElementById('scene');
  const g = c.getContext('2d');
  const w = c.width, h = c.height;
  const strips = [
    g.getImageData(0, 0, w, 3),
    g.getImageData(0, h - 3, w, 3),
    g.getImageData(0, 0, 3, h),
    g.getImageData(w - 3, 0, 3, h),
  ];
  let n = 0;
  for (const s of strips)
    for (let k = 3; k < s.data.length; k += 4) if (s.data[k] > 10) n++;
  return n;
})()`);
check("fit snaps on geometry change (no overflow)", lit === 0, `${lit} border px`);
await press("u");

// Frame rate at the heaviest setting.
await press("6");
await evaluate(
  `[...document.querySelectorAll('#bar button')].find((b) => b.textContent === 'tumble').click(); 0`,
);
const measureFps = () =>
  evaluate(`
  new Promise((resolve) => {
    let frames = 0;
    const t0 = performance.now();
    const tick = () => {
      frames++;
      if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
      else resolve(Math.round(frames / 2));
    };
    requestAnimationFrame(tick);
  })
`);
let fps = await measureFps();
if (fps < 50) fps = Math.max(fps, await measureFps()); // absorb host-load spikes
check("fps >= 50 at n=6 tumble", fps >= 50, `${fps} fps`);

check("no console errors", consoleErrors.length === 0, consoleErrors.join(" | "));

// --- Teardown ---------------------------------------------------------------

ws.close();
chrome.kill();
server.close();
console.log(failures.length === 0 ? "\nverify: all checks passed" : `\nverify: ${failures.length} FAILED`);
process.exit(failures.length === 0 ? 0 : 1);
