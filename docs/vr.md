# VR experience

Progressive WebXR path for the n-cube. Same pure math core and pose state as
the Canvas 2D view; a stereoscopic WebGL presentation when the browser
supports `immersive-vr` (Meta Quest Browser, Chrome + SteamVR, …).

## Design intent

Contemplative first. The object floats at arm’s length in the void. After
three seconds without controller input the diegetic B_n lattice fades and only
the hypercube remains — the same idle dissolve as the desktop chrome.

Signature moments that stereo makes stronger than the flat view:

- **Isocline** at n = 4 — every vertex on a great circle of the 3-sphere.
- **Within / Schlegel** — nested cells with real volume (translucent veils).
- **Mirror collapse** — an axis of B_n watched through its (n−1)-shadow.
- **Grab-to-turn** — the desktop drag, made corporeal.

## Requirements

- Secure context (HTTPS or localhost).
- `n ≥ 3` (stereo needs 3-space).
- Zero npm dependencies; no build step.

## Controls (`xr-standard`)

| Input | Action |
| --- | --- |
| Dominant stick X/Y | Rotate screen-facing planes |
| Off-hand stick Y | Dolly |
| Off-hand stick X (n ≥ 4) | Rotate against the highest axis |
| Dominant grip + move | Grab-turn (screen planes) |
| Off-hand grip + move (n ≥ 4) | Grab-turn against highest axis |
| Ray + trigger on plane dot | Toggle plane velocity |
| Ray + double-trigger / squeeze on plane | Exact quarter-turn |
| Ray + trigger on square | Mirror that axis |
| Dominant stick click | Cycle projection |
| Off-hand stick click | Cycle motion preset |
| A / X | Pause |
| B / Y | Exit VR |
| Both grips 1 s | Recenter object in front of you |

The lattice sits to the left of the object: circles are C(n,2) planes,
squares are the n axis mirrors (hidden in net view).

## Comfort

- Per-frame rotation clamp; stick deadzone; no artificial locomotion.
- Enter ease is skipped when `prefers-reduced-motion: reduce`.
- World-locked object; walk around it if the guardian allows.

## Architecture

```
src/render/xr-config.js    comfort knobs + URL overrides
src/render/xr-session.js   enter/exit, reference space
src/render/xr-input.js     pure FSM (unit-tested)
src/render/xr-ui.js        B_n lattice layout + idle fade
src/render/xr-renderer.js  thick lines, veils, comet, lattice draw
src/core/projection.js     stopAt: 3 intermediate cloud
```

## Field tuning (Quest checklist)

Defaults live in `src/render/xr-config.js`. On a headset you can override without
rebuild via query string (parsed at **enter vr**):

```
https://gianlucamazza.github.io/hypercube/?grab=3.2&radius=0.5&deadzone=0.15
```

| Query | Config key | Default | Role |
| --- | --- | --- | --- |
| `grab` | `grabSens` | 2.8 | rad per metre grip travel |
| `rotate` | `stickRotate` | 1.6 | stick orbit rad/s |
| `dolly` | `stickDolly` | 1.4 | stick dolly rate |
| `deadzone` | `deadzone` | 0.12 | stick deadzone |
| `maxdtheta` | `maxDTheta` | 0.12 | rad/frame clamp (comfort) |
| `radius` | `targetRadius` | 0.42 | object size (m) |
| `distance` | `viewDistance` | 1.8 | recenter distance (m) |
| `floory` / `worldz` | placement | 1.25 / −1.8 | default pose |
| `latticex` | `latticeOffsetX` | −0.55 | lattice lateral offset |
| `idle` | `idleMs` | 3000 | chrome fade delay |
| `linemin` / `linemax` | edge half-width | 0.0009 / 0.0024 | wire thickness (m) |
| `enter` | `enterMs` | 800 | enter ease (0 = snap) |

### Checklist (tick on device)

- [ ] Default distance / height feel arm’s-length (try recenter: both grips 1 s)
- [ ] Grab: not sluggish, not nauseating (`grab`, `maxdtheta`)
- [ ] Stick orbit smooth (`rotate`, `deadzone`)
- [ ] Dolly range usable (`dolly`, then wheel-equivalent feel)
- [ ] Wire thickness readable at n=4 and n=6 (`linemin` / `linemax`)
- [ ] Lattice ray targets reachable, not covering the object (`latticex`, `spacing`)
- [ ] Idle fade leaves only the object (~3 s)
- [ ] Isocline n=4 / Within+Schlegel / mirror collapse still “aha”
- [ ] n=6 tumble + Schlegel feels ≥ 72 Hz on Quest 2

When a value lands better than the default, update `XR_DEFAULTS` in
`xr-config.js` and drop the query param.
