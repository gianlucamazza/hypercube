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
import { assertClose, assertMatrixClose, det } from "./helpers.js";

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

test("handedness: a quarter-turn in (i,j) sends e_i to +e_j", () => {
  // Pins the sign convention itself. Orthogonality, inverses and the
  // shortcut-vs-matrix consistency are all invariant under transposing the
  // convention; only an absolute image detects a flipped chirality (the
  // drag direction and the verify quarter-turn both depend on it).
  const image = mulMatVec(planeRotation(2, 0, 1, Math.PI / 2), [1, 0]);
  assertClose(image[0], 0, 1e-12, "e_x image x");
  assertClose(image[1], 1, 1e-12, "e_x image y");
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
  // A non-identity starting pose: the fold must build on Q0, not restart.
  const Q0 = applyPlaneRotation(identity(4), 0, 2, 0.4);
  const velocities = [
    { plane: [0, 1], omega: 0.5 },
    { plane: [2, 3], omega: 0 },
    { plane: [0, 3], omega: -0.25 },
  ];
  const dt = 0.1;
  const expected = mulMat(
    planeRotation(4, 0, 3, -0.025),
    mulMat(planeRotation(4, 0, 1, 0.05), Q0),
  );
  assertMatrixClose(composeVelocities(Q0, velocities, dt), expected, 1e-12);
});

test("drift: 20000 small rotations, then orthonormalize -> QQt = I", () => {
  const n = 4;
  let Q = identity(n);
  for (let k = 0; k < 10000; k++) {
    Q = applyPlaneRotation(Q, k % 3, 3, 0.013);
    Q = applyPlaneRotation(Q, 0, 1 + (k % 2), -0.007);
  }
  Q = orthonormalize(Q);
  assertMatrixClose(mulMat(Q, transpose(Q)), identity(n), 1e-9);
  // The SO(n) half of the invariant: cleanup must not reflect the pose.
  assertClose(det(Q), 1, 1e-9, "det(Q) after drift + MGS");
});

// MGS factors A = L·Q with L lower-triangular and diag(L) the (positive) row
// norms, so det A = det L · det Q with det L > 0: re-orthonormalization
// preserves the determinant's sign. Pinned in both directions.
test("orthonormalize preserves orientation (det sign)", () => {
  const R = planeRotation(4, 1, 2, 0.6);
  assertClose(det(R), 1, 1e-12, "plane rotation is in SO(n)");

  // A drifted near-rotation (det > 0) stays det = +1 through MGS.
  const drifted = R.map((row, i) =>
    row.map((x, j) => x + 1e-4 * Math.sin(3 * i + 5 * j)),
  );
  assert.ok(det(drifted) > 0, "perturbation keeps det > 0");
  assertClose(det(orthonormalize(drifted)), 1, 1e-9, "det preserved at +1");

  // The same matrix reflected (det < 0) comes out det = -1, not +1.
  const reflected = drifted.map((row, i) =>
    i === 0 ? row.map((x) => -x) : row.slice(),
  );
  assert.ok(det(reflected) < 0, "negated row flips det sign");
  assertClose(det(orthonormalize(reflected)), -1, 1e-9, "det preserved at -1");
});

test("orthonormalize restores orthonormality from a visible perturbation", () => {
  // The drift test's input is already orthonormal to ~1e-13, so it cannot
  // distinguish MGS from a no-op. A 1e-2 perturbation can: only a genuine
  // re-orthonormalization brings QQt back to I at 1e-12.
  const R = planeRotation(4, 0, 3, 1.2);
  const noisy = R.map((row, i) =>
    row.map((x, j) => x + 1e-2 * Math.cos(7 * i + 3 * j)),
  );
  const Q = orthonormalize(noisy);
  assertMatrixClose(mulMat(Q, transpose(Q)), identity(4), 1e-12);
});

test("orthonormalize throws on rank-deficient input", () => {
  assert.throws(
    () =>
      orthonormalize([
        [1, 0],
        [1, 0],
      ]),
    /rank-deficient/,
  );
});
