// Diegetic B_n lattice: C(n,2) plane dots + n axis mirrors, object-anchored
// to the left of the hypercube. Pure layout + hit targets; drawing is the
// renderer's job. No text atlas — circles (planes) and squares (mirrors).

import { rotationPlanes } from "../core/combinatorics.js";

export const LATTICE_SPACING = 0.032;
export const LATTICE_HIT_R = 0.016;
export const LATTICE_OFFSET = [-0.55, 0.05, 0]; // metres relative to object centre
export const IDLE_MS = 3000;

/**
 * Build world-space targets for the B_n grid.
 * @param {number} n
 * @param {number[]} objectOrigin world position of the hypercube centre
 * @param {object} state { view, velocities }
 * @returns {Array<{ kind:'plane'|'mirror', key?:string, axis?:number, pos:number[], active:boolean }>}
 */
export function buildLatticeTargets(n, objectOrigin, state) {
  const [ox, oy, oz] = objectOrigin;
  const [lx, ly, lz] = LATTICE_OFFSET;
  const targets = [];
  const planes = rotationPlanes(n);
  // Lay out as an upper-triangular visual matching the 2D grid: row i, col j.
  const cell = LATTICE_SPACING;
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

export function createXrUiChrome() {
  let lastInput = performance.now();
  let opacity = 1;

  function wake(now = performance.now()) {
    lastInput = now;
  }

  function update(now = performance.now()) {
    const idle = now - lastInput > IDLE_MS;
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

  return { wake, update, getOpacity };
}
