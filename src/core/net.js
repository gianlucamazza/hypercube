// The net (development) of the n-cube: its 2n facet cells unfolded into the
// hyperplane where the last coordinate is 0, then embedded back in R^n so the
// usual rotation and projection pipeline applies unchanged. For n = 4 this is
// the Dalí cross of eight cubes; for n = 3 the Latin cross of six squares;
// for n = 2 four unit segments in a line.

import { hypercube } from "./hypercube.js";

export function net(n) {
  const cellDim = n - 1;
  const cell = hypercube(cellDim);

  // Cell centres in R^(n-1): one at the origin, one beyond each of its
  // faces, and the tail two steps down the unfolding axis (the second
  // facet of the folded axis, giving the cross its long arm).
  const tailAxis = Math.min(1, cellDim - 1);
  const centres = [new Array(cellDim).fill(0)];
  for (let a = 0; a < cellDim; a++) {
    for (const s of [1, -1]) {
      const c = new Array(cellDim).fill(0);
      c[a] = s;
      centres.push(c);
    }
  }
  const tail = new Array(cellDim).fill(0);
  tail[tailAxis] = -2;
  centres.push(tail);

  // Adjacent cells share faces (and, in the cross arms, whole edges):
  // dedupe vertices by exact coordinates and edges by endpoint pair.
  const vertexIndex = new Map();
  const vertices = [];
  const edgeSet = new Set();
  const edges = [];

  for (const centre of centres) {
    const map = cell.vertices.map((v) => {
      const coords = v.map((x, k) => x + centre[k]);
      coords.push(0);
      const key = coords.join(",");
      if (!vertexIndex.has(key)) {
        vertexIndex.set(key, vertices.length);
        vertices.push(coords);
      }
      return vertexIndex.get(key);
    });
    for (const [a, b] of cell.edges) {
      const i = Math.min(map[a], map[b]);
      const j = Math.max(map[a], map[b]);
      const key = `${i}-${j}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push([i, j]);
      }
    }
  }

  return { n, vertices, edges, faces: [] };
}
