// Stereoscopic WebGL presentation of the intermediate 3-space projection.
// Thick camera-facing edge quads, Schlegel face veils, comet head, diegetic
// B_n lattice, enter ease, and void fog — zero dependencies.

import { mulMatVec } from "../core/matrix.js";
import { project } from "../core/projection.js";
import { grayCode } from "../core/combinatorics.js";
import {
  edgeColor,
  edgeHalfWidth,
  faceColor,
  accentRgba,
  AMBER_RGB,
  ICE_RGB,
} from "./palette.js";
import { LATTICE_HIT_R } from "./xr-ui.js";

const VS = `
attribute vec3 aPos;
attribute vec4 aColor;
uniform mat4 uMVP;
uniform float uAlpha;
varying vec4 vColor;
void main() {
  gl_Position = uMVP * vec4(aPos, 1.0);
  vColor = vec4(aColor.rgb, aColor.a * uAlpha);
}
`;

const FS = `
precision mediump float;
varying vec4 vColor;
void main() {
  // Soft distance fog anchors the void without a floor grid.
  float fog = clamp(1.0 - (gl_FragCoord.z / gl_FragCoord.w) * 0.08, 0.55, 1.0);
  gl_FragColor = vec4(vColor.rgb * fog, vColor.a);
}
`;

const COMET_SPEED = 1;
const COMET_TRAIL = 10;
const FLOOR_Y = 1.25;
const HEAD_Y = -0.15;
const WORLD_Z = -1.8;
const TARGET_RADIUS = 0.42;
const FLOATS_PER_VERT = 7;
const STRIDE = FLOATS_PER_VERT * 4;
const ENTER_MS = 800;
// 6 verts per edge quad (2 tris), 3 per face tri (fan expanded later).
const VERTS_PER_EDGE = 6;

const grayCache = new Map();
function grayCycle(n) {
  let c = grayCache.get(n);
  if (!c) {
    c = grayCode(n);
    grayCache.set(n, c);
  }
  return c;
}

export function defaultWorldOffset(floorRelative) {
  return {
    x: 0,
    y: floorRelative ? FLOOR_Y : HEAD_Y,
    z: WORLD_Z,
  };
}

// Place object ~1.8 m ahead of the viewer, chest-ish height.
export function worldOffsetFromHead(headMatrix, floorRelative) {
  // headMatrix column-major; position at 12,13,14; forward -Z = -m[8..10]
  const fx = -headMatrix[8];
  const fy = -headMatrix[9];
  const fz = -headMatrix[10];
  const len = Math.hypot(fx, fy, fz) || 1;
  const nx = fx / len;
  const ny = fy / len;
  const nz = fz / len;
  const hx = headMatrix[12];
  const hy = headMatrix[13];
  const hz = headMatrix[14];
  const dist = 1.8;
  const y = floorRelative ? FLOOR_Y : hy + HEAD_Y;
  return {
    x: hx + nx * dist,
    y,
    z: hz + nz * dist,
  };
}

