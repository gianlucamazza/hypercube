// Diegetic B_n lattice: C(n,2) plane dots + n axis mirrors, object-anchored
// to the left of the hypercube. Pure layout + hit targets; drawing is the
// renderer's job. No text atlas — circles (planes) and squares (mirrors).

import { rotationPlanes } from "../core/combinatorics.js";
import {
  XR_DEFAULTS,
  LATTICE_SPACING,
  LATTICE_HIT_R,
  LATTICE_OFFSET,
  IDLE_MS,
} from "./xr-config.js";

export { LATTICE_SPACING, LATTICE_HIT_R, LATTICE_OFFSET, IDLE_MS };

/**
 * Build world-space targets for the B_n grid.
 * @param {number} n
 * @param {number[]} objectOrigin world position of the hypercube centre
 * @param {object} state { view, velocities }
 * @param {object} [cfg]
 */
export function buildLatticeTargets(n, objectOrigin, state, cfg = XR_DEFAULTS) {
  const [ox, oy, oz] = objectOrigin;
  const lx = cfg.latticeOffsetX ?? LATTICE_OFFSET[0];
  const ly = cfg.latticeOffsetY ?? LATTICE_OFFSET[1];
  const lz = cfg.latticeOffsetZ ?? LATTICE_OFFSET[2];
  const targets = [];
  const planes = rotationPlanes(n);
  const cell = cfg.latticeSpacing ?? LATTICE_SPACING;
  const originX = ox + lx - ((n - 1) * cell) / 2;
  const originY = oy + ly + ((n - 1) * cell) / 2;
  const z = oz + lz;

  for (const [i, j] of planes) {
    const key = `${i},${j}`;
    targets.push({
      kind: "plane",
      key,
      pos: [originX + j * cell, originY - i * cell, z],
      active: state.velocities.has(key),
    });
  }
  if (state.view !== "net") {
    for (let k = 0; k < n; k++) {
      targets.push({
        kind: "mirror",
        axis: k,
        pos: [originX + k * cell, originY - k * cell, z],
        active: false,
      });
    }
  }
  return targets;
}

export function createXrUiChrome(cfg = XR_DEFAULTS) {
  let lastInput = performance.now();
  let opacity = 1;
  let idleMs = cfg.idleMs ?? IDLE_MS;

  function setConfig(next) {
    idleMs = next.idleMs ?? IDLE_MS;
  }

  function wake(now = performance.now()) {
    lastInput = now;
  }

  function update(now = performance.now()) {
    const idle = now - lastInput > idleMs;
    const target = idle ? 0 : 1;
    // Smooth fade matching the 2D chrome dissolve.
    opacity += (target - opacity) * (idle ? 0.08 : 0.2);
    if (opacity < 0.01) opacity = 0;
    if (opacity > 0.99) opacity = 1;
    return opacity;
  }

  function getOpacity() {
    return opacity;
  }

  return { wake, update, getOpacity, setConfig };
}
