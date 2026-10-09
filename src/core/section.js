// Diagonal section of the n-cube. The knife is the affine hyperplane
// Σ xᵢ = h, fixed in the body. Coordinates are the usual ±1/2, so a
// vertex sum is k − n/2 for k positive coordinates, and the two ends of
// any edge differ by exactly 1. A square never lies in this plane: its
// four sums span an interval of length 2. The intersection of the plane
// with a square is therefore a point or a segment, and that segment is an
// edge of the section — a face diagonal when the plane passes through two
// opposite corners, not a side of the cube.
//
// The 2-faces of the section are the intersections with the cubic 3-cells.
// Each such intersection is one convex polygon. The 3-faces are the
// intersections with the 4-cells: a closed polyhedron, or nothing. At n = 5
// that 3-face list is what makes the slice a 4-polytope rather than a
// soup of polygons.

import { hypercube } from "./hypercube.js";

// Half a coordinate step past this, a vertex is on the plane. The tests
// use exact layer heights, which sit many orders of magnitude further away.
export const SECTION_EPS = 1e-9;

// The knife's own motion, in sum-units per second. Slow enough that the
// tetrahedron and the octahedron are readable as they pass.
export const CUT_SPEED = 0.08;

// Travel from one apex toward the other and turn around. `dir` is the sign
// of the motion. The height stays inside [-limit, limit].
export function advanceCut(h, dir, dt, limit, speed = CUT_SPEED) {
  const sense = dir === 1 ? 1 : -1;
  let next = h + sense * speed * dt;
  let nextDir = sense;
  if (next >= limit) {
    next = limit;
    nextDir = -1;
  } else if (next <= -limit) {
    next = -limit;
    nextDir = 1;
  }
  return { h: next, dir: nextDir };
}

function chooseAxes(n, dim) {
  const axes = [];
  const pick = (start, chosen) => {
    if (chosen.length === dim) {
      axes.push(chosen.slice());
      return;
    }
    for (let i = start; i < n; i++) {
      chosen.push(i);
      pick(i + 1, chosen);
      chosen.pop();
    }
  };
  pick(0, []);
  return axes;
}

// Coordinate subcubes: `dim` free axes, the other coordinates fixed.
function subcubes(n, dim) {
  const cells = [];
  const count = 1 << n;
  const span = 1 << dim;
  for (const free of chooseAxes(n, dim)) {
    let mask = 0;
    for (const axis of free) mask |= 1 << axis;
    for (let base = 0; base < count; base++) {
      if (base & mask) continue;
      const verts = new Array(span);
      for (let bits = 0; bits < span; bits++) {
        let idx = base;
        for (let k = 0; k < dim; k++) if (bits & (1 << k)) idx |= 1 << free[k];
        verts[bits] = idx;
      }
      cells.push(verts);
    }
  }
  return cells;
}

// Walk a 2-regular graph into the unique cycle. Returns null if the
// edges of one cell are not a single polygon.
function polygon(edgePairs) {
  if (edgePairs.length < 3) return null;
  const adj = new Map();
  const link = (i, j) => {
    if (!adj.has(i)) adj.set(i, []);
    adj.get(i).push(j);
  };
  for (const [i, j] of edgePairs) {
    link(i, j);
    link(j, i);
  }
  for (const nbrs of adj.values()) if (nbrs.length !== 2) return null;
  const start = edgePairs[0][0];
  const poly = [start];
  let prev = -1;
  let cur = start;
  while (poly.length <= edgePairs.length) {
    const nxt = adj.get(cur).find((v) => v !== prev);
    if (nxt == null || nxt === start) break;
    poly.push(nxt);
    prev = cur;
    cur = nxt;
  }
  return poly.length === edgePairs.length ? poly : null;
}

function edgeKey(i, j) {
  return i < j ? `${i},${j}` : `${j},${i}`;
}

