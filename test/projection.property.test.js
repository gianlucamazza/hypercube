import { test } from "node:test";
import assert from "node:assert/strict";
import { project } from "../src/core/projection.js";
import { hypercube, cellVertices } from "../src/core/hypercube.js";
import { net } from "../src/core/net.js";
import { planeRotation, applyPlaneRotation } from "../src/core/rotation.js";
import { rotationPlanes } from "../src/core/combinatorics.js";
import {
  identity,
  orthonormalize,
  mulMatVec,
  mulMat,
} from "../src/core/matrix.js";
import { lcg, assertClose } from "./helpers.js";

// The projection cascade must stay bounded and finite for EVERY reachable
// pose: perspective magnification compounds across stages, the Schlegel
// stage feeds magnified points into later stages, and the net's
// circumradius (~2.6) exceeds the solid cube's sqrt(n)/2. These properties
// and the directed witnesses below pin the adaptive per-stage camera floor.

const MODES = ["perspective", "orthographic", "schlegel"];
const DOLLYS = [0.5, 1, 4];
// Two-tier guarantee. Theorem: with the adaptive camera floor every stage
// scale is positive and at most (extent + margin) / margin = 1.35/0.35, so
// projections are finite and sign-preserving (asserted exactly below).
// Empirical regression ceiling: max projected radius measured at 63.97 over
// 36,000 seeded poses (LCG seed 12345, n=2..6, both geometries, all modes,
// dolly {0.5, 1, 4}). The sweeps here are seeded, hence deterministic;
// raise this consciously only if the projection geometry changes.
const RADIUS_BOUND = 100;

function randomQ(n, rand, turns = 80) {
  let Q = identity(n);
  const planes = rotationPlanes(n);
  for (let k = 0; k < turns; k++) {
    const [i, j] = planes[Math.floor(rand() * planes.length)];
    Q = applyPlaneRotation(Q, i, j, (rand() * 2 - 1) * Math.PI);
  }
  return orthonormalize(Q);
}

// Orthogonal Q whose row `axis` is the unit vector `direction`.
function alignToAxis(n, direction, axis) {
  const norm = Math.hypot(...direction);
  const rows = [direction.map((x) => x / norm)];
  for (let i = 0; i < n; i++) {
    const e = new Array(n).fill(0);
    e[i] = 1;
    rows.push(e);
  }
  const basis = [];
  for (const row of rows) {
    const w = row.slice();
    for (const b of basis) {
      let d = 0;
      for (let k = 0; k < n; k++) d += w[k] * b[k];
      for (let k = 0; k < n; k++) w[k] -= d * b[k];
    }
    const wn = Math.hypot(...w);
    if (wn > 1e-9) basis.push(w.map((x) => x / wn));
    if (basis.length === n) break;
  }
  [basis[0], basis[axis]] = [basis[axis], basis[0]];
  return basis;
}

function maxRadius(points) {
  let m = 0;
  for (const p of points) {
    const r = Math.hypot(p[0], p[1]);
    if (!(r <= m)) m = r; // NaN falls through and poisons m
  }
  return m;
}

function assertBounded(vertices, opts, label) {
  const { points } = project(vertices, opts);
  for (const p of points)
    assert.ok(
      Number.isFinite(p[0]) && Number.isFinite(p[1]),
      `${label}: non-finite point`,
    );
  const r = maxRadius(points);
  assert.ok(r <= RADIUS_BOUND, `${label}: radius ${r.toFixed(1)}`);
  // Every stage scale must be positive, so projection preserves the sign of
  // the transverse coordinates. A violation is a behind-the-camera mirror
  // flip — bounded in radius, invisible to the checks above.
  for (let k = 0; k < points.length; k++) {
    for (const c of [0, 1]) {
      if (Math.abs(vertices[k][c]) < 0.05) continue;
      if (Math.abs(points[k][c]) < 1e-9) continue;
      assert.ok(
        Math.sign(points[k][c]) === Math.sign(vertices[k][c]),
        `${label}: mirror flip at vertex ${k} coord ${c}`,
      );
    }
  }
}

test("randomQ is orthogonal and rigid on hypercube edges", () => {
  for (let n = 2; n <= 6; n++) {
    const rand = lcg(1000 + n);
    const Q = randomQ(n, rand);
    const QQt = mulMat(
      Q,
      Q[0].map((_, j) => Q.map((row) => row[j])),
    );
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        assertClose(QQt[i][j], i === j ? 1 : 0, 1e-9, `QQt n=${n}`);
    const { vertices, edges } = hypercube(n);
    const rotated = vertices.map((v) => mulMatVec(Q, v));
    for (const [a, b] of edges) {
      const len = Math.hypot(...rotated[a].map((x, k) => x - rotated[b][k]));
      assertClose(len, 1, 1e-12, `edge rigidity n=${n}`);
    }
  }
});

test("projection is finite and bounded for random poses (seeded sweep)", () => {
  for (let n = 2; n <= 6; n++) {
    for (const geometry of [hypercube(n), net(n)]) {
      const rand = lcg(31 * n + geometry.vertices.length);
      for (let trial = 0; trial < 60; trial++) {
        const Q = randomQ(n, rand);
        const rotated = geometry.vertices.map((v) => mulMatVec(Q, v));
        for (const mode of MODES) {
          for (const dolly of DOLLYS) {
            assertBounded(
              rotated,
              { mode, dolly },
              `n=${n} verts=${geometry.vertices.length} ${mode} dolly=${dolly} trial=${trial} (seed ${31 * n + geometry.vertices.length})`,
            );
          }
        }
      }
    }
  }
});

