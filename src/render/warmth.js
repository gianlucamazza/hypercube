// Temperature from every axis the cascade drops before 3-space.
// Each stage is normalised on its own, then averaged, so a magnified
// intermediate axis cannot drown the others. One stage (n = 4) is the
// old w-channel unchanged.

export function normalizeDepth(values) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  if (!(range > 1e-9)) return values.map(() => 0.7);
  return values.map((v) => (Number.isFinite(v) ? (v - min) / range : 0.7));
}

export function meanWarmth(layers) {
  if (!layers || layers.length === 0) return null;
  const norms = layers.map(normalizeDepth);
  const n = norms[0].length;
  const out = new Array(n).fill(0);
  for (const layer of norms) {
    for (let i = 0; i < n; i++) out[i] += layer[i];
  }
  const inv = 1 / norms.length;
  for (let i = 0; i < n; i++) out[i] *= inv;
  return out;
}
