import { test } from "node:test";
import assert from "node:assert/strict";
import {
  binomial,
  elementCounts,
  grayCode,
  rotationPlanes,
  planeName,
} from "../src/core/combinatorics.js";
import { bitHamming } from "./helpers.js";

test("binomial against known values and edge cases", () => {
  assert.equal(binomial(4, 2), 6);
  assert.equal(binomial(6, 3), 20);
  assert.equal(binomial(10, 5), 252);
  assert.equal(binomial(5, 0), 1);
  assert.equal(binomial(5, 5), 1);
  assert.equal(binomial(5, 6), 0);
  assert.equal(binomial(5, -1), 0);
});

test("elementCounts(4) is the classic 16/32/24/8/1 table", () => {
  assert.deepEqual(elementCounts(4), [16, 32, 24, 8, 1]);
});

test("elementCounts sums to 3^n (each element picks -, 0, + per axis)", () => {
  for (let n = 1; n <= 7; n++) {
    const sum = elementCounts(n).reduce((a, b) => a + b, 0);
    assert.equal(sum, 3 ** n, `n=${n}`);
  }
});

test("grayCode is a Hamiltonian cycle on Q_n", () => {
  for (let n = 1; n <= 7; n++) {
    const seq = grayCode(n);
    assert.equal(seq.length, 2 ** n);
    assert.equal(new Set(seq).size, seq.length, "all vertices distinct");
    for (let k = 0; k < seq.length; k++) {
      const next = seq[(k + 1) % seq.length];
      assert.equal(bitHamming(seq[k], next), 1, `step ${k} in n=${n}`);
    }
  }
});

test("rotationPlanes yields C(n,2) distinct ordered pairs", () => {
  for (let n = 2; n <= 6; n++) {
    const planes = rotationPlanes(n);
    assert.equal(planes.length, binomial(n, 2));
    const keys = new Set(planes.map(([i, j]) => `${i},${j}`));
    assert.equal(keys.size, planes.length);
    for (const [i, j] of planes) assert.ok(i < j);
  }
});

test("planeName gives the canonical n=4 labels", () => {
  assert.deepEqual(rotationPlanes(4).map(planeName), [
    "xy",
    "xz",
    "xw",
    "yz",
    "yw",
    "zw",
  ]);
});
