import { test } from "node:test";
import assert from "node:assert/strict";
import { hypercube, cellVertices } from "../src/core/hypercube.js";
import { binomial } from "../src/core/combinatorics.js";
import { coordHamming } from "./helpers.js";

test("element counts for n = 1..7", () => {
  for (let n = 1; n <= 7; n++) {
    const { vertices, edges, faces } = hypercube(n);
    assert.equal(vertices.length, 2 ** n, `vertices n=${n}`);
    assert.equal(edges.length, n * 2 ** (n - 1), `edges n=${n}`);
    assert.equal(faces.length, binomial(n, 2) * 2 ** (n - 2), `faces n=${n}`);
  }
});

test("all coordinates are ±0.5 and vertices are distinct", () => {
  const { vertices } = hypercube(4);
  const seen = new Set();
  for (const v of vertices) {
    for (const c of v) assert.ok(c === 0.5 || c === -0.5);
    const key = v.join(",");
    assert.ok(!seen.has(key), `duplicate vertex ${key}`);
    seen.add(key);
  }
});

test("every edge joins vertices at coordinate Hamming distance 1", () => {
  for (let n = 2; n <= 6; n++) {
    const { vertices, edges } = hypercube(n);
    for (const [i, j] of edges) {
      assert.ok(i < j, "edges stored with i < j");
      assert.equal(coordHamming(vertices[i], vertices[j]), 1);
    }
  }
});

test("faces are cyclic quadrilaterals (consecutive Hamming distance 1)", () => {
  const { vertices, faces } = hypercube(4);
  for (const face of faces) {
    assert.equal(face.length, 4);
    for (let k = 0; k < 4; k++) {
      const a = vertices[face[k]];
      const b = vertices[face[(k + 1) % 4]];
      assert.equal(coordHamming(a, b), 1, "face edge must be a cube edge");
    }
  }
});

test("cellVertices selects the facet with a fixed coordinate sign", () => {
  const n = 4;
  const { vertices } = hypercube(n);
  const near = cellVertices(n, 3, +1);
  const far = cellVertices(n, 3, -1);
  assert.equal(near.length, 8);
  assert.equal(far.length, 8);
  for (const i of near) assert.equal(vertices[i][3], 0.5);
  for (const i of far) assert.equal(vertices[i][3], -0.5);
});
