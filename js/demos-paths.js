/* ============================================================
   demos-paths.js — 렌더링 경로(Rendering Paths) 비교 데모
   Forward · Forward+ · Clustered · Deferred · Visibility Buffer
   같은 씬(물체 + 광원)에 대해 경로별 "셰이딩 계산량"을 개념적으로 비교한다.
   광원을 타일에 실제로 비닝(binning)해서 Forward+/Clustered의 절감을 보여준다.
   전역 GFX (lib.js) 사용.
   ============================================================ */
(function () {
  "use strict";

  const { COL } = GFX;

  function initRenderPaths() {
    if (!document.getElementById("c-paths")) return;
    const S = GFX.setup("c-paths");
    const ctl = document.getElementById("ctl-paths");

    // --- 상태 ---
    let path = "forward";           // forward | forwardplus | clustered | deferred | visibility
    let numLights = 24;
    let numObjects = 6;
    const TILES_X = 8, TILES_Y = 6;  // 화면 타일 격자
    const Z_SLICES = 4;              // 클러스터 깊이 분할

    // 씬 (0..1 정규 좌표). 시드 고정 느낌의 의사난수.
    let seed = 1234;
    function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
    let objects = [], lights = [];

    function buildScene() {
      seed = 1234;
      objects = [];
      for (let i = 0; i < numObjects; i++) {
        objects.push({
          x: 0.1 + rnd() * 0.8, y: 0.15 + rnd() * 0.7,
          r: 0.06 + rnd() * 0.09, z: rnd(),
          col: hsv(200 + rnd() * 120, 0.5, 0.85),
        });
      }
      lights = [];
      for (let i = 0; i < numLights; i++) {
        lights.push({
          x: rnd(), y: rnd(), z: rnd(),
          rad: 0.10 + rnd() * 0.14,           // 영향 반경
          col: hsv((i * 47) % 360, 0.65, 1),
        });
      }
    }

    function hsv(h, s, v) {
      h = ((h % 360) + 360) % 360;
      const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
      let r = 0, g = 0, b = 0;
      if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
      else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
      else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
      return "rgb(" + ((r + m) * 255 | 0) + "," + ((g + m) * 255 | 0) + "," + ((b + m) * 255 | 0) + ")";
    }

    // 각 타일에 겹치는 광원 수를 센다 (Forward+ 라이트 컬링의 개념).
    // 반환: { perTile:[], avg, max }
    function cullLightsToTiles() {
      const per = new Array(TILES_X * TILES_Y).fill(0);
      for (let ty = 0; ty < TILES_Y; ty++) {
        for (let tx = 0; tx < TILES_X; tx++) {
          const tx0 = tx / TILES_X, tx1 = (tx + 1) / TILES_X;
          const ty0 = ty / TILES_Y, ty1 = (ty + 1) / TILES_Y;
          let n = 0;
          for (const L of lights) {
            // 광원 영향 원이 타일 사각형과 겹치나 (AABB vs circle)
            const cx = Math.max(tx0, Math.min(L.x, tx1));
            const cy = Math.max(ty0, Math.min(L.y, ty1));
            const dx = L.x - cx, dy = L.y - cy;
            if (dx * dx + dy * dy <= L.rad * L.rad) n++;
          }
          per[ty * TILES_X + tx] = n;
        }
      }
      let sum = 0, mx = 0;
      for (const n of per) { sum += n; if (n > mx) mx = n; }
      return { per, avg: sum / per.length, max: mx };
    }

    // 경로별 개념 정보. cost는 "셰이딩 호출 상대량"(forward 대비).
    function analyze() {
      const cull = cullLightsToTiles();
      const P = 1;                         // 화면 픽셀 정규화 (상대 비교용)
      // Forward: 그려지는 프래그먼트마다 모든 광원 검사 + 오버드로우(겹친 물체)
      const overdraw = 1 + numObjects * 0.06;
      const forwardCost = P * numLights * overdraw;
      // Forward+: 타일당 평균 광원만. 오버드로우는 여전히 존재.
      const fplusCost = P * Math.max(1, cull.avg) * overdraw;
      // Clustered: 타일 + 깊이 슬라이스 → 타일보다 광원 더 좁힘(대략 /슬라이스 완화)
      const clusterCost = P * Math.max(1, cull.avg / Math.sqrt(Z_SLICES)) * overdraw;
      // Deferred: 오버드로우 제거(보이는 픽셀만) + 타일 컬링. 단 G-buffer 대역폭 비용.
      const deferredCost = P * Math.max(1, cull.avg) + 0.6; // +0.6 = G-buffer 채우기
      // Visibility: G-buffer보다 얇음(ID만) + 재질 리졸브
      const visCost = P * Math.max(1, cull.avg) + 0.3;

      return {
        cull,
        rows: [
          { key: "forward", name: "Forward", cost: forwardCost,
            desc: "물체마다 모든 광원 계산", pro: "투명·MSAA 쉬움", con: "광원 많으면 폭발", tiled: false },
          { key: "forwardplus", name: "Forward+", cost: fplusCost,
            desc: "타일별 광원만 (컴퓨트 컬링)", pro: "투명 유지+광원 확장", con: "컬링 패스 필요", tiled: true },
          { key: "clustered", name: "Clustered", cost: clusterCost,
            desc: "타일 × 깊이 슬라이스", pro: "깊이 방향까지 절감", con: "구현 복잡", tiled: true, z: true },
          { key: "deferred", name: "Deferred", cost: deferredCost,
            desc: "G-buffer 후 화면당 1회 조명", pro: "오버드로우 0·광원 대량", con: "투명·MSAA 난감·대역폭↑", tiled: true, gbuf: true },
          { key: "visibility", name: "Visibility", cost: visCost,
            desc: "ID만 저장 후 재질 리졸브", pro: "대역폭 최소", con: "재질 리졸브 복잡", tiled: true, gbuf: true },
        ],
      };
    }

    function draw() {
      const ctx = S.ctx, w = S.w, h = S.h;
      GFX.clear(ctx, w, h);
      const A = analyze();
      const cur = A.rows.find((r) => r.key === path);

      // --- 좌: 화면 시각화 ---
      const size = Math.min(w * 0.5, h - 40, 320);
      const ox = 16, oy = 20;
      ctx.save();
      ctx.beginPath(); ctx.rect(ox, oy, size, size); ctx.clip();
      // 배경
      ctx.fillStyle = "#0b0f14"; ctx.fillRect(ox, oy, size, size);

      const tiled = cur.tiled;
      // 타일 히트맵 (타일 경로일 때)
      if (tiled) {
        for (let ty = 0; ty < TILES_Y; ty++) {
          for (let tx = 0; tx < TILES_X; tx++) {
            const n = A.cull.per[ty * TILES_X + tx];
            const t = A.cull.max ? n / A.cull.max : 0;
            ctx.fillStyle = "rgba(80,200,255," + (0.05 + t * 0.35) + ")";
            ctx.fillRect(ox + tx / TILES_X * size, oy + ty / TILES_Y * size,
              size / TILES_X, size / TILES_Y);
          }
        }
        ctx.strokeStyle = "rgba(120,160,200,0.25)"; ctx.lineWidth = 1;
        for (let i = 1; i < TILES_X; i++) { ctx.beginPath(); ctx.moveTo(ox + i / TILES_X * size, oy); ctx.lineTo(ox + i / TILES_X * size, oy + size); ctx.stroke(); }
        for (let i = 1; i < TILES_Y; i++) { ctx.beginPath(); ctx.moveTo(ox, oy + i / TILES_Y * size); ctx.lineTo(ox + size, oy + i / TILES_Y * size); ctx.stroke(); }
      }

      // 광원 영향 원 + 점
      for (const L of lights) {
        const lx = ox + L.x * size, ly = oy + L.y * size;
        const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, L.rad * size);
        g.addColorStop(0, "rgba(255,255,200,0.18)");
        g.addColorStop(1, "rgba(255,255,200,0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(lx, ly, L.rad * size, 0, Math.PI * 2); ctx.fill();
      }
      // 물체
      for (const o of objects) {
        ctx.fillStyle = o.col;
        ctx.beginPath(); ctx.arc(ox + o.x * size, oy + o.y * size, o.r * size, 0, Math.PI * 2); ctx.fill();
      }
      // 광원 점
      for (const L of lights) {
        ctx.fillStyle = L.col;
        ctx.beginPath(); ctx.arc(ox + L.x * size, oy + L.y * size, 2.5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      ctx.strokeStyle = COL.gridAxis; ctx.lineWidth = 1; ctx.strokeRect(ox, oy, size, size);
      GFX.text(ctx, cur.name + (tiled ? " · 타일 광원 컬링" : " · 컬링 없음"),
        ox, oy + size + 18, COL.text, "bold 13px sans-serif");

      // --- 우: 경로 비교 ---
      const tx = ox + size + 26;
      let ty = oy + 4;
      GFX.text(ctx, "렌더링 경로 비교", tx, ty, COL.text, "bold 15px sans-serif"); ty += 24;
      GFX.text(ctx, "광원 " + numLights + "개 · 물체 " + numObjects + "개", tx, ty, COL.dim, "12px sans-serif"); ty += 16;
      GFX.text(ctx, "타일당 평균 광원 = " + A.cull.avg.toFixed(1) + " (최대 " + A.cull.max + ")", tx, ty, COL.yellow, "12px sans-serif"); ty += 22;

      const base = A.rows[0].cost; // forward 기준
      const barMaxW = Math.max(120, w - tx - 30);
      for (const r of A.rows) {
        const on = r.key === path;
        const rel = r.cost / base;
        GFX.text(ctx, r.name, tx, ty, on ? COL.green : COL.text, (on ? "bold " : "") + "13px sans-serif");
        GFX.text(ctx, "×" + rel.toFixed(2), tx + barMaxW + 4, ty, on ? COL.green : COL.dim, "11px sans-serif");
        ty += 6;
        // 막대
        ctx.fillStyle = "rgba(255,255,255,0.08)"; ctx.fillRect(tx, ty, barMaxW, 8);
        ctx.fillStyle = on ? "rgba(80,220,140,0.9)" : "rgba(120,170,220,0.5)";
        ctx.fillRect(tx, ty, barMaxW * Math.min(1, rel), 8);
        ty += 16;
        if (on) {
          GFX.text(ctx, "→ " + r.desc, tx + 8, ty, COL.dim, "11px sans-serif"); ty += 15;
          GFX.text(ctx, "장점: " + r.pro, tx + 8, ty, "rgba(120,220,150,0.9)", "11px sans-serif"); ty += 14;
          GFX.text(ctx, "약점: " + r.con, tx + 8, ty, "rgba(230,150,120,0.9)", "11px sans-serif"); ty += 16;
        } else {
          ty += 2;
        }
      }
      GFX.text(ctx, "※ 상대 셰이딩 계산량(개념적 근사)", tx, oy + size + 18, COL.dim, "11px sans-serif");
    }

    // --- 컨트롤 ---
    GFX.button(ctl, "Forward", () => { path = "forward"; draw(); });
    GFX.button(ctl, "Forward+", () => { path = "forwardplus"; draw(); });
    GFX.button(ctl, "Clustered", () => { path = "clustered"; draw(); });
    GFX.button(ctl, "Deferred", () => { path = "deferred"; draw(); });
    GFX.button(ctl, "Visibility", () => { path = "visibility"; draw(); });
    GFX.slider(ctl, { label: "광원 수", min: 1, max: 96, step: 1, value: numLights,
      format: (v) => Math.round(v) + "개", onInput: (v) => { numLights = Math.round(v); buildScene(); draw(); } });
    GFX.slider(ctl, { label: "물체 수", min: 1, max: 20, step: 1, value: numObjects,
      format: (v) => Math.round(v) + "개", onInput: (v) => { numObjects = Math.round(v); buildScene(); draw(); } });

    window.addEventListener("resize", () => { S.onResize(); draw(); });
    buildScene();
    draw();
  }

  document.addEventListener("DOMContentLoaded", function () {
    try { initRenderPaths(); } catch (e) { console.error("[demos-paths] 초기화 실패:", e); }
  });
})();
