import { test } from "node:test";
import assert from "node:assert/strict";
import { createScene } from "../src/render/scene.js";
import { hypercube } from "../src/core/hypercube.js";
import { identity } from "../src/core/matrix.js";

// A canvas-free renderer stub: records every coordinate handed to the 2D
// context so the test can assert the fit never emits a non-finite number.
function stubRenderer() {
  const coords = [];
  const record =
    (arity) =>
    (...args) => {
      for (let i = 0; i < arity; i++) coords.push(args[i]);
    };
  const ctx = {
    moveTo: record(2),
    lineTo: record(2),
    arc: record(3),
    beginPath() {},
    closePath() {},
    stroke() {},
    fill() {},
    save() {},
    restore() {},
  };
  return { renderer: { width: 800, height: 600, ctx, begin() {} }, coords };
}

test("scene fit survives a projection collapsed to a point", () => {
  const { renderer, coords } = stubRenderer();
  const scene = createScene(renderer);
  const state = {
    geometry: hypercube(2),
    Q: identity(2),
    projection: "perspective",
    dolly: 1,
    mirrorScale: null,
    gray: false,
    view: "solid",
  };

  // A normal frame first, then a frame whose every vertex sits at the
  // origin: maxR = 0, the degenerate instant the fit guard covers.
  scene.draw(state, 0);
  const collapsed = {
    ...state,
    geometry: {
      n: 2,
      vertices: [
        [0, 0],
        [0, 0],
      ],
      edges: [[0, 1]],
      faces: [],
    },
  };
  scene.draw(collapsed, 0.1);

  assert.ok(coords.length > 0, "the stub recorded drawing calls");
  for (const c of coords) assert.ok(Number.isFinite(c), `non-finite ${c}`);
});
