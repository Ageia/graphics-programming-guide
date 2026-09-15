/* ============================================================
   demos-2d.js — 2D 그래픽스 섹션 인터랙티브 데모
   픽셀/색상, 래스터라이제이션, 이미지 처리, 알파 블렌딩, 스프라이트
   전역 GFX(lib.js) 를 사용한다.
   ============================================================ */
(function () {
  "use strict";
  const G = window.GFX;

  // 두 자리 16진수 헬퍼
  function hex2(n) {
    return ("0" + (n | 0).toString(16)).slice(-2);
  }
  function rgbHex(r, g, b) {
    return "#" + hex2(r) + hex2(g) + hex2(b);
  }

  // ============================================================
  // 1. RGB MIX — 가산 혼합 (빛 섞기)
  // ============================================================
  function initRGB() {
    if (!document.getElementById("c-rgb")) return;
    const S = G.setup("c-rgb");
    const ctl = document.getElementById("ctl-rgb");
    const readout = document.getElementById("r-rgb");

    let R = 220, Gc = 80, B = 160;

    function draw() {
      const { ctx, w, h } = S;
      G.clear(ctx, w, h);

      // --- 왼쪽: 세 빛 원을 'lighter'(가산) 합성으로 겹치기 ---
      const cx = h * 0.5;   // 원 배치 영역 중심 x (정사각 영역)
      const cy = h * 0.5;
      const rad = h * 0.26;
      const off = rad * 0.62;

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      // 빨강 (위), 초록 (좌하), 파랑 (우하) — 각 채널 밝기 반영
      const circles = [
        { x: cx, y: cy - off, col: `rgb(${R},0,0)` },
        { x: cx - off, y: cy + off * 0.8, col: `rgb(0,${Gc},0)` },
        { x: cx + off, y: cy + off * 0.8, col: `rgb(0,0,${B})` },
      ];
      circles.forEach((c) => {
        ctx.fillStyle = c.col;
        ctx.beginPath();
        ctx.arc(c.x, c.y, rad, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();

      G.text(ctx, "빛의 가산 혼합 (lighter)", cx, h - 14, G.COL.dim, "12px sans-serif", "center");

      // --- 오른쪽: 현재 색 큰 스와치 ---
      const sx = h + 30;
      const sw = w - sx - 24;
      if (sw > 10) {
        ctx.fillStyle = `rgb(${R},${Gc},${B})`;
        ctx.fillRect(sx, 24, sw, h - 70);
        ctx.strokeStyle = G.COL.gridAxis;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(sx, 24, sw, h - 70);
        G.text(ctx, "현재 색", sx + sw / 2, h - 30, G.COL.dim, "12px sans-serif", "center");
      }

      if (readout) {
        readout.textContent =
          `rgb(${R}, ${Gc}, ${B})   ${rgbHex(R, Gc, B).toUpperCase()}`;
      }
    }

    G.slider(ctl, { label: "R (빨강)", min: 0, max: 255, value: R, onInput: (v) => { R = v; draw(); } });
    G.slider(ctl, { label: "G (초록)", min: 0, max: 255, value: Gc, onInput: (v) => { Gc = v; draw(); } });
    G.slider(ctl, { label: "B (파랑)", min: 0, max: 255, value: B, onInput: (v) => { B = v; draw(); } });

    window.addEventListener("resize", draw);
    draw();
  }

  // ============================================================
  // 2. PIXEL ZOOM — 그림은 사실 픽셀 블록
  // ============================================================
  function initPixelZoom() {
    if (!document.getElementById("c-pixelzoom")) return;
    const S = G.setup("c-pixelzoom");
    const ctl = document.getElementById("ctl-pixelzoom");

    // 오프스크린에 작은 스마일리(픽셀 아트) 그리기 — 48x48
    const PW = 48, PH = 48;
    const off = document.createElement("canvas");
    off.width = PW; off.height = PH;
    const octx = off.getContext("2d");
    (function paintSmiley() {
      octx.fillStyle = "#0b0d13";
      octx.fillRect(0, 0, PW, PH);
      // 얼굴
      octx.fillStyle = "#ffd166";
      octx.beginPath();
      octx.arc(PW / 2, PH / 2, 20, 0, Math.PI * 2);
      octx.fill();
      // 눈
      octx.fillStyle = "#1a1a1a";
      octx.fillRect(17, 18, 4, 6);
      octx.fillRect(27, 18, 4, 6);
      // 입 (호)
      octx.strokeStyle = "#1a1a1a";
      octx.lineWidth = 3;
      octx.beginPath();
      octx.arc(PW / 2, PH / 2 + 2, 10, 0.15 * Math.PI, 0.85 * Math.PI);
      octx.stroke();
    })();

    let zoom = 6;
    let hover = null; // {px, py}

    function draw() {
      const { ctx, w, h } = S;
      G.clear(ctx, w, h);
      ctx.imageSmoothingEnabled = false;

      const dw = PW * zoom, dh = PH * zoom;
      // 화면 절반 나눔: 왼쪽 부드럽게, 오른쪽 블록으로
      const gap = 30;
      const totalW = dw * 2 + gap;
      const startX = Math.max(12, (w - totalW) / 2);
      const dy = Math.max(12, (h - dh) / 2 - 6);

      // 왼쪽: 부드럽게(보간)
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, PW, PH, startX, dy, dw, dh);
      ctx.strokeStyle = G.COL.gridAxis;
      ctx.strokeRect(startX, dy, dw, dh);
      G.text(ctx, "부드럽게 (보간)", startX + dw / 2, dy + dh + 16, G.COL.dim, "12px sans-serif", "center");

      // 오른쪽: 블록으로(nearest)
      const rx = startX + dw + gap;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, 0, 0, PW, PH, rx, dy, dw, dh);
      ctx.strokeStyle = G.COL.gridAxis;
      ctx.strokeRect(rx, dy, dw, dh);
      G.text(ctx, "픽셀 블록 (nearest)", rx + dw / 2, dy + dh + 16, G.COL.accent, "12px sans-serif", "center");

      // 고배율일 때 오른쪽에 격자 오버레이
      if (zoom >= 5) {
        ctx.strokeStyle = "rgba(255,255,255,0.10)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i <= PW; i++) { ctx.moveTo(rx + i * zoom, dy); ctx.lineTo(rx + i * zoom, dy + dh); }
        for (let j = 0; j <= PH; j++) { ctx.moveTo(rx, dy + j * zoom); ctx.lineTo(rx + dw, dy + j * zoom); }
        ctx.stroke();
      }

      // 호버 픽셀 RGB 표시(오른쪽 블록 뷰 기준)
      if (hover) {
        const lpx = Math.floor((hover.x - rx) / zoom);
        const lpy = Math.floor((hover.y - dy) / zoom);
        if (lpx >= 0 && lpx < PW && lpy >= 0 && lpy < PH) {
          const d = octx.getImageData(lpx, lpy, 1, 1).data;
          // 강조 테두리
          ctx.strokeStyle = G.COL.yellow;
          ctx.lineWidth = 2;
          ctx.strokeRect(rx + lpx * zoom, dy + lpy * zoom, zoom, zoom);
          G.text(ctx,
            `픽셀 (${lpx}, ${lpy}) = rgb(${d[0]}, ${d[1]}, ${d[2]})`,
            startX, 18, G.COL.yellow, "13px 'JetBrains Mono', monospace", "left");
        }
      } else {
        G.text(ctx, "오른쪽 그림 위에 마우스를 올려보세요", startX, 18, G.COL.dim, "12px sans-serif", "left");
      }
    }

    S.canvas.addEventListener("mousemove", (e) => {
      const r = S.canvas.getBoundingClientRect();
      hover = { x: e.clientX - r.left, y: e.clientY - r.top };
      draw();
    });
    S.canvas.addEventListener("mouseleave", () => { hover = null; draw(); });

    G.slider(ctl, { label: "확대 배율", min: 1, max: 16, value: zoom, format: (v) => v + "×", onInput: (v) => { zoom = v; draw(); } });

    window.addEventListener("resize", draw);
    draw();
  }

  // ============================================================
  // 공용: 좌표를 격자 셀로 그리는 헬퍼 유틸
  // ============================================================
  function makeGrid(w, h, cell) {
    const cols = Math.floor(w / cell);
    const rows = Math.floor(h / cell);
    const ox = Math.floor((w - cols * cell) / 2);
    const oy = Math.floor((h - rows * cell) / 2);
    return { cols, rows, cell, ox, oy };
  }
  function drawGridLines(ctx, gr) {
    ctx.strokeStyle = G.COL.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= gr.cols; i++) {
      const x = gr.ox + i * gr.cell;
      ctx.moveTo(x, gr.oy); ctx.lineTo(x, gr.oy + gr.rows * gr.cell);
    }
    for (let j = 0; j <= gr.rows; j++) {
      const y = gr.oy + j * gr.cell;
      ctx.moveTo(gr.ox, y); ctx.lineTo(gr.ox + gr.cols * gr.cell, y);
    }
    ctx.stroke();
  }
  // 화면 px -> 셀 인덱스
  function toCell(gr, px, py) {
    return {
      cx: Math.floor((px - gr.ox) / gr.cell),
      cy: Math.floor((py - gr.oy) / gr.cell),
    };
  }
  // 셀 인덱스 -> 셀 중심 화면 px
  function cellCenter(gr, cx, cy) {
    return {
      x: gr.ox + (cx + 0.5) * gr.cell,
      y: gr.oy + (cy + 0.5) * gr.cell,
    };
  }
  function fillCell(ctx, gr, cx, cy, color) {
    ctx.fillStyle = color;
    ctx.fillRect(gr.ox + cx * gr.cell + 0.5, gr.oy + cy * gr.cell + 0.5, gr.cell - 1, gr.cell - 1);
  }

  // ============================================================
  // 3. LINE RASTER — Bresenham
  // ============================================================
  function initLine() {
    if (!document.getElementById("c-line")) return;
    const S = G.setup("c-line");
    const CELL = 18;
    let gr = makeGrid(S.w, S.h, CELL);

    // 드래그 핸들 (화면 px). 초기 위치는 격자 안쪽으로.
    // 주의: 이 섹션이 숨겨진(display:none) 상태로 init되면 캔버스 폭이 0이라
    // 격자가 cols=0으로 계산된다. 그때 핸들을 배치하면 좌측으로 쏠리므로,
    // 유효한 폭이 생긴 첫 draw에서 한 번만 배치한다(사용자 드래그는 보존).
    const pts = [
      { x: 0, y: 0, color: G.COL.green, label: "A" },
      { x: 0, y: 0, color: G.COL.red, label: "B" },
    ];
    let placed = false;
    function placeHandles() {
      pts[0].x = gr.ox + gr.cell * 3.5;
      pts[0].y = gr.oy + gr.cell * 3.5;
      pts[1].x = gr.ox + gr.cell * (gr.cols - 4) + gr.cell * 0.5;
      pts[1].y = gr.oy + gr.cell * (gr.rows - 4) + gr.cell * 0.5;
    }
    const drag = G.draggable(S.canvas, pts, () => draw(), 10);

    // 정수 격자 좌표를 켜는 Bresenham
    function bresenham(x0, y0, x1, y1) {
      const cells = [];
      let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx - dy;
      while (true) {
        cells.push([x0, y0]);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
      }
      return cells;
    }

    function draw() {
      const { ctx, w, h } = S;
      if (!placed && gr.cols > 4 && gr.rows > 4) { placeHandles(); placed = true; }
      G.clear(ctx, w, h);
      drawGridLines(ctx, gr);

      const a = toCell(gr, pts[0].x, pts[0].y);
      const b = toCell(gr, pts[1].x, pts[1].y);
      const cx0 = G.clamp(a.cx, 0, gr.cols - 1);
      const cy0 = G.clamp(a.cy, 0, gr.rows - 1);
      const cx1 = G.clamp(b.cx, 0, gr.cols - 1);
      const cy1 = G.clamp(b.cy, 0, gr.rows - 1);

      // 켜지는 픽셀 채우기
      const cells = bresenham(cx0, cy0, cx1, cy1);
      cells.forEach(([cx, cy]) => fillCell(ctx, gr, cx, cy, "rgba(110,168,254,0.55)"));

      // 이상적인 얇은 선 (셀 중심끼리) 위에 겹쳐 그려 계단 대비
      const pa = cellCenter(gr, cx0, cy0);
      const pb = cellCenter(gr, cx1, cy1);
      G.line(ctx, pa.x, pa.y, pb.x, pb.y, G.COL.text, 1.5);

      drag.drawHandles(ctx);
      G.text(ctx, `켜진 픽셀 ${cells.length}개 · 파란 블록 = 래스터 결과, 흰 선 = 이상적 직선`,
        12, 16, G.COL.dim, "12px sans-serif", "left");
    }

    window.addEventListener("resize", () => {
      S.onResize();
      gr = makeGrid(S.w, S.h, CELL);
      draw();
    });
    draw();
  }

  // ============================================================
  // 4. TRIANGLE FILL — 픽셀마다 안/밖 판정
  // ============================================================
  function initFill() {
    if (!document.getElementById("c-fill")) return;
    const S = G.setup("c-fill");
    const CELL = 18;
    let gr = makeGrid(S.w, S.h, CELL);

    // 숨겨진 섹션은 init 시 폭이 0이라 격자가 cols=0이 된다.
    // 유효한 폭이 생긴 첫 draw에서 한 번만 꼭짓점을 배치한다(드래그 보존).
    const pts = [
      { x: 0, y: 0, color: G.COL.green, label: "1" },
      { x: 0, y: 0, color: G.COL.yellow, label: "2" },
      { x: 0, y: 0, color: G.COL.purple, label: "3" },
    ];
    let placed = false;
    function placeHandles() {
      pts[0].x = gr.ox + gr.cell * (gr.cols * 0.5);
      pts[0].y = gr.oy + gr.cell * 2;
      pts[1].x = gr.ox + gr.cell * 3;
      pts[1].y = gr.oy + gr.cell * (gr.rows - 3);
      pts[2].x = gr.ox + gr.cell * (gr.cols - 3);
      pts[2].y = gr.oy + gr.cell * (gr.rows - 4);
    }
    const drag = G.draggable(S.canvas, pts, () => draw(), 10);

    // 외적 부호로 한 변 기준 어느 쪽인지 판정
    function edge(ax, ay, bx, by, px, py) {
      return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    }
    function inside(px, py, p0, p1, p2) {
      const d0 = edge(p0.x, p0.y, p1.x, p1.y, px, py);
      const d1 = edge(p1.x, p1.y, p2.x, p2.y, px, py);
      const d2 = edge(p2.x, p2.y, p0.x, p0.y, px, py);
      const hasNeg = d0 < 0 || d1 < 0 || d2 < 0;
      const hasPos = d0 > 0 || d1 > 0 || d2 > 0;
      return !(hasNeg && hasPos); // 부호가 일관되면 내부
    }

    function draw() {
      const { ctx, w, h } = S;
      if (!placed && gr.cols > 4 && gr.rows > 4) { placeHandles(); placed = true; }
      G.clear(ctx, w, h);
      drawGridLines(ctx, gr);

      let count = 0;
      for (let cy = 0; cy < gr.rows; cy++) {
        for (let cx = 0; cx < gr.cols; cx++) {
          const c = cellCenter(gr, cx, cy);
          if (inside(c.x, c.y, pts[0], pts[1], pts[2])) {
            fillCell(ctx, gr, cx, cy, "rgba(110,168,254,0.50)");
            count++;
          }
        }
      }

      // 이상적인 삼각형 외곽선 위에 겹쳐 그리기
      ctx.strokeStyle = G.COL.text;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[1].x, pts[1].y);
      ctx.lineTo(pts[2].x, pts[2].y);
      ctx.closePath();
      ctx.stroke();

      drag.drawHandles(ctx);
      G.text(ctx, `채운 픽셀 ${count}개 · 각 셀 중심이 삼각형 안인지 외적 부호로 판정`,
        12, 16, G.COL.dim, "12px sans-serif", "left");
    }

    window.addEventListener("resize", () => {
      S.onResize();
      gr = makeGrid(S.w, S.h, CELL);
      draw();
    });
    draw();
  }

  // ============================================================
  // 5. IMAGE FILTER — 밝기 / 흑백 / 블러 / 엣지
  // ============================================================
  function initFilter() {
    if (!document.getElementById("c-filter")) return;
    const S = G.setup("c-filter");
    const ctl = document.getElementById("ctl-filter");

    // 절차적 원본 이미지 (200x120): 그라디언트 + 도형
    const IW = 200, IH = 120;
    const src = document.createElement("canvas");
    src.width = IW; src.height = IH;
    const sctx = src.getContext("2d");
    (function paint() {
      const g = sctx.createLinearGradient(0, 0, IW, IH);
      g.addColorStop(0, "#2a4d8f");
      g.addColorStop(0.5, "#7a3f8f");
      g.addColorStop(1, "#c46a3f");
      sctx.fillStyle = g;
      sctx.fillRect(0, 0, IW, IH);
      // 도형들 (엣지/블러 대비용)
      sctx.fillStyle = "#ffd166";
      sctx.beginPath(); sctx.arc(55, 55, 30, 0, Math.PI * 2); sctx.fill();
      sctx.fillStyle = "#7ee787";
      sctx.fillRect(110, 20, 55, 45);
      sctx.fillStyle = "#ff7b72";
      sctx.beginPath();
      sctx.moveTo(150, 110); sctx.lineTo(185, 70); sctx.lineTo(120, 75);
      sctx.closePath(); sctx.fill();
      sctx.fillStyle = "#ffffff";
      sctx.font = "bold 20px sans-serif";
      sctx.fillText("PIXEL", 12, 105);
    })();
    const srcData = sctx.getImageData(0, 0, IW, IH);

    let brightness = 0;
    let filter = "원본";

    // --- 필터 구현 ---
    function applyFilter() {
      const out = new ImageData(IW, IH);
      const s = srcData.data, d = out.data;

      if (filter === "블러" || filter === "엣지") {
        // 3x3 커널 합성곱
        const kernel = filter === "블러"
          ? [1, 1, 1, 1, 1, 1, 1, 1, 1]
          : [0, -1, 0, -1, 4, -1, 0, -1, 0]; // 라플라시안 엣지
        const kdiv = filter === "블러" ? 9 : 1;
        for (let y = 0; y < IH; y++) {
          for (let x = 0; x < IW; x++) {
            let r = 0, g = 0, b = 0, ki = 0;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                const nx = G.clamp(x + dx, 0, IW - 1);
                const ny = G.clamp(y + dy, 0, IH - 1);
                const idx = (ny * IW + nx) * 4;
                const kk = kernel[ki++];
                r += s[idx] * kk; g += s[idx + 1] * kk; b += s[idx + 2] * kk;
              }
            }
            const o = (y * IW + x) * 4;
            if (filter === "엣지") {
              // 엣지 강도(절댓값) 을 밝기로
              const e = G.clamp(Math.abs(r) + Math.abs(g) + Math.abs(b), 0, 255);
              d[o] = d[o + 1] = d[o + 2] = e;
            } else {
              d[o] = G.clamp(r / kdiv, 0, 255);
              d[o + 1] = G.clamp(g / kdiv, 0, 255);
              d[o + 2] = G.clamp(b / kdiv, 0, 255);
            }
            d[o + 3] = 255;
          }
        }
      } else {
        // 픽셀 단위 필터 (원본 / 흑백 / 밝기)
        for (let i = 0; i < s.length; i += 4) {
          let r = s[i], g = s[i + 1], b = s[i + 2];
          if (filter === "흑백") {
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            r = g = b = lum;
          }
          r = G.clamp(r + brightness, 0, 255);
          g = G.clamp(g + brightness, 0, 255);
          b = G.clamp(b + brightness, 0, 255);
          d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
        }
      }
      return out;
    }

    // 결과를 오프스크린에 넣어 확대 그리기 위해 임시 캔버스 사용
    const resCanvas = document.createElement("canvas");
    resCanvas.width = IW; resCanvas.height = IH;
    const rctx = resCanvas.getContext("2d");

    function draw() {
      const { ctx, w, h } = S;
      G.clear(ctx, w, h);

      const result = applyFilter();
      rctx.putImageData(result, 0, 0);

      // 좌: 원본, 우: 결과 — 나란히
      const gap = 24;
      const availW = (w - gap - 32) / 2;
      const scale = Math.min(availW / IW, (h - 44) / IH);
      const dw = IW * scale, dh = IH * scale;
      const y = 30;
      const x0 = (w - (dw * 2 + gap)) / 2;
      const x1 = x0 + dw + gap;

      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(src, x0, y, dw, dh);
      ctx.drawImage(resCanvas, x1, y, dw, dh);

      ctx.strokeStyle = G.COL.gridAxis;
      ctx.lineWidth = 1;
      ctx.strokeRect(x0, y, dw, dh);
      ctx.strokeRect(x1, y, dw, dh);

      G.text(ctx, "원본", x0 + dw / 2, y - 12, G.COL.dim, "12px sans-serif", "center");
      G.text(ctx, `결과: ${filter}`, x1 + dw / 2, y - 12, G.COL.accent, "12px sans-serif", "center");
    }

    // 컨트롤: 밝기 슬라이더 + 필터 버튼들
    G.slider(ctl, { label: "밝기", min: -100, max: 100, value: 0, format: (v) => (v > 0 ? "+" : "") + v, onInput: (v) => { brightness = v; draw(); } });

    const btnWrap = document.createElement("div");
    btnWrap.className = "control";
    btnWrap.style.flexDirection = "row";
    btnWrap.style.flexWrap = "wrap";
    btnWrap.style.gap = "6px";
    ctl.appendChild(btnWrap);
    const filters = ["원본", "흑백", "블러", "엣지"];
    const btns = {};
    filters.forEach((f) => {
      btns[f] = G.button(btnWrap, f, () => {
        filter = f;
        filters.forEach((k) => btns[k].className = (k === f ? "" : "ghost"));
        draw();
      }, f !== "원본");
    });

    window.addEventListener("resize", draw);
    draw();
  }

  // ============================================================
  // 6. ALPHA BLEND — 오버 연산을 손으로 계산
  // ============================================================
  function initBlend() {
    if (!document.getElementById("c-blend")) return;
    const S = G.setup("c-blend");
    const ctl = document.getElementById("ctl-blend");
    const readout = document.getElementById("r-blend");

    let alpha = 0.6;
    let hue = 190; // 위 층 색조

    // HSL -> RGB (0..255)
    function hsl2rgb(hh, ss, ll) {
      hh /= 360;
      const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
      const p = 2 * ll - q;
      const hk = (t) => {
        if (t < 0) t += 1; if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      return [
        Math.round(hk(hh + 1 / 3) * 255),
        Math.round(hk(hh) * 255),
        Math.round(hk(hh - 1 / 3) * 255),
      ];
    }

    const bottom = [255, 123, 114]; // 아래 층: 빨강 계열 고정

    function draw() {
      const { ctx, w, h } = S;
      G.clear(ctx, w, h);

      const top = hsl2rgb(hue, 0.65, 0.55);
      // 손으로 계산한 오버 결과 (겹치는 영역 색)
      const res = [
        Math.round(top[0] * alpha + bottom[0] * (1 - alpha)),
        Math.round(top[1] * alpha + bottom[1] * (1 - alpha)),
        Math.round(top[2] * alpha + bottom[2] * (1 - alpha)),
      ];

      const cy = h * 0.46;
      const r = h * 0.24;
      const cxA = w * 0.38;
      const cxB = w * 0.62;

      // 아래 원 (불투명)
      ctx.fillStyle = `rgb(${bottom[0]},${bottom[1]},${bottom[2]})`;
      ctx.beginPath(); ctx.arc(cxA, cy, r, 0, Math.PI * 2); ctx.fill();

      // 위 원의 비겹침 부분: 순수 위색(불투명 표시)
      ctx.fillStyle = `rgb(${top[0]},${top[1]},${top[2]})`;
      ctx.beginPath(); ctx.arc(cxB, cy, r, 0, Math.PI * 2); ctx.fill();

      // 아래 원을 다시 그려 (위색 위 아님) — 순서상 겹침은 아래에서 덮임
      // 겹치는 렌즈 영역을 직접 계산한 결과색으로 칠한다.
      // 렌즈 = 두 원의 교집합 클립
      ctx.save();
      ctx.beginPath(); ctx.arc(cxA, cy, r, 0, Math.PI * 2); ctx.clip();
      ctx.beginPath(); ctx.arc(cxB, cy, r, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = `rgb(${res[0]},${res[1]},${res[2]})`;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();

      // 라벨
      G.text(ctx, "아래 층", cxA, cy - r - 12, G.COL.dim, "12px sans-serif", "center");
      G.text(ctx, "위 층 (α)", cxB, cy - r - 12, G.COL.dim, "12px sans-serif", "center");
      G.text(ctx, "겹침 = 직접 계산한 결과색", w / 2, cy + r + 22, G.COL.yellow, "12px sans-serif", "center");

      if (readout) {
        readout.innerHTML =
          `결과 = 위색 × α + 아래색 × (1−α)<br>` +
          `R: ${top[0]}×${alpha.toFixed(2)} + ${bottom[0]}×${(1 - alpha).toFixed(2)} = <b>${res[0]}</b>　` +
          `G: ${top[1]}×${alpha.toFixed(2)} + ${bottom[1]}×${(1 - alpha).toFixed(2)} = <b>${res[1]}</b>　` +
          `B: ${top[2]}×${alpha.toFixed(2)} + ${bottom[2]}×${(1 - alpha).toFixed(2)} = <b>${res[2]}</b><br>` +
          `결과색 = rgb(${res[0]}, ${res[1]}, ${res[2]})  ${rgbHex(res[0], res[1], res[2]).toUpperCase()}`;
      }
    }

    G.slider(ctl, { label: "알파 (α)", min: 0, max: 1, step: 0.01, value: alpha, onInput: (v) => { alpha = v; draw(); } });
    G.slider(ctl, { label: "위 층 색조", min: 0, max: 360, value: hue, format: (v) => v + "°", onInput: (v) => { hue = v; draw(); } });

    window.addEventListener("resize", draw);
    draw();
  }

  // ============================================================
  // 7. SPRITE / UV — 텍스처 잘라 붙이기
  // ============================================================
  function initSprite() {
    if (!document.getElementById("c-sprite")) return;
    const S = G.setup("c-sprite");
    const ctl = document.getElementById("ctl-sprite");

    // 절차적 텍스처 (128x128): 컬러 타일 + 체커
    const TW = 128, TH = 128;
    const tex = document.createElement("canvas");
    tex.width = TW; tex.height = TH;
    const tctx = tex.getContext("2d");
    (function paintTex() {
      const cols = ["#ff7b72", "#ffd166", "#7ee787", "#56d4dd", "#6ea8fe", "#c792ea"];
      const tile = 32;
      for (let ty = 0; ty < TH / tile; ty++) {
        for (let tx = 0; tx < TW / tile; tx++) {
          tctx.fillStyle = cols[(tx + ty * (TW / tile)) % cols.length];
          tctx.fillRect(tx * tile, ty * tile, tile, tile);
          // 작은 체커 무늬로 방향성 표시
          tctx.fillStyle = "rgba(0,0,0,0.18)";
          tctx.fillRect(tx * tile, ty * tile, tile / 2, tile / 2);
          tctx.fillRect(tx * tile + tile / 2, ty * tile + tile / 2, tile / 2, tile / 2);
        }
      }
      // 좌상단 표식 (방향 확인용)
      tctx.fillStyle = "#0b0d13";
      tctx.beginPath();
      tctx.moveTo(4, 4); tctx.lineTo(28, 4); tctx.lineTo(4, 28); tctx.closePath();
      tctx.fill();
    })();

    let U = 0.25, Vc = 0.25, size = 0.5;

    function draw() {
      const { ctx, w, h } = S;
      G.clear(ctx, w, h);

      // 좌: 원본 텍스처 표시
      const disp = Math.min((w - 60) / 2, h - 50);
      const y = 24;
      const lx = Math.max(16, w * 0.5 - disp - 20);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tex, lx, y, disp, disp);
      ctx.strokeStyle = G.COL.gridAxis;
      ctx.lineWidth = 1;
      ctx.strokeRect(lx, y, disp, disp);

      // 선택 UV 박스 그리기 (원본 위)
      const selX = lx + U * disp;
      const selY = y + Vc * disp;
      const selW = size * disp;
      const selH = size * disp;
      ctx.strokeStyle = G.COL.yellow;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(selX, selY, selW, selH);
      ctx.fillStyle = "rgba(255,209,102,0.12)";
      ctx.fillRect(selX, selY, selW, selH);
      G.text(ctx, "원본 텍스처", lx + disp / 2, y + disp + 16, G.COL.dim, "12px sans-serif", "center");

      // 우: 선택 영역을 목적지 사각형에 매핑(늘려서)
      const rx = lx + disp + 40;
      // drawImage(src, sx,sy,sw,sh, dx,dy,dw,dh)
      const sx = U * TW, sy = Vc * TH, sw = size * TW, sh = size * TH;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tex, sx, sy, sw, sh, rx, y, disp, disp);
      ctx.strokeStyle = G.COL.accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(rx, y, disp, disp);
      G.text(ctx, "매핑 결과 (선택 영역을 채움)", rx + disp / 2, y + disp + 16, G.COL.accent, "12px sans-serif", "center");

      G.text(ctx,
        `UV 시작=(${U.toFixed(2)}, ${Vc.toFixed(2)})  크기=${size.toFixed(2)}  →  src(${sx | 0}, ${sy | 0}, ${sw | 0}, ${sh | 0})px`,
        lx, 14, G.COL.dim, "12px 'JetBrains Mono', monospace", "left");
    }

    // 슬라이더: U/V 는 시작+크기 <= 1 로 클램프
    // (슬라이더 생성 시 onInput이 즉시 호출되므로 sU/sV를 먼저 let 선언 + 가드로 TDZ 방지)
    let sU, sV;
    sU = G.slider(ctl, { label: "U 시작", min: 0, max: 1, step: 0.01, value: U, onInput: (v) => { U = Math.min(v, 1 - size); if (sU) sU.set(U); draw(); } });
    sV = G.slider(ctl, { label: "V 시작", min: 0, max: 1, step: 0.01, value: Vc, onInput: (v) => { Vc = Math.min(v, 1 - size); if (sV) sV.set(Vc); draw(); } });
    G.slider(ctl, { label: "크기 (UV)", min: 0.1, max: 1, step: 0.01, value: size, onInput: (v) => {
      size = v;
      if (U + size > 1) { U = 1 - size; if (sU) sU.set(U); }
      if (Vc + size > 1) { Vc = 1 - size; if (sV) sV.set(Vc); }
      draw();
    } });

    window.addEventListener("resize", draw);
    draw();
  }

  // ============================================================
  // 부팅: 각 데모를 try/catch 로 격리
  // ============================================================
  G.deferInit("c-rgb", initRGB);
  G.deferInit("c-pixelzoom", initPixelZoom);
  G.deferInit("c-line", initLine);
  G.deferInit("c-fill", initFill);
  G.deferInit("c-filter", initFilter);
  G.deferInit("c-blend", initBlend);
  G.deferInit("c-sprite", initSprite);
})();