export function createXrRenderer() {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const gl = canvas.getContext("webgl", {
    xrCompatible: true,
    antialias: true,
    alpha: false,
    depth: true,
  });
  if (!gl) throw new Error("WebGL unavailable");

  const program = link(gl, VS, FS);
  const aPos = gl.getAttribLocation(program, "aPos");
  const aColor = gl.getAttribLocation(program, "aColor");
  const uMVP = gl.getUniformLocation(program, "uMVP");
  const uAlpha = gl.getUniformLocation(program, "uAlpha");

  const buf = gl.createBuffer();
  let scratch = new Float32Array(0);
  let edgeOrder = [];
  let faceOrder = [];
  let depthScratch = null;
  let warmScratch = null;

  let fitScale = null;
  let fitGeometry = null;
  let fitMode = null;
  let sessionStart = null;

  function beginSession(now = performance.now()) {
    sessionStart = now;
    fitScale = null;
  }

  function draw(state, xrFrame, refSpace, time, opts = {}) {
    const {
      floorRelative = true,
      worldOffset = defaultWorldOffset(floorRelative),
      lattice = [],
      latticeOpacity = 0,
      rays = [],
      hoverKey = null,
      reducedMotion = false,
      enterAlpha = true,
    } = opts;

    const session = xrFrame.session;
    const layer = session.renderState.baseLayer;
    if (!layer) return null;

    const pose = xrFrame.getViewerPose(refSpace);
    if (!pose) return null;

    const { geometry, Q, projection: mode, dolly, mirrorScale } = state;

    let source = geometry.vertices;
    if (mirrorScale) {
      const { axis, s } = mirrorScale;
      source = source.map((v) => {
        const w = v.slice();
        w[axis] *= s;
        return w;
      });
    }

    const rotated = source.map((v) => mulMatVec(Q, v));
    const { points, depthW } = project(rotated, { mode, stopAt: 3 });

    let maxR = 0;
    for (const p of points) {
      const r = Math.hypot(p[0], p[1], p[2]);
      if (r > maxR) maxR = r;
    }
    const target = maxR > 1e-9 ? TARGET_RADIUS / maxR : (fitScale ?? 1);
    if (fitScale == null || fitGeometry !== geometry || fitMode !== mode) {
      fitScale = target;
      fitGeometry = geometry;
      fitMode = mode;
    } else {
      fitScale += (target - fitScale) * 0.06;
    }
    let scale = fitScale / Math.max(0.5, dolly);

    // Enter ease: scale + alpha.
    let appear = 1;
    if (enterAlpha && sessionStart != null && !reducedMotion) {
      const t = Math.min(1, (performance.now() - sessionStart) / ENTER_MS);
      appear = t * t * (3 - 2 * t);
      scale *= 0.15 + 0.85 * appear;
    }

    const nPts = points.length;
    if (!depthScratch || depthScratch.length !== nPts)
      depthScratch = new Float32Array(nPts);
    normalizeInto(points, 2, depthScratch);
    if (depthW) {
      if (!warmScratch || warmScratch.length !== nPts)
        warmScratch = new Float32Array(nPts);
      normalizeArrInto(depthW, warmScratch);
    }

    const cometN = state.gray && state.view !== "net" ? geometry.n : 0;
    const faces =
      mode === "schlegel" && state.view !== "net" && geometry.faces
        ? geometry.faces
        : [];

    // Camera position in world (viewer) for billboard extrusion — use first view.
    const view0 = pose.views[0];
    const inv0 = view0.transform.matrix; // camera to world
    const camX = inv0[12] - worldOffset.x;
    const camY = inv0[13] - worldOffset.y;
    const camZ = inv0[14] - worldOffset.z;

    const needed = estimateFloats(
      geometry.edges.length,
      faces,
      cometN,
      lattice.length,
      rays.length,
    );
    if (scratch.length < needed) scratch = new Float32Array(needed);

    const vertexCount = fillMesh(
      scratch,
      edgeOrder,
      faceOrder,
      points,
      geometry.edges,
      faces,
      depthScratch,
      depthW ? warmScratch : null,
      scale,
      cometN,
      time,
      camX / Math.max(scale, 1e-9),
      camY / Math.max(scale, 1e-9),
      camZ / Math.max(scale, 1e-9),
      lattice,
      latticeOpacity,
      hoverKey,
      rays,
    );

    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    gl.clearColor(0.02, 0.02, 0.027, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(program);
    gl.uniform1f(uAlpha, appear);

    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      scratch.subarray(0, vertexCount * FLOATS_PER_VERT),
      gl.DYNAMIC_DRAW,
    );
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, STRIDE, 0);
    gl.enableVertexAttribArray(aColor);
    gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, STRIDE, 12);

    const world = translationMatrix(worldOffset.x, worldOffset.y, worldOffset.z);

    for (const view of pose.views) {
      const vp = layer.getViewport(view);
      gl.viewport(vp.x, vp.y, vp.width, vp.height);
      const mvp = mul4(
        view.projectionMatrix,
        mul4(view.transform.inverse.matrix, world),
      );
      gl.uniformMatrix4fv(uMVP, false, mvp);
      gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
    }

    gl.depthMask(true);

    // Object origin in world for lattice layout.
    return {
      objectOrigin: [worldOffset.x, worldOffset.y, worldOffset.z],
      appear,
    };
  }

  return { gl, canvas, draw, beginSession, defaultWorldOffset };
}