// A convex 4-cell meets the plane in one polyhedron, or in something
// flatter that is already recorded as a 2-face. The polyhedron is the
// set of those 2-faces: every edge in exactly two of them, one piece,
// at least a tetrahedron.
function closedCell(polys) {
  if (polys.length < 4) return false;
  const tally = new Map();
  for (const poly of polys) {
    for (let k = 0; k < poly.length; k++) {
      const key = edgeKey(poly[k], poly[(k + 1) % poly.length]);
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
  }
  for (const count of tally.values()) if (count !== 2) return false;
  const adj = polys.map(() => []);
  const byEdge = new Map();
  polys.forEach((poly, face) => {
    for (let k = 0; k < poly.length; k++) {
      const key = edgeKey(poly[k], poly[(k + 1) % poly.length]);
      if (!byEdge.has(key)) byEdge.set(key, []);
      byEdge.get(key).push(face);
    }
  });
  for (const pair of byEdge.values()) {
    adj[pair[0]].push(pair[1]);
    adj[pair[1]].push(pair[0]);
  }
  const seen = new Set([0]);
  const stack = [0];
  while (stack.length) {
    const face = stack.pop();
    for (const next of adj[face]) {
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return seen.size === polys.length;
}

export function section(n, h, eps = SECTION_EPS) {
  const cube = hypercube(n);
  const sums = cube.vertices.map((v) => v.reduce((s, x) => s + x, 0));
  const vertices = [];
  const keyToIndex = new Map();

  const addVertex = (key, point) => {
    const known = keyToIndex.get(key);
    if (known != null) return known;
    const idx = vertices.length;
    keyToIndex.set(key, idx);
    vertices.push(point);
    return idx;
  };

  for (let i = 0; i < cube.vertices.length; i++) {
    if (Math.abs(sums[i] - h) <= eps) addVertex(`v:${i}`, cube.vertices[i].slice());
  }

  for (const [a, b] of cube.edges) {
    const sa = sums[a] - h;
    const sb = sums[b] - h;
    if (Math.abs(sa) <= eps || Math.abs(sb) <= eps) continue;
    if (sa * sb >= 0) continue;
    const t = sa / (sa - sb);
    const pa = cube.vertices[a];
    const pb = cube.vertices[b];
    const point = pa.map((x, i) => x + t * (pb[i] - x));
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    addVertex(`e:${lo}:${hi}`, point);
  }

  const edges = [];
  const edgeByFace = new Map();
  for (const face of cube.faces) {
    const ids = [];
    const seen = new Set();
    const take = (id) => {
      if (id == null || seen.has(id)) return;
      seen.add(id);
      ids.push(id);
    };
    for (const vi of face) {
      if (Math.abs(sums[vi] - h) <= eps) take(keyToIndex.get(`v:${vi}`));
    }
    for (let k = 0; k < face.length; k++) {
      const a = face[k];
      const b = face[(k + 1) % face.length];
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      take(keyToIndex.get(`e:${lo}:${hi}`));
    }
    if (ids.length !== 2) continue;
    const [i, j] = ids[0] < ids[1] ? ids : [ids[1], ids[0]];
    edges.push([i, j]);
    edgeByFace.set(face, [i, j]);
  }

  const faces = [];
  const support = [];
  if (n >= 3) {
    for (const cell of subcubes(n, 3)) {
      const belong = new Set(cell);
      const pairs = [];
      for (const face of cube.faces) {
        if (!face.every((v) => belong.has(v))) continue;
        const edge = edgeByFace.get(face);
        if (edge) pairs.push(edge);
      }
      const poly = polygon(pairs);
      if (!poly) continue;
      faces.push(poly);
      support.push(cell);
    }
  }

  // Indices into `faces`. Empty below n = 4: a polygon has no 3-face.
  const cells = [];
  if (n >= 4) {
    for (const cell of subcubes(n, 4)) {
      const belong = new Set(cell);
      const polys = [];
      const member = [];
      for (let i = 0; i < faces.length; i++) {
        if (!support[i].every((v) => belong.has(v))) continue;
        polys.push(faces[i]);
        member.push(i);
      }
      if (closedCell(polys)) cells.push(member);
    }
  }

  return { n, vertices, edges, faces, cells, cut: h };
}

// Far inside the gap between the two edge lengths that appear as soon as
// the knife leaves a symmetric height. It is not a tolerance on h.
const METRIC_EPS = 1e-8;

function distance(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

function edgeLengths(geom) {
  return geom.edges.map(([i, j]) => distance(geom.vertices[i], geom.vertices[j]));
}

function oneLength(geom) {
  const ls = edgeLengths(geom);
  for (const L of ls) if (Math.abs(L - ls[0]) > METRIC_EPS) return false;
  return true;
}

function faceKey(faces) {
  return faces.map((f) => f.length).sort((a, b) => a - b).join(",");
}

function sizeKey(triangles, hexagons = 0) {
  return [...Array(triangles).fill(3), ...Array(hexagons).fill(6)].join(",");
}

function cellVertexCount(geom, cell) {
  const ids = new Set();
  for (const fi of cell) for (const v of geom.faces[fi]) ids.add(v);
  return ids.size;
}

// `${sorted face sizes}#${vertex count}` → how many cells have it.
function cellKinds(geom) {
  const kinds = new Map();
  for (const cell of geom.cells ?? []) {
    const key = `${faceKey(cell.map((i) => geom.faces[i]))}#${cellVertexCount(geom, cell)}`;
    kinds.set(key, (kinds.get(key) ?? 0) + 1);
  }
  return kinds;
}

function originAntipodal(vertices) {
  for (const v of vertices) {
    const found = vertices.some((u) => u.every((x, i) => Math.abs(x + v[i]) <= METRIC_EPS));
    if (!found) return false;
  }
  return true;
}

// Every 6-face has pair distances side, side√3, 2·side with counts 6, 6, 3.
function regularHexagons(geom) {
  const side = edgeLengths(geom)[0];
  let seen = 0;
  for (const face of geom.faces) {
    if (face.length !== 6) continue;
    let short = 0;
    let mid = 0;
    let long = 0;
    for (let i = 0; i < 6; i++) {
      for (let j = i + 1; j < 6; j++) {
        const d = distance(geom.vertices[face[i]], geom.vertices[face[j]]);
        if (Math.abs(d - side) <= METRIC_EPS) short += 1;
        else if (Math.abs(d - side * Math.sqrt(3)) <= METRIC_EPS) mid += 1;
        else if (Math.abs(d - side * 2) <= METRIC_EPS) long += 1;
        else return false;
      }
    }
    if (short !== 6 || mid !== 6 || long !== 3) return false;
    seen += 1;
  }
  return seen > 0;
}

// `count` cells are octahedra: 12 edges of the common length, and the three
// opposite pairs at side√2 about the cell's own centre.
function regularOctahedra(geom, count) {
  const side = edgeLengths(geom)[0];
  let seen = 0;
  for (const cell of geom.cells) {
    if (cell.length !== 8 || cell.some((i) => geom.faces[i].length !== 3)) continue;
    const ids = [];
    const have = new Set();
    for (const fi of cell) {
      for (const v of geom.faces[fi]) {
        if (have.has(v)) continue;
        have.add(v);
        ids.push(v);
      }
    }
    if (ids.length !== 6) return false;
    let edges = 0;
    let axes = 0;
    for (let i = 0; i < 6; i++) {
      for (let j = i + 1; j < 6; j++) {
        const d = distance(geom.vertices[ids[i]], geom.vertices[ids[j]]);
        if (Math.abs(d - side) <= METRIC_EPS) edges += 1;
        else if (Math.abs(d - side * Math.SQRT2) <= METRIC_EPS) axes += 1;
        else return false;
      }
    }
    if (edges !== 12 || axes !== 3) return false;
    seen += 1;
  }
  return seen === count;
}

// A name is a statement about this slice, not about the interval it sits in.
// The f-vector and the cell types have to match, every edge has to have one
// length, and a six-sided face has to be a regular hexagon. The same
// combinatorial type one step away usually has two lengths: that returns "".
// Nothing above n = 5 is named.
export function sectionFigure(geom) {
  if (!geom?.vertices?.length || !geom.edges?.length || !geom.faces?.length) return "";
  if (!oneLength(geom)) return "";
  const V = geom.vertices.length;
  const E = geom.edges.length;
  const F = geom.faces.length;
  const cells = geom.cells ?? [];
  const faces = faceKey(geom.faces);
  const kinds = cellKinds(geom);
  const only = (slot, n) => kinds.size === 1 && kinds.get(slot) === n;
  const both = (a, na, b, nb) =>
    kinds.size === 2 && kinds.get(a) === na && kinds.get(b) === nb;

  if (geom.n === 3 && V === 6 && E === 6 && faces === "6" && regularHexagons(geom)) {
    return "regular hexagon";
  }
  if (geom.n === 3 && V === 3 && E === 3 && faces === "3") return "equilateral triangle";
  if (
    geom.n === 4 &&
    V === 6 &&
    E === 12 &&
    F === 8 &&
    faces === sizeKey(8) &&
    only(`${sizeKey(8)}#6`, 1) &&
    originAntipodal(geom.vertices)
  ) {
    return "regular octahedron";
  }
  if (geom.n === 4 && V === 4 && E === 6 && F === 4 && faces === sizeKey(4) && only(`${sizeKey(4)}#4`, 1)) {
    return "regular tetrahedron";
  }
  if (
    geom.n === 4 &&
    V === 12 &&
    E === 18 &&
    faces === sizeKey(4, 4) &&
    only(`${sizeKey(4, 4)}#12`, 1) &&
    regularHexagons(geom)
  ) {
    return "truncated tetrahedron";
  }
  if (geom.n === 5 && V === 5 && E === 10 && F === 10 && faces === sizeKey(10) && only(`${sizeKey(4)}#4`, 5)) {
    return "regular 4-simplex";
  }
  if (
    geom.n === 5 &&
    V === 20 &&
    E === 40 &&
    F === 30 &&
    faces === sizeKey(20, 10) &&
    both(`${sizeKey(4)}#4`, 5, `${sizeKey(4, 4)}#12`, 5) &&
    regularHexagons(geom)
  ) {
    return "truncated 5-cell";
  }
  if (
    geom.n === 5 &&
    V === 10 &&
    E === 30 &&
    F === 30 &&
    faces === sizeKey(30) &&
    both(`${sizeKey(4)}#4`, 5, `${sizeKey(8)}#6`, 5) &&
    regularOctahedra(geom, 5)
  ) {
    return "rectified 5-cell";
  }
  if (
    geom.n === 5 &&
    V === 30 &&
    E === 60 &&
    F === 40 &&
    faces === sizeKey(20, 20) &&
    only(`${sizeKey(4, 4)}#12`, 10) &&
    regularHexagons(geom) &&
    originAntipodal(geom.vertices)
  ) {
    return "bitruncated 5-cell";
  }
  return "";
}
