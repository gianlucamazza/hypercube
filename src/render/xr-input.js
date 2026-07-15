// Pure XR input FSM: sticks, grip-grab deltas, button edges, dual-grip recenter.
// No DOM / WebGL — unit-tested. The host feeds raw controller snapshots each
// frame and receives actions to dispatch onto the shared app state.
// Comfort knobs: src/render/xr-config.js (URL-overridable).

import {
  XR_DEFAULTS,
  DEADZONE,
  STICK_ROTATE,
  STICK_DOLLY,
  GRAB_SENS,
  MAX_DTHETA,
  RECENTER_HOLD_MS,
  DOUBLE_MS,
} from "./xr-config.js";

export {
  DEADZONE,
  STICK_ROTATE,
  STICK_DOLLY,
  GRAB_SENS,
  MAX_DTHETA,
  RECENTER_HOLD_MS,
  DOUBLE_MS,
};

export function deadzone(v, z = DEADZONE) {
  return Math.abs(v) < z ? 0 : v;
}

export function edge(next, prev, i) {
  return !!(next[i] && !prev[i]);
}

export function clampTheta(t, max = MAX_DTHETA) {
  if (t > max) return max;
  if (t < -max) return -max;
  return t;
}

// Build a per-frame controller snapshot from WebXR inputSources.
// frame + refSpace are optional: without poses, grab deltas are zero.
export function sampleControllers(session, frame, refSpace, cfg = XR_DEFAULTS) {
  const list = [];
  const dz = cfg.deadzone ?? DEADZONE;
  for (const source of session.inputSources) {
    const gp = source.gamepad;
    if (!gp) continue;
    const hand = source.handedness === "left" || source.handedness === "right"
      ? source.handedness
      : "none";
    const buttons = (gp.buttons || []).map((b) => !!(b && b.pressed));
    let stickX = 0;
    let stickY = 0;
    if (gp.axes && gp.axes.length >= 2) {
      const ax = gp.axes.length >= 4 ? 2 : 0;
      const ay = gp.axes.length >= 4 ? 3 : 1;
      stickX = deadzone(gp.axes[ax] || 0, dz);
      stickY = deadzone(gp.axes[ay] || 0, dz);
    }
    let pos = null;
    let dir = null;
    if (frame && refSpace) {
      const space = source.gripSpace || source.targetRaySpace;
      if (space) {
        const pose = frame.getPose(space, refSpace);
        if (pose) {
          const m = pose.transform.matrix;
          pos = [m[12], m[13], m[14]];
        }
      }
      if (source.targetRaySpace) {
        const rayPose = frame.getPose(source.targetRaySpace, refSpace);
        if (rayPose) {
          const m = rayPose.transform.matrix;
          // Column-major: forward is -Z of the orientation (indices 8,9,10).
          dir = [-m[8], -m[9], -m[10]];
          if (!pos) pos = [m[12], m[13], m[14]];
        }
      }
    }
    list.push({
      id: hand !== "none" ? hand : source.targetRayMode || "unknown",
      hand,
      buttons,
      stickX,
      stickY,
      // xr-standard: 0 trigger, 1 squeeze, 3 stick click, 4 A/X, 5 B/Y
      grip: !!buttons[1],
      trigger: !!buttons[0],
      stickClick: !!buttons[3],
      btnA: !!buttons[4],
      btnB: !!buttons[5],
      pos,
      dir,
    });
  }
  return list;
}

