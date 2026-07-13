// Visual QA: capture a deterministic matrix of screenshots — every
// dimension x view x projection, frontal and tilted pose, plus the
// animated specials (comet, mid-mirror) — for human inspection.
// Usage: node tools/shots.mjs [output-dir]   (default ./shots, gitignored)

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, sleep } from "./harness.mjs";
import { identity } from "../src/core/matrix.js";
import { applyPlaneRotation } from "../src/core/rotation.js";

const OUT = process.argv[2] ?? "shots";
await mkdir(OUT, { recursive: true });

const { send, evaluate, press, close } = await launch({
  name: "shots",
  port: 8643,
  cdpPort: 9334,
  windowSize: "900,650",
});
await sleep(600); // first frames
await press(" "); // pause: deterministic poses

async function shot(name) {
  await sleep(600); // let the fit slew settle on the new silhouette
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(OUT, name), Buffer.from(data, "base64"));
  console.log(`  ${name}`);
}

const setQ = (Q) => evaluate(`window.__state.Q = ${JSON.stringify(Q)}; 0`);
const setView = (view) =>
  evaluate(
    `if (window.__state.view !== "${view}")
       window.dispatchEvent(new KeyboardEvent("keydown", {key: "u"})); 0`,
  );

// A fixed off-axis pose: enough tilt to show depth in every mode without
// hiding any face behind another.
function tilted(n) {
  let Q = identity(n);
  Q = applyPlaneRotation(Q, 0, n - 1, 0.6);
  Q = applyPlaneRotation(Q, 1, n - 1, 0.35);
  if (n >= 3) Q = applyPlaneRotation(Q, 0, 2, 0.5);
  return Q;
}

for (let n = 2; n <= 6; n++) {
  await press(String(n));
  for (const view of ["solid", "net"]) {
    await setView(view);
    for (const [mode, key] of [
      ["perspective", "p"],
      ["orthographic", "o"],
      ["schlegel", "s"],
    ]) {
      await press(key);
      for (const [pose, Q] of [
        ["front", identity(n)],
        ["tilted", tilted(n)],
      ]) {
        await setQ(Q);
        await shot(`n${n}-${view}-${mode}-${pose}.png`);
      }
    }
  }
  await setView("solid");
}

// Animated specials at n = 4 (animations advance even while paused).
await press("4");
await press("p");
await setQ(identity(4));
await press("g");
await sleep(1200);
await shot("special-comet.png");
await press("g");

await setQ(tilted(4));
await evaluate(
  `document.querySelector(".plane-dot.mirror")
     .dispatchEvent(new MouseEvent("click", {bubbles: true})); 0`,
);
// shot() sleeps 600 ms, landing mid-collapse of the 1100 ms animation.
await shot("special-mirror-mid.png");

console.log(`shots: matrix written to ${OUT}/`);
close();
