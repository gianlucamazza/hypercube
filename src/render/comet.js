// The Gray-code comet, as geometry rather than pixels: where the head sits
// on the Hamiltonian cycle, and which segments of the trail lie behind it.
// Shared by the canvas and the WebXR renderer.

import { grayCode } from "../core/combinatorics.js";

export const COMET_SPEED = 1; // vertices per second
export const COMET_TRAIL = 10; // segments behind the head, capped by the cycle

// time in seconds. The head walks edge `head → head+1` up to fraction `frac`.
// Trail segments are the part already travelled: the partial current edge
// back to its start vertex, then full edges further behind. Nothing is drawn
// ahead of the head.
export function cometPath(n, time, speed = COMET_SPEED, trailLength = COMET_TRAIL) {
  const cycle = grayCode(n);
  const len = cycle.length;
  const pos = ((time * speed) % len + len) % len;
  const head = Math.floor(pos) % len;
  const frac = pos - Math.floor(pos);
  const wrap = (i) => ((i % len) + len) % len;
  const trail = Math.min(trailLength, len - 1);
  const segments = [];
  if (frac > 1e-4) {
    segments.push({
      from: cycle[head],
      to: cycle[(head + 1) % len],
      t0: 0,
      t1: frac,
      fade: 1,
    });
  }
  for (let k = 1; k < trail; k++) {
    segments.push({
      from: cycle[wrap(head - k)],
      to: cycle[wrap(head - k + 1)],
      t0: 0,
      t1: 1,
      fade: 1 - k / trail,
    });
  }
  return {
    cycle,
    len,
    head,
    frac,
    from: cycle[head],
    to: cycle[(head + 1) % len],
    segments,
  };
}
