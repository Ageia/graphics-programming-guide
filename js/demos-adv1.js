/* ============================================================
   demos-adv1.js — 고급 렌더링 데모 (소프트웨어 렌더링)
   PBR · HDR 톤매핑 · 섀도우 매핑 · 디퍼드(G-buffer)
   모든 픽셀 계산은 오프스크린 ImageData 위에서 직접 수행한다.
   전역 GFX (lib.js) 사용.
   ============================================================ */
(function () {
  "use strict";

  const { COL, clamp, lerp, rad } = GFX;

  // ---- 공통 헬퍼 --------------------------------------------

  // 오프스크린 캔버스 + ImageData 준비
  function makeBuffer(w, h) {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const cx = cv.getContext("2d");
    const img = cx.createImageData(w, h);
    return { cv, cx, img, w, h };
  }

  // HSV(h:0..360, s,v:0..1) -> [r,g,b] 0..1
  function hsv2rgb(h, s, v) {
    h = ((h % 360) + 360) % 360;
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return [r + m, g + m, b + m];
  }

  // 0..1 float -> 0..255 정수 (감마 2.2 적용)
  function toByte(v) {
    v = clamp(v, 0, 1);
    return Math.round(Math.pow(v, 1 / 2.2) * 255);
  }

  // ==========================================================
  // 1) PBR — 라이팅된 구 (Cook-Torrance 근사)
  // ==========================================================
  function initPBR() {
    if (!document.getElementById("c-pbr")) return;
    const S = GFX.setup("c-pbr");
    const ctl = document.getElementById("ctl-pbr");

    const RES = 256;                 // 소프트 렌더 내부 해상도
    const buf = makeBuffer(RES, RES);

    let roughness = 0.35, metallic = 0.0, hue = 30, lightAng = -0.6;

    // 구를 화면공간에서 해석적으로 렌더한다.
    function render() {
      const d = buf.img.data;
      const albedo = hsv2rgb(hue, 0.75, 0.9);       // 베이스 색상
      const R = RES * 0.42;                          // 구 반지름(px)
      const cx = RES / 2, cy = RES / 2;

      // 빛 방향(카메라는 +z에서 바라봄, 화면 xy 평면)
      const lx = Math.cos(lightAng) * 0.6;
      const ly = -0.5;
      const lz = 0.8;
      const ll = Math.hypot(lx, ly, lz);
      const L = [lx / ll, ly / ll, lz / ll];
      // 뷰(카메라) 방향
      const Vd = [0, 0, 1];
      // 하프벡터
      const hlen = Math.hypot(L[0], L[1], L[2] + 1);
      const H = [L[0] / hlen, L[1] / hlen, (L[2] + 1) / hlen];

      // 스페큘러 지수: 거칠수록 넓고 흐리다
      const specPow = Math.pow(1 - roughness, 2) * 512 + 2;
      const specInt = (1 - roughness) * 0.9 + 0.05;   // 매끈할수록 강함

      for (let py = 0; py < RES; py++) {
        for (let px = 0; px < RES; px++) {
          const i = (py * RES + px) * 4;
          const nx = (px - cx) / R;
          const ny = (py - cy) / R;
          const r2 = nx * nx + ny * ny;
          if (r2 > 1) {                                // 구 바깥 = 배경
            d[i] = 12; d[i + 1] = 14; d[i + 2] = 20; d[i + 3] = 255;
            continue;
          }
          // 구 표면 법선 (z를 복원)
          const nz = Math.sqrt(1 - r2);
          const N = [nx, ny, nz];

          const NdotL = Math.max(0, N[0] * L[0] + N[1] * L[1] + N[2] * L[2]);
          const NdotH = Math.max(0, N[0] * H[0] + N[1] * H[1] + N[2] * H[2]);

          // 확산: 금속은 확산이 거의 없음
          const kd = (1 - metallic);
          // 스페큘러 색: 비금속=흰색, 금속=재질색으로 틴트
          const specR = lerp(1, albedo[0], metallic);
          const specG = lerp(1, albedo[1], metallic);
          const specB = lerp(1, albedo[2], metallic);

          const spec = Math.pow(NdotH, specPow) * specInt * NdotL;

          // 앰비언트(약한 환경광) + 확산 + 스페큘러
          const amb = 0.06;
          let cr = albedo[0] * (kd * NdotL + amb) + specR * spec;
          let cg = albedo[1] * (kd * NdotL + amb) + specG * spec;
          let cb = albedo[2] * (kd * NdotL + amb) + specB * spec;

          d[i] = toByte(cr);
          d[i + 1] = toByte(cg);
          d[i + 2] = toByte(cb);
          d[i + 3] = 255;
        }
      }
      buf.cx.putImageData(buf.img, 0, 0);
      draw();
    }

    function draw() {
      const ctx = S.ctx, w = S.w, h = S.h;
      GFX.clear(ctx, w, h);
      // 구 이미지를 중앙에 배치
      const size = Math.min(w * 0.55, h - 40, 300);
      const ox = 24, oy = (h - size) / 2;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(buf.cv, ox, oy, size, size);

      // 설명 텍스트
      const tx = ox + size + 28;
      let ty = oy + 20;
      GFX.text(ctx, "재질 파라미터", tx, ty, COL.text, "bold 14px sans-serif");
      ty += 28;
      GFX.text(ctx, "거칠기 = " + roughness.toFixed(2), tx, ty, COL.dim); ty += 22;
      GFX.text(ctx, "  → 낮을수록 하이라이트가 좁고 날카로움", tx, ty, COL.dim, "12px sans-serif"); ty += 26;
      GFX.text(ctx, "금속성 = " + metallic.toFixed(2), tx, ty, COL.dim); ty += 22;
      GFX.text(ctx, "  → 높을수록 확산↓, 반사가 재질색을 띔", tx, ty, COL.dim, "12px sans-serif"); ty += 30;
      const swatch = hsv2rgb(hue, 0.75, 0.9);
      ctx.fillStyle = `rgb(${toByte(swatch[0])},${toByte(swatch[1])},${toByte(swatch[2])})`;
      ctx.fillRect(tx, ty - 8, 18, 18);
      GFX.text(ctx, "베이스 색상 (Hue " + Math.round(hue) + "°)", tx + 26, ty + 1, COL.dim);
    }

    GFX.slider(ctl, { label: "거칠기 Roughness", min: 0, max: 1, step: 0.01, value: roughness,
      onInput: (v) => { roughness = v; render(); } });
    GFX.slider(ctl, { label: "금속성 Metallic", min: 0, max: 1, step: 0.01, value: metallic,
      onInput: (v) => { metallic = v; render(); } });
    GFX.slider(ctl, { label: "베이스 색상 Hue", min: 0, max: 360, step: 1, value: hue,
      format: (v) => Math.round(v) + "°", onInput: (v) => { hue = v; render(); } });
    GFX.slider(ctl, { label: "빛 방향", min: -180, max: 180, step: 1, value: GFX.deg(lightAng),
      format: (v) => Math.round(v) + "°", onInput: (v) => { lightAng = rad(v); render(); } });

    S.onResize = ((orig) => () => { orig(); draw(); })(S.onResize);
    window.addEventListener("resize", draw);
    render();
  }

  // ==========================================================
  // 1-b) IBL — 환경(주변)이 곧 광원. split-sum(거칠기=프리필터 밉) 직관 데모.
  //   절차적 환경을 배경으로 깔고, 구 표면에서 반사 벡터로 환경을 샘플한다.
  //   거칠기 → 반사 흐림(밉 근사, 다중 샘플 평균), 금속성 → 디퓨즈 vs 스페큘러.
  // ==========================================================
  function initIBL() {
    if (!document.getElementById("c-ibl")) return;
    const S = GFX.setup("c-ibl");
    const ctl = document.getElementById("ctl-ibl");

    const RES = 240;
    const buf = makeBuffer(RES, RES);
    let roughness = 0.25, metallic = 1.0, hue = 40, yaw = 0.4;

    const sunDir = norm3([0.5, 0.45, -0.72]);   // 절차적 환경의 태양 방향(뷰 공간)

    function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l]; }
    function rotY(v, a) {                         // Y축 기준 회전(환경 yaw)
      const c = Math.cos(a), s = Math.sin(a);
      return [v[0]*c + v[2]*s, v[1], -v[0]*s + v[2]*c];
    }
    // 절차적 HDR 환경: 하늘 그라디언트 + 태양 + 바닥. dir은 단위 벡터, [r,g,b] 반환(1 초과 가능).
    function env(dir) {
      const up = clamp(dir[1] * 0.5 + 0.5, 0, 1);
      if (dir[1] > 0) {
        // 지평선(따뜻)→천정(짙은 파랑)
        let r = lerp(0.85, 0.10, up), g = lerp(0.80, 0.20, up), b = lerp(0.72, 0.42, up);
        const hor = Math.max(0, 1 - Math.abs(dir[1]) * 2.2);   // 지평선 노을
        r += hor * 0.35; g += hor * 0.20;
        const s = Math.max(0, dir[0]*sunDir[0] + dir[1]*sunDir[1] + dir[2]*sunDir[2]);
        const sun = Math.pow(s, 220) * 12 + Math.pow(s, 6) * 0.4;   // 태양 코어 + 헤일로
        return [r + sun * 1.3, g + sun * 1.05, b + sun * 0.7];
      }
      const dn = -dir[1];
      return [lerp(0.16, 0.05, dn), lerp(0.14, 0.05, dn), lerp(0.13, 0.06, dn)]; // 바닥
    }
    // 반구 평균 근사(디퓨즈 irradiance): 환경 몇 방향을 코사인 가중 평균
    let avgEnv = [0, 0, 0];
    function computeAvg() {
      let r = 0, g = 0, b = 0, n = 0;
      for (let a = 0; a < 12; a++) for (let e = 0; e < 6; e++) {
        const phi = (a / 12) * Math.PI * 2, th = (e / 6) * Math.PI * 0.5;
        const d = [Math.sin(th)*Math.cos(phi), Math.cos(th), Math.sin(th)*Math.sin(phi)];
        const c = env(d), w = Math.cos(th);
        r += c[0]*w; g += c[1]*w; b += c[2]*w; n += w;
      }
      avgEnv = [r/n, g/n, b/n];
    }
    // 프리필터 근사: 거칠수록 R 주변을 넓게 흩어 평균(+ 거친 극단은 avgEnv로 수렴)
    function prefilter(R, rough) {
      const c = env(R);
      let r = c[0], g = c[1], b = c[2], wsum = 1;
      const spread = rough * 0.9;
      const OFF = [[1,0],[-1,0],[0,1],[0,-1]];
      for (let k = 0; k < OFF.length; k++) {
        const d = norm3([R[0] + OFF[k][0]*spread, R[1] + OFF[k][1]*spread, R[2]]);
        const s = env(d); r += s[0]; g += s[1]; b += s[2]; wsum += 1;
      }
      r /= wsum; g /= wsum; b /= wsum;
      // 아주 거칠면 방향성이 사라져 반구 평균으로 수렴
      const t = rough * rough;
      return [lerp(r, avgEnv[0], t), lerp(g, avgEnv[1], t), lerp(b, avgEnv[2], t)];
    }
    function reinhard(c) { return [c[0]/(1+c[0]), c[1]/(1+c[1]), c[2]/(1+c[2])]; }

    function render() {
      computeAvg();
      const d = buf.img.data;
      const albedo = hsv2rgb(hue, 0.7, 0.92);
      const R = RES * 0.40, cx = RES / 2, cy = RES / 2;
      const F0d = 0.04;
      for (let py = 0; py < RES; py++) {
        for (let px = 0; px < RES; px++) {
          const i = (py * RES + px) * 4;
          const sx = (px - cx) / R, sy = -(py - cy) / R;   // sy: 위가 +y
          const r2 = sx * sx + sy * sy;
          let col;
          if (r2 > 1) {
            // 배경 = 환경 그 자체(구가 환경 속에 있는 느낌)
            const vd = rotY(norm3([sx * 0.9, sy * 0.9, -1]), yaw);
            col = env(vd);
          } else {
            const nz = Math.sqrt(1 - r2);
            const N = [sx, sy, nz];
            const NoV = nz;                                  // V = (0,0,1)
            const Rv = rotY([2*NoV*N[0], 2*NoV*N[1], 2*NoV*nz - 1], yaw);
            const Nw = rotY(N, yaw);
            // 스페큘러: 프리필터 × 프레넬
            const pf = prefilter(Rv, roughness);
            const fres = F0d + (1 - F0d) * Math.pow(1 - NoV, 5);
            const F0r = lerp(F0d, albedo[0], metallic);
            const F0g = lerp(F0d, albedo[1], metallic);
            const F0b = lerp(F0d, albedo[2], metallic);
            const Fr = F0r + (1 - F0r) * Math.pow(1 - NoV, 5);
            const Fg = F0g + (1 - F0g) * Math.pow(1 - NoV, 5);
            const Fb = F0b + (1 - F0b) * Math.pow(1 - NoV, 5);
            // 디퓨즈: irradiance(≈avgEnv, 법선으로 약간 기울임) × albedo
            const irr = [lerp(avgEnv[0], env(Nw)[0], 0.3), lerp(avgEnv[1], env(Nw)[1], 0.3), lerp(avgEnv[2], env(Nw)[2], 0.3)];
            const kd = (1 - metallic) * (1 - fres);
            col = [
              kd * irr[0] * albedo[0] + pf[0] * Fr,
              kd * irr[1] * albedo[1] + pf[1] * Fg,
              kd * irr[2] * albedo[2] + pf[2] * Fb
            ];
          }
          col = reinhard(col);
          d[i] = toByte(col[0]); d[i+1] = toByte(col[1]); d[i+2] = toByte(col[2]); d[i+3] = 255;
        }
      }
      buf.cx.putImageData(buf.img, 0, 0);
      draw();
    }

    function draw() {
      const ctx = S.ctx, w = S.w, h = S.h;
      GFX.clear(ctx, w, h);
      const size = Math.min(w * 0.55, h - 40, 300);
      const ox = 24, oy = (h - size) / 2;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(buf.cv, ox, oy, size, size);

      const tx = ox + size + 28; let ty = oy + 20;
      GFX.text(ctx, "split-sum 근사", tx, ty, COL.text, "bold 14px sans-serif"); ty += 28;
      const mip = (roughness * 5).toFixed(1);
      GFX.text(ctx, "거칠기 = " + roughness.toFixed(2), tx, ty, COL.dim); ty += 20;
      GFX.text(ctx, "  → 프리필터 밉 " + mip + " / 5 (반사 흐림)", tx, ty, COL.dim, "12px sans-serif"); ty += 26;
      GFX.text(ctx, "금속성 = " + metallic.toFixed(2), tx, ty, COL.dim); ty += 20;
      GFX.text(ctx, "  → " + (metallic > 0.5 ? "F0=재질색, 반사 지배" : "디퓨즈 irradiance 드러남"), tx, ty, COL.dim, "12px sans-serif"); ty += 26;
      GFX.text(ctx, "spec = prefilter × (F·A + B)", tx, ty, COL.dim, "12px sans-serif"); ty += 24;
      const sw = hsv2rgb(hue, 0.7, 0.92);
      ctx.fillStyle = `rgb(${toByte(sw[0])},${toByte(sw[1])},${toByte(sw[2])})`;
      ctx.fillRect(tx, ty - 8, 18, 18);
      GFX.text(ctx, "베이스 색상 (Hue " + Math.round(hue) + "°)", tx + 26, ty + 1, COL.dim);
    }

    GFX.slider(ctl, { label: "거칠기 Roughness", min: 0, max: 1, step: 0.01, value: roughness,
      onInput: (v) => { roughness = v; render(); } });
    GFX.slider(ctl, { label: "금속성 Metallic", min: 0, max: 1, step: 0.01, value: metallic,
      onInput: (v) => { metallic = v; render(); } });
    GFX.slider(ctl, { label: "베이스 색상 Hue", min: 0, max: 360, step: 1, value: hue,
      format: (v) => Math.round(v) + "°", onInput: (v) => { hue = v; render(); } });
    GFX.slider(ctl, { label: "환경 회전", min: -180, max: 180, step: 1, value: GFX.deg(yaw),
      format: (v) => Math.round(v) + "°", onInput: (v) => { yaw = rad(v); render(); } });

    S.onResize = ((orig) => () => { orig(); draw(); })(S.onResize);
    window.addEventListener("resize", draw);
    render();
  }

  // ==========================================================
  // 2) HDR 톤 매핑 — clip vs Reinhard vs ACES
  // ==========================================================
  function initHDR() {
    if (!document.getElementById("c-hdr")) return;
    const S = GFX.setup("c-hdr");
    const ctl = document.getElementById("ctl-hdr");

    let exposure = 1.0;
    let mode = "aces";               // 'reinhard' | 'aces'

    // 톤매핑 커브들 (입력 HDR -> 0..1)
    function reinhard(x) { return x / (1 + x); }
    function aces(x) {
      const a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
      return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0, 1);
    }
    function toneMap(x) { return mode === "aces" ? aces(x) : reinhard(x); }

    // 씬의 HDR 밝기 필드: 왼쪽에서 오른쪽으로 밝은 광원이 있는 그라디언트
    // 반환 HDR 값 (0.. 수십)
    function sceneHDR(u) {
      // 가운데쯤 강한 광원(핫스팟) + 배경 밝기
      const bg = 0.15 + u * 0.4;
      const hot = 40 * Math.exp(-Math.pow((u - 0.72) / 0.12, 2)); // 밝은 점광
      return bg + hot;
    }

    const STRIP_RES = 400;
    const stripClip = makeBuffer(STRIP_RES, 1);
    const stripTone = makeBuffer(STRIP_RES, 1);

    function renderStrips() {
      const dc = stripClip.img.data, dt = stripTone.img.data;
      for (let x = 0; x < STRIP_RES; x++) {
        const u = x / (STRIP_RES - 1);
        const hdr = sceneHDR(u) * exposure;
        // 위: 그냥 자르기
        const c = clamp(hdr, 0, 1);
        const cb = toByte(c);
        dc[x * 4] = cb; dc[x * 4 + 1] = cb; dc[x * 4 + 2] = cb; dc[x * 4 + 3] = 255;
        // 아래: 톤 매핑
        const t = toneMap(hdr);
        const tb = toByte(t);
        dt[x * 4] = tb; dt[x * 4 + 1] = tb; dt[x * 4 + 2] = tb; dt[x * 4 + 3] = 255;
      }
      stripClip.cx.putImageData(stripClip.img, 0, 0);
      stripTone.cx.putImageData(stripTone.img, 0, 0);
      draw();
    }

    function draw() {
      const ctx = S.ctx, w = S.w, h = S.h;
      GFX.clear(ctx, w, h);

      // --- 왼쪽: 두 스트립 비교 ---
      const leftW = Math.min(w * 0.5, 360);
      const sx = 16, sw = leftW - 32;
      const sh = 70, gap = 42;
      let y = 40;

      GFX.text(ctx, "그냥 자르기 (clip → 0..1)", sx, y - 14, COL.red, "bold 13px sans-serif");
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(stripClip.cv, sx, y, sw, sh);
      ctx.strokeStyle = COL.gridAxis; ctx.lineWidth = 1; ctx.strokeRect(sx, y, sw, sh);
      GFX.text(ctx, "밝은 곳이 하얗게 다 타버림", sx, y + sh + 14, COL.dim, "12px sans-serif");

      y += sh + gap;
      const modeName = mode === "aces" ? "ACES 필믹" : "Reinhard";
      GFX.text(ctx, "톤 매핑 (" + modeName + ")", sx, y - 14, COL.green, "bold 13px sans-serif");
      ctx.drawImage(stripTone.cv, sx, y, sw, sh);
      ctx.strokeStyle = COL.gridAxis; ctx.strokeRect(sx, y, sw, sh);
      GFX.text(ctx, "밝은 곳의 계조가 살아남음", sx, y + sh + 14, COL.dim, "12px sans-serif");

      // --- 오른쪽: 톤 커브 그래프 ---
      const gx = leftW + 20;
      const gy = 40;
      const gw = w - gx - 24;
      const gh = h - gy - 40;
      if (gw < 60) return;
      const maxHDR = 8;             // X축 범위

      // 축
      ctx.strokeStyle = COL.gridAxis; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(gx, gy); ctx.lineTo(gx, gy + gh); ctx.lineTo(gx + gw, gy + gh);
      ctx.stroke();
      GFX.text(ctx, "출력 1", gx - 4, gy, COL.dim, "11px sans-serif", "right");
      GFX.text(ctx, "0", gx - 4, gy + gh, COL.dim, "11px sans-serif", "right");
      GFX.text(ctx, "입력 HDR →", gx + gw, gy + gh + 16, COL.dim, "11px sans-serif", "right");

      const X = (v) => gx + (v / maxHDR) * gw;         // v: 0..maxHDR
      const Y = (v) => gy + gh - clamp(v, 0, 1) * gh;  // v: 0..1

      // clip 곡선 y=min(x,1)
      plotCurve(ctx, X, Y, maxHDR, (x) => Math.min(x, 1), COL.red);
      // reinhard
      plotCurve(ctx, X, Y, maxHDR, reinhard, mode === "reinhard" ? COL.green : COL.dim);
      // aces
      plotCurve(ctx, X, Y, maxHDR, aces, mode === "aces" ? COL.green : COL.dim);

      // 범례
      GFX.text(ctx, "■ clip", gx + 8, gy + 12, COL.red, "12px sans-serif");
      GFX.text(ctx, "■ Reinhard", gx + 8, gy + 30, mode === "reinhard" ? COL.green : COL.dim, "12px sans-serif");
      GFX.text(ctx, "■ ACES", gx + 8, gy + 48, mode === "aces" ? COL.green : COL.dim, "12px sans-serif");

      // 현재 노출 마커: 핫스팟 밝기 * 노출 지점
      const hotHDR = clamp(sceneHDR(0.72) * exposure, 0, maxHDR);
      const mxp = X(hotHDR);
      GFX.line(ctx, mxp, gy, mxp, gy + gh, COL.yellow, 1.5, [4, 4]);
      GFX.text(ctx, "핫스팟", mxp + 4, gy + gh - 8, COL.yellow, "11px sans-serif");
    }

    function plotCurve(ctx, X, Y, maxHDR, fn, color) {
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= 120; i++) {
        const x = (i / 120) * maxHDR;
        const px = X(x), py = Y(fn(x));
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    GFX.slider(ctl, { label: "노출 Exposure", min: 0.1, max: 8, step: 0.05, value: exposure,
      format: (v) => (+v).toFixed(2) + "×", onInput: (v) => { exposure = v; renderStrips(); } });
    GFX.button(ctl, "Reinhard", () => { mode = "reinhard"; renderStrips(); });
    GFX.button(ctl, "ACES 필믹", () => { mode = "aces"; renderStrips(); });

    window.addEventListener("resize", () => { S.onResize(); draw(); });
    renderStrips();
  }

  // ==========================================================
  // 3) 섀도우 매핑 — 2D 단면으로 2패스 아이디어 설명
  // ==========================================================
  function initShadowMap() {
    if (!document.getElementById("c-shadowmap")) return;
    const S = GFX.setup("c-shadowmap");
    const ctl = document.getElementById("ctl-shadowmap");

    let showMap = true;
    const NRAYS = 160;               // 섀도우 맵 해상도(방향 개수)
    const FOV = rad(120);            // 빛의 시야각(아래쪽으로)

    // 가림막(선분) — 지면 위 장애물. 화면 픽셀 좌표.
    let occluders = [];
    // 빛 위치 핸들
    let lightPt = { x: 0, y: 0, color: COL.yellow, label: "빛" };
    let drag = null;

    function layout() {
      const w = S.w, h = S.h;
      lightPt.x = w * 0.5; lightPt.y = h * 0.18;
      occluders = [
        { x1: w * 0.30, y1: h * 0.55, x2: w * 0.44, y2: h * 0.55 },
        { x1: w * 0.60, y1: h * 0.48, x2: w * 0.74, y2: h * 0.62 },
      ];
    }
    layout();
    const groundY = () => S.h * 0.82;

    // 광선-선분 교차: 광선 원점 O, 방향 D(정규화), 선분 A-B.
    // 반환: 교차 거리 t (없으면 Infinity)
    function raySeg(ox, oy, dx, dy, ax, ay, bx, by) {
      const ex = bx - ax, ey = by - ay;
      const denom = dx * ey - dy * ex;
      if (Math.abs(denom) < 1e-9) return Infinity;
      const t = ((ax - ox) * ey - (ay - oy) * ex) / denom;
      const s = ((ax - ox) * dy - (ay - oy) * dx) / denom;
      if (t > 0 && s >= 0 && s <= 1) return t;
      return Infinity;
    }

    // 1패스: 빛에서 각 방향으로 광선을 쏴 최근접 거리 기록 = 섀도우 맵
    // 방향은 아래를 향한 부채꼴(FOV)을 NRAYS 등분.
    function buildShadowMap() {
      const map = new Float32Array(NRAYS);
      const base = Math.PI / 2;                 // 정면 아래(+y)
      const start = base - FOV / 2;
      const far = S.w + S.h;
      for (let i = 0; i < NRAYS; i++) {
        const a = start + (i / (NRAYS - 1)) * FOV;
        const dx = Math.cos(a), dy = Math.sin(a);
        let nearest = far;
        // 가림막들과 교차
        for (const o of occluders) {
          const t = raySeg(lightPt.x, lightPt.y, dx, dy, o.x1, o.y1, o.x2, o.y2);
          if (t < nearest) nearest = t;
        }
        // 지면과의 교차도 기록(지면 자체는 receiver라 그림자 판정엔 안 씀)
        map[i] = nearest;
      }
      return { map, start, far };
    }

    // 화면 점(px,py)을 빛 시점으로 변환 -> {angle, dist, index}
    function toLightSpace(px, py, start) {
      const dx = px - lightPt.x, dy = py - lightPt.y;
      const dist = Math.hypot(dx, dy);
      let a = Math.atan2(dy, dx);
      const idx = Math.round(((a - start) / FOV) * (NRAYS - 1));
      return { dist, idx };
    }

    function draw() {
      const ctx = S.ctx, w = S.w, h = S.h;
      GFX.clear(ctx, w, h);
      const gY = groundY();
      const sm = buildShadowMap();

      // --- 지면(receiver) 각 픽셀 그림자 판정 (2패스) ---
      const step = 3;
      for (let px = 0; px < w; px += step) {
        const ls = toLightSpace(px, gY, sm.start);
        let lit = false;
        if (ls.idx >= 0 && ls.idx < NRAYS) {
          const stored = sm.map[ls.idx];
          // 저장된 최근접 거리보다 멀면(=가림) 그림자, 여유값 포함
          lit = ls.dist <= stored + 1.0;
        }
        ctx.fillStyle = lit ? "rgba(255,209,102,0.28)" : "rgba(0,0,0,0.55)";
        ctx.fillRect(px, gY, step + 1, h - gY);
      }
      // 지면 선
      GFX.line(ctx, 0, gY, w, gY, COL.gridAxis, 2);
      GFX.text(ctx, "지면(receiver)", 8, gY + 16, COL.dim, "12px sans-serif");

      // --- 빛에서 쏜 광선(샘플만 표시) ---
      for (let i = 0; i < NRAYS; i += 8) {
        const a = sm.start + (i / (NRAYS - 1)) * FOV;
        const dx = Math.cos(a), dy = Math.sin(a);
        const t = Math.min(sm.map[i], sm.far);
        const ex = lightPt.x + dx * t, ey = lightPt.y + dy * t;
        const blocked = sm.map[i] < sm.far - 1;
        GFX.line(ctx, lightPt.x, lightPt.y, ex, ey,
          blocked ? "rgba(255,123,114,0.5)" : "rgba(110,168,254,0.35)", 1);
      }

      // --- 가림막 ---
      for (const o of occluders) {
        GFX.line(ctx, o.x1, o.y1, o.x2, o.y2, COL.purple, 6);
      }
      GFX.text(ctx, "가림막(occluder)", occluders[0].x1, occluders[0].y1 - 12, COL.purple, "12px sans-serif");

      // --- 섀도우 맵 깊이 스트립 (1패스 결과) ---
      if (showMap) {
        const bw = w - 32, bx = 16, by = 8, bh = 26;
        ctx.fillStyle = "rgba(0,0,0,0.4)";
        ctx.fillRect(bx, by, bw, bh);
        let maxd = 1;
        for (let i = 0; i < NRAYS; i++) if (sm.map[i] < sm.far) maxd = Math.max(maxd, sm.map[i]);
        for (let i = 0; i < NRAYS; i++) {
          const d = Math.min(sm.map[i], sm.far);
          const k = clamp(1 - d / maxd, 0, 1);       // 가까울수록 밝게
          const c = Math.round(k * 255);
          ctx.fillStyle = sm.map[i] < sm.far ? `rgb(${c},${c},${c})` : "rgb(20,24,34)";
          const xw = bw / NRAYS;
          ctx.fillRect(bx + i * xw, by, xw + 1, bh);
        }
        ctx.strokeStyle = COL.gridAxis; ctx.lineWidth = 1; ctx.strokeRect(bx, by, bw, bh);
        GFX.text(ctx, "섀도우 맵 (1패스: 빛 시점 최근접 거리 · 밝을수록 가까움)",
          bx, by + bh + 12, COL.dim, "11px sans-serif");
      }

      // --- 빛 핸들 ---
      ctx.fillStyle = COL.yellow;
      ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(lightPt.x, lightPt.y, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      GFX.text(ctx, "빛(드래그)", lightPt.x + 14, lightPt.y, COL.text, "bold 13px sans-serif");
    }

    // 드래그: 빛 + 가림막 끝점
    function pos(e) {
      const r = S.canvas.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    }
    function pickHandle(p) {
      if (Math.hypot(lightPt.x - p.x, lightPt.y - p.y) < 16) return { type: "light" };
      for (let k = 0; k < occluders.length; k++) {
        const o = occluders[k];
        if (Math.hypot(o.x1 - p.x, o.y1 - p.y) < 14) return { type: "occ", k, end: 1 };
        if (Math.hypot(o.x2 - p.x, o.y2 - p.y) < 14) return { type: "occ", k, end: 2 };
      }
      return null;
    }
    S.canvas.addEventListener("mousedown", (e) => { drag = pickHandle(pos(e)); if (drag) e.preventDefault(); });
    S.canvas.addEventListener("touchstart", (e) => { drag = pickHandle(pos(e)); if (drag) e.preventDefault(); }, { passive: false });
    function onMove(e) {
      const p = pos(e);
      S.canvas.style.cursor = (drag || pickHandle(p)) ? "grabbing" : "crosshair";
      if (!drag) return;
      e.preventDefault();
      p.x = clamp(p.x, 0, S.w); p.y = clamp(p.y, 0, S.h);
      if (drag.type === "light") { lightPt.x = p.x; lightPt.y = p.y; }
      else { const o = occluders[drag.k]; if (drag.end === 1) { o.x1 = p.x; o.y1 = p.y; } else { o.x2 = p.x; o.y2 = p.y; } }
      draw();
    }
    S.canvas.addEventListener("mousemove", onMove);
    S.canvas.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("mouseup", () => { drag = null; });
    window.addEventListener("touchend", () => { drag = null; });

    GFX.checkbox(ctl, "섀도우 맵(깊이 스트립) 보기", showMap, (v) => { showMap = v; draw(); });
    GFX.button(ctl, "위치 초기화", () => { layout(); draw(); }, true);

    window.addEventListener("resize", () => { S.onResize(); layout(); draw(); });
    draw();
  }

  // ==========================================================
  // 4) 디퍼드 렌더링 — G-buffer 시각화
  // ==========================================================
  function initDeferred() {
    if (!document.getElementById("c-deferred")) return;
    const S = GFX.setup("c-deferred");
    const ctl = document.getElementById("ctl-deferred");

    const RES = 220;
    const albedoBuf = makeBuffer(RES, RES);
    const normalBuf = makeBuffer(RES, RES);
    const depthBuf = makeBuffer(RES, RES);
    const finalBuf = makeBuffer(RES, RES);

    // G-buffer 저장소 (float)
    const gAlbedo = new Float32Array(RES * RES * 3);
    const gNormal = new Float32Array(RES * RES * 3);
    const gDepth = new Float32Array(RES * RES);     // 0(먼)..1(가까움), 0=비어있음
    const gMask = new Uint8Array(RES * RES);        // 1=물체 있음

    // 씬: 겹치는 구 몇 개
    const spheres = [
      { x: 0.38, y: 0.42, r: 0.26, col: hsv2rgb(210, 0.7, 0.95), z: 0.7 },
      { x: 0.60, y: 0.55, r: 0.30, col: hsv2rgb(20, 0.75, 0.95), z: 0.85 },
      { x: 0.52, y: 0.30, r: 0.18, col: hsv2rgb(130, 0.7, 0.9), z: 0.6 },
    ];

    let numLights = 4;
    let displayMode = "final";       // albedo | normal | depth | final
    let lights = [];

    function makeLights(n) {
      lights = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + 0.5;
        lights.push({
          x: 0.5 + Math.cos(a) * 0.42,
          y: 0.5 + Math.sin(a) * 0.42,
          col: hsv2rgb((i * 47) % 360, 0.6, 1),
          intensity: 0.9,
        });
      }
    }

    // --- G-buffer 패스: 지오메트리 정보만 채운다(조명 없음) ---
    function geometryPass() {
      gDepth.fill(0); gMask.fill(0);
      for (let py = 0; py < RES; py++) {
        for (let px = 0; px < RES; px++) {
          const u = px / RES, v = py / RES;
          let bestZ = -1, hitI = -1, hnz = 0, hnx = 0, hny = 0;
          for (const s of spheres) {
            const dx = (u - s.x), dy = (v - s.y);
            const r2 = (dx * dx + dy * dy) / (s.r * s.r);
            if (r2 <= 1) {
              const nz = Math.sqrt(1 - r2);
              const zval = s.z + nz * s.r;             // 앞쪽일수록 큼
              if (zval > bestZ) {
                bestZ = zval; hitI = spheres.indexOf(s);
                hnx = dx / s.r; hny = dy / s.r; hnz = nz;
              }
            }
          }
          const idx = py * RES + px;
          if (hitI >= 0) {
            const s = spheres[hitI];
            gAlbedo[idx * 3] = s.col[0]; gAlbedo[idx * 3 + 1] = s.col[1]; gAlbedo[idx * 3 + 2] = s.col[2];
            gNormal[idx * 3] = hnx; gNormal[idx * 3 + 1] = hny; gNormal[idx * 3 + 2] = hnz;
            gDepth[idx] = clamp(bestZ, 0, 1);
            gMask[idx] = 1;
          }
        }
      }
    }

    // --- 라이팅 패스: 화면 픽셀당 1번, 조명 개수만큼 루프 ---
    // (물체 수와 무관 — G-buffer만 읽는다)
    function lightingPass() {
      for (let idx = 0; idx < RES * RES; idx++) {
        const di = idx * 4;
        if (!gMask[idx]) {           // 배경
          finalBuf.img.data[di] = 12; finalBuf.img.data[di + 1] = 14;
          finalBuf.img.data[di + 2] = 20; finalBuf.img.data[di + 3] = 255;
          continue;
        }
        const px = idx % RES, py = (idx / RES | 0);
        const u = px / RES, v = py / RES;
        const nx = gNormal[idx * 3], ny = gNormal[idx * 3 + 1], nz = gNormal[idx * 3 + 2];
        const ar = gAlbedo[idx * 3], ag = gAlbedo[idx * 3 + 1], ab = gAlbedo[idx * 3 + 2];
        let cr = ar * 0.08, cg = ag * 0.08, cb = ab * 0.08;   // 앰비언트
        for (const L of lights) {
          let lx = L.x - u, ly = L.y - v, lz = 0.5;
          const ll = Math.hypot(lx, ly, lz) || 1;
          lx /= ll; ly /= ll; lz /= ll;
          const ndl = Math.max(0, nx * lx + ny * ly + nz * lz);
          const atten = L.intensity / (1 + 6 * (L.x - u) * (L.x - u) + 6 * (L.y - v) * (L.y - v));
          const k = ndl * atten;
          cr += ar * L.col[0] * k; cg += ag * L.col[1] * k; cb += ab * L.col[2] * k;
        }
        finalBuf.img.data[di] = toByte(cr);
        finalBuf.img.data[di + 1] = toByte(cg);
        finalBuf.img.data[di + 2] = toByte(cb);
        finalBuf.img.data[di + 3] = 255;
      }
      finalBuf.cx.putImageData(finalBuf.img, 0, 0);
    }

    // G-buffer를 사람이 볼 수 있게 각 채널 이미지 생성
    function renderChannels() {
      const a = albedoBuf.img.data, n = normalBuf.img.data, dp = depthBuf.img.data;
      for (let idx = 0; idx < RES * RES; idx++) {
        const di = idx * 4;
        if (!gMask[idx]) {
          a[di] = 12; a[di + 1] = 14; a[di + 2] = 20; a[di + 3] = 255;
          n[di] = 12; n[di + 1] = 14; n[di + 2] = 20; n[di + 3] = 255;
          dp[di] = 12; dp[di + 1] = 14; dp[di + 2] = 20; dp[di + 3] = 255;
          continue;
        }
        // 알베도
        a[di] = toByte(gAlbedo[idx * 3]); a[di + 1] = toByte(gAlbedo[idx * 3 + 1]);
        a[di + 2] = toByte(gAlbedo[idx * 3 + 2]); a[di + 3] = 255;
        // 법선: [-1,1] -> [0,255] 인코딩
        n[di] = Math.round((gNormal[idx * 3] * 0.5 + 0.5) * 255);
        n[di + 1] = Math.round((gNormal[idx * 3 + 1] * 0.5 + 0.5) * 255);
        n[di + 2] = Math.round((gNormal[idx * 3 + 2] * 0.5 + 0.5) * 255);
        n[di + 3] = 255;
        // 깊이: 그레이스케일
        const dc = Math.round(gDepth[idx] * 255);
        dp[di] = dc; dp[di + 1] = dc; dp[di + 2] = dc; dp[di + 3] = 255;
      }
      albedoBuf.cx.putImageData(albedoBuf.img, 0, 0);
      normalBuf.cx.putImageData(normalBuf.img, 0, 0);
      depthBuf.cx.putImageData(depthBuf.img, 0, 0);
    }

    function rebuild() {
      makeLights(numLights);
      geometryPass();
      renderChannels();
      lightingPass();
      draw();
    }

    function draw() {
      const ctx = S.ctx, w = S.w, h = S.h;
      GFX.clear(ctx, w, h);
      const size = Math.min(w * 0.55, h - 70, 300);
      const ox = 16, oy = 16;
      const bufMap = { albedo: albedoBuf, normal: normalBuf, depth: depthBuf, final: finalBuf };
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bufMap[displayMode].cv, ox, oy, size, size);
      ctx.strokeStyle = COL.gridAxis; ctx.lineWidth = 1; ctx.strokeRect(ox, oy, size, size);

      const label = { albedo: "알베도 (색)", normal: "법선 (RGB 인코딩)", depth: "깊이 (그레이스케일)", final: "최종 조명" }[displayMode];
      GFX.text(ctx, "표시: " + label, ox, oy + size + 18, COL.text, "bold 13px sans-serif");

      // 최종 모드일 때 조명 위치 표시
      if (displayMode === "final") {
        for (const L of lights) {
          const lx = ox + L.x * size, ly = oy + L.y * size;
          ctx.fillStyle = `rgb(${toByte(L.col[0])},${toByte(L.col[1])},${toByte(L.col[2])})`;
          ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI * 2); ctx.fill();
        }
      }

      // 설명
      const tx = ox + size + 24;
      let ty = oy + 16;
      GFX.text(ctx, "디퍼드 = 정보 먼저, 조명 나중", tx, ty, COL.text, "bold 14px sans-serif"); ty += 26;
      GFX.text(ctx, "1) G-buffer 패스: 색·법선·깊이 저장", tx, ty, COL.dim, "12px sans-serif"); ty += 20;
      GFX.text(ctx, "2) 라이팅 패스: 화면 픽셀당 1번", tx, ty, COL.dim, "12px sans-serif"); ty += 30;
      GFX.text(ctx, "조명 개수 = " + numLights, tx, ty, COL.green, "bold 13px sans-serif"); ty += 22;
      GFX.text(ctx, "물체 수 = " + spheres.length + " (고정)", tx, ty, COL.dim, "12px sans-serif"); ty += 28;

      const pixels = RES * RES;
      GFX.text(ctx, "라이팅 계산량 =", tx, ty, COL.yellow, "bold 12px sans-serif"); ty += 20;
      GFX.text(ctx, "화면 픽셀 수 × 조명", tx, ty, COL.yellow, "12px sans-serif"); ty += 18;
      GFX.text(ctx, "= " + pixels.toLocaleString() + " × " + numLights, tx, ty, COL.dim, "11px sans-serif"); ty += 18;
      GFX.text(ctx, "물체 수와 무관!", tx, ty, COL.green, "11px sans-serif");
    }

    // 버퍼 전환 버튼
    GFX.button(ctl, "알베도", () => { displayMode = "albedo"; draw(); });
    GFX.button(ctl, "법선", () => { displayMode = "normal"; draw(); });
    GFX.button(ctl, "깊이", () => { displayMode = "depth"; draw(); });
    GFX.button(ctl, "최종 조명", () => { displayMode = "final"; draw(); });
    GFX.slider(ctl, { label: "조명 개수", min: 1, max: 16, step: 1, value: numLights,
      format: (v) => Math.round(v) + "개", onInput: (v) => { numLights = Math.round(v); rebuild(); } });

    window.addEventListener("resize", () => { S.onResize(); draw(); });
    rebuild();
  }

  // ==========================================================
  // 부트스트랩
  // ==========================================================
  GFX.deferInit("c-pbr", initPBR);
  GFX.deferInit("c-ibl", initIBL);
  GFX.deferInit("c-hdr", initHDR);
  GFX.deferInit("c-shadowmap", initShadowMap);
  GFX.deferInit("c-deferred", initDeferred);
})();
