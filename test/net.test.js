import { test } from "node:test";
import assert from "node:assert/strict";
import { net, netCentres } from "../src/core/net.js";
import { hypercube } from "../src/core/hypercube.js";

test("net(2): the square unfolds to a chain of 4 unit segments", () => {
  const { vertices, edges } = net(2);
  assert.equal(vertices.length, 5);
  assert.equal(edges.length, 4);
});

test("net(3): the Latin cross of 6 squares (hand-counted 14/19)", () => {
  const { vertices, edges } = net(3);
  assert.equal(vertices.length, 14);
  assert.equal(edges.length, 19);
});

test("net invariants for n = 2..5", () => {
  for (let n = 2; n <= 5; n++) {
    const { vertices, edges } = net(n);

    // Embedded in the hyperplane: last coordinate always 0.
    for (const v of vertices) {
      assert.equal(v.length, n);
      assert.equal(v[n - 1], 0);
    }

    // No duplicate vertices survived the dedupe.
    const keys = new Set(vertices.map((v) => v.join(",")));
    assert.equal(keys.size, vertices.length, `duplicates in n=${n}`);

    // Every edge is a unit step along exactly one axis.
    for (const [i, j] of edges) {
      const diffs = vertices[i]
        .map((x, k) => Math.abs(x - vertices[j][k]))
        .filter((d) => d > 0);
      assert.deepEqual(diffs, [1], `edge ${i}-${j} in n=${n}`);
    }

    // The net is connected: one piece of unfolded paper.
    const adjacency = new Map(vertices.map((_, i) => [i, []]));
    for (const [i, j] of edges) {
      adjacency.get(i).push(j);
      adjacency.get(j).push(i);
    }
    const seen = new Set([0]);
    const queue = [0];
    while (queue.length) {
      for (const next of adjacency.get(queue.pop()))
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
    }
    assert.equal(seen.size, vertices.length, `disconnected net for n=${n}`);
  }
});

test("net cells are disjoint open cubes at distinct integer centres", () => {
  // Open unit cubes at integer centres are disjoint iff the centres differ:
  // overlap would need every coordinate to differ by less than 1, i.e. by 0.
  for (let n = 2; n <= 6; n++) {
    const centres = netCentres(n);
    assert.equal(centres.length, 2 * n, `cell count n=${n}`);
    const keys = new Set(centres.map((c) => c.join(",")));
    assert.equal(keys.size, centres.length, `duplicate centres n=${n}`);
    for (const c of centres)
      for (const x of c) assert.ok(Number.isInteger(x), `integer centres`);
    for (let a = 0; a < centres.length; a++)
      for (let b = a + 1; b < centres.length; b++) {
        const chebyshev = Math.max(
          ...centres[a].map((x, k) => Math.abs(x - centres[b][k])),
        );
        assert.ok(chebyshev >= 1, `overlapping cells ${a},${b} n=${n}`);
      }
  }
});

test("net unfolding tree glues each cell to its parent along a full face", () => {
  // The unfolding follows a spanning tree of the facet-adjacency graph:
  // each arm cell hangs off the origin cell, the tail off the -1 arm on the
  // tail axis. A valid development glues child to parent along a whole
  // (n-2)-face: 2^(n-2) shared vertices (one shared vertex when n = 2).
  for (let n = 2; n <= 6; n++) {
    const cellDim = n - 1;
    const centres = netCentres(n);
    const key = (c) => c.join(",");
    const index = new Map(centres.map((c, i) => [key(c), i]));

    const parentOf = (centre) => {
      if (centre.every((x) => x === 0)) return null; // root
      const parent = centre.map((x) => x - Math.sign(x));
      return index.get(key(parent));
    };

    // Every non-root cell has its parent present at L1 distance 1, and the
    // 2n - 1 parent edges connect all 2n cells: a tree.
    const reached = new Set([index.get(key(new Array(cellDim).fill(0)))]);
    let edges = 0;
    for (let pass = 0; pass < centres.length; pass++)
      for (let i = 0; i < centres.length; i++) {
        const p = parentOf(centres[i]);
        if (p == null || reached.has(i) || !reached.has(p)) continue;
        const l1 = centres[i].reduce(
          (s, x, k) => s + Math.abs(x - centres[p][k]),
          0,
        );
        assert.equal(l1, 1, `parent not adjacent for cell ${i} n=${n}`);
        reached.add(i);
        edges++;
      }
    assert.equal(reached.size, 2 * n, `tree does not span n=${n}`);
    assert.equal(edges, 2 * n - 1, `tree edge count n=${n}`);

    // Child and parent share exactly a full (n-2)-face of vertices, and all
    // placed vertices appear in the deduped net.
    const cell = hypercube(cellDim);
    const placed = (centre) =>
      cell.vertices.map((v) => [...v.map((x, k) => x + centre[k]), 0]);
    const netKeys = new Set(net(n).vertices.map(key));
    for (let i = 0; i < centres.length; i++) {
      const mine = placed(centres[i]).map(key);
      for (const k of mine)
        assert.ok(netKeys.has(k), `missing placed vertex n=${n}`);
      const p = parentOf(centres[i]);
      if (p == null) continue;
      const theirs = new Set(placed(centres[p]).map(key));
      const shared = mine.filter((k) => theirs.has(k)).length;
      assert.equal(shared, 2 ** (n - 2), `shared face cell ${i} n=${n}`);
    }
  }
});

test("net snapshots: the Dalí cross and its higher kin", () => {
  const expected = {
    4: [36, 68], // eight cubes, the Dalí cross
    5: [88, 212],
    6: [208, 608],
  };
  for (const [n, [v, e]] of Object.entries(expected)) {
    const { vertices, edges } = net(Number(n));
    assert.equal(vertices.length, v, `vertices n=${n}`);
    assert.equal(edges.length, e, `edges n=${n}`);
  }
  // Circumradius: the tail cell's far corner at -2.5 on the tail axis,
  // +-0.5 on the other n-2 axes: r^2 = 6.25 + (n-2)/4.
  for (let n = 3; n <= 6; n++) {
    const r2 = Math.max(
      ...net(n).vertices.map((v) => v.reduce((s, x) => s + x * x, 0)),
    );
    assert.equal(r2, 6.25 + (n - 2) * 0.25, `circumradius^2 n=${n}`);
  }
});
