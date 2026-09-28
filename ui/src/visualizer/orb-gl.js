// visualizer/orb-gl.js — WebGL renderer for the luminous orb.
//
// One full-canvas triangle, one fragment shader, no textures, no
// framebuffers, no per-frame allocation. The shader draws:
//   - a body whose edge is displaced by three angular noise octaves (the
//     speaking bands drive their amplitudes, so the outline "talks"),
//   - a fluid interior: spherical-mapped, vortex-rotated, domain-warped
//     simplex noise mixed through deep -> main -> soft, with a cool second
//     hue swirling through it,
//   - inner light, a fresnel rim, a faint specular, and a two-falloff halo
//     that fades out before the canvas edge (no clipped glow),
//   - up to six memory motes (soft light, no lines) spiralling inward.
// Pixels past the halo exit early, so cost scales with the orb, not the
// canvas. Precision: highp where the GPU offers it (all iOS devices do);
// phases are integrated on the CPU so speed changes never jump.

var VERT = "attribute vec2 aPos;\nvoid main(){ gl_Position = vec4(aPos, 0.0, 1.0); }\n";

var FRAG = [
  "#ifdef GL_FRAGMENT_PRECISION_HIGH",
  "precision highp float;",
  "#else",
  "precision mediump float;",
  "#endif",
  "uniform vec2 uCenter;",
  "uniform float uR;",
  "uniform float uMaxD;",
  "uniform float uPx;",
  "uniform float uFlow;",
  "uniform float uSpin;",
  "uniform float uSwirl;",
  "uniform float uDeform;",
  "uniform vec4 uBands;",
  "uniform float uGlow;",
  "uniform float uBright;",
  "uniform float uSat;",
  "uniform float uLight;",
  "uniform vec3 uMain;",
  "uniform vec3 uSoft;",
  "uniform vec3 uDeep;",
  "uniform vec3 uCool;",
  "uniform vec3 uMotes[6];",
  // Ashima / Ian McEwan 2D simplex noise (MIT)
  "vec3 perm(vec3 x){ return mod(((x*34.0)+1.0)*x, 289.0); }",
  "float snoise(vec2 v){",
  "  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);",
  "  vec2 i = floor(v + dot(v, C.yy));",
  "  vec2 x0 = v - i + dot(i, C.xx);",
  "  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);",
  "  vec4 x12 = x0.xyxy + C.xxzz;",
  "  x12.xy -= i1;",
  "  i = mod(i, 289.0);",
  "  vec3 p = perm(perm(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));",
  "  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);",
  "  m = m*m; m = m*m;",
  "  vec3 x = 2.0 * fract(p * C.www) - 1.0;",
  "  vec3 h = abs(x) - 0.5;",
  "  vec3 ox = floor(x + 0.5);",
  "  vec3 a0 = x - ox;",
  "  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);",
  "  vec3 g;",
  "  g.x = a0.x * x0.x + h.x * x0.y;",
  "  g.yz = a0.yz * x12.xz + h.yz * x12.yw;",
  "  return 130.0 * dot(m, g);",
  "}",
  "void main(){",
  "  vec2 p = (gl_FragCoord.xy - uCenter) / uR;",
  "  float d = length(p);",
  "  if (d > uMaxD) { gl_FragColor = vec4(0.0); return; }",
  "  vec2 dir = p / max(d, 1e-4);",
  // edge: three angular octaves; speech bands scale them
  "  float n1 = snoise(dir * 0.9 + vec2(uFlow * 0.35, -uFlow * 0.21));",
  "  float n2 = snoise(dir * 1.7 + vec2(-uFlow * 0.55, uFlow * 0.40) + 7.1);",
  "  float n3 = snoise(dir * 2.9 + vec2(uFlow * 1.10, uFlow * 0.80) + 3.7);",
  "  float e = 1.0 + uDeform * (n1 * 0.7 + n2 * 0.3)",
  "            + uBands.x * 0.075 * n1 + uBands.y * 0.045 * n2 + uBands.z * 0.022 * n3 + uBands.w * 0.045;",
  "  float aa = uPx * 1.25;",
  "  float inside = 1.0 - smoothstep(e - aa, e + aa, d);",
  "  vec3 body = vec3(0.0);",
  "  if (inside > 0.0) {",
  "    vec2 q = p / e;",
  "    float r2 = min(dot(q, q), 1.0);",
  "    float z = sqrt(1.0 - r2);",
  "    vec2 s = q / (0.68 + z * 0.32);",                        // curvature: flow compresses at the rim
  "    float ang = uSpin + uSwirl * (1.0 - r2) * 1.9;",         // vortex, stronger toward the core
  "    float ca = cos(ang); float sa = sin(ang);",
  "    vec2 u = mat2(ca, sa, -sa, ca) * s * 0.64;",
  "    vec2 w = vec2(snoise(u * 0.8 + vec2(uFlow * 0.22, 0.0)), snoise(u * 0.8 + vec2(5.2, -uFlow * 0.2)));",
  "    u += w * (0.22 + uSwirl * 0.34);",
  "    float f = snoise(u * 1.0 - vec2(0.0, uFlow * 0.3)) * 0.5 + 0.5;",
  "    float g = snoise(u * 1.5 + w * 0.6 + vec2(uFlow * 0.4, 1.3)) * 0.5 + 0.5;",
  // two emissive ribbons (main + cool) over a shaded deep volume; where they
  // cross they run white-hot
  "    float e1 = smoothstep(0.18, 1.0, f); e1 *= 0.35 + 0.65 * e1;",
  "    float e2 = smoothstep(0.3, 1.0, g) * 0.85;",
  "    float key = clamp(0.5 + 0.55 * dot(q, vec2(-0.34, 0.94)), 0.0, 1.0);",
  "    body = uDeep * (0.55 + 0.75 * key) + uMain * uLight * 0.25;",
  "    body += uMain * e1 * (0.9 + 0.35 * z) * uBright;",
  "    body += uCool * e2 * 0.8 * uBright;",
  "    body += uSoft * smoothstep(0.35, 0.9, e1 * e2) * 0.55 * uBright;",
  "    body += uSoft * exp(-r2 * 3.2) * (0.1 + uBands.w * 0.45) * uBright;",      // lit from within; speech brightens it
"    float fr = pow(1.0 - z, 2.8);",
  "    float rimHue = 0.5 + 0.5 * dot(dir, vec2(cos(uSpin * 0.7), sin(uSpin * 0.7)));",
  "    vec3 rimCol = mix(uSoft, mix(uMain, uCool, rimHue), 0.4);",
  "    body = mix(body, rimCol, fr * (0.72 + uBands.w * 0.2));",
  "    body += uMain * smoothstep(0.55, 1.0, sqrt(r2)) * 0.18 * uBright;",
  "    vec3 nrm = vec3(q, z);",
  "    float spec = pow(max(dot(nrm, vec3(-0.38, 0.5, 0.78)), 0.0), 18.0);",
  "    body += uSoft * spec * (0.14 + 0.1 * uLight) * uBright;",
  "    body *= 0.42 + 0.58 * uBright;",
    "  }",
  // memory motes: soft light only
  "  float mote = 0.0;",
  "  for (int i = 0; i < 6; i++) {",
  "    vec3 m = uMotes[i];",
  "    if (m.z > 0.001) {",
  "      vec2 dm = p - m.xy;",
  "      float dd = dot(dm, dm);",
  "      mote += m.z * (exp(-dd * 260.0) + exp(-dd * 28.0) * 0.28);",
  "    }",
  "  }",
  "  body += uSoft * mote * inside;",
  // halo: tight bloom + wide atmosphere, faded before the canvas edge
  "  float od = max(d - e, 0.0);",
  "  float halo = (exp(-od * 4.2) * 0.6 + exp(-od * 1.35) * 0.26) * uGlow;",
  "  halo *= 1.0 - smoothstep(mix(1.05, uMaxD, 0.3), uMaxD, d);",
  "  halo = min(halo * mix(1.0, 0.55, uLight) + mote * (1.0 - inside) * 0.9, 1.0);",
  "  vec3 haloCol = mix(uMain, uCool, 0.3);",
  "  haloCol = mix(haloCol, uSoft, clamp(mote, 0.0, 1.0) * 0.6);",
  "  float lum = dot(body, vec3(0.299, 0.587, 0.114));",
  "  body = mix(vec3(lum), body, uSat);",
  "  float hl = dot(haloCol, vec3(0.299, 0.587, 0.114));",
  "  haloCol = mix(vec3(hl), haloCol, uSat);",
  "  float aBody = inside * mix(0.97, 0.94 * mix(0.45, 1.0, smoothstep(0.3, 0.75, uBright)), uLight);",
  "  float aHalo = halo * (1.0 - inside);",
  "  float a = aBody + aHalo;",
  "  vec3 c = min(body, vec3(1.0)) * aBody + haloCol * aHalo;",
  "  gl_FragColor = vec4(min(c, vec3(a)), a);",
  "}",
].join("\n");

