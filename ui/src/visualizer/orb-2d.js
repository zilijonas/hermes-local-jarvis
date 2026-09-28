// visualizer/orb-2d.js — Canvas 2D fallback for the orb (no WebGL).
//
// Same frame parameters as orb-gl.js, approximated with a handful of radial
// gradients: halo, a noise-wobbled body path, soft light blobs orbiting
// inside it ('lighter' compositing, clipped to the body), a rim and a faint
// specular. ~8 gradients per frame, no shadowBlur, no getImageData.

function rgba(c, a) {
  return "rgba(" + Math.round(c[0] * 255) + "," + Math.round(c[1] * 255) + "," + Math.round(c[2] * 255) + "," + a.toFixed(3) + ")";
}

function desat(c, s) {
  var l = c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
  return [l + (c[0] - l) * s, l + (c[1] - l) * s, l + (c[2] - l) * s];
}

var SEG = 72;

export function createCanvasRenderer(canvas) {
  var ctx = canvas.getContext("2d");
  if (!ctx) return null;
  var xs = new Float32Array(SEG);
  var ys = new Float32Array(SEG);

  function bodyPath(u) {
    var b = u.bands;
    for (var i = 0; i < SEG; i++) {
      var a = (i / SEG) * Math.PI * 2;
      var n1 = Math.sin(a * 2 + u.flow * 1.3) * 0.6 + Math.sin(a * 3 - u.flow * 0.9) * 0.4;
      var n2 = Math.sin(a * 5 + u.flow * 2.1);
      var n3 = Math.sin(a * 9 - u.flow * 3.3);
      var e = 1 + u.deform * n1 + b[0] * 0.08 * n1 + b[1] * 0.05 * n2 + b[2] * 0.035 * n3 + b[3] * 0.05;
      xs[i] = u.cx + Math.cos(a) * u.R * e;
      ys[i] = u.cy + Math.sin(a) * u.R * e;
    }
    ctx.beginPath();
    // smooth closed curve through midpoints
    var mx = (xs[SEG - 1] + xs[0]) / 2;
    var my = (ys[SEG - 1] + ys[0]) / 2;
    ctx.moveTo(mx, my);
    for (var j = 0; j < SEG; j++) {
      var k = (j + 1) % SEG;
      ctx.quadraticCurveTo(xs[j], ys[j], (xs[j] + xs[k]) / 2, (ys[j] + ys[k]) / 2);
    }
    ctx.closePath();
  }

  return {
    kind: "2d",
    render: function (u) {
      var W = canvas.width;
      var H = canvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, W, H);
      var R = u.R;
      var cx = u.cx;
      var cy = u.cy;
      var main = desat(u.main, u.sat);
      var soft = desat(u.soft, u.sat);
      var deep = desat(u.deep, u.sat);
      var cool = desat(u.cool, u.sat);
      var gk = u.light ? 0.55 : 1;

      // halo
      var hr = R * u.maxD;
      var g = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, hr);
      var hc = [main[0] * 0.7 + cool[0] * 0.3, main[1] * 0.7 + cool[1] * 0.3, main[2] * 0.7 + cool[2] * 0.3];
      g.addColorStop(0, rgba(hc, 0.55 * u.glow * gk));
      g.addColorStop(0.18, rgba(hc, 0.2 * u.glow * gk));
      g.addColorStop(0.55, rgba(hc, 0.06 * u.glow * gk));
      g.addColorStop(1, rgba(hc, 0));
      ctx.fillStyle = g;
      ctx.fillRect(cx - hr, cy - hr, hr * 2, hr * 2);

      // body
      bodyPath(u);
      var bg = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.05, cx, cy, R * 1.05);
      bg.addColorStop(0, rgba(main, 0.97));
      bg.addColorStop(0.55, rgba(deep, 0.97));
      bg.addColorStop(1, rgba(deep, 0.97));
      ctx.fillStyle = bg;
      ctx.fill();

      ctx.save();
      ctx.clip();
      ctx.globalCompositeOperation = u.light ? "source-over" : "lighter";
      var blobs = [
        [0.42, 0.0, 0.62, soft, 0.34],
        [0.38, 2.1, 0.7, cool, 0.4],
        [0.5, 4.2, 0.55, main, 0.36],
        [0.2, 1.0, 0.45, soft, 0.28],
      ];
      for (var i = 0; i < blobs.length; i++) {
        var bl = blobs[i];
        var ang = u.spin * (i % 2 ? -1.3 : 1) + bl[1] + Math.sin(u.flow * 0.7 + i) * 0.6;
        var rr = R * bl[0] * (0.8 + 0.2 * Math.sin(u.flow + i * 1.7));
        var bx = cx + Math.cos(ang) * rr;
        var by = cy + Math.sin(ang) * rr;
        var br = R * bl[2];
        var gb = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        gb.addColorStop(0, rgba(bl[3], bl[4] * u.bright));
        gb.addColorStop(1, rgba(bl[3], 0));
        ctx.fillStyle = gb;
        ctx.fillRect(bx - br, by - br, br * 2, br * 2);
      }
      // motes
      for (var m = 0; m < 6; m++) {
        var ms = u.motes[m * 3 + 2];
        if (ms < 0.001) continue;
        var mx = cx + u.motes[m * 3] * R;
        var my = cy - u.motes[m * 3 + 1] * R;
        var gm = ctx.createRadialGradient(mx, my, 0, mx, my, R * 0.16);
        gm.addColorStop(0, rgba(soft, 0.9 * ms));
        gm.addColorStop(1, rgba(soft, 0));
        ctx.fillStyle = gm;
        ctx.fillRect(mx - R * 0.16, my - R * 0.16, R * 0.32, R * 0.32);
      }
      // rim
      var rg = ctx.createRadialGradient(cx, cy, R * 0.72, cx, cy, R * 1.08);
      rg.addColorStop(0, rgba(soft, 0));
      rg.addColorStop(0.75, rgba(soft, 0.32));
      rg.addColorStop(1, rgba(soft, 0));
      ctx.fillStyle = rg;
      ctx.fillRect(cx - R * 1.2, cy - R * 1.2, R * 2.4, R * 2.4);
      // specular
      var sx = cx - R * 0.36;
      var sy = cy - R * 0.42;
      var sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, R * 0.34);
      sg.addColorStop(0, "rgba(255,255,255," + (0.18 * u.bright).toFixed(3) + ")");
      sg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = sg;
      ctx.fillRect(sx - R * 0.34, sy - R * 0.34, R * 0.68, R * 0.68);
      ctx.restore();
    },
    destroy: function () {},
  };
}
