/* ============================================================
   demos-adv3.js — 고급 데모 3편
   1) 안티앨리어싱 (슈퍼샘플링)  2) 감마 · 선형 색공간
   3) 밉맵 · 텍스처 필터링
   전역 GFX 헬퍼를 사용한다. 모든 UI 텍스트는 한국어.
   소프트웨어 래스터라이즈는 ImageData/오프스크린 캔버스로 처리하고
   성능을 위해 렌더 해상도는 낮게 둔다.
   ============================================================ */
(function () {
  "use strict";

  const { COL, clamp } = GFX;

  // 낮은 해상도 ImageData를 캔버스 영역에 확대 복사 (픽셀 보간 off)
  function blit(ctx, img, dx, dy, dstW, dstH) {
    let tmp = blit._tmp;
    if (!tmp || tmp.width !== img.width || tmp.height !== img.height) {
      tmp = blit._tmp = document.createElement("canvas");
      tmp.width = img.width; tmp.height = img.height;
    }
    tmp.getContext("2d").putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, img.width, img.height, dx, dy, dstW, dstH);
    ctx.imageSmoothingEnabled = true;
  }

  GFX.deferInit("c-aa", initAA);
  GFX.deferInit("c-gamma", initGamma);
  GFX.deferInit("c-mipmap", initMipmap);

  /* ==========================================================
     1) 안티앨리어싱 — 슈퍼샘플링
     - 회전한 삼각형을 소프트웨어로 저해상도 래스터라이즈.
     - 왼쪽: 샘플 1개(계단), 오른쪽: NxN 샘플 평균(부드러움).
     - 경계 영역을 확대해서 계단→중간톤 전환을 보여준다.
     ========================================================== */
  function initAA() {
    if (!document.getElementById("c-aa")) return;
    try {
      const S = GFX.setup("c-aa");
      const ctl = document.getElementById("ctl-aa");
      let samples = 4;      // 픽셀당 샘플 수 (완전제곱: 1,4,16 -> 실제로는 1,2,4,8,16 슬라이더)
      let angleDeg = 20;    // 엣지 회전각

      // 슬라이더 값(1,2,4,8,16) -> 축당 샘플 수(1,1,2,2,4 등)로 매핑.
      // 완전제곱만 실제 그리드에 쓰므로 가장 가까운 sqrt로 처리.
      const sampleSlider = GFX.slider(ctl, {
        label: "픽셀당 샘플 수", min: 0, max: 4, step: 1, value: 2,
        format: (v) => { const t = [1, 2, 4, 8, 16][+v]; return t + "개"; },
        onInput: (v) => { samples = [1, 2, 4, 8, 16][v | 0]; draw(); },
      });
      GFX.slider(ctl, {
        label: "엣지 회전각", min: -45, max: 45, step: 1, value: 20,
        format: (v) => (+v).toFixed(0) + "°",
        onInput: (v) => { angleDeg = v; draw(); },
      });

      // 삼각형 꼭짓점 (0~1 정규화 좌표계, 캔버스 폭 기준으로 배치)
      // 회전은 중심 (0.5,0.5) 기준으로 적용한다.
      function triVerts(ang) {
        const a = GFX.rad(ang), c = Math.cos(a), s = Math.sin(a);
        const cx = 0.5, cy = 0.5;
        const raw = [
          [0.15, 0.80], [0.85, 0.65], [0.55, 0.12],
        ];
        return raw.map(([x, y]) => {
          const dx = x - cx, dy = y - cy;
          return [cx + dx * c - dy * s, cy + dx * s + dy * c];
        });
      }

      // 점이 삼각형 안인지 (barycentric sign 방식)
      function inside(tri, px, py) {
        const [A, B, C] = tri;
        const d1 = sign(px, py, A, B);
        const d2 = sign(px, py, B, C);
        const d3 = sign(px, py, C, A);
        const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
        const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
        return !(hasNeg && hasPos);
      }
      function sign(px, py, a, b) {
        return (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1]);
      }

      // 한 패널을 저해상도 픽셀 그리드로 래스터라이즈 -> ImageData
      // gw,gh: 픽셀 그리드 크기, n: 축당 샘플 수
      function rasterize(tri, gw, gh, n) {
        const img = new ImageData(gw, gh);
        const data = img.data;
        // 배경색과 도형색 (선형이 아닌 표시색, 간단히 sRGB 그대로 섞음)
        const bg = [22, 26, 38];       // COL.grid 근처
        const fg = [110, 168, 254];    // COL.accent 근처
        for (let y = 0; y < gh; y++) {
          for (let x = 0; x < gw; x++) {
            let cov = 0;
            // 픽셀 내부 NxN 서브샘플 (스터라이드 중앙 정렬)
            for (let sy = 0; sy < n; sy++) {
              for (let sx = 0; sx < n; sx++) {
                const u = (x + (sx + 0.5) / n) / gw;
                const v = (y + (sy + 0.5) / n) / gh;
                if (inside(tri, u, v)) cov++;
              }
            }
            cov /= n * n;
            const i = (y * gw + x) * 4;
            data[i]     = Math.round(bg[0] + (fg[0] - bg[0]) * cov);
            data[i + 1] = Math.round(bg[1] + (fg[1] - bg[1]) * cov);
            data[i + 2] = Math.round(bg[2] + (fg[2] - bg[2]) * cov);
            data[i + 3] = 255;
          }
        }
        return img;
      }

      function draw() {
        const { ctx, w, h } = S;
        GFX.clear(ctx, w, h);
        const tri = triVerts(angleDeg);
        const n = Math.round(Math.sqrt(samples)); // 축당 샘플 수 (1,~1.4->1,2,~2.8->3,4)
        const nAxis = Math.max(1, Math.round(Math.sqrt(samples)));

        const pad = 12;
        const panelW = (w - pad * 3) / 2;
        const panelH = h - 70;
        const grid = 40; // 저해상도 픽셀 그리드 (계단이 잘 보이게)

        // 왼쪽: AA 없음 (1샘플)
        drawPanel(ctx, pad, 40, panelW, panelH, tri, grid, 1, "AA 없음 (1샘플)", COL.red);
        // 오른쪽: 현재 샘플 수
        drawPanel(ctx, pad * 2 + panelW, 40, panelW, panelH, tri, grid, nAxis,
          nAxis * nAxis + "샘플/픽셀 (" + nAxis + "×" + nAxis + ")", COL.green);

        GFX.text(ctx, "소프트웨어 슈퍼샘플링: 픽셀 안 여러 지점을 검사해 커버리지를 평균",
          w / 2, 20, COL.dim, "13px sans-serif", "center");
      }

      function drawPanel(ctx, x, y, pw, ph, tri, grid, n, label, labelCol) {
        const img = rasterize(tri, grid, grid, n);
        blit(ctx, img, x, y, pw, ph);
        // 테두리
        ctx.strokeStyle = COL.gridAxis; ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, pw, ph);
        GFX.text(ctx, label, x + pw / 2, y + ph + 16, labelCol, "bold 13px sans-serif", "center");

        // 경계 영역 확대 인셋: 삼각형 오른쪽 위 경사 근처를 확대
        const insetSize = Math.min(pw, ph) * 0.42;
        const ix = x + pw - insetSize - 6, iy = y + 6;
        // 확대할 텍셀 영역 (그리드의 일부)
        const zg = 8; // 8x8 픽셀 확대
        const zx0 = Math.round(grid * 0.55), zy0 = Math.round(grid * 0.30);
        const zimg = rasterizeRegion(tri, grid, zx0, zy0, zg, n);
        blit(ctx, zimg, ix, iy, insetSize, insetSize);
        ctx.strokeStyle = COL.yellow; ctx.lineWidth = 1.5;
        ctx.strokeRect(ix + 0.5, iy + 0.5, insetSize, insetSize);
        GFX.text(ctx, "확대", ix + 3, iy + insetSize - 8, COL.yellow, "11px sans-serif", "left");

        // 확대 인셋에 샘플점 오버레이 (n>1일 때)
        if (n > 1) {
          const cell = insetSize / zg;
          ctx.fillStyle = "rgba(255,255,255,0.75)";
          for (let cy = 0; cy < zg; cy++) {
            for (let cx = 0; cx < zg; cx++) {
              for (let sy = 0; sy < n; sy++) {
                for (let sx = 0; sx < n; sx++) {
                  const px = ix + (cx + (sx + 0.5) / n) * cell;
                  const py = iy + (cy + (sy + 0.5) / n) * cell;
                  ctx.fillRect(px - 0.6, py - 0.6, 1.2, 1.2);
                }
              }
            }
          }
        }
      }

      // 그리드의 특정 영역(zx0,zy0에서 zg×zg 픽셀)만 확대 래스터라이즈
      function rasterizeRegion(tri, grid, zx0, zy0, zg, n) {
        const img = new ImageData(zg, zg);
        const data = img.data;
        const bg = [22, 26, 38], fg = [110, 168, 254];
        for (let y = 0; y < zg; y++) {
          for (let x = 0; x < zg; x++) {
            let cov = 0;
            const gx = zx0 + x, gy = zy0 + y;
            for (let sy = 0; sy < n; sy++) {
              for (let sx = 0; sx < n; sx++) {
                const u = (gx + (sx + 0.5) / n) / grid;
                const v = (gy + (sy + 0.5) / n) / grid;
                if (inside(tri, u, v)) cov++;
              }
            }
            cov /= n * n;
            const i = (y * zg + x) * 4;
            data[i]     = Math.round(bg[0] + (fg[0] - bg[0]) * cov);
            data[i + 1] = Math.round(bg[1] + (fg[1] - bg[1]) * cov);
            data[i + 2] = Math.round(bg[2] + (fg[2] - bg[2]) * cov);
            data[i + 3] = 255;
          }
        }
        return img;
      }

      draw();
      S.onResize = ((orig) => function () { orig(); draw(); })(S.onResize);
      window.addEventListener("resize", () => draw());
    } catch (e) { console.error("initAA 오류:", e); }
  }

  /* ==========================================================
     2) 감마 · 선형 색공간
     (A) 그라디언트 + "128 회색 vs 감마보정 회색" 을 흑백 체커보드와 비교
     (B) 빨강+초록 블렌딩: sRGB 평균(탁함) vs 선형 평균(밝고 정확)
     ========================================================== */
  function initGamma() {
    if (!document.getElementById("c-gamma")) return;
    try {
      const S = GFX.setup("c-gamma");
      const ctl = document.getElementById("ctl-gamma");
      let gamma = 2.2;
      let linear = true; // 선형 공간에서 계산 여부

      // sRGB(0~1) <-> 선형(0~1). 컨트롤 생성 시 draw()가 즉시 호출되므로 먼저 선언(TDZ 방지)
      const toLinear = (c) => Math.pow(c, gamma);
      const toSRGB = (c) => Math.pow(c, 1 / gamma);

      GFX.slider(ctl, {
        label: "감마 값", min: 1.0, max: 3.0, step: 0.1, value: 2.2,
        format: (v) => (+v).toFixed(1),
        onInput: (v) => { gamma = v; draw(); },
      });
      GFX.checkbox(ctl, "선형 공간에서 계산", true, (c) => { linear = c; draw(); });

      function draw() {
        const { ctx, w, h } = S;
        GFX.clear(ctx, w, h);

        const pad = 14;
        // 상단: 그라디언트 + 회색 매칭 테스트
        const topH = Math.round((h - pad * 3) * 0.52);
        drawGrayTest(ctx, pad, pad, w - pad * 2, topH);
        // 하단: 색 블렌딩 비교
        const botY = pad * 2 + topH;
        drawBlend(ctx, pad, botY, w - pad * 2, h - botY - pad);
      }

      // (A) 128 회색 vs 감마보정 회색 을 흑백 체커보드와 비교
      function drawGrayTest(ctx, x, y, bw, bh) {
        GFX.text(ctx, "회색 매칭 테스트 — 실눈으로 보세요. 체커(진짜 50% 빛)와 같은 회색은?",
          x, y + 8, COL.dim, "12px sans-serif", "left");
        const top = y + 22;
        const rowH = bh - 34;
        const cellW = (bw - 16) / 3;

        // 1) 흑백 체커보드 (평균이 진짜 50% 빛)
        drawChecker(ctx, x, top, cellW, rowH);
        // 2) value 128 솔리드 (sRGB 128 = 순진한 중간회색)
        ctx.fillStyle = "rgb(128,128,128)";
        ctx.fillRect(x + cellW + 8, top, cellW, rowH);
        // 3) 감마보정 회색: 선형 0.5 -> sRGB. gamma=2.2면 약 188
        const gv = Math.round(255 * toSRGB(0.5));
        ctx.fillStyle = "rgb(" + gv + "," + gv + "," + gv + ")";
        ctx.fillRect(x + cellW * 2 + 16, top, cellW, rowH);

        const ly = top + rowH + 12;
        GFX.text(ctx, "흑백 체커 = 50% 빛", x + cellW / 2, ly, COL.text, "11px sans-serif", "center");
        GFX.text(ctx, "값 128 (순진)", x + cellW * 1.5 + 8, ly, COL.red, "11px sans-serif", "center");
        GFX.text(ctx, "값 " + gv + " (감마보정)", x + cellW * 2.5 + 16, ly, COL.green, "11px sans-serif", "center");
      }

      function drawChecker(ctx, x, y, cw, ch) {
        const s = 3; // 체커 셀 크기(px). 촘촘해야 평균으로 보임
        for (let j = 0; j * s < ch; j++) {
          for (let i = 0; i * s < cw; i++) {
            ctx.fillStyle = ((i + j) & 1) ? "#000" : "#fff";
            ctx.fillRect(x + i * s, y + j * s,
              Math.min(s, cw - i * s), Math.min(s, ch - j * s));
          }
        }
      }

      // (B) 빨강 + 초록 블렌딩: sRGB 평균 vs 선형 평균
      function drawBlend(ctx, x, y, bw, bh) {
        GFX.text(ctx, "색 블렌딩: 빨강 + 초록의 중간색",
          x, y + 8, COL.dim, "12px sans-serif", "left");
        const top = y + 22;
        const rowH = bh - 40;
        const red = [1, 0, 0], green = [0, 1, 0];

        // 잘못된 방식: sRGB 값 직접 평균 -> 탁한 어두운 색
        const wrong = red.map((c, i) => (c + green[i]) / 2);
        // 올바른 방식: 선형에서 평균 후 다시 sRGB
        const right = red.map((c, i) => toSRGB((toLinear(c) + toLinear(green[i])) / 2));

        const bw3 = (bw - 16) / 3;
        // 왼쪽: 빨강|초록 원본 두 조각
        ctx.fillStyle = "rgb(255,0,0)"; ctx.fillRect(x, top, bw3 / 2, rowH);
        ctx.fillStyle = "rgb(0,255,0)"; ctx.fillRect(x + bw3 / 2, top, bw3 / 2, rowH);
        // 가운데: 잘못된 블렌딩
        ctx.fillStyle = rgb(wrong); ctx.fillRect(x + bw3 + 8, top, bw3, rowH);
        // 오른쪽: 올바른 블렌딩 (토글 상태와 무관하게 항상 둘 다 보여줌)
        ctx.fillStyle = rgb(right); ctx.fillRect(x + bw3 * 2 + 16, top, bw3, rowH);

        const ly = top + rowH + 14;
        GFX.text(ctx, "원본", x + bw3 / 2, ly, COL.text, "11px sans-serif", "center");
        GFX.text(ctx, "sRGB 평균 (탁함)", x + bw3 * 1.5 + 8, ly, COL.red, "11px sans-serif", "center");
        GFX.text(ctx, "선형 평균 (정확)", x + bw3 * 2.5 + 16, ly, COL.green, "11px sans-serif", "center");

        // 현재 토글 상태에 따라 "실제 사용될" 결과를 강조
        const usedIdx = linear ? 2 : 1;
        const ux = x + bw3 * (usedIdx === 2 ? 2 : 1) + (usedIdx === 2 ? 16 : 8);
        ctx.strokeStyle = COL.yellow; ctx.lineWidth = 2.5;
        ctx.strokeRect(ux - 1, top - 1, bw3 + 2, rowH + 2);
        GFX.text(ctx, "현재 계산 방식: " + (linear ? "선형(정확)" : "sRGB(순진)"),
          x + bw, ly + 16, COL.yellow, "11px sans-serif", "right");
      }

      function rgb(c) {
        return "rgb(" + c.map((v) => Math.round(clamp(v, 0, 1) * 255)).join(",") + ")";
      }

      draw();
      window.addEventListener("resize", () => draw());
    } catch (e) { console.error("initGamma 오류:", e); }
  }

  /* ==========================================================
     3) 밉맵 · 텍스처 필터링
     - 원근 바닥에 체커 텍스처를 픽셀별 소프트웨어 샘플링.
     - 점 샘플링(반짝임) / 이중선형 / 밉맵+삼중선형 전환.
     - 밉 체인 스트립도 표시. 애니메이션으로 반짝임 대비.
     ========================================================== */
  function initMipmap() {
    if (!document.getElementById("c-mipmap")) return;
    try {
      const S = GFX.setup("c-mipmap");
      const ctl = document.getElementById("ctl-mipmap");
      const RW = 360, RH = 240; // 렌더 버퍼 해상도

      let mode = 0; // 0=점, 1=이중선형, 2=밉맵+삼중선형
      let animate = true;
      let scroll = 0;

      // --- 절차적 체커 텍스처와 밉 체인 생성 ---
      const TEX = 128; // 최상위 텍스처 크기(정사각)
      const mips = buildMips(TEX);

      function buildMips(size) {
        const chain = [];
        // 레벨 0: 체커 (고주파)
        let cur = makeChecker(size);
        chain.push({ size, data: cur });
        // 절반씩 박스 필터로 다운샘플
        let s = size;
        while (s > 1) {
          const ns = s >> 1;
          const nd = new Float32Array(ns * ns * 3);
          for (let y = 0; y < ns; y++) {
            for (let x = 0; x < ns; x++) {
              for (let c = 0; c < 3; c++) {
                const a = cur[((2 * y) * s + 2 * x) * 3 + c];
                const b = cur[((2 * y) * s + 2 * x + 1) * 3 + c];
                const d = cur[((2 * y + 1) * s + 2 * x) * 3 + c];
                const e = cur[((2 * y + 1) * s + 2 * x + 1) * 3 + c];
                nd[(y * ns + x) * 3 + c] = (a + b + d + e) / 4;
              }
            }
          }
          chain.push({ size: ns, data: nd });
          cur = nd; s = ns;
        }
        return chain;
      }

      function makeChecker(size) {
        const d = new Float32Array(size * size * 3);
        const cell = size / 8; // 8x8 체커
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const on = ((Math.floor(x / cell) + Math.floor(y / cell)) & 1);
            // 파랑/노랑 체커 (반짝임이 눈에 잘 띄게 대비 큼)
            const col = on ? [0.10, 0.12, 0.20] : [1.0, 0.82, 0.35];
            const i = (y * size + x) * 3;
            d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2];
          }
        }
        return d;
      }

      // 특정 밉 레벨에서 wrap된 텍셀 읽기 (선형 색상 반환)
      function texel(lvl, tx, ty) {
        const m = mips[Math.max(0, Math.min(mips.length - 1, lvl))];
        const s = m.size;
        tx = ((tx % s) + s) % s;
        ty = ((ty % s) + s) % s;
        const i = (ty * s + tx) * 3;
        return [m.data[i], m.data[i + 1], m.data[i + 2]];
      }

      // 밉 레벨 하나에서 nearest 또는 bilinear 샘플 (u,v: 0~1 반복좌표)
      function sampleLevel(lvl, u, v, bilinear) {
        const m = mips[Math.max(0, Math.min(mips.length - 1, lvl))];
        const s = m.size;
        const fx = u * s - 0.5, fy = v * s - 0.5;
        if (!bilinear) {
          return texel(lvl, Math.round(fx), Math.round(fy));
        }
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const dx = fx - x0, dy = fy - y0;
        const c00 = texel(lvl, x0, y0), c10 = texel(lvl, x0 + 1, y0);
        const c01 = texel(lvl, x0, y0 + 1), c11 = texel(lvl, x0 + 1, y0 + 1);
        const out = [0, 0, 0];
        for (let c = 0; c < 3; c++) {
          const a = c00[c] + (c10[c] - c00[c]) * dx;
          const b = c01[c] + (c11[c] - c01[c]) * dx;
          out[c] = a + (b - a) * dy;
        }
        return out;
      }

      // --- 원근 바닥 렌더 ---
      // 화면 픽셀 -> 바닥의 텍스처 좌표. 간단한 원근 평면 사영.
      // 상단 절반은 하늘, 하단 절반이 바닥.
      const img = new ImageData(RW, RH);
      function render() {
        const data = img.data;
        const horizon = RH * 0.42;    // 지평선 위치
        const camH = 1.0;             // 카메라 높이
        for (let y = 0; y < RH; y++) {
          for (let x = 0; x < RW; x++) {
            const i = (y * RW + x) * 4;
            if (y <= horizon) {
              // 하늘 (배경)
              data[i] = 18; data[i + 1] = 22; data[i + 2] = 34; data[i + 3] = 255;
              continue;
            }
            // 스크린 y -> 바닥까지의 거리 (원근). 지평선에 가까울수록 멀다.
            const p = (y - horizon) / (RH - horizon); // 0(지평선)~1(발밑)
            const zdist = camH / (p + 1e-4);          // 카메라로부터 거리
            // 가로 좌표 (원근 폭 보정)
            const worldX = ((x / RW) - 0.5) * zdist * 2.0;
            const worldZ = zdist + scroll;
            // 텍스처 반복 좌표 (타일 스케일)
            const scale = 0.25;
            let u = (worldX * scale) % 1; if (u < 0) u += 1;
            let v = (worldZ * scale) % 1; if (v < 0) v += 1;

            let col;
            if (mode === 0) {
              col = sampleLevel(0, u, v, false);          // 점 샘플링
            } else if (mode === 1) {
              col = sampleLevel(0, u, v, true);           // 이중선형(밉 없음)
            } else {
              // 밉맵 + 삼중선형: 화면공간 미분으로 LOD 추정
              // 인접 픽셀 대비 텍셀 이동량으로 근사 (거리에 비례)
              const texelsPerPixel = (zdist * scale * TEX) / RW * 1.6;
              const lod = clamp(Math.log2(Math.max(texelsPerPixel, 1)), 0, mips.length - 1);
              const l0 = Math.floor(lod), l1 = Math.min(l0 + 1, mips.length - 1);
              const f = lod - l0;
              const a = sampleLevel(l0, u, v, true);
              const b = sampleLevel(l1, u, v, true);
              col = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
            }
            // 선형 -> sRGB 표시(감마 2.2 근사)
            data[i]     = Math.round(255 * Math.pow(clamp(col[0], 0, 1), 1 / 2.2));
            data[i + 1] = Math.round(255 * Math.pow(clamp(col[1], 0, 1), 1 / 2.2));
            data[i + 2] = Math.round(255 * Math.pow(clamp(col[2], 0, 1), 1 / 2.2));
            data[i + 3] = 255;
          }
        }
      }

      function drawMipStrip(ctx, x, y, maxW) {
        // 밉 체인을 작은 사각형 스트립으로 표시
        GFX.text(ctx, "밉 체인:", x, y - 4, COL.dim, "11px sans-serif", "left");
        let cx = x, bh = 40;
        for (let l = 0; l < mips.length; l++) {
          const m = mips[l];
          const disp = Math.max(4, Math.min(bh, m.size)); // 표시 크기
          // 밉 레벨을 작은 ImageData로 만들어 표시
          const mi = new ImageData(m.size, m.size);
          for (let p = 0; p < m.size * m.size; p++) {
            mi.data[p * 4]     = Math.round(255 * Math.pow(clamp(m.data[p * 3], 0, 1), 1 / 2.2));
            mi.data[p * 4 + 1] = Math.round(255 * Math.pow(clamp(m.data[p * 3 + 1], 0, 1), 1 / 2.2));
            mi.data[p * 4 + 2] = Math.round(255 * Math.pow(clamp(m.data[p * 3 + 2], 0, 1), 1 / 2.2));
            mi.data[p * 4 + 3] = 255;
          }
          blit(ctx, mi, cx, y, disp, disp);
          ctx.strokeStyle = COL.gridAxis; ctx.lineWidth = 1;
          ctx.strokeRect(cx + 0.5, y + 0.5, disp, disp);
          GFX.text(ctx, "L" + l, cx + disp / 2, y + disp + 8, COL.dim, "9px sans-serif", "center");
          cx += disp + 6;
          if (cx > x + maxW) break;
        }
      }

      function draw() {
        const { ctx, w, h } = S;
        GFX.clear(ctx, w, h);
        render();
        const floorH = h - 66;
        blit(ctx, img, 0, 0, w, floorH);
        ctx.strokeStyle = COL.gridAxis; ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, w, floorH);

        const names = ["점 샘플링 (nearest — 먼 곳 지글거림)",
          "이중선형 (bilinear — 여전히 지글거림)",
          "밉맵 + 삼중선형 (부드러움)"];
        GFX.text(ctx, "현재 모드: " + names[mode], 8, 16,
          mode === 2 ? COL.green : COL.yellow, "bold 12px sans-serif", "left");

        drawMipStrip(ctx, 8, floorH + 22, w - 16);
      }

      // --- 컨트롤 ---
      const btnNames = ["점 샘플링", "이중선형", "밉맵+삼중선형"];
      const btns = [];
      btnNames.forEach((nm, idx) => {
        const b = GFX.button(ctl, nm, () => { mode = idx; syncBtns(); if (!animate) draw(); }, idx !== 0);
        btns.push(b);
      });
      function syncBtns() {
        btns.forEach((b, i) => { b.className = (i === mode) ? "" : "ghost"; });
      }
      syncBtns();
      GFX.checkbox(ctl, "밉맵 켜기 (= 밉맵+삼중선형)", false, (c) => {
        mode = c ? 2 : 0; syncBtns(); if (!animate) draw();
      });
      GFX.checkbox(ctl, "애니메이션 (스크롤)", true, (c) => {
        animate = c;
        if (!animate && anim) { anim.stop(); anim = null; draw(); }
        else if (animate && !anim) startLoop();
      });

      let anim = null;
      function startLoop() {
        anim = GFX.loop((dt) => {
          scroll += dt * 1.2; // 천천히 앞으로 스크롤
          draw();
        }, S.canvas);
      }

      draw();
      startLoop();
      window.addEventListener("resize", () => { if (!animate) draw(); });
    } catch (e) { console.error("initMipmap 오류:", e); }
  }

})();
