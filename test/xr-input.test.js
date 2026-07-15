import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deadzone,
  edge,
  clampTheta,
  createXrInput,
  raySphereHit,
  pickLattice,
  MAX_DTHETA,
  DEADZONE,
  RECENTER_HOLD_MS,
} from "../src/render/xr-input.js";

test("deadzone zeroes small deflections", () => {
  assert.equal(deadzone(0), 0);
  assert.equal(deadzone(DEADZONE / 2), 0);
  assert.ok(deadzone(0.5) === 0.5);
});

test("edge detects press transitions only", () => {
  assert.equal(edge([true], [false], 0), true);
  assert.equal(edge([true], [true], 0), false);
  assert.equal(edge([false], [true], 0), false);
});

test("clampTheta limits per-frame rotation", () => {
  assert.equal(clampTheta(1), MAX_DTHETA);
  assert.equal(clampTheta(-1), -MAX_DTHETA);
  assert.equal(clampTheta(0.01), 0.01);
});

test("raySphereHit finds a forward intersection", () => {
  const t = raySphereHit([0, 0, 0], [0, 0, 1], [0, 0, 2], 0.5);
  assert.ok(t != null && t > 0 && t < 2.5);
  assert.equal(raySphereHit([0, 0, 0], [0, 0, 1], [0, 5, 2], 0.1), null);
});

test("pickLattice chooses the nearest target", () => {
  const rays = [
    { origin: [0, 0, 0], direction: [0, 0, 1], id: "right" },
  ];
  const targets = [
    { kind: "plane", key: "0,1", pos: [0, 0, 3] },
    { kind: "plane", key: "0,2", pos: [0, 0, 1.5] },
  ];
  const hit = pickLattice(rays, targets, 0.2);
  assert.equal(hit.target.key, "0,2");
});

test("dominant stick produces screen-facing rotation", () => {
  const input = createXrInput();
  const g = input.step({
    controllers: [
      {
        id: "right",
        hand: "right",
        buttons: [false, false, false, false, false, false],
        stickX: 1,
        stickY: 0,
        grip: false,
        trigger: false,
        stickClick: false,
        btnA: false,
        btnB: false,
        pos: null,
        dir: null,
      },
    ],
    dt: 0.016,
    now: 1000,
    n: 4,
  });
  assert.ok(g.rotate.length >= 1);
  assert.equal(g.rotate[0].i, 0);
  assert.equal(g.rotate[0].j, 2); // depth axis at n=4
  assert.ok(g.wake);
});

test("A button edge pauses; B exits", () => {
  const input = createXrInput();
  // First frame: no edge
  input.step({
    controllers: [
      {
        id: "right",
        hand: "right",
        buttons: [false, false, false, false, false, false],
        stickX: 0,
        stickY: 0,
        grip: false,
        trigger: false,
        stickClick: false,
        btnA: false,
        btnB: false,
        pos: null,
        dir: null,
      },
    ],
    dt: 0.016,
    now: 0,
    n: 4,
  });
  const pause = input.step({
    controllers: [
      {
        id: "right",
        hand: "right",
        buttons: [false, false, false, false, true, false],
        stickX: 0,
        stickY: 0,
        grip: false,
        trigger: false,
        stickClick: false,
        btnA: true,
        btnB: false,
        pos: null,
        dir: null,
      },
    ],
    dt: 0.016,
    now: 16,
    n: 4,
  });
  assert.equal(pause.pause, true);
  assert.equal(pause.exit, false);

  const exit = input.step({
    controllers: [
      {
        id: "right",
        hand: "right",
        buttons: [false, false, false, false, false, true],
        stickX: 0,
        stickY: 0,
        grip: false,
        trigger: false,
        stickClick: false,
        btnA: false,
        btnB: true,
        pos: null,
        dir: null,
      },
    ],
    dt: 0.016,
    now: 32,
    n: 4,
  });
  assert.equal(exit.exit, true);
});

test("grip grab on dominant hand rotates screen planes", () => {
  const input = createXrInput();
  // Press grip at origin
  input.step({
    controllers: [
      {
        id: "right",
        hand: "right",
        buttons: [false, true, false, false, false, false],
        stickX: 0,
        stickY: 0,
        grip: true,
        trigger: false,
        stickClick: false,
        btnA: false,
        btnB: false,
        pos: [0, 0, 0],
        dir: null,
      },
    ],
    dt: 0.016,
    now: 0,
    n: 4,
  });
  // Move controller +X
  const g = input.step({
    controllers: [
      {
        id: "right",
        hand: "right",
        buttons: [false, true, false, false, false, false],
        stickX: 0,
        stickY: 0,
        grip: true,
        trigger: false,
        stickClick: false,
        btnA: false,
        btnB: false,
        pos: [0.05, 0, 0],
        dir: null,
      },
    ],
    dt: 0.016,
    now: 16,
    n: 4,
  });
  assert.ok(g.rotate.some((r) => r.i === 0 && r.j === 2 && r.theta > 0));
});

test("dual grip held long enough requests recenter", () => {
  const input = createXrInput();
  const ctrl = (id, hand) => ({
    id,
    hand,
    buttons: [false, true, false, false, false, false],
    stickX: 0,
    stickY: 0,
    grip: true,
    trigger: false,
    stickClick: false,
    btnA: false,
    btnB: false,
    pos: [0, 0, 0],
    dir: null,
  });
  input.step({
    controllers: [ctrl("left", "left"), ctrl("right", "right")],
    dt: 0.016,
    now: 0,
    n: 4,
  });
  const early = input.step({
    controllers: [ctrl("left", "left"), ctrl("right", "right")],
    dt: 0.016,
    now: RECENTER_HOLD_MS - 50,
    n: 4,
  });
  assert.equal(early.recenter, false);
  const late = input.step({
    controllers: [ctrl("left", "left"), ctrl("right", "right")],
    dt: 0.016,
    now: RECENTER_HOLD_MS + 10,
    n: 4,
  });
  assert.equal(late.recenter, true);
});

test("offhand stick Y dollies", () => {
  const input = createXrInput();
  const g = input.step({
    controllers: [
      {
        id: "right",
        hand: "right",
        buttons: [false, false, false, false, false, false],
        stickX: 0,
        stickY: 0,
        grip: false,
        trigger: false,
        stickClick: false,
        btnA: false,
        btnB: false,
        pos: null,
        dir: null,
      },
      {
        id: "left",
        hand: "left",
        buttons: [false, false, false, false, false, false],
        stickX: 0,
        stickY: 1,
        grip: false,
        trigger: false,
        stickClick: false,
        btnA: false,
        btnB: false,
        pos: null,
        dir: null,
      },
    ],
    dt: 0.1,
    now: 0,
    n: 4,
  });
  assert.ok(g.dollyFactor < 1);
});
