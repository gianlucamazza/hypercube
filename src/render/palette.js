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
export function edgeStyle(depthT, warmT) {
  const presence = smoothstep(depthT);
  // The far floor stays clearly visible: depth reads as recession, but the
  // inner cells must never dissolve entirely.
  const alpha = lerp(0.26, 0.92, presence);
  const width = lerp(0.75, 2.0, presence);
  const [r, g, b] = warmT == null ? ICE : temperature(warmT);
  return {
    strokeStyle: `rgba(${r},${g},${b},${alpha.toFixed(3)})`,
    lineWidth: width,
  };
}

// Translucent face veils (Schlegel mode): a breath of the same temperature.
export function faceStyle(depthT, warmT) {
  const alpha = 0.02 + 0.055 * smoothstep(depthT);
  const [r, g, b] = warmT == null ? ICE : temperature(warmT);
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

// The Gray-code comet and its trail.
export const ACCENT = [255, 244, 224];

export function accent(alpha) {
  return `rgba(${ACCENT[0]},${ACCENT[1]},${ACCENT[2]},${alpha.toFixed(3)})`;
}
