// Per-frame orchestration: rotate -> project -> depth-sort -> stroke.
// The scene owns only presentation state (smoothed fit scale); everything
// else arrives through the app state each frame.

import { mulMatVec } from "../core/matrix.js";
import { project } from "../core/projection.js";
import { grayCode } from "../core/combinatorics.js";
import { edgeStyle, accent } from "./palette.js";

const COMET_SPEED = 1; // vertices per second along the Gray cycle
const COMET_TRAIL = 10; // trailing segments

function normalize(values) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  if (range < 1e-9) return values.map(() => 0.7);
  return values.map((v) => (v - min) / range);
}

export function createScene(renderer) {
  let fitScale = null;

  function draw(state, time) {
    const { geometry, Q, projection: mode, dolly } = state;
    const { ctx } = renderer;

    const rotated = geometry.vertices.map((v) => mulMatVec(Q, v));
    const { points, depth3, depthW } = project(rotated, { mode, dolly });

    // Fit the projection into the viewport, slewing slowly so the object
    // breathes instead of popping when its silhouette changes.
    let maxR = 0;
    for (const p of points) {
      const r = Math.hypot(p[0], p[1]);
      if (r > maxR) maxR = r;
    }
    const target = (0.36 * Math.min(renderer.width, renderer.height)) / maxR;
    fitScale =
      fitScale == null ? target : fitScale + (target - fitScale) * 0.06;

    const screen = points.map((p) => [p[0] * fitScale, p[1] * fitScale]);
    const depthT = depth3 ? normalize(depth3) : null;
    const warmT = depthW ? normalize(depthW) : null;

    const edgeDepth = (e) => (depthT ? (depthT[e[0]] + depthT[e[1]]) / 2 : 0.7);
    const order = geometry.edges
      .map((e, i) => i)
      .sort(
        (a, b) => edgeDepth(geometry.edges[a]) - edgeDepth(geometry.edges[b]),
      );

    renderer.begin();
    for (const i of order) {
      const [a, b] = geometry.edges[i];
      const warm = warmT ? (warmT[a] + warmT[b]) / 2 : null;
      const style = edgeStyle(edgeDepth(geometry.edges[i]), warm);
      ctx.strokeStyle = style.strokeStyle;
      ctx.lineWidth = style.lineWidth;
      ctx.beginPath();
      ctx.moveTo(screen[a][0], screen[a][1]);
      ctx.lineTo(screen[b][0], screen[b][1]);
      ctx.stroke();
    }

    if (state.gray) drawComet(ctx, screen, geometry.n, time);
  }

  // The binary-reflected Gray code is a Hamiltonian cycle on Q_n: a single
  // point of light visits every vertex, changing one bit per step.
  function drawComet(ctx, screen, n, time) {
    const cycle = grayCode(n);
    const len = cycle.length;
    const pos = (time * COMET_SPEED) % len;

    // Faint trace of the whole cycle.
    ctx.strokeStyle = accent(0.08);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k <= len; k++) {
      const p = screen[cycle[k % len]];
      if (k === 0) ctx.moveTo(p[0], p[1]);
      else ctx.lineTo(p[0], p[1]);
    }
    ctx.stroke();

    // Fading trail behind the head.
    const head = Math.floor(pos);
    const frac = pos - head;
    for (let k = 0; k < COMET_TRAIL; k++) {
      const from = screen[cycle[(head - k + len * 2) % len]];
      const to = screen[cycle[(head - k + 1 + len * 2) % len]];
      const fade = (1 - k / COMET_TRAIL) * 0.55;
      ctx.strokeStyle = accent(fade);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(from[0], from[1]);
      ctx.lineTo(to[0], to[1]);
      ctx.stroke();
    }

    // Head, interpolated along the current edge.
    const a = screen[cycle[head % len]];
    const b = screen[cycle[(head + 1) % len]];
    const x = a[0] + (b[0] - a[0]) * frac;
    const y = a[1] + (b[1] - a[1]) * frac;
    ctx.save();
    ctx.shadowColor = accent(0.9);
    ctx.shadowBlur = 10;
    ctx.fillStyle = accent(0.95);
    ctx.beginPath();
    ctx.arc(x, y, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  return { draw };
}
