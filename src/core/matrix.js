// Minimal dense matrix helpers over number[][] (row-major).
// Matrices here are at most 6x6; clarity beats typed-array micro-performance.

export function identity(n) {
  const A = [];
  for (let i = 0; i < n; i++) {
    const row = new Array(n).fill(0);
    row[i] = 1;
    A.push(row);
  }
  return A;
}

export function mulMat(A, B) {
  const n = A.length;
  const m = B[0].length;
  const k = B.length;
  const C = [];
  for (let i = 0; i < n; i++) {
    const row = new Array(m).fill(0);
    for (let p = 0; p < k; p++) {
      const a = A[i][p];
      if (a === 0) continue;
      for (let j = 0; j < m; j++) row[j] += a * B[p][j];
    }
    C.push(row);
  }
  return C;
}

export function mulMatVec(A, v) {
  const n = A.length;
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < v.length; j++) s += A[i][j] * v[j];
    out[i] = s;
  }
  return out;
}

export function transpose(A) {
  return A[0].map((_, j) => A.map((row) => row[j]));
}

// Modified Gram-Schmidt on rows. Returns a new matrix with orthonormal rows;
// used to remove numerical drift from an accumulated rotation matrix.
export function orthonormalize(A) {
  const n = A.length;
  const Q = A.map((row) => row.slice());
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      let dot = 0;
      for (let k = 0; k < n; k++) dot += Q[i][k] * Q[j][k];
      for (let k = 0; k < n; k++) Q[i][k] -= dot * Q[j][k];
    }
    let norm = 0;
    for (let k = 0; k < n; k++) norm += Q[i][k] * Q[i][k];
    norm = Math.sqrt(norm);
    for (let k = 0; k < n; k++) Q[i][k] /= norm;
  }
  return Q;
}
