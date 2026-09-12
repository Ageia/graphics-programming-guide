/* ============================================================
   demos-3d.js — 3D 그래픽스 데모 (소프트웨어 렌더러)
   Canvas 2D 컨텍스트 위에서 직접 투영/래스터화한다.
   전역 GFX (lib.js) 의 M4/V 수학 키트를 사용한다.
   ============================================================ */
(function () {
  "use strict";

  const { M4, V, COL, clamp, lerp, rad } = GFX;

  // ---- 공통 헬퍼 --------------------------------------------

  // 클립좌표 -> 화면픽셀. mvp*p 후 원근 나눗셈, NDC(-1..1)->픽셀.
  // 반환: {x, y, z, w, vis}  (vis: w>0 이고 유효한가)
  function project(mvp, p, w, h) {
    const c = M4.apply(mvp, p);
    if (c.w <= 1e-6) return { x: 0, y: 0, z: c.z, w: c.w, vis: false };
    const nx = c.x / c.w, ny = c.y / c.w, nz = c.z / c.w;
    return {
      x: (nx * 0.5 + 0.5) * w,
      y: (1 - (ny * 0.5 + 0.5)) * h,
      z: nz,
      w: c.w,
      vis: true,
    };
  }

  // 단위 큐브 정점 (-1..1)
  const CUBE_V = [
    [-1,-1,-1],[ 1,-1,-1],[ 1, 1,-1],[-1, 1,-1],
    [-1,-1, 1],[ 1,-1, 1],[ 1, 1, 1],[-1, 1, 1],
  ];
  // 6개 면 (사각형, 반시계 정면 기준) + 색 + 로컬 법선
  const CUBE_F = [
    { idx: [0,3,2,1], n: [ 0, 0,-1], col: COL.red },
    { idx: [4,5,6,7], n: [ 0, 0, 1], col: COL.green },
    { idx: [0,1,5,4], n: [ 0,-1, 0], col: COL.yellow },
    { idx: [3,7,6,2], n: [ 0, 1, 0], col: COL.accent },
    { idx: [0,4,7,3], n: [-1, 0, 0], col: COL.purple },
    { idx: [1,2,6,5], n: [ 1, 0, 0], col: COL.cyan },
  ];
  // 큐브 와이어 엣지
  const CUBE_E = [
    [0,1],[1,2],[2,3],[3,0],
    [4,5],[5,6],[6,7],[7,4],
    [0,4],[1,5],[2,6],[3,7],
  ];

  // "#rrggbb" -> [r,g,b]
  function hex2rgb(hex) {
    const s = hex.replace("#", "");
    return [parseInt(s.slice(0,2),16), parseInt(s.slice(2,4),16), parseInt(s.slice(4,6),16)];
  }
  function shade(hex, k) {
    const [r,g,b] = hex2rgb(hex);
    k = clamp(k, 0, 1);
    return `rgb(${Math.round(r*k)},${Math.round(g*k)},${Math.round(b*k)})`;
  }

  // 화면좌표 3점 다각형 채우기
  function fillPoly(ctx, pts, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }

  // 화면 2D 다각형의 부호있는 넓이(>0: 반시계 = 화면상 뒷면 판정용)
  function signedArea(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i+1) % pts.length];
      a += p.x * q.y - q.x * p.y;
    }
    return a * 0.5;
  }

  // UV 구 메시 생성. segments = 위/경도 분할수. 삼각형 배열 반환.
  // 각 삼각형: {v:[[x,y,z],..3], n:[면법선]}
  function makeSphere(seg) {
    const rings = seg, sectors = seg * 2;
    const verts = [];
    for (let i = 0; i <= rings; i++) {
      const phi = Math.PI * (i / rings);       // 0..π
      const sp = Math.sin(phi), cp = Math.cos(phi);
      for (let j = 0; j <= sectors; j++) {
        const th = 2 * Math.PI * (j / sectors); // 0..2π
        verts.push([sp * Math.cos(th), cp, sp * Math.sin(th)]);
      }
    }
    const tris = [];
    const idx = (i, j) => i * (sectors + 1) + j;
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < sectors; j++) {
        const a = verts[idx(i, j)], b = verts[idx(i+1, j)];
        const c = verts[idx(i+1, j+1)], d = verts[idx(i, j+1)];
        // 구는 법선 = 정규화된 위치. 면법선은 삼각형 무게중심으로.
        pushTri(tris, a, b, c);
        pushTri(tris, a, c, d);
      }
    }
    return tris;
  }
  function pushTri(tris, a, b, c) {
    const cx = (a[0]+b[0]+c[0])/3, cy = (a[1]+b[1]+c[1])/3, cz = (a[2]+b[2]+c[2])/3;
    tris.push({ v: [a, b, c], n: V.norm([cx, cy, cz]) });
  }

  // ============================================================
  // 1. MVP 파이프라인
  // ============================================================
  function initMVP() {
    const el = document.getElementById("c-mvp");
    if (!el) return;
    const S = GFX.setup("c-mvp");
    const ctl = document.getElementById("ctl-mvp");
    const orbit = { rx: 0.4, ry: 0 };
    let dragging = false;

    const sModel = GFX.slider(ctl, { label: "Model · 모델 회전 Y (°)", min: 0, max: 360, step: 1, value: 30 });
    const sWorld = GFX.slider(ctl, { label: "World · 위치 X", min: -3, max: 3, step: 0.05, value: 0 });
    const sView  = GFX.slider(ctl, { label: "View · 카메라 거리", min: 2, max: 10, step: 0.1, value: 5 });
    const sProj  = GFX.slider(ctl, { label: "Projection · 시야각 FOV (°)", min: 30, max: 100, step: 1, value: 55 });

    GFX.orbitControl(S.canvas, orbit);
    S.canvas.addEventListener("mousedown", () => { dragging = true; });
    window.addEventListener("mouseup", () => { dragging = false; });

    let auto = 0;
    function draw(dt) {
      if (!dragging) auto += dt * 0.4; // 유휴 시 부드러운 자동회전
      const w = S.w, h = S.h, ctx = S.ctx;
      GFX.clear(ctx, w, h);

      const model = M4.mul(
        M4.mul(M4.rotY(rad(sModel.get()) + auto), M4.rotX(orbit.rx)),
        M4.rotY(orbit.ry)
      );
      const worldT = M4.translate(sWorld.get(), 0, 0);
      const eye = [0, 0, sView.get()];
      const view = M4.lookAt(eye, [0, 0, 0], [0, 1, 0]);
      const proj = M4.perspective(rad(sProj.get()), w / h, 0.1, 100);
      const mv = M4.mul(view, M4.mul(worldT, model));
      const mvp = M4.mul(proj, mv);

      // 정점 투영
      const scr = CUBE_V.map((p) => project(mvp, p, w, h));

      // 면: 카메라공간 평균 z 로 정렬(painter). 뒷면 컬링.
      const faces = [];
      CUBE_F.forEach((f) => {
        const sp = f.idx.map((i) => scr[i]);
        if (sp.some((p) => !p.vis)) return;
        if (signedArea(sp) <= 0) return; // 화면상 뒷면 컬링
        let az = 0;
        f.idx.forEach((i) => {
          const c = M4.apply(mv, CUBE_V[i]);
          az += c.z;
        });
        az /= 4;
        // 조명: 회전된 법선 · 빛
        const nm = M4.apply(model, f.n);
        const N = V.norm([nm.x, nm.y, nm.z]);
        const L = V.norm([0.4, 0.8, 0.6]);
        const diff = clamp(V.dot(N, L), 0, 1);
        faces.push({ sp, az, col: f.col, k: 0.35 + 0.65 * diff });
      });
      faces.sort((a, b) => a.az - b.az); // 먼 것 먼저
      faces.forEach((f) => {
        fillPoly(ctx, f.sp, shade(f.col, f.k), "rgba(0,0,0,0.4)");
      });
      // 와이어프레임
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1;
      CUBE_E.forEach(([a, b]) => {
        if (!scr[a].vis || !scr[b].vis) return;
        ctx.beginPath();
        ctx.moveTo(scr[a].x, scr[a].y);
        ctx.lineTo(scr[b].x, scr[b].y);
        ctx.stroke();
      });

      // 단계 라벨
      const labels = ["Model", "World", "View", "Projection"];
      const cols = [COL.red, COL.green, COL.yellow, COL.accent];
      labels.forEach((t, i) => {
        GFX.text(ctx, "▶ " + t, 12, 20 + i * 18, cols[i], "bold 12px 'JetBrains Mono', monospace");
      });
    }
    GFX.loop(draw);
  }

  // ============================================================
  // 2. 카메라 (탑뷰 + 카메라뷰)
  // ============================================================
  function initCamera() {
    const el = document.getElementById("c-camera");
    if (!el) return;
    const S = GFX.setup("c-camera");
    const ctl = document.getElementById("ctl-camera");

    // 바닥 위 색 상자들 (x,z 위치)
    const objs = [
      { x: 2, z: -2, col: COL.red },
      { x: -2, z: -3, col: COL.green },
      { x: 0, z: -5, col: COL.yellow },
      { x: 3, z: -6, col: COL.cyan },
      { x: -3, z: -6, col: COL.purple },
    ];
    const size = 0.6, boxH = 1.2;

    const sX   = GFX.slider(ctl, { label: "카메라 X", min: -6, max: 6, step: 0.1, value: 0 });
    const sZ   = GFX.slider(ctl, { label: "카메라 Z", min: -2, max: 6, step: 0.1, value: 3 });
    const sYaw = GFX.slider(ctl, { label: "바라보는 각도 (°)", min: -180, max: 180, step: 1, value: 180 });
    const sFov = GFX.slider(ctl, { label: "시야각 FOV (°)", min: 30, max: 110, step: 1, value: 60 });

    sX.input.addEventListener("input", render);
    sZ.input.addEventListener("input", render);
    sYaw.input.addEventListener("input", render);
    sFov.input.addEventListener("input", render);
    window.addEventListener("resize", () => setTimeout(render, 50));

    function render() {
      const w = S.w, h = S.h, ctx = S.ctx;
      const halfH = h / 2;
      GFX.clear(ctx, w, h);

      const camX = sX.get(), camZ = sZ.get();
      const yaw = rad(sYaw.get());
      const fov = rad(sFov.get());
      // 바라보는 방향 (xz 평면). yaw=0 -> -z 정면.
      const dir = [Math.sin(yaw), Math.cos(yaw)]; // (dx, dz)

      // ---------- 상단: 탑뷰 맵 ----------
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, w, halfH); ctx.clip();
      GFX.clear(ctx, w, halfH, "#0e1220");
      // 월드->탑뷰 픽셀. x: -8..8, z: -9..4 를 매핑.
      const mScale = Math.min(w / 16, halfH / 13);
      const mox = w / 2, moz = halfH * 0.72; // z=0 화면 위치
      const toMap = (x, z) => ({ x: mox + x * mScale, y: moz + z * mScale });
      // 격자
      ctx.strokeStyle = COL.grid; ctx.lineWidth = 1;
      for (let gx = -8; gx <= 8; gx += 2) {
        const a = toMap(gx, -9), b = toMap(gx, 4);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      for (let gz = -9; gz <= 4; gz += 2) {
        const a = toMap(-8, gz), b = toMap(8, gz);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      // 상자 (위에서 본 정사각형)
      objs.forEach((o) => {
        const p = toMap(o.x, o.z);
        const s = size * mScale;
        ctx.fillStyle = o.col;
        ctx.fillRect(p.x - s, p.y - s, s * 2, s * 2);
      });
      // 카메라 + 시야 콘
      const cp = toMap(camX, camZ);
      const coneLen = 9;
      const aL = yaw - fov / 2, aR = yaw + fov / 2;
      const pL = toMap(camX + Math.sin(aL) * coneLen, camZ + Math.cos(aL) * coneLen);
      const pR = toMap(camX + Math.sin(aR) * coneLen, camZ + Math.cos(aR) * coneLen);
      ctx.fillStyle = "rgba(110,168,254,0.12)";
      ctx.beginPath(); ctx.moveTo(cp.x, cp.y); ctx.lineTo(pL.x, pL.y); ctx.lineTo(pR.x, pR.y); ctx.closePath(); ctx.fill();
      GFX.line(ctx, cp.x, cp.y, pL.x, pL.y, COL.accent, 1.5, [4, 3]);
      GFX.line(ctx, cp.x, cp.y, pR.x, pR.y, COL.accent, 1.5, [4, 3]);
      // 카메라 삼각형 (바라보는 방향)
      const fpt = toMap(camX + dir[0] * 1.2, camZ + dir[1] * 1.2);
      const perp = [-dir[1], dir[0]];
      const b1 = toMap(camX + perp[0] * 0.5, camZ + perp[1] * 0.5);
      const b2 = toMap(camX - perp[0] * 0.5, camZ - perp[1] * 0.5);
      ctx.fillStyle = COL.text;
      ctx.beginPath(); ctx.moveTo(fpt.x, fpt.y); ctx.lineTo(b1.x, b1.y); ctx.lineTo(b2.x, b2.y); ctx.closePath(); ctx.fill();
      GFX.text(ctx, "탑뷰 (세계를 위에서)", 10, 16, COL.dim, "12px 'JetBrains Mono', monospace");
      ctx.restore();

      // 경계선
      GFX.line(ctx, 0, halfH, w, halfH, COL.gridAxis, 2);

      // ---------- 하단: 카메라가 보는 화면 ----------
      ctx.save();
      ctx.beginPath(); ctx.rect(0, halfH, w, halfH); ctx.clip();
      ctx.translate(0, halfH);
      GFX.clear(ctx, w, halfH, "#0b0d13");
      const eye = [camX, 1.0, camZ];
      const center = [camX + dir[0], 1.0, camZ + dir[1]];
      const view = M4.lookAt(eye, center, [0, 1, 0]);
      const proj = M4.perspective(fov, w / halfH, 0.1, 100);
      const vp = M4.mul(proj, view);

      // 바닥선(간이 지평선/격자) 투영
      ctx.strokeStyle = "rgba(120,130,160,0.25)"; ctx.lineWidth = 1;
      for (let gx = -8; gx <= 8; gx += 2) {
        const a = project(vp, [gx, 0, -9], w, halfH), b = project(vp, [gx, 0, 4], w, halfH);
        if (a.vis && b.vis) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      }
      for (let gz = -9; gz <= 4; gz += 2) {
        const a = project(vp, [-8, 0, gz], w, halfH), b = project(vp, [8, 0, gz], w, halfH);
        if (a.vis && b.vis) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      }
      // 상자를 카메라공간 z 로 정렬 후 정육면체로 렌더
      const drawList = objs.map((o) => {
        const c = M4.apply(view, [o.x, boxH / 2, o.z]);
        return { o, z: c.z };
      }).sort((a, b) => a.z - b.z); // 먼 것 먼저
      drawList.forEach(({ o }) => {
        // 상자 8정점
        const vs = [];
        for (let dy = 0; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz += 2)
            for (let dx = -1; dx <= 1; dx += 2)
              vs.push([o.x + dx * size, dy * boxH, o.z + dz * size]);
        const sp = vs.map((p) => project(vp, p, w, halfH));
        if (sp.some((p) => !p.vis)) return;
        // 큐브 면 인덱스 (vs 순서 기준)
        const F = [
          [0,1,3,2],[4,6,7,5],[0,2,6,4],[1,5,7,3],[2,3,7,6],[0,4,5,1],
        ];
        const shaded = [0.5,0.9,0.6,0.7,0.85,0.55];
        F.forEach((f, fi) => {
          const pts = f.map((i) => sp[i]);
          if (signedArea(pts) <= 0) return;
          fillPoly(ctx, pts, shade(o.col, shaded[fi]), "rgba(0,0,0,0.35)");
        });
      });
      GFX.text(ctx, "카메라 뷰 (이 카메라가 보는 화면)", 10, 16, COL.dim, "12px 'JetBrains Mono', monospace");
      ctx.restore();
    }
    render();
  }

  // ============================================================
  // 3. 메시 (UV 구, 세분화)
  // ============================================================
  function initMesh() {
    const el = document.getElementById("c-mesh");
    if (!el) return;
    const S = GFX.setup("c-mesh");
    const ctl = document.getElementById("ctl-mesh");
    const orbit = { rx: 0.3, ry: 0 };
    let dragging = false, wire = false;
    let tris = makeSphere(8);
    const info = document.createElement("div");
    info.className = "readout";

    GFX.checkbox(ctl, "와이어프레임", false, (v) => { wire = v; });
    const sSeg = GFX.slider(ctl, {
      label: "세분화 (segments)", min: 3, max: 24, step: 1, value: 8,
      onInput: (v) => { tris = makeSphere(Math.round(v)); updateInfo(); },
    });
    ctl.appendChild(info);
    function updateInfo() { info.textContent = "삼각형 수: " + tris.length + "개"; }
    updateInfo();

    GFX.orbitControl(S.canvas, orbit);
    S.canvas.addEventListener("mousedown", () => { dragging = true; });
    window.addEventListener("mouseup", () => { dragging = false; });

    let auto = 0;
    function draw(dt) {
      if (!dragging) auto += dt * 0.5;
      const w = S.w, h = S.h, ctx = S.ctx;
      GFX.clear(ctx, w, h);

      const model = M4.mul(M4.rotX(orbit.rx), M4.rotY(orbit.ry + auto));
      const eye = [0, 0, 3.2];
      const view = M4.lookAt(eye, [0, 0, 0], [0, 1, 0]);
      const proj = M4.perspective(rad(50), w / h, 0.1, 100);
      const mv = M4.mul(view, model);
      const mvp = M4.mul(proj, mv);
      const L = V.norm([0.5, 0.7, 0.8]);

      const drawn = [];
      tris.forEach((t) => {
        const sp = t.v.map((p) => project(mvp, p, w, h));
        if (sp.some((p) => !p.vis)) return;
        if (signedArea(sp) <= 0) return; // 뒷면 컬링
        // 카메라공간 z 평균
        let az = 0;
        t.v.forEach((p) => { az += M4.apply(mv, p).z; });
        az /= 3;
        const nm = M4.apply(model, t.n);
        const N = V.norm([nm.x, nm.y, nm.z]);
        const k = 0.25 + 0.75 * clamp(V.dot(N, L), 0, 1);
        drawn.push({ sp, az, k });
      });
      drawn.sort((a, b) => a.az - b.az);
      drawn.forEach((d) => {
        if (wire) {
          fillPoly(ctx, d.sp, null, COL.accent);
        } else {
          fillPoly(ctx, d.sp, shade("#6ea8fe", d.k), null);
        }
      });
    }
    GFX.loop(draw);
  }

  // ============================================================
  // 4. Z-buffer (소프트웨어 깊이 테스트)
  // ============================================================
  function initZBuffer() {
    const el = document.getElementById("c-zbuffer");
    if (!el) return;
    const S = GFX.setup("c-zbuffer");
    const ctl = document.getElementById("ctl-zbuffer");
    let useZ = true;

    // 컨트롤 생성 시 render()가 즉시 호출되므로 render가 쓰는 상태(sRot, T)를 먼저 선언(TDZ 방지)
    let sRot;
    // 세 개의 서로 교차하는 삼각형 (색 다름, 깊이 다름)
    const T = [
      { v: [[-1.2,-0.9, 0.6],[ 1.2,-0.9,-0.6],[ 0.0, 1.1, 0.0]], col: [255,123,114] },
      { v: [[-1.2,-0.9,-0.6],[ 1.2,-0.9, 0.6],[ 0.0, 1.1, 0.0]], col: [126,231,135] },
      { v: [[-1.2, 0.9, 0.0],[ 1.2, 0.9, 0.0],[ 0.0,-1.1, 0.0]], col: [110,168,254] },
    ];

    GFX.checkbox(ctl, "깊이 테스트(Z-buffer) 켜기", true, (v) => { useZ = v; render(); });
    sRot = GFX.slider(ctl, { label: "회전 (°)", min: 0, max: 360, step: 1, value: 40, onInput: render });
    window.addEventListener("resize", () => setTimeout(render, 50));

    function render() {
      const w = S.w, h = S.h, ctx = S.ctx;
      GFX.clear(ctx, w, h);
      // 내부 렌더 해상도 (성능)
      const RW = 300, RH = Math.round(RW * (h / w));
      const model = M4.mul(M4.rotY(rad(sRot ? sRot.get() : 40)), M4.rotX(0.35));
      const view = M4.lookAt([0, 0, 4], [0, 0, 0], [0, 1, 0]);
      const proj = M4.perspective(rad(50), RW / RH, 0.1, 100);
      const mvp = M4.mul(proj, M4.mul(view, model));

      const img = ctx.createImageData(RW, RH);
      const data = img.data;
      const depth = new Float32Array(RW * RH).fill(Infinity);
      // 배경색
      const bg = hex2rgb(COL.bg);
      for (let i = 0; i < RW * RH; i++) {
        data[i*4] = bg[0]; data[i*4+1] = bg[1]; data[i*4+2] = bg[2]; data[i*4+3] = 255;
      }

      // 삼각형 순서: Z-off 일 때 "틀린 순서"로 늦게 그린 게 무조건 위.
      // (파랑을 마지막에 그리면 원래 뒤여야 할 부분도 덮임)
      const order = [0, 1, 2];
      order.forEach((ti) => {
        const t = T[ti];
        const sp = t.v.map((p) => {
          const c = M4.apply(mvp, p);
          if (c.w <= 1e-6) return null;
          return {
            x: (c.x / c.w * 0.5 + 0.5) * RW,
            y: (1 - (c.y / c.w * 0.5 + 0.5)) * RH,
            z: c.z / c.w,
          };
        });
        if (sp.some((p) => !p)) return;
        rasterTri(data, depth, RW, RH, sp, t.col, useZ);
      });

      // ImageData -> 확대 렌더 (nearest)
      const tmp = document.createElement("canvas");
      tmp.width = RW; tmp.height = RH;
      tmp.getContext("2d").putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tmp, 0, 0, w, h);

      GFX.text(ctx, useZ ? "깊이 테스트: 켜짐 (올바른 가림)" : "깊이 테스트: 꺼짐 (그린 순서대로)",
        12, h - 16, useZ ? COL.green : COL.red, "bold 13px 'JetBrains Mono', monospace");
    }

    // 삼각형 래스터화 (barycentric). useZ면 깊이비교.
    function rasterTri(data, depth, W, H, p, col, useZ) {
      const minX = Math.max(0, Math.floor(Math.min(p[0].x, p[1].x, p[2].x)));
      const maxX = Math.min(W - 1, Math.ceil(Math.max(p[0].x, p[1].x, p[2].x)));
      const minY = Math.max(0, Math.floor(Math.min(p[0].y, p[1].y, p[2].y)));
      const maxY = Math.min(H - 1, Math.ceil(Math.max(p[0].y, p[1].y, p[2].y)));
      const area = (p[1].x - p[0].x) * (p[2].y - p[0].y) - (p[2].x - p[0].x) * (p[1].y - p[0].y);
      if (Math.abs(area) < 1e-6) return;
      const inv = 1 / area;
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5, py = y + 0.5;
          const w0 = ((p[1].x - px) * (p[2].y - py) - (p[2].x - px) * (p[1].y - py)) * inv;
          const w1 = ((p[2].x - px) * (p[0].y - py) - (p[0].x - px) * (p[2].y - py)) * inv;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = w0 * p[0].z + w1 * p[1].z + w2 * p[2].z;
          const di = y * W + x;
          if (useZ) {
            if (z >= depth[di]) continue;
            depth[di] = z;
          }
          const o = di * 4;
          data[o] = col[0]; data[o+1] = col[1]; data[o+2] = col[2]; data[o+3] = 255;
        }
      }
    }
    render();
  }

  // ============================================================
  // 5. 조명 (Phong)
  // ============================================================
  function initLight() {
    const el = document.getElementById("c-light");
    if (!el) return;
    const S = GFX.setup("c-light");
    const ctl = document.getElementById("ctl-light");
    const tris = makeSphere(18);

    const sDir  = GFX.slider(ctl, { label: "빛 방향 각도 (°)", min: 0, max: 360, step: 1, value: 45 });
    const sShin = GFX.slider(ctl, { label: "광택 (shininess)", min: 1, max: 128, step: 1, value: 32 });
    const sAmb  = GFX.slider(ctl, { label: "주변광 Ambient", min: 0, max: 1, step: 0.01, value: 0.15 });

    let auto = 0;
    function draw(dt) {
      auto += dt * 0.3;
      const w = S.w, h = S.h, ctx = S.ctx;
      GFX.clear(ctx, w, h);

      const model = M4.rotY(auto);
      const eye = [0, 0, 3.2];
      const view = M4.lookAt(eye, [0, 0, 0], [0, 1, 0]);
      const proj = M4.perspective(rad(50), w / h, 0.1, 100);
      const mv = M4.mul(view, model);
      const mvp = M4.mul(proj, mv);

      // 빛 방향 (월드). 각도로 회전.
      const la = rad(sDir.get());
      const L = V.norm([Math.cos(la), 0.5, Math.sin(la)]);
      const Vd = V.norm(eye); // 뷰 방향 (구 중심->눈)
      const shin = sShin.get(), amb = sAmb.get();
      const base = [110, 168, 254];

      const drawn = [];
      tris.forEach((t) => {
        const sp = t.v.map((p) => project(mvp, p, w, h));
        if (sp.some((p) => !p.vis)) return;
        if (signedArea(sp) <= 0) return;
        let az = 0;
        t.v.forEach((p) => { az += M4.apply(mv, p).z; });
        az /= 3;
        // 월드 법선
        const nm = M4.apply(model, t.n);
        const N = V.norm([nm.x, nm.y, nm.z]);
        const diff = clamp(V.dot(N, L), 0, 1);
        // half-vector 스페큘러
        const Hh = V.norm(V.add(L, Vd));
        const spec = Math.pow(clamp(V.dot(N, Hh), 0, 1), shin) * (diff > 0 ? 1 : 0);
        drawn.push({ sp, az, diff, spec });
      });
      drawn.sort((a, b) => a.az - b.az);
      drawn.forEach((d) => {
        const shadeK = amb + (1 - amb) * d.diff;
        let r = base[0] * shadeK, g = base[1] * shadeK, b2 = base[2] * shadeK;
        const s = d.spec * 255;
        r = clamp(r + s, 0, 255); g = clamp(g + s, 0, 255); b2 = clamp(b2 + s, 0, 255);
        fillPoly(ctx, d.sp, `rgb(${r|0},${g|0},${b2|0})`, null);
      });

      // 빛 방향 인디케이터
      const lx = w - 46, ly = 46, r = 26;
      ctx.strokeStyle = COL.grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(lx, ly, r, 0, Math.PI*2); ctx.stroke();
      GFX.arrow(ctx, lx, ly, lx + L[0]*r, ly - L[2]*r, COL.yellow, 2);
      GFX.text(ctx, "빛", lx - 8, ly + r + 12, COL.yellow, "11px 'JetBrains Mono', monospace");
    }
    GFX.loop(draw);
  }

  // ============================================================
  // 6. 텍스처 큐브
  // ============================================================
  function initTexCube() {
    const el = document.getElementById("c-texcube");
    if (!el) return;
    const S = GFX.setup("c-texcube");
    const ctl = document.getElementById("ctl-texcube");
    const orbit = { rx: 0.4, ry: 0 };
    let dragging = false, textured = true;

    // 각 면 텍스처 (오프스크린 캔버스). 색 그리드 + 번호.
    const texs = [];
    const faceColors = ["#ff7b72", "#7ee787", "#ffd166", "#6ea8fe", "#c792ea", "#56d4dd"];
    const faceNames = ["1", "2", "3", "4", "5", "6"];
    for (let i = 0; i < 6; i++) texs.push(makeFaceTex(faceColors[i], faceNames[i]));

    function makeFaceTex(col, label) {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const g = c.getContext("2d");
      // 체커 + 배경색
      const n = 4, cs = 128 / n;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          g.fillStyle = ((x + y) % 2) ? col : shade(col, 0.55);
          g.fillRect(x * cs, y * cs, cs, cs);
        }
      g.strokeStyle = "rgba(0,0,0,0.5)"; g.lineWidth = 4;
      g.strokeRect(2, 2, 124, 124);
      g.fillStyle = "#0b0d13";
      g.font = "bold 64px sans-serif";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(label, 64, 68);
      return c;
    }

    const sSpeed = GFX.slider(ctl, { label: "회전 속도", min: 0, max: 2, step: 0.05, value: 0.5 });
    GFX.checkbox(ctl, "텍스처 켜기", true, (v) => { textured = v; });

    GFX.orbitControl(S.canvas, orbit);
    S.canvas.addEventListener("mousedown", () => { dragging = true; });
    window.addEventListener("mouseup", () => { dragging = false; });

    let auto = 0;
    function draw(dt) {
      if (!dragging) auto += dt * sSpeed.get();
      const w = S.w, h = S.h, ctx = S.ctx;
      GFX.clear(ctx, w, h);

      const model = M4.mul(M4.mul(M4.rotY(auto + orbit.ry), M4.rotX(orbit.rx)), M4.rotZ(auto * 0.3));
      const view = M4.lookAt([0, 0, 4.5], [0, 0, 0], [0, 1, 0]);
      const proj = M4.perspective(rad(50), w / h, 0.1, 100);
      const mv = M4.mul(view, model);
      const mvp = M4.mul(proj, mv);

      const scr = CUBE_V.map((p) => project(mvp, p, w, h));
      // 면 정렬 (painter)
      const faces = [];
      CUBE_F.forEach((f, fi) => {
        const sp = f.idx.map((i) => scr[i]);
        if (sp.some((p) => !p.vis)) return;
        if (signedArea(sp) <= 0) return;
        let az = 0;
        f.idx.forEach((i) => { az += M4.apply(mv, CUBE_V[i]).z; });
        az /= 4;
        faces.push({ sp, az, fi, col: f.col });
      });
      faces.sort((a, b) => a.az - b.az);
      faces.forEach((f) => {
        if (textured) {
          drawTexQuad(ctx, texs[f.fi], f.sp);
        } else {
          fillPoly(ctx, f.sp, f.col, "rgba(0,0,0,0.4)");
        }
      });
    }

    // 정사각 텍스처를 투영된 사각형에 매핑. 두 삼각형으로 affine.
    // sp 순서: 면 정점 [0,1,2,3] -> UV (0,0)(1,0)(1,1)(0,1)
    function drawTexQuad(ctx, tex, sp) {
      // 삼각형 1: 정점 0,1,2 / 삼각형 2: 정점 0,2,3
      drawTexTri(ctx, tex, sp[0], sp[1], sp[2], [0,0],[1,0],[1,1]);
      drawTexTri(ctx, tex, sp[0], sp[2], sp[3], [0,0],[1,1],[0,1]);
    }
    // affine 텍스처 삼각형: setTransform 으로 텍스처공간->화면 매핑, 클립 후 drawImage.
    function drawTexTri(ctx, tex, s0, s1, s2, t0, t1, t2) {
      const TW = tex.width, TH = tex.height;
      const u0 = t0[0]*TW, v0 = t0[1]*TH;
      const u1 = t1[0]*TW, v1 = t1[1]*TH;
      const u2 = t2[0]*TW, v2 = t2[1]*TH;
      // 텍스처(u,v)->화면(x,y) affine 계수 풀기
      const den = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
      if (Math.abs(den) < 1e-6) return;
      const a = ((s1.x - s0.x) * (v2 - v0) - (s2.x - s0.x) * (v1 - v0)) / den;
      const b = ((s1.y - s0.y) * (v2 - v0) - (s2.y - s0.y) * (v1 - v0)) / den;
      const c = ((s2.x - s0.x) * (u1 - u0) - (s1.x - s0.x) * (u2 - u0)) / den;
      const d = ((s2.y - s0.y) * (u1 - u0) - (s1.y - s0.y) * (u2 - u0)) / den;
      const e = s0.x - a * u0 - c * v0;
      const f = s0.y - b * u0 - d * v0;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(s0.x, s0.y); ctx.lineTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y); ctx.closePath();
      ctx.clip();
      ctx.setTransform(ctx.getTransform().multiply(new DOMMatrix([a, b, c, d, e, f])));
      ctx.drawImage(tex, 0, 0);
      ctx.restore();
    }
    GFX.loop(draw);
  }

  // ============================================================
  // 초기화
  // ============================================================
  document.addEventListener("DOMContentLoaded", function () {
    const inits = [
      ["MVP", initMVP], ["Camera", initCamera], ["Mesh", initMesh],
      ["ZBuffer", initZBuffer], ["Light", initLight], ["TexCube", initTexCube],
    ];
    inits.forEach(([name, fn]) => {
      try { fn(); } catch (e) { console.error("[demos-3d] " + name + " 초기화 실패:", e); }
    });
  });
})();
