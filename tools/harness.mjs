// Shared scaffolding for the end-to-end tools: serves the project over
// HTTP, spawns headless Chromium against it, and exposes the DevTools
// protocol as send/evaluate/press helpers. Needs a chromium binary;
// override with $CHROME.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".md": "text/plain",
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({
  name,
  port = 8642,
  cdpPort = 9333,
  windowSize = "1440,900",
} = {}) {
  const CHROME = process.env.CHROME ?? "chromium";

  const server = createServer(async (req, res) => {
    const path = normalize(
      decodeURIComponent(new URL(req.url, "http://x").pathname),
    );
    const file = join(ROOT, path === "/" ? "index.html" : path);
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        "content-type": MIME[extname(file)] ?? "application/octet-stream",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(port, r));

  const chrome = spawn(
    CHROME,
    [
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      `--remote-debugging-port=${cdpPort}`,
      `--window-size=${windowSize}`,
      `http://localhost:${port}/`,
    ],
    { stdio: "ignore" },
  );
  chrome.on("error", (err) => {
    console.error(`${name}: could not launch ${CHROME}: ${err.message}`);
    server.close();
    process.exit(2);
  });

  let page = null;
  for (let tries = 0; tries < 40 && !page; tries++) {
    await sleep(250);
    try {
      const tabs = await (
        await fetch(`http://127.0.0.1:${cdpPort}/json`)
      ).json();
      page = tabs.find((t) => t.type === "page");
    } catch {
      /* not up yet */
    }
  }
  if (!page) {
    console.error(`${name}: could not reach headless chromium`);
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
  await send("Page.enable");

  const evaluate = async (expression) => {
    const res = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.result?.subtype === "error")
      consoleErrors.push(res.result.description);
    return res.result?.value;
  };
  const wake = () =>
    evaluate(`window.dispatchEvent(new PointerEvent('pointermove')); 0`);
  const press = (key) =>
    evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', {key: '${key}'})); 0`);

  const close = () => {
    ws.close();
    chrome.kill();
    server.close();
  };

  return { send, evaluate, press, wake, consoleErrors, close };
}