export function createXrInput(initialConfig = XR_DEFAULTS) {
  /** @type {Map<string, boolean[]>} */
  let prevButtons = new Map();
  /** @type {Map<string, number[]|null>} */
  let grabOrigin = new Map();
  let bothGripsSince = null;
  let lastTriggerAt = 0;
  let lastTriggerId = null;
  let cfg = { ...XR_DEFAULTS, ...initialConfig };

  function setConfig(next) {
    cfg = { ...XR_DEFAULTS, ...next };
  }

  function reset() {
    prevButtons = new Map();
    grabOrigin = new Map();
    bothGripsSince = null;
    lastTriggerAt = 0;
    lastTriggerId = null;
  }

  /**
   * @param {object} opts
   * @param {Array} opts.controllers from sampleControllers
   * @param {number} opts.dt seconds
   * @param {number} opts.now ms
   * @param {number} opts.n dimension
   * @returns gestures for the host to apply
   */
  function step({ controllers, dt, now, n }) {
    const stickRotate = cfg.stickRotate;
    const stickDolly = cfg.stickDolly;
    const grabSens = cfg.grabSens;
    const maxD = cfg.maxDTheta;
    const recenterHold = cfg.recenterHoldMs;
    const doubleMs = cfg.doubleMs;

    const out = {
      rotate: [], // { i, j, theta }
      dollyFactor: 1,
      pause: false,
      exit: false,
      recenter: false,
      cyclePreset: false,
      cycleProjection: false,
      toggleGray: false,
      // UI ray: primary right (or first) ray
      rays: [],
      select: null, // { kind, key?, axis?, double }
      wake: false,
      uiOpacityBoost: false,
    };

    let left = null;
    let right = null;
    let any = null;
    for (const c of controllers) {
      any = c;
      if (c.hand === "left") left = c;
      else if (c.hand === "right") right = c;
    }
    const dominant = right || any;
    const offhand = left && left !== dominant ? left : null;

    // --- Sticks -----------------------------------------------------------
    if (dominant) {
      const dx = dominant.stickX;
      const dy = dominant.stickY;
      if (dx || dy) {
        out.wake = true;
        const depthAxis = Math.min(2, n - 1);
        const vAxis = Math.min(1, depthAxis - 1);
        if (dx)
          out.rotate.push({
            i: 0,
            j: depthAxis,
            theta: clampTheta(dx * stickRotate * dt, maxD),
          });
        if (dy && vAxis !== depthAxis)
          out.rotate.push({
            i: vAxis,
            j: depthAxis,
            theta: clampTheta(-dy * stickRotate * dt, maxD),
          });
      }
      if (edgeButtons(dominant, 3)) {
        // stick click — cycle projection
        out.wake = true;
        out.cycleProjection = true;
      }
    }
    if (offhand) {
      if (offhand.stickY) {
        out.wake = true;
        out.dollyFactor *= Math.exp(-offhand.stickY * stickDolly * dt);
      }
      if (offhand.stickX && n >= 4) {
        out.wake = true;
        // Touch the highest axis (Shift+drag equivalent).
        out.rotate.push({
          i: 0,
          j: n - 1,
          theta: clampTheta(offhand.stickX * stickRotate * dt, maxD),
        });
      }
    }

    // --- Grip grab --------------------------------------------------------
    for (const c of controllers) {
      const prev = prevButtons.get(c.id) || [];
      const gripping = c.grip;
      const was = !!prev[1];
      if (gripping && c.pos) {
        out.wake = true;
        out.uiOpacityBoost = true;
        if (!was || !grabOrigin.has(c.id)) {
          grabOrigin.set(c.id, c.pos.slice());
        } else {
          const o = grabOrigin.get(c.id);
          const ddx = c.pos[0] - o[0];
          const ddy = c.pos[1] - o[1];
          grabOrigin.set(c.id, c.pos.slice());
          const isOffhand = offhand && c.id === offhand.id;
          if (isOffhand && n >= 4) {
            // Off-hand: travel turns against the highest axis (Shift+drag).
            const th = clampTheta(ddx * grabSens, maxD);
            if (th) out.rotate.push({ i: 0, j: n - 1, theta: th });
            const th2 = clampTheta(-ddy * grabSens, maxD);
            if (th2) out.rotate.push({ i: 1, j: n - 1, theta: th2 });
          } else {
            // Dominant / sole controller: screen-facing planes.
            const depthAxis = Math.min(2, n - 1);
            const vAxis = Math.min(1, depthAxis - 1);
            const th = clampTheta(ddx * grabSens, maxD);
            if (th) out.rotate.push({ i: 0, j: depthAxis, theta: th });
            if (vAxis !== depthAxis) {
              const thv = clampTheta(-ddy * grabSens, maxD);
              if (thv) out.rotate.push({ i: vAxis, j: depthAxis, theta: thv });
            }
          }
        }
      } else {
        grabOrigin.delete(c.id);
      }
    }

    // --- Dual grip recenter -----------------------------------------------
    const gripsDown = controllers.filter((c) => c.grip).length;
    if (gripsDown >= 2) {
      out.wake = true;
      if (bothGripsSince == null) bothGripsSince = now;
      else if (now - bothGripsSince >= recenterHold) {
        out.recenter = true;
        bothGripsSince = now + 1e9; // fire once until release
      }
    } else {
      bothGripsSince = null;
    }

    // --- Face buttons -----------------------------------------------------
    for (const c of controllers) {
      const prev = prevButtons.get(c.id) || [];
      if (edge(c.buttons, prev, 4)) {
        out.wake = true;
        out.pause = true;
      }
      if (edge(c.buttons, prev, 5)) {
        out.wake = true;
        out.exit = true;
      }
      // Y is often button 5 on left; already exit. Long-press A cycles preset:
      // use stick click on offhand or second A edge after delay — simpler:
      // double-press A cycles preset (first edge = pause only if single).
      // Plan: A = pause; stick click = projection; offhand stick click = preset.
      if (c === offhand && edge(c.buttons, prev, 3)) {
        out.wake = true;
        out.cyclePreset = true;
      }
      // Squeeze without ray UI still can toggle gray on dominant squeeze edge
      // when not used for grab start — skip to avoid conflict with grab.
    }

    // Toggle gray: both stick clicks same frame is rare; use dominant B is exit.
    // Map: dominant trigger without UI hit toggles nothing; UI handles select.

    // --- Rays for UI ------------------------------------------------------
    for (const c of controllers) {
      if (c.pos && c.dir) {
        out.rays.push({
          id: c.id,
          origin: c.pos,
          direction: c.dir,
          triggerEdge: edge(c.buttons, prevButtons.get(c.id) || [], 0),
          squeezeEdge: edge(c.buttons, prevButtons.get(c.id) || [], 1),
        });
      }
    }

    // Double-trigger detection for quarter-turn (when UI reports a plane hit).
    for (const c of controllers) {
      const prev = prevButtons.get(c.id) || [];
      if (edge(c.buttons, prev, 0)) {
        const dbl =
          lastTriggerId === c.id && now - lastTriggerAt < doubleMs;
        lastTriggerAt = now;
        lastTriggerId = c.id;
        // Host combines with ray hit; expose double flag on matching ray.
        for (const r of out.rays) {
          if (r.id === c.id) r.double = dbl;
        }
      }
    }

    // Snapshot buttons for next edge detection.
    prevButtons = new Map();
    for (const c of controllers) prevButtons.set(c.id, c.buttons.slice());

    return out;
  }

  function edgeButtons(c, i) {
    const prev = prevButtons.get(c.id) || [];
    return edge(c.buttons, prev, i);
  }

  return { step, reset, setConfig, sampleControllers };
}

// Ray vs sphere hit; returns distance or null.
export function raySphereHit(origin, dir, center, radius) {
  const ox = origin[0] - center[0];
  const oy = origin[1] - center[1];
  const oz = origin[2] - center[2];
  const dx = dir[0];
  const dy = dir[1];
  const dz = dir[2];
  const b = ox * dx + oy * dy + oz * dz;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t0 = -b - s;
  const t1 = -b + s;
  if (t0 > 0.01) return t0;
  if (t1 > 0.01) return t1;
  return null;
}

// Pure helper: pick nearest lattice target hit by any ray.
export function pickLattice(rays, targets, radius = 0.018) {
  let best = null;
  let bestT = Infinity;
  let bestRay = null;
  for (const ray of rays) {
    for (const t of targets) {
      const d = raySphereHit(ray.origin, ray.direction, t.pos, radius);
      if (d != null && d < bestT) {
        bestT = d;
        best = t;
        bestRay = ray;
      }
    }
  }
  return best ? { target: best, ray: bestRay, t: bestT } : null;
}
