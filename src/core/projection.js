// Projection cascade nD -> 3D -> 2D. Each step consumes the last coordinate
// of every point and reports it as that stage's depth. Pure functions over
// arrays; the renderer decides what to do with the depths.
//
// Modes:
//   perspective  - perspective division at every stage
//   orthographic - drop coordinates above 3D, perspective only for 3D -> 2D
//   schlegel     - perspective with the first-stage viewpoint just outside
//                  one cell, so the near cell maps large and the far cell
//                  nests inside it (cube-within-a-cube for n=4)

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

// Comfortable camera distance for a stage working in d dimensions: points
// stay within the circumradius sqrt(d)/2, so 1.2*sqrt(d) never clips.
export function defaultDistance(d) {
  return 1.2 * Math.sqrt(d);
}

// The Schlegel viewpoint rides just outside the object: its distance is the
// current maximum last-coordinate plus this margin. A fixed distance would
// blow up under rotation, when vertices sweep out to the circumradius and
// pass arbitrarily close to the viewpoint. With the margin the near cell
// stays about four times the far cell — the classic legible nesting.
export const SCHLEGEL_MARGIN = 0.35;

export function project(vertices, options = {}) {
  const { mode = "perspective", dolly = 1 } = options;
  const n = vertices[0].length;

  let schlegelDistance = 0;
  if (mode === "schlegel") {
    let maxLast = -Infinity;
    for (const v of vertices) if (v[n - 1] > maxLast) maxLast = v[n - 1];
    schlegelDistance = maxLast + SCHLEGEL_MARGIN;
  }

  const points = [];
  const depth3 = n >= 3 ? [] : null;
  const depthW = n >= 4 ? [] : null;

  for (const vertex of vertices) {
    let v = vertex;
    let first = true;
    while (v.length > 2) {
      const d = v.length;
      let step;
      if (mode === "schlegel" && first) {
        step = perspectiveStep(v, schlegelDistance);
      } else if (mode === "orthographic" && d > 3) {
        step = orthographicStep(v);
      } else {
        const distance = defaultDistance(d) * (d === 3 ? dolly : 1);
        step = perspectiveStep(v, distance);
      }
      if (first && depthW) depthW.push(step.depth);
      if (d === 3) depth3.push(step.depth);
      v = step.p;
      first = false;
    }
    points.push(v);
  }

  return { points, depth3, depthW };
}