function estimateFloats(edgeCount, faces, cometN, latticeCount, rayCount) {
  let tris = edgeCount * 2; // 2 tris per edge
  for (const f of faces) {
    if (f.length >= 3) tris += f.length - 2;
  }
  if (cometN > 0) {
    const len = 1 << cometN;
    tris += (len + Math.min(COMET_TRAIL, len - 1)) * 2; // trail as thick edges
    tris += 4; // comet head (two quads: core + glow)
  }
  // lattice: each target ~ 2 tris (quad); rays: 1 thick segment
  tris += latticeCount * 2;
  tris += rayCount * 2;
  return tris * 3 * FLOATS_PER_VERT;
}

function fillMesh(
  floats,
  edgeOrder,
  faceOrder,
  points,
  edges,
  faces,
  depthT,
  warmT,
  scale,
  cometN,
  time,
  camX,
  camY,
  camZ,
  lattice,
  latticeOpacity,
  hoverKey,
  rays,
) {
  const edgeCount = edges.length;
  let o = 0;
  const push = (x, y, z, r, g, b, a) => {
    floats[o++] = x * scale;
    floats[o++] = y * scale;
    floats[o++] = z * scale;
    floats[o++] = r;
    floats[o++] = g;
    floats[o++] = b;
    floats[o++] = a;
  };
  // Unscaled push for world-space UI (lattice already in metres relative… wait
  // lattice is in world metres absolute — we draw in object-local then world
  // matrix translates. So lattice positions must be relative to object origin.
  // Host builds lattice with objectOrigin absolute; we convert by subtracting
  // origin before draw. Simpler: host passes lattice already object-relative.
  const pushW = (x, y, z, r, g, b, a) => {
    floats[o++] = x;
    floats[o++] = y;
    floats[o++] = z;
    floats[o++] = r;
    floats[o++] = g;
    floats[o++] = b;
    floats[o++] = a;
  };

  // --- Faces (painter far→near) ------------------------------------------
  if (faces.length > 0) {
    if (faceOrder.length !== faces.length) {
      faceOrder.length = faces.length;
      for (let i = 0; i < faces.length; i++) faceOrder[i] = i;
    }
    faceOrder.sort((ia, ib) => {
      const fa = faces[ia];
      const fb = faces[ib];
      let da = 0;
      let db = 0;
      for (const v of fa) da += depthT[v];
      for (const v of fb) db += depthT[v];
      return da / fa.length - db / fb.length;
    });
    for (let fi = 0; fi < faces.length; fi++) {
      const face = faces[faceOrder[fi]];
      if (face.length < 3) continue;
      let d = 0;
      let wsum = 0;
      for (const v of face) {
        d += depthT[v];
        if (warmT) wsum += warmT[v];
      }
      d /= face.length;
      const w = warmT ? wsum / face.length : null;
      const [r, g, b, a] = faceColor(d, w);
      const p0 = points[face[0]];
      for (let k = 1; k < face.length - 1; k++) {
        const p1 = points[face[k]];
        const p2 = points[face[k + 1]];
        push(p0[0], p0[1], p0[2], r, g, b, a);
        push(p1[0], p1[1], p1[2], r, g, b, a);
        push(p2[0], p2[1], p2[2], r, g, b, a);
      }
    }
  }

  // --- Edges as camera-facing quads --------------------------------------
  if (edgeOrder.length !== edgeCount) {
    edgeOrder.length = edgeCount;
    for (let i = 0; i < edgeCount; i++) edgeOrder[i] = i;
  }
  edgeOrder.sort((ia, ib) => {
    const ea = edges[ia];
    const eb = edges[ib];
    const da = (depthT[ea[0]] + depthT[ea[1]]) / 2;
    const db = (depthT[eb[0]] + depthT[eb[1]]) / 2;
    return da - db;
  });

  for (let i = 0; i < edgeCount; i++) {
    const [ia, ib] = edges[edgeOrder[i]];
    const d = (depthT[ia] + depthT[ib]) / 2;
    const w = warmT != null ? (warmT[ia] + warmT[ib]) / 2 : null;
    const [r, g, b, a] = edgeColor(d, w);
    const hw = edgeHalfWidth(d) / Math.max(scale, 1e-9); // in projection units
    const pa = points[ia];
    const pb = points[ib];
    o = emitQuad(
      floats,
      o,
      scale,
      pa[0],
      pa[1],
      pa[2],
      pb[0],
      pb[1],
      pb[2],
      hw,
      camX,
      camY,
      camZ,
      r,
      g,
      b,
      a,
    );
  }

  // --- Comet --------------------------------------------------------------
  if (cometN > 0) {
    const cycle = grayCycle(cometN);
    const len = cycle.length;
    const [ar, ag, ab] = accentRgba(1);
    const hw = 0.0012 / Math.max(scale, 1e-9);
    for (let k = 0; k < len; k++) {
      const pa = points[cycle[k]];
      const pb = points[cycle[(k + 1) % len]];
      o = emitQuad(
        floats,
        o,
        scale,
        pa[0],
        pa[1],
        pa[2],
        pb[0],
        pb[1],
        pb[2],
        hw,
        camX,
        camY,
        camZ,
        ar,
        ag,
        ab,
        0.08,
      );
    }
    const pos = (time * COMET_SPEED) % len;
    const head = Math.floor(pos);
    const frac = pos - head;
    const wrap = (i) => ((i % len) + len) % len;
    const trail = Math.min(COMET_TRAIL, len - 1);
    for (let k = 0; k < trail; k++) {
      const pa = points[cycle[wrap(head - k)]];
      const pb = points[cycle[wrap(head - k + 1)]];
      const fade = (1 - k / trail) * 0.55;
      o = emitQuad(
        floats,
        o,
        scale,
        pa[0],
        pa[1],
        pa[2],
        pb[0],
        pb[1],
        pb[2],
        hw * 1.2,
        camX,
        camY,
        camZ,
        ar,
        ag,
        ab,
        fade,
      );
    }
    // Head + glow billboards at interpolated position.
    const a = points[cycle[head % len]];
    const b = points[cycle[(head + 1) % len]];
    const hx = a[0] + (b[0] - a[0]) * frac;
    const hy = a[1] + (b[1] - a[1]) * frac;
    const hz = a[2] + (b[2] - a[2]) * frac;
    o = emitBillboard(floats, o, scale, hx, hy, hz, 0.012 / scale, camX, camY, camZ, ar, ag, ab, 0.35);
    o = emitBillboard(floats, o, scale, hx, hy, hz, 0.005 / scale, camX, camY, camZ, ar, ag, ab, 0.95);
  }

  // --- Lattice UI (object-relative metres; already scaled world) ----------
  if (latticeOpacity > 0.01 && lattice.length > 0) {
    for (const t of lattice) {
      // Host stores pos relative to object origin in metres.
      const [x, y, z] = t.pos;
      const hover =
        (t.kind === "plane" && hoverKey === t.key) ||
        (t.kind === "mirror" && hoverKey === `m${t.axis}`);
      const active = t.active;
      let r = ICE_RGB[0];
      let g = ICE_RGB[1];
      let b = ICE_RGB[2];
      let a = 0.35 * latticeOpacity;
      if (active || hover) {
        r = AMBER_RGB[0];
        g = AMBER_RGB[1];
        b = AMBER_RGB[2];
        a = (hover ? 0.95 : 0.75) * latticeOpacity;
      }
      const s = hover ? LATTICE_HIT_R * 1.25 : LATTICE_HIT_R * 0.85;
      if (t.kind === "mirror") {
        o = emitSquare(floats, o, x, y, z, s, r, g, b, a, pushW);
      } else {
        o = emitBillboard(floats, o, 1, x, y, z, s, 0, 0, 1, r, g, b, a, pushW);
      }
    }
  }

  // --- Controller rays (object-relative) ----------------------------------
  for (const ray of rays) {
    if (!ray.origin || !ray.direction) continue;
    // Ray is in world; convert assuming object at worldOffset is handled by
    // host passing object-relative ray segments.
    const [ox, oy, oz] = ray.origin;
    const [dx, dy, dz] = ray.direction;
    const len = ray.length ?? 0.8;
    o = emitQuadRaw(
      floats,
      o,
      ox,
      oy,
      oz,
      ox + dx * len,
      oy + dy * len,
      oz + dz * len,
      0.001,
      0,
      1,
      0,
      ICE_RGB[0],
      ICE_RGB[1],
      ICE_RGB[2],
      0.2 * Math.max(latticeOpacity, 0.25),
    );
  }

  return o / FLOATS_PER_VERT;
}

