/* ============================================================
   demos-texsample.js — 텍스처 읽기 함수 비교 (Load · Sample 계열)
   2D 해부(CPU): 텍셀 해부 · 픽셀 발자국/LOD · 데이터 텍스처 · Gather
   3D 실시간(WebGL2): 바닥 A/B 분할 비교 · SampleCmp 그림자 PCF 분할 비교
   전역 GFX (lib.js) 사용. 등록은 GFX.deferInit 로만 한다.
   ============================================================ */
(function () {
  "use strict";

  const { COL, clamp, lerp } = GFX;

  GFX.deferInit("c-ts-anatomy", initAnatomy);
  GFX.deferInit("c-ts-footprint", initFootprint);
  GFX.deferInit("c-ts-floor", initFloor);
  GFX.deferInit("c-ts-data", initData);
  GFX.deferInit("c-ts-gather", initGather);
  GFX.deferInit("c-ts-shadow", initShadow);

  // ---- 공통 헬퍼 --------------------------------------------
  const ORANGE = "#ffb454";
  const MONO = "12px 'JetBrains Mono', monospace";
  const MONO_B = "bold 13px 'JetBrains Mono', monospace";
  const SANS_B = "bold 14px sans-serif";

  function hsv2rgb(h, s, v) {
    h = ((h % 360) + 360) % 360;
    const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return [r + m, g + m, b + m];
  }
  const css = (c, a) => `rgba(${Math.round(clamp(c[0], 0, 1) * 255)},${Math.round(clamp(c[1], 0, 1) * 255)},${Math.round(clamp(c[2], 0, 1) * 255)},${a == null ? 1 : a})`;
  const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const fx3 = (v) => (+v).toFixed(3);

  // 버튼 묶음(세그먼트). 선택된 버튼만 채움, 나머지는 ghost.
  function seg(ctl, label, items, cur, onPick, full) {
    const wrap = document.createElement("div");
    wrap.className = "control";
    wrap.style.minWidth = "auto";
    if (full) wrap.style.flex = "1 0 100%";
    const lab = document.createElement("label");
    const sp = document.createElement("span");
    sp.textContent = label;
    lab.appendChild(sp);
    wrap.appendChild(lab);
    const row = document.createElement("div");
    row.style.cssText = "display:flex;flex-wrap:wrap;gap:6px";
    const btns = items.map((it, i) => {
      const b = document.createElement("button");
      b.textContent = it;
      b.style.cssText = "padding:5px 10px;font-size:12px";
      b.addEventListener("click", () => { set(i); onPick(i); });
      row.appendChild(b);
      return b;
    });
    function set(i) { btns.forEach((b, j) => { b.className = j === i ? "" : "ghost"; }); }
    set(cur);
    wrap.appendChild(row);
    ctl.appendChild(wrap);
    return { set };
  }

  // 캔버스 위 드래그(마우스·터치). cb(x, y, phase) — phase: down|move|up
  function onDrag(canvas, cb) {
    let down = false;
    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      return [t.clientX - r.left, t.clientY - r.top];
    };
    canvas.addEventListener("mousedown", (e) => { down = true; const p = pos(e); cb(p[0], p[1], "down"); });
    window.addEventListener("mousemove", (e) => { if (down) { const p = pos(e); cb(p[0], p[1], "move"); } });
    window.addEventListener("mouseup", () => { if (down) { down = false; cb(0, 0, "up"); } });
    canvas.addEventListener("touchstart", (e) => { down = true; const p = pos(e); cb(p[0], p[1], "down"); e.preventDefault(); }, { passive: false });
    canvas.addEventListener("touchmove", (e) => { if (down) { const p = pos(e); cb(p[0], p[1], "move"); e.preventDefault(); } }, { passive: false });
    window.addEventListener("touchend", () => { if (down) { down = false; cb(0, 0, "up"); } });
  }

  function swatch(ctx, x, y, s, c, label) {
    ctx.fillStyle = css(c);
    ctx.fillRect(x, y, s, s);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
    if (label) GFX.text(ctx, label, x + s + 10, y + s / 2, COL.dim, MONO);
  }

  // 주소 모드: 0 Wrap · 1 Mirror · 2 Clamp · 3 Border(-1 반환)
  function addr(i, n, mode) {
    if (mode === 0) return ((i % n) + n) % n;
    if (mode === 1) { const p = 2 * n, m = ((i % p) + p) % p; return m < n ? m : p - 1 - m; }
    if (mode === 2) return clamp(i, 0, n - 1);
    return (i < 0 || i >= n) ? -1 : i;
  }

  // 텍스처: {w, h, d: Float32Array(w*h*4)}
  function texel(t, x, y, mode) {
    const ix = addr(x, t.w, mode), iy = addr(y, t.h, mode);
    if (ix < 0 || iy < 0) return [0, 0, 0, 0];   // Border 색 = 0
    const k = (iy * t.w + ix) * 4;
    return [t.d[k], t.d[k + 1], t.d[k + 2], t.d[k + 3]];
  }
  // HLSL Load: 범위 밖은 0 (D3D10+ 정의된 동작)
  function loadTexel(t, x, y) {
    if (x < 0 || y < 0 || x >= t.w || y >= t.h) return [0, 0, 0, 0];
    const k = (y * t.w + x) * 4;
    return [t.d[k], t.d[k + 1], t.d[k + 2], t.d[k + 3]];
  }
  // 하드웨어 bilinear와 같은 규칙: 텍셀 중심 = (i+0.5)/W
  function bilinear(t, u, v, mode) {
    const x = u * t.w - 0.5, y = v * t.h - 0.5;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const a = texel(t, x0, y0, mode), b = texel(t, x0 + 1, y0, mode);
    const c = texel(t, x0, y0 + 1, mode), d = texel(t, x0 + 1, y0 + 1, mode);
    const o = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) o[i] = lerp(lerp(a[i], b[i], fx), lerp(c[i], d[i], fx), fy);
    return o;
  }
  function pointSample(t, u, v, mode) {
    return texel(t, Math.floor(u * t.w), Math.floor(v * t.h), mode);
  }

  function makeTex(kind, N) {
    const t = { w: N, h: N, d: new Float32Array(N * N * 4) };
    const seeds = [[0.2, 0.25], [0.78, 0.2], [0.28, 0.82], [0.82, 0.72], [0.52, 0.5]];
    const pal = [[0.95, 0.35, 0.35], [0.35, 0.8, 0.45], [0.35, 0.55, 1.0], [1.0, 0.82, 0.3], [0.8, 0.45, 0.95]];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let c;
      if (kind === 0) {
        c = hsv2rgb(200 + ((x + y * 0.6) / N) * 260, 0.62, ((x + y) & 1) ? 0.95 : 0.42);
      } else if (kind === 1) {
        c = [x / (N - 1), y / (N - 1), 0.75 - 0.5 * x / (N - 1)];
      } else {
        const u = (x + 0.5) / N, v = (y + 0.5) / N;
        let best = 0, bd = 9;
        seeds.forEach((s, i) => { const dd = Math.hypot(u - s[0], v - s[1]); if (dd < bd) { bd = dd; best = i; } });
        c = pal[best];
      }
      const k = (y * N + x) * 4;
      t.d[k] = c[0]; t.d[k + 1] = c[1]; t.d[k + 2] = c[2]; t.d[k + 3] = 1;
    }
    return t;
  }

  // ==========================================================
  // 1) Load vs Sample — 텍셀 해부 (2D)
  // ==========================================================
  function initAnatomy() {
    if (!document.getElementById("c-ts-anatomy")) return;
    const S = GFX.setup("c-ts-anatomy");
    const ctl = document.getElementById("ctl-ts-anatomy");
    const U0 = -0.25, SPAN = 1.5;
    let kind = 0, filt = 1, mode = 0, N = 8, pu = 0.43, pv = 0.38;
    let tex = makeTex(kind, N);
    const bg = document.createElement("canvas");
    let bgKey = "";
    let L = 300, ox = 18, oy = 10;

    function layout() {
      L = Math.max(160, Math.min(S.h - 36, S.w * 0.5));
      ox = 18; oy = (S.h - L) / 2;
    }
    const toPx = (u) => ox + ((u - U0) / SPAN) * L;
    const toPy = (v) => oy + ((v - U0) / SPAN) * L;

    function buildBg() {
      const R = Math.round(Math.min(L, 520));
      const key = [R, kind, filt, mode, N].join(",");
      if (key === bgKey) return;
      bgKey = key;
      bg.width = R; bg.height = R;
      const bx = bg.getContext("2d"), img = bx.createImageData(R, R), d = img.data;
      for (let py = 0; py < R; py++) for (let px = 0; px < R; px++) {
        const u = U0 + ((px + 0.5) / R) * SPAN, v = U0 + ((py + 0.5) / R) * SPAN;
        const c = filt === 0 ? pointSample(tex, u, v, mode) : bilinear(tex, u, v, mode);
        const k = (py * R + px) * 4;
        d[k] = c[0] * 255; d[k + 1] = c[1] * 255; d[k + 2] = c[2] * 255; d[k + 3] = 255;
      }
      bx.putImageData(img, 0, 0);
    }

    function draw() {
      layout();
      buildBg();
      const ctx = S.ctx, w = S.w, h = S.h;
      GFX.clear(ctx, w, h);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bg, ox, oy, L, L);
      // 0..1 바깥(주소 모드 영역)은 어둡게
      const a0 = toPx(0), a1 = toPx(1), b0 = toPy(0), b1 = toPy(1);
      ctx.fillStyle = "rgba(8,8,12,0.5)";
      ctx.fillRect(ox, oy, L, b0 - oy);
      ctx.fillRect(ox, b1, L, oy + L - b1);
      ctx.fillRect(ox, b0, a0 - ox, b1 - b0);
      ctx.fillRect(a1, b0, ox + L - a1, b1 - b0);
      // 텍셀 격자
      ctx.lineWidth = 1;
      for (let i = Math.ceil(U0 * N); i <= Math.floor((U0 + SPAN) * N); i++) {
        const inside = i >= 0 && i <= N;
        ctx.strokeStyle = inside ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.09)";
        const x = toPx(i / N), y = toPy(i / N);
        ctx.beginPath(); ctx.moveTo(x, oy); ctx.lineTo(x, oy + L); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ox, y); ctx.lineTo(ox + L, y); ctx.stroke();
      }
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 2;
      ctx.strokeRect(a0, b0, a1 - a0, b1 - b0);
      // 텍셀 중심 점
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        ctx.beginPath(); ctx.arc(toPx((x + 0.5) / N), toPy((y + 0.5) / N), 1.6, 0, Math.PI * 2); ctx.fill();
      }
      GFX.text(ctx, "(0,0)", a0 + 4, b0 - 9, COL.dim, "11px monospace");
      GFX.text(ctx, "(1,1)", a1 - 36, b1 + 10, COL.dim, "11px monospace");
      GFX.text(ctx, "주소 모드 영역(uv<0, uv>1)", ox + 6, oy + 12, COL.dim, "11px sans-serif");

      const cell = L / SPAN / N;
      // --- Sample 탭 ---
      const px = toPx(pu), py = toPy(pv);
      const taps = [];
      if (filt === 0) {
        taps.push({ x: Math.floor(pu * N), y: Math.floor(pv * N), w: 1 });
      } else {
        const x = pu * N - 0.5, y = pv * N - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
        taps.push({ x: x0, y: y0, w: (1 - fx) * (1 - fy) }, { x: x0 + 1, y: y0, w: fx * (1 - fy) },
          { x: x0, y: y0 + 1, w: (1 - fx) * fy }, { x: x0 + 1, y: y0 + 1, w: fx * fy });
      }
      taps.forEach((tp) => {
        const cx = toPx((tp.x + 0.5) / N), cy = toPy((tp.y + 0.5) / N);
        ctx.strokeStyle = ORANGE;
        ctx.lineWidth = 2;
        ctx.strokeRect(toPx(tp.x / N) + 2, toPy(tp.y / N) + 2, cell - 4, cell - 4);
        GFX.line(ctx, px, py, cx, cy, "rgba(255,180,84,0.85)", 1 + 6 * tp.w);
        if (filt === 1) GFX.text(ctx, Math.round(tp.w * 100) + "%", cx, cy + cell * 0.28, ORANGE, "bold 11px monospace", "center");
      });
      // --- Load 텍셀 ---
      const ix = Math.floor(pu * N), iy = Math.floor(pv * N);
      const inRange = ix >= 0 && iy >= 0 && ix < N && iy < N;
      ctx.strokeStyle = inRange ? COL.green : COL.red;
      ctx.lineWidth = 3;
      if (!inRange) ctx.setLineDash([5, 4]);
      ctx.strokeRect(toPx(ix / N) - 1, toPy(iy / N) - 1, cell + 2, cell + 2);
      ctx.setLineDash([]);
      if (!inRange) {
        GFX.line(ctx, toPx(ix / N), toPy(iy / N), toPx((ix + 1) / N), toPy((iy + 1) / N), COL.red, 2);
        GFX.line(ctx, toPx((ix + 1) / N), toPy(iy / N), toPx(ix / N), toPy((iy + 1) / N), COL.red, 2);
      }
      // 프로브
      GFX.dot(ctx, px, py, 7, "#fff");
      GFX.dot(ctx, px, py, 4, COL.accent);

      // --- 오른쪽 패널 ---
      const tx = ox + L + 28;
      let ty = oy + 14;
      const lc = loadTexel(tex, ix, iy);
      let sc = [0, 0, 0, 0];
      taps.forEach((tp) => { const c = texel(tex, tp.x, tp.y, mode); for (let i = 0; i < 4; i++) sc[i] += c[i] * tp.w; });
      if (filt === 0) sc = texel(tex, ix, iy, mode);

      GFX.text(ctx, "■ Load(int3(x, y, mip))", tx, ty, COL.green, MONO_B); ty += 22;
      GFX.text(ctx, `int2 = floor(uv × ${N}) = (${ix}, ${iy})`, tx, ty, COL.text, MONO); ty += 18;
      GFX.text(ctx, inRange ? "→ 그 텍셀 1개를 필터·주소 모드 없이 그대로" : "→ 범위 밖: 0 반환 (샘플러 없음 → 주소 모드 적용 안 됨)",
        tx, ty, inRange ? COL.dim : COL.red, "12px sans-serif"); ty += 20;
      swatch(ctx, tx, ty, 26, lc, `(${fx3(lc[0])}, ${fx3(lc[1])}, ${fx3(lc[2])}, ${fx3(lc[3])})`); ty += 46;

      GFX.text(ctx, "■ Sample(s, uv)", tx, ty, ORANGE, MONO_B); ty += 22;
      GFX.text(ctx, `uv = (${pu.toFixed(3)}, ${pv.toFixed(3)})  ·  ${["Point", "Linear"][filt]} · ${["Wrap", "Mirror", "Clamp", "Border"][mode]}`, tx, ty, COL.text, MONO); ty += 18;
      if (filt === 1) {
        const x = pu * N - 0.5;
        GFX.text(ctx, `x = u·W − 0.5 = ${x.toFixed(3)} → x0 = ${Math.floor(x)}, fx = ${(x - Math.floor(x)).toFixed(3)}`, tx, ty, COL.dim, MONO); ty += 18;
      } else {
        GFX.text(ctx, "Point: 가장 가까운 텍셀 1개 (주소 모드는 적용)", tx, ty, COL.dim, "12px sans-serif"); ty += 18;
      }
      taps.forEach((tp) => {
        const ax = addr(tp.x, N, mode), ay = addr(tp.y, N, mode);
        const dst = ax < 0 || ay < 0 ? "Border(0)" : `(${ax},${ay})`;
        GFX.text(ctx, `  (${tp.x},${tp.y}) → ${dst}   w = ${tp.w.toFixed(3)}`, tx, ty, COL.dim, MONO); ty += 16;
      });
      ty += 6;
      swatch(ctx, tx, ty, 26, sc, `(${fx3(sc[0])}, ${fx3(sc[1])}, ${fx3(sc[2])}, ${fx3(sc[3])})`); ty += 46;

      const diff = Math.max(Math.abs(lc[0] - sc[0]), Math.abs(lc[1] - sc[1]), Math.abs(lc[2] - sc[2]), Math.abs(lc[3] - sc[3]));
      GFX.text(ctx, `max |Load − Sample| = ${diff.toFixed(3)}`, tx, ty, diff < 1e-4 ? COL.green : COL.yellow, MONO_B); ty += 22;
      let note;
      if (!inRange && filt === 0) note = "범위 밖: Load는 0, Sample은 주소 모드(" + ["Wrap", "Mirror", "Clamp", "Border"][mode] + ")가 대신 값을 정함";
      else if (!inRange) note = "범위 밖: 샘플러의 AddressMode가 탭 4개의 출처를 결정";
      else if (filt === 0) note = "Point 필터 Sample = Load와 같은 텍셀 (범위 안에서는 결과 동일)";
      else if (diff < 1e-4) note = "텍셀 중심에 정확히 있으면 Linear도 텍셀 1개 값과 같아짐";
      else note = "Linear: 탭 4개를 가중합 → 원래 데이터에 없던 중간값이 생김";
      GFX.text(ctx, note, tx, ty, COL.dim, "12px sans-serif");
    }

    function setUV(x, y) {
      pu = clamp(U0 + ((x - ox) / L) * SPAN, U0, U0 + SPAN - 1e-4);
      pv = clamp(U0 + ((y - oy) / L) * SPAN, U0, U0 + SPAN - 1e-4);
      su.set(pu); sv.set(pv);
      draw();
    }
    onDrag(S.canvas, (x, y, ph) => { if (ph !== "up" && x <= ox + L + 10) setUV(x, y); });

    seg(ctl, "텍스처", ["컬러 체커", "그라디언트", "영역(ID 색)"], kind, (i) => { kind = i; tex = makeTex(kind, N); bgKey = ""; draw(); });
    seg(ctl, "Sample 필터", ["Point", "Linear"], filt, (i) => { filt = i; draw(); });
    seg(ctl, "AddressMode", ["Wrap", "Mirror", "Clamp", "Border"], mode, (i) => { mode = i; draw(); });
    GFX.slider(ctl, { label: "텍스처 크기 W×H", min: 2, max: 16, step: 1, value: N, format: (v) => v + "×" + v,
      onInput: (v) => { N = v; tex = makeTex(kind, N); bgKey = ""; if (S.ctx) draw(); } });
    const su = GFX.slider(ctl, { label: "u", min: U0, max: U0 + SPAN, step: 0.001, value: pu, format: (v) => (+v).toFixed(3), onInput: (v) => { pu = v; draw(); } });
    const sv = GFX.slider(ctl, { label: "v", min: U0, max: U0 + SPAN, step: 0.001, value: pv, format: (v) => (+v).toFixed(3), onInput: (v) => { pv = v; draw(); } });

    window.addEventListener("resize", () => { bgKey = ""; draw(); });
    draw();
  }

  // ==========================================================
  // 2) 픽셀 발자국과 자동 LOD — 필터별 텍셀 수 (2D)
  // ==========================================================
  function initFootprint() {
    if (!document.getElementById("c-ts-footprint")) return;
    const S = GFX.setup("c-ts-footprint");
    const ctl = document.getElementById("ctl-ts-footprint");
    const TEX = 1024, MAXMIP = 10;
    const CX = 412.37, CY = 301.62;          // 발자국 중심(텍셀 단위, 일부러 비정수)
    let densLog = 2, tilt = 60, rot = 20, mode = 3, anisoIdx = 4, bias = 0;
    const MODES = ["Load", "Sample · Point", "Sample · Bilinear", "Sample · Trilinear", "Sample · Aniso"];
    const bg = document.createElement("canvas");
    let bgKey = "";

    function brick(tx, ty) {
      // 8×4 텍셀 벽돌 + 1텍셀 줄눈. 벽돌마다 다른 색.
      const row = Math.floor(ty / 4), off = (row & 1) ? 4 : 0;
      const col = Math.floor((tx + off) / 8);
      const mx = ((tx + off) % 8 + 8) % 8, my = ((ty % 4) + 4) % 4;
      if (mx < 1 || my < 1) return [0.82, 0.8, 0.74];
      let hsh = Math.sin(col * 127.1 + row * 311.7) * 43758.5453; hsh -= Math.floor(hsh);
      return hsv2rgb(8 + hsh * 40, 0.55 + hsh * 0.2, 0.42 + hsh * 0.35);
    }

    function calc() {
      const dens = Math.pow(2, densLog);
      const a = dens, b = dens / Math.cos(tilt * Math.PI / 180), r = rot * Math.PI / 180;
      const ddx = [a * Math.cos(r), a * Math.sin(r)], ddy = [-b * Math.sin(r), b * Math.cos(r)];
      const pmax = Math.max(a, b), pmin = Math.min(a, b);
      const maxA = [1, 2, 4, 8, 16][anisoIdx];
      const nA = Math.max(1, Math.min(Math.ceil(pmax / pmin - 1e-6), maxA));
      const lIso = Math.log2(pmax) + bias, lAn = Math.log2(pmax / nA) + bias;
      const lam = clamp(Math.round((mode === 4 ? lAn : lIso) * 1e6) / 1e6, 0, MAXMIP);
      const area = a * b;
      let m = 0, count = 1, rep = 1;
      if (mode === 1 || mode === 2) { m = Math.round(lam); count = mode === 1 ? 1 : 4; rep = Math.pow(4, m); }
      else if (mode === 3) { m = Math.floor(lam); count = 8; rep = Math.pow(4, lam); }
      else if (mode === 4) { m = Math.floor(lam); count = 8 * nA; rep = nA * Math.pow(4, lam); }
      return { dens, a, b, ddx, ddy, pmax, pmin, nA, maxA, lIso, lAn, lam, m, count, area, rep, ratio: area / rep };
    }

    function draw() {
      const ctx = S.ctx, w = S.w, h = S.h;
      GFX.clear(ctx, w, h);
      const c = calc();
      const L = Math.max(160, Math.min(h - 30, w * 0.52)), ox = 15, oy = (h - L) / 2;
      const cellM = Math.pow(2, c.m);
      const V = Math.max(10, 2.6 * (c.a + c.b), (mode === 3 ? 4.6 : 3.2) * cellM);
      const sc = L / V;
      const vx0 = CX - V / 2, vy0 = CY - V / 2;
      const tpx = (x) => ox + (x - vx0) * sc, tpy = (y) => oy + (y - vy0) * sc;

      // 배경 텍스처(밉 0) — 화면 픽셀당 1회 점 샘플(그대로 보이게)
      const R = Math.round(Math.min(L, 480));
      const key = [R, V.toFixed(4)].join(",");
      if (key !== bgKey) {
        bgKey = key; bg.width = R; bg.height = R;
        const bx = bg.getContext("2d"), img = bx.createImageData(R, R), d = img.data;
        for (let py = 0; py < R; py++) for (let px = 0; px < R; px++) {
          const col = brick(Math.floor(vx0 + ((px + 0.5) / R) * V), Math.floor(vy0 + ((py + 0.5) / R) * V));
          const k = (py * R + px) * 4;
          d[k] = col[0] * 200; d[k + 1] = col[1] * 200; d[k + 2] = col[2] * 200; d[k + 3] = 255;
        }
        bx.putImageData(img, 0, 0);
      }
      ctx.save();
      ctx.beginPath(); ctx.rect(ox, oy, L, L); ctx.clip();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bg, ox, oy, L, L);
      ctx.fillStyle = "rgba(8,8,12,0.35)"; ctx.fillRect(ox, oy, L, L);
      // 밉0 격자
      if (sc >= 5) {
        ctx.strokeStyle = "rgba(255,255,255,0.10)"; ctx.lineWidth = 1; ctx.beginPath();
        for (let x = Math.ceil(vx0); x <= vx0 + V; x++) { ctx.moveTo(tpx(x), oy); ctx.lineTo(tpx(x), oy + L); }
        for (let y = Math.ceil(vy0); y <= vy0 + V; y++) { ctx.moveTo(ox, tpy(y)); ctx.lineTo(ox + L, tpy(y)); }
        ctx.stroke();
      }
      // 선택된 밉 격자
      if (mode !== 0 && c.m > 0 && cellM * sc >= 6) {
        ctx.strokeStyle = "rgba(126,231,135,0.28)"; ctx.lineWidth = 1; ctx.beginPath();
        for (let x = Math.ceil(vx0 / cellM) * cellM; x <= vx0 + V; x += cellM) { ctx.moveTo(tpx(x), oy); ctx.lineTo(tpx(x), oy + L); }
        for (let y = Math.ceil(vy0 / cellM) * cellM; y <= vy0 + V; y += cellM) { ctx.moveTo(ox, tpy(y)); ctx.lineTo(ox + L, tpy(y)); }
        ctx.stroke();
      }
      // 발자국 평행사변형
      const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([i, j]) =>
        [CX + c.ddx[0] * i + c.ddy[0] * j, CY + c.ddx[1] * i + c.ddy[1] * j]);
      ctx.beginPath();
      corners.forEach((p, i) => (i ? ctx.lineTo(tpx(p[0]), tpy(p[1])) : ctx.moveTo(tpx(p[0]), tpy(p[1]))));
      ctx.closePath();
      ctx.fillStyle = "rgba(86,212,221,0.20)"; ctx.fill();
      ctx.strokeStyle = COL.cyan; ctx.lineWidth = 2; ctx.stroke();

      // 탭 셀 그리기
      function cellAt(level, ix, iy, color, dash, lw) {
        const s = Math.pow(2, level);
        ctx.strokeStyle = color; ctx.lineWidth = lw || 2;
        if (dash) ctx.setLineDash(dash);
        ctx.strokeRect(tpx(ix * s) + 1, tpy(iy * s) + 1, s * sc - 2, s * sc - 2);
        ctx.setLineDash([]);
      }
      function quad(level, px, py, color, dash, lw) {
        const s = Math.pow(2, level), x = px / s - 0.5, y = py / s - 0.5, x0 = Math.floor(x), y0 = Math.floor(y);
        cellAt(level, x0, y0, color, dash, lw); cellAt(level, x0 + 1, y0, color, dash, lw);
        cellAt(level, x0, y0 + 1, color, dash, lw); cellAt(level, x0 + 1, y0 + 1, color, dash, lw);
      }
      if (mode === 0) cellAt(0, Math.floor(CX), Math.floor(CY), COL.green, null, 3);
      else if (mode === 1) cellAt(c.m, Math.floor(CX / cellM), Math.floor(CY / cellM), ORANGE, null, 3);
      else if (mode === 2) quad(c.m, CX, CY, ORANGE);
      else if (mode === 3) { quad(Math.min(c.m + 1, MAXMIP), CX, CY, COL.purple, [6, 4]); quad(c.m, CX, CY, ORANGE); }
      else {
        const major = c.b >= c.a ? c.ddy : c.ddx;
        for (let i = 0; i < c.nA; i++) {
          const t = (i + 0.5) / c.nA - 0.5;
          const px = CX + major[0] * t, py = CY + major[1] * t;
          quad(c.m, px, py, "rgba(255,180,84,0.75)", null, 1.3);
          GFX.dot(ctx, tpx(px), tpy(py), 4, ORANGE);
        }
      }
      // 미분 벡터
      GFX.arrow(ctx, tpx(CX), tpy(CY), tpx(CX + c.ddx[0] / 2), tpy(CY + c.ddx[1] / 2), COL.red, 2.5);
      GFX.arrow(ctx, tpx(CX), tpy(CY), tpx(CX + c.ddy[0] / 2), tpy(CY + c.ddy[1] / 2), COL.green, 2.5);
      GFX.dot(ctx, tpx(CX), tpy(CY), 4, "#fff");
      ctx.restore();
      ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 1; ctx.strokeRect(ox + 0.5, oy + 0.5, L - 1, L - 1);
      GFX.text(ctx, `텍스처 ${TEX}×${TEX} · 화면 픽셀 1개의 발자국(청록)`, ox + 8, oy + 14, "#fff", "12px sans-serif");
      GFX.text(ctx, "빨강 ddx(uv)·W   초록 ddy(uv)·W   (화살표는 절반 길이)", ox + 8, oy + L - 12, COL.dim, "11px sans-serif");

      // 오른쪽 수치
      const tx = ox + L + 26; let ty = oy + 14;
      GFX.text(ctx, MODES[mode], tx, ty, ORANGE, SANS_B); ty += 26;
      const kv = (k, v, col) => { GFX.text(ctx, k, tx, ty, COL.dim, MONO); GFX.text(ctx, v, tx + 168, ty, col || COL.text, MONO); ty += 18; };
      kv("|ddx(uv)|·W", c.a.toFixed(2) + " 텍셀");
      kv("|ddy(uv)|·W", c.b.toFixed(2) + " 텍셀");
      kv("이방성 비율", (c.pmax / c.pmin).toFixed(2) + " : 1");
      kv("λ(등방) = log2(max)", c.lIso.toFixed(2));
      if (mode === 4) kv(`λ(이방, N=${c.nA}/${c.maxA})`, c.lAn.toFixed(2));
      kv("사용 밉", mode === 0 ? "0 (LOD 계산 안 함)" : mode === 3 || mode === 4 ? `${c.m} ↔ ${Math.min(c.m + 1, MAXMIP)} (t=${(c.lam - c.m).toFixed(2)})` : String(c.m), COL.green);
      kv("읽는 텍셀 수", String(c.count), ORANGE);
      kv("발자국 / 대표 면적", c.ratio.toFixed(2));
      ty += 4;
      let verdict, vc;
      if (c.dens < 1 && mode !== 4) { verdict = "확대(magnification): MAG 필터 영역 — 정보 부족은 밉으로 못 고침"; vc = COL.cyan; }
      else if (c.ratio > 1.6) { verdict = "언더샘플링 → 지글거림·모아레(앨리어싱)"; vc = COL.red; }
      else if (c.ratio < 0.45) { verdict = "과도한 흐림 → 비스듬한 면이 뭉개짐(오버블러)"; vc = COL.yellow; }
      else { verdict = "적정: 발자국 ≈ 읽은 영역"; vc = COL.green; }
      GFX.text(ctx, verdict, tx, ty, vc, "bold 12px sans-serif"); ty += 28;

      // 막대: 모드별 텍셀 수(로그 축)
      const nA = c.nA, counts = [1, 1, 4, 8, 8 * nA];
      const bw = Math.max(120, w - tx - 70);
      GFX.text(ctx, "픽셀당 읽는 텍셀 수 (로그 축)", tx, ty, COL.dim, "12px sans-serif"); ty += 16;
      MODES.forEach((nm, i) => {
        const val = counts[i], len = (Math.log2(val) + 1) / 8 * bw;
        ctx.fillStyle = i === mode ? ORANGE : "rgba(255,255,255,0.18)";
        ctx.fillRect(tx, ty, Math.max(3, len), 14);
        GFX.text(ctx, `${nm.replace("Sample · ", "")}  ${val}`, tx + Math.max(3, len) + 8, ty + 7, i === mode ? COL.text : COL.dim, "11px monospace");
        ty += 20;
      });
    }

    seg(ctl, "읽기 방식", MODES, mode, (i) => { mode = i; draw(); }, true);
    GFX.slider(ctl, { label: "축소 정도(텍셀/픽셀)", min: -2, max: 6, step: 0.01, value: densLog,
      format: (v) => Math.pow(2, v).toFixed(2), onInput: (v) => { densLog = v; if (S.ctx) draw(); } });
    GFX.slider(ctl, { label: "면 기울기(시선 각)", min: 0, max: 86, step: 1, value: tilt, format: (v) => v + "°", onInput: (v) => { tilt = v; if (S.ctx) draw(); } });
    GFX.slider(ctl, { label: "화면 회전", min: 0, max: 180, step: 1, value: rot, format: (v) => v + "°", onInput: (v) => { rot = v; if (S.ctx) draw(); } });
    GFX.slider(ctl, { label: "MaxAnisotropy", min: 0, max: 4, step: 1, value: anisoIdx, format: (v) => [1, 2, 4, 8, 16][v] + "×", onInput: (v) => { anisoIdx = v; if (S.ctx) draw(); } });
    GFX.slider(ctl, { label: "MipLODBias", min: -3, max: 3, step: 0.1, value: bias, format: (v) => (+v).toFixed(1), onInput: (v) => { bias = v; if (S.ctx) draw(); } });

    window.addEventListener("resize", () => { bgKey = ""; draw(); });
    draw();
  }

  // ==========================================================
  // 3) 데이터 텍스처 — 스플라인 물고기 떼 & ID 맵 (2D)
  // ==========================================================
  function initData() {
    if (!document.getElementById("c-ts-data")) return;
    const S = GFX.setup("c-ts-data");
    const ctl = document.getElementById("ctl-ts-data");
    let K = 12, fishN = 100, halfErr = false, bits = 8, lod = 0, fmt = 0, show = 0, time = 0, playing = true;
    let pts = [], stored = [], mips = [];

    function gen() {
      pts = [];
      for (let i = 0; i < K; i++) {
        const th = (i / K) * Math.PI * 2;
        const r = 0.30 + 0.09 * Math.sin(3 * th + 0.6) + 0.05 * Math.sin(5 * th + 1.3);
        pts.push([0.5 + r * Math.cos(th), 0.5 + r * Math.sin(th) * 0.86]);
      }
      const q = (v) => fmt === 0 ? v : fmt === 1 ? Math.round(v * 65535) / 65535 : fmt === 2 ? Math.round(v * 255) / 255 : srgbToLinear(Math.round(v * 255) / 255);
      stored = pts.map((p) => [q(p[0]), q(p[1])]);
      mips = [stored];
      for (let l = 1; l <= 2; l++) {
        const prev = mips[l - 1], n = Math.max(1, prev.length >> 1), nxt = [];
        for (let j = 0; j < n; j++) {
          const a = prev[(2 * j) % prev.length], b = prev[(2 * j + 1) % prev.length];
          nxt.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
        }
        mips.push(nxt);
      }
    }
    const wrapI = (i, n) => ((i % n) + n) % n;
    function cr(p0, p1, p2, p3, t) {
      const t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])];
    }
    function curve(arr, t) {
      const n = arr.length, i = Math.floor(t), f = t - i;
      return cr(arr[wrapI(i - 1, n)], arr[wrapI(i, n)], arr[wrapI(i + 1, n)], arr[wrapI(i + 2, n)], f);
    }
    const truth = (t) => curve(pts, t);
    const loadPath = (t) => curve(stored, t);                // Load 4회 + 셰이더에서 Catmull-Rom
    function samplePath(t) {                                 // Sample/SampleLevel 1회 = 하드웨어 선형 보간
      const lvl = mips[lod], n = lvl.length;
      const u = halfErr ? t / K : (t + 0.5) / K;
      const x = u * n - 0.5, x0 = Math.floor(x);
      let f = x - x0;
      if (bits < 16) { const s = Math.pow(2, bits); f = Math.round(f * s) / s; }
      const a = lvl[wrapI(x0, n)], b = lvl[wrapI(x0 + 1, n)];
      return [lerp(a[0], b[0], f), lerp(a[1], b[1], f)];
    }

    // ID 맵 (정수 재질 ID)
    const IW = 10, IH = 8;
    const ids = [];
    const idSeeds = [[0.15, 0.2, 0], [0.55, 0.15, 5], [0.85, 0.35, 1], [0.25, 0.7, 4], [0.65, 0.75, 2], [0.45, 0.45, 3]];
    for (let y = 0; y < IH; y++) for (let x = 0; x < IW; x++) {
      const u = (x + 0.5) / IW, v = (y + 0.5) / IH;
      let best = 0, bd = 9;
      idSeeds.forEach((s) => { const dd = Math.hypot((u - s[0]) * 1.25, v - s[1]); if (dd < bd) { bd = dd; best = s[2]; } });
      ids.push(best);
    }
    const PAL = [[0.9, 0.3, 0.3], [0.3, 0.75, 0.4], [0.3, 0.5, 0.95], [0.98, 0.8, 0.25], [0.75, 0.4, 0.9], [0.3, 0.85, 0.85]];
    const idImgs = [document.createElement("canvas"), document.createElement("canvas")];
    let idKey = "";
    function buildId(iw, ih) {
      const key = iw + "," + ih;
      if (key === idKey) return;
      idKey = key;
      idImgs.forEach((cv, which) => {
        cv.width = iw; cv.height = ih;
        const cx = cv.getContext("2d"), img = cx.createImageData(iw, ih), d = img.data;
        for (let py = 0; py < ih; py++) for (let px = 0; px < iw; px++) {
          const u = (px + 0.5) / iw, v = (py + 0.5) / ih;
          let id;
          if (which === 0) id = ids[Math.floor(v * IH) * IW + Math.floor(u * IW)];
          else {
            const x = u * IW - 0.5, y = v * IH - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
            const g = (i, j) => ids[clamp(j, 0, IH - 1) * IW + clamp(i, 0, IW - 1)];
            id = Math.round(lerp(lerp(g(x0, y0), g(x0 + 1, y0), fx), lerp(g(x0, y0 + 1), g(x0 + 1, y0 + 1), fx), fy));
          }
          const c = PAL[clamp(id, 0, 5)], k = (py * iw + px) * 4;
          d[k] = c[0] * 255; d[k + 1] = c[1] * 255; d[k + 2] = c[2] * 255; d[k + 3] = 255;
        }
        cx.putImageData(img, 0, 0);
      });
    }

    function fishLayer(ctx, path, color, sx, sy, ox, oy, phase) {
      ctx.fillStyle = color;
      ctx.beginPath();
      const span = K;
      for (let k = 0; k < fishN; k++) {
        const t = (((k / fishN) * span + time * 0.55 + phase) % span + span) % span;
        const p = path(t), q = path(t + 0.03);
        const x = ox + p[0] * sx, y = oy + p[1] * sy;
        let dx = (q[0] - p[0]) * sx, dy = (q[1] - p[1]) * sy;
        const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
        const s = 7;
        ctx.moveTo(x + dx * s, y + dy * s);
        ctx.lineTo(x - dx * s - dy * s * 0.45, y - dy * s + dx * s * 0.45);
        ctx.lineTo(x - dx * s + dy * s * 0.45, y - dy * s - dx * s * 0.45);
        ctx.closePath();
      }
      ctx.fill();
    }

    function draw() {
      const ctx = S.ctx, w = S.w, h = S.h;
      GFX.clear(ctx, w, h);
      const W1 = w * 0.62;
      const Ssz = Math.max(140, Math.min(W1 - 40, h - 70));
      const ox = 20 + (W1 - 40 - Ssz) / 2, oy = 34;
      const sx = Ssz * 1.0, sy = Ssz * 1.0;
      GFX.text(ctx, `스플라인 데이터 텍스처 (${K}×1, ${["RG32_FLOAT", "RG16_UNORM", "RGBA8_UNORM", "RGBA8_UNORM_SRGB"][fmt]})`, 20, 16, COL.text, SANS_B);

      // 정답 곡선
      ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]);
      ctx.beginPath();
      for (let i = 0; i <= 400; i++) { const p = truth((i / 400) * K); const x = ox + p[0] * sx, y = oy + p[1] * sy; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke(); ctx.setLineDash([]);
      // 경로 선
      const paths = [];
      if (show !== 2) paths.push([loadPath, COL.cyan]);
      if (show !== 1) paths.push([samplePath, ORANGE]);
      paths.forEach(([fn, col]) => {
        ctx.strokeStyle = col; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.5; ctx.beginPath();
        for (let i = 0; i <= 600; i++) { const p = fn((i / 600) * K); const x = ox + p[0] * sx, y = oy + p[1] * sy; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke(); ctx.globalAlpha = 1;
      });
      // 물고기
      if (show !== 2) fishLayer(ctx, loadPath, "rgba(86,212,221,0.9)", sx, sy, ox, oy, 0);
      if (show !== 1) fishLayer(ctx, samplePath, "rgba(255,180,84,0.9)", sx, sy, ox, oy, 0.5 * K / fishN);
      // 제어점(텍셀)
      stored.forEach((p, i) => {
        GFX.dot(ctx, ox + p[0] * sx, oy + p[1] * sy, 4.5, "#fff");
        GFX.text(ctx, String(i), ox + p[0] * sx + 7, oy + p[1] * sy - 7, COL.dim, "10px monospace");
      });
      // 오차
      let eL = 0, eS = 0;
      for (let i = 0; i < 300; i++) {
        const t = (i / 300) * K, a = truth(t), b = loadPath(t), c2 = samplePath(t);
        eL = Math.max(eL, Math.hypot((a[0] - b[0]) * sx, (a[1] - b[1]) * sy));
        eS = Math.max(eS, Math.hypot((a[0] - c2[0]) * sx, (a[1] - c2[1]) * sy));
      }
      let ty = h - 44;
      GFX.text(ctx, `■ Load×4 + Catmull-Rom   최대 오차 ${eL.toFixed(2)} px`, 20, ty, COL.cyan, MONO_B);
      GFX.text(ctx, `■ ${lod ? `SampleLevel(lod ${lod})` : "Sample(Linear)"} 1회   최대 오차 ${eS.toFixed(2)} px`, 20, ty + 20, ORANGE, MONO_B);
      if (W1 > 640) GFX.text(ctx, `물고기 ${fishN * (show === 0 ? 2 : 1)}마리 · 점선 = 원래 곡선`, W1 - 20, 16, COL.dim, "12px sans-serif", "right");

      // --- 오른쪽: ID 맵 ---
      const rx = W1 + 10, rw = w - rx - 16;
      const ih = (h - 90) / 2, iw = Math.min(rw, ih * IW / IH);
      buildId(Math.max(20, Math.round(iw)), Math.max(16, Math.round(ih)));
      ctx.imageSmoothingEnabled = false;
      GFX.text(ctx, "재질 ID 텍스처 (R8_UINT 같은 정수 데이터)", rx, 16, COL.text, SANS_B);
      GFX.text(ctx, "Load / Point: ID 그대로", rx, 40, COL.green, "bold 12px sans-serif");
      ctx.drawImage(idImgs[0], rx, 50, iw, ih);
      for (let y = 0; y < IH; y++) for (let x = 0; x < IW; x++)
        GFX.text(ctx, String(ids[y * IW + x]), rx + (x + 0.5) * iw / IW, 50 + (y + 0.5) * ih / IH, "rgba(0,0,0,0.6)", "bold 11px monospace", "center");
      const y2 = 50 + ih + 30;
      GFX.text(ctx, "Sample(Linear): ID가 보간됨 → 없는 재질이 경계에 끼어듦", rx, y2 - 10, COL.red, "bold 12px sans-serif");
      ctx.drawImage(idImgs[1], rx, y2, iw, ih);
      const lg = y2 + ih + 16;
      PAL.forEach((c, i) => { ctx.fillStyle = css(c); ctx.fillRect(rx + i * 42, lg - 6, 12, 12); GFX.text(ctx, "=" + i, rx + i * 42 + 15, lg, COL.dim, "11px monospace"); });
    }

    gen();
    GFX.loop((dt) => { if (playing) time += dt; draw(); }, S.canvas);

    seg(ctl, "보기", ["둘 다", "Load만", "Sample만"], show, (i) => { show = i; });
    seg(ctl, "저장 포맷", ["RG32_FLOAT", "RG16_UNORM", "RGBA8_UNORM", "RGBA8_UNORM_SRGB"], fmt, (i) => { fmt = i; gen(); });
    GFX.checkbox(ctl, "uv = i / N (반 텍셀 오프셋 실수)", halfErr, (v) => { halfErr = v; });
    GFX.checkbox(ctl, "재생", playing, (v) => { playing = v; });
    GFX.slider(ctl, { label: "제어점 수 N", min: 8, max: 32, step: 2, value: K, onInput: (v) => { K = v; gen(); } });
    GFX.slider(ctl, { label: "물고기 수", min: 50, max: 3000, step: 50, value: fishN, onInput: (v) => { fishN = v; } });
    GFX.slider(ctl, { label: "필터 가중치 정밀도", min: 2, max: 16, step: 1, value: bits, format: (v) => v >= 16 ? "무한" : v + "bit", onInput: (v) => { bits = v; } });
    GFX.slider(ctl, { label: "SampleLevel LOD", min: 0, max: 2, step: 1, value: lod, onInput: (v) => { lod = v; } });
  }

  // ==========================================================
  // 4) Gather — 2×2 쿼드 한 번에 (2D)
  // ==========================================================
  function initGather() {
    if (!document.getElementById("c-ts-gather")) return;
    const S = GFX.setup("c-ts-gather");
    const ctl = document.getElementById("ctl-ts-gather");
    const N = 8;
    let ch = 0, pu = 0.47, pv = 0.53, thr = 0.12;
    const tex = { w: N, h: N, d: new Float32Array(N * N * 4) };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const k = (y * N + x) * 4;
      tex.d[k] = (((x >> 1) + (y >> 1)) & 1) ? 0.9 : 0.15;                       // R: 2×2 체커
      tex.d[k + 1] = x / (N - 1);                                                 // G: 가로 그라디언트
      tex.d[k + 2] = clamp(1 - Math.hypot(x - 3.5, y - 3.5) / 5, 0, 1);           // B: 원형
      let hh = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; tex.d[k + 3] = hh - Math.floor(hh); // A: 노이즈
    }
    const CHN = ["Red", "Green", "Blue", "Alpha"];
    const CHC = [[1, 0.42, 0.4], [0.45, 0.9, 0.5], [0.45, 0.65, 1], [0.85, 0.85, 0.85]];

    // 깊이 이미지(엣지 검출용)
    const DW = 64;
    const depth = new Float32Array(DW * DW);
    for (let y = 0; y < DW; y++) for (let x = 0; x < DW; x++) {
      let d = 0.9;
      if (Math.hypot(x - 22, y - 26) < 13) d = 0.35 + (y - 26) * 0.004;
      if (x > 34 && x < 56 && y > 12 && y < 30) d = 0.55;
      if (Math.hypot(x - 44, y - 46) < 11) d = 0.25;
      if (y > 52) d = 0.9 - (y - 52) * 0.02;
      depth[y * DW + x] = d;
    }
    const dImg = document.createElement("canvas"), eImg = document.createElement("canvas");
    let eKey = -1;
    function buildEdge() {
      if (eKey === thr) return;
      eKey = thr;
      [dImg, eImg].forEach((cv, which) => {
        cv.width = DW; cv.height = DW;
        const cx = cv.getContext("2d"), img = cx.createImageData(DW, DW), d = img.data;
        for (let y = 0; y < DW; y++) for (let x = 0; x < DW; x++) {
          const k = (y * DW + x) * 4;
          if (which === 0) { const v = depth[y * DW + x] * 255; d[k] = v * 0.7; d[k + 1] = v * 0.85; d[k + 2] = v; }
          else {
            // GatherRed 한 번 = 오른쪽·아래 이웃 포함 2×2 쿼드
            const g = (i, j) => depth[clamp(j, 0, DW - 1) * DW + clamp(i, 0, DW - 1)];
            const q = [g(x, y + 1), g(x + 1, y + 1), g(x + 1, y), g(x, y)];
            const e = Math.max(...q) - Math.min(...q) > thr;
            d[k] = e ? 255 : 18; d[k + 1] = e ? 209 : 18; d[k + 2] = e ? 102 : 24;
          }
          d[k + 3] = 255;
        }
        cx.putImageData(img, 0, 0);
      });
    }

    let L = 300, ox = 18, oy = 10;
    function draw() {
      const ctx = S.ctx, w = S.w, h = S.h;
      GFX.clear(ctx, w, h);
      L = Math.max(160, Math.min(h - 40, w * 0.4)); ox = 18; oy = (h - L) / 2;
      const cell = L / N, cc = CHC[ch];
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const v = tex.d[(y * N + x) * 4 + ch];
        ctx.fillStyle = css([cc[0] * v, cc[1] * v, cc[2] * v]);
        ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);
        GFX.text(ctx, v.toFixed(2), ox + (x + 0.5) * cell, oy + (y + 0.5) * cell + cell * 0.28, v > 0.55 ? "rgba(0,0,0,0.65)" : "rgba(255,255,255,0.55)", "10px monospace", "center");
      }
      ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 1;
      for (let i = 0; i <= N; i++) {
        ctx.beginPath(); ctx.moveTo(ox + i * cell, oy); ctx.lineTo(ox + i * cell, oy + L); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ox, oy + i * cell); ctx.lineTo(ox + L, oy + i * cell); ctx.stroke();
      }
      const x = pu * N - 0.5, y = pv * N - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
      // D3D Gather 반환 순서: 왼쪽아래(x) → 오른쪽아래(y) → 오른쪽위(z) → 왼쪽위(w), V축 아래 방향
      const quad = [[x0, y0 + 1, "x"], [x0 + 1, y0 + 1, "y"], [x0 + 1, y0, "z"], [x0, y0, "w"]];
      const vals = quad.map(([i, j]) => texel(tex, i, j, 2)[ch]);
      ctx.strokeStyle = ORANGE; ctx.lineWidth = 3;
      ctx.strokeRect(ox + x0 * cell, oy + y0 * cell, cell * 2, cell * 2);
      // 반시계 화살표
      const ctr = quad.map(([i, j]) => [ox + (i + 0.5) * cell, oy + (j + 0.5) * cell]);
      for (let i = 0; i < 4; i++) {
        const a = ctr[i], b = ctr[(i + 1) % 4];
        if (i < 3) GFX.arrow(ctx, lerp(a[0], b[0], 0.28), lerp(a[1], b[1], 0.28), lerp(a[0], b[0], 0.72), lerp(a[1], b[1], 0.72), "rgba(255,180,84,0.8)", 2);
        GFX.text(ctx, "." + quad[i][2], a[0], a[1] - cell * 0.12, "#fff", "bold 15px monospace", "center");
      }
      GFX.dot(ctx, ox + pu * L, oy + pv * L, 6, "#fff");
      GFX.dot(ctx, ox + pu * L, oy + pv * L, 3.5, COL.accent);

      // 가운데: 결과 float4
      const mx = ox + L + 26; let ty = oy + 12;
      GFX.text(ctx, `Gather${CHN[ch]}(s, uv)  →  float4`, mx, ty, ORANGE, MONO_B); ty += 26;
      const bwid = Math.max(90, Math.min(200, w * 0.16));
      vals.forEach((v, i) => {
        GFX.text(ctx, "." + "xyzw"[i], mx, ty + 8, COL.text, MONO_B);
        ctx.fillStyle = "rgba(255,255,255,0.08)"; ctx.fillRect(mx + 26, ty, bwid, 16);
        ctx.fillStyle = css(cc); ctx.fillRect(mx + 26, ty, bwid * v, 16);
        GFX.text(ctx, v.toFixed(3) + "  " + ["왼쪽아래", "오른쪽아래", "오른쪽위", "왼쪽위"][i], mx + 32 + bwid, ty + 8, COL.dim, "11px monospace");
        ty += 24;
      });
      ty += 8;
      const manual = lerp(lerp(vals[3], vals[2], fx), lerp(vals[0], vals[1], fx), fy);
      const hw = bilinear(tex, pu, pv, 2)[ch];
      GFX.text(ctx, "직접 가중합: lerp(lerp(w,z,fx), lerp(x,y,fx), fy)", mx, ty, COL.dim, "12px monospace"); ty += 18;
      GFX.text(ctx, `= ${manual.toFixed(4)}   Sample(Linear).${"rgba"[ch]} = ${hw.toFixed(4)}`, mx, ty, Math.abs(manual - hw) < 1e-6 ? COL.green : COL.red, MONO); ty += 22;
      GFX.text(ctx, "→ 같은 4텍셀이지만 섞지 않고 원본 값 4개를 그대로 줌", mx, ty, COL.dim, "12px sans-serif"); ty += 18;
      GFX.text(ctx, "→ 가중치를 셰이더가 정함: 깊이 인지 업샘플·최솟값/최댓값·PCF", mx, ty, COL.dim, "12px sans-serif"); ty += 18;
      GFX.text(ctx, "→ 한 채널만, 항상 밉 0, uv는 샘플러 주소 모드 적용", mx, ty, COL.dim, "12px sans-serif");

      // 오른쪽: 엣지 검출
      buildEdge();
      const ex = mx + Math.max(bwid + 150, 340);
      const es = Math.max(70, Math.min((w - ex - 16), (h - 90) / 2));
      if (ex + 70 < w) {
        ctx.imageSmoothingEnabled = false;
        GFX.text(ctx, "깊이 버퍼", ex, oy + 8, COL.text, "bold 12px sans-serif");
        ctx.drawImage(dImg, ex, oy + 18, es, es);
        GFX.text(ctx, `GatherRed 쿼드 max−min > ${thr.toFixed(2)}`, ex, oy + 36 + es, COL.text, "bold 12px sans-serif");
        ctx.drawImage(eImg, ex, oy + 46 + es, es, es);
        GFX.text(ctx, "픽셀당 fetch: Load 4회 → Gather 1회", ex, oy + 62 + es * 2, COL.dim, "11px sans-serif");
      }
    }

    onDrag(S.canvas, (x, y, ph) => {
      if (ph === "up" || x > ox + L) return;
      pu = clamp((x - ox) / L, 0, 0.9999); pv = clamp((y - oy) / L, 0, 0.9999);
      draw();
    });
    seg(ctl, "채널", ["GatherRed", "GatherGreen", "GatherBlue", "GatherAlpha"], ch, (i) => { ch = i; draw(); });
    GFX.slider(ctl, { label: "엣지 임계값", min: 0.02, max: 0.5, step: 0.01, value: thr, onInput: (v) => { thr = v; if (S.ctx) draw(); } });
    window.addEventListener("resize", draw);
    draw();
  }

  // ==========================================================
  // WebGL2 공통: 캔버스 + 2D 오버레이 + 프로그램
  // ==========================================================
  function glStage(id) {
    const cv = document.getElementById(id);
    const baseH = parseInt(cv.getAttribute("height")) || 480;    // 1회만 읽음(피드백 루프 방지)
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const wrap = document.createElement("div");
    wrap.style.position = "relative";
    cv.parentNode.insertBefore(wrap, cv);
    wrap.appendChild(cv);
    const ov = document.createElement("canvas");
    ov.style.cssText = "position:absolute;left:0;top:0;width:100%;background:transparent;pointer-events:none;border-radius:10px";
    wrap.appendChild(ov);
    const octx = ov.getContext("2d");
    const st = { cv, ov, octx, dpr, W: 0, H: baseH };
    function size() {
      const w = cv.clientWidth || wrap.clientWidth || 600;
      cv.style.height = baseH + "px"; ov.style.height = baseH + "px";
      cv.width = Math.round(w * dpr); cv.height = Math.round(baseH * dpr);
      ov.width = cv.width; ov.height = cv.height;
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      st.W = w; st.H = baseH;
    }
    size();
    window.addEventListener("resize", size);
    return st;
  }
  function glProgram(gl, vs, fs) {
    const mk = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    // 위치는 처음 쓸 때 조회(최적화로 빠진 uniform은 null → gl.uniform* 가 무시)
    const u = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (o[k] = gl.getUniformLocation(p, k))) });
    return { p, u };
  }
  const VS_FULL = `#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

  function noGL(st, msg) {
    const c = st.octx;
    c.fillStyle = "#0b0d14"; c.fillRect(0, 0, st.W, st.H);
    GFX.text(c, msg, st.W / 2, st.H / 2 - 10, COL.text, "bold 15px sans-serif", "center");
    GFX.text(c, "아래 설명과 2D 데모로 같은 개념을 확인할 수 있습니다.", st.W / 2, st.H / 2 + 16, COL.dim, "13px sans-serif", "center");
  }

  // 분할선 + 라벨 오버레이
  function drawSplit(st, split, la, lb, ca, cb) {
    const c = st.octx, W = st.W, H = st.H, x = split * W;
    c.clearRect(0, 0, W, H);
    c.fillStyle = "rgba(255,255,255,0.9)"; c.fillRect(x - 1, 0, 2, H);
    c.beginPath(); c.arc(x, H / 2, 13, 0, Math.PI * 2); c.fillStyle = "rgba(15,17,26,0.9)"; c.fill();
    c.strokeStyle = "#fff"; c.lineWidth = 2; c.stroke();
    GFX.text(c, "◀▶", x, H / 2, "#fff", "bold 10px sans-serif", "center");
    const box = (tx, ty, lines, col, right) => {
      const bw = Math.max(...lines.map((s, i) => { c.font = i ? MONO : MONO_B; return c.measureText(s).width; })) + 22;
      const bx = right ? tx - bw : tx;
      c.fillStyle = "rgba(8,10,16,0.78)"; c.fillRect(bx, ty, bw, 16 + lines.length * 17);
      lines.forEach((s, i) => GFX.text(c, s, bx + 10, ty + 16 + i * 17, i ? COL.dim : col, i ? MONO : MONO_B));
    };
    box(10, 10, la, ca || COL.cyan, false);
    box(W - 10, 10, lb, cb || ORANGE, true);
  }

  // ==========================================================
  // 5) 3D 바닥: Load · Sample · SampleLevel · SampleGrad · SampleBias (WebGL2)
  // ==========================================================
  function initFloor() {
    if (!document.getElementById("c-ts-floor")) return;
    const st = glStage("c-ts-floor");
    const ctl = document.getElementById("ctl-ts-floor");
    let gl = null;
    try { gl = st.cv.getContext("webgl2", { antialias: false }); } catch (e) { gl = null; }
    if (!gl) { noGL(st, "WebGL2를 쓸 수 없어 3D 비교 데모를 표시하지 못했습니다."); return; }

    const FS = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uTex; uniform sampler2D uMipTex;
uniform vec2 uRes; uniform vec3 uEye, uFwd, uRight, uUp;
uniform int uMode, uMip, uAtlas, uShowMip;
uniform float uLod, uBias, uGrad, uTile;
out vec4 o;
vec4 readTex(sampler2D t, vec2 uv, vec2 dx, vec2 dy){
  if (uMode == 0) { ivec2 sz = textureSize(t, uMip); ivec2 ip = ivec2(floor(fract(uv) * vec2(sz))); return texelFetch(t, ip, uMip); }
  if (uMode <= 4) return texture(t, uv);
  if (uMode == 5) return textureLod(t, uv, uLod);
  if (uMode == 6) return textureGrad(t, uv, dx * uGrad, dy * uGrad);
  return texture(t, uv, uBias);
}
void main(){
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 rd = normalize(uFwd * 1.25 + uRight * p.x + uUp * p.y);
  float down = -rd.y;
  float t = uEye.y / max(down, 1e-3);
  vec3 hit = uEye + rd * min(t, 3000.0);
  vec2 uvW = -hit.xz / uTile;                       // 시점 기준으로 글자가 바로 보이게
  vec2 uvC = uvW * 0.5;                              // 아틀라스 전체를 연속으로 타일
  vec2 uv = (uAtlas == 1) ? fract(uvW) * 0.5 : uvC;   // 타일 0만 frac 반복 → 미분 불연속
  vec2 dx = dFdx(uvC), dy = dFdy(uvC);               // SampleGrad 용: 연속 좌표의 미분
  vec3 c = readTex(uTex, uv, dx, dy).rgb;
  if (uShowMip == 1) {
    vec3 m = readTex(uMipTex, uv, dx, dy).rgb;
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(c, m * (0.35 + 0.9 * l), 0.78);
  }
  vec3 sky = mix(vec3(0.55, 0.62, 0.78), vec3(0.10, 0.16, 0.34), clamp(rd.y * 2.2, 0.0, 1.0));
  float fade = smoothstep(0.0, 0.035, down);
  o = vec4(mix(sky, c, fade), 1.0);
}`;
    let prog;
    try { prog = glProgram(gl, VS_FULL, FS); } catch (e) { console.error(e); noGL(st, "셰이더 컴파일에 실패해 3D 데모를 표시하지 못했습니다."); return; }

    // --- 텍스처: 512 아틀라스(2×2 타일) ---
    const TS = 512;
    const tc = document.createElement("canvas"); tc.width = TS; tc.height = TS;
    const g = tc.getContext("2d");
    // 타일 A: 벽돌
    g.fillStyle = "#d8d0c0"; g.fillRect(0, 0, 256, 256);
    for (let r = 0; r < 8; r++) for (let c = -1; c < 5; c++) {
      const x = c * 64 + ((r & 1) ? 32 : 0), y = r * 32;
      const hsh = Math.abs(Math.sin(r * 91.7 + c * 37.3)) % 1;
      g.fillStyle = `hsl(${8 + hsh * 22},${50 + hsh * 20}%,${30 + hsh * 18}%)`;
      g.fillRect(x + 3, y + 3, 58, 26);
    }
    // 타일 B: 고대비 체커 + 가는 선
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { g.fillStyle = ((x + y) & 1) ? "#f2f2f2" : "#151515"; g.fillRect(256 + x * 16, y * 16, 16, 16); }
    g.strokeStyle = "#ff3b5c"; g.lineWidth = 2;
    for (let i = 0; i <= 256; i += 32) { g.beginPath(); g.moveTo(256 + i, 0); g.lineTo(256 + i, 256); g.stroke(); }
    // 타일 C: 대각 줄무늬(고주파)
    g.save(); g.beginPath(); g.rect(0, 256, 256, 256); g.clip();
    g.fillStyle = "#1d2a4a"; g.fillRect(0, 256, 256, 256);
    g.strokeStyle = "#7fd3ff"; g.lineWidth = 3;
    for (let i = -256; i < 512; i += 10) { g.beginPath(); g.moveTo(i, 256); g.lineTo(i + 256, 512); g.stroke(); }
    g.restore();
    // 타일 D: 글자 격자
    g.fillStyle = "#f4ead2"; g.fillRect(256, 256, 256, 256);
    g.fillStyle = "#2a2018"; g.font = "bold 26px monospace"; g.textAlign = "center"; g.textBaseline = "middle";
    const glyphs = "LOADSAMPLEGATHERGRADLEVEL0123456789";
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) g.fillText(glyphs[(x + y * 6) % glyphs.length], 256 + 21 + x * 42.6, 256 + 21 + y * 42.6);
    g.strokeStyle = "#2a2018"; g.lineWidth = 1;
    for (let i = 0; i <= 256; i += 42.6) { g.beginPath(); g.moveTo(256 + i, 256); g.lineTo(256 + i, 512); g.stroke(); g.beginPath(); g.moveTo(256, 256 + i); g.lineTo(512, 256 + i); g.stroke(); }

    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, tc);
    gl.generateMipmap(gl.TEXTURE_2D);
    // 밉 레벨 색상 텍스처
    const MIPC = [[230, 70, 70], [245, 150, 60], [240, 220, 70], [90, 210, 100], [70, 210, 220], [80, 120, 240], [160, 90, 230], [230, 90, 200], [160, 160, 160], [255, 255, 255]];
    const mtex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, mtex);
    for (let l = 0; l < 10; l++) {
      const s = TS >> l, a = new Uint8Array(s * s * 4), c = MIPC[l];
      for (let i = 0; i < s * s; i++) { a[i * 4] = c[0]; a[i * 4 + 1] = c[1]; a[i * 4 + 2] = c[2]; a[i * 4 + 3] = 255; }
      gl.texImage2D(gl.TEXTURE_2D, l, gl.RGBA8, s, s, 0, gl.RGBA, gl.UNSIGNED_BYTE, a);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 9);

    const ext = gl.getExtension("EXT_texture_filter_anisotropic");
    const maxAniso = ext ? gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
    function sampler(minF, magF, aniso, maxLod) {
      const s = gl.createSampler();
      gl.samplerParameteri(s, gl.TEXTURE_MIN_FILTER, minF);
      gl.samplerParameteri(s, gl.TEXTURE_MAG_FILTER, magF);
      gl.samplerParameteri(s, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.samplerParameteri(s, gl.TEXTURE_WRAP_T, gl.REPEAT);
      if (maxLod != null) gl.samplerParameterf(s, gl.TEXTURE_MAX_LOD, maxLod);
      if (aniso && ext) gl.samplerParameterf(s, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(aniso, maxAniso));
      return s;
    }
    const sPoint = sampler(gl.NEAREST_MIPMAP_NEAREST, gl.NEAREST);
    const sBil = sampler(gl.LINEAR, gl.LINEAR, 0, 0);
    const sTri = sampler(gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR);
    const sAni = sampler(gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR, 16);
    const SAMP = [sPoint, sPoint, sBil, sTri, sAni, sTri, sTri, sTri];

    const MODES = ["Load", "Sample·Point", "Sample·Bilinear", "Sample·Trilinear", "Sample·Aniso16×", "SampleLevel", "SampleGrad", "SampleBias"];
    let mA = 0, mB = 4, split = 0.5, mip = 0, lodV = 2, gradK = 1, biasV = 0, camH = 1.2, pitch = -12, yaw = 0.35, atlas = false, showMip = false, moving = true;
    let camX = 0, camZ = 0;

    function info(m) {
      const k = gradK.toFixed(2);
      switch (m) {
        case 0: return [`Load · mip ${mip}`, `tex.Load(int3(uv*size, ${mip}))`, "샘플러 없음 · LOD 없음 · 필터 없음"];
        case 1: return ["Sample · Point", "tex.Sample(sPoint, uv)", "MIN_MAG_MIP_POINT"];
        case 2: return ["Sample · Bilinear (밉 없음)", "tex.Sample(sLinear, uv)", "MIN_MAG_LINEAR_MIP_POINT, MaxLOD=0"];
        case 3: return ["Sample · Trilinear", "tex.Sample(sTri, uv)", "MIN_MAG_MIP_LINEAR"];
        case 4: return ["Sample · Anisotropic", "tex.Sample(sAniso, uv)", ext ? `ANISOTROPIC, MaxAnisotropy=${Math.min(16, maxAniso)}` : "확장 미지원 → Trilinear로 동작"];
        case 5: return [`SampleLevel · lod ${lodV.toFixed(1)}`, `tex.SampleLevel(sTri, uv, ${lodV.toFixed(1)})`, "LOD 고정 · 미분 불필요(VS/CS 가능)"];
        case 6: return [`SampleGrad · ×${k}`, `tex.SampleGrad(sTri, uv, ddx(uvC)*${k}, ddy(uvC)*${k})`, "미분을 직접 공급"];
        default: return [`SampleBias · ${biasV.toFixed(1)}`, `tex.SampleBias(sTri, uv, ${biasV.toFixed(1)})`, "자동 LOD + bias"];
      }
    }

    // 드래그: 분할선 근처면 분할, 아니면 시선 회전
    let dragMode = null, lastX = 0, lastY = 0;
    onDrag(st.cv, (x, y, ph) => {
      if (ph === "down") { dragMode = Math.abs(x - split * st.W) < 26 ? "split" : "look"; lastX = x; lastY = y; return; }
      if (ph === "up") { dragMode = null; return; }
      if (dragMode === "split") split = clamp(x / st.W, 0.02, 0.98);
      else if (dragMode === "look") { yaw += (x - lastX) * 0.005; pitch = clamp(pitch - (y - lastY) * 0.15, -60, -2); sPitch.set(pitch); }
      lastX = x; lastY = y;
    });
    st.cv.style.cursor = "ew-resize";

    function render(dt) {
      if (moving) { camX += Math.sin(yaw) * dt * 1.4; camZ += Math.cos(yaw) * dt * 1.4; }
      const W = st.cv.width, H = st.cv.height;
      gl.viewport(0, 0, W, H);
      gl.useProgram(prog.p);
      const pr = pitch * Math.PI / 180;
      const fwd = [Math.sin(yaw) * Math.cos(pr), Math.sin(pr), Math.cos(yaw) * Math.cos(pr)];
      const right = [-Math.cos(yaw), 0, Math.sin(yaw)];   // cross(fwd, up)
      const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
      const U = prog.u;
      gl.uniform2f(U.uRes, W, H);
      gl.uniform3f(U.uEye, camX, camH, camZ);
      gl.uniform3fv(U.uFwd, fwd); gl.uniform3fv(U.uRight, right); gl.uniform3fv(U.uUp, up);
      gl.uniform1i(U.uTex, 0); gl.uniform1i(U.uMipTex, 1);
      gl.uniform1i(U.uMip, mip); gl.uniform1i(U.uAtlas, atlas ? 1 : 0); gl.uniform1i(U.uShowMip, showMip ? 1 : 0);
      gl.uniform1f(U.uLod, lodV); gl.uniform1f(U.uBias, biasV); gl.uniform1f(U.uGrad, gradK); gl.uniform1f(U.uTile, 2.0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, mtex);
      gl.enable(gl.SCISSOR_TEST);
      const sx = Math.round(split * W);
      [[mA, 0, sx], [mB, sx, W - sx]].forEach(([m, x0, ww]) => {
        if (ww <= 0) return;
        gl.scissor(x0, 0, ww, H);
        gl.bindSampler(0, SAMP[m]); gl.bindSampler(1, SAMP[m]);
        gl.uniform1i(U.uMode, m);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      });
      gl.disable(gl.SCISSOR_TEST);
      const a = info(mA), b = info(mB);
      drawSplit(st, split, ["A · " + a[0], a[1], a[2]], ["B · " + b[0], b[1], b[2]]);
      if (showMip) {
        const c = st.octx;
        MIPC.forEach((col, i) => {
          const x = 12 + i * 34, y = st.H - 24;
          c.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`; c.fillRect(x, y, 14, 14);
          GFX.text(c, String(i), x + 18, y + 7, "#fff", "11px monospace");
        });
        GFX.text(c, "밉 레벨", 12 + 10 * 34, st.H - 17, "#fff", "11px sans-serif");
      }
    }
    GFX.loop(render, st.cv);

    seg(ctl, "왼쪽 A", MODES, mA, (i) => { mA = i; }, true);
    seg(ctl, "오른쪽 B", MODES, mB, (i) => { mB = i; }, true);
    GFX.checkbox(ctl, "밉 레벨 색으로 보기", showMip, (v) => { showMip = v; });
    GFX.checkbox(ctl, "아틀라스 frac 타일링(UV 불연속)", atlas, (v) => { atlas = v; });
    GFX.checkbox(ctl, "카메라 전진", moving, (v) => { moving = v; });
    GFX.slider(ctl, { label: "Load mip", min: 0, max: 9, step: 1, value: mip, onInput: (v) => { mip = v; } });
    GFX.slider(ctl, { label: "SampleLevel lod", min: 0, max: 9, step: 0.1, value: lodV, format: (v) => (+v).toFixed(1), onInput: (v) => { lodV = v; } });
    GFX.slider(ctl, { label: "SampleGrad 미분 배율", min: -3, max: 3, step: 0.05, value: 0, format: (v) => "×" + Math.pow(2, v).toFixed(2), onInput: (v) => { gradK = Math.pow(2, v); } });
    GFX.slider(ctl, { label: "SampleBias", min: -4, max: 4, step: 0.1, value: biasV, format: (v) => (+v).toFixed(1), onInput: (v) => { biasV = v; } });
    GFX.slider(ctl, { label: "카메라 높이", min: 0.2, max: 6, step: 0.05, value: camH, format: (v) => (+v).toFixed(2), onInput: (v) => { camH = v; } });
    const sPitch = GFX.slider(ctl, { label: "내려다보는 각", min: -60, max: -2, step: 0.5, value: pitch, format: (v) => (+v).toFixed(1) + "°", onInput: (v) => { pitch = v; } });
  }

  // ==========================================================
  // 6) 3D 그림자: Load 비교 vs SampleCmp vs PCF (WebGL2)
  // ==========================================================
  function initShadow() {
    if (!document.getElementById("c-ts-shadow")) return;
    const st = glStage("c-ts-shadow");
    const ctl = document.getElementById("ctl-ts-shadow");
    let gl = null;
    try { gl = st.cv.getContext("webgl2", { antialias: false }); } catch (e) { gl = null; }
    if (!gl) { noGL(st, "WebGL2를 쓸 수 없어 3D 그림자 데모를 표시하지 못했습니다."); return; }

    const SCENE = `
const vec3 C0 = vec3(0.0, 0.9, 0.0);
const float EXT = 6.5, RANGE = 40.0;
uniform vec3 uL, uLR, uLU;
float iSphere(vec3 ro, vec3 rd, vec4 s){ vec3 oc = ro - s.xyz; float b = dot(oc, rd); float c = dot(oc, oc) - s.w * s.w; float h = b * b - c; if (h < 0.0) return -1.0; return -b - sqrt(h); }
float iBox(vec3 ro, vec3 rd, vec3 ce, vec3 hs, out vec3 n){
  vec3 m = 1.0 / rd; vec3 q = ro - ce; vec3 k = abs(m) * hs; vec3 t1 = -m * q - k, t2 = -m * q + k;
  float tN = max(max(t1.x, t1.y), t1.z), tF = min(min(t2.x, t2.y), t2.z);
  if (tN > tF || tF < 0.0) return -1.0;
  n = -sign(rd) * step(t1.yzx, t1.xyz) * step(t1.zxy, t1.xyz); return tN;
}
float scene(vec3 ro, vec3 rd, out vec3 n, out int mat){
  float t = 1e9; mat = -1; n = vec3(0.0, 1.0, 0.0);
  if (rd.y < 0.0) { float tp = -ro.y / rd.y; vec3 p = ro + rd * tp; if (tp > 0.0 && max(abs(p.x), abs(p.z)) < 6.0) { t = tp; mat = 0; } }
  vec4 S[3]; S[0] = vec4(-0.6, 1.0, 0.4, 1.0); S[1] = vec4(-2.6, 0.55, -1.6, 0.55); S[2] = vec4(1.7, 0.45, 2.0, 0.45);
  for (int i = 0; i < 3; i++) { float ts = iSphere(ro, rd, S[i]); if (ts > 0.0 && ts < t) { t = ts; mat = 1 + i; n = normalize(ro + rd * ts - S[i].xyz); } }
  vec3 bn;
  float tb = iBox(ro, rd, vec3(2.1, 1.3, -0.9), vec3(0.32, 1.3, 0.32), bn); if (tb > 0.0 && tb < t) { t = tb; mat = 4; n = bn; }
  tb = iBox(ro, rd, vec3(-0.3, 2.35, -2.3), vec3(1.6, 0.06, 0.28), bn); if (tb > 0.0 && tb < t) { t = tb; mat = 5; n = bn; }
  tb = iBox(ro, rd, vec3(0.8, 0.12, -2.8), vec3(0.9, 0.12, 0.9), bn); if (tb > 0.0 && tb < t) { t = tb; mat = 6; n = bn; }
  return mat < 0 ? -1.0 : t;
}`;
    const FS_DEPTH = `#version 300 es
precision highp float; precision highp int;
uniform float uSize;
${SCENE}
void main(){
  vec2 s = gl_FragCoord.xy / uSize * 2.0 - 1.0;
  vec3 ro = C0 - uL * (RANGE * 0.5) + uLR * s.x * EXT + uLU * s.y * EXT;
  vec3 n; int m;
  float t = scene(ro, uL, n, m);
  gl_FragDepth = t < 0.0 ? 1.0 : clamp(t / RANGE, 0.0, 1.0);
}`;
    const FS_MAIN = `#version 300 es
precision highp float; precision highp int;
uniform highp sampler2D uDepth;
uniform highp sampler2DShadow uShadow;
uniform vec2 uRes; uniform vec3 uEye, uFwd, uRight, uUp;
uniform int uMode, uKernel; uniform float uSize, uBias, uSlope;
out vec4 o;
${SCENE}
float lit(vec3 p, vec3 n){
  vec3 q = p - C0;
  vec2 suv = vec2(dot(q, uLR), dot(q, uLU)) / EXT * 0.5 + 0.5;
  float d = dot(p - (C0 - uL * (RANGE * 0.5)), uL) / RANGE;
  float ndl = clamp(dot(n, -uL), 0.0, 1.0);
  float tanA = sqrt(max(1.0 - ndl * ndl, 0.0)) / max(ndl, 0.05);
  float ref = d - (uBias + uSlope * min(tanA, 8.0));
  if (any(lessThan(suv, vec2(0.0))) || any(greaterThan(suv, vec2(1.0)))) return 1.0;
  float inv = 1.0 / uSize;
  if (uMode == 0) { float z = texelFetch(uDepth, ivec2(suv * uSize), 0).r; return ref <= z ? 1.0 : 0.0; }
  if (uMode == 1 || uMode == 2) return texture(uShadow, vec3(suv, ref));
  float sum = 0.0, cnt = 0.0;
  for (int y = -3; y <= 3; y++) for (int x = -3; x <= 3; x++) {
    if (abs(x) > uKernel || abs(y) > uKernel) continue;
    vec2 off = vec2(float(x), float(y));
    if (uMode == 3) sum += texture(uShadow, vec3(suv + off * inv, ref));
    else { ivec2 ip = ivec2(suv * uSize) + ivec2(x, y); float z = texelFetch(uDepth, clamp(ip, ivec2(0), ivec2(int(uSize) - 1)), 0).r; sum += ref <= z ? 1.0 : 0.0; }
    cnt += 1.0;
  }
  return sum / cnt;
}
void main(){
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 rd = normalize(uFwd * 1.6 + uRight * p.x + uUp * p.y);
  vec3 n; int m;
  float t = scene(uEye, rd, n, m);
  vec3 sky = mix(vec3(0.62, 0.68, 0.80), vec3(0.16, 0.22, 0.42), clamp(rd.y * 1.6 + 0.3, 0.0, 1.0));
  if (t < 0.0) { o = vec4(pow(sky, vec3(1.0)), 1.0); return; }
  vec3 pos = uEye + rd * t;
  vec3 alb = vec3(0.7);
  if (m == 0) { vec2 c = floor(pos.xz); alb = mod(c.x + c.y, 2.0) < 1.0 ? vec3(0.74, 0.72, 0.68) : vec3(0.62, 0.60, 0.57); }
  else if (m == 1) alb = vec3(0.85, 0.32, 0.30);
  else if (m == 2) alb = vec3(0.30, 0.62, 0.90);
  else if (m == 3) alb = vec3(0.95, 0.78, 0.30);
  else if (m == 4) alb = vec3(0.55, 0.85, 0.55);
  else if (m == 5) alb = vec3(0.88, 0.88, 0.92);
  else alb = vec3(0.70, 0.52, 0.85);
  float ndl = max(dot(n, -uL), 0.0);
  float sh = ndl > 0.0 ? lit(pos, n) : 0.0;
  vec3 col = alb * (vec3(0.20, 0.23, 0.30) + vec3(1.05, 0.98, 0.88) * ndl * sh);
  col = mix(col, sky, clamp((t - 14.0) / 20.0, 0.0, 1.0));
  o = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}`;
    let pD, pM;
    try { pD = glProgram(gl, VS_FULL, FS_DEPTH); pM = glProgram(gl, VS_FULL, FS_MAIN); }
    catch (e) { console.error(e); noGL(st, "셰이더 컴파일에 실패해 그림자 데모를 표시하지 못했습니다."); return; }

    const RES = [64, 128, 256, 512, 1024, 2048];
    let resIdx = 2, size = 256, depthTex = null, fbo = gl.createFramebuffer(), fboOk = false;
    function makeDepth() {
      size = RES[resIdx];
      if (depthTex) gl.deleteTexture(depthTex);
      depthTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, depthTex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
      gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
      fboOk = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      dirty = true;
    }
    function smp(filter, cmp) {
      const s = gl.createSampler();
      gl.samplerParameteri(s, gl.TEXTURE_MIN_FILTER, filter); gl.samplerParameteri(s, gl.TEXTURE_MAG_FILTER, filter);
      gl.samplerParameteri(s, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.samplerParameteri(s, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (cmp) { gl.samplerParameteri(s, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE); gl.samplerParameteri(s, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL); }
      return s;
    }
    const sRaw = smp(gl.NEAREST, false), sCmpP = smp(gl.NEAREST, true), sCmpL = smp(gl.LINEAR, true);

    const MODES = ["Load+비교", "SampleCmp·Point", "SampleCmp·Linear(2×2)", "SampleCmp N×N PCF", "Load N×N(수동 PCF)"];
    let mA = 0, mB = 3, split = 0.5, kernel = 1, bias = 0.0012, slope = 0.0024, az = 35, el = 38, autoL = false, yaw = 0.6, pitch = 0.42, dirty = true;
    makeDepth();

    function info(m) {
      const n = 2 * kernel + 1;
      switch (m) {
        case 0: return ["Load + 비교 (1텍셀)", "z = sm.Load(int3(ip,0)).r; lit = ref <= z;", "샘플러 없음 · 계단 경계"];
        case 1: return ["SampleCmp · Point", "sm.SampleCmpLevelZero(sCmpPoint, uv, ref)", "COMPARISON_MIN_MAG_MIP_POINT"];
        case 2: return ["SampleCmp · Linear", "sm.SampleCmpLevelZero(sCmpLinear, uv, ref)", "COMPARISON_MIN_MAG_LINEAR · 하드웨어 2×2 PCF"];
        case 3: return [`SampleCmp ${n}×${n} PCF`, `for ${n}×${n}: SampleCmpLevelZero(sCmpLinear, uv, ref, off)`, `호출 ${n * n}회 · 비교 텍셀 ${n * n * 4}개`];
        default: return [`Load ${n}×${n} (수동 PCF)`, `for ${n}×${n}: Load + 비교`, `호출 ${n * n}회 · 비교 텍셀 ${n * n}개`];
      }
    }

    let dragMode = null, lastX = 0, lastY = 0;
    onDrag(st.cv, (x, y, ph) => {
      if (ph === "down") { dragMode = Math.abs(x - split * st.W) < 26 ? "split" : "orbit"; lastX = x; lastY = y; return; }
      if (ph === "up") { dragMode = null; return; }
      if (dragMode === "split") split = clamp(x / st.W, 0.02, 0.98);
      else { yaw += (x - lastX) * 0.008; pitch = clamp(pitch + (y - lastY) * 0.006, 0.08, 1.3); }
      lastX = x; lastY = y;
    });
    st.cv.style.cursor = "ew-resize";

    function lightBasis() {
      const a = az * Math.PI / 180, e = el * Math.PI / 180;
      const L = [-Math.cos(e) * Math.cos(a), -Math.sin(e), -Math.cos(e) * Math.sin(a)];   // 빛이 진행하는 방향
      let r = [L[2], 0, -L[0]]; const rl = Math.hypot(r[0], r[2]) || 1; r = [r[0] / rl, 0, r[2] / rl];
      const u = [r[1] * L[2] - r[2] * L[1], r[2] * L[0] - r[0] * L[2], r[0] * L[1] - r[1] * L[0]];
      return { L, r, u };
    }

    function render(dt) {
      if (autoL) { az = (az + dt * 12) % 360; sAz.set(Math.round(az)); dirty = true; }
      const lb = lightBasis();
      // 패스 1: 빛 시점 깊이(그림자맵) — 바뀔 때만
      if (dirty && fboOk) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.viewport(0, 0, size, size);
        gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.ALWAYS);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.useProgram(pD.p);
        gl.uniform1f(pD.u.uSize, size);
        gl.uniform3fv(pD.u.uL, lb.L); gl.uniform3fv(pD.u.uLR, lb.r); gl.uniform3fv(pD.u.uLU, lb.u);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.disable(gl.DEPTH_TEST);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        dirty = false;
      }
      // 패스 2: 카메라
      const W = st.cv.width, H = st.cv.height;
      gl.viewport(0, 0, W, H);
      gl.useProgram(pM.p);
      const tgt = [0, 0.9, 0], R = 9.5;
      const eye = [tgt[0] + R * Math.cos(pitch) * Math.sin(yaw), tgt[1] + R * Math.sin(pitch), tgt[2] + R * Math.cos(pitch) * Math.cos(yaw)];
      let f = [tgt[0] - eye[0], tgt[1] - eye[1], tgt[2] - eye[2]]; const fl = Math.hypot(...f); f = f.map((v) => v / fl);
      let r = [f[2], 0, -f[0]]; const rl = Math.hypot(r[0], r[2]) || 1; r = [-r[0] / rl, 0, -r[2] / rl];
      const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
      const U = pM.u;
      gl.uniform2f(U.uRes, W, H);
      gl.uniform3fv(U.uEye, eye); gl.uniform3fv(U.uFwd, f); gl.uniform3fv(U.uRight, r); gl.uniform3fv(U.uUp, u);
      gl.uniform3fv(U.uL, lb.L); gl.uniform3fv(U.uLR, lb.r); gl.uniform3fv(U.uLU, lb.u);
      gl.uniform1f(U.uSize, size); gl.uniform1f(U.uBias, bias); gl.uniform1f(U.uSlope, slope); gl.uniform1i(U.uKernel, kernel);
      gl.uniform1i(U.uDepth, 0); gl.uniform1i(U.uShadow, 1);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, depthTex); gl.bindSampler(0, sRaw);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, depthTex);
      gl.enable(gl.SCISSOR_TEST);
      const sx = Math.round(split * W);
      [[mA, 0, sx], [mB, sx, W - sx]].forEach(([m, x0, ww]) => {
        if (ww <= 0) return;
        gl.scissor(x0, 0, ww, H);
        gl.bindSampler(1, m === 1 ? sCmpP : sCmpL);
        gl.uniform1i(U.uMode, m);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      });
      gl.disable(gl.SCISSOR_TEST);
      const a = info(mA), b = info(mB);
      drawSplit(st, split, ["A · " + a[0], a[1], a[2]], ["B · " + b[0], b[1], b[2]]);
      GFX.text(st.octx, `그림자맵 ${size}×${size} · DEPTH_COMPONENT24`, 12, st.H - 16, "rgba(255,255,255,0.8)", "11px monospace");
    }
    GFX.loop(render, st.cv);

    seg(ctl, "왼쪽 A", MODES, mA, (i) => { mA = i; }, true);
    seg(ctl, "오른쪽 B", MODES, mB, (i) => { mB = i; }, true);
    seg(ctl, "그림자맵 해상도", RES.map(String), resIdx, (i) => { resIdx = i; makeDepth(); });
    GFX.checkbox(ctl, "빛 자동 회전", autoL, (v) => { autoL = v; });
    GFX.slider(ctl, { label: "PCF 커널", min: 1, max: 3, step: 1, value: kernel, format: (v) => (2 * v + 1) + "×" + (2 * v + 1), onInput: (v) => { kernel = v; } });
    GFX.slider(ctl, { label: "깊이 바이어스", min: 0, max: 0.004, step: 0.0001, value: bias, format: (v) => (+v).toFixed(4), onInput: (v) => { bias = v; } });
    GFX.slider(ctl, { label: "기울기 바이어스", min: 0, max: 0.004, step: 0.0001, value: slope, format: (v) => (+v).toFixed(4), onInput: (v) => { slope = v; } });
    const sAz = GFX.slider(ctl, { label: "빛 방위각", min: 0, max: 359, step: 1, value: az, format: (v) => Math.round(v) + "°", onInput: (v) => { az = v; dirty = true; } });
    GFX.slider(ctl, { label: "빛 고도", min: 12, max: 80, step: 1, value: el, format: (v) => v + "°", onInput: (v) => { el = v; dirty = true; } });
  }
})();
