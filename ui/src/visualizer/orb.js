// visualizer/orb.js — the JARVIS orb, ported from
// jincocodev/openclaw-jarvis-ui (ISC — see THIRD_PARTY_LICENSES at the repo
// root) src/core/scene.js `createAnomalyObject()`, which itself adapts Filip
// Zrnzevic's Three.js Orb Visualizer concept.
//
// Two meshes in one Group sharing a radius of 2:
//   1. wireframe IcosahedronGeometry whose vertices are displaced along
//      their normals by 3D simplex noise (classic Ashima Arts `snoise`,
//      inlined in the vertex shader) scaled by `distortion * (1 + drive)` —
//      `drive` is the real-input energy scalar (analyser audio / mic rms /
//      state envelope), upstream's `audioLevel`.
//   2. a BackSide, additively-blended SphereGeometry 1.2× the radius running
//      a steeper Fresnel — the "fake bloom" glow shell. No post-processing.
//
// Local additions over upstream: `scan` (transcribing band), `sweep`
// (capability radar lobe) and `bloom` (done flash) uniforms.
import { Group, Mesh, IcosahedronGeometry, SphereGeometry, ShaderMaterial, Color, AdditiveBlending, BackSide } from "three";

// Classic Ashima Arts / Ian McEwan 3D simplex noise (MIT-licensed shader
// snippet, as inlined by the upstream orb).
var SNOISE = `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }
`;

export var ORB_RADIUS = 2;

