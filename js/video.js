(function () {
  'use strict';

  /* ============================================================
     qrfile — a ~56s scroll-driven story in 3D
     chapters: title · the old way · power up · just ask ·
               scan & pair · over the lan · in your pocket
     All geometry from primitives; screens are live canvases.
     ============================================================ */

  /* ---------------- tiny helpers ---------------- */
  var V3 = function (x, y, z) { return new THREE.Vector3(x, y, z); };
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease3(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
  function easeInOut(x) { x = clamp(x, 0, 1); return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }
  function easeOutBack(x) { var c = 1.70158; x = clamp(x, 0, 1); return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); }
  function lcg(seed) {
    var s = seed >>> 0 || 1;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function cnv(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  /* ---------------- DOM handles ---------------- */
  var el = {
    player: document.getElementById('player'),      /* sticky viewport of the film */
    stage: document.getElementById('stage'),
    track: document.getElementById('filmTrack'),
    layer: document.getElementById('chapterLayer'),
    rail: document.getElementById('rail'),
    hint: document.getElementById('scrollHint'),
    subtitle: document.getElementById('subtitle'),
    spotApk: document.getElementById('spotApk'),
    spotPip: document.getElementById('spotPip'),
    flash: document.getElementById('scannerFlash')
  };

  /* ---------------- film state (scroll-driven, no player) ---------------- */
  var state = {
    t: 0,            /* smoothed film time (s) — follows scroll position */
    sceneIdx: -1,
    sceneT: 0,       /* local chapter time */
    rp: 0.12,        /* (kept for legacy compat — unused now) */
    mx: 0, my: 0,    /* smoothed mouse-parallax offsets */
    tmx: 0, tmy: 0   /* raw mouse targets */
  };
  /* triggered playback: scroll selects the chapter, the animation then plays
     out at real time instead of being scrubbed by the scroll position */
  var playbackChapter = null;
  var playbackT = 0;
  var replayRequestSeq = 0;   /* bumped once per scroll burst that stays in one chapter */
  var lastReplaySeq = 0;      /* last replay request already consumed by tick */
  var entryMeter = 0;         /* counts tick-side chapter entries — bursts that caused one may not replay */

  var FX = { gridPulse: 0, qrPop: 0, flash: 0 };
  var REDUCED = false;

  /* ============================================================
     live canvas 1 — terminal on monitor
     ============================================================ */
  /* terminal script: absolute film times → typed purely from scroll time.
     ch3 shows the install; from ch4 on the chat panel on the screen takes over,
     so the terminal only ever holds the one-time setup. */
  var TERM_SCRIPT = [
    { t: 13.3, pre: '$ ', text: 'pip install qrfile-mcp', cls: 'p' },
    { t: 14.6, pre: '  ✓ ', text: 'qrfile-mcp installed', cls: 'o' },
    { t: 15.9, pre: '  ✓ ', text: 'added to agent MCP config', cls: 'o' },
    { t: 17.2, pre: '  ✓ ', text: 'attached — assistant ready', cls: 'o' }
  ];

  var term = {
    canvas: cnv(1536, 900),
    lines: [],
    lastKey: '',
    lastBlink: -1,
    tick: function (time) {
      var now = state.t;
      var used = 0, i, L, S2, acc = 0;
      for (i = 0; i < TERM_SCRIPT.length; i++) {
        if (TERM_SCRIPT[i].t > now) break;
        used++;
      }
      while (this.lines.length < used) this.lines.push({ pre: '', text: '', cls: 'n', shown: 0 });
      if (this.lines.length > used) this.lines.splice(used);
      for (i = 0; i < used; i++) {
        S2 = TERM_SCRIPT[i];
        L = this.lines[i];
        L.pre = S2.pre;
        L.cls = S2.cls;
        L.text = S2.text;
        L.shown = clamp((now - S2.t) * 30, 0, S2.text.length);
        acc += Math.floor(L.shown);
      }
      var blink = Math.floor(time * 2.2) % 2;
      var key = used + ':' + acc;
      if (key !== this.lastKey || blink !== this.lastBlink) {
        this.lastKey = key;
        this.lastBlink = blink;
        drawTerminal(blink);
      }
    }
  };

  var TERM_COLORS = { p: '#22d3ee', o: '#34d399', s: '#a78bfa', u: '#fbbf24', n: '#dbe6ff', d: '#5d6b85' };
  term.texture = new THREE.CanvasTexture(term.canvas);
  term.texture.anisotropy = 4;

  function drawTerminal(blink) {
    var x = term.canvas.getContext('2d');
    x.setTransform(3, 0, 0, 3, 0, 0);
    var W = 512, H = 300;
    x.fillStyle = '#04070d';
    x.fillRect(0, 0, W, H);
    /* window bar */
    x.fillStyle = '#0b1220';
    x.fillRect(0, 0, W, 30);
    var dots = ['#ef4444', '#f59e0b', '#34d399'];
    for (var d = 0; d < 3; d++) { x.fillStyle = dots[d]; x.beginPath(); x.arc(18 + d * 18, 15, 5, 0, 6.29); x.fill(); }
    x.fillStyle = '#8ea3c5'; x.font = '600 12px "JetBrains Mono", monospace';
    x.fillText('~ /qrfile — mcp', 66, 19);

    x.font = '600 15px "JetBrains Mono", monospace';
    var y = 58, i, L;
    for (i = 0; i < term.lines.length; i++) {
      L = term.lines[i];
      x.fillStyle = TERM_COLORS[L.cls] || TERM_COLORS.n;
      x.fillText(L.pre, 20, y);
      x.fillStyle = L.cls === 'd' ? '#9fb2d1' : '#e6eefc';
      x.fillText(L.text.slice(0, Math.floor(L.shown)), 20 + x.measureText(L.pre).width, y);
      y += 30;
    }
    /* caret */
    if (blink) { x.fillStyle = '#22d3ee'; x.fillRect(20, y - 13, 5, 12); }
    term.texture.needsUpdate = true;
  }

  /* ============================================================
     live canvas 2 — phone screen
     states: off · app · scan · inbox · sync   (+ ui params)
     ============================================================ */
  var phoneScr = {
    canvas: cnv(768, 1536),
    state: 'off',
    ui: { digits: 0, rows: [], sweep: 0 },
    lastKey: '_',
    blink: -1,
    set: function (st) {
      this.state = st;
      this.draw();
    },
    draw: function (blink) { drawPhoneScreen(blink); phoneScr.texture.needsUpdate = true; },
    setUi: function (patch) {
      var k, changed = false;
      for (k in patch) {
        if (JSON.stringify(patch[k]) !== JSON.stringify(this.ui[k])) { this.ui[k] = patch[k]; changed = true; }
      }
      if (changed) this.draw();
    },
    key: function () {
      return this.state + '|' + this.ui.digits + '|' + (this.ui.rows || []).join(',') + '|' + (this.state === 'scan' ? Math.floor(this.ui.sweep * 40) : 0);
    },
    drawIfChanged: function (time) {
      var k = this.key();
      var blink = Math.floor(time * 2) % 2;
      if (k !== this.lastKey || blink !== this.blink) { this.blink = blink; this.lastKey = k; this.draw(blink); }
    }
  };
  phoneScr.texture = new THREE.CanvasTexture(phoneScr.canvas);
  phoneScr.texture.anisotropy = 4;

  function rr(x, rx, y, w, h, r) {
    x.beginPath();
    x.moveTo(rx + r, y);
    x.arcTo(rx + w, y, rx + w, y + h, r);
    x.arcTo(rx + w, y + h, rx, y + h, r);
    x.arcTo(rx, y + h, rx, y, r);
    x.arcTo(rx, y, rx + w, y, r);
    x.closePath();
  }

  function drawPhoneScreen(blink) {
    var c = phoneScr.canvas, x = c.getContext('2d');
    x.setTransform(3, 0, 0, 3, 0, 0);
    var W = 256, H = 512, M = 14;
    x.clearRect(0, 0, W, H);
    /* dark glass body */
    x.fillStyle = '#0a0e18';
    x.fillRect(0, 0, W, H);
    /* screen area */
    var g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#050910'); g.addColorStop(1, '#081020');
    x.fillStyle = g;
    x.fillRect(M, M, W - 2 * M, H - 2 * M);
    /* clock */
    x.fillStyle = '#5d6b85';
    x.font = '600 11px "JetBrains Mono", monospace';
    x.fillText('21:42', W - 52, 47);

    var st = phoneScr.state;

    if (st === 'off') {
      x.fillStyle = '#0b1526'; x.fillRect(M, M, W - 2 * M, H - 2 * M);
    }

    if (st === 'app') {
      /* QRFile logo block */
      var cx = W / 2, cy = 200;
      drawQrGlyph(x, cx - 42, cy - 42, 84);
      x.fillStyle = '#eaf3ff';
      x.font = '800 30px Inter, system-ui, sans-serif';
      x.fillText('QRFile', cx - 47, cy + 74);
      x.fillStyle = '#5d6b85';
      x.font = '500 12px Inter, system-ui, sans-serif';
      x.fillText('waiting for a scan…', cx - 58, cy + 100);
      /* bottom pill */
      x.fillStyle = 'rgba(34,211,238,0.10)';
      rr(x, 48, 430, 160, 30, 15); x.fill();
      x.fillStyle = '#67e8f9';
      x.font = '600 11px Inter, system-ui, sans-serif';
      x.fillText('trusted on your Wi-Fi', 60, 449);
    }

    if (st === 'scan') {
      x.fillStyle = '#8ea3c5';
      x.font = '700 14px Inter, system-ui, sans-serif';
      x.fillText('Scan to pair', 88, 80);
      /* viewfinder */
      var vx = M + 33, vy = 120, vs = W - 2 * M - 66, v = vs;
      var corners = [[vx, vy, 1, 1], [vx + v, vy, -1, 1], [vx, vy + v, 1, -1], [vx + v, vy + v, -1, -1]];
      var done = phoneScr.ui.digits >= 4;
      x.strokeStyle = done ? '#34d399' : '#22d3ee'; x.lineWidth = 4;
      for (var ci = 0; ci < 4; ci++) {
        var cc = corners[ci];
        x.beginPath();
        x.moveTo(cc[0] + cc[2] * (v * 0.28), cc[1]);
        x.lineTo(cc[0], cc[1]); x.lineTo(cc[0], cc[1] + cc[3] * (v * 0.28));
        x.stroke();
      }
      x.strokeStyle = 'rgba(148,178,255,0.25)'; x.lineWidth = 2;
      x.strokeRect(vx, vy, v, v);
      /* camera preview: the QR on your monitor, seen through the lens */
      var ps = Math.round(v * 0.62), px0 = vx + (v - ps) / 2, py0 = vy + (v - ps) / 2;
      x.fillStyle = 'rgba(8,14,26,0.55)';
      x.fillRect(vx + 2, vy + 2, v - 4, v - 4);
      x.fillStyle = '#f3f7ff';
      rr(x, px0, py0, ps, ps, 5); x.fill();
      var on = Math.max(2, Math.floor((ps - 10) / 9));
      var qx = px0 + 5, qy = py0 + 5, qs = ps - 10;
      var qrnd = lcg(31);
      x.fillStyle = '#10182a';
      for (var gy = 0; gy < 9; gy++) {
        for (var gx = 0; gx < 9; gx++) {
          if (qrnd() > 0.42) x.fillRect(qx + gx * on + 1, qy + gy * on + 1, on - 2, on - 2);
        }
      }
      /* three finder corners */
      var fS = on * 2.6;
      x.fillStyle = '#10182a';
      x.fillRect(qx, qy, fS, fS);
      x.fillRect(qx + qs - fS, qy, fS, fS);
      x.fillRect(qx, qy + qs - fS, fS, fS);
      x.fillStyle = '#f3f7ff';
      var fIn = on;
      x.fillRect(qx + fS / 2 - fIn / 2, qy + fS / 2 - fIn / 2, fIn, fIn);
      x.fillRect(qx + qs - fS + fS / 2 - fIn / 2, qy + fS / 2 - fIn / 2, fIn, fIn);
      x.fillRect(qx + fS / 2 - fIn / 2, qy + qs - fS + fS / 2 - fIn / 2, fIn, fIn);
      /* a faint blue vignette, like a real camera feed */
      var vig = x.createRadialGradient(vx + v / 2, vy + v / 2, v * 0.2, vx + v / 2, vy + v / 2, v * 0.72);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(15,35,70,0.32)');
      x.fillStyle = vig;
      x.fillRect(vx + 2, vy + 2, v - 4, v - 4);
      /* tap-to-focus box around the code, like a real camera app */
      if (!done) {
        x.strokeStyle = blink ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.4)';
        x.lineWidth = 2;
        x.strokeRect(px0 - 8, py0 - 8, ps + 16, ps + 16);
        x.fillStyle = blink ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.45)';
        x.fillRect(px0 + ps / 2 - 1, py0 + ps + 10, 2, 8);
        x.strokeStyle = 'rgba(255,255,255,0.5)';
        x.lineWidth = 1.5;
        x.beginPath();
        x.moveTo(px0 + ps / 2 - 6, py0 + ps + 21);
        x.lineTo(px0 + ps / 2 + 6, py0 + ps + 21);
        x.stroke();
      }
      /* sweep line (only while the code is still being read) */
      if (!done) {
        var sy = vy + 10 + (v - 20) * ease3(phoneScr.ui.sweep);
        var sg = x.createLinearGradient(vx, 0, vx + v, 0);
        sg.addColorStop(0, 'rgba(34,211,238,0)'); sg.addColorStop(0.5, 'rgba(103,232,249,0.95)'); sg.addColorStop(1, 'rgba(34,211,238,0)');
        x.fillStyle = sg;
        x.fillRect(vx + 6, sy, v - 12, 3);
      }
      /* digits */
      var code = '4281';
      x.font = '700 34px "JetBrains Mono", monospace';
      var shown = code.slice(0, phoneScr.ui.digits);
      var gap = 17;
      var startX = 128 - (4 * x.measureText('0').width + 3 * gap) / 2 + x.measureText('0').width / 2;
      for (var di = 0; di < 4; di++) {
        var dpos = startX + di * (x.measureText('0').width + gap);
        if (di < phoneScr.ui.digits) {
          x.fillStyle = '#67e8f9';
          x.fillText(code[di], dpos - x.measureText(code[di]).width / 2, 320);
        } else {
          x.fillStyle = 'rgba(148,178,255,0.25)';
          x.fillText('•', dpos - x.measureText('•').width / 2, 318);
        }
      }
      if (done) {
        x.fillStyle = '#34d399';
        x.font = '800 13px Inter, system-ui, sans-serif';
        x.fillText('✓ code read — pairing', 106, 350);
      } else {
        x.fillStyle = 'rgba(148,178,255,0.75)';
        x.font = '600 12px Inter, system-ui, sans-serif';
        x.fillText(blink ? 'pairing…' : 'pairing', 118, 350);
      }
    }

    if (st === 'inbox') {
      x.fillStyle = '#eaf3ff';
      x.font = '800 22px Inter, system-ui, sans-serif';
      x.fillText('Inbox', 34, 218);
      x.fillStyle = '#22d3ee';
      x.font = '800 15px Inter, system-ui, sans-serif';
      x.fillText(String(phoneScr.ui.rows.length), 100, 218);
      var ry = 252, i;
      for (i = 0; i < phoneScr.ui.rows.length && i < 5; i++) {
        x.fillStyle = 'rgba(148,178,255,0.10)';
        rr(x, 30, ry, 196, 34, 8); x.fill();
        x.fillStyle = '#dbe6ff';
        x.font = '600 12px "JetBrains Mono", monospace';
        x.fillText(phoneScr.ui.rows[i].slice(0, 18), 42, ry + 22);
        x.fillStyle = '#34d399';
        x.font = '800 13px Inter, system-ui, sans-serif';
        x.fillText('✓', 210, ry + 23);
        ry += 42;
      }
      if (phoneScr.ui.rows.length === 0) {
        x.fillStyle = blink ? '#4d5c78' : '#3a4760';
        x.font = '600 13px Inter, system-ui, sans-serif';
        x.fillText('waiting for files…', 72, 270);
      }
    }

    if (st === 'sync') {
      x.strokeStyle = '#34d399'; x.lineWidth = 6;
      x.beginPath(); x.arc(W / 2, 210, 46, 0, 6.29); x.stroke();
      x.beginPath();
      x.moveTo(W / 2 - 20, 210); x.lineTo(W / 2 - 6, 226); x.lineTo(W / 2 + 24, 192);
      x.stroke();
      x.fillStyle = '#eaf3ff';
      x.font = '800 24px Inter, system-ui, sans-serif';
      x.fillText('synced', W / 2 - 40, 292);
      x.fillStyle = '#5d6b85';
      x.font = '500 12px Inter, system-ui, sans-serif';
      x.fillText('your files live here now', W / 2 - 72, 316);
    }

    phoneScr.texture.needsUpdate = true;
  }

  function drawQrGlyph(x, ox, oy, s) {
    var m = s / 6;
    x.fillStyle = '#67e8f9';
    var corner = function (cx0, cy0, size) {
      x.fillRect(cx0, cy0, size, size);
      x.fillStyle = '#0a0e18';
      x.fillRect(cx0 + size * 0.25, cy0 + size * 0.25, size * 0.5, size * 0.5);
      x.fillStyle = '#67e8f9';
      x.fillRect(cx0 + size * 0.4, cy0 + size * 0.4, size * 0.2, size * 0.2);
    };
    x.fillStyle = '#67e8f9';
    corner(ox, oy, s * 0.32);
    corner(ox + s - s * 0.32, oy, s * 0.32);
    corner(ox, oy + s - s * 0.32, s * 0.32);
    /* dots */
    var i;
    for (i = 0; i < 8; i++) {
      var px = ox + s * 0.45 + ((i * 7) % 3) * m * 1.2;
      var py = oy + s * 0.45 + ((i * 5) % 3) * m * 1.2;
      x.fillRect(px, py, m * 0.33, m * 0.33);
    }
  }

  /* ============================================================
     live canvas 3 — the site itself, rendered INSIDE the monitor.
     shown only in the last chapter: the download page becomes
     part of the film instead of a section below the hero.
     ============================================================ */
  var siteScr = {
    canvas: cnv(1536, 900),
    pulse: -1,
    texture: null,
    drawIfChanged: function (time) {
      var k = Math.floor(time * 1.05) % 2;
      if (k !== this.pulse) { this.pulse = k; drawSite(k); }
    }
  };
  siteScr.texture = new THREE.CanvasTexture(siteScr.canvas);
  siteScr.texture.anisotropy = 4;

  function drawSite(pulse) {
    var c = siteScr.canvas, x = c.getContext('2d');
    x.setTransform(3, 0, 0, 3, 0, 0);
    var W = 512, H = 300;
    x.fillStyle = '#04070d';
    x.fillRect(0, 0, W, H);
    /* browser chrome */
    x.fillStyle = '#0b1220';
    x.fillRect(0, 0, W, 30);
    var dots = ['#ef4444', '#f59e0b', '#34d399'];
    for (var d = 0; d < 3; d++) { x.fillStyle = dots[d]; x.beginPath(); x.arc(18 + d * 18, 15, 5, 0, 6.29); x.fill(); }
    x.fillStyle = 'rgba(148,178,255,0.12)';
    rr(x, 66, 6, 268, 18, 9); x.fill();
    x.fillStyle = '#8ea3c5';
    x.font = '600 11px "JetBrains Mono", monospace';
    x.fillText('hkturtco.github.io — install', 78, 19);
    /* heading */
    x.fillStyle = '#e9eef9';
    x.font = '800 26px Inter, system-ui, sans-serif';
    x.fillText('Install', 22, 68);
    x.fillStyle = '#93a2bd';
    x.font = '500 12px Inter, system-ui, sans-serif';
    x.fillText('four steps and one download away — no cloud, no accounts.', 22, 88);
    /* little QR glyph echoing the story */
    drawQrGlyph(x, 448, 44, 40);
    x.fillStyle = '#5d6b85';
    x.font = '600 10px "JetBrains Mono", monospace';
    x.fillText('pair in minutes', 442, 96);
    /* card 1 — android app */
    x.fillStyle = 'rgba(148,178,255,0.10)';
    rr(x, 16, 106, 232, 92, 12); x.fill();
    x.strokeStyle = 'rgba(148,178,255,0.18)'; x.lineWidth = 1;
    rr(x, 16, 106, 232, 92, 12); x.stroke();
    x.fillStyle = '#e9eef9';
    x.font = '700 15px Inter, system-ui, sans-serif';
    x.fillText('Android app', 32, 130);
    x.fillStyle = '#93a2bd';
    x.font = '500 11px Inter, system-ui, sans-serif';
    x.fillText('the receiving end — your phone', 32, 146);
    x.fillStyle = '#5d6b85';
    x.font = '500 10px Inter, system-ui, sans-serif';
    x.fillText('tap the card to download', 32, 170);
    /* card 2 — MCP server */
    x.fillStyle = 'rgba(148,178,255,0.10)';
    rr(x, 262, 106, 232, 92, 12); x.fill();
    x.strokeStyle = 'rgba(148,178,255,0.18)'; x.lineWidth = 1;
    rr(x, 262, 106, 232, 92, 12); x.stroke();
    x.fillStyle = '#e9eef9';
    x.font = '700 15px Inter, system-ui, sans-serif';
    x.fillText('MCP server', 278, 130);
    x.fillStyle = '#93a2bd';
    x.font = '500 11px Inter, system-ui, sans-serif';
    x.fillText('the assistant\u2019s hands — your computer', 278, 146);
    x.fillStyle = '#5d6b85';
    x.font = '500 10px Inter, system-ui, sans-serif';
    x.fillText('tap the card to install', 278, 170);
    /* footer */
    x.fillStyle = '#93a2bd';
    x.font = '600 11px Inter, system-ui, sans-serif';
    x.fillText('APK   ·   PyPI   ·   GitHub', 22, 226);
    x.fillStyle = '#5d6b85';
    x.font = '500 11px Inter, system-ui, sans-serif';
    x.fillText('sideload the apk — expected for any install outside the play store', 22, 248);
    if (pulse) {
      x.fillStyle = '#8ea3c5';
      x.font = '500 11px Inter, system-ui, sans-serif';
      x.fillText('everything stays on your Wi-Fi_', 22, 268);
    } else {
      x.fillStyle = '#5d6b85';
      x.font = '500 11px Inter, system-ui, sans-serif';
      x.fillText('everything stays on your Wi-Fi', 22, 268);
    }
    siteScr.texture.needsUpdate = true;
  }

  /* ============================================================
     live canvas 4 — the chat with qrbot, on the monitor.
     the conversation you *hear* as speech bubbles is echoed here
     as the chat UI it actually is. shown from ch4 on under the site.
     ============================================================ */
  var CHAT = [
    { t: 33.9, me: false, text: 'paired ✓ inbox live — sending…' },
    { t: 36.5, me: true,  text: 'move report.pdf to my phone' },
    { t: 39.3, me: false, text: 'got it! opening a private lane…' },
    { t: 40.7, me: false, text: '✓ report.pdf is in your inbox' },
    { t: 42.2, me: true,  text: 'send notes-dev.pdf too' },
    { t: 43.6, me: false, text: '✓ notes-dev.pdf is in your inbox' },
    { t: 44.9, me: true,  text: 'now mix-tracks.zip + telemetry.json' },
    { t: 46.2, me: false, text: '✓ mix-tracks.zip delivered' },
    { t: 47.0, me: false, text: '✓ telemetry.json delivered' },
    { t: 49.3, me: true,  text: 'so nothing leaves the room?' },
    { t: 50.7, me: false, text: 'never. LAN only — nothing leaves the room.' }
  ];

  function chatLayout(now) {
    var rows = [], typing = -1, i;
    for (i = 0; i < CHAT.length; i++) {
      if (now >= CHAT[i].t) rows.push(i);
      else if (now >= CHAT[i].t - 1.0) { typing = i; break; }
    }
    /* the pairing QR rides the message flow as qrbot's attachment */
    var card = now >= T_QR_ON && now < T_QR_END - 0.12;
    return { rows: rows, typing: typing, card: card };
  }

  /* the QR as a chat attachment — painted straight into the chat canvas
     (same matrix the old floating popup used) */
  function drawQrBlock(x, left, top, size, dim) {
    var N = 25, q = size * 0.09, i, j, on;
    var cell = (size - 2 * q) / N;
    x.fillStyle = dim ? '#dfe7f3' : '#f2f6ff';
    x.fillRect(left, top, size, size);
    x.fillStyle = dim ? '#33415c' : '#101a2c';
    var rnd = lcg(20260101);
    for (i = 0; i < N; i++) {
      for (j = 0; j < N; j++) {
        var fName = (i < 8 && j < 8) || (i < 8 && j >= N - 8) || (i >= N - 8 && j < 8);
        if (fName) continue;
        if (i === 6 || j === 6) { on = (i + j) % 2 === 0; }
        else { on = rnd() > 0.44; }
        if (on) x.fillRect(left + q + i * cell, top + q + j * cell, cell * 0.92, cell * 0.92);
      }
    }
    var finder = function (fi, fj) {
      for (var a = 0; a < 7; a++) {
        for (var b = 0; b < 7; b++) {
          var fres = a === 0 || a === 6 || b === 0 || b === 6;
          var core = a >= 2 && a <= 4 && b >= 2 && b <= 4;
          if (fres || core) x.fillRect(left + q + (fi + a) * cell, top + q + (fj + b) * cell, cell * 0.95, cell * 0.95);
        }
      }
    };
    finder(0, 0); finder(N - 7, 0); finder(0, N - 7);
  }

  function drawBotAvatar(x, cx, cy, r) {
    x.fillStyle = 'rgba(34,211,238,0.16)';
    x.beginPath(); x.arc(cx, cy, r, 0, 6.29); x.fill();
    x.fillStyle = '#22d3ee';
    rr(x, cx - r * 0.52, cy - r * 0.42, r * 1.04, r * 0.88, r * 0.3); x.fill();
    x.fillStyle = '#062630';
    x.fillRect(cx - r * 0.34, cy - r * 0.2, r * 0.22, r * 0.26);
    x.fillRect(cx + r * 0.12, cy - r * 0.2, r * 0.22, r * 0.26);
    x.strokeStyle = '#22d3ee'; x.lineWidth = 1.4;
    x.beginPath(); x.moveTo(cx, cy - r * 0.42); x.lineTo(cx, cy - r * 0.66); x.stroke();
    x.fillStyle = '#a78bfa';
    x.beginPath(); x.arc(cx, cy - r * 0.72, r * 0.13, 0, 6.29); x.fill();
  }

  function drawYouAvatar(x, cx, cy, r) {
    x.fillStyle = 'rgba(244,114,182,0.18)';
    x.beginPath(); x.arc(cx, cy, r, 0, 6.29); x.fill();
    x.fillStyle = '#f472b6';
    x.font = '800 ' + Math.round(r * 1.05) + 'px Inter, system-ui, sans-serif';
    x.textAlign = 'center';
    x.fillText('Y', cx, cy + r * 0.38);
    x.textAlign = 'left';
  }

  /* capsule bubble w/ gradient fill, edge and a soft colored glow */
  function chatBubble(x, X, Y, w, h, fillA, fillB, edge, glow) {
    x.save();
    x.shadowColor = glow; x.shadowBlur = 12; x.shadowOffsetY = 3;
    var g = x.createLinearGradient(0, Y, 0, Y + h);
    g.addColorStop(0, fillA); g.addColorStop(1, fillB);
    x.fillStyle = g;
    rr(x, X, Y, w, h, 12); x.fill();
    x.restore();
    if (edge) {
      x.strokeStyle = edge; x.lineWidth = 1;
      rr(x, X, Y, w, h, 12); x.stroke();
    }
  }

  function drawChat(now, lay, blink) {
    var x = chatScr.canvas.getContext('2d');
    x.setTransform(3, 0, 0, 3, 0, 0);
    var W = 512, H = 300, i, m, k, text, tw, bw, pop;
    var bg = x.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#050a13'); bg.addColorStop(1, '#070d1a');
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    /* header */
    x.fillStyle = '#0b1220';
    x.fillRect(0, 0, W, 36);
    x.fillStyle = 'rgba(148,178,255,0.07)';
    x.fillRect(0, 35.5, W, 0.5);
    drawBotAvatar(x, 22, 18, 10);
    x.strokeStyle = 'rgba(34,211,238,0.45)'; x.lineWidth = 1;
    x.beginPath(); x.arc(22, 18, 11.5, 0, 6.29); x.stroke();
    x.fillStyle = '#eef3fd';
    x.font = '700 13px Inter, system-ui, sans-serif';
    x.fillText('qrbot', 40, 16);
    x.fillStyle = '#5d6b85';
    x.font = '500 10px "JetBrains Mono", monospace';
    x.fillText('your private file lane', 40, 29);
    x.fillStyle = 'rgba(52,211,153,0.12)';
    rr(x, 440, 9, 62, 18, 9); x.fill();
    x.strokeStyle = 'rgba(52,211,153,0.35)';
    rr(x, 440, 9, 62, 18, 9); x.stroke();
    x.fillStyle = blink ? '#34d399' : '#1f8a5b';
    x.beginPath(); x.arc(450, 18, 2.8, 0, 6.29); x.fill();
    x.fillStyle = '#4ade9b';
    x.font = '600 9px Inter, system-ui, sans-serif';
    x.fillText('LAN only', 456, 21);

    /* ---- message rows: centered column, bot left / you right ---- */
    x.font = '600 13.5px Inter, system-ui, sans-serif';
    var y = lay.card ? 208 : 66, RH = 30, by;
    var capRow = lay.card ? 2 : 4;
    var visibleRows = lay.rows.length > capRow ? lay.rows.slice(lay.rows.length - capRow) : lay.rows.slice();
    if (visibleRows.length && !lay.card) {
      /* day divider */
      x.strokeStyle = 'rgba(148,178,255,0.10)'; x.lineWidth = 1;
      x.beginPath(); x.moveTo(40, 47.5); x.lineTo(118, 47.5); x.moveTo(394, 47.5); x.lineTo(472, 47.5); x.stroke();
      x.fillStyle = '#43536f';
      x.font = '600 8px "JetBrains Mono", monospace';
      var dv = 'today 21:42 · private lane · your LAN';
      x.fillText(dv, (W - x.measureText(dv).width) / 2, 50.5);
      x.font = '600 13.5px Inter, system-ui, sans-serif';
    }
    for (i = 0; i < visibleRows.length; i++) {
      m = CHAT[visibleRows[i]];
      /* rows pop in whole when they arrive (typing-dots handle the in-between
         feel) — char-by-char at 5× playback would be unreadable */
      text = now >= m.t ? m.text : '';
      pop = clamp((now - m.t) / 0.5, 0, 1);
      by = y + (1 - pop) * 7;
      tw = x.measureText(text).width;
      x.save();
      x.globalAlpha = Math.min(1, pop * 2.4);
      if (m.me) {
        bw = tw + 36;
        chatBubble(x, 442 - bw, by, bw, 24, 'rgba(244,114,182,0.20)', 'rgba(236,72,153,0.07)', 'rgba(244,114,182,0.45)', 'rgba(244,114,182,0.28)');
        x.fillStyle = '#ffd9ee';
        x.fillText(text, 442 - bw + 8, by + 16.5);
        x.fillStyle = 'rgba(255,183,223,0.85)';
        x.font = '700 9px Inter, system-ui, sans-serif';
        x.fillText('✓✓', 442 - bw + 12 + tw + 4, by + 16);
        x.font = '600 13.5px Inter, system-ui, sans-serif';
        drawYouAvatar(x, 462, by + 12, 8.5);
      } else {
        bw = tw + 26;
        chatBubble(x, 72, by, bw, 24, 'rgba(34,211,238,0.16)', 'rgba(56,189,248,0.05)', 'rgba(103,232,249,0.40)', 'rgba(34,211,238,0.22)');
        x.fillStyle = '#d9f9ff';
        x.fillText(text, 80, by + 16.5);
        drawBotAvatar(x, 54, by + 12, 8.5);
      }
      x.restore();
      y += RH;
    }
    /* typing dots for the message being prepared */
    if (lay.typing >= 0 && (!lay.card || lay.rows.length < 2)) {
      drawBotAvatar(x, 54, y + 12, 8.5);
      chatBubble(x, 72, y + 1, 52, 22, 'rgba(34,211,238,0.10)', 'rgba(56,189,248,0.04)', 'rgba(103,232,249,0.22)', 'rgba(34,211,238,0.10)');
      var ti = Math.floor(now * 3) % 3;
      for (k = 0; k < 3; k++) {
        x.fillStyle = k === ti ? '#7deeff' : 'rgba(103,232,249,0.30)';
        x.beginPath(); x.arc(88 + k * 12, y + 12, 3.2, 0, 6.29); x.fill();
      }
    }

    /* ---- qrbot's pairing attachment: the QR lives in the conversation ---- */
    if (lay.card) {
      var cp = clamp((now - T_QR_ON) / 0.5, 0, 1);
      var cs = Math.max(0.001, easeOutBack(cp));
      var cal = Math.min(1, ramp(now, T_QR_ON, T_QR_ON + 0.18)) * (1 - ramp(now, T_QR_END - 0.55, T_QR_END - 0.12));
      var ok = now >= T_FLASH - 0.05;
      var qX = 210, qY = 82, qS = 92;
      x.save();
      x.globalAlpha = cal;
      x.translate(256, 127); x.scale(cs, cs); x.translate(-256, -127);
      /* card shell */
      x.save();
      x.shadowColor = 'rgba(103,232,249,0.30)'; x.shadowBlur = 26; x.shadowOffsetY = 6;
      var cg = x.createLinearGradient(0, 52, 0, 202);
      cg.addColorStop(0, 'rgba(14,21,38,0.96)'); cg.addColorStop(1, 'rgba(8,13,25,0.96)');
      x.fillStyle = cg;
      rr(x, 157, 52, 198, 150, 14); x.fill();
      x.restore();
      x.strokeStyle = ok ? 'rgba(52,211,153,0.55)' : 'rgba(148,178,255,0.20)';
      x.lineWidth = 1;
      rr(x, 157, 52, 198, 150, 14); x.stroke();
      /* card header */
      drawBotAvatar(x, 172, 66, 7);
      x.fillStyle = '#e9eef9'; x.font = '700 10px Inter, system-ui, sans-serif';
      x.fillText('qrfile · pairing', 183, 69.5);
      x.fillStyle = ok ? 'rgba(52,211,153,0.15)' : 'rgba(34,211,238,0.12)';
      rr(x, 276, 58, 71, 17, 8.5); x.fill();
      x.strokeStyle = ok ? 'rgba(52,211,153,0.50)' : 'rgba(34,211,238,0.35)';
      rr(x, 276, 58, 71, 17, 8.5); x.stroke();
      x.fillStyle = ok ? '#4ade9b' : '#7deeff';
      x.font = '700 9px "JetBrains Mono", monospace';
      x.textAlign = 'center';
      if (ok) {
        x.fillText('✓ verified', 311.5, 70);
      } else {
        var secs = Math.max(61, 300 - Math.floor((now - T_QR_ON) * 9));
        x.fillText(Math.floor(secs / 60) + ':' + ('0' + (secs % 60)).slice(-2), 311.5, 70);
      }
      x.textAlign = 'left';
      /* QR + viewfinder brackets */
      drawQrBlock(x, qX, qY, qS, ok);
      x.strokeStyle = ok ? 'rgba(52,211,153,0.35)' : 'rgba(103,232,249,0.55)';
      x.lineWidth = 1.5;
      x.beginPath();
      x.moveTo(qX - 4 + 9, qY - 4); x.lineTo(qX - 4, qY - 4); x.lineTo(qX - 4, qY - 4 + 9);
      x.moveTo(qX + qS + 4 - 9, qY - 4); x.lineTo(qX + qS + 4, qY - 4); x.lineTo(qX + qS + 4, qY - 4 + 9);
      x.moveTo(qX + qS + 4 - 9, qY + qS + 4); x.lineTo(qX + qS + 4, qY + qS + 4); x.lineTo(qX + qS + 4, qY + qS + 4 - 9);
      x.moveTo(qX - 4 + 9, qY + qS + 4); x.lineTo(qX - 4, qY + qS + 4); x.lineTo(qX - 4, qY + qS + 4 - 9);
      x.stroke();
      /* scan sweep inside the QR */
      if (!ok) {
        var swin = ramp(now, S3 + 6.5, S3 + 6.9) * (1 - ramp(now, S3 + 9.85, S3 + 10.15));
        if (swin > 0.01) {
          var sy = qY + sweepVal(now) * qS;
          x.save();
          x.beginPath(); x.rect(qX, qY, qS, qS); x.clip();
          x.shadowColor = 'rgba(103,232,249,0.8)'; x.shadowBlur = 8;
          x.fillStyle = 'rgba(125,238,255,' + (0.5 * swin).toFixed(3) + ')';
          x.fillRect(qX, sy - 3, qS, 5);
          x.restore();
        }
      }
      /* paired badge */
      if (ok) {
        x.save();
        x.shadowColor = 'rgba(52,211,153,0.8)'; x.shadowBlur = 10;
        x.fillStyle = '#0f8f63';
        x.beginPath(); x.arc(qX + qS - 2, qY + qS - 2, 10, 0, 6.29); x.fill();
        x.restore();
        x.fillStyle = '#eafff5';
        x.font = '700 11px Inter, system-ui, sans-serif';
        x.textAlign = 'center';
        x.fillText('✓', qX + qS - 2, qY + qS + 2);
        x.textAlign = 'left';
      }
      /* caption */
      x.fillStyle = '#64789a';
      x.font = '500 9px "JetBrains Mono", monospace';
      x.textAlign = 'center';
      x.fillText(!ok ? 'scan with qrfile on your phone —' : 'lane open — files now move', 256, 186);
      x.fillText(!ok ? 'confirm the 4 digits to talk' : 'device to device over your LAN', 256, 197);
      x.textAlign = 'left';
      x.restore();
    }

    /* input bar */
    x.fillStyle = '#0a101c';
    x.fillRect(0, H - 26, W, 26);
    x.fillStyle = 'rgba(148,178,255,0.06)';
    x.fillRect(0, H - 26.5, W, 0.5);
    x.fillStyle = 'rgba(148,178,255,0.09)';
    rr(x, 16, H - 21, 392, 16, 8); x.fill();
    x.strokeStyle = 'rgba(148,178,255,0.14)'; x.lineWidth = 1;
    rr(x, 16, H - 21, 392, 16, 8); x.stroke();
    x.fillStyle = '#41527a'; x.font = '700 10px Inter, system-ui, sans-serif';
    x.fillText('＋', 24, H - 9);
    x.fillStyle = '#3a4760';
    x.font = '600 10.5px Inter, system-ui, sans-serif';
    x.fillText('say it in plain words — qrbot does the rest', 40, H - 9);
    if (blink && lay.rows.length < CHAT.length) {
      x.fillStyle = '#22d3ee';
      x.fillRect(398, H - 19, 3.5, 12);
    } else {
      x.fillStyle = 'rgba(148,178,255,0.40)';
      x.font = '700 10px "JetBrains Mono", monospace';
      x.fillText('⏎', 398, H - 9.5);
    }
    chatScr.texture.needsUpdate = true;
  }

  var chatScr = {
    canvas: cnv(1536, 900),
    lastKey: '_',
    texture: null,
    drawIfChanged: function (time) {
      var now = state.t;
      var lay = chatLayout(now);
      /* newest row pops over ~0.5 film-s: quantize its entry for redraws */
      var lastT = lay.rows.length ? CHAT[lay.rows[lay.rows.length - 1]].t : 0;
      var pop = lay.rows.length && now < lastT + 0.5 ? Math.floor(Math.min(8, (now - lastT) * 16)) : 9;
      var cardK = '_';
      if (lay.card) {
        if (now >= T_FLASH - 0.05) cardK = 'ok';
        else {
          var pk = clamp((now - T_QR_ON) / 0.5, 0, 1);
          cardK = pk < 1 ? 'p' + Math.round(pk * 12) : 's' + Math.floor(sweepVal(now) * 22);
        }
      }
      var bl = Math.floor(time * 2.6) % 2;
      var k = lay.rows.length + '|' + lay.typing + '|' + cardK + '|' + pop + '|' + bl + '|' + Math.floor(now * 3) % 3;
      if (k !== this.lastKey) { this.lastKey = k; drawChat(now, lay, bl === 1); }
    }
  };
  chatScr.texture = new THREE.CanvasTexture(chatScr.canvas);
  chatScr.texture.anisotropy = 4;

  /* ============================================================
     static textures
     ============================================================ */
  function makeSoftTex(inner, outer) {
    var c = cnv(128, 128), x = c.getContext('2d');
    var g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, inner);
    g.addColorStop(0.45, outer);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }

  function makeHalo(color, scale) {
    var m = new THREE.SpriteMaterial({
      map: makeSoftTex(color, 'rgba(20,40,80,0.12)'),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    });
    var s = new THREE.Sprite(m);
    s.scale.set(scale, scale, 1);
    return s;
  }

  /* smooth molded-PVC jacket for the USB cable (reads like a cable, not rope) */
  function makeCableTex() {
    var c = cnv(128, 128), x = c.getContext('2d');
    /* circumference shading: bright highlight near the top of the tube */
    var g = x.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, '#4a5058');
    g.addColorStop(0.28, '#31353c');
    g.addColorStop(0.55, '#23262c');
    g.addColorStop(0.8, '#2c3037');
    g.addColorStop(1, '#1c1f24');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    /* fine lengthwise texture + mold speckle */
    var rnd = lcg(77);
    for (var i = 0; i < 120; i++) {
      x.fillStyle = 'rgba(' + (rnd() < 0.5 ? '255,255,255' : '0,0,0') + ',' + (0.015 + rnd() * 0.045).toFixed(3) + ')';
      x.fillRect(rnd() * 128, rnd() * 128, 0.7, 1.2 + rnd() * 4);
    }
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(7, 1);
    try { t.encoding = THREE.sRGBEncoding; } catch (e) { /* old build */ }
    return t;
  }

  /* procedural walnut grain for the desktop */
  function makeWoodTex() {
    var c = cnv(512, 256), x = c.getContext('2d');
    x.fillStyle = '#6e4d31'; x.fillRect(0, 0, 512, 256);
    var rnd = lcg(17);
    for (var i = 0; i < 130; i++) {
      var wy = rnd() * 256, wob = (rnd() - 0.5) * 30, th = 0.6 + rnd() * 2.6;
      x.strokeStyle = 'rgba(' + (rnd() < 0.55 ? '38,24,14' : '176,132,84') + ',' + (0.06 + rnd() * 0.2).toFixed(3) + ')';
      x.lineWidth = th;
      x.beginPath();
      x.moveTo(-6, wy);
      x.bezierCurveTo(150, wy + wob, 330, wy - wob, 518, wy + (rnd() - 0.5) * 12);
      x.stroke();
    }
    /* two plank seams running along the length */
    x.fillStyle = 'rgba(28,17,10,0.55)';
    x.fillRect(0, 84, 512, 2);
    x.fillRect(0, 172, 512, 2);
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2, 1);
    t.anisotropy = 4;
    try { t.encoding = THREE.sRGBEncoding; } catch (err) { /* old build */ }
    return t;
  }

  function makeTextSprite(text, color, fontPx) {
    fontPx = fontPx || 46;
    var probe = cnv(8, 8), p = probe.getContext('2d');
    p.font = '700 ' + fontPx + 'px Inter, system-ui, sans-serif';
    var w = Math.ceil(p.measureText(text).width) + 36;
    var c = cnv(w, Math.ceil(fontPx * 1.65));
    var x = c.getContext('2d');
    x.font = '700 ' + fontPx + 'px Inter, system-ui, sans-serif';
    x.textBaseline = 'middle';
    if (color !== 'none') {
      x.fillStyle = 'rgba(6,10,18,0.66)';
      x.font = '700 ' + fontPx + 'px Inter, system-ui, sans-serif';
      x.strokeStyle = 'rgba(148,178,255,0.18)';
      var pad = 14, hh = c.height;
      x.beginPath();
      x.moveTo(pad, 2); x.arcTo(c.width - 2, 2, c.width - 2, hh - 2, 12);
      x.arcTo(c.width - 2, hh - 2, pad, hh - 2, 12);
      x.arcTo(pad, hh - 2, pad, 2, 12);
      x.arcTo(pad, 2, c.width - 2, 2, 12);
      x.closePath(); x.fill(); x.stroke();
    }
    x.fillStyle = color === 'none' ? '#dbe6ff' : color;
    x.font = '700 ' + fontPx + 'px Inter, system-ui, sans-serif';
    x.fillText(text, 18, c.height / 2 + fontPx * 0.05);
    var t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: t, transparent: true, depthWrite: false
    }));
    var s = 0.0052;
    sp.scale.set(c.width * s, c.height * s, 1);
    return sp;
  }

  /* ---------------- world & scene refs (built in part B) ---------------- */
  var world = null;   // holds all THREE objects + camera + renderer

  /* ============================================================
     world build
     ============================================================ */

  function mat(color, opts) {
    var o = { color: color, roughness: 0.55, metalness: 0.18 };
    if (opts) for (var p in opts) o[p] = opts[p];
    return new THREE.MeshStandardMaterial(o);
  }

  function put(parent, geo, material, x, y, z, rx, ry, rz) {
    var m = new THREE.Mesh(geo, material);
    m.position.set(x || 0, y || 0, z || 0);
    if (rx) m.rotation.x = rx;
    if (ry) m.rotation.y = ry;
    if (rz) m.rotation.z = rz;
    parent.add(m);
    return m;
  }

  function buildWorld() {
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: el.stage, antialias: true });
    } catch (e) {
      return null;
    }
    renderer.setPixelRatio(clamp(window.devicePixelRatio || 1, 1, 1.75));
    renderer.setClearColor(0x05080f, 1);
    try { renderer.outputEncoding = THREE.sRGBEncoding; } catch (err) { /* old build */ }

    var scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x05080f, 13, 42);

    var camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 120);
    camera.position.set(0, 3.2, 14.2);

    /* --- lights (night bedroom: warm lamp + cool screen glow) --- */
    scene.add(new THREE.HemisphereLight(0x8a7f95, 0x0d0a12, 0.55));
    var sun = new THREE.DirectionalLight(0xdfe8ff, 0.4); sun.position.set(3, 7, 6); scene.add(sun);
    var rim = new THREE.DirectionalLight(0x8b5cf6, 0.22); rim.position.set(-7, 5, -4); scene.add(rim);
    var pcGlow = new THREE.PointLight(0x22d3ee, 0.55, 7); pcGlow.position.set(-2.2, 2.1, 0.9); scene.add(pcGlow);
    var phGlow = new THREE.PointLight(0x8b5cf6, 0.4, 7); phGlow.position.set(-1.8, 1.6, 1.4); scene.add(phGlow);
    var lampLight = new THREE.PointLight(0xffb066, 0.8, 6); lampLight.position.set(-0.86, 1.34, -0.32); scene.add(lampLight);

    /* --- floor + floorboard-subtle grid --- */
    var ground = put(scene, new THREE.PlaneGeometry(56, 56), mat(0x241a1c, { roughness: 0.95, metalness: 0.05 }), 0, -0.01, 0, -Math.PI / 2);
    var grid = new THREE.GridHelper(38, 52, 0x52403a, 0x33271f);
    grid.material.transparent = true;
    grid.material.opacity = 0.28;
    grid.position.y = 0.002;
    scene.add(grid);
    var gridCalm = new THREE.Color(0x52403a), gridHot = new THREE.Color(0x67e8f9);

    /* --- dust (warm indoor float) --- */
    var DUST = 300;
    var dpos = new Float32Array(DUST * 3);
    var rndD = lcg(99);
    for (var di = 0; di < DUST; di++) {
      dpos[di * 3] = (rndD() - 0.5) * 20;
      dpos[di * 3 + 1] = 0.2 + rndD() * 5.6;
      dpos[di * 3 + 2] = -5 + rndD() * 10;
    }
    var dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
    var dustPts = new THREE.Points(dustGeo, new THREE.PointsMaterial({
      size: 0.07, map: makeSoftTex('rgba(255,238,214,0.9)', 'rgba(255,200,150,0.25)'),
      color: 0xe8d4b8, transparent: true, opacity: 0.26, depthWrite: false, blending: THREE.AdditiveBlending
    }));
    scene.add(dustPts);

    /* --- the bedroom set --- */
    var wallM = mat(0x2b2333, { roughness: 0.95 });
    /* back wall behind the desk (tall enough that no camera sees its top edge) */
    put(scene, new THREE.BoxGeometry(26, 8.5, 0.2), wallM, 0, 4.23, -2.25);
    /* gradient scrim on the wall — unlit ceiling above the string lights */
    var scrimC = document.createElement('canvas'); scrimC.width = 2; scrimC.height = 128;
    var sx = scrimC.getContext('2d');
    var sg = sx.createLinearGradient(0, 0, 0, 128);
    sg.addColorStop(0, 'rgba(2,4,9,0.95)');
    sg.addColorStop(0.42, 'rgba(2,4,9,0.5)');
    sg.addColorStop(0.7, 'rgba(2,4,9,0.1)');
    sg.addColorStop(1, 'rgba(2,4,9,0)');
    sx.fillStyle = sg; sx.fillRect(0, 0, 2, 128);
    var scrimT = new THREE.CanvasTexture(scrimC);
    put(scene, new THREE.PlaneGeometry(7.05, 7.4), new THREE.MeshBasicMaterial({ map: scrimT, transparent: true, depthWrite: false }), -9.475, 3.7, -2.142);
    put(scene, new THREE.PlaneGeometry(16.6, 7.4), new THREE.MeshBasicMaterial({ map: scrimT, transparent: true, depthWrite: false }), 4.7, 3.7, -2.142);
    /* skirting board along the wall */
    put(scene, new THREE.BoxGeometry(16, 0.14, 0.06), mat(0x1f1924, { roughness: 0.9 }), 0, 0.07, -2.13);
    /* rug under the desk */
    var rug = put(scene, new THREE.CylinderGeometry(1.9, 1.9, 0.02, 30), mat(0x4c333a, { roughness: 1 }), -1.6, 0.01, 0.9);
    rug.scale.set(1.2, 1, 0.66);
    /* window with night sky + moon (wall left, clear of the chapter copy) */
    put(scene, new THREE.PlaneGeometry(1.7, 1.4), new THREE.MeshBasicMaterial({ color: 0x0e1d3a }), -4.8, 2.35, -2.13);
    put(scene, new THREE.BoxGeometry(1.84, 0.08, 0.06), mat(0x2e241d, { roughness: 0.8 }), -4.8, 3.09, -2.09);
    put(scene, new THREE.BoxGeometry(1.84, 0.08, 0.06), mat(0x2e241d, { roughness: 0.8 }), -4.8, 1.63, -2.09);
    put(scene, new THREE.BoxGeometry(0.08, 1.54, 0.06), mat(0x2e241d, { roughness: 0.8 }), -5.69, 2.36, -2.09);
    put(scene, new THREE.BoxGeometry(0.08, 1.54, 0.06), mat(0x2e241d, { roughness: 0.8 }), -3.91, 2.36, -2.09);
    put(scene, new THREE.PlaneGeometry(1.72, 0.045), new THREE.MeshBasicMaterial({ color: 0x1b2a4a }), -4.8, 2.36, -2.125);
    put(scene, new THREE.CircleGeometry(0.09, 20), new THREE.MeshBasicMaterial({ color: 0xcdd7ee }), -5.05, 2.72, -2.11);
    var moonHalo = makeHalo('rgba(130,150,215,0.22)', 2.1);
    moonHalo.position.set(-5.05, 2.72, -2.105);
    scene.add(moonHalo);
    /* posters above the desk */
    put(scene, new THREE.BoxGeometry(0.74, 0.94, 0.03), mat(0x27344f, { roughness: 0.9 }), -3.2, 3.32, -2.13);
    put(scene, new THREE.BoxGeometry(0.57, 0.74, 0.03), mat(0x39304e, { roughness: 0.9 }), -3.2, 3.34, -2.105);
    put(scene, new THREE.BoxGeometry(0.8, 1.0, 0.03), mat(0x2c2b47, { roughness: 0.9 }), -1.15, 3.5, -2.13);
    put(scene, new THREE.BoxGeometry(0.64, 0.84, 0.02), mat(0x1c2440, { roughness: 0.9 }), -1.15, 3.52, -2.1);
    /* string lights across the wall */
    for (var slI = 0; slI < 10; slI++) {
      var slT = slI / 9;
      var slX = lerp(-6.3, 3.6, slT);
      var slY = 4.05 - Math.sin(slT * Math.PI) * 0.5;
      put(scene, new THREE.SphereGeometry(0.03, 8, 8),
        new THREE.MeshBasicMaterial({ color: slI % 2 ? 0xffd9a0 : 0x67e8f9 }),
        slX, slY, -2.11);
    }
    /* desk lamp (right end of the desk) — detailed */
    var lampG = new THREE.Group();
    put(lampG, new THREE.CylinderGeometry(0.1, 0.12, 0.03, 16), mat(0x1c1a22, { roughness: 0.5, metalness: 0.4 }), 0, 0.02, 0);
    put(lampG, new THREE.CylinderGeometry(0.022, 0.022, 0.52, 10), mat(0x1c1a22, { roughness: 0.5, metalness: 0.4 }), 0.05, 0.29, 0);
    put(lampG, new THREE.CylinderGeometry(0.05, 0.09, 0.16, 14, 1, true), mat(0x2a2430, { roughness: 0.6 }), 0.02, 0.6, 0.02);
    put(lampG, new THREE.CircleGeometry(0.085, 14), new THREE.MeshBasicMaterial({ color: 0xffc98a }), -0.01, 0.52, 0.03);
    put(lampG, new THREE.SphereGeometry(0.02, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffe0a8 }), 0.0, 0.52, 0.04);
    lampG.rotation.z = -0.16;
    lampG.position.set(-0.82, 0.82, -0.34);
    scene.add(lampG);
    /* headphones resting by the monitor stand */
    var hpG = new THREE.Group();
    put(hpG, new THREE.TorusGeometry(0.13, 0.03, 10, 24, Math.PI), mat(0x141821, { roughness: 0.4 }), 0, 0.09, 0);
    put(hpG, new THREE.CylinderGeometry(0.028, 0.028, 0.14, 8), mat(0x141821, { roughness: 0.4 }), -0.13, 0.05, 0);
    put(hpG, new THREE.CylinderGeometry(0.028, 0.028, 0.14, 8), mat(0x141821, { roughness: 0.4 }), 0.13, 0.05, 0);
    put(hpG, new THREE.CylinderGeometry(0.045, 0.045, 0.02, 16), mat(0x0a0d14, { roughness: 0.6 }), -0.13, 0.0, 0);
    put(hpG, new THREE.CylinderGeometry(0.045, 0.045, 0.02, 16), mat(0x0a0d14, { roughness: 0.6 }), 0.13, 0.0, 0);
    hpG.position.set(-3.28, 0.83, 0.35);
    hpG.rotation.y = 0.5;
    scene.add(hpG);
    /* a stack of books on the desk */
    put(scene, new THREE.BoxGeometry(0.34, 0.05, 0.24), mat(0x7a4a3a, { roughness: 0.9 }), -2.95, 0.85, -0.3);
    put(scene, new THREE.BoxGeometry(0.32, 0.003, 0.22), mat(0xf2ead8, { roughness: 0.9 }), -2.95, 0.876, -0.3);
    put(scene, new THREE.BoxGeometry(0.3, 0.05, 0.22), mat(0x3f5a72, { roughness: 0.9 }), -2.97, 0.9, -0.31);
    put(scene, new THREE.BoxGeometry(0.28, 0.003, 0.2), mat(0xf2ead8, { roughness: 0.9 }), -2.97, 0.926, -0.31);
    put(scene, new THREE.BoxGeometry(0.34, 0.05, 0.24), mat(0x5a4a6a, { roughness: 0.9 }), -2.96, 0.95, -0.3);
    put(scene, new THREE.BoxGeometry(0.32, 0.003, 0.22), mat(0xf2ead8, { roughness: 0.9 }), -2.96, 0.976, -0.3);

    /* --- desk: walnut top + dark steel frame --- */
    var woodTop = new THREE.MeshStandardMaterial({ map: makeWoodTex(), roughness: 0.5, metalness: 0.04 });
    var woodEdge = new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.65, metalness: 0.02 });
    var steel = mat(0x1a1d24, { roughness: 0.38, metalness: 0.62 });
    var desk = new THREE.Group();
    /* desktop slab with beveled underside */
    put(desk, new THREE.BoxGeometry(3.0, 0.09, 1.42), [woodEdge, woodEdge, woodTop, woodEdge, woodEdge, woodEdge], 0, 0.78, 0);
    put(desk, new THREE.BoxGeometry(3.04, 0.012, 1.46), mat(0x2a1a10, { roughness: 0.8 }), 0, 0.73, 0);
    /* four steel legs + apron frame */
    put(desk, new THREE.BoxGeometry(0.075, 0.74, 0.075), steel, -1.3, 0.37, 0.56);
    put(desk, new THREE.BoxGeometry(0.075, 0.74, 0.075), steel, -1.3, 0.37, -0.56);
    put(desk, new THREE.BoxGeometry(0.075, 0.74, 0.075), steel, 1.3, 0.37, 0.56);
    put(desk, new THREE.BoxGeometry(0.075, 0.74, 0.075), steel, 1.3, 0.37, -0.56);
    put(desk, new THREE.BoxGeometry(2.55, 0.12, 0.05), steel, 0, 0.67, 0.54);
    put(desk, new THREE.BoxGeometry(2.55, 0.12, 0.05), steel, 0, 0.67, -0.54);
    put(desk, new THREE.BoxGeometry(0.05, 0.12, 1.05), steel, 0, 0.67, 0);
    /* desk mat */
    put(desk, new THREE.PlaneGeometry(1.15, 0.5), mat(0x151a24, { roughness: 0.92, metalness: 0.02 }), -0.1, 0.83, 0.38, -Math.PI / 2);

    /* --- detailed keyboard (individual key caps) --- */
    var kbG = new THREE.Group();
    var kbBaseMat = mat(0x0b0f17, { roughness: 0.55, metalness: 0.25 });
    var kbPlateMat = mat(0x1a2030, { roughness: 0.4, metalness: 0.35 });
    var keyMatA = mat(0x2e3648, { roughness: 0.55 });
    var keyMatB = mat(0x252d3d, { roughness: 0.55 });
    var keyMatC = mat(0x1f2533, { roughness: 0.55 });
    put(kbG, new THREE.BoxGeometry(1.04, 0.022, 0.36), kbBaseMat, 0, 0.011, 0);
    put(kbG, new THREE.BoxGeometry(1.0, 0.004, 0.32), kbPlateMat, 0, 0.024, 0);
    var unit = 0.062;
    var keyRows = [
      [1,1,1,1,1,1,1,1,1,1,1,1,1,2],
      [1.5,1,1,1,1,1,1,1,1,1,1,1,1,1.5],
      [1.75,1,1,1,1,1,1,1,1,1,1,1,2.25],
      [2.25,1,1,1,1,1,1,1,1,1,1,2.75],
      [1.25,1.25,1.25,6.25,1.25,1.25,1.25]
    ];
    var keyH = 0.012, keyD = 0.046, keyGap = 0.006;
    for (var rki = 0; rki < keyRows.length; rki++) {
      var kx = -0.5;
      var kz = -0.14 + rki * 0.062;
      for (var kki = 0; kki < keyRows[rki].length; kki++) {
        var kw = keyRows[rki][kki] * unit;
        var capW = kw - keyGap;
        var km = (rki === 0 && kki === 0) ? keyMatC : ((rki + kki) % 3 === 0 ? keyMatB : keyMatA);
        put(kbG, new THREE.BoxGeometry(capW, keyH, keyD), km, kx + kw / 2, 0.03, kz);
        /* keycap top highlight */
        put(kbG, new THREE.PlaneGeometry(capW * 0.85, keyD * 0.7), new THREE.MeshBasicMaterial({ color: 0x4a5570, transparent: true, opacity: 0.25 }), kx + kw / 2, 0.0365, kz, -Math.PI / 2);
        kx += kw + keyGap;
      }
    }
    kbG.position.set(-0.12, 0.83, 0.4);
    desk.add(kbG);

    /* --- detailed mouse --- */
    var mouseG = new THREE.Group();
    var mouseBodyMat = mat(0x1a1d24, { roughness: 0.4, metalness: 0.3 });
    put(mouseG, new THREE.BoxGeometry(0.078, 0.022, 0.125), mouseBodyMat, 0, 0.011, 0);
    var dome = put(mouseG, new THREE.SphereGeometry(0.04, 16, 8), mouseBodyMat, 0, 0.02, -0.01);
    dome.scale.set(1, 0.55, 1.25);
    put(mouseG, new THREE.BoxGeometry(0.032, 0.002, 0.05), mat(0x2a2f3a, { roughness: 0.4 }), -0.018, 0.024, -0.035);
    put(mouseG, new THREE.BoxGeometry(0.032, 0.002, 0.05), mat(0x2a2f3a, { roughness: 0.4 }), 0.018, 0.024, -0.035);
    put(mouseG, new THREE.CylinderGeometry(0.006, 0.006, 0.025, 12), mat(0x0a0d14, { roughness: 0.3, metalness: 0.5 }), 0, 0.026, -0.005, Math.PI / 2);
    put(mouseG, new THREE.CylinderGeometry(0.004, 0.004, 0.18, 8), mat(0x1a1d24, { roughness: 0.7 }), 0, 0.02, 0.1, 1.3);
    mouseG.position.set(0.78, 0.83, 0.42);
    desk.add(mouseG);

    /* --- mug with handle + coffee --- */
    var mugG = new THREE.Group();
    var mugMat = mat(0x6b86b8, { roughness: 0.45, metalness: 0.05 });
    put(mugG, new THREE.CylinderGeometry(0.062, 0.052, 0.115, 20), mugMat, 0, 0.0575, 0);
    put(mugG, new THREE.CylinderGeometry(0.055, 0.055, 0.006, 20), mat(0x2a3a55, { roughness: 0.6 }), 0, 0.112, 0);
    put(mugG, new THREE.CircleGeometry(0.05, 20), mat(0x1a1208, { roughness: 0.25 }), 0, 0.113, 0, -Math.PI / 2);
    var mugHandle = put(mugG, new THREE.TorusGeometry(0.04, 0.012, 10, 20, Math.PI * 1.4), mugMat, 0.062, 0.055, 0);
    mugHandle.rotation.z = Math.PI / 2;
    mugHandle.rotation.x = 0.3;
    /* steam */
    put(mugG, new THREE.SphereGeometry(0.012, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 }), 0.01, 0.18, 0.01);
    put(mugG, new THREE.SphereGeometry(0.009, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2 }), -0.015, 0.21, -0.01);
    var mug = mugG;
    mugG.position.set(-1.28, 0.82, 0.34);
    desk.add(mugG);

    /* --- plant in pot --- */
    var plantG = new THREE.Group();
    var potMat = mat(0x6b4f3a, { roughness: 0.7 });
    put(plantG, new THREE.CylinderGeometry(0.045, 0.038, 0.06, 16), potMat, 0, 0.03, 0);
    put(plantG, new THREE.CircleGeometry(0.042, 16), mat(0x2a1f14, { roughness: 0.9 }), 0, 0.062, 0, -Math.PI / 2);
    var leafM = mat(0x2fa874, { roughness: 0.75 });
    put(plantG, new THREE.SphereGeometry(0.055, 10, 10), leafM, 0, 0.12, 0);
    put(plantG, new THREE.SphereGeometry(0.04, 10, 10), leafM, 0.045, 0.10, 0.02);
    put(plantG, new THREE.SphereGeometry(0.04, 10, 10), leafM, -0.04, 0.105, -0.02);
    put(plantG, new THREE.SphereGeometry(0.035, 10, 10), leafM, 0.01, 0.15, -0.03);
    plantG.position.set(0.52, 0.83, 0.22);
    desk.add(plantG);

    /* --- stationery & accessories --- */
    var paperMat = mat(0xf2f0e8, { roughness: 0.9, metalness: 0 });
    put(desk, new THREE.BoxGeometry(0.26, 0.012, 0.19), paperMat, -0.62, 0.84, -0.35);
    put(desk, new THREE.BoxGeometry(0.24, 0.012, 0.18), paperMat, -0.62, 0.855, -0.34);
    put(desk, new THREE.BoxGeometry(0.25, 0.012, 0.185), paperMat, -0.62, 0.87, -0.35);
    /* sticky notes pad */
    put(desk, new THREE.BoxGeometry(0.12, 0.018, 0.12), mat(0xf5d76e, { roughness: 0.8 }), -0.85, 0.84, -0.32);
    put(desk, new THREE.BoxGeometry(0.12, 0.003, 0.12), mat(0xf7e9a0, { roughness: 0.8 }), -0.85, 0.852, -0.32);
    /* pen */
    var penG = new THREE.Group();
    put(penG, new THREE.CylinderGeometry(0.006, 0.006, 0.15, 10), mat(0x1f3a6b, { roughness: 0.3, metalness: 0.4 }), 0, 0.006, 0);
    put(penG, new THREE.ConeGeometry(0.006, 0.02, 10), mat(0xb8c4d8, { roughness: 0.3 }), 0, 0.09, 0);
    put(penG, new THREE.CylinderGeometry(0.007, 0.007, 0.015, 10), mat(0xd4a017, { roughness: 0.4 }), 0, -0.07, 0);
    penG.rotation.z = 0.15;
    penG.position.set(-0.4, 0.845, -0.25);
    desk.add(penG);
    /* pencil */
    var pencilG = new THREE.Group();
    put(pencilG, new THREE.CylinderGeometry(0.005, 0.005, 0.16, 8), mat(0xe8c44a, { roughness: 0.7 }), 0, 0.005, 0);
    put(pencilG, new THREE.ConeGeometry(0.005, 0.018, 8), mat(0xd9b08c, { roughness: 0.7 }), 0, 0.093, 0);
    put(pencilG, new THREE.CylinderGeometry(0.0055, 0.0055, 0.012, 8), mat(0xe88a8a, { roughness: 0.7 }), 0, -0.07, 0);
    pencilG.rotation.z = -0.2;
    pencilG.position.set(-0.55, 0.845, -0.2);
    desk.add(pencilG);
    /* ruler */
    put(desk, new THREE.BoxGeometry(0.32, 0.004, 0.03), mat(0xd8c8a0, { roughness: 0.6 }), 0.4, 0.84, -0.38);
    /* stapler */
    var staplerG = new THREE.Group();
    put(staplerG, new THREE.BoxGeometry(0.11, 0.025, 0.045), mat(0xc0392b, { roughness: 0.5, metalness: 0.2 }), 0, 0.0125, 0);
    put(staplerG, new THREE.BoxGeometry(0.1, 0.035, 0.04), mat(0x922b21, { roughness: 0.5 }), 0, 0.04, -0.02);
    staplerG.position.set(0.95, 0.83, -0.3);
    desk.add(staplerG);
    /* paper clip */
    put(desk, new THREE.TorusGeometry(0.018, 0.003, 8, 16), mat(0x9aa0a6, { roughness: 0.4, metalness: 0.7 }), 0.55, 0.84, -0.33);
    /* notebook */
    put(desk, new THREE.BoxGeometry(0.22, 0.025, 0.16), mat(0x2c3e50, { roughness: 0.6 }), 0.1, 0.84, -0.32);
    put(desk, new THREE.BoxGeometry(0.2, 0.002, 0.14), mat(0xf5f5f5, { roughness: 0.9 }), 0.1, 0.854, -0.32);

    /* --- monitor + terminal screen --- */
    var mon = new THREE.Group();
    var monoMat = mat(0x0c1526, { roughness: 0.3, metalness: 0.5 });
    var bezelMat = mat(0x111827, { roughness: 0.35, metalness: 0.4 });
    put(mon, new THREE.BoxGeometry(0.5, 0.04, 0.34), monoMat, 0, 0.82, 0);
    put(mon, new THREE.BoxGeometry(0.1, 0.42, 0.06), monoMat, 0, 1.02, -0.02);
    put(mon, new THREE.BoxGeometry(2.1, 1.22, 0.06), bezelMat, 0, 1.74, 0.05);
    var screenMesh = put(mon, new THREE.PlaneGeometry(1.86, 1.02), new THREE.MeshBasicMaterial({ map: term.texture }), 0, 1.74, 0.099);
    put(mon, new THREE.PlaneGeometry(2.06, 0.02), new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.6 }), 0, 2.33, 0.098);
    put(mon, new THREE.CircleGeometry(0.015, 12), new THREE.MeshBasicMaterial({ color: 0x1a1a1a }), 0, 2.3, 0.098);
    /* last chapter: the site fades IN over the terminal — the download page lives inside the film */
    var siteMesh = put(mon, new THREE.PlaneGeometry(1.86, 1.02),
      new THREE.MeshBasicMaterial({ map: siteScr.texture, transparent: true, opacity: 0 }),
      0, 1.74, 0.104);
    /* ch4+: the qrbot chat fades in over the terminal too — the conversation
       lives on the screen, not in a console (under the site layer) */
    var chatMesh = put(mon, new THREE.PlaneGeometry(1.86, 1.02),
      new THREE.MeshBasicMaterial({ map: chatScr.texture, transparent: true, opacity: 0 }),
      0, 1.74, 0.101);
    /* desk group position */
    desk.position.set(-2.2, 0, 0); scene.add(desk);
    mon.position.set(-2.2, 0, 0); scene.add(mon);

    /* --- qr popup on screen --- */
    /* --- pairing fx only: the QR itself now lives INSIDE the chat message
       (attachment card in drawChat), so nothing floats over the conversation.
       This group just carries the confirm ring that pops when pairing lands,
       anchored to the on-screen position of the in-chat QR. --- */
    var qrGroup = new THREE.Group();
    var confirmRing = put(qrGroup, new THREE.RingGeometry(0.2, 0.26, 40), new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }), 0, 0, 0.05);
    qrGroup.position.set(-2.2, 1.842, 0.16);
    qrGroup.visible = false;
    scene.add(qrGroup);
    var QR_ANCHOR = V3(-2.2, 1.842, 0.16);

    /* --- qrbot: the assistant's little avatar, standing on the desk
       beside the monitor. appears when the MCP attaches (ch3 on). --- */
    var bot = new THREE.Group();
    var botShell = mat(0x16202f, { roughness: 0.35, metalness: 0.45 });
    var botDark = mat(0x0a101d, { roughness: 0.3, metalness: 0.35 });
    var botAccent = new THREE.MeshStandardMaterial({ color: 0x22d3ee, roughness: 0.25, metalness: 0.1, emissive: 0x16808f, emissiveIntensity: 0.7 });
    var botEyeMat = new THREE.MeshBasicMaterial({ color: 0x9ff5ff });
    var botViolet = new THREE.MeshBasicMaterial({ color: 0xa78bfa });
    var botHead = new THREE.Group();
    var botBody = put(botHead, new THREE.SphereGeometry(0.155, 20, 16), botShell, 0, 0.2, 0);
    botBody.scale.set(0.92, 1.02, 0.82);
    var botFace = put(botHead, new THREE.SphereGeometry(0.126, 20, 14), botDark, 0, 0.225, 0.03);
    botFace.scale.set(0.9, 0.94, 0.76);
    put(botHead, new THREE.SphereGeometry(0.02, 12, 10), botEyeMat, -0.048, 0.24, 0.148);
    put(botHead, new THREE.SphereGeometry(0.02, 12, 10), botEyeMat, 0.048, 0.24, 0.148);
    put(botHead, new THREE.SphereGeometry(0.011, 8, 6), botAccent, 0, 0.175, 0.152);  /* little chin light */
    put(botHead, new THREE.CylinderGeometry(0.005, 0.005, 0.085, 6), botAccent, 0, 0.375, -0.01);
    put(botHead, new THREE.SphereGeometry(0.017, 10, 8), botViolet, 0, 0.425, -0.01);
    bot.add(botHead);
    /* torso ring, arms, feet */
    put(bot, new THREE.CylinderGeometry(0.062, 0.075, 0.05, 18), botDark, 0, 0.065, 0);
    var botArmL = put(bot, new THREE.CylinderGeometry(0.013, 0.01, 0.12, 8), botShell, -0.16, 0.14, 0.02);
    botArmL.rotation.z = 0.5;
    var botArmR = put(bot, new THREE.CylinderGeometry(0.013, 0.01, 0.12, 8), botShell, 0.16, 0.14, 0.02);
    botArmR.rotation.z = -0.5;
    put(bot, new THREE.SphereGeometry(0.022, 10, 8), botAccent, -0.2, 0.085, 0.02);
    put(bot, new THREE.SphereGeometry(0.022, 10, 8), botAccent, 0.2, 0.085, 0.02);
    put(bot, new THREE.SphereGeometry(0.042, 12, 10), botDark, -0.062, 0.03, 0);
    put(bot, new THREE.SphereGeometry(0.042, 12, 10), botDark, 0.062, 0.03, 0);
    var botHalo = makeHalo('rgba(34,211,238,0.3)', 0.62);
    botHalo.material.opacity = 0;
    botHalo.position.set(0, 0.22, 0);
    bot.add(botHalo);
    bot.position.set(-1.42, 0.838, 0.16);
    bot.rotation.y = -0.35;
    bot.visible = false;
    bot.scale.setScalar(0.001);
    scene.add(bot);
    var BOT_BASE_Y = 0.838, BOT_BASE_RY = -0.35;

    /* --- your phone (you are the one holding it — it rises into view) --- */
    var phone = new THREE.Group();
    var pbody = mat(0x0e1420, { roughness: 0.35, metalness: 0.5 });
    put(phone, new THREE.BoxGeometry(0.34, 0.66, 0.05), pbody, 0, 0, 0);
    var pscreenMat = new THREE.MeshBasicMaterial({ map: phoneScr.texture });
    put(phone, new THREE.PlaneGeometry(0.3, 0.61), pscreenMat, 0, 0, 0.028);
    var phoneAnchor = new THREE.Object3D(); phoneAnchor.position.set(0, 0.08, 0.05);
    phone.add(phoneAnchor);
    scene.add(phone);
    phone.visible = false;

    /* ============================================================
       old-way props (chapter 1)
       ============================================================ */
    var oldway = { group: new THREE.Group(), mats: [], labels: [] };
    var oG = oldway.group;
    var oM = function (m) { m.transparent = true; oldway.mats.push(m); return m; };

    /* --- a small PC tower on the right, anchoring the cable port --- */
    var tower = new THREE.Group();
    put(tower, new THREE.BoxGeometry(0.2, 0.34, 0.34), mat(0x1a1e26, { roughness: 0.5, metalness: 0.4 }), 0, 0.17, 0);
    put(tower, new THREE.BoxGeometry(0.205, 0.012, 0.345), mat(0x0c0e14, { roughness: 0.7 }), 0, 0.345, 0);
    put(tower, new THREE.BoxGeometry(0.16, 0.004, 0.06), mat(0x0a0c12, { roughness: 0.8 }), 0.02, 0.22, 0.175);
    put(tower, new THREE.BoxGeometry(0.16, 0.004, 0.06), mat(0x0a0c12, { roughness: 0.8 }), 0.02, 0.18, 0.175);
    put(tower, new THREE.CircleGeometry(0.012, 12), new THREE.MeshBasicMaterial({ color: 0x34d399 }), 0.06, 0.26, 0.175);
    put(tower, new THREE.CircleGeometry(0.012, 12), new THREE.MeshBasicMaterial({ color: 0x22d3ee }), 0.06, 0.2, 0.175);
    /* two real USB-A ports on the front panel (dark socket + lighter tongue strip) */
    put(tower, new THREE.BoxGeometry(0.026, 0.012, 0.006), mat(0x06080c, { roughness: 0.85 }), 0.03, 0.115, 0.171);
    put(tower, new THREE.BoxGeometry(0.015, 0.007, 0.003), mat(0x2b3242, { roughness: 0.5 }), 0.03, 0.115, 0.176);
    put(tower, new THREE.BoxGeometry(0.026, 0.012, 0.006), mat(0x06080c, { roughness: 0.85 }), 0.075, 0.115, 0.171);
    put(tower, new THREE.BoxGeometry(0.015, 0.007, 0.003), mat(0x2b3242, { roughness: 0.5 }), 0.075, 0.115, 0.176);
    put(tower, new THREE.BoxGeometry(0.018, 0.008, 0.008), mat(0x232730, { roughness: 0.5 }), 0.075, 0.3, 0.175);
    tower.position.set(-0.95, 0.82, 0.12);
    oG.add(tower);

    /* --- the USB cable, plugged INTO the tower and tangled on the desk ---
       slim like a real cable (≈2.5 mm jacket), resting just mm above the wood;
       the knot lives in the open between keyboard and phone so it reads clean */
    var cableCurve = new THREE.CatmullRomCurve3([
      V3(-0.92, 0.937, 0.36),    /* out of the USB-A port */
      V3(-0.97, 0.928, 0.43),    /* boot ends, cable flexes */
      V3(-1.06, 0.87, 0.47),     /* arcs down onto the desk */
      V3(-1.26, 0.842, 0.45),
      V3(-1.5, 0.838, 0.38),     /* swings behind the mat */
      V3(-1.72, 0.84, 0.45),
      V3(-1.74, 0.847, 0.57),    /* loose knot, in the open */
      V3(-1.5, 0.838, 0.63),     /* loop back, visibly overlapping */
      V3(-1.32, 0.841, 0.584),
      V3(-1.298, 0.845, 0.59)    /* up into the phone's USB-C boot */
    ]);
    var cableMat = oM(new THREE.MeshStandardMaterial({
      map: makeCableTex(), color: 0xffffff, roughness: 0.52, metalness: 0.12
    }));
    var bootMat = oM(new THREE.MeshStandardMaterial({ color: 0x262a31, roughness: 0.6, metalness: 0.15 }));
    var shellMat = oM(new THREE.MeshStandardMaterial({ color: 0xcdd5df, roughness: 0.28, metalness: 0.85 }));
    var contactMat = oM(new THREE.MeshStandardMaterial({ color: 0xd8b24a, roughness: 0.35, metalness: 0.9 }));
    var cable = put(oG, new THREE.TubeGeometry(cableCurve, 150, 0.013, 10, false), cableMat, 0, 0, 0);

    /* USB-A plug: shell inserted into the tower's front port + tapered strain boot */
    var usbA = new THREE.Group();
    put(usbA, new THREE.BoxGeometry(0.02, 0.0095, 0.082), shellMat, 0, 0, 0.171);
    put(usbA, new THREE.BoxGeometry(0.021, 0.0105, 0.003), mat(0x8f97a3, { roughness: 0.3, metalness: 0.8 }), 0, 0, 0.204);
    var aBoot = put(usbA, new THREE.CylinderGeometry(0.019, 0.010, 0.05, 12), bootMat, 0, 0, 0.231);
    aBoot.rotation.x = Math.PI / 2;
    usbA.position.set(0.03, 0.115, -0.02);   /* tower-local, shifted so shell spans the panel */
    tower.add(usbA);
    /* ferrite bead hugging the cable while it is still airborne near the plug */
    var ferrite = put(oG, new THREE.CylinderGeometry(0.024, 0.024, 0.05, 14),
      oM(new THREE.MeshStandardMaterial({ color: 0x171a20, roughness: 0.88, metalness: 0.05 })),
      -1.015, 0.899, 0.45);
    ferrite.quaternion.setFromUnitVectors(V3(0, 1, 0), V3(-0.09, -0.058, 0.04).normalize());

    /* a phone lying flat on the desk, tethered but "not recognized" */
    var phoneFlat = new THREE.Group();
    put(phoneFlat, new THREE.BoxGeometry(0.34, 0.022, 0.66), mat(0x0e1420, { roughness: 0.4, metalness: 0.5 }), 0, 0, 0);
    put(phoneFlat, new THREE.PlaneGeometry(0.3, 0.61), new THREE.MeshBasicMaterial({ color: 0x1a2236 }), 0, 0.012, 0, -Math.PI / 2);
    phoneFlat.position.set(-1.05, 0.838, 0.5);
    phoneFlat.rotation.y = 0.35;
    /* USB-C plug: silver oval shell at the phone's edge + tapered boot */
    var usbC = new THREE.Group();
    put(usbC, new THREE.BoxGeometry(0.045, 0.013, 0.044), shellMat, -0.19, 0, 0);
    put(usbC, new THREE.BoxGeometry(0.0018, 0.009, 0.037), contactMat, -0.1678, 0, 0);
    var cBoot = put(usbC, new THREE.CylinderGeometry(0.008, 0.017, 0.05, 12), bootMat, -0.2375, 0, 0);
    cBoot.rotation.z = -Math.PI / 2;
    phoneFlat.add(usbC);
    oG.add(phoneFlat);

    /* labels — each sticky note only shows while it tells its part of the story */
    var oldLabels = [
      { t: 'one drawer. forty cables…', p: V3(-1.62, 1.85, 0.42), c: '#c7d3ea', on: [S1 + 0.4, S1 + 4.6], size: 18 },
      { t: 'the knot. every time.', p: V3(-1.55, 1.42, 0.5), c: '#fbd38d', on: [S1 + 3.6, S1 + 6.6], size: 18 },
      { t: 'plugged in — at last', p: V3(-0.97, 1.22, 0.35), c: '#8ea3c5', on: [S1 + 5.7, S1 + 9.0], size: 16 }
    ];
    for (var li = 0; li < oldLabels.length; li++) {
      var sp = makeTextSprite(oldLabels[li].t, oldLabels[li].c, oldLabels[li].size || 40);
      sp.position.copy(oldLabels[li].p);
      if (oldLabels[li].sc) sp.scale.multiplyScalar(oldLabels[li].sc);
      oG.add(sp);
      oldway.mats.push(sp.material);
      oldway.labels.push({ mat: sp.material, t0: oldLabels[li].on[0], t1: oldLabels[li].on[1] });
    }
    /* make every material in the old-way set fade together (cable, plugs, tower) */
    oG.traverse(function (o) {
      var m = o.material;
      if (m && oldway.mats.indexOf(m) === -1) { m.transparent = true; oldway.mats.push(m); }
    });
    oG.visible = false;
    scene.add(oG);

    /* ============================================================
       LAN beam + packets (built when pair happens)
       ============================================================ */
    /* file curve: a document travels from the monitor (computer) to the phone.
       no beam, no text — just the paper moving through the air. */
    var fileCurve = null;
    function buildFileCurve() {
      var end = new THREE.Vector3();
      phoneAnchor.getWorldPosition(end);
      var start = V3(-2.2, 1.74, 0.12);   /* emerges from the monitor screen */
      var mid = start.clone().lerp(end, 0.5);
      mid.y += 0.35; mid.z += 0.15;
      fileCurve = new THREE.QuadraticBezierCurve3(start, mid, end);
      world.fileCurve = fileCurve;
    }


    function spawnPacket(revNow, name, colorHex, speed) {
      var g = new THREE.Group();
      var trail = [];
      if (revNow) {
        /* a photo (image) travelling back to the computer */
        var frameMat = new THREE.MeshStandardMaterial({ color: 0xf2f0e8, roughness: 0.5, metalness: 0.05, emissive: colorHex, emissiveIntensity: 0.2 });
        put(g, new THREE.BoxGeometry(0.22, 0.004, 0.26), frameMat, 0, 0, 0);
        put(g, new THREE.BoxGeometry(0.18, 0.005, 0.22), new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.4, metalness: 0.0, emissive: colorHex, emissiveIntensity: 0.35 }), 0, 0.002, 0);
        /* small corner fold */
        put(g, new THREE.BoxGeometry(0.05, 0.006, 0.05), new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.8 }), 0.08, 0.003, -0.10);
      } else {
        /* a small document (paper) travelling through the air */
        var paperMat = new THREE.MeshStandardMaterial({ color: 0xf2f0e8, roughness: 0.7, metalness: 0.02, emissive: colorHex, emissiveIntensity: 0.18 });
        put(g, new THREE.BoxGeometry(0.20, 0.006, 0.28), paperMat, 0, 0, 0);
        put(g, new THREE.BoxGeometry(0.06, 0.007, 0.06), new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.8 }), 0.07, 0.003, -0.11);
        put(g, new THREE.BoxGeometry(0.14, 0.001, 0.014), new THREE.MeshBasicMaterial({ color: 0x9aa0a6 }), 0, 0.004, -0.06);
        put(g, new THREE.BoxGeometry(0.11, 0.001, 0.014), new THREE.MeshBasicMaterial({ color: 0x9aa0a6 }), 0, 0.004, -0.02);
        put(g, new THREE.BoxGeometry(0.13, 0.001, 0.014), new THREE.MeshBasicMaterial({ color: 0x9aa0a6 }), 0, 0.004, 0.02);
      }
      /* trail ghosts */
      for (var ti = 0; ti < 3; ti++) {
        var tg = new THREE.Group();
        var tm = new THREE.MeshStandardMaterial({ color: revNow ? colorHex : 0xf2f0e8, roughness: 0.7, metalness: 0.02, transparent: true, opacity: 0.32 - ti * 0.1, emissive: colorHex, emissiveIntensity: 0.12 });
        if (revNow) {
          put(tg, new THREE.BoxGeometry(0.22, 0.004, 0.26), tm, 0, 0, 0);
        } else {
          put(tg, new THREE.BoxGeometry(0.20, 0.006, 0.28), tm, 0, 0, 0);
        }
        tg.visible = false;
        scene.add(tg);
        trail.push(tg);
      }
      scene.add(g);
      world.packets.push({
        group: g, trail: trail, t: 0, speed: speed || (revNow ? 0.33 : 0.42),
        rev: revNow, name: name, alive: true
      });
    }

    function spawnToast(txt, endWorldPos, colorHex) {
      var sp = makeTextSprite(txt, colorHex || '#34d399', 38);
      sp.position.copy(endWorldPos);
      scene.add(sp);
      world.toasts.push({ sprite: sp, t: 0 });
    }

    /* anchors for chat bubbles:
       `you`  — an invisible spot where your half of the chat starts,
                swapped for the raised phone once you hold it up
       `bot`  — rides on the robot's antler, moves when it hops */
    var anchors = {
      you: new THREE.Object3D(),
      bot: new THREE.Object3D()
    };
    anchors.you.position.set(-1.55, 1.15, 1.55);
    anchors.bot.position.set(0.02, 0.34, 0.04);
    bot.add(anchors.bot);
    scene.add(anchors.you);

    world = {
      renderer: renderer, scene: scene, camera: camera,
      ground: ground, grid: grid, gridCalm: gridCalm, gridHot: gridHot, gridMat: grid.material,
      dustGeo: dustGeo, dustPts: dustPts, DUST: DUST, dustRnd: rndD,
      desk: desk, mon: mon, screenMesh: screenMesh, chatMesh: chatMesh, siteMesh: siteMesh, mug: mug,
      qrGroup: qrGroup, confirmRing: confirmRing,
      bot: bot, BOT_BASE_Y: BOT_BASE_Y, BOT_BASE_RY: BOT_BASE_RY, botHead: botHead, botHalo: botHalo,
      phone: phone, phoneAnchor: phoneAnchor,
      oldway: oldway, cable: cable,
      fileCurve: fileCurve, buildFileCurve: buildFileCurve, packets: [], toasts: [],
      scanCone: null, coneBuilt: false,
      spawnPacket: spawnPacket, spawnToast: spawnToast,
      anchors: anchors, QR_ANCHOR: QR_ANCHOR,
      pcGlow: pcGlow, phGlow: phGlow
    };
    return world;
  }

  /* ============================================================
     SCROLL ENGINE v2 — the film is scrubbed by page scroll.
     Everything is a pure function of film time (s), so the story
     plays forwards AND backwards perfectly while scrolling.
     ============================================================ */

  /* One continuous seated shot: CAM[i] ends exactly where CAM[i+1] begins
     (pos and lookAt chain everywhere), so the film never cuts. The viewer
     sits at the desk the whole time (~1.45–1.6m eye height); the last
     chapter dollies straight into the site on the monitor. */
  var CAM = [
    /* open — sliding into the chair, wide look at the desk */
    [[-0.55, 1.56, 4.35], [-1.15, 1.52, 3.35], [-1.55, 1.5, 0.1], [-1.95, 1.7, 0.1]],
    /* old way — settle, then let the eyes drop onto the cable tangle */
    [[-1.15, 1.52, 3.35], [-1.95, 1.5, 2.6], [-1.95, 1.7, 0.1], [-1.6, 0.95, 0.5]],
    /* power up — rise from the tangle to the terminal */
    [[-1.95, 1.5, 2.6], [-2.28, 1.56, 2.05], [-1.6, 0.95, 0.5], [-2.36, 1.68, 0.1]],
    /* just ask — hold on the screen while the QR pops */
    [[-2.28, 1.56, 2.05], [-2.3, 1.55, 2.3], [-2.36, 1.68, 0.1], [-2.34, 1.7, 0.1]],
    /* scan & pair — glance down at the raised phone */
    [[-2.3, 1.55, 2.3], [-2.18, 1.5, 2.15], [-2.34, 1.7, 0.1], [-1.98, 1.6, 0.45]],
    /* over the lan — pull back so the beam arc reads cleanly from monitor to phone */
    [[-2.18, 1.5, 2.15], [-2.32, 1.55, 2.4], [-1.98, 1.6, 0.45], [-2.05, 1.58, 0.4]],
    /* why it feels good — sit back, whole working set in frame */
    [[-2.32, 1.55, 2.4], [-2.02, 1.44, 3.5], [-2.05, 1.58, 0.4], [-2.25, 1.32, 0.2]],
    /* four steps — lean over the keyboard checklist */
    [[-2.02, 1.44, 3.5], [-2.2, 1.47, 2.6], [-2.25, 1.32, 0.2], [-2.32, 1.38, 0.35]],
    /* in your pocket — dolly straight into the site on the monitor */
    [[-2.2, 1.47, 2.6], [-2.35, 1.72, 1.42], [-2.32, 1.38, 0.35], [-2.36, 1.735, 0.08]]
  ];
  var HANDY = [0.35, 0.7, 0.55, 0.45, 0.35, 0.5, 0.4, 0.4, 0.3];
  /* world units of the set that should stay inside the frame on a portrait
     screen (the 16:9 shot cropped to a phone loses most of the room) */
  var FRAME_W = 2.5;
  var FRAME_MAX_PULL = 3.4;

  var DURS = [4.5, 8.5, 7, 10, 8, 10, 8, 7, 9];
  var TITLES = ['intro', 'the problem', 'install', 'pair', 'just ask', 'transfer', 'why qrfile', 'get started', 'download'];
  var TOTAL = 0;
  var SCENE_STARTS = DURS.map(function (d) { var s = TOTAL; TOTAL += d; return s; });

  /* captions: [t0, t1, text] in absolute film time (bottom pill) */
  var SUBS = [
    [0.5, 2.4, 'qrfile moves files between your computer and phone over your own Wi-Fi.'],
    [2.7, 4.5, 'No cable. No cloud. No accounts.'],
    [5.0, 8.1, 'the old way: dig through a drawer for the right cable, untangle it, hunt the port, plug in.'],
    [8.4, 10.2, 'Then drivers, “device not recognized”, size limits — every time.'],
    [10.5, 12.9, 'qrfile removes all of that.'],
    [13.5, 16.2, 'two installs: the APK on your phone, pip install qrfile-mcp on your computer — then add it to your agent’s MCP config.'],
    [16.4, 19.7, 'Your AI assistant gains hands — and your Wi-Fi becomes the courier.'],
    [20.1, 23.0, 'No commands. No console. You just say it:'],
    [36.6, 38.0, 'Paired. Five minutes of trust, hands-free.'],
    [38.3, 40.0, 'Already paired — files now move freely, device-to-device over your Wi-Fi.'],
    [46.0, 47.6, 'No re-pairing. No cloud copy. Just ask and it arrives.'],
    [48.4, 50.9, 'Why it feels good: no cable, no cloud copy, no login screens.'],
    [51.2, 53.4, 'A private inbox. A four-digit handshake. Nothing to manage.'],
    [53.6, 55.8, 'Any assistant that speaks MCP can play.'],
    [56.5, 58.9, 'Get started in four steps:'],
    [59.1, 61.2, 'Install the app · pip install the MCP.'],
    [61.4, 62.9, 'Scan once. Then just ask, forever.'],
    [63.4, 66.1, 'The page on that screen is real — this is the install.'],
    [66.4, 69.6, 'One card for the phone, one for the MCP server.'],
    [69.9, 71.9, 'Step in, tap, done.']
  ];

  var S1 = SCENE_STARTS[1], S2 = SCENE_STARTS[2], S3 = SCENE_STARTS[3];
  var S4 = SCENE_STARTS[4], S5 = SCENE_STARTS[5], S6 = SCENE_STARTS[6];
  var S7 = SCENE_STARTS[7], S8 = SCENE_STARTS[8];
  var T_BEAM_ON = S3 + 13.5;
  var T_BEAM_OFF = S7 + 1.5;   /* the beam keeps flying through the benefits, out by "four steps" */
  var T_FLASH = S3 + 13.15;
  var T_QR_ON = S3 + 5.0;
  var T_QR_HOLD = S5;
  var T_QR_END = S5 + 0.7;

  var beamB = 0, coneO = 0;
  var tmpV = null;
  var SV_A = new THREE.Vector3(), SV_B = new THREE.Vector3();
  var nowTZ = 0;

  /* packets: deterministic schedule, driven purely by film time */
  var PACKETS = [
    { name: 'report.pdf', rev: false, c: 0x67e8f9, t0: S5 + 0.5, dur: 2.0 },
    { name: 'notes-dev.pdf', rev: false, c: 0x67e8f9, t0: S5 + 3.0, dur: 2.0 },
    { name: 'mix-tracks.zip', rev: false, c: 0xf59e0b, t0: S5 + 5.5, dur: 2.0 },
    { name: 'telemetry.json', rev: false, c: 0x34d399, t0: S5 + 8.0, dur: 2.0 }
  ];
  var ORDERED = PACKETS.slice().sort(function (a, b) { return (a.t0 + a.dur) - (b.t0 + b.dur); });
  var ARRIVALS = PACKETS.map(function (p) { return p.t0 + p.dur; });

  function setGroupOpacity(mats, a) {
    for (var i = 0; i < mats.length; i++) mats[i].opacity = a;
  }
  function sceneIndex(t) {
    for (var i = DURS.length - 1; i >= 0; i--) if (t >= SCENE_STARTS[i]) return i;
    return 0;
  }

  /* your phone: you lift it out of your pocket — pure fn of film time */
  var PH_PARK = { x: -1.85, y: 1.42, z: 0.62, ry: 0.15, rx: -0.18, rz: 0.03 };
  var PH_FROM = { x: -1.45, y: 0.5, z: 0.95, ry: 0.4, rx: -0.65, rz: 0.2 };
  /* aiming pose while scanning the QR (tilted up toward the display) */
  var PH_SCAN = { x: -2.02, y: 1.5, z: 0.98, ry: -0.14, rx: -0.38, rz: 0.08 };
  function phoneLift(now) { return ease3(ramp(now, S3 + 5.1, S3 + 6.45)); }
  /* how "aimed at the screen" the phone is: ramps in as scanning starts,
     holds, then relaxes to the reading pose right after the pairing flash */
  function phoneAim(now) {
    if (now < S3 + 6.0) return 0;
    if (now < T_FLASH) return ease3(ramp(now, S3 + 6.0, S3 + 7.3));
    return 1 - ease3(ramp(now, T_FLASH, T_FLASH + 1.1));
  }
  function sweepVal(now) {
    if (now < S3 + 5.4) return 0;
    if (now < S3 + 8.2) return Math.abs(Math.sin((now - S3 - 5.4) * 3.1));
    return 0.06;
  }
  function digitsVal(now) { return clamp(Math.floor((now - (S3 + 8.2)) / 0.35), 0, 4); }

  function buildScanCone() {
    if (world.scanCone) { world.scene.remove(world.scanCone); world.scanCone = null; }
    var end = new THREE.Vector3();
    world.phoneAnchor.getWorldPosition(end);
    var start = world.QR_ANCHOR.clone();
    var dist = end.distanceTo(start) + 0.25;
    var geo = new THREE.ConeGeometry(0.09, dist, 14, 1, true);
    var m = new THREE.MeshBasicMaterial({
      color: 0x67e8f9, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    });
    var cone = new THREE.Mesh(geo, m);
    var dirA = end.clone().sub(start).normalize();
    cone.quaternion.setFromUnitVectors(V3(0, 1, 0), dirA);
    cone.position.copy(start).lerp(end, 0.5);
    cone.userData.end = end;
    world.scene.add(cone);
    world.scanCone = cone;
  }

  /* one-time pools: packets + toasts (hidden; driven per frame by film time) */
  var POOL = { pk: [], toast: [], built: false };
  function buildPools() {
    if (POOL.built) return;
    var i, g, m, box, lbl, sp;
    for (i = 0; i < PACKETS.length; i++) {
      g = new THREE.Group();
      var isRev = PACKETS[i].rev;
      var col = PACKETS[i].c;
      if (isRev) {
        /* a photo (image) travelling back to the computer */
        var frameMat = new THREE.MeshStandardMaterial({ color: 0xf2f0e8, roughness: 0.5, metalness: 0.05, emissive: col, emissiveIntensity: 0.2 });
        var fr = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.004, 0.26), frameMat);
        g.add(fr);
        var ph = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.005, 0.22), new THREE.MeshStandardMaterial({ color: col, roughness: 0.4, metalness: 0.0, emissive: col, emissiveIntensity: 0.35 }));
        ph.position.set(0, 0.002, 0);
        g.add(ph);
        var cf = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.006, 0.05), new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.8 }));
        cf.position.set(0.08, 0.003, -0.10);
        g.add(cf);
      } else {
        /* a small document (paper) travelling through the air */
        var paperMat2 = new THREE.MeshStandardMaterial({ color: 0xf2f0e8, roughness: 0.7, metalness: 0.02, emissive: col, emissiveIntensity: 0.18 });
        var sh = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.006, 0.28), paperMat2);
        g.add(sh);
        var fc = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.007, 0.06), new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.8 }));
        fc.position.set(0.07, 0.003, -0.11);
        g.add(fc);
        var l1 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.001, 0.014), new THREE.MeshBasicMaterial({ color: 0x9aa0a6 }));
        l1.position.set(0, 0.004, -0.06); g.add(l1);
        var l2 = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.001, 0.014), new THREE.MeshBasicMaterial({ color: 0x9aa0a6 }));
        l2.position.set(0, 0.004, -0.02); g.add(l2);
        var l3 = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.001, 0.014), new THREE.MeshBasicMaterial({ color: 0x9aa0a6 }));
        l3.position.set(0, 0.004, 0.02); g.add(l3);
      }
      /* trail ghosts */
      var tr = [];
      for (var tii = 0; tii < 3; tii++) {
        var tg = new THREE.Group();
        var tm = new THREE.MeshStandardMaterial({ color: isRev ? col : 0xf2f0e8, roughness: 0.7, metalness: 0.02, transparent: true, opacity: 0.32 - tii * 0.1, emissive: col, emissiveIntensity: 0.12 });
        if (isRev) {
          var tsh2 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.004, 0.26), tm);
          tg.add(tsh2);
        } else {
          var tsh = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.006, 0.28), tm);
          tg.add(tsh);
        }
        tg.visible = false;
        world.scene.add(tg);
        tr.push(tg);
      }
      g.userData.trail = tr;
      g.visible = false;
      world.scene.add(g);
      POOL.pk.push(g);
    }
    for (i = 0; i < PACKETS.length; i++) {
      sp = makeTextSprite(PACKETS[i].rev ? 'on the computer ✓' : 'in your inbox ✓', PACKETS[i].rev ? '#c4b5fd' : '#6ee7b7', 40);
      sp.visible = false;
      world.scene.add(sp);
      POOL.toast.push(sp);
    }
    POOL.built = true;
  }

  var phoneState = { st: 'off' };
  function syncPhone(now) {
    var st, rows = [], i, p;
    if (now < S2) st = 'off';
    else if (now < S4) st = 'app';
    else if (now < T_FLASH + 0.45) st = 'scan';
    else if (now < S8 + 0.95) {
      st = 'inbox';
      for (i = 0; i < ORDERED.length; i++) {
        p = ORDERED[i];
        if (!p.rev && now >= p.t0 + p.dur) rows.push(p.name);
      }
    }
    else st = 'sync';
    if (st !== phoneState.st) { phoneScr.set(st); phoneState.st = st; }
    phoneScr.setUi({ digits: digitsVal(now), sweep: sweepVal(now), rows: rows });
  }

  /* ============================================================
     chapter copy (DOM overlays injected into #chapterLayer)
     ============================================================ */
  function ramp(now, a, b) { return clamp((now - a) / (b - a), 0, 1); }

  var CAPS = [
    { k: 'what is qrfile', h: 'qrfile, <b>your AI’s file courier</b>',
      p: 'An MCP server + Android app that moves files between your computer and phone over your own Wi-Fi. No cable. No cloud. Scroll to explore.' },
    { k: 'the problem', h: 'cables. knots. <b>ceremony.</b>',
      p: 'Before qrfile: dig through a drawer for the right cable, untangle it, hunt the port, plug in. qrfile removes all of that.' },
    { k: 'install', h: 'give your AI <b>hands</b>',
      p: 'Two installs: the APK on your phone, and <code>pip install qrfile-mcp</code> on your computer. Then wire qrfile-mcp into your AI agent’s MCP config — and pair once. qrbot handles the rest.' },
    { k: 'pair', h: 'scan. <b>four digits.</b> paired.',
      p: 'Lift your phone, scan the QR, confirm the 4-digit code. That’s the entire security ceremony.' },
    { k: 'just ask', h: '“send it to <b>my phone</b>”',
      p: 'No commands, no console. Say it like you’d say it to a person — <code>qrbot</code> answers, opens a private lane, and a QR appears.' },
    { k: 'transfer', h: 'files fly <b>to your phone</b>',
      p: 'Once paired, files transfer freely — qrbot streams them straight to your phone over your Wi-Fi. No re-pairing, no internet round-trip, no cloud copy.' },
    { k: 'why qrfile', h: 'everything <b>stays local</b>',
      p: 'Plain-chat transfers over your own Wi-Fi. A QR + 4-digit pair that expires on its own. A private inbox, not a Downloads dump. Share mode for anything nearby. Any assistant that speaks MCP.' },
    { k: 'get started', h: 'install. pair. <b>ask.</b>',
      p: 'Grab the APK for your phone. <code>pip install qrfile-mcp</code> for the computer. Scan once — qrbot takes it from there.' },
    { k: 'download', h: 'the download lives <b>on that screen</b>',
      p: 'Everything above is the product. The page inside the film is the real install — the two cards on the screen are live. Pick one.' }
  ];

  var CH = { copies: [], ops: [] };
  function buildChapters() {
    var i, c;
    for (i = 0; i < CAPS.length; i++) {
      c = CAPS[i];
      var d = document.createElement('div');
      d.className = 'chapter-copy';
      var kk = document.createElement('div');
      kk.className = 'kicker';
      kk.textContent = c.k;
      var hh = document.createElement('h2');
      hh.innerHTML = c.h;
      var pp = document.createElement('p');
      pp.innerHTML = c.p;
      d.appendChild(kk); d.appendChild(hh); d.appendChild(pp);
      d.style.opacity = '0';
      d.style.visibility = 'hidden';
      el.layer.appendChild(d);
      CH.copies.push(d);
    }
  }

  /* chapter copy is state-driven, not film-time-driven: it fades in at real
     speed as a part starts and STAYS readable while the part plays and holds */
  function syncChapters(dtx) {
    var i, d, target, cur;
    for (i = 0; i < CAPS.length; i++) {
      d = CH.copies[i];
      target = i === playbackChapter ? 1 : 0;
      cur = CH.ops[i] || 0;
      cur += (target - cur) * Math.min(1, dtx * 5.5);
      if (Math.abs(target - cur) < 0.008) cur = target;
      CH.ops[i] = cur;
      d.style.opacity = cur.toFixed(3);
      d.style.transform = 'translateY(' + ((1 - cur) * 34).toFixed(1) + 'px)';
      d.style.visibility = cur > 0.005 ? 'visible' : 'hidden';
    }
  }

  /* ============================================================
     chapter rail (right edge dots — click scrubs scroll)
     ============================================================ */
  var railDots = [];
  function buildRail() {
    var i;
    for (i = 0; i < TITLES.length; i++) {
      (function (idx) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'rail-dot';
        b.title = TITLES[idx];
        b.setAttribute('aria-label', 'jump to chapter ' + (idx + 1) + ' — ' + TITLES[idx]);
        b.addEventListener('click', function () { scrollToChapter(idx); });
        el.rail.appendChild(b);
        railDots.push(b);
      })(i);
    }
  }
  /* the stage is 100svh tall on phones, which can differ from innerHeight
     while browser chrome slides — drive the scroll math from the stage itself */
  function stageH() { return el.player.clientHeight || window.innerHeight || 1; }
  function chapterTopFromTime(t) {
    var r = el.track.getBoundingClientRect();
    var vh = stageH();
    var span = Math.max(1, r.height - vh);
    var top = r.top + (window.pageYOffset || 0);
    return top + (clamp(t, 0, TOTAL) / TOTAL) * span;
  }
  /* every chapter change glides at the same speed and lands exactly on a
     chapter start, so a swipe feels identical each time (native smooth scroll
     varies its duration with distance and can be interrupted by momentum) */
  var GLIDE_MS = 520;
  var glideId = 0, glideRaf = 0, glideBehaviorSaved = null;
  function endGlide() {
    if (glideRaf) { cancelAnimationFrame(glideRaf); glideRaf = 0; }
    if (glideBehaviorSaved !== null) {
      document.documentElement.style.scrollBehavior = glideBehaviorSaved;
      glideBehaviorSaved = null;
    }
  }
  function cancelGlide() { glideId++; endGlide(); }
  function scrollToChapter(i) {
    railPending = i;
    var t = SCENE_STARTS[i] + (i > 0 ? 0.06 : 0);
    var target = chapterTopFromTime(t);
    var from = window.pageYOffset || 0;
    var dist = target - from;
    cancelGlide();
    if (REDUCED || Math.abs(dist) < 2) {
      window.scrollTo(0, target);
      return;
    }
    var id = glideId;
    var t0 = performance.now();
    if (glideBehaviorSaved === null) glideBehaviorSaved = document.documentElement.style.scrollBehavior || '';
    /* drive the glide ourselves — CSS smooth scrolling would fight the frames */
    document.documentElement.style.scrollBehavior = 'auto';
    var frame = function (ts) {
      if (id !== glideId) return;
      var u = clamp((ts - t0) / GLIDE_MS, 0, 1);
      var e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      window.scrollTo(0, from + dist * e);
      if (u < 1) {
        glideRaf = requestAnimationFrame(frame);
      } else {
        glideRaf = 0;
        endGlide();
      }
    };
    glideRaf = requestAnimationFrame(frame);
  }
  /* move exactly one chapter from wherever the film is (or is heading) */
  function stepChapter(dir) {
    var from = (railPending !== null) ? railPending : sceneIndex(filmPos());
    var to = clamp(from + dir, 0, TITLES.length - 1);
    if (to === from) return false;
    scrollToChapter(to);
    return true;
  }
  /* chapter the smooth glide is heading toward, if any */
  var railPending = null;
  /* film-time position implied by the current scroll offset (0…TOTAL) */
  function filmPos() {
    var r = el.track.getBoundingClientRect();
    var vh = stageH();
    return clamp(-r.top / Math.max(1, r.height - vh), 0, 1) * TOTAL;
  }
  /* true while the film is covering the middle of the viewport */
  function filmCovers() {
    var r = el.track.getBoundingClientRect();
    var vh = stageH();
    return r.top <= vh * 0.5 && r.bottom >= vh * 0.5;
  }
  function syncRail() {
    var idx = sceneIndex(state.t);
    for (var i = 0; i < railDots.length; i++) railDots[i].classList.toggle('active', i === idx);
  }

  /* ============================================================
     chat bubbles — the conversation lives INSIDE the chat screen on
     the monitor (chatScr above); no floating DOM bubbles anymore
     ============================================================ */

  /* subtitle pill — bottom caption strip */
  var lastSub = '';
  function syncSubtitle(now) {
    if (!el.subtitle) return;
    var txt = '';
    for (var i = 0; i < SUBS.length; i++) {
      if (now >= SUBS[i][0] && now <= SUBS[i][1]) { txt = SUBS[i][2]; break; }
    }
    if (txt !== lastSub) {
      lastSub = txt;
      el.subtitle.textContent = txt;
      el.subtitle.style.opacity = txt ? '1' : '0';
    }
  }

  /* ============================================================
     packet + toast pools (built once, positioned purely by time)
     ============================================================ */
  function syncPackets(now) {
    var i, u, pk, uu, pos, sc, tr, tj, tpos;
    for (i = 0; i < PACKETS.length; i++) {
      pk = POOL.pk[i];
      u = (now - PACKETS[i].t0) / PACKETS[i].dur;
      if (u <= 0 || u >= 1 || !world.fileCurve) { pk.visible = false; if (pk.userData && pk.userData.trail) for (tj=0;tj<pk.userData.trail.length;tj++) pk.userData.trail[tj].visible=false; continue; }
      uu = clamp(u, 0, 1);
      uu = easeInOut(uu);
      pos = world.fileCurve.getPoint(PACKETS[i].rev ? 1 - uu : uu);
      pk.position.copy(pos);
      /* launch from the monitor: scale up as it leaves the screen */
      sc = uu < 0.12 ? ease3(uu / 0.12) : (uu > 0.88 ? ease3((1 - uu) / 0.12) : 1);
      sc *= 1 + 0.06 * Math.sin(now * 9 + i * 1.7);
      pk.scale.setScalar(Math.max(0.05, sc));
      pk.visible = sc > 0.04;
      /* orient the paper along the path */
      var tangent = world.fileCurve.getTangent(PACKETS[i].rev ? 1 - uu : uu);
      if (PACKETS[i].rev) tangent.negate();
      pk.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent.normalize());
      /* trail ghosts */
      tr = pk.userData.trail;
      if (tr) {
        for (tj = 0; tj < tr.length; tj++) {
          var tuu = clamp(uu - (tj + 1) * 0.06, 0, 1);
          if (tuu <= 0 || tuu >= 1) { tr[tj].visible = false; continue; }
          tpos = world.fileCurve.getPoint(PACKETS[i].rev ? 1 - tuu : tuu);
          tr[tj].position.copy(tpos);
          tr[tj].quaternion.copy(pk.quaternion);
          tr[tj].scale.copy(pk.scale).multiplyScalar(0.92 - tj * 0.08);
          tr[tj].visible = pk.visible;
        }
      }
    }
  }
  function syncToasts(now) { return; }

  /* ============================================================
     the world — every visual is a pure function of film time,
     so the story scrubs forward AND backward while scrolling
     ============================================================ */
  var prevNow = -1;

  function syncWorld(now, dt) {
    var i;

    /* grid pulse exactly when a packet arrives */
    for (i = 0; i < ARRIVALS.length; i++) {
      if (prevNow < ARRIVALS[i] && now >= ARRIVALS[i]) FX.gridPulse = 1;
    }

    /* ---- ch2 · the old way (props fade in, sticky labels beat along) ---- */
    var oldOp = ramp(now, S1 - 0.35, S1 + 1.5) * (1 - ramp(now, S2 + 0.35, S2 + 2.0));
    world.oldway.group.visible = oldOp > 0.02;
    if (world.oldway.group.visible) setGroupOpacity(world.oldway.mats, oldOp * 0.96);
    /* sticky notes follow the caption beats, on top of the chapter fade */
    for (i = 0; i < world.oldway.labels.length; i++) {
      var lb = world.oldway.labels[i];
      lb.mat.opacity = oldOp * 0.96 * ramp(now, lb.t0, lb.t0 + 0.6) * (1 - ramp(now, lb.t1 - 0.5, lb.t1));
    }

    /* ---- ch3 on · the qrbot avatar stands up next to the monitor ---- */
    var botScale = easeOutBack(ramp(now, S2 + 0.1, S2 + 1.05));
    world.bot.visible = botScale > 0.001;
    if (world.bot.visible) {
      /* is a document currently in flight? */
      var sending = false;
      for (var _pi = 0; _pi < PACKETS.length; _pi++) {
        var _u = (now - PACKETS[_pi].t0) / PACKETS[_pi].dur;
        if (_u > 0.05 && _u < 0.95) { sending = true; break; }
      }
      /* a friendly hop when pairing lands */
      var hopT = (now - T_FLASH) / 1.25;
      var hop = hopT > 0 && hopT < 3 ? Math.abs(Math.sin(hopT * Math.PI * 2.2)) * Math.exp(-hopT * 2.1) * 0.14 : 0;
      world.bot.scale.setScalar(Math.max(0.001, botScale));
      world.bot.position.y = world.BOT_BASE_Y + hop + (sending ? 0.012 * Math.sin(now * 12) : 0.008 * Math.sin(now * 2.4 + 0.7));
      world.botHalo.material.opacity = (sending ? 0.6 : 0.4) * botScale;
      /* the little body turns toward your phone while you aim it at the QR */
      var bAim = phoneAim(now);
      var bRy = world.BOT_BASE_RY;
      if (bAim > 0.001) {
        world.phoneAnchor.getWorldPosition(SV_A);
        bRy = world.BOT_BASE_RY + clamp(Math.atan2(SV_A.x - world.bot.position.x, SV_A.z - world.bot.position.z) - world.BOT_BASE_RY, -0.6, 0.6) * 0.85 * bAim;
      }
      world.bot.rotation.y = bRy;
      world.botHead.rotation.x = (sending ? -0.12 : -0.04 * bAim);
      /* deterministic blink */
      var eyeOpen = (now * 0.187) % 1 < 0.035 ? 0.12 : 1;
      world.botHead.children[2].scale.y = eyeOpen;
      world.botHead.children[3].scale.y = eyeOpen;
    }

    /* ---- last chapter · the site fades in inside the monitor ---- */
    var siteIn = ease3(ramp(now, S8 + 0.35, S8 + 1.7));
    world.siteMesh.material.opacity = siteIn;
    world.siteMesh.visible = siteIn > 0.01;

    /* ---- ch4 on · the qrbot chat panel fades in over the terminal ---- */
    var chatIn = ease3(ramp(now, S3 - 0.6, S3 + 0.4));
    world.chatMesh.material.opacity = chatIn;
    world.chatMesh.visible = chatIn > 0.01;

    /* ---- pairing scan sweep + confirm ring now render inside the chat
       card (canvas); the 3D group only carries the ring below ---- */

    /* ---- scan cone (built lazily from the raised-phone anchor) ---- */
    var coneOn = now > S3 + 5.45 && now < S3 + 10.3;
    if (coneOn && !world.scanCone) buildScanCone();
    if (world.scanCone) {
      var coneTarget = 0.3 * ramp(now, S3 + 6.7, S3 + 7.05) * (1 - ramp(now, S3 + 9.9, S3 + 10.12)) * (0.88 + 0.12 * Math.sin(now * 8.3));
      coneO = lerp(coneO, coneTarget, Math.min(1, dt * 5));
      world.scanCone.material.opacity = coneO;
      world.scanCone.visible = coneO > 0.02;
      /* keep the beam glued to the phone as it aims at the QR */
      world.phoneAnchor.getWorldPosition(SV_A);
      SV_B.copy(SV_A).sub(world.QR_ANCHOR).normalize();
      world.scanCone.quaternion.setFromUnitVectors(V3(0, 1, 0), SV_B);
      world.scanCone.position.copy(world.QR_ANCHOR).lerp(SV_A, 0.5);
    } else {
      coneO = 0;
    }

    /* ---- pairing flash + expanding confirm ring ---- */
    var f = now < T_FLASH ? 0 : Math.max(0, 1 - (now - T_FLASH) / 0.55);
    el.flash.style.opacity = f.toFixed(3);
    var rt = clamp((now - T_FLASH) / 0.62, 0, 1);
    if (rt > 0.001 && rt < 0.999) {
      world.confirmRing.visible = true;
      var rr = 1 + rt * 0.9;
      world.confirmRing.scale.set(rr, rr, rr);
      world.confirmRing.material.opacity = (1 - rt) * 0.9;
    } else {
      world.confirmRing.visible = false;
    }

    /* ---- file curve (built once, when the transfer starts) ---- */
    var beamOn = now >= T_BEAM_ON && now < T_BEAM_OFF;
    if (beamOn && !world.fileCurve) world.buildFileCurve();

    syncPackets(now);
    syncPhone(now);
  }

  /* ============================================================
     camera — per-chapter keyframes + handheld drift + mouse parallax
     ============================================================ */
  function updateCamera(time, now) {
    var idx = sceneIndex(now);
    var dur = DURS[idx];
    var st = clamp(now - SCENE_STARTS[idx], 0, dur);
    var ck = CAM[idx];
    var e = easeInOut(clamp(st / Math.max(0.01, dur), 0, 1));
    var a = REDUCED ? 0 : HANDY[idx];
    var mx = 0;
    var my = 0;
    var px = lerp(ck[0][0], ck[1][0], e) + Math.sin(time * 0.5) * 0.055 * a + mx;
    var py = lerp(ck[0][1], ck[1][1], e) + Math.sin(time * 0.42 + 1.2) * 0.04 * a + my;
    var pz = lerp(ck[0][2], ck[1][2], e);
    var tx = lerp(ck[2][0], ck[3][0], e) + Math.sin(time * 0.55) * 0.06 * a - mx * 0.6;
    var ty = lerp(ck[2][1], ck[3][1], e) + Math.sin(time * 0.47 + 0.8) * 0.035 * a - my * 0.6;
    var tz = lerp(ck[2][2], ck[3][2], e);

    /* portrait screens: back the seat off along the same line of sight until
       the monitor + phone still fit across the frame instead of being cropped */
    var asp = world.camera.aspect || 1;
    var portrait = clamp((1.12 - asp) / 0.34, 0, 1);
    if (portrait > 0.001) {
      var dx = px - tx, dy = py - ty, dz = pz - tz;
      var d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;
      var want = FRAME_W / (2 * Math.tan(world.camera.fov * Math.PI / 360) * Math.max(0.2, asp));
      var k = 1 + (clamp(want / d, 1, FRAME_MAX_PULL) - 1) * portrait;
      px = tx + dx * k;
      py = ty + dy * k;
      pz = tz + dz * k;
    }

    world.camera.position.set(px, py, pz);
    world.camera.lookAt(tx, ty, tz);
  }

  /* ============================================================
     final chapter — project two clickable cards onto the site that
     lives inside the monitor, so the film itself is the install page
     ============================================================ */
  var SPOTS = [
    { el: null, u: 132 / 512, v: 170 / 300 },  /* card 1 · android app */
    { el: null, u: 378 / 512, v: 170 / 300 }   /* card 2 · mcp server */
  ];
  function syncHotspots(now) {
    var i, s, op, hit, compact;
    if (!SPOTS[0].el) { SPOTS[0].el = el.spotApk; SPOTS[1].el = el.spotPip; }
    world.camera.updateMatrix();
    world.camera.updateMatrixWorld();
    op = ease3(ramp(now, S8 + 6.0, S8 + 7.0));
    compact = el.player.classList.contains('compact');
    for (i = 0; i < SPOTS.length; i++) {
      s = SPOTS[i];
      if (!s.el) continue;
      if (compact) {
        /* phones: the cards are docked by CSS above each other — the 3D screen
           is far too small to aim at, and projecting would pin them to the edges */
        s.el.style.left = '';
        s.el.style.top = '';
      } else if (op > 0.005 && tmpV) {
        /* canvas-pixel card centre → plane-local → world → screen % */
        tmpV.set((s.u - 0.5) * 1.86, (0.5 - s.v) * 1.02, 0.02);
        world.siteMesh.localToWorld(tmpV);
        tmpV.project(world.camera);
        s.el.style.left = clamp((tmpV.x * 0.5 + 0.5) * 100, 6, 94).toFixed(2) + '%';
        s.el.style.top = clamp((-tmpV.y * 0.5 + 0.5) * 100, 8, 92).toFixed(2) + '%';
      }
      /* hide entirely once faded out so it can't block the view */
      s.el.style.display = op <= 0.005 ? 'none' : '';
      s.el.style.opacity = op.toFixed(3);
      hit = op > 0.6;
      if (hit !== (s.el.classList.contains('on'))) s.el.classList.toggle('on', hit);
      s.el.style.pointerEvents = hit ? 'auto' : 'none';
    }
  }

  /* the 4 documents' send/ack exchange also lives in the chat screen rows
     (see CHAT) — nothing floats in the air anymore */

  var clock = new THREE.Clock();

  function tick() {
    try {
    requestAnimationFrame(tick);
    if (!world) return;
    var dt = Math.min(clock.getDelta(), 0.05);
    var time = clock.elapsedTime;

    /* scroll selects the chapter; the animation then plays out at real time */
    var r = el.track.getBoundingClientRect();
    var vh = stageH();
    var span = Math.max(1, r.height - vh);
    var p = clamp(-r.top / span, 0, 1);
    var targetChapter = sceneIndex(p * TOTAL);
    var chapterEntered = (playbackChapter === null || targetChapter !== playbackChapter);
    var replayAsked = (replayRequestSeq > lastReplaySeq);
    if (chapterEntered) {
      /* crossing into a chapter plays it from its start — pending replays are void */
      entryMeter++;
      playbackChapter = targetChapter;
      lastReplaySeq = replayRequestSeq;
    } else if (replayAsked) {
      /* a scroll burst that stayed inside this chapter replays it once */
      lastReplaySeq = replayRequestSeq;
    }
    if (chapterEntered || replayAsked) playbackT = SCENE_STARTS[playbackChapter];
    var chapterEnd = (playbackChapter < DURS.length - 1) ? SCENE_STARTS[playbackChapter + 1] : TOTAL;
    playbackT = Math.min(chapterEnd, playbackT + dt * (REDUCED ? 3 : 5));
    state.t = playbackT;
    state.mx += (state.tmx - state.mx) * Math.min(1, dt * 3);
    state.my += (state.tmy - state.my) * Math.min(1, dt * 3);
    var now = state.t;

    /* your phone rises into the frame — lifts, aims at the QR while scanning,
       then settles back once paired; everything stays hand-held */
    var lift = phoneLift(now);
    var aim = phoneAim(now);
    world.phone.visible = lift > 0.001;
    if (world.phone.visible) {
      /* park pose blended toward the aiming pose */
      var px = lerp(PH_PARK.x, PH_SCAN.x, aim);
      var py = lerp(PH_PARK.y, PH_SCAN.y, aim);
      var pz = lerp(PH_PARK.z, PH_SCAN.z, aim);
      var pry = lerp(PH_PARK.ry, PH_SCAN.ry, aim);
      var prx = lerp(PH_PARK.rx, PH_SCAN.rx, aim);
      var prz = lerp(PH_PARK.rz, PH_SCAN.rz, aim);
      /* hand-held micro-drift: slow bob + faster shake, stronger while aiming */
      var w1 = Math.sin(time * 2.1), w2 = Math.sin(time * 1.35 + 1.3), w3 = Math.sin(time * 0.8 + 2.4);
      var shake = 0.35 + 0.65 * aim;
      world.phone.position.set(
        lerp(PH_FROM.x, px, lift) + shake * (0.012 * w1 + 0.007 * w3),
        lerp(PH_FROM.y, py, lift) + shake * (0.010 * w2 + 0.005 * w1) + 0.02 * Math.sin(now * 1.5),
        lerp(PH_FROM.z, pz, lift) + shake * 0.008 * w2
      );
      world.phone.rotation.set(
        lerp(PH_FROM.rx, prx, lift) + shake * 0.018 * w2,
        lerp(PH_FROM.ry, pry, lift) + shake * 0.022 * w1,
        lerp(0.16, prz, lift) + shake * (0.016 * w3 + 0.010 * w1)
      );
      /* set the phone down as the film zooms into the install page */
      var parkDrop = ease3(ramp(now, S8 + 1.5, S8 + 2.7));
      if (parkDrop > 0) {
        world.phone.position.y -= 0.34 * parkDrop;
        world.phone.rotation.x -= 1.35 * parkDrop;
        world.phone.rotation.y += 0.22 * parkDrop;
      }
    }

    /* live canvases (pure + blink) */
    term.tick(time);
    phoneScr.drawIfChanged(time);
    siteScr.drawIfChanged(time);
    chatScr.drawIfChanged(time);

    /* film time → world */
    syncWorld(now, dt);

    /* ambient motion (real clock: dust, glows) */
    var arr = world.dustGeo.attributes.position.array;
    for (var j = 0; j < world.DUST; j++) {
      arr[j * 3 + 1] += dt * (0.10 + (j % 7) * 0.012);
      if (arr[j * 3 + 1] > 7.2) arr[j * 3 + 1] = 0.2;
    }
    world.dustGeo.attributes.position.needsUpdate = true;

    FX.gridPulse = Math.max(0, FX.gridPulse - dt * 1.5);
    world.gridMat.opacity = 0.3 + 0.5 * FX.gridPulse;

    world.pcGlow.intensity = 0.5 + 0.15 * Math.sin(time * 2.1);
    world.phGlow.intensity = 0.38 + 0.12 * Math.sin(time * 1.7 + 2);

    updateCamera(time, now);

    /* matrices must be current for DOM projections (hotspots, bubbles) */
    world.scene.updateMatrixWorld();
    world.camera.updateMatrix();
    world.camera.updateMatrixWorld();
    world.renderer.render(world.scene, world.camera);

    /* DOM syncs */
    syncChapters(dt);
    syncRail();
    syncHotspots(now);
    el.hint.style.opacity = (p > 0.03) ? '0' : '1';

    world.renderer.render(world.scene, world.camera);
    prevNow = now;
    } catch (e) {
      console.error(e);
    }
  }

  /* ============================================================
     page wiring
     ============================================================ */
  function wireEvents() {
    window.addEventListener('resize', resize);
    /* mobile browsers report the new size a beat after rotating */
    window.addEventListener('orientationchange', function () { setTimeout(resize, 260); });
    /* one replay per scroll burst: a burst that ends in the chapter it
       started in replays that chapter once; a burst that crosses into a
       new chapter is handled by the chapter-change reset instead */
    var scrollTimer = null;
    var burstChapter = null;
    var burstEntryIdSafe = 0;
    window.addEventListener('scroll', function () {
      if (scrollTimer === null) {
        burstChapter = sceneIndex(filmPos());
        burstEntryIdSafe = entryMeter;
      }
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(function () {
        scrollTimer = null;
        railPending = null;
        var f = sceneIndex(filmPos());
        /* replay only if the burst never caused a chapter entry (those already
           play via entry) AND it ended in the chapter it started in */
        var mayReplay = (burstChapter !== null && f === burstChapter && entryMeter === burstEntryIdSafe);
        /* at most one pending replay: a splattered gesture can't stack restarts */
        if (mayReplay && replayRequestSeq === lastReplaySeq) replayRequestSeq++;
        burstChapter = null;
      }, 250);
    }, { passive: true });
    /* one wheel gesture = step one chapter forward/back while the film fills
       the screen; momentum tails are swallowed, and at either end of the film
       the wheel falls through to native scrolling so the page can move on */
    var wheelLastAt = 0, wheelAccum = 0, gestureStepped = false, wheelLockUntil = 0;
    window.addEventListener('wheel', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!filmCovers()) return;
      var t = performance.now();
      if (t < wheelLockUntil) { e.preventDefault(); return; }  /* rest of this gesture's momentum */
      var unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? window.innerHeight || 550 : 1;
      var dy = e.deltaY * unit, dx = e.deltaX * unit;
      if (!dx && !dy) return;
      if (Math.abs(dx) > Math.abs(dy) + 1) return;  /* horizontal pan */
      if (t - wheelLastAt > 160) { wheelAccum = 0; gestureStepped = false; }
      wheelLastAt = t;
      if (gestureStepped) { e.preventDefault(); return; }
      wheelAccum += dy;
      if (Math.abs(wheelAccum) < 50) { e.preventDefault(); return; }
      var dir = wheelAccum > 0 ? 1 : -1;
      if (stepChapter(dir)) {
        gestureStepped = true;
        wheelLockUntil = t + 350;
        e.preventDefault();
      }
      /* else: at an end of the story — let native scrolling move the page */
    }, { passive: false });
    /* one swipe = one chapter: the film owns vertical drags while it fills the
       screen, so a flick can never skip a chapter or freeze mid-transition —
       every gesture steps once and the glide lands on a chapter start */
    var touchLive = false, touchStepped = false, touchY0 = 0, touchX0 = 0;
    window.addEventListener('touchstart', function (e) {
      touchLive = false;
      touchStepped = false;
      if (e.touches.length !== 1 || !filmCovers()) return;
      touchLive = true;
      touchY0 = e.touches[0].clientY;
      touchX0 = e.touches[0].clientX;
    }, { passive: true });
    window.addEventListener('touchmove', function (e) {
      if (!touchLive) return;
      if (e.touches.length !== 1) { touchLive = false; return; }
      var dy = touchY0 - e.touches[0].clientY;
      var dx = touchX0 - e.touches[0].clientX;
      /* a sideways drag belongs to the browser (back-swipe etc.), not the film */
      if (!touchStepped && Math.abs(dx) > 18 && Math.abs(dx) > Math.abs(dy)) { touchLive = false; return; }
      if (Math.abs(dx) > Math.abs(dy)) return;
      /* own the drag from its first pixel, or native scrolling latches on and
         keeps drifting underneath the glide */
      e.preventDefault();
      if (!touchStepped && Math.abs(dy) >= 30) {
        touchStepped = true;
        stepChapter(dy > 0 ? 1 : -1);
      }
    }, { passive: false });
    function endTouch() { touchLive = false; }
    window.addEventListener('touchend', endTouch, { passive: true });
    window.addEventListener('touchcancel', endTouch, { passive: true });
    document.addEventListener('keydown', function (e) {
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'r' && e.key !== 'R') return;
      /* arrows only hijack keys while the story is filling the screen */
      if (!filmCovers()) return;
      /* base on the scroll position's chapter, not the playback clock (which
         sits at the NEXT chapter's start while a part is holding) */
      var idx = sceneIndex(filmPos());
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        scrollToChapter(Math.min(idx + 1, TITLES.length - 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        scrollToChapter(Math.max(idx - 1, 0));
      } else {
        window.scrollTo({ top: 0, behavior: REDUCED ? 'auto' : 'smooth' });
      }
    });
  }

  function narrowUI() {
    return window.innerWidth <= 720 && window.innerHeight >= window.innerWidth;
  }

  function resize() {
    if (!world) return;
    var w = el.player.clientWidth || window.innerWidth || 16;
    var h = el.player.clientHeight || window.innerHeight || 9;
    /* phones: cap the render scale a little lower to keep the film smooth */
    world.renderer.setPixelRatio(clamp(window.devicePixelRatio || 1, 1, w <= 720 ? 1.5 : 1.75));
    world.renderer.setSize(w, h, false);
    var a = w / Math.max(1, h);
    world.camera.aspect = a;
    /* widen the lens gradually as the frame gets taller instead of cropping */
    var base = world.baseFov || 42;
    world.camera.fov = clamp(base + (1 - a) * 26, base, 58);
    world.camera.updateProjectionMatrix();
    el.player.classList.toggle('compact', narrowUI());
  }

  function failFallback() {
    el.player.innerHTML =
      '<div class="fallback-card">' +
      '<div class="fs-h">the 3D story couldn’t start here</div>' +
      '<p>Your browser blocked WebGL, so the story can’t render. qrfile itself doesn’t need it:</p>' +
      '<div class="fs-row">' +
      '<a class="btn btn-primary" href="https://hkturtco.github.io/app-debug.apk" download>⬇&nbsp; Android app</a>' +
      '<a class="btn btn-secondary" href="https://pypi.org/project/qrfile-mcp" target="_blank" rel="noopener">pip install qrfile-mcp</a>' +
      '</div></div>';
  }

  function init() {
    var ok = buildWorld();
    if (!ok) { failFallback(); return; }
    world.baseFov = world.camera.fov;
    tmpV = new THREE.Vector3();
    REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    buildPools();
    buildChapters();
    buildRail();
    wireEvents();
    resize();
    /* start wherever the page already is (e.g. reload mid-story) */
    var r = el.track.getBoundingClientRect();
    var vh = stageH();
    var startP = clamp(-r.top / Math.max(1, r.height - vh), 0, 1);
    playbackChapter = sceneIndex(startP * TOTAL);
    playbackT = SCENE_STARTS[playbackChapter];
    state.t = playbackT;
    prevNow = state.t;
    requestAnimationFrame(tick);
  }

  try { init(); } catch (err) { console.error(err); failFallback(); }

})();
