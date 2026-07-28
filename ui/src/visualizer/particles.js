// visualizer/particles.js — WebGL particle systems.
//
// createParticleField: the ambient background field, ported from
// jincocodev/openclaw-jarvis-ui (ISC — see THIRD_PARTY_LICENSES)
// src/core/scene.js `createBackgroundParticles()`: a THREE.Points cloud
// whose vertices drift via layered sin/cos of time+position, each point drawn
// as a soft additive radial glow disc. Local additions: a per-particle `seed`
// attribute + `burst` uniform (interrupted-state radial impulse) and a `tint`
// uniform so the field leans toward the active state color.
//
// createThinkingKnot: new for this port — a tight fast-orbit "electron cloud"
// around the orb that fades in only while the FSM is in `thinking`.
import { BufferGeometry, BufferAttribute, Points, ShaderMaterial, AdditiveBlending, Color } from "three";

var FIELD_PALETTE = [new Color(0x1c7f8f), new Color(0x4338ca), new Color(0x94a3b8)];

export function createParticleField(count) {
  var geo = new BufferGeometry();
  var positions = new Float32Array(count * 3);
  var colors = new Float32Array(count * 3);
  var sizes = new Float32Array(count);
  var seeds = new Float32Array(count);

  for (var i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 80;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 80;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 80;
    var c = FIELD_PALETTE[Math.floor(Math.random() * FIELD_PALETTE.length)];
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
    sizes[i] = 0.05 + Math.random() * 0.04;
    seeds[i] = Math.random();
  }
  geo.setAttribute("position", new BufferAttribute(positions, 3));
  geo.setAttribute("color", new BufferAttribute(colors, 3));
  geo.setAttribute("size", new BufferAttribute(sizes, 1));
  geo.setAttribute("seed", new BufferAttribute(seeds, 1));

  var mat = new ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      burst: { value: 0 },
      tint: { value: new Color(0x22d3ee) },
    },
    vertexShader: `
      attribute float size;
      attribute float seed;
      varying vec3 vColor;
      uniform float time;
      uniform float burst;
      void main() {
        vColor = color;
        vec3 pos = position;
        pos.x += sin(time * 0.1 + position.z * 0.2) * 0.05;
        pos.y += cos(time * 0.1 + position.x * 0.2) * 0.05;
        pos.z += sin(time * 0.1 + position.y * 0.2) * 0.05;
        // interrupted: one-shot radial impulse away from the orb, then the
        // decaying uniform lets everything spring back into place
        pos += normalize(pos + vec3(0.0001)) * burst * (1.5 + seed * 4.0);
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = size * (300.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      uniform vec3 tint;
      void main() {
        float r = distance(gl_PointCoord, vec2(0.5, 0.5));
        if (r > 0.5) discard;
        float glow = 1.0 - (r * 2.0);
        glow = pow(glow, 2.0);
        gl_FragColor = vec4(mix(vColor, tint, 0.35), glow);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexColors: true,
  });

  var points = new Points(geo, mat);
  points.frustumCulled = false;

  function update(tSec, burst, tintColor) {
    mat.uniforms.time.value = tSec;
    mat.uniforms.burst.value = burst;
    mat.uniforms.tint.value.copy(tintColor);
  }

  function dispose() {
    geo.dispose();
    mat.dispose();
  }

  return { points: points, update: update, dispose: dispose };
}

export function createThinkingKnot(count) {
  count = count || 320;
  var geo = new BufferGeometry();
  var positions = new Float32Array(count * 3);
  var seeds = new Float32Array(count);
  for (var i = 0; i < count; i++) {
    var r = 1.15 + Math.random() * 0.55;
    var ang = Math.random() * Math.PI * 2;
    positions[i * 3] = Math.cos(ang) * r;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 0.9;
    positions[i * 3 + 2] = Math.sin(ang) * r;
    seeds[i] = Math.random();
  }
  geo.setAttribute("position", new BufferAttribute(positions, 3));
  geo.setAttribute("seed", new BufferAttribute(seeds, 1));

  var mat = new ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      intensity: { value: 0 },
      color: { value: new Color(0x8b5cf6) },
    },
    vertexShader: `
      uniform float time;
      uniform float intensity;
      attribute float seed;
      void main() {
        float speed = 2.2 + seed * 2.8;
        float ang = time * speed * (0.4 + intensity) + seed * 6.2831853;
        float r = length(position.xz);
        vec3 pos = vec3(cos(ang) * r, position.y + sin(time * 3.0 + seed * 6.2831853) * 0.08, sin(ang) * r);
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = 0.07 * (300.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 color;
      uniform float intensity;
      void main() {
        float r = distance(gl_PointCoord, vec2(0.5, 0.5));
        if (r > 0.5) discard;
        float glow = pow(1.0 - r * 2.0, 2.0);
        gl_FragColor = vec4(color, glow * intensity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });

  var points = new Points(geo, mat);
  points.frustumCulled = false;

  function update(tSec, intensity, color) {
    points.visible = intensity > 0.005;
    if (!points.visible) return;
    mat.uniforms.time.value = tSec;
    mat.uniforms.intensity.value = intensity;
    mat.uniforms.color.value.copy(color);
  }

  function dispose() {
    geo.dispose();
    mat.dispose();
  }

  return { points: points, update: update, dispose: dispose };
}
