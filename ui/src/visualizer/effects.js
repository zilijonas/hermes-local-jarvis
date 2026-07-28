// visualizer/effects.js — state-specific overlay effects around the orb
// (newly written for this port; not part of the upstream orb):
//   createRipples      — listening: expanding rings whose brightness comes
//                        from the real mic rms (silent mic = faint rings).
//   createProgressArc  — worker_progress: indeterminate orbital arc (SPEC's
//                        task.update has no numeric fraction, so the arc is
//                        indeterminate by design — still purely FSM-driven).
//   createSatellites   — delegating: the orb "fissions" small tethered
//                        satellites that deploy outward and orbit.
// All overlay intensities arrive already lerped (0..1) from the state
// blender, so everything here fades smoothly on state changes.
import {
  Group,
  Mesh,
  RingGeometry,
  SphereGeometry,
  MeshBasicMaterial,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  BufferGeometry,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  AdditiveBlending,
  DoubleSide,
  Color,
} from "three";

export function makeGlowTexture() {
  var c = document.createElement("canvas");
  c.width = c.height = 64;
  var g = c.getContext("2d");
  var grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

// ---------------------------------------------------------------- ripples
export function createRipples() {
  var POOL = 4;
  var LIFE = 1.5; // seconds
  var group = new Group();
  var ripples = [];
  var spawnTimer = 0;

  for (var i = 0; i < POOL; i++) {
    var geo = new RingGeometry(0.96, 1.0, 96);
    var mat = new MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    var mesh = new Mesh(geo, mat);
    mesh.visible = false;
    group.add(mesh);
    ripples.push({ mesh: mesh, mat: mat, geo: geo, age: 0, strength: 0, active: false });
  }

  // gain: blended style.ripple (0..1); micLevel: real mic rms.
  function update(dt, gain, micLevel, color) {
    spawnTimer -= dt;
    if (gain > 0.05 && spawnTimer <= 0) {
      spawnTimer = 0.55;
      for (var i = 0; i < POOL; i++) {
        if (!ripples[i].active) {
          ripples[i].active = true;
          ripples[i].age = 0;
          // baseline expansion ring (state-driven) boosted by real mic input
          ripples[i].strength = (0.12 + Math.min(1, micLevel) * 0.9) * gain;
          break;
        }
      }
    }
    for (var k = 0; k < POOL; k++) {
      var r = ripples[k];
      if (!r.active) {
        r.mesh.visible = false;
        continue;
      }
      r.age += dt;
      var f = r.age / LIFE;
      if (f >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      var ease = 1 - (1 - f) * (1 - f); // ease-out expansion
      r.mesh.visible = true;
      r.mesh.scale.setScalar(2.15 + ease * 2.6);
      r.mat.opacity = r.strength * Math.pow(1 - f, 1.6) * 0.55;
      r.mat.color.copy(color);
    }
  }

  function dispose() {
    for (var i = 0; i < POOL; i++) {
      ripples[i].geo.dispose();
      ripples[i].mat.dispose();
    }
  }

  return { group: group, update: update, dispose: dispose };
}

// ----------------------------------------------------------- progress arc
export function createProgressArc() {
  var group = new Group();

  var trackGeo = new RingGeometry(2.56, 2.6, 128);
  var trackMat = new MeshBasicMaterial({
    color: 0xf59e0b,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  var track = new Mesh(trackGeo, trackMat);
  group.add(track);

  var arcGeo = new RingGeometry(2.52, 2.68, 128);
  var arcMat = new ShaderMaterial({
    uniforms: {
      color: { value: new Color(0xf59e0b) },
      opacity: { value: 0 },
      arcStart: { value: 0 },
      arcLen: { value: Math.PI * 0.6 },
    },
    vertexShader: `
      varying vec2 vPos;
      void main() {
        vPos = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 color;
      uniform float opacity;
      uniform float arcStart;
      uniform float arcLen;
      varying vec2 vPos;
      void main() {
        float ang = atan(vPos.y, vPos.x);
        float rel = mod(ang - arcStart, 6.2831853);
        float a = step(rel, arcLen) * smoothstep(0.0, 0.2, rel) * (1.0 - smoothstep(arcLen - 0.2, arcLen, rel));
        gl_FragColor = vec4(color, a * opacity);
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  var arc = new Mesh(arcGeo, arcMat);
  group.add(arc);

  function update(tSec, gain, color) {
    group.visible = gain > 0.005;
    if (!group.visible) return;
    trackMat.opacity = 0.1 * gain;
    trackMat.color.copy(color);
    arcMat.uniforms.opacity.value = 0.9 * gain;
    arcMat.uniforms.color.value.copy(color);
    // indeterminate: arc orbits and breathes (SPEC has no progress fraction)
    arcMat.uniforms.arcStart.value = -tSec * 1.7;
    arcMat.uniforms.arcLen.value = Math.PI * 0.55 + Math.sin(tSec * 0.8) * Math.PI * 0.15;
  }

  function dispose() {
    trackGeo.dispose();
    trackMat.dispose();
    arcGeo.dispose();
    arcMat.dispose();
  }

  return { group: group, update: update, dispose: dispose };
}

// ------------------------------------------------------------- satellites
export function createSatellites(glowTexture) {
  var COUNT = 3;
  var group = new Group();
  var sats = [];

  for (var i = 0; i < COUNT; i++) {
    var holder = new Group();
    var coreGeo = new SphereGeometry(0.13, 12, 12);
    var coreMat = new MeshBasicMaterial({
      color: 0xa78bfa,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    var core = new Mesh(coreGeo, coreMat);
    holder.add(core);

    var spriteMat = new SpriteMaterial({
      map: glowTexture,
      color: 0xa78bfa,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    var glow = new Sprite(spriteMat);
    glow.scale.setScalar(0.85);
    holder.add(glow);

    // tether line back to the orb
    var lineGeo = new BufferGeometry();
    lineGeo.setAttribute("position", new Float32BufferAttribute(new Float32Array(6), 3));
    var lineMat = new LineBasicMaterial({
      color: 0xa78bfa,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    var line = new Line(lineGeo, lineMat);
    group.add(line);
    group.add(holder);
    sats.push({ holder: holder, coreMat: coreMat, coreGeo: coreGeo, spriteMat: spriteMat, line: line, lineGeo: lineGeo, lineMat: lineMat, base: (i * Math.PI * 2) / COUNT });
  }

  function easeOutCubic(x) {
    return 1 - Math.pow(1 - x, 3);
  }

  // deploy: blended style.satellites 0..1 — 0 packs everything back into the
  // orb, 1 is fully deployed orbit.
  function update(tSec, deploy, color) {
    group.visible = deploy > 0.005;
    if (!group.visible) return;
    var r = easeOutCubic(deploy) * 3.0;
    for (var i = 0; i < sats.length; i++) {
      var s = sats[i];
      var ang = s.base + tSec * 1.1 * (1 + i * 0.13);
      var x = Math.cos(ang) * r;
      var y = Math.sin(tSec * 0.8 + i * 2.1) * 0.45 * deploy;
      var z = Math.sin(ang) * r * 0.35;
      s.holder.position.set(x, y, z);
      s.holder.scale.setScalar(0.5 + 0.5 * deploy);
      s.coreMat.opacity = deploy;
      s.coreMat.color.copy(color);
      s.spriteMat.opacity = 0.7 * deploy;
      s.spriteMat.color.copy(color);
      var lp = s.lineGeo.attributes.position;
      // tether starts just outside the orb surface, in the satellite's direction
      var len = Math.max(0.0001, Math.sqrt(x * x + y * y + z * z));
      lp.setXYZ(0, (x / len) * 2.05, (y / len) * 2.05, (z / len) * 2.05);
      lp.setXYZ(1, x, y, z);
      lp.needsUpdate = true;
      s.lineMat.opacity = 0.3 * deploy;
      s.lineMat.color.copy(color);
    }
  }

  function dispose() {
    for (var i = 0; i < sats.length; i++) {
      var s = sats[i];
      s.coreGeo.dispose();
      s.coreMat.dispose();
      s.spriteMat.dispose();
      s.lineGeo.dispose();
      s.lineMat.dispose();
    }
  }

  return { group: group, update: update, dispose: dispose };
}
