import { test } from "node:test";
import assert from "node:assert/strict";
import { net } from "../src/core/net.js";

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
