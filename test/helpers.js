import assert from "node:assert/strict";

export function assertClose(actual, expected, eps = 1e-12, msg = "") {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `${msg} expected ${actual} ≈ ${expected} (eps ${eps})`,
  );
}

export function assertMatrixClose(A, B, eps = 1e-12, msg = "") {
  assert.equal(A.length, B.length, `${msg} row count`);
  for (let i = 0; i < A.length; i++)
    for (let j = 0; j < A[i].length; j++)
      assertClose(A[i][j], B[i][j], eps, `${msg} [${i}][${j}]`);
}

// Hamming distance recomputed from ±0.5 coordinates, not from indices —
// cross-checks the index -> coordinate mapping.
export function coordHamming(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

export function bitHamming(a, b) {
  let x = a ^ b;
  let d = 0;
  while (x) {
    d += x & 1;
    x >>= 1;
  }
  return d;
}