// D2 — Schlegel n=4 under plain mouse drag (planes (0,2) and (1,2)): a
// near-cell corner can face the camera. Pre-fix this reached radius ~13,698.
test("witness: Schlegel n=4 stays bounded under the drag planes", () => {
  const { vertices } = hypercube(4);
  const STEPS = 60;
  for (let a = 0; a < STEPS; a++) {
    for (let b = 0; b < STEPS; b++) {
      let Q = planeRotation(4, 0, 2, (a / STEPS) * 2 * Math.PI - Math.PI);
      Q = mulMat(
        planeRotation(4, 1, 2, (b / STEPS) * 2 * Math.PI - Math.PI),
        Q,
      );
      const rotated = vertices.map((v) => mulMatVec(Q, v));
      assertBounded(rotated, { mode: "schlegel" }, `drag grid a=${a} b=${b}`);
    }
  }
});

// D3 — Schlegel n=5/6: the first stage magnifies a facet corner past the
// fixed distance of the NEXT stage (2.43 > 2.4 pre-fix), dolly-independent.
test("witness: Schlegel n=5,6 facet corner aligned to the next depth axis", () => {
  for (const n of [5, 6]) {
    const diagonal = new Array(n).fill(1);
    diagonal[n - 1] = 0; // stay inside the fixed cell
    const Q = alignToAxis(n, diagonal, n - 2);
    const rotated = hypercube(n).vertices.map((v) => mulMatVec(Q, v));
    for (const dolly of DOLLYS)
      assertBounded(
        rotated,
        { mode: "schlegel", dolly },
        `n=${n} dolly=${dolly}`,
      );
  }
});

// D4 — the net's tail reaches coordinate -2.5: rotating it toward the
// consumed axis crossed the fixed camera distance (division by zero).
test("witness: rotated nets stay bounded in every mode", () => {
  for (const [n, i, j] of [
    [3, 1, 2],
    [4, 1, 3],
    [4, 1, 2],
  ]) {
    const geometry = net(n);
    for (let k = 0; k <= 120; k++) {
      const theta = -Math.PI + (k / 120) * 2 * Math.PI;
      const Q = planeRotation(n, i, j, theta);
      const rotated = geometry.vertices.map((v) => mulMatVec(Q, v));
      for (const mode of MODES)
        assertBounded(
          rotated,
          { mode },
          `net(${n}) plane(${i},${j}) k=${k} ${mode}`,
        );
    }
  }
});

// D5 — orthographic drops to 3D norm-preserving: the main diagonal aligned
// with z exceeds the dollied-in camera (1.22 > 1.04 at n=6, dolly 0.5).
test("witness: orthographic main diagonal at closest dolly", () => {
  // The exact diagonal-to-z pose is degenerate (the offending vertex has
  // zero transverse part and projects to the origin even when mirrored);
  // a small tilt keeps its depth past the pole with a measurable x.
  for (const n of [5, 6]) {
    const aligned = alignToAxis(n, new Array(n).fill(1), 2);
    const Q = mulMat(planeRotation(n, 0, 2, -0.15), aligned);
    const rotated = hypercube(n).vertices.map((v) => mulMatVec(Q, v));
    assertBounded(rotated, { mode: "orthographic", dolly: 0.5 }, `n=${n}`);
  }
});

// D1 — perspective worst chain: per-stage worst depth x* = r^2/D compounds
// r' = r / sqrt(1 - (r/D)^2); the final coordinate is placed exactly at the
// pre-fix pole of the dollied final stage.
function worstChain(n, dolly) {
  const coords = new Array(n).fill(0);
  let radius = Math.sqrt(n) / 2;
  let accScale = 1;
  for (let d = n; d > 3; d--) {
    const D = 1.2 * Math.sqrt(d);
    const x = (radius * radius) / D;
    coords[d - 1] = x / accScale;
    const scale = D / (D - x);
    radius = Math.sqrt(radius * radius - x * x) * scale;
    accScale *= scale;
  }
  const D3 = 1.2 * Math.sqrt(3) * dolly;
  const x3 = Math.min(radius, D3);
  coords[2] = x3 / accScale;
  coords[0] = Math.sqrt(Math.max(0, radius * radius - x3 * x3)) / accScale;
  return coords;
}

test("witness: perspective worst-chain point at the pole", () => {
  for (const n of [4, 5, 6]) {
    for (const dolly of [0.5, 1]) {
      const cloud = [worstChain(n, dolly), new Array(n).fill(0)];
      assertBounded(
        cloud,
        { mode: "perspective", dolly },
        `n=${n} dolly=${dolly}`,
      );
    }
  }
});

// Legibility guard: the adaptive floor must not distort the frontal Schlegel
// diagram — near/far cell ratio stays classic (~3.86 today).
test("Schlegel near/far cell ratio stays in [2, 6] at identity", () => {
  const n = 4;
  const { vertices } = hypercube(n);
  const { points } = project(vertices, { mode: "schlegel" });
  const meanRadius = (idx) =>
    idx.reduce((s, i) => s + Math.hypot(...points[i]), 0) / idx.length;
  const ratio =
    meanRadius(cellVertices(n, n - 1, +1)) /
    meanRadius(cellVertices(n, n - 1, -1));
  assert.ok(ratio > 2 && ratio < 6, `ratio ${ratio.toFixed(3)}`);
});
