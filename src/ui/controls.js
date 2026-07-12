// Controls choose what to contemplate; presets choose how it moves.
// This module builds the bottom bar and the plane grid, and wires direct
// manipulation (drag, wheel, keyboard). It renders FROM state via update();
// every interaction goes THROUGH the actions owned by main.js.

import { rotationPlanes, planeName } from "../core/combinatorics.js";
import { PRESETS } from "./presets.js";

const MIN_N = 2;
const MAX_N = 6;
const PROJECTIONS = ["perspective", "orthographic", "schlegel"];

export function initControls({ bar, planesEl, canvas, state, actions }) {
  // --- Bottom bar -----------------------------------------------------
  const dimGroup = el("div", "group");
  const minus = button("−", () => actions.setDimension(state.n - 1));
  minus.setAttribute("aria-label", "lower dimension");
  const numeral = el("span", "numeral");
  const plus = button("+", () => actions.setDimension(state.n + 1));
  plus.setAttribute("aria-label", "raise dimension");
  dimGroup.append(minus, numeral, plus);

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

  bar.append(dimGroup, projGroup, presetGroup);

  // --- Plane grid: one dot per rotation plane, C(n,2) made tangible ---
  let planeButtons = new Map();

  function buildPlaneGrid() {
    planesEl.textContent = "";
    planeButtons = new Map();
    planesEl.style.gridTemplateColumns = `repeat(${state.n - 1}, auto)`;
    for (const plane of rotationPlanes(state.n)) {
      const [i, j] = plane;
      const key = `${i},${j}`;
      const name = planeName(plane);
      const b = button("", () => actions.togglePlane(key));
      b.className = "plane-dot";
      b.dataset.name = name;
      b.setAttribute("aria-label", `rotate in the ${name} plane`);
      b.style.gridRow = String(i + 1);
      b.style.gridColumn = String(j);
      planeButtons.set(key, b);
      planesEl.append(b);
    }
  }

  // --- Direct manipulation --------------------------------------------
  // Drag turns the two screen-facing planes (x/y against the projected z);
  // with Shift the hand reaches the highest axis instead. Wheel is a dolly.
  let dragging = null;
  canvas.addEventListener("pointerdown", (e) => {
    dragging = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - dragging.x;
    const dy = e.clientY - dragging.y;
    dragging = { x: e.clientX, y: e.clientY };
    const n = state.n;
    const depthAxis = e.shiftKey && n >= 4 ? n - 1 : Math.min(2, n - 1);
    const hAxis = 0;
    const vAxis = Math.min(1, depthAxis - 1);
    if (dx) actions.rotateBy(hAxis, depthAxis, dx * 0.006);
    if (dy && vAxis !== depthAxis)
      actions.rotateBy(vAxis, depthAxis, -dy * 0.006);
  });
  const endDrag = () => {
    dragging = null;
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
    else if (e.key === " ") {
      e.preventDefault();
      actions.togglePause();
    }
  });

  // --- Reflect state ----------------------------------------------------
  let builtForN = 0;

  function update() {
    numeral.textContent = String(state.n);
    minus.disabled = state.n <= MIN_N;
    plus.disabled = state.n >= MAX_N;
    if (builtForN !== state.n) {
      buildPlaneGrid();
      builtForN = state.n;
    }
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
