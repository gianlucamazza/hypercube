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

// Tiny seeded LCG for reproducible property tests. Log the seed in
// assertion messages so a failure can be replayed.
export function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// Determinant via Gaussian elimination with partial pivoting. Test-only:
// the runtime never needs determinants, only the tests pin det(Q) = +1.
export function det(A) {
  const n = A.length;
  const M = A.map((row) => row.slice());
  let d = 1;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++)
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (M[pivot][col] === 0) return 0;
    if (pivot !== col) {
      [M[pivot], M[col]] = [M[col], M[pivot]];
      d = -d;
    }
    d *= M[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      for (let c = col; c < n; c++) M[r][c] -= f * M[col][c];
    }
  }
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
