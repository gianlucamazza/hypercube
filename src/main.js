// Entry point: owns the app state, wires core -> render -> ui, runs the loop.
// WebXR is progressive enhancement: when immersive-vr is available the same
// state drives a stereoscopic WebGL wireframe of the 3-space intermediate.

import { hypercube } from "./core/hypercube.js";
import { net } from "./core/net.js";
import { section, advanceCut } from "./core/section.js";
import { identity, orthonormalize } from "./core/matrix.js";
import {
  applyPlaneRotation,
  composeVelocities,
  mirroredOmega,
} from "./core/rotation.js";
import { createRenderer } from "./render/renderer.js";
import { createScene } from "./render/scene.js";
import {
  createXrRenderer,
  defaultWorldOffset,
  worldOffsetFromHead,
} from "./render/xr-renderer.js";
import { isImmersiveVrSupported, enterImmersiveVr } from "./render/xr-session.js";
import {
  createXrInput,
  sampleControllers,
  pickLattice,
  raySphereHit,
  latticeGesture,
} from "./render/xr-input.js";
import { buildLatticeTargets, createXrUiChrome } from "./render/xr-ui.js";
import { resolveXrConfig } from "./render/xr-config.js";
import { initControls } from "./ui/controls.js";
import { initPanel } from "./ui/panel.js";
import { PRESETS, presetByName } from "./ui/presets.js";
import { poseSearch, decodeQ, decodePlanes } from "./ui/pose-url.js";

