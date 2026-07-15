// Entry point: owns the app state, wires core -> render -> ui, runs the loop.
// WebXR is progressive enhancement: when immersive-vr is available the same
// state drives a stereoscopic WebGL wireframe of the 3-space intermediate.

import { hypercube } from "./core/hypercube.js";
import { net } from "./core/net.js";
import { identity, orthonormalize } from "./core/matrix.js";
import { applyPlaneRotation, composeVelocities } from "./core/rotation.js";
import { createRenderer } from "./render/renderer.js";
import { createScene } from "./render/scene.js";
import { createXrRenderer } from "./render/xr-renderer.js";
import {
  isImmersiveVrSupported,
  enterImmersiveVr,
  pollXrInput,
} from "./render/xr-session.js";
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
  view: "solid", // 'solid' | 'net' (the unfolded development)
  geometry: hypercube(4),
  Q: identity(4),
  velocities: new Map(), // "i,j" -> omega (rad/s)
  projection: "perspective",
  preset: null,
  dolly: 1,
  paused: reducedMotion.matches,
  gray: false,
  mirrorScale: null, // { axis, s } while a reflection animates
};

let mirrorAnim = null; // { axis, start }
const MIRROR_MS = 1100;
let quarterAnim = null; // { i, j, start, applied }
const QUARTER_MS = 700;

function rebuildGeometry() {
  state.geometry = state.view === "net" ? net(state.n) : hypercube(state.n);
}

