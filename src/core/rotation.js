// Rotations in n dimensions act on planes, not axes: a rotation in the
// coordinate plane (i, j) mixes those two coordinates and fixes the rest.
// There are C(n,2) such planes. Orientation is kept as an accumulated
// orthogonal matrix Q (plane rotations do not commute, so a vector of angles
// cannot represent a pose composed by interaction).

import { identity, mulMat } from "./matrix.js";

export function planeRotation(n, i, j, theta) {
  const R = identity(n);
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  R[i][i] = c;
  R[j][j] = c;
  R[i][j] = -s;
  R[j][i] = s;
  return R;
}

// Q' = R(i,j,theta) . Q, touching only rows i and j: O(n^2) instead of O(n^3).
export function applyPlaneRotation(Q, i, j, theta) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const out = Q.map((row) => row.slice());
  for (let k = 0; k < Q[0].length; k++) {
    out[i][k] = c * Q[i][k] - s * Q[j][k];
    out[j][k] = s * Q[i][k] + c * Q[j][k];
  }
  return out;
}

// Matrix exponential by scaling, Taylor summation and squaring. The input in
// this module is skew-symmetric and at most 6x6. Scaling its infinity norm to
// <= 1/2 makes the series converge rapidly; the relative stopping criterion
// then drives the truncation below double-precision rounding error.
function matrixExponential(A) {
  const n = A.length;
  let norm = 0;
  for (const row of A) {
    let rowSum = 0;
    for (const x of row) rowSum += Math.abs(x);
    norm = Math.max(norm, rowSum);
  }

  const squarings = Math.max(0, Math.ceil(Math.log2(norm / 0.5)));
  const divisor = 2 ** squarings;
  const scaled = A.map((row) => row.map((x) => x / divisor));
  let sum = identity(n);
  let term = identity(n);

  for (let k = 1; k <= 64; k++) {
    term = mulMat(term, scaled).map((row) => row.map((x) => x / k));
    let termNorm = 0;
    let sumNorm = 0;
    for (let i = 0; i < n; i++) {
      let termRowSum = 0;
      let sumRowSum = 0;
      for (let j = 0; j < n; j++) {
        sum[i][j] += term[i][j];
        termRowSum += Math.abs(term[i][j]);
        sumRowSum += Math.abs(sum[i][j]);
      }
      termNorm = Math.max(termNorm, termRowSum);
      sumNorm = Math.max(sumNorm, sumRowSum);
    }
    if (termNorm <= Number.EPSILON * sumNorm) break;
    if (k === 64) throw new Error("matrixExponential: series did not converge");
  }

  for (let k = 0; k < squarings; k++) sum = mulMat(sum, sum);
  return sum;
}

// Integrate simultaneous constant plane velocities exactly in continuous
// time (up to floating-point evaluation of exp): Q' = Omega Q, hence
// Q(t + dt) = exp(dt Omega) Q(t). Aggregating the skew generator first is
// essential because rotations in intersecting planes do not commute; unlike
// a sequential fold, this result is independent of iterable order.
// velocities: iterable of { plane: [i, j], omega } with omega in rad/s.
export function composeVelocities(Q, velocities, dt) {
  const n = Q.length;
  const generator = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const { plane, omega } of velocities) {
    if (omega === 0) continue;
    const [i, j] = plane;
    generator[i][j] -= omega * dt;
    generator[j][i] += omega * dt;
  }
  return mulMat(matrixExponential(generator), Q);
}
