import { test } from "node:test";
import assert from "node:assert/strict";
import { createScene } from "../src/render/scene.js";
import { hypercube } from "../src/core/hypercube.js";
import { section } from "../src/core/section.js";
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

test("canvas y is the negation of mathematical y", () => {
  const ops = [];
  const ctx = {
    moveTo: (x, y) => ops.push([x, y]),
    lineTo: (x, y) => ops.push([x, y]),
    arc() {},
    beginPath() {},
    closePath() {},
    stroke() {},
    fill() {},
    save() {},
    restore() {},
  };
  const renderer = { width: 800, height: 600, ctx, begin() {} };
  const scene = createScene(renderer);
  scene.draw(
    {
      geometry: hypercube(2),
      Q: identity(2),
      projection: "orthographic",
      dolly: 1,
      mirrorScale: null,
      gray: false,
      view: "solid",
      paused: true,
    },
    0,
  );
  // n = 2 is already on the screen, so the vertices stay at ±0.5.
  const fit = (0.36 * 600) / Math.hypot(0.5, 0.5);
  const near = (x, y) =>
    ops.some((p) => Math.abs(p[0] - x) < 1e-6 && Math.abs(p[1] - y) < 1e-6);
  assert.ok(near(0.5 * fit, -0.5 * fit), "math +y is toward the top");
  assert.ok(near(0.5 * fit, 0.5 * fit), "math −y is toward the bottom");
});

test("a paused scene does not walk the comet", () => {
  function harness() {
    const arcs = [];
    const ctx = {
      moveTo() {},
      lineTo() {},
      arc: (x, y) => arcs.push([x, y]),
      beginPath() {},
      closePath() {},
      stroke() {},
      fill() {},
      save() {},
      restore() {},
    };
    return {
      scene: createScene({ width: 800, height: 600, ctx, begin() {} }),
      arcs,
    };
  }
  const state = {
    geometry: hypercube(4),
    Q: identity(4),
    projection: "perspective",
    dolly: 1,
    mirrorScale: null,
    gray: true,
    view: "solid",
    paused: true,
  };
  const held = harness();
  held.scene.draw(state, 0);
  const atStart = held.arcs.at(-1);
  held.scene.draw(state, 4);
  assert.deepEqual(held.arcs.at(-1), atStart);
  const moving = harness();
  const live = { ...state, paused: false };
  moving.scene.draw(live, 0);
  const before = moving.arcs.at(-1);
  moving.scene.draw(live, 2);
  assert.notDeepEqual(moving.arcs.at(-1), before);
});

test("the section is drawn on the cube, and the comet stays off", () => {
  const strokes = [];
  const arcs = [];
  let path = [];
  const ctx = {
    moveTo(x, y) {
      path = [[x, y]];
    },
    lineTo(x, y) {
      path.push([x, y]);
    },
    arc(x, y) {
      arcs.push([x, y]);
    },
    beginPath() {},
    closePath() {},
    stroke() {
      if (path.length >= 2) strokes.push(path);
    },
    fill() {},
    save() {},
    restore() {},
  };
  const scene = createScene({ width: 800, height: 600, ctx, begin() {} });
  const cube = hypercube(3);
  scene.draw(
    {
      n: 3,
      view: "section",
      geometry: section(3, 0),
      Q: identity(3),
      projection: "orthographic",
      dolly: 1,
      mirrorScale: null,
      gray: true,
      paused: true,
    },
    0,
  );
  const ghost = strokes.slice(0, cube.edges.length);
  const cut = strokes.slice(cube.edges.length);
  assert.equal(ghost.length, cube.edges.length);
  assert.equal(cut.length, 6, "hexagon edges, and no comet strokes");
  assert.equal(arcs.length, 0);
  const onSegment = (p, a, b) => {
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const ab2 = abx * abx + aby * aby;
    const t = ab2 === 0 ? 0 : ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / ab2;
    if (t < -1e-4 || t > 1 + 1e-4) return false;
    const dx = a[0] + abx * t - p[0];
    const dy = a[1] + aby * t - p[1];
    return dx * dx + dy * dy < 1e-4;
  };
  for (const seg of cut) {
    for (const p of seg) {
      assert.ok(
        ghost.some((g) => onSegment(p, g[0], g[1])),
        "a cut vertex left the cube's wire",
      );
    }
  }

  strokes.length = 0;
  arcs.length = 0;
  scene.draw(
    {
      n: 3,
      view: "section",
      geometry: section(3, 1.5),
      Q: identity(3),
      projection: "orthographic",
      dolly: 1,
      mirrorScale: null,
      gray: true,
      paused: true,
    },
    1,
  );
  assert.equal(strokes.length, cube.edges.length);
  assert.equal(arcs.length, 1, "the apex is a dot");
});
