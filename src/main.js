// Entry point: owns the app state, wires core -> render -> ui, runs the loop.

import { hypercube } from "./core/hypercube.js";
import { identity, orthonormalize } from "./core/matrix.js";
import { applyPlaneRotation, composeVelocities } from "./core/rotation.js";
import { createRenderer } from "./render/renderer.js";
import { createScene } from "./render/scene.js";
import { initControls } from "./ui/controls.js";
import { initPanel } from "./ui/panel.js";
import { presetByName } from "./ui/presets.js";

const MIN_N = 2;
const MAX_N = 6;
const REORTHO_EVERY = 300; // frames between Gram-Schmidt passes
const IDLE_MS = 3000;

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const state = {
  n: 4,
  geometry: hypercube(4),
  Q: identity(4),
  velocities: new Map(), // "i,j" -> omega (rad/s)
  projection: "perspective",
  preset: null,
  dolly: 1,
  paused: reducedMotion.matches,
  gray: false,
};

const actions = {
  setDimension(n) {
    if (n < MIN_N || n > MAX_N || n === state.n) return;
    state.n = n;
    state.geometry = hypercube(n);
    state.Q = identity(n); // a deliberate reset of gaze
    if (state.preset) {
      applyVelocities(presetByName(state.preset));
    } else {
      // Keep whatever active planes still exist in the new dimension.
      for (const key of [...state.velocities.keys()]) {
        const [, j] = key.split(",").map(Number);
        if (j >= n) state.velocities.delete(key);
      }
    }
    ghost.textContent = String(n);
    sync();
  },

  setProjection(mode) {
    if (!["perspective", "orthographic", "schlegel"].includes(mode)) return;
    state.projection = mode;
    sync();
  },

  applyPreset(name) {
    const preset = presetByName(name);
    if (!preset) return;
    state.preset = name;
    if (preset.projection) state.projection = preset.projection;
    applyVelocities(preset);
    sync();
  },

  togglePlane(key) {
    state.preset = null; // manual toggles diverge from the preset
    if (state.velocities.has(key)) state.velocities.delete(key);
    else state.velocities.set(key, 0.2);
    sync();
  },

  rotateBy(i, j, theta) {
    state.Q = applyPlaneRotation(state.Q, i, j, theta);
  },

  dollyBy(factor) {
    state.dolly = Math.min(4, Math.max(0.5, state.dolly * factor));
  },

  togglePause() {
    state.paused = !state.paused;
  },

  toggleGray() {
    state.gray = !state.gray;
    sync();
  },
};

function applyVelocities(preset) {
  state.velocities.clear();
  for (const { plane, omega } of preset.velocities(state.n))
    state.velocities.set(`${plane[0]},${plane[1]}`, omega);
}

// --- Wiring ---------------------------------------------------------------

const canvas = document.getElementById("scene");
const ghost = document.getElementById("ghost-n");
const renderer = createRenderer(canvas);
const scene = createScene(renderer);

const controls = initControls({
  bar: document.getElementById("bar"),
  planesEl: document.getElementById("planes"),
  canvas,
  state,
  actions,
});

const panel = initPanel({
  toggle: document.getElementById("panel-toggle"),
  panel: document.getElementById("panel"),
  state,
  actions,
});

function sync() {
  controls.update();
  panel.update();
}

ghost.textContent = String(state.n);
actions.applyPreset("stillness");

// A pose is shareable: ?n=5&projection=schlegel&preset=isocline&gray=1
const params = new URLSearchParams(location.search);
if (params.has("preset")) actions.applyPreset(params.get("preset"));
if (params.has("n")) actions.setDimension(Number(params.get("n")));
if (params.has("projection")) actions.setProjection(params.get("projection"));
if (params.get("gray") === "1") actions.toggleGray();

// --- Idle fade: after 3 s without input, only the object remains -----------

let idleTimer;
function wake() {
  document.body.classList.remove("idle");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add("idle"), IDLE_MS);
}
window.addEventListener("pointermove", wake);
window.addEventListener("pointerdown", wake);
window.addEventListener("keydown", wake);
wake();

// --- Loop -------------------------------------------------------------------

const parsedVelocities = () =>
  [...state.velocities.entries()].map(([key, omega]) => {
    const [i, j] = key.split(",").map(Number);
    return { plane: [i, j], omega };
  });

let last = performance.now();
let frames = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (!state.paused && state.velocities.size > 0) {
    state.Q = composeVelocities(state.Q, parsedVelocities(), dt);
  }
  if (++frames % REORTHO_EVERY === 0) state.Q = orthonormalize(state.Q);

  scene.draw(state, now / 1000);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
