// Stereoscopic WebGL presentation of the intermediate 3-space projection.
// Thick camera-facing edge quads, Schlegel face veils, comet head, diegetic
// B_n lattice, enter ease, and void fog — zero dependencies.

import { hypercube } from "../core/hypercube.js";
import { mulMatVec } from "../core/matrix.js";
import { projectGroups } from "../core/projection.js";
import {
  edgeColor,
  edgeHalfWidth,
  faceColor,
  accentRgba,
  AMBER_RGB,
  ICE_RGB,
} from "./palette.js";
import { XR_DEFAULTS } from "./xr-config.js";
import { cometPath } from "./comet.js";
import { meanWarmth } from "./warmth.js";

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

const FLOATS_PER_VERT = 7;
const STRIDE = FLOATS_PER_VERT * 4;

export function defaultWorldOffset(floorRelative, cfg = XR_DEFAULTS) {
  return {
    x: 0,
    y: floorRelative ? cfg.floorY : cfg.headY,
    z: cfg.worldZ,
  };
}

// Place object ahead of the viewer at cfg.viewDistance, chest-ish height.
export function worldOffsetFromHead(headMatrix, floorRelative, cfg = XR_DEFAULTS) {
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
  const dist = cfg.viewDistance;
  const y = floorRelative ? cfg.floorY : hy + cfg.headY;
  return {
    x: hx + nx * dist,
    y,
    z: hz + nz * dist,
  };
}

