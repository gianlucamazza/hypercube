import { test } from "node:test";
import assert from "node:assert/strict";
import {
  perspectiveStep,
  orthographicStep,
  project,
  projectGroups,
} from "../src/core/projection.js";
import { hypercube, cellVertices } from "../src/core/hypercube.js";
import { assertClose } from "./helpers.js";

test("extraDepths lists every pre-3D axis, highest first", () => {
  const vertices = hypercube(6).vertices;
  const { depthW, extraDepths } = project(vertices, { mode: "orthographic" });
  assert.equal(extraDepths.length, 3);
  assert.deepEqual(extraDepths[0], depthW);
  for (let i = 0; i < vertices.length; i++) {
    assert.equal(extraDepths[0][i], vertices[i][5]);
    assert.equal(extraDepths[1][i], vertices[i][4]);
    assert.equal(extraDepths[2][i], vertices[i][3]);
  }
  const low = project(hypercube(3).vertices, { mode: "perspective" });
  assert.equal(low.extraDepths, null);
  assert.equal(low.depthW, null);
});

test("orthographicStep drops exactly the last coordinate", () => {
  const { p, depth } = orthographicStep([1, 2, 3, 4]);
  assert.deepEqual(p, [1, 2, 3]);
  assert.equal(depth, 4);
});

test("perspectiveStep: zero depth is unscaled, nearer points scale up", () => {
  const flat = perspectiveStep([1, 2, 0], 2);
  assertClose(flat.p[0], 1);
  assertClose(flat.p[1], 2);

  const near = perspectiveStep([1, 1, 0.5], 2);
  const far = perspectiveStep([1, 1, -0.5], 2);
  assert.ok(near.p[0] > 1, "near point magnified");
  assert.ok(far.p[0] < 1, "far point reduced");
});

test("perspectiveStep preserves x/y ratios", () => {
  const { p } = perspectiveStep([3, 5, 0.4], 2.4);
  assertClose(p[0] / p[1], 3 / 5);
});

test("perspective maps exact antipodes to opposite rays, not exact antipodes", () => {
  const near = perspectiveStep([1, 2, 0.5], 2).p;
  const far = perspectiveStep([-1, -2, -0.5], 2).p;
  // Collinear and oppositely directed: the invariant used by the cascade
  // boundedness proof. Unequal perspective factors change their magnitudes.
  assertClose(near[0] * far[1] - near[1] * far[0], 0, 1e-12);
  assert.ok(near[0] * far[0] + near[1] * far[1] < 0);
  assert.notEqual(Math.hypot(...near), Math.hypot(...far));
});

test("project returns 2-vectors and correct depth arrays for n = 2..6", () => {
  for (let n = 2; n <= 6; n++) {
    const { vertices } = hypercube(n);
    for (const mode of ["perspective", "orthographic", "schlegel"]) {
      const { points, depth3, depthW } = project(vertices, { mode });
      assert.equal(points.length, vertices.length);
      for (const p of points) assert.equal(p.length, 2);
      if (n >= 3) assert.equal(depth3.length, vertices.length);
      else assert.equal(depth3, null);
      if (n >= 4) assert.equal(depthW.length, vertices.length);
      else assert.equal(depthW, null);
    }
  }
});

test("all projected points are finite", () => {
  for (let n = 2; n <= 6; n++) {
    const { vertices } = hypercube(n);
    for (const mode of ["perspective", "orthographic", "schlegel"]) {
      const { points } = project(vertices, { mode });
      for (const p of points)
        assert.ok(
          Number.isFinite(p[0]) && Number.isFinite(p[1]),
          `${mode} n=${n}`,
        );
    }
  }
});

test("Schlegel n=4: the near cell projects outside the far cell", () => {
  const n = 4;
  const { vertices } = hypercube(n);
  const { points } = project(vertices, { mode: "schlegel" });
  const meanRadius = (indices) =>
    indices.reduce((s, i) => s + Math.hypot(...points[i]), 0) / indices.length;
  const near = meanRadius(cellVertices(n, n - 1, +1));
  const far = meanRadius(cellVertices(n, n - 1, -1));
  assert.ok(near > far, `cube-within-cube: ${near} > ${far}`);
});

test("Schlegel stays bounded while the object rotates", () => {
  const { vertices } = hypercube(4);
  // Sweep a rotation that carries vertices out to the circumradius along w.
  for (let k = 0; k <= 24; k++) {
    const theta = (k / 24) * Math.PI;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const rotated = vertices.map((v) => [
      c * v[0] - s * v[3],
      v[1],
      v[2],
      s * v[0] + c * v[3],
    ]);
    const { points } = project(rotated, { mode: "schlegel" });
    for (const p of points) {
      const r = Math.hypot(p[0], p[1]);
      assert.ok(Number.isFinite(r) && r < 30, `radius ${r} at theta ${theta}`);
    }
  }
});

test("dolly widens the final perspective (larger distance, flatter image)", () => {
  const { vertices } = hypercube(4);
  const tight = project(vertices, { dolly: 1 });
  const wide = project(vertices, { dolly: 3 });
  const spread = (pts) =>
    Math.max(...pts.map((p) => Math.hypot(...p))) -
    Math.min(...pts.map((p) => Math.hypot(...p)));
  assert.ok(spread(wide.points) < spread(tight.points));
});

test("stopAt 3 returns 3-vectors and no depth3 for n = 3..6", () => {
  for (let n = 3; n <= 6; n++) {
    const { vertices } = hypercube(n);
    for (const mode of ["perspective", "orthographic", "schlegel"]) {
      const { points, depth3, depthW } = project(vertices, {
        mode,
        stopAt: 3,
      });
      assert.equal(points.length, vertices.length);
      for (const p of points) assert.equal(p.length, 3);
      assert.equal(depth3, null);
      if (n >= 4) assert.equal(depthW.length, vertices.length);
      else assert.equal(depthW, null);
      for (const p of points)
        assert.ok(
          p.every(Number.isFinite),
          `finite stopAt:3 ${mode} n=${n}`,
        );
    }
  }
});

test("stopAt 3 pads n = 2 into the xy-plane of 3-space", () => {
  const { vertices } = hypercube(2);
  const { points, depth3, depthW } = project(vertices, { stopAt: 3 });
  assert.equal(depth3, null);
  assert.equal(depthW, null);
  for (const p of points) {
    assert.equal(p.length, 3);
    assert.equal(p[2], 0);
  }
});

test("stopAt 3 residual z matches full-cascade depth3 at the frontal pose", () => {
  // With no intermediate stage the residual z is exactly the coordinate the
  // 3→2 stage would consume. At n = 3 the cascade has only that stage.
  const { vertices } = hypercube(3);
  const full = project(vertices, { mode: "perspective" });
  const mid = project(vertices, { mode: "perspective", stopAt: 3 });
  for (let k = 0; k < vertices.length; k++) {
    assertClose(mid.points[k][2], full.depth3[k]);
  }
});

test("projectGroups shares one camera and keeps an empty group null", () => {
  const vertices = hypercube(4).vertices;
  const alone = project(vertices, { mode: "schlegel" });
  const [same, empty] = projectGroups([vertices, []], { mode: "schlegel" });
  assert.equal(empty, null);
  assert.deepEqual(same.points, alone.points);
  assert.deepEqual(same.depth3, alone.depth3);
  assert.deepEqual(same.extraDepths, alone.extraDepths);
});
