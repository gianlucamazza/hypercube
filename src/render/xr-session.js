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

// Controller polling and gesture FSM live in xr-input.js.
