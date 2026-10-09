import { test } from "node:test";
import assert from "node:assert/strict";
import { hypercube } from "../src/core/hypercube.js";
import { section, sectionFigure, SECTION_EPS, advanceCut } from "../src/core/section.js";
import { assertClose } from "./helpers.js";

function sums(vertices) {
  return vertices.map((v) => v.reduce((s, x) => s + x, 0));
}

function lengths(geom) {
  return geom.edges.map(([a, b]) => {
    let s = 0;
    for (let i = 0; i < geom.n; i++) {
      const d = geom.vertices[a][i] - geom.vertices[b][i];
      s += d * d;
    }
    return Math.sqrt(s);
  });
}

function assertOneLength(geom) {
  const ls = lengths(geom);
  assert.ok(ls.length > 0);
  for (const L of ls) assertClose(L, ls[0], 1e-9, "edge length");
}

function degrees(geom) {
  const deg = new Array(geom.vertices.length).fill(0);
  for (const [a, b] of geom.edges) {
    deg[a] += 1;
    deg[b] += 1;
  }
  return deg;
}

function lengthClasses(geom) {
  const tally = new Map();
  for (const L of lengths(geom)) {
    const key = L.toFixed(6);
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  return [...tally.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
}

function cellIds(geom, cell) {
  const ids = new Set();
  for (const fi of cell) for (const v of geom.faces[fi]) ids.add(v);
  return [...ids];
}

function pairTally(geom, ids) {
  const tally = new Map();
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      let s = 0;
      for (let k = 0; k < geom.n; k++) {
        const d = geom.vertices[ids[i]][k] - geom.vertices[ids[j]][k];
        s += d * d;
      }
      const key = Math.sqrt(s).toFixed(6);
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
  }
  return [...tally.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
}

function cellSignatures(geom) {
  return geom.cells
    .map((cell) => cell.map((i) => geom.faces[i].length).sort((a, b) => a - b))
    .sort(lexSig);
}

// A 6-face is regular when its 15 distances are side, side√3, 2·side.
function hexagonsAreRegular(geom) {
  let seen = false;
  for (const face of geom.faces) {
    if (face.length !== 6) continue;
    seen = true;
    const tally = pairTally(geom, face);
    if (tally.length !== 3) return false;
    const side = Number(tally[0][0]);
    if (tally[0][1] !== 6 || tally[1][1] !== 6 || tally[2][1] !== 3) return false;
    if (Math.abs(Number(tally[1][0]) - side * Math.sqrt(3)) > 1e-6) return false;
    if (Math.abs(Number(tally[2][0]) - side * 2) > 1e-6) return false;
  }
  return seen;
}

function euler(geom) {
  return geom.vertices.length - geom.edges.length + geom.faces.length - geom.cells.length;
}

function onCube(geom) {
  for (const v of geom.vertices) {
    for (const x of v) assert.ok(Math.abs(Math.abs(x) - 0.5) < 1e-9, `cube coordinate ${x}`);
  }
}

// An open interval misses every vertex, so each section vertex sits in the
// interior of exactly one cube edge.
function cutsEdges(geom) {
  for (const v of geom.vertices) {
    let free = 0;
    for (const x of v) if (Math.abs(Math.abs(x) - 0.5) >= 1e-9) free += 1;
    assert.equal(free, 1);
  }
}

// Counts hits from vertex sums and incidence only, without welding points
// or walking polygons. Agreement with section() is the independent check.
function algebraic(n, h, eps = SECTION_EPS) {
  const cube = hypercube(n);
  const s = sums(cube.vertices);
  let onPlane = 0;
  for (const sum of s) if (Math.abs(sum - h) <= eps) onPlane += 1;
  let crossings = 0;
  for (const [a, b] of cube.edges) {
    const sa = s[a] - h;
    const sb = s[b] - h;
    if (Math.abs(sa) <= eps || Math.abs(sb) <= eps) continue;
    if (sa * sb < 0) crossings += 1;
  }
  let edges = 0;
  const cutFace = [];
  for (const face of cube.faces) {
    let hits = 0;
    for (const vi of face) if (Math.abs(s[vi] - h) <= eps) hits += 1;
    for (let k = 0; k < face.length; k++) {
      const a = face[k];
      const b = face[(k + 1) % face.length];
      const sa = s[a] - h;
      const sb = s[b] - h;
      if (Math.abs(sa) <= eps || Math.abs(sb) <= eps) continue;
      if (sa * sb < 0) hits += 1;
    }
    const cut = hits === 2;
    if (cut) edges += 1;
    cutFace.push(cut);
  }
  const count = 1 << n;
  const faceSizes = [];
  // Cut squares of each coordinate 3-cube, keyed by its vertex-set string,
  // so a 4-cube can gather the polygons on its boundary without walking them.
  const polygonsOf = new Map();
  const cubes3 = [];
  if (n >= 3) {
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        for (let c = b + 1; c < n; c++) {
          const mask = (1 << a) | (1 << b) | (1 << c);
          for (let base = 0; base < count; base++) {
            if (base & mask) continue;
            const belong = new Set();
            for (let bits = 0; bits < 8; bits++) {
              let idx = base;
              if (bits & 1) idx |= 1 << a;
              if (bits & 2) idx |= 1 << b;
              if (bits & 4) idx |= 1 << c;
              belong.add(idx);
            }
            const cuts = [];
            for (let f = 0; f < cube.faces.length; f++) {
              if (!cutFace[f]) continue;
              if (cube.faces[f].every((v) => belong.has(v))) cuts.push(f);
            }
            if (cuts.length >= 3) {
              faceSizes.push(cuts.length);
              const key = [...belong].sort((x, y) => x - y).join(",");
              polygonsOf.set(key, cuts);
              cubes3.push(belong);
            }
          }
        }
      }
    }
  }
  const cellSigs = [];
  if (n >= 4) {
    const axes4 = [];
    const pick = (start, chosen) => {
      if (chosen.length === 4) {
        axes4.push(chosen.slice());
        return;
      }
      for (let i = start; i < n; i++) {
        chosen.push(i);
        pick(i + 1, chosen);
        chosen.pop();
      }
    };
    pick(0, []);
    for (const free of axes4) {
      let mask = 0;
      for (const axis of free) mask |= 1 << axis;
      for (let base = 0; base < count; base++) {
        if (base & mask) continue;
        const belong = new Set();
        for (let bits = 0; bits < 16; bits++) {
          let idx = base;
          for (let k = 0; k < 4; k++) if (bits & (1 << k)) idx |= 1 << free[k];
          belong.add(idx);
        }
        const polys = [];
        for (const cube3 of cubes3) {
          if (![...cube3].every((v) => belong.has(v))) continue;
          const key = [...cube3].sort((x, y) => x - y).join(",");
          polys.push(polygonsOf.get(key));
        }
        if (polys.length < 4) continue;
        const tally = new Map();
        for (const poly of polys) {
          for (const f of poly) tally.set(f, (tally.get(f) ?? 0) + 1);
        }
        let closed = true;
        for (const c of tally.values()) if (c !== 2) closed = false;
        if (!closed) continue;
        const adj = polys.map(() => []);
        const byFace = new Map();
        polys.forEach((poly, i) => {
          for (const f of poly) {
            if (!byFace.has(f)) byFace.set(f, []);
            byFace.get(f).push(i);
          }
        });
        for (const pair of byFace.values()) {
          if (pair.length !== 2) continue;
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
        if (seen.size !== polys.length) continue;
        cellSigs.push(polys.map((p) => p.length).sort((a, b) => a - b));
      }
    }
  }
  cellSigs.sort(lexSig);
  return { vertices: onPlane + crossings, edges, faceSizes, cellSigs };
}

function lexSig(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

function assertAgrees(n, h) {
  const geom = section(n, h);
  const hand = algebraic(n, h);
  assert.equal(geom.vertices.length, hand.vertices, `V n=${n} h=${h}`);
  assert.equal(geom.edges.length, hand.edges, `E n=${n} h=${h}`);
  const got = geom.faces.map((f) => f.length).sort((a, b) => a - b);
  const want = hand.faceSizes.slice().sort((a, b) => a - b);
  assert.deepEqual(got, want, `faces n=${n} h=${h}`);
  const gotCells = (geom.cells ?? []).map((cell) =>
    cell.map((i) => geom.faces[i].length).sort((a, b) => a - b),
  );
  gotCells.sort(lexSig);
  assert.deepEqual(gotCells, hand.cellSigs, `cells n=${n} h=${h}`);
  for (const v of geom.vertices) {
    const sum = v.reduce((s, x) => s + x, 0);
    assertClose(sum, h, 1e-9, "on the plane");
  }
  return geom;
}

test("n = 3 at h = 0 is the regular hexagon", () => {
  const geom = assertAgrees(3, 0);
  assert.equal(geom.vertices.length, 6);
  assert.equal(geom.edges.length, 6);
  assert.deepEqual(
    geom.faces.map((f) => f.length),
    [6],
  );
  assert.equal(geom.cells.length, 0);
  assertOneLength(geom);
  assert.equal(sectionFigure(geom), "regular hexagon");
});

test("n = 3 between 1/2 and 3/2 is an equilateral triangle", () => {
  for (const h of [0.6, 1, 1.4]) {
    const geom = assertAgrees(3, h);
    assert.equal(geom.vertices.length, 3);
    assert.equal(geom.edges.length, 3);
    assert.deepEqual(
      geom.faces.map((f) => f.length),
      [3],
    );
    assertOneLength(geom);
    assert.equal(sectionFigure(geom), "equilateral triangle");
  }
});

test("n = 4 at h = 0 is the regular octahedron", () => {
  const geom = assertAgrees(4, 0);
  assert.equal(geom.vertices.length, 6);
  assert.equal(geom.edges.length, 12);
  assert.equal(geom.faces.length, 8);
  assert.equal(geom.cells.length, 1);
  for (const face of geom.faces) assert.equal(face.length, 3);
  assertOneLength(geom);
  for (const d of degrees(geom)) assert.equal(d, 4);
  for (const v of geom.vertices) {
    const opp = geom.vertices.find((u) =>
      u.every((x, i) => Math.abs(x + v[i]) < 1e-9),
    );
    assert.ok(opp, "antipode");
  }
  assert.equal(sectionFigure(geom), "regular octahedron");
});

test("n = 4 between 1 and 2 is a regular tetrahedron", () => {
  for (const h of [1.2, 1.5, 1.8]) {
    const geom = assertAgrees(4, h);
    assert.equal(geom.vertices.length, 4);
    assert.equal(geom.edges.length, 6);
    assert.equal(geom.faces.length, 4);
    assert.equal(geom.cells.length, 1);
    for (const face of geom.faces) assert.equal(face.length, 3);
    assertOneLength(geom);
    assert.equal(sectionFigure(geom), "regular tetrahedron");
  }
});

test("the apex is a point and past it the section is empty", () => {
  const point = assertAgrees(4, 2);
  assert.equal(point.vertices.length, 1);
  assert.equal(point.edges.length, 0);
  assert.equal(point.faces.length, 0);
  assert.equal(point.cells.length, 0);
  assert.equal(sectionFigure(point), "");
  const empty = assertAgrees(4, 2.1);
  assert.equal(empty.vertices.length, 0);
  assert.equal(empty.edges.length, 0);
});

test("n = 4 between the octahedron and the tetrahedron is counted, then named", () => {
  const geom = assertAgrees(4, 0.5);
  const sizes = geom.faces.map((f) => f.length).sort((a, b) => a - b);
  const classes = [...new Set(lengths(geom).map((L) => L.toFixed(6)))].sort();
  assert.equal(geom.vertices.length, 12);
  assert.equal(geom.edges.length, 18);
  assert.equal(geom.cells.length, 1);
  assert.deepEqual(sizes, [3, 3, 3, 3, 6, 6, 6, 6]);
  assertOneLength(geom);
  assertClose(lengths(geom)[0], Math.SQRT2 / 2, 1e-9, "truncated-tetrahedron edge");
  const side = lengths(geom)[0];
  for (const face of geom.faces) {
    if (face.length !== 6) continue;
    const tally = new Map();
    for (let i = 0; i < face.length; i++) {
      for (let j = i + 1; j < face.length; j++) {
        let s = 0;
        for (let k = 0; k < geom.n; k++) {
          const d = geom.vertices[face[i]][k] - geom.vertices[face[j]][k];
          s += d * d;
        }
        const key = Math.sqrt(s).toFixed(6);
        tally.set(key, (tally.get(key) ?? 0) + 1);
      }
    }
    const counts = [...tally.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
    assert.equal(counts.length, 3, `hexagon distances ${counts}`);
    assertClose(Number(counts[0][0]), side, 1e-6);
    assert.equal(counts[0][1], 6);
    assertClose(Number(counts[1][0]), side * Math.sqrt(3), 1e-6);
    assert.equal(counts[1][1], 6);
    assertClose(Number(counts[2][0]), side * 2, 1e-6);
    assert.equal(counts[2][1], 3);
  }
  assert.equal(sectionFigure(geom), "truncated tetrahedron");
  assert.equal(sectionFigure(assertAgrees(4, -0.5)), "truncated tetrahedron");
});

test("n = 4 keeps the truncated-tetrahedron f-vector off the symmetric height", () => {
  const mid = section(4, 0.5);
  for (const h of [0.3, 0.7, -0.3]) {
    const geom = assertAgrees(4, h);
    assert.equal(geom.vertices.length, mid.vertices.length);
    assert.equal(geom.edges.length, mid.edges.length);
    assert.deepEqual(
      geom.faces.map((f) => f.length).sort((a, b) => a - b),
      mid.faces.map((f) => f.length).sort((a, b) => a - b),
    );
    assert.deepEqual(cellSignatures(geom), cellSignatures(mid));
    const classes = lengthClasses(geom);
    assert.equal(classes.length, 2, `lengths at h=${h}: ${classes}`);
    const counts = classes.map(([, c]) => c).sort((a, b) => a - b);
    assert.deepEqual(counts, [6, 12]);
    assert.equal(hexagonsAreRegular(geom), false);
    assert.equal(sectionFigure(geom), "");
  }
});

function assertTetrahedralCells(geom, count) {
  const side = lengths(geom)[0];
  let seen = 0;
  for (const cell of geom.cells) {
    const sizes = cell.map((i) => geom.faces[i].length).sort((a, b) => a - b);
    if (sizes.join(",") !== "3,3,3,3") continue;
    const ids = cellIds(geom, cell);
    assert.equal(ids.length, 4);
    const tally = pairTally(geom, ids);
    assert.equal(tally.length, 1);
    assert.equal(tally[0][1], 6);
    assertClose(Number(tally[0][0]), side, 1e-6, "tetrahedron edge");
    seen += 1;
  }
  assert.equal(seen, count);
}

// The 12-vertex cell of a truncated tetrahedron: 18 edges, then the three
// longer pair distances of that Archimedean solid.
function assertTruncatedTetrahedra(geom, count) {
  const side = lengths(geom)[0];
  const expect = [side, side * Math.sqrt(3), side * 2, side * Math.sqrt(5)];
  const mult = [18, 24, 12, 12];
  let seen = 0;
  for (const cell of geom.cells) {
    const sizes = cell.map((i) => geom.faces[i].length).sort((a, b) => a - b);
    if (sizes.join(",") !== "3,3,3,3,6,6,6,6") continue;
    const ids = cellIds(geom, cell);
    assert.equal(ids.length, 12);
    const tally = pairTally(geom, ids);
    assert.equal(tally.length, 4, `cell distances ${tally}`);
    for (let i = 0; i < 4; i++) {
      assertClose(Number(tally[i][0]), expect[i], 1e-6, "truncated-tetrahedron distance");
      assert.equal(tally[i][1], mult[i]);
    }
    seen += 1;
  }
  assert.equal(seen, count);
}

function assertRegularOctahedra(geom, count) {
  const side = lengths(geom)[0];
  let seen = 0;
  for (const cell of geom.cells) {
    const sizes = cell.map((i) => geom.faces[i].length);
    if (sizes.length !== 8 || sizes.some((s) => s !== 3)) continue;
    const ids = cellIds(geom, cell);
    assert.equal(ids.length, 6);
    const tally = pairTally(geom, ids);
    assert.equal(tally.length, 2, `octahedron distances ${tally}`);
    assertClose(Number(tally[0][0]), side, 1e-6, "octahedron edge");
    assert.equal(tally[0][1], 12);
    assertClose(Number(tally[1][0]), side * Math.SQRT2, 1e-6, "octahedron axis");
    assert.equal(tally[1][1], 3);
    seen += 1;
  }
  assert.equal(seen, count);
}

test("n = 5 near the apex is the regular 4-simplex, including the layer", () => {
  const apex = assertAgrees(5, 2.5);
  assert.equal(apex.vertices.length, 1);
  assert.equal(apex.edges.length, 0);
  assert.equal(apex.cells.length, 0);
  onCube(apex);
  assert.equal(sectionFigure(apex), "");
  const past = assertAgrees(5, 2.6);
  assert.equal(past.vertices.length, 0);
  assert.equal(sectionFigure(past), "");

  const lengthsAt = [];
  for (const h of [2.2, 2, 1.7, 1.5, -2, -1.5]) {
    const geom = assertAgrees(5, h);
    assert.equal(geom.vertices.length, 5, `V h=${h}`);
    assert.equal(geom.edges.length, 10);
    assert.equal(geom.faces.length, 10);
    assert.equal(geom.cells.length, 5);
    for (const face of geom.faces) assert.equal(face.length, 3);
    assertOneLength(geom);
    for (const d of degrees(geom)) assert.equal(d, 4);
    assert.equal(euler(geom), 0);
    assertTetrahedralCells(geom, 5);
    assert.equal(sectionFigure(geom), "regular 4-simplex");
    lengthsAt.push(lengths(geom)[0]);
    if (Math.abs(Math.abs(h) - 1.5) < 1e-9) {
      onCube(geom);
      const plus = h > 0 ? 4 : 1;
      for (const v of geom.vertices) assert.equal(v.filter((x) => x > 0).length, plus);
    } else cutsEdges(geom);
  }
  assertClose(lengthsAt[1], Math.SQRT2 / 2, 1e-9, "midpoint edges at |h| = 2");
  assertClose(lengthsAt[3], Math.SQRT2, 1e-9, "face diagonals on the layer");
  assert.ok(Math.abs(lengthsAt[0] - lengthsAt[1]) > 0.1, "the length moves with h");
});

test("n = 5 at |h| = 1 is the truncated 5-cell, and the interval is not", () => {
  for (const h of [1, -1]) {
    const geom = assertAgrees(5, h);
    assert.equal(geom.vertices.length, 20);
    assert.equal(geom.edges.length, 40);
    assert.equal(geom.faces.length, 30);
    assert.equal(geom.cells.length, 10);
    const sizes = geom.faces.map((f) => f.length).sort((a, b) => a - b);
    assert.equal(sizes.filter((s) => s === 3).length, 20);
    assert.equal(sizes.filter((s) => s === 6).length, 10);
    assertOneLength(geom);
    assertClose(lengths(geom)[0], Math.SQRT2 / 2, 1e-9, "truncated 5-cell edge");
    assert.equal(hexagonsAreRegular(geom), true);
    assertTetrahedralCells(geom, 5);
    assertTruncatedTetrahedra(geom, 5);
    for (const d of degrees(geom)) assert.equal(d, 4);
    assert.equal(euler(geom), 0);
    cutsEdges(geom);
    assert.equal(sectionFigure(geom), "truncated 5-cell");
  }
  const named = section(5, 1);
  for (const h of [1.2, 0.8, -1.2]) {
    const geom = assertAgrees(5, h);
    assert.equal(geom.vertices.length, 20);
    assert.equal(geom.edges.length, 40);
    assert.deepEqual(
      geom.faces.map((f) => f.length).sort((a, b) => a - b),
      named.faces.map((f) => f.length).sort((a, b) => a - b),
    );
    assert.deepEqual(cellSignatures(geom), cellSignatures(named));
    assert.equal(lengthClasses(geom).length, 2, `lengths at h=${h}`);
    assert.equal(hexagonsAreRegular(geom), false);
    assert.equal(sectionFigure(geom), "");
  }
  const at = lengthClasses(section(5, 1.2)).map(([, c]) => c).sort((a, b) => a - b);
  assert.deepEqual(at, [10, 30]);
});

test("n = 5 at |h| = 1/2 is the rectified 5-cell", () => {
  for (const h of [0.5, -0.5]) {
    const geom = assertAgrees(5, h);
    assert.equal(geom.vertices.length, 10);
    assert.equal(geom.edges.length, 30);
    assert.equal(geom.faces.length, 30);
    assert.equal(geom.cells.length, 10);
    for (const face of geom.faces) assert.equal(face.length, 3);
    assertOneLength(geom);
    assertClose(lengths(geom)[0], Math.SQRT2, 1e-9, "rectified edge");
    assertTetrahedralCells(geom, 5);
    assertRegularOctahedra(geom, 5);
    for (const d of degrees(geom)) assert.equal(d, 6);
    assert.equal(euler(geom), 0);
    onCube(geom);
    const plus = h + 2.5;
    for (const v of geom.vertices) {
      assert.equal(v.filter((x) => x > 0).length, plus);
    }
    let antipode = true;
    for (const v of geom.vertices) {
      const opp = geom.vertices.some((u) => u.every((x, i) => Math.abs(x + v[i]) < 1e-9));
      if (!opp) antipode = false;
    }
    assert.equal(antipode, false);
    assert.equal(sectionFigure(geom), "rectified 5-cell");
  }
});

test("n = 5 at h = 0 is the bitruncated 5-cell, and the central band is not", () => {
  const geom = assertAgrees(5, 0);
  assert.equal(geom.vertices.length, 30);
  assert.equal(geom.edges.length, 60);
  assert.equal(geom.faces.length, 40);
  assert.equal(geom.cells.length, 10);
  const sizes = geom.faces.map((f) => f.length).sort((a, b) => a - b);
  assert.equal(sizes.filter((s) => s === 3).length, 20);
  assert.equal(sizes.filter((s) => s === 6).length, 20);
  assertOneLength(geom);
  assertClose(lengths(geom)[0], Math.SQRT2 / 2, 1e-9, "bitruncated edge");
  assert.equal(hexagonsAreRegular(geom), true);
  assertTruncatedTetrahedra(geom, 10);
  for (const d of degrees(geom)) assert.equal(d, 4);
  assert.equal(euler(geom), 0);
  cutsEdges(geom);
  for (const v of geom.vertices) {
    const opp = geom.vertices.find((u) => u.every((x, i) => Math.abs(x + v[i]) < 1e-9));
    assert.ok(opp, "antipode");
  }
  assert.equal(sectionFigure(geom), "bitruncated 5-cell");

  for (const h of [0.2, -0.2]) {
    const off = assertAgrees(5, h);
    assert.equal(off.vertices.length, 30);
    assert.equal(off.edges.length, 60);
    assert.deepEqual(
      off.faces.map((f) => f.length).sort((a, b) => a - b),
      sizes,
    );
    assert.deepEqual(cellSignatures(off), cellSignatures(geom));
    const counts = lengthClasses(off).map(([, c]) => c).sort((a, b) => a - b);
    assert.deepEqual(counts, [30, 30]);
    assert.equal(hexagonsAreRegular(off), false);
    assert.equal(sectionFigure(off), "");
  }
});

test("above n = 5 a slice is counted and left unnamed", () => {
  const geom = assertAgrees(6, 0);
  assert.ok(geom.vertices.length > 0);
  assert.ok(geom.cells.length > 0);
  assert.equal(sectionFigure(geom), "");
});

test("the knife turns around at each apex", () => {
  const leaving = advanceCut(2, -1, 0.05, 2);
  assert.ok(leaving.h < 2 && leaving.h > 1.9);
  assert.equal(leaving.dir, -1);
  const low = advanceCut(-1.999, -1, 1, 2, 0.08);
  assert.equal(low.h, -2);
  assert.equal(low.dir, 1);
  const high = advanceCut(1.99, 1, 1, 2, 0.08);
  assert.equal(high.h, 2);
  assert.equal(high.dir, -1);
});