const MIN_N = 2;
const MAX_N = 6;
const REORTHO_EVERY = 300; // frames between Gram-Schmidt passes
const IDLE_MS = 3000;

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const state = {
  n: 4,
  view: "solid", // 'solid' | 'net' | 'section'
  // Height of the diagonal cut Σ xᵢ = h. Null until the section view
  // starts the knife at the apex. `cutDir` is the sign of that sweep.
  cut: null,
  cutDir: -1,
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
let quarterAnim = null; // { i, j, start, progress, dir }
const QUARTER_MS = 700;
let vrToggleTimer = null;

function cancelVrToggle() {
  if (vrToggleTimer != null) {
    clearTimeout(vrToggleTimer);
    vrToggleTimer = null;
  }
}

function rebuildGeometry() {
  if (state.view === "net") {
    state.geometry = net(state.n);
    return;
  }
  if (state.view === "section") {
    const limit = state.n / 2;
    let h = Number.isFinite(state.cut) ? state.cut : limit;
    if (h > limit) h = limit;
    else if (h < -limit) h = -limit;
    state.cut = h;
    state.geometry = section(state.n, h);
    return;
  }
  state.geometry = hypercube(state.n);
}

const actions = {
  setDimension(n) {
    // Number.isInteger also rejects NaN from a malformed ?n= URL parameter.
    if (!Number.isInteger(n) || n < MIN_N || n > MAX_N || n === state.n) return;
    cancelVrToggle();
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
    const preset = state.preset && presetByName(state.preset);
    if (preset?.projection && preset.projection !== mode) state.preset = null;
    sync();
  },

  setView(view) {
    if (!["solid", "net", "section"].includes(view) || view === state.view) return;
    state.view = view;
    // Entering the cut with no held height starts at the apex and travels
    // toward the opposite one, so the first figure after the point is the
    // tetrahedron (n = 4) or the triangle (n = 3).
    if (view === "section" && !Number.isFinite(state.cut)) {
      state.cut = state.n / 2;
      state.cutDir = -1;
    }
    rebuildGeometry();
    state.Q = identity(state.n); // present the new shape frontally
    mirrorAnim = null;
    state.mirrorScale = null;
    quarterAnim = null; // a partial turn must not land on the fresh pose
    // A preset that names a projection (within) is about the solid object.
    if (presetByName(state.preset)?.projection && view !== "solid") {
      state.preset = null;
    }
    sync();
  },

  // One reflection of B_n, watched happening: scale the axis +1 -> -1,
  // collapsing the object through its (n-1)-shadow. Q is not conjugated —
  // absorbing the reflection would leave det −1. When the animation
  // finishes, simulate() reverses the planes through this axis.
  mirrorAxis(axis) {
    if (axis >= state.n || mirrorAnim) return;
    mirrorAnim = { axis, start: performance.now() };
  },

  // An exact quarter-turn in one plane — the other generator of B_n.
  quarterTurn(key) {
    if (quarterAnim || typeof key !== "string") return;
    const [i, j] = key.split(",").map(Number);
    if (
      !Number.isInteger(i) ||
      !Number.isInteger(j) ||
      i < 0 ||
      !(i < j) ||
      j >= state.n
    )
      return;
    quarterAnim = { i, j, start: performance.now(), progress: 0, dir: 1 };
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
    if (typeof key !== "string") return;
    const [i, j] = key.split(",").map(Number);
    if (
      !Number.isInteger(i) ||
      !Number.isInteger(j) ||
      i < 0 ||
      !(i < j) ||
      j >= state.n
    )
      return;
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
    // The comet indexes cube vertices. Disabling the control in the section
    // view must not clear a comet the solid view still owns.
    if (state.view === "section") return;
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

function refreshVrButton() {
  if (!vrButton) return;
  // Stereo needs at least 3-space; hide the control otherwise.
  // Keep it visible during a session so a desktop mirror can exit via the UI.
  vrButton.hidden = !vrButton.dataset.supported || (state.n < 3 && !xrActive);
  vrButton.disabled = xrStarting;
  vrButton.setAttribute("aria-pressed", String(xrActive));
  if (vrButton.dataset.fail && !xrActive && !xrStarting) {
    vrButton.textContent = "vr failed";
    vrButton.title = vrButton.dataset.fail;
  } else {
    vrButton.textContent = xrActive ? "exit vr" : "enter vr";
  }
}

let urlLive = false;
let urlTimer = null;
let urlDirty = false;

function scheduleUrl() {
  if (!urlLive) return;
  urlDirty = true;
  if (urlTimer != null) return;
  urlTimer = setTimeout(() => {
    urlTimer = null;
    if (!urlDirty) return;
    urlDirty = false;
    const next = poseSearch(location.search, state);
    if (next === location.search) return;
    history.replaceState(
      null,
      "",
      `${location.pathname}${next}${location.hash}`,
    );
  }, 300);
}

function sync() {
  controls.update();
  panel.update();
  pausedEl.hidden = !state.paused;
  refreshVrButton();
  scheduleUrl();
}

ghost.textContent = String(state.n);
actions.applyPreset("stillness");

// Honor a reduced-motion preference turned on mid-session, not only at load.
reducedMotion.addEventListener("change", (e) => {
  if (e.matches && !state.paused) actions.togglePause();
});

// A pose is shareable. Order: preset, then n, then view, then projection,
// then gray. A paused section may then hold `cut`. q comes last so a
// dimension or view reset cannot discard it. cam is the desktop camera
// factor; the name dolly belongs to the VR stick.
const params = new URLSearchParams(location.search);
const presetParam = params.get("preset");
if (presetParam && presetParam !== "custom") actions.applyPreset(presetParam);
if (params.has("n")) actions.setDimension(Number(params.get("n")));
if (params.has("view")) actions.setView(params.get("view"));
if (params.has("projection")) actions.setProjection(params.get("projection"));
// Assign, don't toggle: the section view refuses toggleGray, and a shared
// link may still carry the comet for when the view returns to the solid.
if (params.get("gray") === "1") state.gray = true;
if (presetParam === "custom") {
  state.preset = null;
  state.velocities = decodePlanes(params.get("planes") || "", state.n);
}
if (params.has("cam")) {
  const cam = Number(params.get("cam"));
  if (Number.isFinite(cam)) state.dolly = Math.min(4, Math.max(0.5, cam));
}
if (params.has("cut") && state.view === "section") {
  const cut = Number(params.get("cut"));
  if (Number.isFinite(cut)) {
    const limit = state.n / 2;
    state.cut = Math.min(limit, Math.max(-limit, cut));
    state.paused = true; // a held knife stays where the link put it
    rebuildGeometry();
  }
}
if (params.has("q")) {
  const Q = decodeQ(params.get("q"), state.n);
  if (Q) state.Q = Q;
}
sync();
urlLive = true;
scheduleUrl();

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

  // The knife is a motion of the view, not a slider and not a velocity
  // plane. Counts on the panel follow the slice; the URL does not, until
  // the sweep is paused (encodePose omits a moving cut).
  if (state.view === "section" && !state.paused) {
    const limit = state.n / 2;
    const h0 = Number.isFinite(state.cut) ? state.cut : limit;
    const moved = advanceCut(h0, state.cutDir, dt, limit);
    state.cutDir = moved.dir;
    if (moved.h !== h0) {
      state.cut = moved.h;
      rebuildGeometry();
      panel.update();
    }
  }

  if (mirrorAnim) {
    // Clamp so the s = -1 endpoint is rendered even after a frame hitch.
    // The wireframe matches again there: the vertex set is invariant.
    // Finishing conjugates Ω by the reflection (planes through the axis
    // reverse) while Q stays in SO(n). The scale clears on the next frame.
    const t = Math.min(1, (now - mirrorAnim.start) / MIRROR_MS);
    state.mirrorScale = { axis: mirrorAnim.axis, s: Math.cos(Math.PI * t) };
    if (t >= 1) {
      const axis = mirrorAnim.axis;
      let flipped = false;
      for (const [key, omega] of state.velocities) {
        const [i, j] = key.split(",").map(Number);
        const next = mirroredOmega(omega, i, j, axis);
        if (next !== omega) {
          state.velocities.set(key, next);
          flipped = true;
        }
      }
      if (flipped) state.preset = null;
      // An in-progress quarter-turn stores a direction, not an absolute
      // target: flipping the stored angle would jump. Reverse only the sense.
      if (quarterAnim && (quarterAnim.i === axis || quarterAnim.j === axis)) {
        quarterAnim.dir *= -1;
      }
      mirrorAnim = null;
      sync();
    }
  } else if (state.mirrorScale) {
    state.mirrorScale = null;
  }

  if (quarterAnim) {
    const t = Math.min(1, (now - quarterAnim.start) / QUARTER_MS);
    const eased = t * t * (3 - 2 * t);
    const progress = (Math.PI / 2) * eased;
    const delta = quarterAnim.dir * (progress - quarterAnim.progress);
    state.Q = applyPlaneRotation(
      state.Q,
      quarterAnim.i,
      quarterAnim.j,
      delta,
    );
    quarterAnim.progress = progress;
    if (t >= 1) quarterAnim = null;
  }

  scheduleUrl();
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

const xrInput = createXrInput();
const xrChrome = createXrUiChrome();
let xrConfig = resolveXrConfig();
let xrWorldOffset = defaultWorldOffset(true, xrConfig);
const PROJECTIONS = ["perspective", "orthographic", "schlegel"];
const HINT_KEY = "hypercube-vr-hinted";

function cyclePreset() {
  const names = PRESETS.map((p) => p.name);
  const i = names.indexOf(state.preset);
  const next = names[(i + 1) % names.length];
  actions.applyPreset(next);
}

function cycleProjection() {
  const i = PROJECTIONS.indexOf(state.projection);
  actions.setProjection(PROJECTIONS[(i + 1) % PROJECTIONS.length]);
}

async function startVr() {
  if (xrActive || xrStarting || state.n < 3) return;
  xrStarting = true;
  if (vrButton) delete vrButton.dataset.fail;
  refreshVrButton();
  try {
    // Field tuning: ?grab=3.2&radius=0.5&… — see docs/vr.md
    xrConfig = resolveXrConfig(location.search);
    if (!xrRenderer) xrRenderer = createXrRenderer(xrConfig);
    else xrRenderer.setConfig(xrConfig);
    xrInput.setConfig(xrConfig);
    xrChrome.setConfig(xrConfig);

    const { session, refSpace, floorRelative } = await enterImmersiveVr(
      xrRenderer.gl,
    );
    xrSession = session;
    xrRefSpace = refSpace;
    xrFloorRelative = floorRelative;
    xrWorldOffset = defaultWorldOffset(floorRelative, xrConfig);
    xrInput.reset();
    xrChrome.wake();
    xrRenderer.beginSession(performance.now());
    xrActive = true;
    xrStarting = false;
    last = performance.now();
    refreshVrButton();

    // First-run ghost hint: brief title on the page button; in-headset the
    // lattice itself teaches. Mark so we do not nag every session.
    try {
      if (!sessionStorage.getItem(HINT_KEY)) {
        sessionStorage.setItem(HINT_KEY, "1");
        if (vrButton)
          vrButton.title =
            "grip: turn · sticks: orbit/dolly · ray: planes · B: exit";
      }
    } catch {
      // sessionStorage may be blocked
    }

    session.addEventListener("end", () => {
      cancelVrToggle();
      xrActive = false;
      xrStarting = false;
      xrSession = null;
      xrRefSpace = null;
      last = performance.now();
      refreshVrButton();
      wake();
    });

    const onXRFrame = (time, xrFrame) => {
      if (!xrActive || !xrSession) return;
      xrSession.requestAnimationFrame(onXRFrame);
      const dt = simulate(time);
      const now = performance.now();

      const controllers = sampleControllers(
        xrSession,
        xrFrame,
        xrRefSpace,
        xrConfig,
      );
      const gesture = xrInput.step({
        controllers,
        dt,
        now,
        n: state.n,
      });

      if (gesture.wake || gesture.uiOpacityBoost) xrChrome.wake(now);
      for (const r of gesture.rotate) actions.rotateBy(r.i, r.j, r.theta);
      if (gesture.dollyFactor !== 1) actions.dollyBy(gesture.dollyFactor);
      if (gesture.pause) actions.togglePause();
      if (gesture.cyclePreset) cyclePreset();
      if (gesture.cycleProjection) cycleProjection();
      if (gesture.recenter) {
        const viewer = xrFrame.getViewerPose(xrRefSpace);
        if (viewer) {
          xrWorldOffset = worldOffsetFromHead(
            viewer.transform.matrix,
            xrFloorRelative,
            xrConfig,
          );
        }
      }
      if (gesture.exit) {
        xrSession.end().catch(() => {});
        return;
      }

      // Lattice in object-relative metres (renderer world matrix places it).
      const origin = [xrWorldOffset.x, xrWorldOffset.y, xrWorldOffset.z];
      const absTargets = buildLatticeTargets(
        state.n,
        origin,
        state,
        xrConfig,
      );
      const relTargets = absTargets.map((t) => ({
        ...t,
        pos: [
          t.pos[0] - origin[0],
          t.pos[1] - origin[1],
          t.pos[2] - origin[2],
        ],
      }));

      // Rays: world → object-relative. The ribbon ends on the nearest
      // lattice sphere; the pick itself stays an infinite ray.
      const hitRadius = xrConfig.latticeHitR * 1.15;
      const relRays = gesture.rays.map((ray) => {
        const rayOrigin = [
          ray.origin[0] - origin[0],
          ray.origin[1] - origin[1],
          ray.origin[2] - origin[2],
        ];
        let nearest = null;
        for (const target of relTargets) {
          const t = raySphereHit(
            rayOrigin,
            ray.direction,
            target.pos,
            hitRadius,
          );
          if (t != null && (nearest == null || t < nearest)) nearest = t;
        }
        return { ...ray, origin: rayOrigin, length: nearest ?? 3.2 };
      });

      const hit = pickLattice(relRays, relTargets, hitRadius);
      let hoverKey = null;
      if (hit) {
        hoverKey =
          hit.target.kind === "plane"
            ? hit.target.key
            : `m${hit.target.axis}`;
        xrChrome.wake(now);
        const gestureHit = latticeGesture(hit);
        if (gestureHit?.type === "quarter") {
          cancelVrToggle();
          actions.quarterTurn(gestureHit.key);
        } else if (gestureHit?.type === "arm-toggle") {
          cancelVrToggle();
          const key = gestureHit.key;
          vrToggleTimer = setTimeout(() => {
            vrToggleTimer = null;
            if (xrActive) actions.togglePlane(key);
          }, xrConfig.doubleMs);
        } else if (gestureHit?.type === "mirror") {
          cancelVrToggle();
          actions.mirrorAxis(gestureHit.axis);
        }
      }

      const latticeOpacity = xrChrome.update(now);

      xrRenderer.draw(state, xrFrame, xrRefSpace, time / 1000, {
        floorRelative: xrFloorRelative,
        worldOffset: xrWorldOffset,
        lattice: relTargets,
        latticeOpacity,
        rays: relRays,
        hoverKey,
        reducedMotion: reducedMotion.matches,
      });
    };
    session.requestAnimationFrame(onXRFrame);
  } catch (err) {
    console.warn("WebXR session failed:", err);
    xrActive = false;
    xrStarting = false;
    const reason = err && err.message ? String(err.message) : "unavailable";
    if (vrButton) {
      vrButton.dataset.fail = reason.length > 80 ? `${reason.slice(0, 77)}…` : reason;
    }
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
  vrButton.title = "enter immersive VR (Quest and other WebXR headsets)";
  vrButton.setAttribute("aria-live", "polite");
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
