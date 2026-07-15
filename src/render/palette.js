// Visual encoding of the two depths the projection reports:
//   depth in 3-space  -> presence: alpha and line width (near is vivid)
//   depth in the 4th+ -> temperature: violet (far in w) through ice to amber
// The temperature arc is deliberately narrow: the fourth dimension should be
// felt as warmth, not read as a legend.

const ICE = [201, 212, 224];
const AMBER = [226, 195, 154];
const VIOLET = [143, 131, 207];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mix(c0, c1, t) {
  return [
    Math.round(lerp(c0[0], c1[0], t)),
    Math.round(lerp(c0[1], c1[1], t)),
    Math.round(lerp(c0[2], c1[2], t)),
  ];
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

// t in [0,1]: 0 cold (violet), 0.5 neutral ice, 1 warm (amber).
export function temperature(t) {
  return t < 0.5 ? mix(VIOLET, ICE, t * 2) : mix(ICE, AMBER, (t - 0.5) * 2);
}

// depthT in [0,1] (0 = farthest in 3-space); warmT in [0,1] or null (n < 4).
// Shared presence/temperature encoding for Canvas 2D and the WebGL path.
// Returns linear RGBA with channels in [0,1] (WebGL-native).
export function edgeColor(depthT, warmT) {
  const presence = smoothstep(depthT);
  // The far floor stays clearly visible: depth reads as recession, but the
  // inner cells must never dissolve entirely.
  const alpha = lerp(0.26, 0.92, presence);
  const [r, g, b] = warmT == null ? ICE : temperature(warmT);
  return [r / 255, g / 255, b / 255, alpha];
}

export function edgeStyle(depthT, warmT) {
  const [r, g, b, alpha] = edgeColor(depthT, warmT);
  const presence = smoothstep(depthT);
  // Width stays Canvas-only: WebGL lineWidth is not portable.
  const width = lerp(0.6, 2.0, presence);
  return {
    strokeStyle: `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${alpha.toFixed(3)})`,
    lineWidth: width,
  };
}

// Translucent face veils (Schlegel mode): a breath of the same temperature.
// WebGL-native RGBA in [0,1].
export function faceColor(depthT, warmT) {
  const alpha = 0.02 + 0.055 * smoothstep(depthT);
  const [r, g, b] = warmT == null ? ICE : temperature(warmT);
  return [r / 255, g / 255, b / 255, alpha];
}

export function faceStyle(depthT, warmT) {
  const [r, g, b, alpha] = faceColor(depthT, warmT);
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${alpha.toFixed(3)})`;
}

// Presence → half-width in metres for the XR thick-line path.
export function edgeHalfWidth(depthT) {
  const presence = smoothstep(depthT);
  return lerp(0.0009, 0.0024, presence); // ~1.8–4.8 mm diameter
}

// The Gray-code comet and its trail.
export const ACCENT = [255, 244, 224];
export const AMBER_RGB = [AMBER[0] / 255, AMBER[1] / 255, AMBER[2] / 255];
export const ICE_RGB = [ICE[0] / 255, ICE[1] / 255, ICE[2] / 255];

export function accent(alpha) {
  return `rgba(${ACCENT[0]},${ACCENT[1]},${ACCENT[2]},${alpha.toFixed(3)})`;
}

export function accentRgba(alpha) {
  return [ACCENT[0] / 255, ACCENT[1] / 255, ACCENT[2] / 255, alpha];
}
