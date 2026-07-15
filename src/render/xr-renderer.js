// Stereoscopic WebGL wireframe of the intermediate 3-space projection.
// Draws the same rotate → project(stopAt:3) cloud the Canvas path would
// collapse further to 2D — depth presence and w-temperature via palette.
// Edges are painter-sorted (far→near) with depth writes off so translucent
// lines composite like the Canvas 2D path.

import { mulMatVec } from "../core/matrix.js";
import { project } from "../core/projection.js";
import { grayCode } from "../core/combinatorics.js";
import { edgeColor, ACCENT } from "./palette.js";

const VS = `
attribute vec3 aPos;
attribute vec4 aColor;
uniform mat4 uMVP;
varying vec4 vColor;
void main() {
  gl_Position = uMVP * vec4(aPos, 1.0);
  vColor = aColor;
}
`;

const FS = `
precision mediump float;
varying vec4 vColor;
void main() {
  gl_FragColor = vColor;
}
`;

const COMET_SPEED = 1;
const COMET_TRAIL = 10;
// local-floor: origin on the floor → chest height + 1.8 m ahead.
// local: origin at the head at session start → slightly below gaze, same depth.
const FLOOR_Y = 1.25;
const HEAD_Y = -0.15;
const WORLD_Z = -1.8;
const TARGET_RADIUS = 0.42; // metres — comfortable viewing size
const FLOATS_PER_VERT = 7;
const STRIDE = FLOATS_PER_VERT * 4;

// Gray cycles depend only on n; cache across frames.
const grayCache = new Map();
function grayCycle(n) {
  let c = grayCache.get(n);
  if (!c) {
    c = grayCode(n);
    grayCache.set(n, c);
  }
  return c;
}

export function createXrRenderer() {
  const canvas = document.createElement("canvas");
  // Offscreen to the page; XRWebGLLayer owns the immersive framebuffer.
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

  const buf = gl.createBuffer();
  // Reused grow-only scratch so we do not allocate a Float32Array every frame.
  let scratch = new Float32Array(0);
  // Reused index order for painter sort.
  let order = [];

  // World matrices for the two reference-space flavours (column-major).
  const worldFloor = translationMatrix(0, FLOOR_Y, WORLD_Z);
  const worldHead = translationMatrix(0, HEAD_Y, WORLD_Z);

  let fitScale = null;
  let fitGeometry = null;
  let fitMode = null;

  function draw(state, xrFrame, refSpace, time, floorRelative = true) {
    const session = xrFrame.session;
    const layer = session.renderState.baseLayer;
    if (!layer) return;

    const pose = xrFrame.getViewerPose(refSpace);
    if (!pose) return;

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
    // Dolly is applied as world scale below (no 3→2 stage here).
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
    // Larger dolly → smaller angular size (matches the 2D "flatten" feel).
    const scale = fitScale / Math.max(0.5, dolly);

    // Presence from residual z (what the 3→2 stage would consume).
    const depthT = normalize(points, 2);
    const warmT = depthW ? normalizeArr(depthW) : null;

    const cometN = state.gray && state.view !== "net" ? geometry.n : 0;
    const needed = estimateFloats(geometry.edges.length, cometN);
    if (scratch.length < needed) scratch = new Float32Array(needed);
    const vertexCount = fillLineBuffer(
      scratch,
      order,
      points,
      geometry.edges,
      depthT,
      warmT,
      scale,
      cometN,
      time,
    );

    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    gl.clearColor(0.02, 0.02, 0.027, 1); // --void #050507
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // Depth test without writes: near opaque segments still win tests if
    // something wrote earlier; with painter sort and no writes, pure blend.
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(program);

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

    const world = floorRelative ? worldFloor : worldHead;

    for (const view of pose.views) {
      const vp = layer.getViewport(view);
      gl.viewport(vp.x, vp.y, vp.width, vp.height);

      const mvp = mul4(
        view.projectionMatrix,
        mul4(view.transform.inverse.matrix, world),
      );
      gl.uniformMatrix4fv(uMVP, false, mvp);
      gl.drawArrays(gl.LINES, 0, vertexCount);
    }

    gl.depthMask(true);
  }

  return { gl, canvas, draw };
}

function estimateFloats(edgeCount, cometN) {
  let segments = edgeCount;
  if (cometN > 0) {
    const len = 1 << cometN; // |grayCode(n)| = 2^n
    segments += len + Math.min(COMET_TRAIL, len - 1);
  }
  return segments * 2 * FLOATS_PER_VERT;
}

// Build LINE pairs into `floats` (pre-sized). Edges are sorted far→near by
// residual z (painter's algorithm). Returns vertex count.
function fillLineBuffer(
  floats,
  order,
  points,
  edges,
  depthT,
  warmT,
  scale,
  cometN,
  time,
) {
  const edgeCount = edges.length;
  let cycle = null;
  let trail = 0;
  if (cometN > 0) {
    cycle = grayCycle(cometN);
    trail = Math.min(COMET_TRAIL, cycle.length - 1);
  }

  // Painter order: lower residual z first (farther in the cascade convention).
  if (order.length !== edgeCount) {
    order.length = edgeCount;
    for (let i = 0; i < edgeCount; i++) order[i] = i;
  }
  order.sort((ia, ib) => {
    const ea = edges[ia];
    const eb = edges[ib];
    const da = (depthT[ea[0]] + depthT[ea[1]]) / 2;
    const db = (depthT[eb[0]] + depthT[eb[1]]) / 2;
    return da - db;
  });

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

  for (let i = 0; i < edgeCount; i++) {
    const [a, b] = edges[order[i]];
    const d = (depthT[a] + depthT[b]) / 2;
    const w = warmT != null ? (warmT[a] + warmT[b]) / 2 : null;
    const [r, g, bl, al] = edgeColor(d, w);
    const pa = points[a];
    const pb = points[b];
    push(pa[0], pa[1], pa[2], r, g, bl, al);
    push(pb[0], pb[1], pb[2], r, g, bl, al);
  }

  if (cycle) {
    const len = cycle.length;
    const ar = ACCENT[0] / 255;
    const ag = ACCENT[1] / 255;
    const ab = ACCENT[2] / 255;
    for (let k = 0; k < len; k++) {
      const pa = points[cycle[k]];
      const pb = points[cycle[(k + 1) % len]];
      push(pa[0], pa[1], pa[2], ar, ag, ab, 0.08);
      push(pb[0], pb[1], pb[2], ar, ag, ab, 0.08);
    }
    const pos = (time * COMET_SPEED) % len;
    const head = Math.floor(pos);
    const wrap = (i) => ((i % len) + len) % len;
    for (let k = 0; k < trail; k++) {
      const pa = points[cycle[wrap(head - k)]];
      const pb = points[cycle[wrap(head - k + 1)]];
      const fade = (1 - k / trail) * 0.55;
      push(pa[0], pa[1], pa[2], ar, ag, ab, fade);
      push(pb[0], pb[1], pb[2], ar, ag, ab, fade);
    }
  }

  return o / FLOATS_PER_VERT;
}

// Normalize coordinate axis `axis` of each point into [0,1].
function normalize(points, axis) {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    const v = p[axis];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  if (!(range > 1e-9)) return points.map(() => 0.7);
  return points.map((p) =>
    Number.isFinite(p[axis]) ? (p[axis] - min) / range : 0.7,
  );
}

function normalizeArr(values) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  if (!(range > 1e-9)) return values.map(() => 0.7);
  return values.map((v) => (Number.isFinite(v) ? (v - min) / range : 0.7));
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

// Column-major 4×4 translation.
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

// a, b are column-major Float32Array(16); returns a * b.
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
