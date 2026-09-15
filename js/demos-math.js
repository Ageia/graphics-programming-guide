/* ============================================================
   demos-math.js — "1. 기초 수학" 섹션의 인터랙티브 데모
   GFX(lib.js) 헬퍼에 의존한다.
   각 데모는 개별 init 함수로 분리하고, 대상 요소가 없으면
   조용히 건너뛰어 다른 데모에 영향을 주지 않는다.
   ============================================================ */
(function () {
  "use strict";

  const G = window.GFX;
  const COL = G.COL;

  // 값 소수 1자리 반올림 헬퍼
  const r1 = (v) => (Math.round(v * 10) / 10).toFixed(1);

  // ==========================================================
  // 1. 벡터 덧셈 (Vector Add)
  // ==========================================================
  function initVectorAdd() {
    if (!document.getElementById("c-vector")) return;
    const { canvas, ctx } = G.setup("c-vector");
    const readout = document.getElementById("r-vector");
    let cs = G.centered(canvas._cssW, canvas._cssH, 40);

    // 드래그 핸들(화면 픽셀). 숨겨진 섹션은 init 시 폭이 0이라 좌표계가
    // 어긋나므로, 유효한 폭이 생긴 첫 draw에서 한 번만 배치한다(드래그 보존).
    const pts = [
      { x: 0, y: 0, color: COL.accent, label: "A" },
      { x: 0, y: 0, color: COL.green, label: "B" },
    ];
    let placed = false;
    function placeHandles() {
      pts[0].x = cs.sx(2); pts[0].y = cs.sy(1);
      pts[1].x = cs.sx(1); pts[1].y = cs.sy(2);
    }
    const drag = G.draggable(canvas, pts, () => draw());

    function draw() {
      cs = G.centered(canvas._cssW, canvas._cssH, 40);
      if (!placed && canvas._cssW > 0) { placeHandles(); placed = true; }
      const w = canvas._cssW, h = canvas._cssH;
      G.clear(ctx, w, h);
      cs.drawGrid(ctx);
      cs.drawAxes(ctx);

      // 수학좌표로 변환
      const A = [cs.mx(pts[0].x), cs.my(pts[0].y)];
      const B = [cs.mx(pts[1].x), cs.my(pts[1].y)];
      const S = G.V.add(A, B);

      const o = { x: cs.sx(0), y: cs.sy(0) };
      const pA = { x: cs.sx(A[0]), y: cs.sy(A[1]) };
      const pB = { x: cs.sx(B[0]), y: cs.sy(B[1]) };
      const pS = { x: cs.sx(S[0]), y: cs.sy(S[1]) };

      // 평행사변형(팁-투-테일): A끝에서 B, B끝에서 A 를 점선으로
      G.line(ctx, pA.x, pA.y, pS.x, pS.y, COL.green, 1.5, [5, 5]);
      G.line(ctx, pB.x, pB.y, pS.x, pS.y, COL.accent, 1.5, [5, 5]);

      // 벡터들
      G.arrow(ctx, o.x, o.y, pA.x, pA.y, COL.accent, 2.5);
      G.arrow(ctx, o.x, o.y, pB.x, pB.y, COL.green, 2.5);
      G.arrow(ctx, o.x, o.y, pS.x, pS.y, COL.yellow, 3);
      G.text(ctx, "A+B", pS.x + 8, pS.y - 8, COL.yellow, "bold 13px sans-serif");

      drag.drawHandles(ctx);

      if (readout) {
        readout.textContent =
          `A = (${r1(A[0])}, ${r1(A[1])})   ` +
          `B = (${r1(B[0])}, ${r1(B[1])})   ` +
          `A+B = (${r1(S[0])}, ${r1(S[1])})`;
      }
    }

    window.addEventListener("resize", draw);
    draw();
  }

  // ==========================================================
  // 2. 정규화 (Normalize)
  // ==========================================================
  function initNormalize() {
    if (!document.getElementById("c-normalize")) return;
    const { canvas, ctx } = G.setup("c-normalize");
    const readout = document.getElementById("r-normalize");
    let cs = G.centered(canvas._cssW, canvas._cssH, 60);

    // 숨겨진 섹션 대비: 유효 폭이 생긴 첫 draw에서 한 번만 배치.
    const pts = [{ x: 0, y: 0, color: COL.accent, label: "v" }];
    let placed = false;
    function placeHandles() { pts[0].x = cs.sx(2.5); pts[0].y = cs.sy(1.5); }
    const drag = G.draggable(canvas, pts, () => draw());

    function draw() {
      cs = G.centered(canvas._cssW, canvas._cssH, 60);
      if (!placed && canvas._cssW > 0) { placeHandles(); placed = true; }
      const w = canvas._cssW, h = canvas._cssH;
      G.clear(ctx, w, h);
      cs.drawGrid(ctx);
      cs.drawAxes(ctx);

      const o = { x: cs.sx(0), y: cs.sy(0) };

      // 단위원 (반지름 1단위 = scale 픽셀)
      ctx.strokeStyle = "rgba(255,209,102,0.25)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(o.x, o.y, cs.scale, 0, Math.PI * 2);
      ctx.stroke();

      const v = [cs.mx(pts[0].x), cs.my(pts[0].y)];
      const len = G.V.len(v);
      const n = G.V.norm(v);

      const pv = { x: cs.sx(v[0]), y: cs.sy(v[1]) };
      const pn = { x: cs.sx(n[0]), y: cs.sy(n[1]) };

      // 원본(흐린 회색)
      G.arrow(ctx, o.x, o.y, pv.x, pv.y, COL.dim, 2);
      // 정규화(노란색, 길이 정확히 1)
      G.arrow(ctx, o.x, o.y, pn.x, pn.y, COL.yellow, 3);
      G.text(ctx, "v", pv.x + 8, pv.y, COL.dim, "bold 13px sans-serif");
      G.text(ctx, "v̂", pn.x + 8, pn.y - 6, COL.yellow, "bold 13px sans-serif");

      drag.drawHandles(ctx);

      if (readout) {
        readout.textContent =
          `|v| = ${r1(len)}   ` +
          `정규화 v̂ = (${r1(n[0])}, ${r1(n[1])})   |v̂| = 1.0`;
      }
    }

    window.addEventListener("resize", draw);
    draw();
  }

  // ==========================================================
  // 3. 행렬 (2x2 변환)
  // ==========================================================
  function initMatrix() {
    if (!document.getElementById("c-matrix")) return;
    const { canvas, ctx } = G.setup("c-matrix");
    const ctl = document.getElementById("ctl-matrix");
    const readout = document.getElementById("r-matrix");
    let cs = G.centered(canvas._cssW, canvas._cssH, 45);

    // 기본값: 항등 행렬. i-hat=(a,c), j-hat=(b,d)
    let a = 1, b = 0, c = 0, d = 1;

    let sa, sb, sc, sd;
    if (ctl) {
      sa = G.slider(ctl, { label: "a (î.x)", min: -2, max: 2, step: 0.1, value: 1, onInput: (v) => { a = v; draw(); } });
      sb = G.slider(ctl, { label: "b (ĵ.x)", min: -2, max: 2, step: 0.1, value: 0, onInput: (v) => { b = v; draw(); } });
      sc = G.slider(ctl, { label: "c (î.y)", min: -2, max: 2, step: 0.1, value: 0, onInput: (v) => { c = v; draw(); } });
      sd = G.slider(ctl, { label: "d (ĵ.y)", min: -2, max: 2, step: 0.1, value: 1, onInput: (v) => { d = v; draw(); } });
      G.button(ctl, "초기화", () => {
        sa.set(1); sb.set(0); sc.set(0); sd.set(1);
      });
    }

    // 수학좌표 -> 화면픽셀 (행렬 적용 후)
    function tp(x, y) {
      const tx = a * x + b * y;
      const ty = c * x + d * y;
      return { x: cs.sx(tx), y: cs.sy(ty) };
    }

    function draw() {
      cs = G.centered(canvas._cssW, canvas._cssH, 45);
      const w = canvas._cssW, h = canvas._cssH;
      G.clear(ctx, w, h);

      // 변환된 격자 (범위 -5..5)
      const R = 6;
      ctx.strokeStyle = "rgba(110,168,254,0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = -R; i <= R; i++) {
        // 수직선(x=i): y가 변하는 선
        let s = tp(i, -R), e = tp(i, R);
        ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y);
        // 수평선(y=i)
        s = tp(-R, i); e = tp(R, i);
        ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y);
      }
      ctx.stroke();
      cs.drawAxes(ctx);

      const o = { x: cs.sx(0), y: cs.sy(0) };

      // 변환된 단위 정사각형 (반투명 채우기)
      const q0 = tp(0, 0), q1 = tp(1, 0), q2 = tp(1, 1), q3 = tp(0, 1);
      ctx.fillStyle = "rgba(255,209,102,0.18)";
      ctx.beginPath();
      ctx.moveTo(q0.x, q0.y); ctx.lineTo(q1.x, q1.y);
      ctx.lineTo(q2.x, q2.y); ctx.lineTo(q3.x, q3.y);
      ctx.closePath();
      ctx.fill();

      // 기저 벡터 î(빨강), ĵ(초록)
      const iHat = tp(1, 0), jHat = tp(0, 1);
      G.arrow(ctx, o.x, o.y, iHat.x, iHat.y, COL.red, 3);
      G.arrow(ctx, o.x, o.y, jHat.x, jHat.y, COL.green, 3);
      G.text(ctx, "î", iHat.x + 6, iHat.y + 6, COL.red, "bold 14px sans-serif");
      G.text(ctx, "ĵ", jHat.x + 6, jHat.y - 6, COL.green, "bold 14px sans-serif");

      if (readout) {
        const det = a * d - b * c;
        readout.innerHTML =
          `행렬 M = [ ${r1(a)}  ${r1(b)} ; ${r1(c)}  ${r1(d)} ]  ` +
          `&nbsp; 행렬식 det = a·d − b·c = ${r1(det)}<br>` +
          `<span style="color:${COL.dim}">행렬식 = 넓이 배율(단위 정사각형 → 변환된 도형의 넓이). ` +
          (det < 0 ? "음수 → 공간이 뒤집힘." : "") + "</span>";
      }
    }

    window.addEventListener("resize", draw);
    draw();
  }

  // ==========================================================
  // 4. 변환 순서 (Transform Order)
  // ==========================================================
  function initTransform() {
    if (!document.getElementById("c-transform")) return;
    const { canvas, ctx } = G.setup("c-transform");
    const ctl = document.getElementById("ctl-transform");
    let cs = G.centered(canvas._cssW, canvas._cssH, 45);

    let rotDeg = 45;   // 회전(도)
    let moveX = 2;     // 이동 X (단위)
    let rotateFirst = true; // true: 회전→이동, false: 이동→회전

    // 비대칭 "F" 모양 폴리곤 (수학좌표, 원점 근처)
    const shape = [
      [0, 0], [0, 2], [1.2, 2], [1.2, 1.5], [0.6, 1.5],
      [0.6, 1.1], [1.0, 1.1], [1.0, 0.6], [0.6, 0.6], [0.6, 0],
    ];

    if (ctl) {
      G.slider(ctl, { label: "회전 (도)", min: -180, max: 180, step: 1, value: 45, onInput: (v) => { rotDeg = v; draw(); } });
      G.slider(ctl, { label: "이동 X", min: -4, max: 4, step: 0.1, value: 2, onInput: (v) => { moveX = v; draw(); } });
      G.button(ctl, "회전 → 이동", () => { rotateFirst = true; draw(); });
      G.button(ctl, "이동 → 회전", () => { rotateFirst = false; draw(); }, true);
    }

    // 점에 변환 적용 (수학좌표 반환)
    function applyT(p) {
      const a = G.rad(rotDeg), cA = Math.cos(a), sA = Math.sin(a);
      const rot = (q) => [q[0] * cA - q[1] * sA, q[0] * sA + q[1] * cA];
      const trn = (q) => [q[0] + moveX, q[1]];
      return rotateFirst ? trn(rot(p)) : rot(trn(p));
    }

    function polyPath(pts, mapFn) {
      ctx.beginPath();
      pts.forEach((p, i) => {
        const m = mapFn(p);
        const sp = { x: cs.sx(m[0]), y: cs.sy(m[1]) };
        if (i === 0) ctx.moveTo(sp.x, sp.y); else ctx.lineTo(sp.x, sp.y);
      });
      ctx.closePath();
    }

    function draw() {
      cs = G.centered(canvas._cssW, canvas._cssH, 45);
      const w = canvas._cssW, h = canvas._cssH;
      G.clear(ctx, w, h);
      cs.drawGrid(ctx);
      cs.drawAxes(ctx);

      // 원본(흐린)
      polyPath(shape, (p) => p);
      ctx.fillStyle = "rgba(154,161,178,0.15)";
      ctx.strokeStyle = COL.dim;
      ctx.lineWidth = 1.5;
      ctx.fill(); ctx.stroke();

      // 변환됨(밝은)
      polyPath(shape, applyT);
      ctx.fillStyle = "rgba(110,168,254,0.30)";
      ctx.strokeStyle = COL.accent;
      ctx.lineWidth = 2;
      ctx.fill(); ctx.stroke();

      // 활성 순서 라벨
      const label = rotateFirst ? "활성 순서: 회전 → 이동" : "활성 순서: 이동 → 회전";
      G.text(ctx, label, 12, 20, COL.yellow, "bold 14px sans-serif");
      G.text(ctx, "회색 = 원본, 파랑 = 변환 결과", 12, 40, COL.dim, "12px sans-serif");
    }

    window.addEventListener("resize", draw);
    draw();
  }

  // ==========================================================
  // 5. 내적 (Dot Product)
  // ==========================================================
  function initDot() {
    if (!document.getElementById("c-dot")) return;
    const { canvas, ctx } = G.setup("c-dot");
    const readout = document.getElementById("r-dot");
    let cs = G.centered(canvas._cssW, canvas._cssH, 45);

    // 숨겨진 섹션 대비: 유효 폭이 생긴 첫 draw에서 한 번만 배치.
    const pts = [
      { x: 0, y: 0, color: COL.accent, label: "A" },
      { x: 0, y: 0, color: COL.green, label: "B" },
    ];
    let placed = false;
    function placeHandles() {
      pts[0].x = cs.sx(2.5); pts[0].y = cs.sy(0.5);
      pts[1].x = cs.sx(1); pts[1].y = cs.sy(2.2);
    }
    const drag = G.draggable(canvas, pts, () => draw());

    function draw() {
      cs = G.centered(canvas._cssW, canvas._cssH, 45);
      if (!placed && canvas._cssW > 0) { placeHandles(); placed = true; }
      const w = canvas._cssW, h = canvas._cssH;
      G.clear(ctx, w, h);
      cs.drawGrid(ctx);
      cs.drawAxes(ctx);

      const o = { x: cs.sx(0), y: cs.sy(0) };
      const A = [cs.mx(pts[0].x), cs.my(pts[0].y)];
      const B = [cs.mx(pts[1].x), cs.my(pts[1].y)];

      const dotv = G.V.dot(A, B);
      const lenA = G.V.len(A) || 1e-9;
      const lenB = G.V.len(B) || 1e-9;
      const cosT = G.clamp(dotv / (lenA * lenB), -1, 1);
      const angDeg = G.deg(Math.acos(cosT));

      // 사이각 부호별 색상
      let arcColor, interp;
      if (dotv > 0.05 * lenA * lenB) { arcColor = COL.green; interp = "같은 방향"; }
      else if (dotv < -0.05 * lenA * lenB) { arcColor = COL.red; interp = "반대 방향"; }
      else { arcColor = COL.yellow; interp = "수직"; }

      // 각 호 그리기 (화면 각도. y가 뒤집혀 있으므로 -atan2)
      const aA = Math.atan2(-(A[1]), A[0]);
      const aB = Math.atan2(-(B[1]), B[0]);
      const rArc = 45;
      // 두 각 사이의 최소 각도 방향으로 호를 그림
      let start = aA, end = aB;
      let diff = end - start;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      ctx.strokeStyle = arcColor;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(o.x, o.y, rArc, start, start + diff, diff < 0);
      ctx.stroke();

      const pA = { x: cs.sx(A[0]), y: cs.sy(A[1]) };
      const pB = { x: cs.sx(B[0]), y: cs.sy(B[1]) };
      G.arrow(ctx, o.x, o.y, pA.x, pA.y, COL.accent, 2.5);
      G.arrow(ctx, o.x, o.y, pB.x, pB.y, COL.green, 2.5);

      drag.drawHandles(ctx);

      if (readout) {
        readout.innerHTML =
          `A · B = ${r1(dotv)}   사이각 = ${r1(angDeg)}°   ` +
          `<span style="color:${arcColor};font-weight:bold">${interp}</span>`;
      }
    }

    window.addEventListener("resize", draw);
    draw();
  }

  // ==========================================================
  // 6. 외적 2D (Cross Product)
  // ==========================================================
  function initCross() {
    if (!document.getElementById("c-cross")) return;
    const { canvas, ctx } = G.setup("c-cross");
    const readout = document.getElementById("r-cross");
    let cs = G.centered(canvas._cssW, canvas._cssH, 45);

    // 숨겨진 섹션 대비: 유효 폭이 생긴 첫 draw에서 한 번만 배치.
    const pts = [
      { x: 0, y: 0, color: COL.accent, label: "A" },
      { x: 0, y: 0, color: COL.green, label: "B" },
    ];
    let placed = false;
    function placeHandles() {
      pts[0].x = cs.sx(2.5); pts[0].y = cs.sy(0.3);
      pts[1].x = cs.sx(0.8); pts[1].y = cs.sy(2);
    }
    const drag = G.draggable(canvas, pts, () => draw());

    function draw() {
      cs = G.centered(canvas._cssW, canvas._cssH, 45);
      if (!placed && canvas._cssW > 0) { placeHandles(); placed = true; }
      const w = canvas._cssW, h = canvas._cssH;
      G.clear(ctx, w, h);
      cs.drawGrid(ctx);
      cs.drawAxes(ctx);

      const o = { x: cs.sx(0), y: cs.sy(0) };
      const A = [cs.mx(pts[0].x), cs.my(pts[0].y)];
      const B = [cs.mx(pts[1].x), cs.my(pts[1].y)];
      const crossv = G.V.cross2(A, B);

      // 평행사변형 꼭짓점: 0, A, A+B, B
      const S = G.V.add(A, B);
      const p = (v) => ({ x: cs.sx(v[0]), y: cs.sy(v[1]) });
      const p0 = o, pA = p(A), pS = p(S), pB = p(B);

      // 부호별 채우기 색
      ctx.fillStyle = crossv >= 0
        ? "rgba(126,231,135,0.28)"   // 양수 = 초록(반시계)
        : "rgba(255,123,114,0.28)";  // 음수 = 빨강(시계)
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y); ctx.lineTo(pA.x, pA.y);
      ctx.lineTo(pS.x, pS.y); ctx.lineTo(pB.x, pB.y);
      ctx.closePath();
      ctx.fill();

      G.arrow(ctx, o.x, o.y, pA.x, pA.y, COL.accent, 2.5);
      G.arrow(ctx, o.x, o.y, pB.x, pB.y, COL.green, 2.5);

      drag.drawHandles(ctx);

      if (readout) {
        const side = crossv >= 0 ? "B가 A의 왼쪽 (양수, 반시계)" : "B가 A의 오른쪽 (음수, 시계)";
        const sideColor = crossv >= 0 ? COL.green : COL.red;
        readout.innerHTML =
          `A × B = ${r1(crossv)}   넓이 = |A×B| = ${r1(Math.abs(crossv))}   ` +
          `<span style="color:${sideColor};font-weight:bold">${side}</span>`;
      }
    }

    window.addEventListener("resize", draw);
    draw();
  }

  // ==========================================================
  // 7. 삼각함수 (단위원 + 파형)
  // ==========================================================
  function initTrig() {
    if (!document.getElementById("c-trig")) return;
    const { canvas, ctx } = G.setup("c-trig");
    const ctl = document.getElementById("ctl-trig");

    let theta = 45; // 도
    let auto = false;
    let anim = null;

    let sTheta;
    if (ctl) {
      sTheta = G.slider(ctl, { label: "각도 θ (도)", min: 0, max: 360, step: 1, value: 45, onInput: (v) => { theta = v; if (!auto) draw(); } });
      G.checkbox(ctl, "자동 회전", false, (on) => {
        auto = on;
        if (on) {
          anim = G.loop(() => {
            theta = (theta + 1.2) % 360;
            if (sTheta) sTheta.input.value = theta;
            draw();
          });
        } else if (anim) { anim.stop(); anim = null; }
      });
    }

    function draw() {
      const w = canvas._cssW, h = canvas._cssH;
      G.clear(ctx, w, h);

      const rad = G.rad(theta);
      const cosV = Math.cos(rad), sinV = Math.sin(rad);

      // ---- 왼쪽: 단위원 ----
      const leftW = w * 0.42;
      const R = Math.min(leftW, h) * 0.36;
      const cx = leftW * 0.5, cy = h * 0.5;

      // 축
      G.line(ctx, cx - R - 15, cy, cx + R + 15, cy, COL.gridAxis, 1.5);
      G.line(ctx, cx, cy - R - 15, cx, cy + R + 15, COL.gridAxis, 1.5);
      // 단위원
      ctx.strokeStyle = COL.grid; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();

      const px = cx + cosV * R, py = cy - sinV * R;

      // cos 투영(빨강, 수평), sin 투영(초록, 수직)
      G.line(ctx, cx, cy, px, cy, COL.red, 3);        // cos
      G.line(ctx, px, cy, px, py, COL.green, 3);       // sin
      G.line(ctx, cx, py, px, py, COL.green, 1, [3, 3]);

      // 반지름
      G.arrow(ctx, cx, cy, px, py, COL.yellow, 2.5);
      G.dot(ctx, px, py, 5, COL.yellow);
      G.text(ctx, "cos", (cx + px) / 2, cy + 14, COL.red, "12px sans-serif", "center");
      G.text(ctx, "sin", px + 8, (cy + py) / 2, COL.green, "12px sans-serif");

      // ---- 오른쪽: 파형 ----
      const rx0 = leftW + 10;
      const rw = w - rx0 - 10;
      const rcy = h * 0.5;
      const amp = Math.min(h * 0.32, rw * 0.12);

      // 기준선
      G.line(ctx, rx0, rcy, rx0 + rw, rcy, COL.gridAxis, 1);

      // 0..2π 구간을 파형 폭에 매핑
      function waveX(ang) { return rx0 + (ang / (Math.PI * 2)) * rw; }
      // cos 파형(빨강)
      ctx.strokeStyle = COL.red; ctx.lineWidth = 2; ctx.beginPath();
      for (let i = 0; i <= rw; i++) {
        const ang = (i / rw) * Math.PI * 2;
        const y = rcy - Math.cos(ang) * amp;
        if (i === 0) ctx.moveTo(rx0 + i, y); else ctx.lineTo(rx0 + i, y);
      }
      ctx.stroke();
      // sin 파형(초록)
      ctx.strokeStyle = COL.green; ctx.lineWidth = 2; ctx.beginPath();
      for (let i = 0; i <= rw; i++) {
        const ang = (i / rw) * Math.PI * 2;
        const y = rcy - Math.sin(ang) * amp;
        if (i === 0) ctx.moveTo(rx0 + i, y); else ctx.lineTo(rx0 + i, y);
      }
      ctx.stroke();

      // 현재 θ 마커
      const mx = waveX(rad);
      G.line(ctx, mx, rcy - amp - 8, mx, rcy + amp + 8, COL.dim, 1, [4, 4]);
      G.dot(ctx, mx, rcy - cosV * amp, 4, COL.red);
      G.dot(ctx, mx, rcy - sinV * amp, 4, COL.green);

      // 값 텍스트
      G.text(ctx, `θ = ${theta.toFixed(0)}°`, rx0, 18, COL.text, "bold 13px sans-serif");
      G.text(ctx, `cos θ = ${cosV.toFixed(3)}`, rx0, 38, COL.red, "13px sans-serif");
      G.text(ctx, `sin θ = ${sinV.toFixed(3)}`, rx0, 56, COL.green, "13px sans-serif");
    }

    window.addEventListener("resize", draw);
    draw();
  }

  // ==========================================================
  // 8. 점이 삼각형 안에 있는가 (외적 부호)
  // ==========================================================
  function initInside() {
    if (!document.getElementById("c-inside")) return;
    const { canvas, ctx } = G.setup("c-inside");
    const readout = document.getElementById("r-inside");

    // 화면 픽셀 좌표 그대로 사용 (중심 좌표계 불필요).
    // 숨겨진 섹션은 init 시 폭이 0이라 핸들이 좌상단에 쏠린다.
    // 유효한 폭이 생긴 첫 draw에서 한 번만 배치한다(드래그 보존).
    const pts = [
      { x: 0, y: 0, color: COL.accent, label: "P1" },
      { x: 0, y: 0, color: COL.accent, label: "P2" },
      { x: 0, y: 0, color: COL.accent, label: "P3" },
      { x: 0, y: 0, color: COL.red, label: "T" },
    ];
    let placed = false;
    function placeHandles() {
      const W = canvas._cssW, H = canvas._cssH;
      pts[0].x = W * 0.3; pts[0].y = H * 0.25;
      pts[1].x = W * 0.7; pts[1].y = H * 0.35;
      pts[2].x = W * 0.45; pts[2].y = H * 0.75;
      pts[3].x = W * 0.48; pts[3].y = H * 0.45;
    }
    const drag = G.draggable(canvas, pts, () => draw());

    // 세 점 부호 (화면좌표는 y가 아래로 향함 → 부호 규약이 반대지만 일관성만 있으면 됨)
    function sign(p1, p2, p) {
      return (p2.x - p1.x) * (p.y - p1.y) - (p2.y - p1.y) * (p.x - p1.x);
    }

    function draw() {
      const w = canvas._cssW, h = canvas._cssH;
      if (!placed && w > 0) { placeHandles(); placed = true; }
      G.clear(ctx, w, h);
      G.grid(ctx, w, h, 40, COL.grid);

      const a = pts[0], b = pts[1], c = pts[2], t = pts[3];
      const d1 = sign(a, b, t);
      const d2 = sign(b, c, t);
      const d3 = sign(c, a, t);

      const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
      const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
      const inside = !(hasNeg && hasPos);

      // 삼각형
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y);
      ctx.closePath();
      ctx.fillStyle = inside ? "rgba(126,231,135,0.30)" : "rgba(255,123,114,0.12)";
      ctx.strokeStyle = inside ? COL.green : COL.red;
      ctx.lineWidth = 2;
      ctx.fill(); ctx.stroke();

      // 테스트 점
      drag.drawHandles(ctx);

      if (readout) {
        const s = (v) => (v > 0 ? "+" : v < 0 ? "−" : "0");
        readout.innerHTML =
          `모서리 외적 부호: P1P2=${s(d1)}  P2P3=${s(d2)}  P3P1=${s(d3)}   ` +
          `<span style="color:${inside ? COL.green : COL.red};font-weight:bold">` +
          `${inside ? "안 (inside)" : "밖 (outside)"}</span>` +
          `<br><span style="color:${COL.dim}">세 부호가 모두 같으면 → 안쪽.</span>`;
      }
    }

    window.addEventListener("resize", draw);
    draw();
  }

  // ==========================================================
  // 부팅: 각 데모를 try/catch로 격리해 초기화
  // ==========================================================
  G.deferInit("c-vector", initVectorAdd);
  G.deferInit("c-normalize", initNormalize);
  G.deferInit("c-matrix", initMatrix);
  G.deferInit("c-transform", initTransform);
  G.deferInit("c-dot", initDot);
  G.deferInit("c-cross", initCross);
  G.deferInit("c-trig", initTrig);
  G.deferInit("c-inside", initInside);
})();
