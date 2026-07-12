// Rotations in n dimensions act on planes, not axes: a rotation in the
// coordinate plane (i, j) mixes those two coordinates and fixes the rest.
// There are C(n,2) such planes. Orientation is kept as an accumulated
// orthogonal matrix Q (plane rotations do not commute, so a vector of angles
// cannot represent a pose composed by interaction).

import { identity } from "./matrix.js";

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

// Fold a set of angular velocities over Q for a time step dt.
// velocities: iterable of { plane: [i, j], omega } with omega in rad/s.
export function composeVelocities(Q, velocities, dt) {
  let out = Q;
  for (const { plane, omega } of velocities) {
    if (omega === 0) continue;
    out = applyPlaneRotation(out, plane[0], plane[1], omega * dt);
  }
  return out;
}