// Emit a camera-facing quad for segment a→b into floats at offset o.
// Coordinates in projection units; scale applied like push().
function emitQuad(floats, o, scale, ax, ay, az, bx, by, bz, hw, camX, camY, camZ, r, g, b, a) {
  return emitQuadRaw(
    floats,
    o,
    ax * scale,
    ay * scale,
    az * scale,
    bx * scale,
    by * scale,
    bz * scale,
    hw * scale,
    camX * scale,
    camY * scale,
    camZ * scale,
    r,
    g,
    b,
    a,
  );
}

function emitQuadRaw(floats, o, ax, ay, az, bx, by, bz, hw, camX, camY, camZ, r, g, b, a) {
  let dx = bx - ax;
  let dy = by - ay;
  let dz = bz - az;
  const mx = (ax + bx) * 0.5;
  const my = (ay + by) * 0.5;
  const mz = (az + bz) * 0.5;
  let vx = camX - mx;
  let vy = camY - my;
  let vz = camZ - mz;
  // side = d × view
  let sx = dy * vz - dz * vy;
  let sy = dz * vx - dx * vz;
  let sz = dx * vy - dy * vx;
  let sl = Math.hypot(sx, sy, sz);
  if (sl < 1e-9) {
    sx = -dy;
    sy = dx;
    sz = 0;
    sl = Math.hypot(sx, sy, sz) || 1;
  }
  const inv = hw / sl;
  sx *= inv;
  sy *= inv;
  sz *= inv;

  // tri1: a-s, a+s, b+s  tri2: a-s, b+s, b-s
  const write = (x, y, z) => {
    floats[o++] = x;
    floats[o++] = y;
    floats[o++] = z;
    floats[o++] = r;
    floats[o++] = g;
    floats[o++] = b;
    floats[o++] = a;
  };
  write(ax - sx, ay - sy, az - sz);
  write(ax + sx, ay + sy, az + sz);
  write(bx + sx, by + sy, bz + sz);
  write(ax - sx, ay - sy, az - sz);
  write(bx + sx, by + sy, bz + sz);
  write(bx - sx, by - sy, bz - sz);
  return o;
}

