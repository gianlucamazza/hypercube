// Per-frame orchestration: rotate -> project -> depth-sort -> stroke.
// The scene owns only presentation state (smoothed fit scale); everything
// else arrives through the app state each frame.

import { mulMatVec } from "../core/matrix.js";
import { project } from "../core/projection.js";
import { grayCode } from "../core/combinatorics.js";
import { edgeStyle, faceStyle, accent } from "./palette.js";

const COMET_SPEED = 1; // vertices per second along the Gray cycle
const COMET_TRAIL = 10; // trailing segments

function normalize(values) {
  // Non-finite values (a violated projection assumption) must not poison
  // the min/max or the painter sort: skip them, map them to neutral.
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  if (!(range > 1e-9)) return values.map(() => 0.7);
  return values.map((v) => (Number.isFinite(v) ? (v - min) / range : 0.7));
}

export function createScene(renderer) {
  let fitScale = null;
  let fitGeometry = null;
  let fitMode = null;

  function draw(state, time) {
    const { geometry, Q, projection: mode, dolly, mirrorScale } = state;
    const { ctx } = renderer;

    // A running mirror animation scales one object axis from +1 through 0
    // to -1: the object collapses onto its (n-1)-shadow and re-inflates
    // reflected — one generator of B_n, watched happening.
    let source = geometry.vertices;
    if (mirrorScale) {
      const { axis, s } = mirrorScale;
      source = source.map((v) => {
        const w = v.slice();
        w[axis] *= s;
        return w;
      });
    }

    const rotated = source.map((v) => mulMatVec(Q, v));
    const { points, depth3, depthW } = project(rotated, { mode, dolly });

    // Fit the projection into the viewport. Rotation changes the silhouette
    // continuously, so the scale slews and the object breathes; a change of
    // geometry or projection is a discontinuity and snaps at once (a slew
    // there would let the new shape overflow the frame for a second).
    let maxR = 0;
    for (const p of points) {
      const r = Math.hypot(p[0], p[1]);
      if (r > maxR) maxR = r;
    }
    // A projection collapsed to a point (degenerate pose) must not divide
    // the fit by zero: hold the previous scale through the instant.
    const target =
      maxR > 1e-9
        ? (0.36 * Math.min(renderer.width, renderer.height)) / maxR
        : (fitScale ?? 1);
    if (fitScale == null || fitGeometry !== geometry || fitMode !== mode) {
      fitScale = target;
      fitGeometry = geometry;
      fitMode = mode;
    } else {
      fitScale += (target - fitScale) * 0.06;
    }

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

    // Face veils, only where they explain: in the Schlegel diagram the
    // translucent fills give the nested cells their volume.
    if (mode === "schlegel" && geometry.faces.length > 0) {
      const faceDepth = (f) =>
        depthT ? f.reduce((s, v) => s + depthT[v], 0) / f.length : 0.7;
      const faceOrder = [...geometry.faces].sort(
        (a, b) => faceDepth(a) - faceDepth(b),
      );
      for (const face of faceOrder) {
        const warm = warmT
          ? face.reduce((s, v) => s + warmT[v], 0) / face.length
          : null;
        ctx.fillStyle = faceStyle(faceDepth(face), warm);
        ctx.beginPath();
        ctx.moveTo(screen[face[0]][0], screen[face[0]][1]);
        for (let k = 1; k < face.length; k++)
          ctx.lineTo(screen[face[k]][0], screen[face[k]][1]);
        ctx.closePath();
        ctx.fill();
      }
    }

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

    // The comet's cycle indexes hypercube vertices; the net has its own.
    if (state.gray && state.view !== "net")
      drawComet(ctx, screen, geometry.n, time);
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

    // Fading trail behind the head. The trail may not exceed the cycle
    // (len = 4 at n = 2), and head - k goes negative, so wrap positively.
    const wrap = (i) => ((i % len) + len) % len;
    const trail = Math.min(COMET_TRAIL, len - 1);
    const head = Math.floor(pos);
    const frac = pos - head;
    for (let k = 0; k < trail; k++) {
      const from = screen[cycle[wrap(head - k)]];
      const to = screen[cycle[wrap(head - k + 1)]];
      const fade = (1 - k / trail) * 0.55;
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