const actions = {
  setDimension(n) {
    // Number.isInteger also rejects NaN from a malformed ?n= URL parameter.
    if (!Number.isInteger(n) || n < MIN_N || n > MAX_N || n === state.n) return;
    state.n = n;
    rebuildGeometry();
    state.Q = identity(n); // a deliberate reset of gaze
    mirrorAnim = null;
    state.mirrorScale = null;
    quarterAnim = null; // its plane indices may not exist in the new n
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

  setView(view) {
    if (!["solid", "net"].includes(view) || view === state.view) return;
    state.view = view;
    rebuildGeometry();
    state.Q = identity(state.n); // present the new shape frontally
    mirrorAnim = null;
    state.mirrorScale = null;
    quarterAnim = null; // a partial turn must not land on the fresh pose
    sync();
  },

  // One reflection of B_n, watched happening: scale the axis +1 -> -1,
  // collapsing the object through its (n-1)-shadow. The vertex set is
  // setwise invariant, so no permanent state is needed afterwards.
  mirrorAxis(axis) {
    if (axis >= state.n || mirrorAnim) return;
    mirrorAnim = { axis, start: performance.now() };
  },

  // An exact quarter-turn in one plane — the other generator of B_n.
  quarterTurn(key) {
    if (quarterAnim) return;
    const [i, j] = key.split(",").map(Number);
    if (j >= state.n) return;
    quarterAnim = { i, j, start: performance.now(), applied: 0 };
  },

  applyPreset(name) {
    const preset = presetByName(name);
    if (!preset) return;
    state.preset = name;
    if (preset.projection) {
      // A preset that chooses a projection speaks about the solid object;
      // Schlegel on the flat net (all w = 0) would be a silent no-op.
      actions.setView("solid");
      state.projection = preset.projection;
    }
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
    sync();
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
const pausedEl = document.getElementById("paused");
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

// WebXR chrome — declared before the first sync() so dimension/URL updates
// can refresh the progressive Enter VR control without a TDZ on vrButton.
const vrButton = document.getElementById("vr-enter");
let xrActive = false;
let xrStarting = false;
let xrSession = null;
let xrRefSpace = null;
let xrFloorRelative = true;
let xrRenderer = null;
let xrButtonStates = new Map();

function refreshVrButton() {
  if (!vrButton) return;
  // Stereo needs at least 3-space; hide the control otherwise.
  // Keep it visible during a session so a desktop mirror can exit via the UI.
  vrButton.hidden = !vrButton.dataset.supported || (state.n < 3 && !xrActive);
  vrButton.disabled = xrStarting;
  vrButton.setAttribute("aria-pressed", String(xrActive));
  vrButton.textContent = xrActive ? "exit vr" : "enter vr";
}

function sync() {
  controls.update();
  panel.update();
  pausedEl.hidden = !state.paused;
  refreshVrButton();
}

ghost.textContent = String(state.n);
actions.applyPreset("stillness");

// Honor a reduced-motion preference turned on mid-session, not only at load.
reducedMotion.addEventListener("change", (e) => {
  if (e.matches && !state.paused) actions.togglePause();
});

// A pose is shareable: ?n=5&view=net&projection=schlegel&preset=isocline&gray=1
const params = new URLSearchParams(location.search);
if (params.has("preset")) actions.applyPreset(params.get("preset"));
if (params.has("n")) actions.setDimension(Number(params.get("n")));
if (params.has("view")) actions.setView(params.get("view"));
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

function simulate(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (!state.paused && state.velocities.size > 0) {
    state.Q = composeVelocities(state.Q, parsedVelocities(), dt);
  }
  if (++frames % REORTHO_EVERY === 0) state.Q = orthonormalize(state.Q);

  if (mirrorAnim) {
    // Clamp so the s = -1 endpoint is rendered even after a frame hitch;
    // the scale is cleared on the frame after, which draws the identical
    // edge set (the vertex set is invariant under the full reflection).
    const t = Math.min(1, (now - mirrorAnim.start) / MIRROR_MS);
    state.mirrorScale = { axis: mirrorAnim.axis, s: Math.cos(Math.PI * t) };
    if (t >= 1) mirrorAnim = null;
  } else if (state.mirrorScale) {
    state.mirrorScale = null;
  }

  if (quarterAnim) {
    const t = Math.min(1, (now - quarterAnim.start) / QUARTER_MS);
    const eased = t * t * (3 - 2 * t);
    const target = (Math.PI / 2) * eased;
    state.Q = applyPlaneRotation(
      state.Q,
      quarterAnim.i,
      quarterAnim.j,
      target - quarterAnim.applied,
    );
    quarterAnim.applied = target;
    if (t >= 1) quarterAnim = null;
  }

  return dt;
}

function frame(now) {
  // Re-register first: an exception below must cost one frame, not
  // silently freeze the loop forever.
  requestAnimationFrame(frame);
  // While immersive, the XR rAF owns simulation and drawing.
  if (xrActive) return;
  simulate(now);
  scene.draw(state, now / 1000);
}

requestAnimationFrame(frame);

// --- WebXR (progressive enhancement) ----------------------------------------

async function startVr() {
  if (xrActive || xrStarting || state.n < 3) return;
  xrStarting = true;
  refreshVrButton();
  try {
    if (!xrRenderer) xrRenderer = createXrRenderer();
    const { session, refSpace, floorRelative } = await enterImmersiveVr(
      xrRenderer.gl,
    );
    xrSession = session;
    xrRefSpace = refSpace;
    xrFloorRelative = floorRelative;
    xrActive = true;
    xrStarting = false;
    xrButtonStates = new Map();
    last = performance.now();
    refreshVrButton();

    session.addEventListener("end", () => {
      xrActive = false;
      xrStarting = false;
      xrSession = null;
      xrRefSpace = null;
      xrButtonStates = new Map();
      last = performance.now();
      refreshVrButton();
      wake();
    });

    const onXRFrame = (time, xrFrame) => {
      if (!xrActive || !xrSession) return;
      xrSession.requestAnimationFrame(onXRFrame);
      const dt = simulate(time);

      const input = pollXrInput(xrSession, xrButtonStates);
      xrButtonStates = input.buttons;
      // Thumbstick: Y dollies, X rotates the screen-facing horizontal plane.
      // Secondary stick X (other hand, if stronger) already wins via max-abs.
      if (input.stickY) actions.dollyBy(Math.exp(-input.stickY * dt * 1.4));
      if (input.stickX) {
        const depthAxis = Math.min(2, state.n - 1);
        actions.rotateBy(0, depthAxis, input.stickX * dt * 1.6);
      }
      if (input.pressed.pause) actions.togglePause();
      if (input.pressed.exit) {
        xrSession.end().catch(() => {});
        return;
      }

      xrRenderer.draw(
        state,
        xrFrame,
        xrRefSpace,
        time / 1000,
        xrFloorRelative,
      );
    };
    session.requestAnimationFrame(onXRFrame);
  } catch (err) {
    console.warn("WebXR session failed:", err);
    xrActive = false;
    xrStarting = false;
    refreshVrButton();
  }
}

function toggleVr() {
  if (xrStarting) return;
  if (xrActive && xrSession) {
    xrSession.end().catch(() => {});
    return;
  }
  startVr();
}

if (vrButton) {
  vrButton.hidden = true;
  vrButton.addEventListener("click", () => {
    wake();
    toggleVr();
  });
  isImmersiveVrSupported().then((ok) => {
    if (ok) {
      vrButton.dataset.supported = "1";
      refreshVrButton();
    }
  });
}

// Read-only debug handle for tools/verify.mjs — not part of any API.
window.__state = state;
window.__xr = {
  get active() {
    return xrActive;
  },
};