var UNIFORMS = [
  "uCenter", "uR", "uMaxD", "uPx", "uFlow", "uSpin", "uSwirl", "uDeform", "uBands",
  "uGlow", "uBright", "uSat", "uLight", "uMain", "uSoft", "uDeep", "uCool", "uMotes",
];

function compile(gl, type, src) {
  var sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    var log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error("orb shader: " + log);
  }
  return sh;
}

// Returns null when WebGL is unavailable (caller falls back to Canvas 2D).
export function createGLRenderer(canvas) {
  var gl = null;
  try {
    var opts = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: "low-power" };
    gl = canvas.getContext("webgl", opts) || canvas.getContext("experimental-webgl", opts);
  } catch (e) {
    gl = null;
  }
  if (!gl) return null;

  var prog = null;
  var buf = null;
  var loc = {};
  var lost = false;

  function init() {
    var vs = compile(gl, gl.VERTEX_SHADER, VERT);
    var fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error("orb program: " + gl.getProgramInfoLog(prog));
    }
    gl.useProgram(prog);
    buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    for (var i = 0; i < UNIFORMS.length; i++) loc[UNIFORMS[i]] = gl.getUniformLocation(prog, UNIFORMS[i]);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
  }

  try {
    init();
  } catch (e) {
    return null;
  }

  function onLost(e) {
    e.preventDefault();
    lost = true;
  }
  function onRestored() {
    lost = false;
    loc = {};
    try {
      init();
    } catch (e) {
      lost = true;
    }
  }
  canvas.addEventListener("webglcontextlost", onLost, false);
  canvas.addEventListener("webglcontextrestored", onRestored, false);

  function v3(name, c) {
    gl.uniform3f(loc[name], c[0], c[1], c[2]);
  }

  return {
    kind: "webgl",
    render: function (u) {
      if (lost || !prog) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      // canvas y-down -> GL y-up
      gl.uniform2f(loc.uCenter, u.cx, canvas.height - u.cy);
      gl.uniform1f(loc.uR, u.R);
      gl.uniform1f(loc.uMaxD, u.maxD);
      gl.uniform1f(loc.uPx, 1 / u.R);
      gl.uniform1f(loc.uFlow, u.flow);
      gl.uniform1f(loc.uSpin, u.spin);
      gl.uniform1f(loc.uSwirl, u.swirl);
      gl.uniform1f(loc.uDeform, u.deform);
      gl.uniform4f(loc.uBands, u.bands[0], u.bands[1], u.bands[2], u.bands[3]);
      gl.uniform1f(loc.uGlow, u.glow);
      gl.uniform1f(loc.uBright, u.bright);
      gl.uniform1f(loc.uSat, u.sat);
      gl.uniform1f(loc.uLight, u.light ? 1 : 0);
      v3("uMain", u.main);
      v3("uSoft", u.soft);
      v3("uDeep", u.deep);
      v3("uCool", u.cool);
      gl.uniform3fv(loc.uMotes, u.motes);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    destroy: function () {
      canvas.removeEventListener("webglcontextlost", onLost, false);
      canvas.removeEventListener("webglcontextrestored", onRestored, false);
      if (!gl.isContextLost()) {
        if (buf) gl.deleteBuffer(buf);
        if (prog) gl.deleteProgram(prog);
      }
      buf = prog = null;
    },
  };
}