function emitBillboard(floats, o, scale, x, y, z, half, camX, camY, camZ, r, g, b, a, pushFn) {
  // Camera-facing quad in projection units (or world if pushFn given).
  const usePush = pushFn != null;
  const px = usePush ? x : x * scale;
  const py = usePush ? y : y * scale;
  const pz = usePush ? z : z * scale;
  const h = usePush ? half : half * scale;
  // Build orthonormal basis facing camera.
  let zx = (usePush ? 0 : camX * scale) - px;
  let zy = (usePush ? 0 : camY * scale) - py;
  let zz = (usePush ? 1 : camZ * scale) - pz;
  if (usePush) {
    zx = 0;
    zy = 0;
    zz = 1; // face +Z in object frame for lattice
  }
  let zl = Math.hypot(zx, zy, zz) || 1;
  zx /= zl;
  zy /= zl;
  zz /= zl;
  // right ≈ worldUp × z
  let rx = -zz;
  let ry = 0;
  let rz = zx;
  let rl = Math.hypot(rx, ry, rz);
  if (rl < 1e-9) {
    rx = 1;
    ry = 0;
    rz = 0;
    rl = 1;
  }
  rx /= rl;
  ry /= rl;
  rz /= rl;
  // up = z × right
  let ux = zy * rz - zz * ry;
  let uy = zz * rx - zx * rz;
  let uz = zx * ry - zy * rx;
  const write = (ox, oy, oz) => {
    if (usePush) {
      pushFn(ox, oy, oz, r, g, b, a);
      // pushFn writes 7 floats via closure... actually pushW increments o externally.
      // We need different approach — write directly.
    }
    floats[o++] = ox;
    floats[o++] = oy;
    floats[o++] = oz;
    floats[o++] = r;
    floats[o++] = g;
    floats[o++] = b;
    floats[o++] = a;
  };
  // When usePush, o is still managed here; pushFn unused for write path.
  void pushFn;
  const c00x = px - rx * h - ux * h;
  const c00y = py - ry * h - uy * h;
  const c00z = pz - rz * h - uz * h;
  const c10x = px + rx * h - ux * h;
  const c10y = py + ry * h - uy * h;
  const c10z = pz + rz * h - uz * h;
  const c11x = px + rx * h + ux * h;
  const c11y = py + ry * h + uy * h;
  const c11z = pz + rz * h + uz * h;
  const c01x = px - rx * h + ux * h;
  const c01y = py - ry * h + uy * h;
  const c01z = pz - rz * h + uz * h;
  write(c00x, c00y, c00z);
  write(c10x, c10y, c10z);
  write(c11x, c11y, c11z);
  write(c00x, c00y, c00z);
  write(c11x, c11y, c11z);
  write(c01x, c01y, c01z);
  return o;
}

