import { test } from "node:test";
import assert from "node:assert/strict";
import { cometPath } from "../src/render/comet.js";
import { grayCode } from "../src/core/combinatorics.js";
import { assertClose } from "./helpers.js";

test("the comet trail stops at the head", () => {
  const path = cometPath(4, 1.3);
  assert.ok(path.frac > 0.2 && path.frac < 0.4, `frac ${path.frac}`);
  const current = path.segments.filter(
    (s) => s.from === path.from && s.to === path.to,
  );
  assert.equal(current.length, 1);
  assert.equal(current[0].t0, 0);
  assertClose(current[0].t1, path.frac, 1e-12);
  assert.ok(current[0].t1 < 1);
  for (const s of path.segments) {
    assert.ok(s.t0 >= 0 && s.t1 <= 1 && s.t1 >= s.t0);
    assert.ok(s.fade <= 1 && s.fade > 0);
  }
});

test("an integer time draws no partial edge ahead of a vertex", () => {
  const path = cometPath(3, 2);
  assert.equal(path.frac, 0);
  assert.equal(path.head, 2);
  assert.equal(
    path.segments.some((s) => s.from === path.from && s.to === path.to),
    false,
  );
});

test("a negative time stays on the cycle and behind the head", () => {
  const cycle = grayCode(3);
  const path = cometPath(3, -0.25);
  assert.ok(path.frac > 0 && path.frac < 1);
  assert.ok(cycle.includes(path.from));
  const current = path.segments.find(
    (s) => s.from === path.from && s.to === path.to,
  );
  assert.ok(current);
  assertClose(current.t1, path.frac, 1e-12);
});

test("the same time is the same path", () => {
  const a = cometPath(5, 3.25);
  const b = cometPath(5, 3.25);
  assert.deepEqual(a.segments, b.segments);
  assert.equal(a.head, b.head);
});
