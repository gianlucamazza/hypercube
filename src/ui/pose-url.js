// The shareable pose. Defaults stay out of the query so a still tesseract
// keeps a clean URL. `cam` is the final-stage camera factor (state.dolly);
// the name `dolly` belongs to the VR stick. `q` is the lab orientation when
// it has left the identity. `planes` is the velocity list once the motion
// is no longer a named preset (`preset=custom`). `cut` is the held height
// of the diagonal section: only a paused slice records it, so a playing
// sweep does not rewrite the URL every frame, and the key is not `cam`.
//
// Keys this module owns. Everything else in the query (VR comfort knobs)
// is preserved across writes.

import { orthonormalize } from "../core/matrix.js";

const POSE_KEYS = new Set([
  "n",
  "view",
  "projection",
  "preset",
  "gray",
  "cam",
  "q",
  "planes",
  "cut",
]);

function isNearIdentity(Q) {
  for (let i = 0; i < Q.length; i++) {
    for (let j = 0; j < Q.length; j++) {
      if (Math.abs(Q[i][j] - (i === j ? 1 : 0)) > 5e-5) return false;
    }
  }
  return true;
}

export function encodeQ(Q) {
  const nums = [];
  for (const row of Q) for (const x of row) nums.push(Number(x).toFixed(5));
  return nums.join(",");
}

export function decodeQ(text, n) {
  if (typeof text !== "string" || !text) return null;
  const parts = text.split(",").map(Number);
  if (parts.length !== n * n || parts.some((x) => !Number.isFinite(x))) return null;
  const Q = [];
  for (let i = 0; i < n; i++) Q.push(parts.slice(i * n, (i + 1) * n));
  try {
    return orthonormalize(Q);
  } catch {
    return null;
  }
}

export function encodePlanes(velocities) {
  const parts = [];
  for (const [key, omega] of velocities) {
    if (!Number.isFinite(omega) || omega === 0) continue;
    const [i, j] = key.split(",").map(Number);
    if (!Number.isInteger(i) || !Number.isInteger(j)) continue;
    parts.push(`${i}-${j}:${omega.toFixed(4)}`);
  }
  return parts.join(";");
}

export function decodePlanes(text, n) {
  const velocities = new Map();
  if (typeof text !== "string" || !text) return velocities;
  for (const part of text.split(";")) {
    const [ij, w] = part.split(":");
    if (!ij || w == null) continue;
    const [i, j] = ij.split("-").map(Number);
    const omega = Number(w);
    if (!Number.isInteger(i) || !Number.isInteger(j)) continue;
    if (i < 0 || j <= i || j >= n) continue;
    if (!Number.isFinite(omega) || omega === 0) continue;
    velocities.set(`${i},${j}`, omega);
  }
  return velocities;
}

export function encodePose(state) {
  const params = new URLSearchParams();
  if (state.n !== 4) params.set("n", String(state.n));
  if (state.view !== "solid") params.set("view", state.view);
  if (state.projection !== "perspective") params.set("projection", state.projection);
  if (state.preset == null) params.set("preset", "custom");
  else if (state.preset !== "stillness") params.set("preset", state.preset);
  if (state.gray) params.set("gray", "1");
  if (Math.abs(state.dolly - 1) > 5e-4) params.set("cam", state.dolly.toFixed(3));
  if (state.Q && !isNearIdentity(state.Q)) params.set("q", encodeQ(state.Q));
  if (state.preset == null) {
    const planes = encodePlanes(state.velocities);
    if (planes) params.set("planes", planes);
  }
  if (
    state.view === "section" &&
    state.paused &&
    Number.isFinite(state.cut)
  ) {
    params.set("cut", Number(state.cut).toFixed(4));
  }
  return params;
}

// Fold the pose into an existing query, preserving non-pose keys.
export function poseSearch(currentSearch, state) {
  const current = new URLSearchParams(
    currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch,
  );
  const next = new URLSearchParams();
  for (const [k, v] of current) {
    if (!POSE_KEYS.has(k)) next.append(k, v);
  }
  for (const [k, v] of encodePose(state)) next.set(k, v);
  const s = next.toString();
  return s ? `?${s}` : "";
}
