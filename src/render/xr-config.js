// Single source of truth for VR comfort knobs. Defaults live here; field
// tuning on a headset can override a subset via URL query without rebuild:
//   ?grab=3.2&radius=0.5&deadzone=0.15&latticeX=-0.6&lineMax=0.003
// Unknown keys are ignored; values are clamped to safe ranges.

/** @typedef {typeof XR_DEFAULTS} XrConfig */

export const XR_DEFAULTS = Object.freeze({
  // --- Input / motion comfort --------------------------------------------
  deadzone: 0.12,
  stickRotate: 1.6, // rad/s at full stick
  stickDolly: 1.4,
  grabSens: 2.8, // rad per metre of grip travel
  maxDTheta: 0.12, // rad/frame clamp
  recenterHoldMs: 1000,
  doubleMs: 320,

  // --- Placement / scale -------------------------------------------------
  floorY: 1.25,
  headY: -0.15,
  worldZ: -1.8,
  targetRadius: 0.42, // metres, comfortable viewing size
  viewDistance: 1.8, // metres ahead on recenter
  enterMs: 800,

  // --- Diegetic B_n lattice ----------------------------------------------
  latticeSpacing: 0.032,
  latticeHitR: 0.016,
  latticeOffsetX: -0.55,
  latticeOffsetY: 0.05,
  latticeOffsetZ: 0,
  idleMs: 3000,

  // --- Wire thickness (metres half-width) --------------------------------
  edgeHalfWidthMin: 0.0009,
  edgeHalfWidthMax: 0.0024,
});

// Query aliases → config keys (short names for typing on a headset keyboard).
const QUERY_KEYS = Object.freeze({
  deadzone: "deadzone",
  rotate: "stickRotate",
  dolly: "stickDolly",
  grab: "grabSens",
  maxdtheta: "maxDTheta",
  recenter: "recenterHoldMs",
  floory: "floorY",
  heady: "headY",
  worldz: "worldZ",
  radius: "targetRadius",
  distance: "viewDistance",
  enter: "enterMs",
  spacing: "latticeSpacing",
  hitr: "latticeHitR",
  latticex: "latticeOffsetX",
  latticey: "latticeOffsetY",
  latticez: "latticeOffsetZ",
  idle: "idleMs",
  linemin: "edgeHalfWidthMin",
  linemax: "edgeHalfWidthMax",
});

// Inclusive [min, max] per config key.
const CLAMP = Object.freeze({
  deadzone: [0.02, 0.4],
  stickRotate: [0.2, 4],
  stickDolly: [0.2, 4],
  grabSens: [0.4, 8],
  maxDTheta: [0.02, 0.35],
  recenterHoldMs: [300, 3000],
  doubleMs: [150, 600],
  floorY: [0.6, 2.0],
  headY: [-0.5, 0.3],
  worldZ: [-3.5, -0.8],
  targetRadius: [0.15, 1.2],
  viewDistance: [0.8, 3.5],
  enterMs: [0, 2500],
  latticeSpacing: [0.015, 0.08],
  latticeHitR: [0.008, 0.04],
  latticeOffsetX: [-1.2, -0.2],
  latticeOffsetY: [-0.4, 0.4],
  latticeOffsetZ: [-0.4, 0.4],
  idleMs: [500, 10000],
  edgeHalfWidthMin: [0.0003, 0.003],
  edgeHalfWidthMax: [0.0006, 0.006],
});

export function clamp(key, value) {
  const range = CLAMP[key];
  if (!range || !Number.isFinite(value)) return XR_DEFAULTS[key];
  const [lo, hi] = range;
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Merge URL (or plain object) overrides onto defaults.
 * @param {string|URLSearchParams|Record<string,string>|null|undefined} source
 * @returns {XrConfig}
 */
export function parseXrConfig(source) {
  const cfg = { ...XR_DEFAULTS };
  if (source == null || source === "") return cfg;

  let params;
  if (typeof source === "string") {
    const q = source.startsWith("?") ? source.slice(1) : source;
    params = new URLSearchParams(q);
  } else if (source instanceof URLSearchParams) {
    params = source;
  } else if (typeof source === "object") {
    params = new URLSearchParams();
    for (const [k, v] of Object.entries(source)) {
      if (v != null) params.set(k, String(v));
    }
  } else {
    return cfg;
  }

  for (const [alias, key] of Object.entries(QUERY_KEYS)) {
    if (!params.has(alias)) continue;
    const text = params.get(alias);
    if (text == null || text.trim() === "") continue;
    const raw = Number(text);
    if (!Number.isFinite(raw)) continue;
    cfg[key] = clamp(key, raw);
  }

  // Keep min ≤ max for line width after independent clamps.
  if (cfg.edgeHalfWidthMin > cfg.edgeHalfWidthMax) {
    const mid = (cfg.edgeHalfWidthMin + cfg.edgeHalfWidthMax) / 2;
    cfg.edgeHalfWidthMin = mid;
    cfg.edgeHalfWidthMax = mid;
  }

  return cfg;
}

/** Resolve from the current page search string. */
export function resolveXrConfig(search = typeof location !== "undefined" ? location.search : "") {
  return parseXrConfig(search);
}

// Backward-compatible named exports matching previous module constants.
export const DEADZONE = XR_DEFAULTS.deadzone;
export const STICK_ROTATE = XR_DEFAULTS.stickRotate;
export const STICK_DOLLY = XR_DEFAULTS.stickDolly;
export const GRAB_SENS = XR_DEFAULTS.grabSens;
export const MAX_DTHETA = XR_DEFAULTS.maxDTheta;
export const RECENTER_HOLD_MS = XR_DEFAULTS.recenterHoldMs;
export const DOUBLE_MS = XR_DEFAULTS.doubleMs;
export const LATTICE_SPACING = XR_DEFAULTS.latticeSpacing;
export const LATTICE_HIT_R = XR_DEFAULTS.latticeHitR;
export const LATTICE_OFFSET = Object.freeze([
  XR_DEFAULTS.latticeOffsetX,
  XR_DEFAULTS.latticeOffsetY,
  XR_DEFAULTS.latticeOffsetZ,
]);
export const IDLE_MS = XR_DEFAULTS.idleMs;
export const FLOOR_Y = XR_DEFAULTS.floorY;
export const HEAD_Y = XR_DEFAULTS.headY;
export const WORLD_Z = XR_DEFAULTS.worldZ;
export const TARGET_RADIUS = XR_DEFAULTS.targetRadius;
export const ENTER_MS = XR_DEFAULTS.enterMs;
export const EDGE_HALF_WIDTH_MIN = XR_DEFAULTS.edgeHalfWidthMin;
export const EDGE_HALF_WIDTH_MAX = XR_DEFAULTS.edgeHalfWidthMax;
