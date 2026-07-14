# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [0.1.1] — 2026-07-14

### Changed

- Simultaneous plane velocities now integrate as the exact, order-independent
  flow `exp(dt·Ω)`, including noncommuting (intersecting) planes, replacing the
  sequential first-order approximation. Equal disjoint velocities give an exact
  isoclinic double rotation.
- Terminology precision. The projection boundedness theorem is stated under the
  weaker **opposite-ray** hypothesis (`{αx, −βx}`, exact antipodes as the
  α = β = 1 case). The `schlegel` mode is described as **Schlegel-style** — a
  genuine Schlegel diagram only in the frontal facet pose, a support-following
  perspective under free rotation. Motion-preset notes (`tumble`, `within`)
  reworded for accuracy.

## [0.1.0] — 2026-07-13

First public release.

### Added

- Wireframe visualization of the n-cube for n = 2..6 on a single Canvas 2D,
  zero dependencies, no build step.
- Three projections — perspective cascade, orthographic, Schlegel diagram
  with translucent face veils — plus the unfolded **net** view (the Dalí
  cross at n = 4), all driven by the same rotate → project pipeline.
- Rotation in any of the C(n,2) coordinate planes: drag, arrow keys,
  motion presets (stillness, isocline, tumble, within), and exact
  quarter-turns (double-click or Shift+Enter on a plane dot).
- The B_n symmetry grid: n axis mirrors animated as a collapse through the
  (n−1)-shadow, alongside the rotation planes that generate the
  2ⁿ·n! symmetries.
- The Gray-code comet: a Hamiltonian cycle on Q_n, walked one bit at a time.
- Depth as presence (alpha/width), the extra dimension as temperature
  (violet → amber); idle-fading chrome; shareable pose via URL parameters.
- `docs/mathematics.md`: the constructions with proofs — the projection
  boundedness theorem (adaptive camera floor, per-stage magnification
  ≤ 1 + 1/0.35 under the sign-antipodal hypothesis), orientation
  preservation of Gram–Schmidt (`Q ∈ SO(n)`), the net as a genuine
  isometric development, isoclinic great circles at n = 4.
- Tests: `node --test` suite pinning every claim (element counts, Hamming
  edges, rotation handedness, det(Q) = +1, net spanning tree and
  disjointness, per-stage projection bounds over a seeded pose sweep with
  adversarial witnesses D1–D6); `tools/verify.mjs` end-to-end checks in
  headless Chromium; `tools/shots.mjs` visual QA matrix; CI runs test,
  verify, and deploys to GitHub Pages.

[0.1.1]: https://github.com/gianlucamazza/hypercube/releases/tag/v0.1.1
[0.1.0]: https://github.com/gianlucamazza/hypercube/releases/tag/v0.1.0
