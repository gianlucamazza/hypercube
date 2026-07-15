import { test } from "node:test";
import assert from "node:assert/strict";
import {
  XR_DEFAULTS,
  parseXrConfig,
  resolveXrConfig,
  clamp,
  DEADZONE,
  GRAB_SENS,
  TARGET_RADIUS,
} from "../src/render/xr-config.js";

test("parseXrConfig with empty input returns defaults copy", () => {
  const a = parseXrConfig("");
  const b = parseXrConfig(null);
  assert.equal(a.grabSens, XR_DEFAULTS.grabSens);
  assert.equal(b.deadzone, XR_DEFAULTS.deadzone);
  assert.notEqual(a, XR_DEFAULTS);
});

test("named exports match XR_DEFAULTS", () => {
  assert.equal(DEADZONE, XR_DEFAULTS.deadzone);
  assert.equal(GRAB_SENS, XR_DEFAULTS.grabSens);
  assert.equal(TARGET_RADIUS, XR_DEFAULTS.targetRadius);
});

test("URL aliases map and clamp", () => {
  const cfg = parseXrConfig("?grab=3.2&radius=0.5&deadzone=0.15&unknown=9");
  assert.equal(cfg.grabSens, 3.2);
  assert.equal(cfg.targetRadius, 0.5);
  assert.equal(cfg.deadzone, 0.15);
  // Unknown keys do not appear / do not break.
  assert.equal(cfg.stickRotate, XR_DEFAULTS.stickRotate);
});

test("out-of-range values clamp to safe bounds", () => {
  const hi = parseXrConfig("?grab=999&radius=0.01&deadzone=-1");
  assert.equal(hi.grabSens, 8);
  assert.equal(hi.targetRadius, 0.15);
  assert.equal(hi.deadzone, 0.02);

  const lo = parseXrConfig({ grab: "0.1", rotate: "0.01" });
  assert.equal(lo.grabSens, 0.4);
  assert.equal(lo.stickRotate, 0.2);
});

test("non-finite values ignored", () => {
  const cfg = parseXrConfig("?grab=nope&dolly=");
  assert.equal(cfg.grabSens, XR_DEFAULTS.grabSens);
  assert.equal(cfg.stickDolly, XR_DEFAULTS.stickDolly);
});

test("line min/max stay ordered after clamp", () => {
  const cfg = parseXrConfig("?linemin=0.005&linemax=0.001");
  assert.ok(cfg.edgeHalfWidthMin <= cfg.edgeHalfWidthMax);
});

test("resolveXrConfig accepts full search string", () => {
  const cfg = resolveXrConfig("?latticex=-0.8&idle=5000");
  assert.equal(cfg.latticeOffsetX, -0.8);
  assert.equal(cfg.idleMs, 5000);
});

test("clamp helper on unknown key falls back to default-like", () => {
  // Unknown keys are not in CLAMP — returns XR_DEFAULTS[key] which is undefined.
  assert.equal(clamp("nope", 1), undefined);
  assert.equal(clamp("grabSens", 100), 8);
});