export function createXrRenderer(initialConfig = XR_DEFAULTS) {
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
  let fitKey = null;
  let sessionStart = null;
  let cubeCache = null;
  let cubeN = -1;
  let cometNow = 0;
  let cometStamp = null;
  let cfg = { ...XR_DEFAULTS, ...initialConfig };

  function setConfig(next) {
    cfg = { ...XR_DEFAULTS, ...next };
  }

  function beginSession(now = performance.now()) {
    sessionStart = now;
    fitScale = null;
  }

  function draw(state, xrFrame, refSpace, time, opts = {}) {
    const {
      floorRelative = true,
      worldOffset = defaultWorldOffset(floorRelative, cfg),
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
    const sectionView = state.view === "section";

    const orient = (vertices) => {
      if (!vertices || vertices.length === 0) return [];
      return vertices.map((v) => {
        const w = mirrorScale ? v.slice() : v;
        if (mirrorScale) w[mirrorScale.axis] *= mirrorScale.s;
        return mulMatVec(Q, w);
      });
    };

    if (sectionView && cubeN !== state.n) {
      cubeCache = hypercube(state.n);
      cubeN = state.n;
    }
    const groups = [];
    if (sectionView) groups.push(orient(cubeCache.vertices));
    groups.push(orient(geometry.vertices));
    const projected = projectGroups(groups, { mode, stopAt: 3 });
    const ghost = sectionView ? projected[0] : null;
    const main = projected[projected.length - 1];
    const points = main ? main.points : [];
    const extraDepths = main ? main.extraDepths : null;

    if (cometStamp == null) cometStamp = time;
    if (!state.paused) cometNow += Math.max(0, time - cometStamp);
    cometStamp = time;

    let maxR = 0;
    const consider = (pts) => {
      if (!pts) return;
      for (const p of pts) {
        const r = Math.hypot(p[0], p[1], p[2] ?? 0);
        if (r > maxR) maxR = r;
      }
    };
    consider(ghost && ghost.points);
    consider(points);
    const targetRadius = cfg.targetRadius;
    const target = maxR > 1e-9 ? targetRadius / maxR : (fitScale ?? 1);
    // Same key as the canvas: the sweeping cut must not snap the fit.
    const nextKey = `${state.n}:${state.view}:${mode}`;
    if (fitScale == null || fitKey !== nextKey) {
      fitScale = target;
      fitKey = nextKey;
    } else {
      fitScale += (target - fitScale) * 0.06;
    }
    let scale = fitScale / Math.max(0.5, dolly);

    // Enter ease: scale + alpha.
    let appear = 1;
    if (enterAlpha && sessionStart != null && !reducedMotion) {
      const enterMs = Math.max(0, cfg.enterMs);
      const t =
        enterMs <= 0
          ? 1
          : Math.min(1, (performance.now() - sessionStart) / enterMs);
      appear = t * t * (3 - 2 * t);
      scale *= 0.15 + 0.85 * appear;
    }

    const nPts = points.length;
    if (!depthScratch || depthScratch.length !== nPts)
      depthScratch = new Float32Array(nPts);
    normalizeInto(points, 2, depthScratch);
    const warm = meanWarmth(extraDepths);
    if (warm) {
      if (!warmScratch || warmScratch.length !== nPts)
        warmScratch = new Float32Array(nPts);
      for (let i = 0; i < nPts; i++) warmScratch[i] = warm[i];
    }

    const cometN = state.gray && state.view === "solid" ? geometry.n : 0;
    const faces = sectionView
      ? geometry.faces || []
      : mode === "schlegel" && state.view !== "net" && geometry.faces
        ? geometry.faces
        : [];
    const ghostEdges = ghost ? cubeCache.edges : null;
    const apex =
      sectionView && points.length === 1 && geometry.edges.length === 0;

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
      ghostEdges ? ghostEdges.length : 0,
      apex,
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
      warm ? warmScratch : null,
      scale,
      cometN,
      cometNow,
      camX / Math.max(scale, 1e-9),
      camY / Math.max(scale, 1e-9),
      camZ / Math.max(scale, 1e-9),
      [camX, camY, camZ],
      lattice,
      latticeOpacity,
      hoverKey,
      rays,
      cfg,
      ghost ? ghost.points : null,
      ghostEdges,
      apex,
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

  return { gl, canvas, draw, beginSession, setConfig, defaultWorldOffset };
}

function estimateFloats(
  edgeCount,
  faces,
  cometN,
  latticeCount,
  rayCount,
  ghostEdges = 0,
  apex = false,
) {
  let tris = (edgeCount + ghostEdges) * 2; // 2 tris per edge
  if (apex) tris += 2;
  for (const f of faces) {
    if (f.length >= 3) tris += f.length - 2;
  }
  if (cometN > 0) {
    const len = 1 << cometN;
    tris += (len + Math.min(10, len - 1)) * 2; // cycle + trail as thick edges
    tris += 4; // comet head (two quads: core + glow)
  }
  // lattice: disc fan (8) or square (2); rays: 1 thick segment
  tris += latticeCount * 8;
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
  camM,
  lattice,
  latticeOpacity,
  hoverKey,
  rays,
  cfg = XR_DEFAULTS,
  ghostPoints = null,
  ghostEdges = null,
  apex = false,
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
  // Farther from the headset first. Object-z matches that only while the
  // viewer stays on the +z side; walking around must not use it.
  // camX/Y/Z are in projection units, the same space as `points`.
  const camDist2 = (p) => {
    const dx = p[0] - camX;
    const dy = p[1] - camY;
    const dz = (p[2] ?? 0) - camZ;
    return dx * dx + dy * dy + dz * dz;
  };
  const [camMX, camMY, camMZ] = camM;

  // The cube under the knife, first, so the slice paints over it.
  // Fixed ice, low alpha, thinner than the section's own edges.
  if (ghostPoints && ghostEdges && ghostEdges.length) {
    const hw = (cfg.edgeHalfWidthMin * 0.45) / Math.max(scale, 1e-9);
    for (let i = 0; i < ghostEdges.length; i++) {
      const [ia, ib] = ghostEdges[i];
      const pa = ghostPoints[ia];
      const pb = ghostPoints[ib];
      o = emitQuad(
        floats,
        o,
        scale,
        pa[0],
        pa[1],
        pa[2] ?? 0,
        pb[0],
        pb[1],
        pb[2] ?? 0,
        hw,
        camX,
        camY,
        camZ,
        ICE_RGB[0],
        ICE_RGB[1],
        ICE_RGB[2],
        0.14,
      );
    }
  }

  if (apex && points.length === 1) {
    const p = points[0];
    const [r, g, b] = accentRgba(1);
    o = emitBillboard(
      floats,
      o,
      scale,
      p[0],
      p[1],
      p[2] ?? 0,
      0.006 / Math.max(scale, 1e-9),
      camX,
      camY,
      camZ,
      r,
      g,
      b,
      0.95,
    );
  }

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
      for (const v of fa) da += camDist2(points[v]);
      for (const v of fb) db += camDist2(points[v]);
      return db / fb.length - da / fa.length;
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
    const ma = [
      (points[ea[0]][0] + points[ea[1]][0]) * 0.5,
      (points[ea[0]][1] + points[ea[1]][1]) * 0.5,
      (points[ea[0]][2] + points[ea[1]][2]) * 0.5,
    ];
    const mb = [
      (points[eb[0]][0] + points[eb[1]][0]) * 0.5,
      (points[eb[0]][1] + points[eb[1]][1]) * 0.5,
      (points[eb[0]][2] + points[eb[1]][2]) * 0.5,
    ];
    return camDist2(mb) - camDist2(ma);
  });

  for (let i = 0; i < edgeCount; i++) {
    const [ia, ib] = edges[edgeOrder[i]];
    const d = (depthT[ia] + depthT[ib]) / 2;
    const w = warmT != null ? (warmT[ia] + warmT[ib]) / 2 : null;
    const [r, g, b, a] = edgeColor(d, w);
    const hw =
      edgeHalfWidth(d, cfg.edgeHalfWidthMin, cfg.edgeHalfWidthMax) /
      Math.max(scale, 1e-9); // in projection units
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
    const path = cometPath(cometN, time);
    const { cycle, len } = path;
    const [ar, ag, ab] = accentRgba(1);
    const hw = 0.0012 / Math.max(scale, 1e-9);
    const seg = (ia, ib, t0, t1) => {
      const pa = points[ia];
      const pb = points[ib];
      return [
        pa[0] + (pb[0] - pa[0]) * t0,
        pa[1] + (pb[1] - pa[1]) * t0,
        pa[2] + (pb[2] - pa[2]) * t0,
        pa[0] + (pb[0] - pa[0]) * t1,
        pa[1] + (pb[1] - pa[1]) * t1,
        pa[2] + (pb[2] - pa[2]) * t1,
      ];
    };
    for (let k = 0; k < len; k++) {
      const [ax, ay, az, bx, by, bz] = seg(cycle[k], cycle[(k + 1) % len], 0, 1);
      o = emitQuad(floats, o, scale, ax, ay, az, bx, by, bz, hw, camX, camY, camZ, ar, ag, ab, 0.08);
    }
    for (const piece of path.segments) {
      const [ax, ay, az, bx, by, bz] = seg(piece.from, piece.to, piece.t0, piece.t1);
      o = emitQuad(
        floats, o, scale, ax, ay, az, bx, by, bz, hw * 1.2,
        camX, camY, camZ, ar, ag, ab, piece.fade * 0.55,
      );
    }
    const a = points[path.from];
    const b = points[path.to];
    const hx = a[0] + (b[0] - a[0]) * path.frac;
    const hy = a[1] + (b[1] - a[1]) * path.frac;
    const hz = a[2] + (b[2] - a[2]) * path.frac;
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
      const hitR = cfg.latticeHitR;
      const s = hover ? hitR * 1.25 : hitR * 0.85;
      // Both markers face the headset. Planes read as discs, mirrors as squares.
      if (t.kind === "mirror") {
        o = emitBillboard(floats, o, 1, x, y, z, s, camMX, camMY, camMZ, r, g, b, a);
      } else {
        o = emitDisc(floats, o, x, y, z, s, camMX, camMY, camMZ, r, g, b, a);
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
    const len = ray.length ?? 3.2;
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
      camMX,
      camMY,
      camMZ,
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

// Orthonormal frame of the plane facing the camera. right × up points at it.
function cameraBasis(px, py, pz, camX, camY, camZ) {
  let zx = camX - px;
  let zy = camY - py;
  let zz = camZ - pz;
  let zl = Math.hypot(zx, zy, zz) || 1;
  zx /= zl;
  zy /= zl;
  zz /= zl;
  // right ≈ world up × forward
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
  const ux = zy * rz - zz * ry;
  const uy = zz * rx - zx * rz;
  const uz = zx * ry - zy * rx;
  return { rx, ry, rz, ux, uy, uz };
}

function writeVert(floats, o, x, y, z, r, g, b, a) {
  floats[o++] = x;
  floats[o++] = y;
  floats[o++] = z;
  floats[o++] = r;
  floats[o++] = g;
  floats[o++] = b;
  floats[o++] = a;
  return o;
}

function emitBillboard(floats, o, scale, x, y, z, half, camX, camY, camZ, r, g, b, a) {
  // Camera-facing square. `scale` converts projection units; pass 1 when
  // x/y/z and the camera are already in metres (lattice mirrors).
  const px = x * scale;
  const py = y * scale;
  const pz = z * scale;
  const h = half * scale;
  const { rx, ry, rz, ux, uy, uz } = cameraBasis(
    px,
    py,
    pz,
    camX * scale,
    camY * scale,
    camZ * scale,
  );
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
  o = writeVert(floats, o, c00x, c00y, c00z, r, g, b, a);
  o = writeVert(floats, o, c10x, c10y, c10z, r, g, b, a);
  o = writeVert(floats, o, c11x, c11y, c11z, r, g, b, a);
  o = writeVert(floats, o, c00x, c00y, c00z, r, g, b, a);
  o = writeVert(floats, o, c11x, c11y, c11z, r, g, b, a);
  o = writeVert(floats, o, c01x, c01y, c01z, r, g, b, a);
  return o;
}

// Eight-triangle fan in the camera plane. Positions are already metres.
function emitDisc(floats, o, x, y, z, radius, camX, camY, camZ, r, g, b, a) {
  const { rx, ry, rz, ux, uy, uz } = cameraBasis(x, y, z, camX, camY, camZ);
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    o = writeVert(floats, o, x, y, z, r, g, b, a);
    o = writeVert(
      floats,
      o,
      x + (rx * c0 + ux * s0) * radius,
      y + (ry * c0 + uy * s0) * radius,
      z + (rz * c0 + uz * s0) * radius,
      r,
      g,
      b,
      a,
    );
    o = writeVert(
      floats,
      o,
      x + (rx * c1 + ux * s1) * radius,
      y + (ry * c1 + uy * s1) * radius,
      z + (rz * c1 + uz * s1) * radius,
      r,
      g,
      b,
      a,
    );
  }
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
