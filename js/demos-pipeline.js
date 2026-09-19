/* ============================================================
   demos-pipeline.js — 캡스톤: 렌더 파이프라인 (DCC 스타일)
   한 프레임이 만들어지는 과정을 "생략 없이" 마이크로 단계로 분해해
   화려한 타임라인 바로 스크럽한다. 각 이벤트는 실제 렌더 상태를
   반영한다(라이트 배치→방향→뷰/투영→프랍별 깊이 캡처→G-buffer
   프랍별 래스터→라이팅 항목별 누적→블룸→톤맵).
   실제 WebGL1 다중 패스(FBO) 지연 셰이딩. 실패 시 Canvas2D 폴백.
   ============================================================ */
(function () {
  "use strict";
  const G = window.GFX;
  const M4 = G.M4, rad = G.rad, clamp = G.clamp;

  // 씬 프랍 이름(이벤트 라벨과 depth/래스터 순서에 사용)
  const OBJNAMES = ["바닥면", "빨강 구", "파랑 구", "금색 큐브", "초록 구"];

  // 그룹(패스) 메타 — 타임라인 색/이름
  const GROUPS = [
    { name: "Clear",    col: [100, 210, 255] },
    { name: "Shadow",   col: [255, 209, 102] },
    { name: "G-Buffer", col: [126, 231, 135] },
    { name: "Lighting", col: [255, 143, 110] },
    { name: "Bloom",    col: [199, 146, 234] },
    { name: "Tonemap",  col: [86, 212, 221] },
  ];

  // 마이크로 이벤트 타임라인
  function buildEvents() {
    const E = [];
    const p = (g, key, label, desc, extra) => E.push(Object.assign({ g, key, label, desc }, extra || {}));
    // 0. Clear / Frame setup
    p(0, "bindbb", "백버퍼 바인딩", "렌더 타겟(RTV)과 깊이·스텐실(DSV)을 출력 병합 단계에 묶는다.");
    p(0, "viewport", "뷰포트 설정", "NDC를 화면 픽셀로 매핑할 뷰포트(가로·세로·깊이 범위)를 지정.");
    p(0, "clearcol", "컬러 버퍼 클리어", "이전 프레임의 색을 지워 빈 캔버스에서 시작.");
    p(0, "cleardepth", "깊이 버퍼 클리어", "깊이를 1.0(가장 먼 값)으로 초기화.");
    // 1. Shadow pass
    p(1, "placelight", "라이트 배치", "씬에 점광원을 놓는다. 이 위치가 그림자의 출발점.");
    p(1, "aimlight", "빛 방향 설정", "광원이 씬 중심을 향하도록 조준 방향을 맞춘다.");
    p(1, "lightview", "라이트 뷰 행렬", "광원을 카메라로 삼는 view 행렬(lookAt)을 만든다.");
    p(1, "lightproj", "라이트 투영 행렬", "시야각·근/원평면으로 투영 행렬 구성 → 그림자 frustum 확정.");
    p(1, "bindshadow", "섀도우맵 바인딩", "깊이 렌더 타겟(shadowTex)과 라이트 뷰포트로 전환.");
    p(1, "clearshadow", "섀도우 깊이 클리어", "섀도우맵을 가장 먼 값으로 초기화(흰색=멀다).");
    for (let k = 1; k <= OBJNAMES.length; k++)
      p(1, "shadowdepth", "깊이 캡처 · " + OBJNAMES[k - 1], OBJNAMES[k - 1] + "을(를) 광원 시점에서 렌더해 광원까지의 거리(깊이)를 기록. 가까울수록 어둡게.", { k: k });
    p(1, "shadowdone", "섀도우맵 완성", "모든 프랍의 광원-거리 기록 완료. 라이팅에서 그림자 판정에 쓰인다.");
    // 2. G-buffer (geometry)
    p(2, "bindgbuf", "G-buffer MRT 바인딩", "Albedo·Normal·Position 3장을 다중 렌더 타겟으로 묶는다.");
    p(2, "cleargbuf", "G-buffer 클리어", "세 채널을 초기화(배경/스카이 표시).");
    for (let k = 1; k <= OBJNAMES.length; k++)
      p(2, "gbufdraw", "지오메트리 래스터 · " + OBJNAMES[k - 1], OBJNAMES[k - 1] + "을(를) 그려 픽셀마다 재질색·법선·월드좌표를 한 번에 기록(MRT).", { k: k });
    p(2, "viewalbedo", "채널 보기 · Albedo", "재질 고유색만 담긴 채널(조명 없음).");
    p(2, "viewnormal", "채널 보기 · Normal", "표면 법선(월드 방향)을 색으로 인코딩한 채널.");
    p(2, "viewposition", "채널 보기 · Position", "픽셀의 월드 좌표를 인코딩한 채널.");
    // 3. Deferred lighting
    p(3, "bindlit", "HDR 라이트 타겟 바인딩", "조명 결과를 담을 부동소수 HDR 타겟 + 풀스크린 패스 준비.");
    p(3, "samplegbuf", "G-buffer 샘플", "픽셀마다 albedo·normal·position을 읽어온다.");
    p(3, "ambient", "앰비언트 항", "환경광으로 전체를 은은하게 채운다(가장 어두운 바닥값).");
    p(3, "diffuse", "디퓨즈 N·L", "법선과 빛 방향의 각도(N·L)로 확산 반사를 더한다.");
    p(3, "shadowtest", "섀도우 판정", "픽셀을 라이트 공간으로 투영해 섀도우맵 깊이와 비교, 가려지면 어둡게.");
    p(3, "specular", "스페큘러 하이라이트", "시선·반사각(N·H)으로 반짝이는 하이라이트를 더한다.");
    p(3, "litdone", "라이팅 완료(HDR)", "조명이 모두 반영된 HDR 이미지. 1.0을 넘는 밝은 값 존재.");
    // 4. Bloom
    p(4, "bright", "밝은 영역 추출", "임계값 이상만 남긴다(블룸 씨앗).");
    p(4, "blurh", "수평 블러", "분리형 가우시안 가로 패스.");
    p(4, "blurv", "수직 블러", "세로 패스로 2D 블러 완성.");
    p(4, "bloomadd", "블룸 합성", "블러된 광채를 라이팅 결과에 더한다.");
    // 5. Tonemap / present
    p(5, "hdrin", "HDR 입력", "넓은 밝기 범위의 색(블룸 포함). 그대로면 밝은 곳이 뭉갠다.");
    p(5, "aces", "ACES 톤맵", "필름 곡선으로 밝은 값을 눌러 0~1로 매핑.");
    p(5, "gamma", "감마 보정", "sRGB 감마(≈2.2)로 디스플레이에 맞춘다.");
    p(5, "present", "화면 출력", "백버퍼를 스왑체인으로 제시(Present). 프레임 완성.");
    return E;
  }
  const EVENTS = buildEvents();
  const E = EVENTS.length;
  const GCOUNT = GROUPS.map((_, gi) => EVENTS.filter((e) => e.g === gi).length);
  const GSTART = (function () { const a = []; let s = 0; for (const c of GCOUNT) { a.push(s); s += c; } return a; })();
  function activeEv(t) { return Math.min(E - 1, Math.max(0, Math.floor(t))); }
  const rgba = (c, a) => "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";

  function initPipeline() {
    const canvas = document.getElementById("c-pipeline");
    if (!canvas) return;
    const ctl = document.getElementById("ctl-pipeline");
    const readout = document.getElementById("r-pipeline");
    let gl = null;
    try {
      const o = { antialias: true, alpha: false, depth: true, preserveDrawingBuffer: false };
      gl = canvas.getContext("webgl", o) || canvas.getContext("experimental-webgl", o);
    } catch (e) { gl = null; }
    if (!gl) { initFallback(canvas, ctl, readout); return; }
    try { initGL(canvas, gl, ctl, readout); }
    catch (e) { console.error("[demo] pipeline WebGL 실패, 폴백:", e); try { initFallback(canvas, ctl, readout); } catch (e2) { console.error(e2); } }
  }

  // ============================================================
  //  화려한 DCC 타임라인 (2D 캔버스) — GL/폴백 공통
  // ============================================================
  function createTimeline(ctl, state) {
    const wrap = document.createElement("div");
    wrap.className = "pipe-tl-wrap";
    const cv = document.createElement("canvas");
    cv.className = "pipe-tl";
    wrap.appendChild(cv);
    if (ctl) ctl.appendChild(wrap);
    const ctx = cv.getContext("2d");
    const H = 132;
    let dpr = 1, W = 700;
    function size() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = wrap.clientWidth || (cv.parentElement && cv.parentElement.clientWidth) || 700;
      cv.style.width = "100%"; cv.style.height = H + "px";
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    size(); window.addEventListener("resize", size);

    const btnW = 46;
    function track() { const L = btnW + 18, R = W - 16; return { L: L, R: R, w: Math.max(10, R - L) }; }
    function xToT(clientX) { const r = cv.getBoundingClientRect(); const x = (clientX - r.left); const g = track(); return clamp((x - g.L) / g.w, 0, 1) * E; }
    function inBtn(clientX, clientY) { const r = cv.getBoundingClientRect(); const x = clientX - r.left, y = clientY - r.top; return x >= 10 && x <= 10 + btnW && y >= H / 2 - 24 && y <= H / 2 + 24; }
    let scrub = false;
    cv.addEventListener("mousedown", function (e) { if (inBtn(e.clientX, e.clientY)) { state.playing = !state.playing; return; } scrub = true; state.playing = false; state.t = xToT(e.clientX); });
    window.addEventListener("mousemove", function (e) { if (scrub) state.t = xToT(e.clientX); });
    window.addEventListener("mouseup", function () { scrub = false; });
    cv.addEventListener("touchstart", function (e) { const t = e.touches[0]; if (inBtn(t.clientX, t.clientY)) { state.playing = !state.playing; return; } scrub = true; state.playing = false; state.t = xToT(t.clientX); }, { passive: true });
    cv.addEventListener("touchmove", function (e) { if (scrub) { e.preventDefault(); state.t = xToT(e.touches[0].clientX); } }, { passive: false });
    window.addEventListener("touchend", function () { scrub = false; });

    function rr(x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function draw() {
      const g = track();
      const t = clamp(state.t, 0, E);
      const idx = activeEv(t);
      const curG = EVENTS[idx].g;
      // 배경
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#12141d"); bg.addColorStop(1, "#080910");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

      // 재생 버튼
      const bx = 10, by = H / 2 - 24, bh = 48;
      const bgrad = ctx.createLinearGradient(bx, by, bx, by + bh);
      bgrad.addColorStop(0, "#2a2e3e"); bgrad.addColorStop(1, "#171a26");
      ctx.fillStyle = bgrad; rr(bx, by, btnW, bh, 10); ctx.fill();
      ctx.strokeStyle = "rgba(126,168,254,0.35)"; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = "#eaf0ff";
      const cxp = bx + btnW / 2, cyp = by + bh / 2;
      if (state.playing) { ctx.fillRect(cxp - 7, cyp - 8, 5, 16); ctx.fillRect(cxp + 2, cyp - 8, 5, 16); }
      else { ctx.beginPath(); ctx.moveTo(cxp - 6, cyp - 9); ctx.lineTo(cxp - 6, cyp + 9); ctx.lineTo(cxp + 9, cyp); ctx.closePath(); ctx.fill(); }

      // 눈금(상단 러ler)
      const barY = 40, barH = 50;
      ctx.fillStyle = "rgba(200,210,230,0.35)";
      ctx.font = "10px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("FRAME TIMELINE", g.L, 22);
      ctx.textAlign = "right";
      ctx.fillText((idx + 1) + " / " + E + " events", g.R, 22);
      ctx.textAlign = "left";

      // 그룹 세그먼트
      GROUPS.forEach(function (grp, gi) {
        const x = g.L + (GSTART[gi] / E) * g.w;
        const w = (GCOUNT[gi] / E) * g.w;
        const active = gi === curG;
        const done = gi < curG;
        const grad = ctx.createLinearGradient(x, barY, x, barY + barH);
        grad.addColorStop(0, rgba(grp.col, active ? 0.95 : (done ? 0.55 : 0.32)));
        grad.addColorStop(1, rgba([grp.col[0] * 0.45 | 0, grp.col[1] * 0.45 | 0, grp.col[2] * 0.45 | 0], active ? 0.95 : (done ? 0.6 : 0.4)));
        if (active) { ctx.save(); ctx.shadowColor = rgba(grp.col, 0.8); ctx.shadowBlur = 16; }
        ctx.fillStyle = grad; rr(x + 1, barY, w - 2, barH, 8); ctx.fill();
        if (active) ctx.restore();
        // 이벤트 구분선 + 활성 셀
        for (let j = 0; j < GCOUNT[gi]; j++) {
          const evX = x + (j / GCOUNT[gi]) * w;
          const evW = w / GCOUNT[gi];
          if (GSTART[gi] + j === idx) {
            ctx.fillStyle = "rgba(255,255,255,0.28)";
            rr(evX + 0.5, barY + 1, evW - 1, barH - 2, 5); ctx.fill();
            ctx.fillStyle = rgba(grp.col, 1);
            ctx.fillRect(evX + 1, barY, evW - 2, 3);
          }
          if (j > 0) { ctx.strokeStyle = "rgba(0,0,0,0.28)"; ctx.beginPath(); ctx.moveTo(evX, barY + 4); ctx.lineTo(evX, barY + barH - 4); ctx.stroke(); }
        }
        // 그룹 라벨
        ctx.fillStyle = active ? "#0b0d13" : "rgba(240,244,255,0.9)";
        ctx.font = (active ? "700 " : "600 ") + "12px system-ui, sans-serif";
        const tw = ctx.measureText(grp.name).width;
        if (w > tw + 10) { ctx.textAlign = "center"; ctx.fillText(grp.name, x + w / 2, barY + barH / 2 + 4); ctx.textAlign = "left"; }
      });

      // 재생헤드
      const px = g.L + (t / E) * g.w;
      const pg = ctx.createLinearGradient(0, barY - 10, 0, barY + barH + 10);
      pg.addColorStop(0, "rgba(255,255,255,0.95)"); pg.addColorStop(1, "rgba(126,168,254,0.6)");
      ctx.save();
      ctx.shadowColor = "rgba(126,168,254,0.9)"; ctx.shadowBlur = 12;
      ctx.strokeStyle = pg; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, barY - 10); ctx.lineTo(px, barY + barH + 10); ctx.stroke();
      ctx.restore();
      // 핸들(다이아몬드)
      ctx.fillStyle = "#eaf0ff";
      ctx.beginPath();
      ctx.moveTo(px, barY - 16); ctx.lineTo(px + 7, barY - 8); ctx.lineTo(px, barY); ctx.lineTo(px - 7, barY - 8);
      ctx.closePath(); ctx.fill();

      // 현재 이벤트 라벨
      const ev = EVENTS[idx];
      ctx.textAlign = "center";
      ctx.fillStyle = rgba(GROUPS[curG].col, 1);
      ctx.font = "700 13px system-ui, sans-serif";
      ctx.fillText(GROUPS[curG].name.toUpperCase() + "  ▸  " + ev.label, W / 2, H - 14);
      ctx.textAlign = "left";
    }
    return { draw: draw };
  }

  function updateReadout(readout, idx) {
    if (!readout) return;
    const ev = EVENTS[idx];
    const grp = GROUPS[ev.g];
    // 그룹 내 순번
    const inGroup = idx - GSTART[ev.g] + 1;
    readout.innerHTML =
      '<span class="pipe-badge" style="background:' + rgba(grp.col, 1) + '">' + grp.name + " " + inGroup + "/" + GCOUNT[ev.g] + "</span> " +
      '<b style="color:var(--text)">' + ev.label + "</b><br>" +
      '<span style="color:var(--text-dim)">' + ev.desc + "</span>";
  }

  // ============================================================
  //  WebGL 경로
  // ============================================================
  function initGL(canvas, gl, ctl, readout) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const baseH = parseInt(canvas.getAttribute("height")) || 480;
    const STRIP = 96;

    // 텍스트/HUD 오버레이
    const overlay = document.createElement("canvas");
    overlay.className = "pipe-overlay";
    const parent = canvas.parentElement;
    if (parent && getComputedStyle(parent).position === "static") parent.style.position = "relative";
    if (canvas.nextSibling) parent.insertBefore(overlay, canvas.nextSibling); else parent.appendChild(overlay);
    const octx = overlay.getContext("2d");

    function sizeCanvas() {
      const cssW = canvas.clientWidth || (parent && parent.clientWidth) || 800;
      const cssH = baseH;
      canvas.style.height = cssH + "px";
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas._cssW = cssW; canvas._cssH = cssH;
      overlay.style.position = "absolute";
      overlay.style.left = canvas.offsetLeft + "px";
      overlay.style.top = canvas.offsetTop + "px";
      overlay.style.width = cssW + "px"; overlay.style.height = cssH + "px";
      overlay.style.pointerEvents = "none";
      overlay.width = Math.round(cssW * dpr); overlay.height = Math.round(cssH * dpr);
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    sizeCanvas();
    window.addEventListener("resize", sizeCanvas);

    // GL 헬퍼
    function compile(type, src) {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("shader:" + gl.getShaderInfoLog(s));
      return s;
    }
    function program(v, f) {
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, v));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, f));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("link:" + gl.getProgramInfoLog(p));
      return p;
    }
    function target(w, h, withDepth, filter) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const f = filter || gl.LINEAR;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      let depth = null;
      if (withDepth) {
        depth = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      }
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); throw new Error("fbo incomplete");
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { fb: fb, tex: tex, w: w, h: h };
    }

    // 지오메트리
    function buildMesh(pos, nrm, idx) {
      const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
      const nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(nrm), gl.STATIC_DRAW);
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
      return { pb: pb, nb: nb, ib: ib, count: idx.length };
    }
    function makeSphere(seg) {
      const pos = [], nrm = [], idx = [];
      for (let y = 0; y <= seg; y++) { const phi = y / seg * Math.PI; for (let x = 0; x <= seg; x++) { const th = x / seg * Math.PI * 2; const nx = Math.sin(phi) * Math.cos(th), ny = Math.cos(phi), nz = Math.sin(phi) * Math.sin(th); pos.push(nx, ny, nz); nrm.push(nx, ny, nz); } }
      for (let y = 0; y < seg; y++) for (let x = 0; x < seg; x++) { const a = y * (seg + 1) + x, b = a + seg + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
      return buildMesh(pos, nrm, idx);
    }
    function makeCube() {
      const p = [], n = [], idx = [];
      const faces = [[[1,0,0],[0,0,-1],[0,1,0]],[[-1,0,0],[0,0,1],[0,1,0]],[[0,1,0],[1,0,0],[0,0,1]],[[0,-1,0],[1,0,0],[0,0,-1]],[[0,0,1],[1,0,0],[0,1,0]],[[0,0,-1],[-1,0,0],[0,1,0]]];
      faces.forEach(function (f) { const nrm = f[0], ax = f[1], ay = f[2], base = p.length / 3; for (let j = 0; j < 4; j++) { const sx = (j === 1 || j === 2) ? 1 : -1, sy = (j >= 2) ? 1 : -1; p.push(nrm[0]+ax[0]*sx+ay[0]*sy, nrm[1]+ax[1]*sx+ay[1]*sy, nrm[2]+ax[2]*sx+ay[2]*sy); n.push(nrm[0], nrm[1], nrm[2]); } idx.push(base, base+1, base+2, base, base+2, base+3); });
      return buildMesh(p, n, idx);
    }
    function makePlane() { const s = 6; return buildMesh([-s,0,-s, s,0,-s, s,0,s, -s,0,s], [0,1,0,0,1,0,0,1,0,0,1,0], [0,1,2,0,2,3]); }

    const sphere = makeSphere(28), cube = makeCube(), plane = makePlane();
    const objs = [
      { mesh: plane,  model: M4.translate(0, -1.0, 0), albedo: [0.38, 0.40, 0.46] },
      { mesh: sphere, model: M4.mul(M4.translate(-1.7, -0.3, 0.2), M4.scale(0.7,0.7,0.7)), albedo: [0.92, 0.28, 0.30] },
      { mesh: sphere, model: M4.mul(M4.translate(1.6, -0.35, -0.6), M4.scale(0.65,0.65,0.65)), albedo: [0.25, 0.55, 0.95] },
      { mesh: cube,   model: M4.mul(M4.translate(0.1, -0.35, 0.9), M4.scale(0.6,0.6,0.6)), albedo: [0.95, 0.78, 0.28] },
      { mesh: sphere, model: M4.mul(M4.translate(0.2, 0.55, -0.2), M4.scale(0.5,0.5,0.5)), albedo: [0.55, 0.90, 0.55] },
    ];

    // 셰이더
    const V_SCENE = "attribute vec3 aPos; attribute vec3 aNormal; uniform mat4 uModel,uView,uProj; varying vec3 vWorld; varying vec3 vNormal; void main(){ vec4 wp=uModel*vec4(aPos,1.0); vWorld=wp.xyz; vNormal=mat3(uModel)*aNormal; gl_Position=uProj*uView*wp; }";
    const V_QUAD = "attribute vec2 aPos; varying vec2 vUv; void main(){ vUv=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }";
    const PS = 8.0, LFAR = 22.0;

    const progShadow = program(V_SCENE, "precision highp float; varying vec3 vWorld; uniform vec3 uLightPos; void main(){ float d=length(vWorld-uLightPos)/" + LFAR.toFixed(1) + "; gl_FragColor=vec4(vec3(d),1.0); }");
    const progAlbedo = program(V_SCENE, "precision highp float; uniform vec3 uAlbedo; void main(){ gl_FragColor=vec4(uAlbedo,1.0); }");
    const progNormal = program(V_SCENE, "precision highp float; varying vec3 vNormal; void main(){ gl_FragColor=vec4(normalize(vNormal)*0.5+0.5,1.0); }");
    const progPosition = program(V_SCENE, "precision highp float; varying vec3 vWorld; void main(){ gl_FragColor=vec4(vWorld/" + PS.toFixed(1) + "*0.5+0.5,1.0); }");

    const progLight = program(V_QUAD,
      "precision highp float; varying vec2 vUv;" +
      "uniform sampler2D uAlbedo,uNormal,uPosition,uShadow;" +
      "uniform vec3 uLightPos,uLightColor,uCamPos; uniform mat4 uLightVP;" +
      "uniform float uAmbient,uDiffuse,uSpec,uUseShadow;" +
      "vec3 sky(vec2 uv){ return mix(vec3(0.09,0.11,0.17),vec3(0.16,0.22,0.36),uv.y); }" +
      "void main(){ vec4 a=texture2D(uAlbedo,vUv); if(a.a<0.5){ gl_FragColor=vec4(sky(vUv),1.0); return; }" +
      " vec3 alb=a.rgb; vec3 N=normalize(texture2D(uNormal,vUv).rgb*2.0-1.0);" +
      " vec3 wp=(texture2D(uPosition,vUv).rgb*2.0-1.0)*" + PS.toFixed(1) + ";" +
      " vec3 Ld=normalize(uLightPos-wp); float ndl=max(dot(N,Ld),0.0);" +
      " float sh=1.0;" +
      " if(uUseShadow>0.5){ vec4 lc=uLightVP*vec4(wp,1.0); vec3 ndc=lc.xyz/lc.w; vec2 s=ndc.xy*0.5+0.5;" +
      "   if(s.x>0.0&&s.x<1.0&&s.y>0.0&&s.y<1.0){ float st=texture2D(uShadow,s).r*" + LFAR.toFixed(1) + "; float cur=length(wp-uLightPos); sh=cur>st+0.18?0.0:1.0; } }" +
      " vec3 Vv=normalize(uCamPos-wp); vec3 Hh=normalize(Ld+Vv); float spec=pow(max(dot(N,Hh),0.0),56.0);" +
      " vec3 col=alb*uAmbient;" +
      " if(uDiffuse>0.5) col+=sh*alb*uLightColor*ndl;" +
      " if(uSpec>0.5) col+=sh*uLightColor*spec*0.55;" +
      " gl_FragColor=vec4(col,1.0); }");

    const progBright = program(V_QUAD, "precision highp float; varying vec2 vUv; uniform sampler2D uTex; uniform float uThr; void main(){ vec3 c=texture2D(uTex,vUv).rgb; float l=dot(c,vec3(0.2126,0.7152,0.0722)); gl_FragColor=vec4(l>uThr?c:vec3(0.0),1.0); }");
    const progBlur = program(V_QUAD, "precision highp float; varying vec2 vUv; uniform sampler2D uTex; uniform vec2 uDir; void main(){ vec3 s=texture2D(uTex,vUv).rgb*0.227; s+=texture2D(uTex,vUv+uDir).rgb*0.194+texture2D(uTex,vUv-uDir).rgb*0.194; s+=texture2D(uTex,vUv+uDir*2.0).rgb*0.121+texture2D(uTex,vUv-uDir*2.0).rgb*0.121; s+=texture2D(uTex,vUv+uDir*3.0).rgb*0.054+texture2D(uTex,vUv-uDir*3.0).rgb*0.054; gl_FragColor=vec4(s,1.0); }");
    const progPresent = program(V_QUAD,
      "precision highp float; varying vec2 vUv; uniform sampler2D uA,uB,uBloom; uniform float uMode,uBloomAmt,uFade;" +
      "vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0); }" +
      "void main(){ vec3 o;" +
      " if(uMode<0.5){ o=texture2D(uA,vUv).rgb*uFade; }" +
      " else { vec3 c=texture2D(uB,vUv).rgb+texture2D(uBloom,vUv).rgb*uBloomAmt;" +
      "   if(uMode<1.5) o=c; else if(uMode<2.5) o=aces(c); else o=pow(aces(c),vec3(1.0/2.2)); }" +
      " gl_FragColor=vec4(o,1.0); }");

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);

    const RW = 640, RH = 360, SW = 512, BW = 320, BH = 180;
    const shadowT = target(SW, SW, true, gl.LINEAR);
    const gAlb = target(RW, RH, true), gNrm = target(RW, RH, true), gPos = target(RW, RH, true);
    const litT = target(RW, RH, false);
    const brightT = target(BW, BH, false), blurA = target(BW, BH, false), blurB = target(BW, BH, false);

    function locs(prog) { return { pl: gl.getAttribLocation(prog, "aPos"), nl: gl.getAttribLocation(prog, "aNormal") }; }
    function drawMesh(l, mesh) {
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.pb); gl.enableVertexAttribArray(l.pl); gl.vertexAttribPointer(l.pl, 3, gl.FLOAT, false, 0, 0);
      if (l.nl >= 0) { gl.bindBuffer(gl.ARRAY_BUFFER, mesh.nb); gl.enableVertexAttribArray(l.nl); gl.vertexAttribPointer(l.nl, 3, gl.FLOAT, false, 0, 0); }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ib); gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
    }
    function scenePass(prog, tgt, view, proj, perObj, clear, count) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, tgt.fb); gl.viewport(0, 0, tgt.w, tgt.h);
      gl.clearColor(clear[0], clear[1], clear[2], clear[3]); gl.enable(gl.DEPTH_TEST);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(prog); const l = locs(prog);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, "uView"), false, view);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, "uProj"), false, proj);
      const uModel = gl.getUniformLocation(prog, "uModel");
      const n = count == null ? objs.length : count;
      for (let i = 0; i < n; i++) { gl.uniformMatrix4fv(uModel, false, objs[i].model); if (perObj) perObj(prog, objs[i]); drawMesh(l, objs[i].mesh); }
    }
    function fsPass(prog, tgt, set) {
      if (tgt) { gl.bindFramebuffer(gl.FRAMEBUFFER, tgt.fb); gl.viewport(0, 0, tgt.w, tgt.h); }
      gl.useProgram(prog); gl.disable(gl.DEPTH_TEST);
      const pl = gl.getAttribLocation(prog, "aPos"); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(pl); gl.vertexAttribPointer(pl, 2, gl.FLOAT, false, 0, 0);
      if (set) set(prog); gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    function bindTex(prog, name, tex, unit) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(gl.getUniformLocation(prog, name), unit); }
    function setF(prog, name, v) { gl.uniform1f(gl.getUniformLocation(prog, name), v); }

    const state = { t: 0, playing: true, orbit: { rx: 0.32, ry: 0.6 }, dragging: false };
    G.orbitControl(canvas, state.orbit);
    canvas.addEventListener("mousedown", function () { state.dragging = true; });
    window.addEventListener("mouseup", function () { state.dragging = false; });
    const timeline = createTimeline(ctl, state);

    let auto = 0;
    const sky = [0.10, 0.13, 0.20];
    const groundCorners = [[-6,-1,-6],[6,-1,-6],[6,-1,6],[-6,-1,6]];
    let curRes = "", curGizmo = null, curVP = null, curEye = null, lightPosCache = [0, 5, 0];

    function render(dt) {
      if (state.playing) { state.t += dt * 3.2; if (state.t >= E + 0.8) state.t = 0; }
      if (!state.dragging) auto += dt * 0.22;
      const idx = activeEv(state.t);
      const ev = EVENTS[idx];
      const frac = clamp(state.t - idx, 0, 1);

      // 카메라
      const aspect = RW / RH;
      const camModel = M4.mul(M4.rotX(state.orbit.rx), M4.rotY(state.orbit.ry + auto));
      const invRot = [camModel[0],camModel[4],camModel[8],0, camModel[1],camModel[5],camModel[9],0, camModel[2],camModel[6],camModel[10],0, 0,0,0,1];
      const er = M4.apply(invRot, [0, 0.7, 6.4]); const eye = [er.x, er.y, er.z];
      const vmat = M4.lookAt(eye, [0, -0.1, 0], [0, 1, 0]);
      const proj = M4.perspective(rad(45), aspect, 0.1, 100);
      curVP = M4.mul(proj, vmat); curEye = eye;

      // 조명
      const la = auto * 0.55 + 0.8;
      const lightPos = [Math.cos(la) * 4.6, 5.0, Math.sin(la) * 4.6];
      lightPosCache = lightPos;
      const lightColor = [1.3, 1.18, 0.98];
      const lightView = M4.lookAt(lightPos, [0, -0.3, 0], [0, 1, 0]);
      const lightProj = M4.perspective(rad(70), 1, 0.5, LFAR);
      const lightVP = M4.mul(lightProj, lightView);

      // 프랍별 진행 카운트
      const shadowK = ev.key === "shadowdepth" ? ev.k : (ev.g === 1 && (ev.key === "bindshadow" || ev.key === "clearshadow") ? 0 : (ev.g < 1 ? objs.length : objs.length));
      const gbufK = ev.key === "gbufdraw" ? ev.k : (ev.g === 2 && (ev.key === "bindgbuf" || ev.key === "cleargbuf") ? 0 : objs.length);
      // 라이팅 항목 플래그
      let d = 1, s = 1, sh = 1;
      if (ev.g === 3) {
        if (ev.key === "ambient") { d = 0; s = 0; sh = 0; }
        else if (ev.key === "diffuse") { d = 1; s = 0; sh = 0; }
        else if (ev.key === "shadowtest") { d = 1; s = 0; sh = 1; }
        else { d = 1; s = 1; sh = 1; }
      }

      // ---- 패스 렌더(FBO) ----
      scenePass(progShadow, shadowT, lightView, lightProj, function (p) { gl.uniform3fv(gl.getUniformLocation(p, "uLightPos"), lightPos); }, [1,1,1,1], shadowK);
      scenePass(progAlbedo, gAlb, vmat, proj, function (p, o) { gl.uniform3fv(gl.getUniformLocation(p, "uAlbedo"), o.albedo); }, [sky[0], sky[1], sky[2], 0], gbufK);
      scenePass(progNormal, gNrm, vmat, proj, null, [0.5,0.5,1,0], null);
      scenePass(progPosition, gPos, vmat, proj, null, [0.5,0.5,0.5,0], null);
      fsPass(progLight, litT, function (p) {
        bindTex(p, "uAlbedo", gAlb.tex, 0); bindTex(p, "uNormal", gNrm.tex, 1); bindTex(p, "uPosition", gPos.tex, 2); bindTex(p, "uShadow", shadowT.tex, 3);
        gl.uniform3fv(gl.getUniformLocation(p, "uLightPos"), lightPos);
        gl.uniform3fv(gl.getUniformLocation(p, "uLightColor"), lightColor);
        gl.uniform3fv(gl.getUniformLocation(p, "uCamPos"), eye);
        gl.uniformMatrix4fv(gl.getUniformLocation(p, "uLightVP"), false, lightVP);
        setF(p, "uAmbient", 0.22); setF(p, "uDiffuse", d); setF(p, "uSpec", s); setF(p, "uUseShadow", sh);
      });
      fsPass(progBright, brightT, function (p) { bindTex(p, "uTex", litT.tex, 0); setF(p, "uThr", 0.72); });
      fsPass(progBlur, blurA, function (p) { bindTex(p, "uTex", brightT.tex, 0); gl.uniform2f(gl.getUniformLocation(p, "uDir"), 1 / BW, 0); });
      fsPass(progBlur, blurB, function (p) { bindTex(p, "uTex", blurA.tex, 0); gl.uniform2f(gl.getUniformLocation(p, "uDir"), 0, 1 / BH); });

      // ---- 메인 뷰포트 ----
      const cssW = canvas._cssW, cssH = canvas._cssH, mainH = cssH - STRIP;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.enable(gl.SCISSOR_TEST);
      const mvw = Math.round(cssW * dpr), mvh = Math.round(mainH * dpr), mvy = Math.round(STRIP * dpr);
      gl.viewport(0, mvy, mvw, mvh); gl.scissor(0, mvy, mvw, mvh);
      gl.clearColor(0.02, 0.02, 0.03, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      presentMain(ev, frac);

      // ---- 썸네일 스트립 ----
      gl.scissor(0, 0, mvw, mvy); gl.clearColor(0.04, 0.04, 0.055, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      const thumbs = [
        { tex: shadowT.tex, g: 1, label: "shadowTex" }, { tex: gAlb.tex, g: 2, label: "Albedo" },
        { tex: gNrm.tex, g: 2, label: "Normal" }, { tex: gPos.tex, g: 2, label: "Position" },
        { tex: litT.tex, g: 3, label: "litTex" }, { tex: blurB.tex, g: 4, label: "Bloom" },
      ];
      const pad = 10, gap = 8, labelH = 20;
      const tw = (cssW - pad * 2 - gap * (thumbs.length - 1)) / thumbs.length, th = STRIP - labelH - pad;
      const rects = [];
      thumbs.forEach(function (t, i) {
        const x = pad + i * (tw + gap), y = pad;
        const glx = Math.round(x * dpr), gly = Math.round((STRIP - y - th) * dpr);
        gl.viewport(glx, gly, Math.round(tw * dpr), Math.round(th * dpr));
        gl.scissor(glx, gly, Math.round(tw * dpr), Math.round(th * dpr));
        fsPass(progPresent, null, function (p) { setF(p, "uMode", 0); setF(p, "uFade", 1); bindTex(p, "uA", t.tex, 0); });
        rects.push({ x: x, y: cssH - STRIP + y, w: tw, h: th, g: t.g, label: t.label });
      });
      gl.disable(gl.SCISSOR_TEST);

      drawOverlay(ev, rects, cssW, cssH, mainH);
      timeline.draw();
      updateReadout(readout, idx);
    }

    function presentMain(ev, frac) {
      const raw = function (tex) { fsPass(progPresent, null, function (p) { setF(p, "uMode", 0); setF(p, "uFade", 1); bindTex(p, "uA", tex, 0); }); };
      const comp = function (mode) { fsPass(progPresent, null, function (p) { setF(p, "uMode", mode); setF(p, "uBloomAmt", 1.1); bindTex(p, "uB", litT.tex, 1); bindTex(p, "uBloom", blurB.tex, 2); }); };
      curGizmo = null;
      if (ev.g === 0) { curRes = "Backbuffer"; return; } // 빈 버퍼(어두운 클리어)
      if (ev.g === 1) {
        if (ev.key === "placelight" || ev.key === "aimlight" || ev.key === "lightview" || ev.key === "lightproj") {
          curRes = "Scene / Light"; comp(3); curGizmo = ev.key; return;
        }
        curRes = "shadowTex"; raw(shadowT.tex); return; // bind/clear/shadowdepth/done
      }
      if (ev.g === 2) {
        if (ev.key === "viewnormal") { curRes = "gNormal"; raw(gNrm.tex); return; }
        if (ev.key === "viewposition") { curRes = "gPosition"; raw(gPos.tex); return; }
        curRes = "gAlbedo"; raw(gAlb.tex); return; // bind/clear/gbufdraw/viewalbedo
      }
      if (ev.g === 3) {
        if (ev.key === "bindlit" || ev.key === "samplegbuf") { curRes = "gAlbedo"; raw(gAlb.tex); return; }
        curRes = "litTex (HDR)"; raw(litT.tex); return;
      }
      if (ev.g === 4) {
        if (ev.key === "bright") { curRes = "bloomBright"; raw(brightT.tex); return; }
        if (ev.key === "blurh") { curRes = "bloomBlurX"; raw(blurA.tex); return; }
        if (ev.key === "blurv") { curRes = "bloomBlurY"; raw(blurB.tex); return; }
        curRes = "litTex + bloom"; comp(1); return;
      }
      // g5
      if (ev.key === "hdrin") { curRes = "HDR (linear)"; comp(1); return; }
      if (ev.key === "aces") { curRes = "ACES"; comp(2); return; }
      curRes = "Backbuffer (final)"; comp(3);
    }

    function projMain(world, mainW, mainH) {
      const c = M4.apply(curVP, world); if (c.w <= 1e-5) return null;
      return { x: (c.x / c.w * 0.5 + 0.5) * mainW, y: (1 - (c.y / c.w * 0.5 + 0.5)) * mainH };
    }

    function drawOverlay(ev, rects, w, h, mainH) {
      octx.clearRect(0, 0, w, h);
      // 비네트
      const vg = octx.createRadialGradient(w / 2, mainH / 2, mainH * 0.35, w / 2, mainH / 2, mainH * 0.85);
      vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.38)");
      octx.fillStyle = vg; octx.fillRect(0, 0, w, mainH);
      // 프레임 테두리
      octx.strokeStyle = "rgba(126,168,254,0.18)"; octx.lineWidth = 1; octx.strokeRect(1, 1, w - 2, mainH - 2);

      // 라이트 기즈모
      const lp = curGizmo ? projMain(lightPosCache, w, mainH) : null;
      if (curGizmo && lp) {
        const cen = projMain([0, -0.1, 0], w, mainH);
        // frustum(마지막 단계) 또는 방향선
        if (curGizmo === "lightproj" || curGizmo === "lightview") {
          octx.strokeStyle = "rgba(255,209,102,0.5)"; octx.lineWidth = 1.5;
          groundCorners.forEach(function (gc) { const pc = projMain(gc, w, mainH); if (pc) { octx.beginPath(); octx.moveTo(lp.x, lp.y); octx.lineTo(pc.x, pc.y); octx.stroke(); } });
        }
        if ((curGizmo === "aimlight" || curGizmo === "lightview" || curGizmo === "lightproj") && cen) {
          octx.strokeStyle = "rgba(255,235,150,0.9)"; octx.lineWidth = 2;
          octx.setLineDash([6, 5]); octx.beginPath(); octx.moveTo(lp.x, lp.y); octx.lineTo(cen.x, cen.y); octx.stroke(); octx.setLineDash([]);
          // 화살촉
          const ang = Math.atan2(cen.y - lp.y, cen.x - lp.x);
          octx.fillStyle = "rgba(255,235,150,0.95)";
          octx.beginPath(); octx.moveTo(cen.x, cen.y); octx.lineTo(cen.x - 10 * Math.cos(ang - 0.4), cen.y - 10 * Math.sin(ang - 0.4)); octx.lineTo(cen.x - 10 * Math.cos(ang + 0.4), cen.y - 10 * Math.sin(ang + 0.4)); octx.closePath(); octx.fill();
        }
        // 광원 아이콘(태양)
        octx.save(); octx.shadowColor = "rgba(255,220,120,0.9)"; octx.shadowBlur = 18;
        octx.fillStyle = "#ffe08a"; octx.beginPath(); octx.arc(lp.x, lp.y, 9, 0, Math.PI * 2); octx.fill(); octx.restore();
        octx.strokeStyle = "rgba(255,224,138,0.9)"; octx.lineWidth = 2;
        for (let a = 0; a < 8; a++) { const an = a / 8 * Math.PI * 2; octx.beginPath(); octx.moveTo(lp.x + Math.cos(an) * 13, lp.y + Math.sin(an) * 13); octx.lineTo(lp.x + Math.cos(an) * 19, lp.y + Math.sin(an) * 19); octx.stroke(); }
      }

      // HUD: 브레드크럼(좌상), 리소스 배지(우상)
      const grp = GROUPS[ev.g];
      const crumb = "● " + grp.name + "  ▸  " + ev.label;
      octx.font = "600 14px system-ui, sans-serif";
      const cw = octx.measureText(crumb).width;
      octx.fillStyle = "rgba(8,10,16,0.55)"; roundRectC(octx, 12, 12, cw + 22, 30, 8); octx.fill();
      octx.fillStyle = rgba(grp.col, 1); octx.fillText("●", 22, 32);
      octx.fillStyle = "#eaf0ff"; octx.fillText("  " + grp.name + "  ▸  " + ev.label, 22, 32);
      // 리소스 배지
      octx.font = "700 12px ui-monospace, monospace";
      const rw = octx.measureText(curRes).width;
      octx.fillStyle = "rgba(8,10,16,0.55)"; roundRectC(octx, w - rw - 34, 12, rw + 22, 26, 7); octx.fill();
      octx.fillStyle = "#8fe388"; octx.textAlign = "left"; octx.fillText(curRes, w - rw - 23, 29);

      // 썸네일 라벨/상태
      rects.forEach(function (r) {
        const pending = r.g > ev.g;
        const active = r.g === ev.g;
        if (pending) { octx.fillStyle = "rgba(6,7,10,0.66)"; octx.fillRect(r.x, r.y, r.w, r.h); }
        octx.strokeStyle = active ? "#ffd166" : "rgba(255,255,255,0.16)"; octx.lineWidth = active ? 2 : 1;
        octx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
        octx.font = active ? "700 11px system-ui, sans-serif" : "500 11px system-ui, sans-serif";
        octx.fillStyle = active ? "#ffd166" : (pending ? "rgba(200,205,215,0.4)" : "rgba(220,225,235,0.8)");
        octx.fillText(r.label, r.x + 2, r.y + r.h + 14);
      });
    }
    function roundRectC(c, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

    G.loop(render, canvas);
  }

  // ============================================================
  //  Canvas2D 폴백 — 이벤트 기반(동일 타임라인)
  // ============================================================
  function initFallback(canvas, ctl, readout) {
    const S = G.setup(canvas.id);
    const state = { t: 0, playing: true };
    const timeline = createTimeline(ctl, state);
    const balls = [
      { dx: -120, dy: -30, r: 46, c: [235, 72, 76] },
      { dx: 110, dy: -20, r: 40, c: [64, 140, 242] },
      { dx: 6, dy: -70, r: 32, c: [242, 200, 72] },
      { dx: 60, dy: -10, r: 26, c: [140, 230, 140] },
    ];
    function draw(dt) {
      if (state.playing) { state.t += dt * 3.2; if (state.t >= E + 0.8) state.t = 0; }
      const w = S.w, h = S.h, ctx = S.ctx; if (!w) return;
      const idx = activeEv(state.t), ev = EVENTS[idx];
      const bg = ctx.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, "#1a2740"); bg.addColorStop(1, "#0c1018");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      const cx = w / 2, gy = h * 0.72;
      function scene(mode, count) {
        ctx.fillStyle = "#20242e"; ctx.fillRect(0, gy, w, h - gy);
        const n = count == null ? balls.length : count;
        for (let i = 0; i < n; i++) {
          const b = balls[i], x = cx + b.dx, y = gy + b.dy;
          if (mode === "shadow") { ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.beginPath(); ctx.ellipse(x + 34, gy + 8, b.r * 1.1, b.r * 0.34, 0, 0, Math.PI * 2); ctx.fill(); continue; }
          let col = mode === "normal" ? "#8080ff" : "rgb(" + b.c.join(",") + ")";
          if (mode === "lit") { const gr = ctx.createRadialGradient(x - b.r * 0.3, y - b.r * 0.3, b.r * 0.1, x, y, b.r); gr.addColorStop(0, "rgba(255,255,255,0.9)"); gr.addColorStop(0.4, col); gr.addColorStop(1, "rgba(0,0,0,0.55)"); ctx.fillStyle = gr; }
          else ctx.fillStyle = col;
          ctx.beginPath(); ctx.arc(x, y, b.r, 0, Math.PI * 2); ctx.fill();
        }
      }
      if (ev.g === 0) { /* 빈 */ }
      else if (ev.g === 1) { if (ev.key === "shadowdepth") scene("shadow", ev.k); else if (ev.key === "shadowdone" || ev.key === "clearshadow" || ev.key === "bindshadow") scene("shadow"); else { scene("lit"); } }
      else if (ev.g === 2) { if (ev.key === "gbufdraw") scene("albedo", ev.k); else if (ev.key === "viewnormal") scene("normal"); else scene("albedo"); }
      else if (ev.g === 3) { if (ev.key === "bindlit" || ev.key === "samplegbuf") scene("albedo"); else scene("lit"); }
      else if (ev.g === 4) { scene("lit"); if (ev.key !== "bright") { ctx.globalCompositeOperation = "lighter"; scene("lit"); ctx.globalCompositeOperation = "source-over"; } }
      else { scene("lit"); }
      G.text(ctx, GROUPS[ev.g].name + " ▸ " + ev.label, 16, 26, "#eaf0ff", "600 14px system-ui, sans-serif");
      timeline.draw();
      updateReadout(readout, idx);
    }
    G.loop(draw, canvas);
  }

  G.deferInit("c-pipeline", initPipeline);
})();
