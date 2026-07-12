import { test } from "node:test";
import assert from "node:assert/strict";
import {
  identity,
  mulMat,
  mulMatVec,
  transpose,
  orthonormalize,
} from "../src/core/matrix.js";
import {
  planeRotation,
  applyPlaneRotation,
  composeVelocities,
} from "../src/core/rotation.js";
import { assertClose, assertMatrixClose } from "./helpers.js";

test("planeRotation is orthogonal and preserves norms", () => {
  for (const n of [3, 4, 6]) {
    const R = planeRotation(n, 0, n - 1, 0.7);
    assertMatrixClose(
      mulMat(R, transpose(R)),
      identity(n),
      1e-12,
      `RRt n=${n}`,
    );
    const v = Array.from({ length: n }, (_, i) => i + 0.5);
    const norm = (u) => Math.sqrt(u.reduce((s, x) => s + x * x, 0));
    assertClose(norm(mulMatVec(R, v)), norm(v), 1e-12, "norm preserved");
  }
});

test("rotation by theta then -theta is the identity", () => {
  const R1 = planeRotation(4, 1, 3, 1.1);
  const R2 = planeRotation(4, 1, 3, -1.1);
  assertMatrixClose(mulMat(R2, R1), identity(4), 1e-12);
});

test("rotation in plane (i,j) fixes all other coordinates", () => {
  const R = planeRotation(5, 1, 3, 0.9);
  const v = [1, 2, 3, 4, 5];
  const w = mulMatVec(R, v);
  assertClose(w[0], v[0]);
  assertClose(w[2], v[2]);
  assertClose(w[4], v[4]);
  assert.notEqual(w[1], v[1]);
  assert.notEqual(w[3], v[3]);
});

test("applyPlaneRotation equals explicit matrix multiplication", () => {
  // A non-trivial starting pose, so the shortcut is exercised off-identity.
  let Q = planeRotation(4, 0, 2, 0.4);
  Q = mulMat(planeRotation(4, 1, 3, -0.8), Q);
  const viaShortcut = applyPlaneRotation(Q, 0, 3, 0.31);
  const viaMatrix = mulMat(planeRotation(4, 0, 3, 0.31), Q);
  assertMatrixClose(viaShortcut, viaMatrix, 1e-12);
});

test("composeVelocities applies each active plane, skips omega=0", () => {
  const Q0 = identity(4);
  const velocities = [
    { plane: [0, 1], omega: 0.5 },
    { plane: [2, 3], omega: 0 },
    { plane: [0, 3], omega: -0.25 },
  ];
  const dt = 0.1;
  const expected = mulMat(
    planeRotation(4, 0, 3, -0.025),
    planeRotation(4, 0, 1, 0.05),
  );
  assertMatrixClose(composeVelocities(Q0, velocities, dt), expected, 1e-12);
});

test("drift: 10000 small rotations, then orthonormalize -> QQt = I", () => {
  const n = 4;
  let Q = identity(n);
  for (let k = 0; k < 10000; k++) {
    Q = applyPlaneRotation(Q, k % 3, 3, 0.013);
    Q = applyPlaneRotation(Q, 0, 1 + (k % 2), -0.007);
  }
  Q = orthonormalize(Q);
  assertMatrixClose(mulMat(Q, transpose(Q)), identity(n), 1e-9);
});
