// Pure combinatorics for the n-cube. No DOM, no state.

export function binomial(n, k) {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

// counts[k] = number of k-dimensional elements of the n-cube: C(n,k) * 2^(n-k).
// counts[0] = vertices, counts[1] = edges, ..., counts[n] = the cube itself.
// Sum over k equals 3^n (each element picks -, 0 or + per coordinate).
export function elementCounts(n) {
  const counts = [];
  for (let k = 0; k <= n; k++) counts.push(binomial(n, k) * 2 ** (n - k));
  return counts;
}

// Binary-reflected Gray code: a Hamiltonian cycle on the n-cube graph Q_n.
// Consecutive entries (and last->first) differ in exactly one bit.
export function grayCode(n) {
  const seq = [];
  for (let i = 0; i < 2 ** n; i++) seq.push(i ^ (i >> 1));
  return seq;
}

// All C(n,2) rotation planes as axis pairs [i, j] with i < j, in canonical
// order: for n=4 that is xy, xz, xw, yz, yw, zw.
export function rotationPlanes(n) {
  const planes = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) planes.push([i, j]);
  return planes;
}

export const AXIS_NAMES = ["x", "y", "z", "w", "v", "u", "t"];

export function planeName([i, j]) {
  return AXIS_NAMES[i] + AXIS_NAMES[j];
}
