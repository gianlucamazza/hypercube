// End-to-end verification: serves the project, drives it in headless
// Chromium over CDP, and checks the behaviours that unit tests cannot see.
// Usage: npm run verify   (needs a chromium binary; override with $CHROME)
// Exits non-zero if any check fails or the page logs a console error.

import { launch, sleep } from "./harness.mjs";

const { evaluate, press, wake, consoleErrors, close } = await launch({
  name: "verify",
});

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

// Keyboard rotation: an arrow key must turn the pose like a drag would.
// Paused, so the preset motion cannot mask a dead handler.
{
  await press(" ");
  const qBefore = await evaluate(`JSON.stringify(window.__state.Q)`);
  await press("ArrowRight");
  await sleep(100);
  const qAfter = await evaluate(`JSON.stringify(window.__state.Q)`);
  check("arrow keys rotate the pose (paused)", qBefore !== qAfter);
  await press(" ");
}

// Regression: two paths that used to throw inside frame() and freeze the
// loop. (1) The comet trail at n=2: the cycle of 4 is shorter than the
// trail, and the wrap went negative whenever the head sat at position 0 —
// one second in every four, so 4.3 s of gray time guarantees crossing it.
// (2) A quarter-turn in a high plane surviving a shrink of the dimension:
// the last grid dot at n=6 is plane (4,5), which indexes past a 3x3 pose.
await press("2");
await press("g");
await sleep(4300);
await press("g");
await press("6");
await evaluate(`
  [...document.querySelectorAll('.plane-dot:not(.mirror)')].pop()
    .dispatchEvent(new MouseEvent('dblclick', {bubbles: true})); 0
`);
await press("3"); // mid-turn shrink
await sleep(200);
// Aliveness: Q advances only inside frame(), so a frozen loop (the browser
// still answers rAF regardless) shows up as a motionless pose.
const poseA = await evaluate(`JSON.stringify(window.__state.Q)`);
await sleep(400);
const poseB = await evaluate(`JSON.stringify(window.__state.Q)`);
check("loop survives the n=2 comet and a mid-turn shrink", poseA !== poseB);

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
// Robust to unset, empty, or garbage env values (Number("") is 0).
const fpsEnv = Number(process.env.FPS_MIN);
const FPS_MIN = Number.isFinite(fpsEnv) && fpsEnv > 0 ? fpsEnv : 50;
let fps = await measureFps();
if (fps < FPS_MIN) fps = Math.max(fps, await measureFps()); // absorb host-load spikes
check(`fps >= ${FPS_MIN} at n=6 tumble`, fps >= FPS_MIN, `${fps} fps`);

check("no console errors", consoleErrors.length === 0, consoleErrors.join(" | "));

// --- Teardown ---------------------------------------------------------------

close();
console.log(failures.length === 0 ? "\nverify: all checks passed" : `\nverify: ${failures.length} FAILED`);
process.exit(failures.length === 0 ? 0 : 1);
