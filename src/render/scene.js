// Per-frame orchestration: rotate -> project -> depth-sort -> stroke.
// The scene owns only presentation state (smoothed fit scale); everything
// else arrives through the app state each frame.

import { hypercube } from "../core/hypercube.js";
import { mulMatVec } from "../core/matrix.js";
import { projectGroups } from "../core/projection.js";
import { edgeStyle, faceStyle, accent } from "./palette.js";
import { cometPath } from "./comet.js";
import { normalizeDepth, meanWarmth } from "./warmth.js";

export function createScene(renderer) {
  let fitScale = null;
  let fitKey = null;
  // Comet clock. `time` keeps running while paused; the comet must not.
  let cometNow = 0;
  let cometStamp = null;
  let cubeCache = null;
  let cubeN = -1;

  function cubeOf(n) {
    if (cubeN !== n) {
      cubeCache = hypercube(n);
      cubeN = n;
    }
    return cubeCache;
  }

  function draw(state, time) {
    const { geometry, Q, projection: mode, dolly, mirrorScale } = state;
    const { ctx } = renderer;
    const sectionView = state.view === "section";

    // A running mirror animation scales one object axis from +1 through 0
    // to -1: the object collapses onto its (n-1)-shadow and re-inflates
    // reflected — one generator of B_n, watched happening. Applied before
    // Q, and to every cloud this frame shares.
    const orient = (vertices) => {
      if (!vertices || vertices.length === 0) return [];
      return vertices.map((v) => {
        const w = mirrorScale ? v.slice() : v;
        if (mirrorScale) w[mirrorScale.axis] *= mirrorScale.s;
        return mulMatVec(Q, w);
      });
    };

    const groups = [];
    let ghostEdges = null;
    if (sectionView) {
      const cube = cubeOf(state.n);
      ghostEdges = cube.edges;
      groups.push(orient(cube.vertices));
    }
    groups.push(orient(geometry.vertices));
    const projected = projectGroups(groups, { mode, dolly });
    const ghost = sectionView ? projected[0] : null;
    const main = projected[projected.length - 1];

    if (cometStamp == null) cometStamp = time;
    if (!state.paused) cometNow += Math.max(0, time - cometStamp);
    cometStamp = time;

    // Fit the projection into the viewport. Rotation changes the silhouette
    // continuously, so the scale slews and the object breathes; a change of
    // dimension, view, or projection is a discontinuity and snaps at once
    // (a slew there would let the new shape overflow the frame for a second).
    // The section's height moves every frame, so the key must not be the
    // geometry object: that would snap the fit on every slice.
    let maxR = 0;
    const consider = (cloud) => {
      if (!cloud) return;
      for (const p of cloud.points) {
        const r = Math.hypot(p[0], p[1]);
        if (r > maxR) maxR = r;
      }
    };
    consider(ghost);
    consider(main);
    // A projection collapsed to a point (degenerate pose) must not divide
    // the fit by zero: hold the previous scale through the instant.
    const target =
      maxR > 1e-9
        ? (0.36 * Math.min(renderer.width, renderer.height)) / maxR
        : (fitScale ?? 1);
    const nextKey = `${state.n}:${state.view}:${mode}`;
    if (fitScale == null || fitKey !== nextKey) {
      fitScale = target;
      fitKey = nextKey;
    } else {
      fitScale += (target - fitScale) * 0.06;
    }

    // Negate y so mathematical +y is up. The canvas axis points down; without
    // this the same Q is a reflection of the WebXR picture.
    const toScreen = (pts) => pts.map((p) => [p[0] * fitScale, -p[1] * fitScale]);

    renderer.begin();

    // The cube under the knife, very faint, so both are visible. Drawn
    // before the slice; the slice then paints over it.
    if (ghost && ghostEdges) {
      const gScreen = toScreen(ghost.points);
      ctx.strokeStyle = accent(0.14);
      ctx.lineWidth = 0.7;
      for (const [a, b] of ghostEdges) {
        ctx.beginPath();
        ctx.moveTo(gScreen[a][0], gScreen[a][1]);
        ctx.lineTo(gScreen[b][0], gScreen[b][1]);
        ctx.stroke();
      }
    }

    // An empty slice (past the apex) has nothing to project. The wire remains.
    if (!main) return;

    const { points, depth3, extraDepths } = main;
    const screen = toScreen(points);
    const depthT = depth3 ? normalizeDepth(depth3) : null;
    const warmT = meanWarmth(extraDepths);

    const edgeDepth = (e) => (depthT ? (depthT[e[0]] + depthT[e[1]]) / 2 : 0.7);
    const order = geometry.edges
      .map((e, i) => i)
      .sort(
        (a, b) => edgeDepth(geometry.edges[a]) - edgeDepth(geometry.edges[b]),
      );

    // Face veils, only where they explain: in the Schlegel-style view the
    // translucent fills give the nested cells their volume. The section's
    // polygons are the figure itself, so they are drawn in every mode.
    const veil = sectionView || mode === "schlegel";
    if (veil && geometry.faces.length > 0) {
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

    // The apex is a single vertex: project() accepts it, and it reads as a dot.
    if (geometry.vertices.length === 1) {
      ctx.fillStyle = accent(0.9);
      ctx.beginPath();
      ctx.arc(screen[0][0], screen[0][1], 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // The comet's cycle indexes hypercube vertices. The net has its own
    // vertex list, and the section has none of those indices.
    if (state.gray && state.view === "solid")
      drawComet(ctx, screen, geometry.n, cometNow);
  }

  // The binary-reflected Gray code is a Hamiltonian cycle on Q_n: a single
  // point of light visits every vertex, changing one bit per step.
  function drawComet(ctx, screen, n, time) {
    const path = cometPath(n, time);
    const { cycle, len } = path;

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

    for (const seg of path.segments) {
      const a = screen[seg.from];
      const b = screen[seg.to];
      const x0 = a[0] + (b[0] - a[0]) * seg.t0;
      const y0 = a[1] + (b[1] - a[1]) * seg.t0;
      const x1 = a[0] + (b[0] - a[0]) * seg.t1;
      const y1 = a[1] + (b[1] - a[1]) * seg.t1;
      ctx.strokeStyle = accent(seg.fade * 0.55);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }

    // Head, interpolated along the current edge. The trail stops here.
    const a = screen[path.from];
    const b = screen[path.to];
    const x = a[0] + (b[0] - a[0]) * path.frac;
    const y = a[1] + (b[1] - a[1]) * path.frac;
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
