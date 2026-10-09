import { test } from "node:test";
import assert from "node:assert/strict";
import { identity } from "../src/core/matrix.js";
import { applyPlaneRotation } from "../src/core/rotation.js";
import {
  decodePlanes,
  decodeQ,
  poseSearch,
} from "../src/ui/pose-url.js";
import { assertMatrixClose } from "./helpers.js";

test("poseSearch keeps VR keys and round-trips cam, q, and planes", () => {
  const Q = applyPlaneRotation(identity(4), 0, 1, 0.3);
  const state = {
    n: 4,
    view: "net",
    projection: "schlegel",
    preset: null,
    gray: true,
    dolly: 1.5,
    Q,
    velocities: new Map([
      ["0,1", 0.2],
      ["1,3", -0.15],
      ["0,9", 1],
    ]),
  };
  const search = poseSearch("?grab=3.2&dolly=0.5", state);
  const params = new URLSearchParams(search.slice(1));
  assert.equal(params.get("grab"), "3.2");
  assert.equal(params.get("dolly"), "0.5");
  assert.equal(params.get("cam"), "1.500");
  assert.equal(params.get("preset"), "custom");
  assert.equal(params.get("view"), "net");
  assert.equal(params.get("projection"), "schlegel");
  assert.equal(params.get("gray"), "1");
  assert.equal(params.get("n"), null);
  const back = decodeQ(params.get("q"), 4);
  assert.ok(back);
  assertMatrixClose(back, Q, 1e-4);
  const planes = decodePlanes(params.get("planes"), 4);
  assert.equal(planes.get("0,1"), 0.2);
  assert.equal(planes.get("1,3"), -0.15);
  assert.equal(planes.has("0,9"), false);
});

test("defaults and a near-identity pose stay out of the query", () => {
  const search = poseSearch("?radius=0.5", {
    n: 4,
    view: "solid",
    projection: "perspective",
    preset: "stillness",
    gray: false,
    dolly: 1,
    Q: identity(4),
    velocities: new Map([["0,3", 0.15]]),
  });
  assert.equal(search, "?radius=0.5");
});

test("decodeQ rejects a length or a rank that does not match n", () => {
  assert.equal(decodeQ("1,0,0,1", 3), null);
  assert.equal(decodeQ("1,0,0,0", 2), null);
  assert.equal(decodeQ("nope", 2), null);
});

test("a paused section records cut, and a moving one does not", () => {
  const base = {
    n: 4,
    view: "section",
    projection: "perspective",
    preset: "stillness",
    gray: false,
    dolly: 1,
    Q: identity(4),
    velocities: new Map(),
    cut: 0.5,
  };
  const playing = new URLSearchParams(poseSearch("", { ...base, paused: false }).slice(1));
  assert.equal(playing.get("view"), "section");
  assert.equal(playing.get("cut"), null);
  assert.equal(playing.get("cam"), null);
  const held = new URLSearchParams(
    poseSearch("?dolly=0.4", { ...base, paused: true }).slice(1),
  );
  assert.equal(held.get("cut"), "0.5000");
  assert.equal(held.get("dolly"), "0.4");
  assert.equal(held.get("cam"), null);
  const left = poseSearch("?view=section&cut=0.5000", {
    ...base,
    view: "solid",
    paused: true,
  });
  assert.equal(left.includes("cut"), false);
});

test("decodePlanes drops a plane the dimension cannot hold", () => {
  const planes = decodePlanes("0-1:0.2000;1-4:0.1000;2-3:0", 4);
  assert.equal(planes.size, 1);
  assert.equal(planes.get("0,1"), 0.2);
});
