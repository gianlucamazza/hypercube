import { test } from "node:test";
import assert from "node:assert/strict";
import { identity, mulMat, mulMatVec } from "../src/core/matrix.js";
import { composeVelocities, velocityGenerator } from "../src/core/rotation.js";
import { hypercube } from "../src/core/hypercube.js";
import { PRESETS } from "../src/ui/presets.js";
import { assertClose, assertMatrixClose } from "./helpers.js";

const tumble = PRESETS.find((p) => p.name === "tumble");
const isocline = PRESETS.find((p) => p.name === "isocline");

function charPoly(A) {
  const n = A.length;
  let B = identity(n);
  const c = [1];
  for (let k = 1; k <= n; k++) {
    const Ak = mulMat(A, B);
    let tr = 0;
    for (let i = 0; i < n; i++) tr += Ak[i][i];
    const ck = -tr / k;
    c.push(ck);
    B = Ak.map((row, i) => row.map((x, j) => x + (i === j ? ck : 0)));
  }
  return c;
}

test("tumble at n = 3 is one steady rotation of period ≈ 25.222 s", () => {
  const speed = Math.hypot(0.21, 0.134);
  assertClose(speed, 0.249110417285187, 1e-12);
  const period = (2 * Math.PI) / speed;
  assertClose(period, 25.222491197493596, 1e-9);
  const Q = composeVelocities(identity(3), tumble.velocities(3), period);
  assertMatrixClose(Q, identity(3), 1e-8);
});

test("tumble at n = 4 is quasiperiodic on two incommensurate frequencies", () => {
  const c = charPoly(velocityGenerator(4, tumble.velocities(4)));
  assertClose(c[0], 1, 1e-12);
  assertClose(c[1], 0, 1e-12);
  assertClose(c[2], 13789 / 200000, 1e-12);
  assertClose(c[3], 0, 1e-12);
  assertClose(c[4], 30924721 / 250000000000, 1e-12);

  // Discriminant of μ² + b μ + c = 0, μ = λ². Not a square ⇒ λ₁/λ₂ irrational.
  const num = 4258617489n;
  const root = 65258n;
  assert.ok(root * root < num && (root + 1n) * (root + 1n) > num);

  const b = 13789 / 200000;
  const disc = Number(num) / 1e12;
  // Roots of the characteristic polynomial are −λ² (eigenvalues ±iλ).
  const mu1 = (-b + Math.sqrt(disc)) / 2;
  const mu2 = (-b - Math.sqrt(disc)) / 2;
  const lo = Math.sqrt(-Math.max(mu1, mu2));
  const hi = Math.sqrt(-Math.min(mu1, mu2));
  assertClose(lo, 0.0429355115, 1e-9);
  assertClose(hi, 0.2590396531, 1e-9);
  const beat = (2 * Math.PI) / (hi - lo);
  assert.ok(beat > 28 && beat < 30, `beat ${beat}`);
});

test("isocline at n = 4 puts the 16 vertices on 4 great circles", () => {
  const J = (v) => [-v[1], v[0], -v[3], v[2]];
  const key = (v) => v.map((x) => Math.round(x * 2)).join(",");
  const circles = new Set();
  for (const v of hypercube(4).vertices) {
    const orbit = [v, J(v), v.map((x) => -x), J(v).map((x) => -x)];
    const labels = orbit.map(key);
    assert.equal(new Set(labels).size, 4);
    for (const u of orbit) {
      assertClose(Math.hypot(...u), 1, 1e-12);
      assertClose(Math.hypot(...u.map((x, i) => x - 0)), 1, 1e-12);
    }
    // Jv is orthogonal to v, so the circle passes through the origin's plane.
    assertClose(
      v.reduce((s, x, i) => s + x * J(v)[i], 0),
      0,
      1e-12,
    );
    circles.add(labels.slice().sort().join("|"));
  }
  assert.equal(circles.size, 4);
});

test("isocline above n = 4 is a small circle", () => {
  const verts = hypercube(5).vertices;
  for (const v of verts) {
    assert.equal(Math.abs(v[2]), 0.5);
    const radial = Math.hypot(v[0], v[1], v[3], v[4]);
    const circum = Math.hypot(...v);
    assert.ok(radial < circum - 0.05);
  }
  // The preset really does leave axis 2 fixed at n = 5.
  const planes = isocline.velocities(5).map((v) => v.plane.join(","));
  assert.deepEqual(planes, ["0,1", "3,4"]);
  const spun = mulMatVec(
    composeVelocities(identity(5), isocline.velocities(5), 0.4),
    verts[0],
  );
  assertClose(spun[2], verts[0][2], 1e-12);
});