export function createOrb() {
  var group = new Group();

  var wireGeo = new IcosahedronGeometry(ORB_RADIUS, 4);
  var wireMat = new ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      color: { value: new Color(0x22d3ee) },
      drive: { value: 0 },
      distortion: { value: 0.6 },
      scan: { value: 0 },
      scanY: { value: 0 },
      sweep: { value: 0 },
      sweepAngle: { value: 0 },
    },
    vertexShader: `
      uniform float time;
      uniform float drive;
      uniform float distortion;
      varying vec3 vNormal;
      varying vec3 vPosition;
      varying vec3 vLocal;
      ${SNOISE}
      void main() {
        vNormal = normalize(normalMatrix * normal);
        float slowTime = time * 0.3;
        vec3 pos = position;
        float noise = snoise(vec3(position.x * 0.5, position.y * 0.5, position.z * 0.5 + slowTime));
        pos += normal * noise * 0.2 * distortion * (1.0 + drive);
        vLocal = position;
        vPosition = pos;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform vec3 color;
      uniform float drive;
      uniform float scan;
      uniform float scanY;
      uniform float sweep;
      uniform float sweepAngle;
      varying vec3 vNormal;
      varying vec3 vPosition;
      varying vec3 vLocal;
      void main() {
        vec3 viewDirection = normalize(cameraPosition - vPosition);
        float fresnel = 1.0 - max(0.0, dot(viewDirection, vNormal));
        fresnel = pow(fresnel, 2.0 + drive * 2.0);
        float pulse = 0.8 + 0.2 * sin(time * 2.0);
        // the wireframe stays the most luminous element at every drive
        // level: it heats toward white-gold as drive rises instead of being
        // silhouetted against the glow shell
        vec3 hot = mix(color, vec3(1.0, 0.96, 0.82), clamp(drive * 0.55, 0.0, 0.75));
        float glow = fresnel * pulse * (1.0 + drive * 1.4);
        float alpha = fresnel * clamp(0.7 - drive * 0.2, 0.3, 0.7);
        // transcribing: bright band sweeping down the wireframe
        if (scan > 0.001) {
          float band = 1.0 - smoothstep(0.0, 0.45, abs(vLocal.y - scanY));
          glow += band * scan * 1.6;
          alpha += band * scan * 0.35;
        }
        // capability: radar lobe rotating around the equator
        if (sweep > 0.001) {
          float ang = atan(vLocal.z, vLocal.x);
          float d = abs(mod(ang - sweepAngle + 3.14159265, 6.2831853) - 3.14159265);
          float lobe = 1.0 - smoothstep(0.0, 0.9, d);
          glow += lobe * sweep * 1.4;
          alpha += lobe * sweep * 0.3;
        }
        gl_FragColor = vec4(hot * glow, clamp(alpha, 0.0, 1.0));
      }
    `,
    wireframe: true,
    transparent: true,
    // no depth write: with it on, the wire's depth kills the (additive,
    // depth-tested) glow shell behind it, punching dark wire-shaped holes
    // into the halo at high drive.
    depthWrite: false,
  });
  var wire = new Mesh(wireGeo, wireMat);
  wire.renderOrder = 2; // draw after the glow shell, deterministically
  group.add(wire);

  // Glow shell — the fake-bloom trick: backside additive Fresnel, no
  // post-processing pass.
  var glowGeo = new SphereGeometry(ORB_RADIUS * 1.2, 32, 32);
  var glowMat = new ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      color: { value: new Color(0x22d3ee) },
      drive: { value: 0 },
      bloom: { value: 0 },
      glowBase: { value: 1 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vPosition;
      uniform float drive;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vPosition = position * (1.0 + drive * 0.2);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(vPosition, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      varying vec3 vPosition;
      uniform vec3 color;
      uniform float time;
      uniform float drive;
      uniform float bloom;
      uniform float glowBase;
      void main() {
        vec3 viewDirection = normalize(cameraPosition - vPosition);
        // d: 0 at the shell's outer silhouette, ->1 toward its center
        // (backside sphere: normals face away from the camera)
        float d = clamp(-dot(viewDirection, vNormal), 0.0, 1.0);
        // Rim-concentrated halo (reference: upstream desktop-red.png): zero
        // at the outer edge, peak just inside it, fast falloff toward the
        // interior — the disc center stays transparent at ANY drive level.
        // Drive widens/brightens the RIM only (falloff exponent eases a
        // little), it never floods the interior.
        float ring = smoothstep(0.0, 0.14, d) * pow(1.0 - d, 3.4 - min(drive, 1.2) * 0.8);
        float pulse = 0.8 + 0.2 * sin(time * 2.0);
        float energy = 1.0 + drive * 1.6 + bloom * 3.0;
        vec3 finalColor = color * ring * pulse * energy;
        // hard cap on the shell's effective opacity
        float alpha = min(0.55, ring * (0.55 + drive * 0.5 + bloom * 0.7));
        gl_FragColor = vec4(finalColor, alpha * glowBase);
      }
    `,
    transparent: true,
    side: BackSide,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  var glow = new Mesh(glowGeo, glowMat);
  glow.renderOrder = 1;
  group.add(glow);

  // tSec: scene clock; dt: frame delta (s); drive: real-input energy 0..~1.5;
  // style: blended STATE_STYLES entry; bloom: one-shot done flash 0..1.
  function update(tSec, dt, drive, style, bloom) {
    wireMat.uniforms.time.value = tSec;
    wireMat.uniforms.drive.value = drive;
    wireMat.uniforms.distortion.value = style.distortion;
    wireMat.uniforms.color.value.copy(style.color);
    wireMat.uniforms.scan.value = style.scan;
    // scan band sweeps top -> bottom on a ~2.2s loop
    wireMat.uniforms.scanY.value = 2.3 - ((tSec * 2.1) % 4.6);
    wireMat.uniforms.sweep.value = style.sweep;
    wireMat.uniforms.sweepAngle.value = tSec * 2.2;

    glowMat.uniforms.time.value = tSec;
    // clamp only — the rim profile + alpha cap in the shader make the shell
    // safe at worst-case drive (loud speech widens/brightens the rim, the
    // interior stays transparent)
    glowMat.uniforms.drive.value = Math.min(1.4, drive);
    glowMat.uniforms.bloom.value = bloom;
    glowMat.uniforms.glowBase.value = style.glow;
    glowMat.uniforms.color.value.copy(style.color);

    group.rotation.y += dt * style.rot * 0.35 * (1 + drive * 1.2);
    group.rotation.z += dt * style.rot * 0.14 * (1 + drive * 1.2);
    var s = style.orbScale * (1 + drive * 0.02);
    group.scale.set(s, s, s);
  }

  function dispose() {
    wireGeo.dispose();
    wireMat.dispose();
    glowGeo.dispose();
    glowMat.dispose();
  }

  return { group: group, update: update, dispose: dispose };
}
