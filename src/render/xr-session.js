// WebXR session lifecycle. Progressive enhancement only: callers check
// isImmersiveVrSupported() before offering Enter VR. No dependencies —
// navigator.xr + XRWebGLLayer, the same APIs Quest Browser and desktop
// Chrome expose for immersive-vr.

export async function isImmersiveVrSupported() {
  if (!navigator.xr || typeof navigator.xr.isSessionSupported !== "function")
    return false;
  try {
    return await navigator.xr.isSessionSupported("immersive-vr");
  } catch {
    return false;
  }
}

// Open an immersive-vr session bound to a WebGL context. Returns the live
// session, a reference space, and whether that space is floor-relative.
export async function enterImmersiveVr(gl) {
  if (!navigator.xr) throw new Error("WebXR unavailable");
  // xrCompatible must be set before the session requests the GL layer.
  if (gl.makeXRCompatible) await gl.makeXRCompatible();

  const session = await navigator.xr.requestSession("immersive-vr", {
    optionalFeatures: ["local-floor"],
  });

  const layer = new XRWebGLLayer(session, gl, {
    antialias: true,
    alpha: false,
  });
  await session.updateRenderState({ baseLayer: layer });

  // local-floor: origin on the floor, Y up. local: origin at head at session
  // start — placement must not lift the object another metre above the eyes.
  let refSpace;
  let floorRelative = true;
  try {
    refSpace = await session.requestReferenceSpace("local-floor");
  } catch {
    refSpace = await session.requestReferenceSpace("local");
    floorRelative = false;
  }

  return { session, refSpace, layer, floorRelative };
}

// Poll xr-standard gamepads. Stick values are the strongest deflection
// across controllers (not a sum — dual grips would otherwise double dolly).
// Button edges (just-pressed) fire once per press.
export function pollXrInput(session, prevButtons = new Map()) {
  const input = {
    stickX: 0,
    stickY: 0,
    pressed: { pause: false, exit: false },
    buttons: new Map(),
  };

  for (const source of session.inputSources) {
    const gp = source.gamepad;
    if (!gp) continue;

    // xr-standard: axes[2], axes[3] are the primary thumbstick when present;
    // fall back to axes[0], axes[1] for simpler gamepads / emulators.
    if (gp.axes && gp.axes.length >= 2) {
      const ax = gp.axes.length >= 4 ? 2 : 0;
      const ay = gp.axes.length >= 4 ? 3 : 1;
      const x = deadzone(gp.axes[ax] || 0);
      const y = deadzone(gp.axes[ay] || 0);
      if (Math.abs(x) > Math.abs(input.stickX)) input.stickX = x;
      if (Math.abs(y) > Math.abs(input.stickY)) input.stickY = y;
    }

    // buttons[0] trigger, [1] squeeze, [4] A/X, [5] B/Y — when present.
    // Prefer handedness; fall back to a stable targetRayMode key.
    const id = source.handedness || source.targetRayMode || "unknown";
    const prev = prevButtons.get(id) || [];
    const next = (gp.buttons || []).map((b) => !!(b && b.pressed));
    input.buttons.set(id, next);

    // A/X (index 4) → pause; B/Y (index 5) → exit. Squeeze (1) as pause
    // fallback for gamepads without face buttons (some emulators).
    if (edge(next, prev, 4) || edge(next, prev, 1)) input.pressed.pause = true;
    if (edge(next, prev, 5)) input.pressed.exit = true;
  }

  return input;
}

function deadzone(v, z = 0.12) {
  return Math.abs(v) < z ? 0 : v;
}

function edge(next, prev, i) {
  return !!(next[i] && !prev[i]);
}
