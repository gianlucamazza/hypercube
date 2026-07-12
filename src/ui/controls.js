// Controls choose what to contemplate; presets choose how it moves.
// This module builds the bottom bar and the plane grid, and wires direct
// manipulation (drag, wheel, keyboard). It renders FROM state via update();
// every interaction goes THROUGH the actions owned by main.js.

import {
  rotationPlanes,
  planeName,
  AXIS_NAMES,
} from "../core/combinatorics.js";
import { PRESETS } from "./presets.js";

const MIN_N = 2;
const MAX_N = 6;
const PROJECTIONS = ["perspective", "orthographic", "schlegel"];
const VIEWS = ["solid", "net"];

export function initControls({ bar, planesEl, canvas, state, actions }) {
  // --- Bottom bar -----------------------------------------------------
  const dimGroup = el("div", "group");
  const minus = button("−", () => actions.setDimension(state.n - 1));
  minus.setAttribute("aria-label", "lower dimension");
  const numeral = el("span", "numeral");
  const plus = button("+", () => actions.setDimension(state.n + 1));
  plus.setAttribute("aria-label", "raise dimension");
  dimGroup.append(minus, numeral, plus);

  const viewGroup = el("div", "group");
  const viewButtons = new Map();
  for (const view of VIEWS) {
    const b = button(view, () => actions.setView(view));
    viewButtons.set(view, b);
    viewGroup.append(b);
  }

  const projGroup = el("div", "group");
  const projButtons = new Map();
  for (const mode of PROJECTIONS) {
    const b = button(mode, () => actions.setProjection(mode));
    projButtons.set(mode, b);
    projGroup.append(b);
  }

  const presetGroup = el("div", "group");
  const presetButtons = new Map();
  for (const p of PRESETS) {
    const b = button(p.name, () => actions.applyPreset(p.name));
    b.title = p.note;
    presetButtons.set(p.name, b);
    presetGroup.append(b);
  }

  bar.append(dimGroup, viewGroup, projGroup, presetGroup);

  // --- Plane grid: the group B_n laid out as a matrix -------------------
  // Off-diagonal dots are the C(n,2) rotation planes; diagonal squares are
  // the n axis mirrors. Together they generate all 2^n·n! symmetries.
  let planeButtons = new Map();

  function buildPlaneGrid() {
    planesEl.textContent = "";
    planeButtons = new Map();
    planesEl.style.gridTemplateColumns = `repeat(${state.n}, auto)`;
    for (const plane of rotationPlanes(state.n)) {
      const [i, j] = plane;
      const key = `${i},${j}`;
      const name = planeName(plane);
      const b = button("", () => actions.togglePlane(key));
      b.className = "plane-dot";
      b.dataset.name = name;
      b.setAttribute("aria-label", `rotate in the ${name} plane`);
      b.style.gridRow = String(i + 1);
      b.style.gridColumn = String(j + 1);
      planeButtons.set(key, b);
      planesEl.append(b);
    }
    // Mirrors reflect the object itself: in the net view the unfolded cross
    // is not mirror-symmetric, so they stay solid-only.
    if (state.view !== "net") {
      for (let k = 0; k < state.n; k++) {
        const b = button("", () => actions.mirrorAxis(k));
        b.className = "plane-dot mirror";
        b.dataset.name = `mirror ${AXIS_NAMES[k]}`;
        b.setAttribute("aria-label", `reflect the ${AXIS_NAMES[k]} axis`);
        b.style.gridRow = String(k + 1);
        b.style.gridColumn = String(k + 1);
        planesEl.append(b);
      }
    }
  }

  // --- Direct manipulation --------------------------------------------
  // One pointer drags the two screen-facing planes (x/y against the
  // projected z); with Shift the hand reaches the highest axis instead.
  // Two pointers pinch the dolly. Wheel is a dolly too.
  const pointers = new Map();
  canvas.addEventListener("pointerdown", (e) => {
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers (tests) have no capture target; drag still works.
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    const cur = [e.clientX, e.clientY];
    if (pointers.size === 2) {
      const other = [...pointers.entries()].find(
        ([pid]) => pid !== e.pointerId,
      )?.[1];
      const dPrev = Math.hypot(prev[0] - other[0], prev[1] - other[1]);
      const dCur = Math.hypot(cur[0] - other[0], cur[1] - other[1]);
      if (dPrev > 0 && dCur > 0) actions.dollyBy(dPrev / dCur);
    } else if (pointers.size === 1) {
      const dx = cur[0] - prev[0];
      const dy = cur[1] - prev[1];
      const n = state.n;
      const depthAxis = e.shiftKey && n >= 4 ? n - 1 : Math.min(2, n - 1);
      const hAxis = 0;
      const vAxis = Math.min(1, depthAxis - 1);
      if (dx) actions.rotateBy(hAxis, depthAxis, dx * 0.006);
      if (dy && vAxis !== depthAxis)
        actions.rotateBy(vAxis, depthAxis, -dy * 0.006);
    }
    pointers.set(e.pointerId, cur);
  });
  const endDrag = (e) => {
    pointers.delete(e.pointerId);
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      actions.dollyBy(Math.exp(e.deltaY * 0.001));
    },
    { passive: false },
  );

  // --- Keyboard ---------------------------------------------------------
  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key >= String(MIN_N) && e.key <= String(MAX_N))
      actions.setDimension(Number(e.key));
    else if (e.key === "p") actions.setProjection("perspective");
    else if (e.key === "o") actions.setProjection("orthographic");
    else if (e.key === "s") actions.setProjection("schlegel");
    else if (e.key === "g") actions.toggleGray();
    else if (e.key === "u")
      actions.setView(state.view === "net" ? "solid" : "net");
    else if (e.key === " ") {
      e.preventDefault();
      actions.togglePause();
    }
  });

  // --- Reflect state ----------------------------------------------------
  let builtFor = "";

  function update() {
    numeral.textContent = String(state.n);
    minus.disabled = state.n <= MIN_N;
    plus.disabled = state.n >= MAX_N;
    const gridKey = `${state.n}:${state.view}`;
    if (builtFor !== gridKey) {
      buildPlaneGrid();
      builtFor = gridKey;
    }
    for (const [view, b] of viewButtons)
      b.setAttribute("aria-pressed", String(state.view === view));
    for (const [mode, b] of projButtons)
      b.setAttribute("aria-pressed", String(state.projection === mode));
    for (const [name, b] of presetButtons)
      b.setAttribute("aria-pressed", String(state.preset === name));
    for (const [key, b] of planeButtons)
      b.setAttribute("aria-pressed", String(state.velocities.has(key)));
  }

  return { update };
}

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function button(label, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}