function emitSquare(floats, o, x, y, z, half, r, g, b, a, _pushW) {
  // Axis-aligned square in XY (mirror markers).
  const write = (px, py, pz) => {
    floats[o++] = px;
    floats[o++] = py;
    floats[o++] = pz;
    floats[o++] = r;
    floats[o++] = g;
    floats[o++] = b;
    floats[o++] = a;
  };
  write(x - half, y - half, z);
  write(x + half, y - half, z);
  write(x + half, y + half, z);
  write(x - half, y - half, z);
  write(x + half, y + half, z);
  write(x - half, y + half, z);
  return o;
}

function normalizeInto(points, axis, out) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const v = points[i][axis];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  if (!(range > 1e-9)) {
    out.fill(0.7);
    return;
  }
  for (let i = 0; i < points.length; i++) {
    const v = points[i][axis];
    out[i] = Number.isFinite(v) ? (v - min) / range : 0.7;
  }
}

function normalizeArrInto(values, out) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  if (!(range > 1e-9)) {
    out.fill(0.7);
    return;
  }
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    out[i] = Number.isFinite(v) ? (v - min) / range : 0.7;
  }
}

function link(gl, vsSrc, fsSrc) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(prog) || "program link failed");
  return prog;
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(sh) || "shader compile failed");
  return sh;
}

function translationMatrix(x, y, z) {
  const m = new Float32Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

function mul4(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}
