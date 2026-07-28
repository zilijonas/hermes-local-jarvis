// visualizer/constellation.js — Obsidian memory constellation (newly written
// for this port). On a real `memory.hits` event, spawns labeled node sprites
// (canvas-texture note titles) orbiting the orb, tethered by thin additive
// lines, scaled by retrieval score. Fades out gracefully after ~20s, or on
// the next FSM state change (with a minimum 3s on screen so a fast
// memory→thinking transition can't wipe the labels before they're readable).
import {
  Group,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  BufferGeometry,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  AdditiveBlending,
  LinearFilter,
  ClampToEdgeWrapping,
} from "three";

var MAX_NODES = 8;
var HOLD_SEC = 20; // auto fade-out after this long
var MIN_VISIBLE_SEC = 3; // state changes can't fade it out before this
var FADE_IN_SEC = 0.45;
var FADE_OUT_SEC = 0.8;

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function makeLabelTexture(text, score, cssColor) {
  var c = document.createElement("canvas");
  c.width = 512;
  c.height = 96;
  var g = c.getContext("2d");
  g.clearRect(0, 0, c.width, c.height);

  // node dot with glow
  g.save();
  g.shadowColor = cssColor;
  g.shadowBlur = 16;
  g.fillStyle = cssColor;
  g.beginPath();
  g.arc(40, 48, 9 + score * 5, 0, Math.PI * 2);
  g.fill();
  g.restore();

  // title text
  g.font = "500 30px system-ui, -apple-system, 'Segoe UI', sans-serif";
  g.textBaseline = "middle";
  g.fillStyle = "rgba(222,240,250,0.94)";
  g.shadowColor = "rgba(0,0,0,0.9)";
  g.shadowBlur = 6;
  g.fillText(text, 68, 46, 430);

  // score bar under the text
  g.shadowBlur = 0;
  g.fillStyle = cssColor;
  g.globalAlpha = 0.7;
  g.fillRect(68, 68, Math.max(24, 200 * score), 3);
  g.globalAlpha = 1;

  var tex = new CanvasTexture(c);
  tex.minFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  return tex;
}

function titleOf(item) {
  var t = item && (item.title || item.path) ? String(item.title || item.path) : "note";
  // fall back to the basename for path-only items
  if (!item.title && item.path) {
    var parts = t.split("/");
    t = parts[parts.length - 1].replace(/\.md$/i, "");
  }
  return t.length > 28 ? t.slice(0, 27) + "…" : t;
}

export function createConstellation() {
  var group = new Group();
  var nodes = [];
  var bornAt = -Infinity;
  var fadeOutAt = Infinity; // absolute tSec when fade-out starts

  // recompute a node's flattened-orbit position + its tether endpoints
  function placeNode(n) {
    var x = Math.cos(n.ang) * n.radius;
    var z = Math.sin(n.ang) * n.radius * 0.4;
    n.sprite.position.set(x, n.y, z);
    var len = Math.max(0.0001, Math.sqrt(x * x + n.y * n.y + z * z));
    var lp = n.line.geometry.attributes.position;
    lp.setXYZ(0, (x / len) * 2.05, (n.y / len) * 2.05, (z / len) * 2.05);
    lp.setXYZ(1, x, n.y, z);
    lp.needsUpdate = true;
  }

  function clear() {
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      group.remove(n.sprite);
      group.remove(n.line);
      n.sprite.material.map.dispose();
      n.sprite.material.dispose();
      n.line.geometry.dispose();
      n.line.material.dispose();
    }
    nodes = [];
  }

  // items: memory.hits payload [{path, title, score}]; color: current
  // blended state Color (used for dot/line tinting).
  function show(items, tSec, color) {
    clear();
    if (!items || !items.length) return;
    var cssColor = "#" + color.getHexString();
    var count = Math.min(MAX_NODES, items.length);
    for (var i = 0; i < count; i++) {
      var item = items[i] || {};
      var score = clamp01(typeof item.score === "number" ? item.score : 0.5);
      var tex = makeLabelTexture(titleOf(item), score, cssColor);
      var mat = new SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false });
      var sprite = new Sprite(mat);
      var hgt = 0.38 + score * 0.24;
      sprite.scale.set(hgt * (512 / 96), hgt, 1);

      // golden-angle spread; higher score orbits closer to the orb. The
      // orbit's z extent is flattened (×0.4, applied every frame in
      // update()) so nodes never swing up to the camera and balloon in
      // perspective.
      var ang = i * 2.399963 + Math.random() * 0.4;
      var radius = 3.1 + (1 - score) * 1.1;
      var y = ((i % 3) - 1) * 0.85 + (Math.random() - 0.5) * 0.4;

      var lineGeo = new BufferGeometry();
      lineGeo.setAttribute("position", new Float32BufferAttribute(new Float32Array(6), 3));
      var lineMat = new LineBasicMaterial({
        color: color.getHex(),
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      var line = new Line(lineGeo, lineMat);
      line.frustumCulled = false;

      group.add(line);
      group.add(sprite);
      var node = { sprite: sprite, line: line, score: score, ang: ang, radius: radius, y: y, phase: Math.random() * Math.PI * 2 };
      placeNode(node);
      nodes.push(node);
    }
    bornAt = tSec;
    fadeOutAt = tSec + HOLD_SEC;
    group.rotation.y = 0;
  }

  // Called by the orchestrator on every FSM state change.
  function onStateChange(tSec) {
    if (!nodes.length) return;
    var earliest = bornAt + MIN_VISIBLE_SEC;
    fadeOutAt = Math.min(fadeOutAt, Math.max(tSec, earliest));
  }

  function update(tSec, dt) {
    if (!nodes.length) {
      group.visible = false;
      return;
    }
    group.visible = true;

    var alpha;
    if (tSec >= fadeOutAt) {
      alpha = 1 - (tSec - fadeOutAt) / FADE_OUT_SEC;
      if (alpha <= 0) {
        clear();
        return;
      }
    } else {
      alpha = (tSec - bornAt) / FADE_IN_SEC;
    }
    alpha = clamp01(alpha);

    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      n.sprite.material.opacity = alpha * (0.55 + n.score * 0.45);
      n.line.material.opacity = alpha * (0.12 + n.score * 0.3);
      n.ang += dt * 0.12; // slow orbit around the orb
      n.y += Math.sin(tSec * 0.7 + n.phase) * dt * 0.06; // gentle bob
      placeNode(n);
    }
  }

  function dispose() {
    clear();
  }

  return { group: group, show: show, onStateChange: onStateChange, update: update, dispose: dispose };
}
