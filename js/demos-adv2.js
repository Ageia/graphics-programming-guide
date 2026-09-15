/* ============================================================
   demos-adv2.js — 고급 데모 2편
   1) 스크린 스페이스 후처리  2) 레이 트레이싱
   3) 패스 트레이싱          4) 전역 조명(GI)
   전역 GFX 헬퍼를 사용한다. 모든 UI 텍스트는 한국어.
   성능을 위해 렌더 버퍼 해상도는 낮게(200~320px) 두고 캔버스로 확대한다.
   ============================================================ */
(function () {
  "use strict";

  const { V, clamp } = GFX;

  // 공통: 낮은 해상도 ImageData 버퍼를 캔버스에 확대해서 그린다.
  function blit(ctx, img, dstW, dstH) {
    // 오프스크린 캔버스에 ImageData를 넣고 확대(픽셀 보간 off) 후 복사
    let tmp = blit._tmp;
    if (!tmp || tmp.width !== img.width || tmp.height !== img.height) {
      tmp = blit._tmp = document.createElement("canvas");
      tmp.width = img.width; tmp.height = img.height;
    }
    tmp.getContext("2d").putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, img.width, img.height, 0, 0, dstW, dstH);
    ctx.imageSmoothingEnabled = true;
  }

  GFX.deferInit("c-screenspace", initScreenSpace);
  GFX.deferInit("c-raytracing", initRayTracing);
  GFX.deferInit("c-pathtracing", initPathTracing);
  GFX.deferInit("c-gi", initGI);

  /* ==========================================================
     1) 스크린 스페이스 후처리
     - 기본 장면(절차적 그라디언트 + 밝은 스팟)을 오프스크린에 한 번 그린다.
     - 완성된 2D 이미지에만 비네트/블룸/색수차/그레인을 적용.
     - 교육 포인트: 3D를 다시 계산하지 않고 화면 픽셀만 만진다.
     ========================================================== */
  function initScreenSpace() {
    if (!document.getElementById("c-screenspace")) return;
    try {
      const S = GFX.setup("c-screenspace");
      const ctl = document.getElementById("ctl-screenspace");
      const RW = 300, RH = 200;              // 렌더 버퍼 해상도

      // --- 기본 장면을 절차적으로 생성 (한 번만) ---
      const base = new Float32Array(RW * RH * 3); // 선형 색상 저장
      function buildScene() {
        // 밝은 원반(광원 느낌) 몇 개 + 부드러운 배경
        const spots = [
          { x: 0.30, y: 0.35, r: 0.16, c: [1.8, 1.6, 1.0] },
          { x: 0.70, y: 0.55, r: 0.13, c: [0.6, 1.2, 2.2] },
          { x: 0.52, y: 0.28, r: 0.06, c: [3.0, 2.6, 2.2] }, // 아주 밝은 하이라이트
        ];
        for (let y = 0; y < RH; y++) {
          for (let x = 0; x < RW; x++) {
            const u = x / RW, v = y / RH;
            // 은은한 배경 그라디언트
            let r = 0.05 + 0.10 * v, g = 0.06 + 0.05 * u, b = 0.12 + 0.10 * (1 - v);
            // 체커풍 바닥으로 아래쪽에 구조감
            if (v > 0.6) {
              const c = (Math.floor(u * 10) + Math.floor(v * 14)) & 1;
              const f = c ? 1.15 : 0.75;
              r *= f; g *= f; b *= f;
            }
            // 밝은 스팟 누적
            for (const s of spots) {
              const dx = u - s.x, dy = v - s.y;
              const d = Math.hypot(dx, dy);
              const fall = Math.max(0, 1 - d / s.r);
              const w = fall * fall;
              r += s.c[0] * w; g += s.c[1] * w; b += s.c[2] * w;
            }
            const i = (y * RW + x) * 3;
            base[i] = r; base[i + 1] = g; base[i + 2] = b;
          }
        }
      }
      buildScene();

      // 컨트롤 상태
      const st = {
        vignette: true, vigAmt: 0.6,
        bloom: true, bloomThr: 1.0, bloomAmt: 0.8,
        chroma: false, chromaAmt: 0.5,
        grain: false, grainAmt: 0.4,
      };

      const img = S.ctx.createImageData(RW, RH);

      function render() {
        // 작업 버퍼(선형)에 base 복사
        const buf = render._buf || (render._buf = new Float32Array(RW * RH * 3));
        buf.set(base);

        // --- 블룸: 임계값 넘는 밝은 픽셀 추출 -> 블러 -> 더하기 ---
        if (st.bloom) {
          const bright = render._br || (render._br = new Float32Array(RW * RH * 3));
          for (let i = 0; i < buf.length; i += 3) {
            const lum = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
            const k = lum > st.bloomThr ? 1 : 0;
            bright[i] = buf[i] * k; bright[i + 1] = buf[i + 1] * k; bright[i + 2] = buf[i + 2] * k;
          }
          boxBlur(bright, RW, RH, 4);
          boxBlur(bright, RW, RH, 4); // 두 번으로 더 부드럽게
          for (let i = 0; i < buf.length; i++) buf[i] += bright[i] * st.bloomAmt;
        }

        // ImageData 채우기 (색수차/비네트/그레인은 여기서 픽셀별 처리)
        const d = img.data;
        const cx = RW / 2, cy = RH / 2, maxR = Math.hypot(cx, cy);
        for (let y = 0; y < RH; y++) {
          for (let x = 0; x < RW; x++) {
            const idx = (y * RW + x);
            let r, g, b;
            if (st.chroma) {
              // 색수차: 중심에서 멀수록 R/B 채널을 반경 방향으로 오프셋
              const dx = x - cx, dy = y - cy;
              const dist = Math.hypot(dx, dy) / maxR;
              const off = st.chromaAmt * 6 * dist;
              const nx = dist > 0 ? dx / (dist * maxR) : 0;
              const ny = dist > 0 ? dy / (dist * maxR) : 0;
              r = sample(buf, RW, RH, x + nx * off, y + ny * off, 0);
              g = buf[idx * 3 + 1];
              b = sample(buf, RW, RH, x - nx * off, y - ny * off, 2);
            } else {
              r = buf[idx * 3]; g = buf[idx * 3 + 1]; b = buf[idx * 3 + 2];
            }

            // 비네트: 가장자리 어둡게
            if (st.vignette) {
              const dx = (x - cx) / cx, dy = (y - cy) / cy;
              const vg = 1 - st.vigAmt * clamp(dx * dx + dy * dy, 0, 1);
              r *= vg; g *= vg; b *= vg;
            }

            // 필름 그레인: 무작위 노이즈
            if (st.grain) {
              const n = (Math.random() - 0.5) * st.grainAmt * 0.5;
              r += n; g += n; b += n;
            }

            // 톤매핑(Reinhard) + 감마로 표시
            const p = idx * 4;
            d[p] = tonemap(r); d[p + 1] = tonemap(g); d[p + 2] = tonemap(b); d[p + 3] = 255;
          }
        }
        draw();
      }

      function draw() {
        GFX.clear(S.ctx, S.w, S.h);
        blit(S.ctx, img, S.w, S.h);
        GFX.text(S.ctx, "화면 이미지 후처리 (3D 재계산 없음)", 10, 18, "#fff",
          "12px sans-serif");
      }

      // UI
      GFX.checkbox(ctl, "비네트", st.vignette, (v) => { st.vignette = v; render(); });
      GFX.slider(ctl, { label: "비네트 강도", min: 0, max: 1, step: 0.05, value: st.vigAmt,
        onInput: (v) => { st.vigAmt = v; render(); } });
      GFX.checkbox(ctl, "블룸(빛번짐)", st.bloom, (v) => { st.bloom = v; render(); });
      GFX.slider(ctl, { label: "블룸 임계값", min: 0.4, max: 2.5, step: 0.05, value: st.bloomThr,
        onInput: (v) => { st.bloomThr = v; render(); } });
      GFX.slider(ctl, { label: "블룸 강도", min: 0, max: 2, step: 0.05, value: st.bloomAmt,
        onInput: (v) => { st.bloomAmt = v; render(); } });
      GFX.checkbox(ctl, "색수차", st.chroma, (v) => { st.chroma = v; render(); });
      GFX.slider(ctl, { label: "색수차 강도", min: 0, max: 1, step: 0.05, value: st.chromaAmt,
        onInput: (v) => { st.chromaAmt = v; render(); } });
      GFX.checkbox(ctl, "필름 그레인", st.grain, (v) => { st.grain = v; render(); });
      GFX.slider(ctl, { label: "그레인 강도", min: 0, max: 1, step: 0.05, value: st.grainAmt,
        onInput: (v) => { st.grainAmt = v; render(); } });

      S.onResize = (function (orig) { return function () { orig(); draw(); }; })(S.onResize);
      window.addEventListener("resize", draw);
      render();
    } catch (e) { console.error("screenspace demo error", e); }
  }

  // Reinhard 톤매핑 + 감마 2.2 -> 0..255
  function tonemap(c) {
    c = Math.max(0, c);
    c = c / (1 + c);
    return clamp(Math.pow(c, 1 / 2.2) * 255, 0, 255);
  }
  // 선형 버퍼 채널 이중선형 샘플
  function sample(buf, w, h, x, y, ch) {
    x = clamp(x, 0, w - 1.001); y = clamp(y, 0, h - 1.001);
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const i00 = (y0 * w + x0) * 3 + ch;
    const i10 = (y0 * w + x0 + 1) * 3 + ch;
    const i01 = ((y0 + 1) * w + x0) * 3 + ch;
    const i11 = ((y0 + 1) * w + x0 + 1) * 3 + ch;
    const top = buf[i00] * (1 - fx) + buf[i10] * fx;
    const bot = buf[i01] * (1 - fx) + buf[i11] * fx;
    return top * (1 - fy) + bot * fy;
  }
  // 간단한 박스 블러 (분리형, in-place)
  function boxBlur(buf, w, h, r) {
    const tmp = new Float32Array(buf.length);
    const norm = 1 / (2 * r + 1);
    // 가로
    for (let y = 0; y < h; y++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let x = -r; x <= r; x++) sum += buf[(y * w + clamp(x, 0, w - 1)) * 3 + c];
        for (let x = 0; x < w; x++) {
          tmp[(y * w + x) * 3 + c] = sum * norm;
          const add = buf[(y * w + clamp(x + r + 1, 0, w - 1)) * 3 + c];
          const sub = buf[(y * w + clamp(x - r, 0, w - 1)) * 3 + c];
          sum += add - sub;
        }
      }
    }
    // 세로
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let y = -r; y <= r; y++) sum += tmp[(clamp(y, 0, h - 1) * w + x) * 3 + c];
        for (let y = 0; y < h; y++) {
          buf[(y * w + x) * 3 + c] = sum * norm;
          const add = tmp[(clamp(y + r + 1, 0, h - 1) * w + x) * 3 + c];
          const sub = tmp[(clamp(y - r, 0, h - 1) * w + x) * 3 + c];
          sum += add - sub;
        }
      }
    }
  }

  /* ==========================================================
     레이-구/평면 교차 유틸 (레이트레이서 & 패스트레이서 공용)
     ========================================================== */
  // 구 교차: 반환 t(>0) 또는 -1
  function hitSphere(ro, rd, c, rad) {
    const oc = V.sub(ro, c);
    const b = V.dot(oc, rd);
    const cc = V.dot(oc, oc) - rad * rad;
    const disc = b * b - cc;
    if (disc < 0) return -1;
    const s = Math.sqrt(disc);
    let t = -b - s;
    if (t > 1e-4) return t;
    t = -b + s;
    return t > 1e-4 ? t : -1;
  }

  /* ==========================================================
     2) 레이 트레이싱 — 실제 소프트웨어 레이트레이서
     - 구 3개(하나 반사) + 체커 바닥 + 방향광
     - 프라이머리 -> Phong + 그림자 레이 + 재귀 반사(N bounce)
     ========================================================== */
  function initRayTracing() {
    if (!document.getElementById("c-raytracing")) return;
    try {
      const S = GFX.setup("c-raytracing");
      const ctl = document.getElementById("ctl-raytracing");
      const RW = 240, RH = Math.round(240 * (S.h / S.w)) || 160;

      // 장면 정의
      const spheres = [
        { c: [-1.1, 0.0, -1.0], r: 0.5, col: [0.9, 0.3, 0.3], refl: 0.0 },
        { c: [0.0, 0.0, -1.2], r: 0.5, col: [0.8, 0.8, 0.85], refl: 0.8 }, // 반사 구
        { c: [1.1, -0.1, -1.0], r: 0.4, col: [0.3, 0.6, 0.9], refl: 0.15 },
      ];
      const st = { bounces: 3, lightAng: 0.9, spherePos: 0.0 };

      function lightDir() {
        // 조명 각도로 방향광 회전
        return V.norm([Math.cos(st.lightAng), 0.9, Math.sin(st.lightAng) - 0.3]);
      }

      // 체커 바닥 y=-0.5
      const FLOOR_Y = -0.5;
      function floorHit(ro, rd) {
        if (Math.abs(rd[1]) < 1e-6) return -1;
        const t = (FLOOR_Y - ro[1]) / rd[1];
        return t > 1e-4 ? t : -1;
      }

      // 장면 교차: 반환 {t, n, col, refl} 또는 null
      function trace(ro, rd) {
        let best = Infinity, hit = null;
        // 구들 (spherePos로 첫 구를 좌우로 이동)
        for (let k = 0; k < spheres.length; k++) {
          const sp = spheres[k];
          const c = k === 0 ? [sp.c[0] + st.spherePos, sp.c[1], sp.c[2]] : sp.c;
          const t = hitSphere(ro, rd, c, sp.r);
          if (t > 0 && t < best) {
            best = t;
            const p = V.add(ro, V.scale(rd, t));
            hit = { t, p, n: V.norm(V.sub(p, c)), col: sp.col, refl: sp.refl };
          }
        }
        // 바닥
        const tf = floorHit(ro, rd);
        if (tf > 0 && tf < best) {
          const p = V.add(ro, V.scale(rd, tf));
          if (Math.abs(p[0]) < 6 && p[2] > -8 && p[2] < 2) {
            const chk = (Math.floor(p[0] * 1.5 + 100) + Math.floor(p[2] * 1.5 + 100)) & 1;
            const col = chk ? [0.9, 0.9, 0.9] : [0.2, 0.2, 0.22];
            hit = { t: tf, p, n: [0, 1, 0], col, refl: 0.05 };
          }
        }
        return hit;
      }

      // 그림자 판정: 광원 방향으로 막힘?
      function inShadow(p, ld) {
        const ro = V.add(p, V.scale(ld, 1e-3));
        for (let k = 0; k < spheres.length; k++) {
          const sp = spheres[k];
          const c = k === 0 ? [sp.c[0] + st.spherePos, sp.c[1], sp.c[2]] : sp.c;
          if (hitSphere(ro, ld, c, sp.r) > 0) return true;
        }
        return false;
      }

      // 재귀 레이 색상
      function shade(ro, rd, depth) {
        const h = trace(ro, rd);
        if (!h) {
          // 하늘 그라디언트
          const t = 0.5 * (rd[1] + 1);
          return [GFX.lerp(0.9, 0.4, t), GFX.lerp(0.95, 0.6, t), GFX.lerp(1.0, 0.95, t)];
        }
        const ld = lightDir();
        const n = h.n;
        // Phong 확산 + 앰비언트
        let diff = Math.max(0, V.dot(n, ld));
        if (diff > 0 && inShadow(h.p, ld)) diff = 0;
        const amb = 0.12;
        let col = V.scale(h.col, amb + diff * 0.9);
        // 스펙큘러
        if (diff > 0) {
          const viewR = V.sub(V.scale(n, 2 * V.dot(n, ld)), ld);
          const spec = Math.pow(Math.max(0, -V.dot(rd, viewR)), 32);
          col = V.add(col, [spec * 0.6, spec * 0.6, spec * 0.6]);
        }
        // 재귀 반사
        if (h.refl > 0 && depth > 0) {
          const rr = V.sub(rd, V.scale(n, 2 * V.dot(rd, n)));
          const rc = shade(V.add(h.p, V.scale(rr, 1e-3)), V.norm(rr), depth - 1);
          col = V.add(V.scale(col, 1 - h.refl), V.scale(rc, h.refl));
        }
        return col;
      }

      const img = S.ctx.createImageData(RW, RH);
      const eye = [0, 0.3, 1.2];

      function render() {
        const d = img.data;
        const aspect = RW / RH;
        for (let y = 0; y < RH; y++) {
          for (let x = 0; x < RW; x++) {
            // 화면 -> 카메라 광선
            const u = (x / RW * 2 - 1) * aspect * 0.6;
            const v = (1 - y / RH * 2) * 0.6;
            const rd = V.norm([u, v - 0.05, -1]);
            const col = shade(eye, rd, st.bounces);
            const p = (y * RW + x) * 4;
            d[p] = tonemap(col[0]); d[p + 1] = tonemap(col[1]);
            d[p + 2] = tonemap(col[2]); d[p + 3] = 255;
          }
        }
        draw();
      }
      function draw() {
        GFX.clear(S.ctx, S.w, S.h);
        blit(S.ctx, img, S.w, S.h);
        GFX.text(S.ctx, "반사 bounce: " + st.bounces, 10, 18, "#fff", "12px sans-serif");
      }

      // 디바운스 렌더
      let pending = null;
      function requestRender() {
        if (pending) return;
        pending = setTimeout(() => { pending = null; render(); }, 30);
      }

      GFX.slider(ctl, { label: "반사 횟수(bounce)", min: 0, max: 5, step: 1, value: st.bounces,
        onInput: (v) => { st.bounces = v; requestRender(); } });
      GFX.slider(ctl, { label: "조명 각도", min: 0, max: 6.28, step: 0.05, value: st.lightAng,
        format: (v) => (v * 57.3).toFixed(0) + "°",
        onInput: (v) => { st.lightAng = v; requestRender(); } });
      GFX.slider(ctl, { label: "빨간 구 위치", min: -1.5, max: 1.5, step: 0.05, value: st.spherePos,
        onInput: (v) => { st.spherePos = v; requestRender(); } });
      GFX.button(ctl, "다시 렌더", () => render());

      window.addEventListener("resize", draw);
      render();
    } catch (e) { console.error("raytracing demo error", e); }
  }

  /* ==========================================================
     Cornell Box 장면 (패스트레이서 & GI 공용)
     6면 박스 + 좌(빨강)/우(초록) 벽 + 천장 광원 + 구 2개
     좌표: 박스 [-1,1] x, [-1,1] y, [-1,1] z, 카메라는 +z에서 -z 응시
     ========================================================== */
  function cornellScene() {
    const spheres = [
      { c: [-0.4, -0.6, -0.35], r: 0.4, col: [0.85, 0.85, 0.85] },
      { c: [0.45, -0.7, 0.25], r: 0.3, col: [0.85, 0.85, 0.85] },
    ];
    // 평면: {p0(축상 값), axis, dir, col}  간단히 6개 벽을 개별 처리
    // 광원: 천장 사각형
    const light = { y: 0.99, x0: -0.35, x1: 0.35, z0: -0.35, z1: 0.35, emit: [12, 11, 9] };
    return { spheres, light };
  }

  // Cornell 교차: 반환 {t,p,n,col,emit}
  function cornellHit(ro, rd, sc) {
    let best = Infinity, hit = null;
    function consider(t, n, col, emit) {
      if (t > 1e-4 && t < best) {
        best = t;
        hit = { t, p: V.add(ro, V.scale(rd, t)), n, col, emit: emit || null };
      }
    }
    // 구
    for (const sp of sc.spheres) {
      const t = hitSphere(ro, rd, sp.c, sp.r);
      if (t > 0 && t < best) {
        best = t;
        const p = V.add(ro, V.scale(rd, t));
        hit = { t, p, n: V.norm(V.sub(p, sp.c)), col: sp.col, emit: null };
      }
    }
    // 벽 6면 (평면 교차, 범위 체크)
    const W = [0.72, 0.72, 0.72];        // 흰 벽
    const RED = [0.75, 0.2, 0.2], GRN = [0.2, 0.7, 0.25];
    // 좌벽 x=-1 (빨강)
    if (rd[0] !== 0) { const t = (-1 - ro[0]) / rd[0]; if (t > 1e-4) { const p = V.add(ro, V.scale(rd, t)); if (Math.abs(p[1]) <= 1 && Math.abs(p[2]) <= 1) consider(t, [1, 0, 0], RED); } }
    // 우벽 x=1 (초록)
    if (rd[0] !== 0) { const t = (1 - ro[0]) / rd[0]; if (t > 1e-4) { const p = V.add(ro, V.scale(rd, t)); if (Math.abs(p[1]) <= 1 && Math.abs(p[2]) <= 1) consider(t, [-1, 0, 0], GRN); } }
    // 바닥 y=-1
    if (rd[1] !== 0) { const t = (-1 - ro[1]) / rd[1]; if (t > 1e-4) { const p = V.add(ro, V.scale(rd, t)); if (Math.abs(p[0]) <= 1 && Math.abs(p[2]) <= 1) consider(t, [0, 1, 0], W); } }
    // 천장 y=1
    if (rd[1] !== 0) {
      const t = (1 - ro[1]) / rd[1];
      if (t > 1e-4) {
        const p = V.add(ro, V.scale(rd, t));
        if (Math.abs(p[0]) <= 1 && Math.abs(p[2]) <= 1) {
          const L = sc.light;
          const isLight = p[0] >= L.x0 && p[0] <= L.x1 && p[2] >= L.z0 && p[2] <= L.z1;
          consider(t, [0, -1, 0], W, isLight ? L.emit : null);
        }
      }
    }
    // 뒷벽 z=-1
    if (rd[2] !== 0) { const t = (-1 - ro[2]) / rd[2]; if (t > 1e-4) { const p = V.add(ro, V.scale(rd, t)); if (Math.abs(p[0]) <= 1 && Math.abs(p[1]) <= 1) consider(t, [0, 0, 1], W); } }
    return hit;
  }

  // 반구 코사인 가중 랜덤 방향 (법선 n 기준)
  function cosineHemisphere(n) {
    const u1 = Math.random(), u2 = Math.random();
    const r = Math.sqrt(u1), theta = 2 * Math.PI * u2;
    const x = r * Math.cos(theta), y = r * Math.sin(theta), z = Math.sqrt(1 - u1);
    // n 기준 탄젠트 공간
    const a = Math.abs(n[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
    const t = V.norm(V.cross3(a, n));
    const b = V.cross3(n, t);
    return V.norm([
      t[0] * x + b[0] * y + n[0] * z,
      t[1] * x + b[1] * y + n[1] * z,
      t[2] * x + b[2] * y + n[2] * z,
    ]);
  }

  /* ==========================================================
     3) 패스 트레이싱 — 누적 진행형
     매 프레임 픽셀당 1샘플, 반구 랜덤 바운스(확산 GI), 평균 누적.
     ========================================================== */
  function initPathTracing() {
    if (!document.getElementById("c-pathtracing")) return;
    try {
      const S = GFX.setup("c-pathtracing");
      const ctl = document.getElementById("ctl-pathtracing");
      const RW = 176, RH = 176;
      const sc = cornellScene();
      const eye = [0, 0, 3.0];
      const fov = 0.55;

      const accum = new Float32Array(RW * RH * 3); // 누적 합
      let samples = 0;
      let running = false;
      const img = S.ctx.createImageData(RW, RH);

      // 한 경로 추적 (러시안 룰렛 없이 고정 depth)
      function radiance(ro, rd, maxDepth) {
        let throughput = [1, 1, 1];
        let acc = [0, 0, 0];
        for (let depth = 0; depth < maxDepth; depth++) {
          const h = cornellHit(ro, rd, sc);
          if (!h) break;
          if (h.emit) { // 광원에 도달 -> 방출광 * 누적 throughput
            acc = V.add(acc, [throughput[0] * h.emit[0], throughput[1] * h.emit[1], throughput[2] * h.emit[2]]);
            break;
          }
          // 확산 반사: throughput에 알베도 곱, 코사인 반구 샘플
          throughput = [throughput[0] * h.col[0], throughput[1] * h.col[1], throughput[2] * h.col[2]];
          ro = V.add(h.p, V.scale(h.n, 1e-3));
          rd = cosineHemisphere(h.n);
        }
        return acc;
      }

      function addSamples(count) {
        const aspect = RW / RH;
        for (let s = 0; s < count; s++) {
          for (let y = 0; y < RH; y++) {
            for (let x = 0; x < RW; x++) {
              // 픽셀 내 지터로 안티에일리어싱
              const u = ((x + Math.random()) / RW * 2 - 1) * aspect * fov;
              const v = (1 - (y + Math.random()) / RH * 2) * fov;
              const rd = V.norm([u, v, -1]);
              const col = radiance(eye, rd, 4);
              const i = (y * RW + x) * 3;
              accum[i] += col[0]; accum[i + 1] += col[1]; accum[i + 2] += col[2];
            }
          }
          samples++;
        }
      }

      function present() {
        const d = img.data;
        const inv = samples > 0 ? 1 / samples : 0;
        for (let i = 0, p = 0; i < accum.length; i += 3, p += 4) {
          d[p] = tonemap(accum[i] * inv);
          d[p + 1] = tonemap(accum[i + 1] * inv);
          d[p + 2] = tonemap(accum[i + 2] * inv);
          d[p + 3] = 255;
        }
        GFX.clear(S.ctx, S.w, S.h);
        blit(S.ctx, img, S.w, S.h);
        GFX.text(S.ctx, "샘플 수: " + samples + (running ? " (누적 중…)" : " (정지)"),
          10, 18, "#fff", "13px sans-serif");
      }

      function reset() {
        accum.fill(0); samples = 0; present();
      }

      // 루프: 프레임당 소량 샘플만 (반응성 유지)
      GFX.loop(() => {
        if (running && samples < 4000) {
          addSamples(1);
          present();
        }
      }, S.canvas);

      GFX.button(ctl, "누적 시작/정지", (e) => {
        running = !running;
        e.target.textContent = running ? "정지" : "누적 시작";
      });
      GFX.button(ctl, "리셋", () => reset(), true);

      reset();
      addSamples(6);   // 초기 미리보기: "누적 시작" 전에도 (노이즈 있는) 장면이 바로 보이도록
      present();
      window.addEventListener("resize", present);
    } catch (e) { console.error("pathtracing demo error", e); }
  }

  /* ==========================================================
     4) 전역 조명(GI) — 직접광 only vs GI 비교
     같은 Cornell 장면을 두 방식으로 렌더:
       (a) 직접광만: 광원 가시성 + 하드 그림자 -> 그림자 새까맘, 색번짐 없음
       (b) GI: 간접 바운스 추가 -> 그림자 채워지고 벽 색이 이웃을 물들임
     GI는 반구 몬테카를로 몇 샘플로 적분(픽셀당 소량, 낮은 해상도).
     ========================================================== */
  function initGI() {
    if (!document.getElementById("c-gi")) return;
    try {
      const S = GFX.setup("c-gi");
      const ctl = document.getElementById("ctl-gi");
      const RW = 150, RH = 150;
      const sc = cornellScene();
      const eye = [0, 0, 3.0];
      const fov = 0.55;
      const st = { gi: true, bounces: 2, spp: 24 };

      // 광원 중심으로의 직접광 (한 점 샘플로 하드 그림자)
      const Lc = [0, sc.light.y - 0.001, 0];
      const Lemit = sc.light.emit;

      // 광원까지 가리는가?
      function visible(p) {
        const dir = V.sub(Lc, p);
        const dist = V.len(dir);
        const ld = V.scale(dir, 1 / dist);
        const ro = V.add(p, V.scale(ld, 1e-3));
        const h = cornellHit(ro, ld, sc);
        // 광원 근처(거의 도달)면 가시
        return !h || h.t >= dist - 1e-2 || h.emit;
      }

      // 표면의 직접광 기여
      function directLight(p, n) {
        const dir = V.sub(Lc, p);
        const dist2 = V.dot(dir, dir);
        const ld = V.scale(dir, 1 / Math.sqrt(dist2));
        const ndl = Math.max(0, V.dot(n, ld));
        if (ndl <= 0 || !visible(p)) return [0, 0, 0];
        const atten = ndl / (0.6 + dist2 * 0.5);
        return V.scale(Lemit, atten * 0.12);
      }

      // 한 픽셀 색 계산. gi=false면 직접광만, true면 간접 바운스 추가.
      function pixel(ro, rd, gi, bounces) {
        const h = cornellHit(ro, rd, sc);
        if (!h) return [0, 0, 0];
        if (h.emit) return h.emit; // 광원 직접 보기
        // 직접광 항
        const dl = directLight(h.p, h.n);
        let col = [h.col[0] * dl[0], h.col[1] * dl[1], h.col[2] * dl[2]];
        col = V.add(col, [h.col[0] * 0.02, h.col[1] * 0.02, h.col[2] * 0.02]); // 미세 앰비언트

        if (gi && bounces > 0) {
          // 간접광: 반구 샘플로 다음 표면들의 직접광을 모아 색번짐 생성
          let indirect = [0, 0, 0];
          const NS = 6; // 간접 샘플 수 (성능 균형)
          for (let s = 0; s < NS; s++) {
            const nd = cosineHemisphere(h.n);
            const o = V.add(h.p, V.scale(h.n, 1e-3));
            const hh = cornellHit(o, nd, sc);
            if (!hh) continue;
            if (hh.emit) { indirect = V.add(indirect, hh.emit); continue; }
            let bounce = directLight(hh.p, hh.n);
            bounce = [hh.col[0] * bounce[0], hh.col[1] * bounce[1], hh.col[2] * bounce[2]];
            // 한 단계 더 (2차 바운스)
            if (bounces > 1) {
              const nd2 = cosineHemisphere(hh.n);
              const o2 = V.add(hh.p, V.scale(hh.n, 1e-3));
              const h2 = cornellHit(o2, nd2, sc);
              if (h2 && !h2.emit) {
                let b2 = directLight(h2.p, h2.n);
                b2 = [h2.col[0] * b2[0], h2.col[1] * b2[1], h2.col[2] * b2[2]];
                bounce = V.add(bounce, V.scale(b2, 0.6));
              } else if (h2 && h2.emit) {
                bounce = V.add(bounce, V.scale(h2.emit, 0.3));
              }
            }
            indirect = V.add(indirect, bounce);
          }
          indirect = V.scale(indirect, 1 / NS);
          // 알베도로 물들임 (색번짐)
          col = V.add(col, [h.col[0] * indirect[0], h.col[1] * indirect[1], h.col[2] * indirect[2]]);
        }
        return col;
      }

      const img = S.ctx.createImageData(RW, RH);

      function render() {
        const d = img.data;
        const aspect = RW / RH;
        const spp = st.gi ? 2 : 1; // GI일 때만 픽셀당 몇 샘플로 노이즈 완화
        for (let y = 0; y < RH; y++) {
          for (let x = 0; x < RW; x++) {
            let r = 0, g = 0, b = 0;
            for (let s = 0; s < spp; s++) {
              const u = ((x + (spp > 1 ? Math.random() : 0.5)) / RW * 2 - 1) * aspect * fov;
              const v = (1 - (y + (spp > 1 ? Math.random() : 0.5)) / RH * 2) * fov;
              const rd = V.norm([u, v, -1]);
              const col = pixel(eye, rd, st.gi, st.bounces);
              r += col[0]; g += col[1]; b += col[2];
            }
            const inv = 1 / spp;
            const p = (y * RW + x) * 4;
            d[p] = tonemap(r * inv); d[p + 1] = tonemap(g * inv); d[p + 2] = tonemap(b * inv); d[p + 3] = 255;
          }
        }
        draw();
      }

      function draw() {
        GFX.clear(S.ctx, S.w, S.h);
        blit(S.ctx, img, S.w, S.h);
        GFX.text(S.ctx, st.gi ? "전역 조명(GI) 켜짐 — 그림자·색번짐 있음"
          : "직접광 only — 그림자 새까맘, 색번짐 없음",
          10, 18, "#fff", "12px sans-serif");
      }

      // 무거운 렌더는 다음 프레임에 (UI 반응성)
      let pending = false;
      function requestRender() {
        if (pending) return; pending = true;
        requestAnimationFrame(() => { pending = false; render(); });
      }

      GFX.checkbox(ctl, "전역 조명(GI) 켜기", st.gi, (v) => { st.gi = v; requestRender(); });
      GFX.slider(ctl, { label: "간접 바운스", min: 1, max: 2, step: 1, value: st.bounces,
        onInput: (v) => { st.bounces = v; requestRender(); } });
      GFX.button(ctl, "다시 렌더", () => render());

      window.addEventListener("resize", draw);
      render();
    } catch (e) { console.error("gi demo error", e); }
  }

})();
