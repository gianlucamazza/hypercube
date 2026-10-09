import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDepth, meanWarmth } from "../src/render/warmth.js";
import { assertClose } from "./helpers.js";

test("one warmth layer is the old depth normalisation", () => {
  const layer = [1, 3, 5];
  const warm = meanWarmth([layer]);
  const norm = normalizeDepth(layer);
  for (let i = 0; i < layer.length; i++) assertClose(warm[i], norm[i]);
});

test("warmth averages per-stage normalisations", () => {
  // First axis spans [0, 10] → 0 and 1. Second is flat at the neutral 0.7.
  const warm = meanWarmth([
    [0, 10],
    [4, 4],
  ]);
  assertClose(warm[0], (0 + 0.7) / 2);
  assertClose(warm[1], (1 + 0.7) / 2);
});

test("an empty warmth stack is null", () => {
  assert.equal(meanWarmth(null), null);
  assert.equal(meanWarmth([]), null);
});

test("a collapsed depth channel is the neutral 0.7", () => {
  assert.deepEqual(normalizeDepth([2, 2, NaN]), [0.7, 0.7, 0.7]);
});
