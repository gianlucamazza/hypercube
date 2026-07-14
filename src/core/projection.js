// Projection cascade nD -> 3D -> 2D. Each stage consumes the last coordinate
// of every point and reports it as that stage's depth. Pure functions over
// arrays; the renderer decides what to do with the depths.
//
// Modes:
//   perspective  - perspective division at every stage
//   orthographic - drop coordinates above 3D, perspective only for 3D -> 2D
//   schlegel     - at the frontal pose, a genuine Schlegel projection with
//                  the first-stage viewpoint just outside a facet. During
//                  free rotation it follows the cloud support continuously;
//                  unless that support is a facet, this is Schlegel-style.
//
// Every perspective stage places its camera at
//   D = max(base distance, max depth + CLIP_MARGIN * max(extent, 1))
// except the Schlegel-style first stage, which sits just outside the cloud at
//   D = max depth + SCHLEGEL_MARGIN * max(extent, 1)
// The base distance (1.2*sqrt(d), dollied on the final stage) sets the look;
// the adaptive floor keeps the camera outside the point cloud. A fixed
// distance is NOT safe: perspective magnification compounds across stages
// (a stage multiplies all remaining coordinates by D/(D - depth), so a later
// stage can receive points far beyond the original circumradius), and the
// net geometry itself reaches coordinates past 2 — either way the fixed
// denominator D - depth could reach zero, spiking the image and mirroring
// vertices behind the camera. The floor guarantees denominator >= margin
// for every vertex at every stage, hence finite nonzero scales, while
// leaving all images that were already safe untouched.
//
// Boundedness theorem (docs/mathematics.md, section 4). Unconditionally,
// D - depth >= CLIP_MARGIN * max(extent, 1) > 0: every scale is finite and
// nonzero. (Not, by itself, positive: a Schlegel cloud entirely at negative
// depth would put D below zero.) When the input cloud contains an opposite-
// ray pair {alpha*x, -beta*x}, alpha,beta > 0, induction gives more: the
// pair's depths straddle zero, so maxDepth >= 0, D >= margin > 0, all scales
// are positive, and their generally unequal factors keep the two images on
// opposite rays. This hands the straddle to the next stage, while
// maxDepth <= extent bounds each stage's magnification by
// 1 + 1/CLIP_MARGIN. Every reachable cloud qualifies: the hypercube and the
// net's central cell contain exact antipodes initially, and rotations and the
// mirror's axis scaling are linear and odd.

export function perspectiveStep(v, distance) {
  const depth = v[v.length - 1];
  const scale = distance / (distance - depth);
  const p = new Array(v.length - 1);
  for (let i = 0; i < p.length; i++) p[i] = v[i] * scale;
  return { p, depth };
}

export function orthographicStep(v) {
  return { p: v.slice(0, -1), depth: v[v.length - 1] };
}

// Base camera distance for a stage working in d dimensions.
export function defaultDistance(d) {
  return 1.2 * Math.sqrt(d);
}

// Margin between the point cloud and an adaptive camera, as a fraction of
// the cloud's depth extent (floored at 1, the frontal cube's extent, so the
// classic frontal images keep their exact proportions). Above unit extent,
// scaling the margin with the cloud makes the adaptive term scale-invariant;
// below it the floor deliberately is not. A stage can magnify at most
// (extent + margin) / margin ~ 3.9x no matter how large the incoming points
// already are. At the frontal Schlegel first stage the margin is the whole
// viewpoint-to-facet distance (giving the classic ~4:1 nesting); for every
// other stage it is only a safety floor beneath the base distance.
export const SCHLEGEL_MARGIN = 0.35;
export const CLIP_MARGIN = 0.35;

function adaptiveMargin(maxDepth, minDepth) {
  return CLIP_MARGIN * Math.max(maxDepth - minDepth, 1);
}

export function project(vertices, options = {}) {
  const { mode = "perspective", dolly = 1 } = options;
  const n = vertices[0].length;
  const count = vertices.length;

  const points = vertices.map((v) => v.slice());
  const depth3 = n >= 3 ? new Array(count) : null;
  const depthW = n >= 4 ? new Array(count) : null;
  const stages = [];

  for (let d = n; d > 2; d--) {
    const first = d === n;

    let maxDepth = -Infinity;
    let minDepth = Infinity;
    for (const p of points) {
      if (p[d - 1] > maxDepth) maxDepth = p[d - 1];
      if (p[d - 1] < minDepth) minDepth = p[d - 1];
    }

    let distance = 0;
    let orthographic = false;
    if (mode === "schlegel" && first) {
      distance = maxDepth + SCHLEGEL_MARGIN * Math.max(maxDepth - minDepth, 1);
    } else if (mode === "orthographic" && d > 3) {
      orthographic = true;
    } else {
      const base = defaultDistance(d) * (d === 3 ? dolly : 1);
      distance = Math.max(base, maxDepth + adaptiveMargin(maxDepth, minDepth));
    }
    stages.push({ d, distance, minDepth, maxDepth, orthographic });

    for (let k = 0; k < count; k++) {
      const p = points[k];
      const depth = p[d - 1];
      if (first && depthW) depthW[k] = depth;
      if (d === 3) depth3[k] = depth;
      if (!orthographic) {
        const scale = distance / (distance - depth);
        for (let i = 0; i < d - 1; i++) p[i] *= scale;
      }
      p.length = d - 1;
    }
  }

  return { points, depth3, depthW, stages };
}
