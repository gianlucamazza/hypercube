# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Diagonal section view (`section`). The body-fixed cut `Σ xᵢ = h` of the
  n-cube is drawn by the same pose and the same projection, with the cube
  kept as a faint wire underneath. At n = 3 the midsection is the regular
  hexagon and the open interval above it an equilateral triangle. At n = 4
  the midsection is the regular octahedron, the slice toward a vertex the
  regular tetrahedron, and at `h = ±0.5` the truncated tetrahedron
  (12 vertices, 18 equal edges, 4 triangles and 4 regular hexagons). The
  open interval between them keeps that count and not the equal edges. The
  height sweeps from apex to apex; pausing stores it as `cut`.
- The n = 5 census of the same cut. Cells are the intersections with the
  4-cubes, checked against an independent tally. Named only where the edges
  are equal and the hexagons, when there are any, are regular: the regular
  4-simplex on `3/2 ≤ |h| < 5/2` (the layer included, the apex not), the
  truncated 5-cell at `|h| = 1`, the rectified 5-cell at `|h| = 1/2`, and
  the bitruncated 5-cell at `h = 0`. Above n = 5 the slice is still counted
  and left unnamed.
- WebXR progressive enhancement: when the browser supports `immersive-vr`,
  an **enter vr** control opens a stereoscopic presentation of the intermediate
  3-space projection (Meta Quest, desktop VR, etc.). Same pure-math core and
  pose state; zero new dependencies.
- `project(..., { stopAt: 3 })` leaves the cascade in 3-space for the XR path.
- VR excellence pass: camera-facing thick edges, Schlegel face veils, comet
  head + glow, enter ease, dual-hand grab-to-turn, dual sticks, diegetic B_n
  lattice with ray select (toggle / quarter-turn / mirror), preset and
  projection cycle, dual-grip recenter, idle-fading chrome, `docs/vr.md`.

### Fixed

- XR path: painter-sorted translucent geometry, reused buffers + cached Gray
  cycle, placement for `local` vs `local-floor`, and a re-entry guard while
  the session is starting.
- Canvas mathematical +y is up, matching the headset. Drag, the arrow keys,
  and the dominant stick follow that picture; grip travel in world metres
  was already the lift.
- The Gray-code comet draws only the trail already travelled, and its clock
  stops while the loop is paused.
- Finishing a mirror reverses the planes through that axis. `Q` stays in
  `SO(n)`. A quarter-turn already in progress reverses its direction instead
  of jumping to a stored absolute angle.
- A plane-grid click timer is cleared when the grid is rebuilt. Toggles and
  quarter-turns ignore a plane index outside the current dimension.
- In VR a single trigger waits out the double-trigger window before toggling
  a plane; a second trigger or a squeeze in that window quarter-turns and
  cancels the toggle. The ray ribbon ends on the lattice hit. Lattice
  markers face the headset. Translucent geometry is sorted by distance to
  the headset.
- The wheel respects line and page `deltaMode` values.
- A projection preset is cleared when the projection changes away from it,
  or when the view leaves the solid.
- A failed WebXR start is written on the enter button (`vr failed`, with
  the reason as its title) and announced politely. The next attempt restores
  `enter vr`.
- The bottom bar wraps, and below 1200px the plane grid moves up so the two
  no longer overlap.

### Changed

- In the section view the structure panel counts the cut (vertices, edges,
  faces, the cells for n ≥ 4, and the height). It names the figure only at
  a height the census has proved. The n-cube formula stays visible as
  context. The Gray-code control is disabled there, without clearing the
  comet, and the comet is not drawn: its index is a cube vertex.
- VR comfort knobs centralized in `src/render/xr-config.js`, overridable at
  enter-VR via URL query (`?grab=…&radius=…`). Field checklist in `docs/vr.md`.
- Temperature is the mean of every axis the cascade drops before 3-space.
  At n = 4 that is still the single `w` channel.
- The shareable pose adds `cam`, `q`, and `planes` (`preset=custom`). Writes
  are throttled and keep VR query keys. `dolly` remains the VR stick.
- `isocline` great circles are stated for n = 4 only (four circles, four
  vertices each; above that, small circles). `tumble` is one steady rotation
  for n ≤ 3 (period ≈ 25.2 s at n = 3) and quasiperiodic on a torus for
  n ≥ 4 (n = 4: λ ≈ 0.043 and 0.259), not an aperiodic drift.
- `docs/screenshot.png` is the picture from before mathematical +y pointed
  up, so it is mirrored vertically relative to the current canvas.

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
