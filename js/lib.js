/* ============================================================
   lib.js — 모든 데모가 공유하는 헬퍼
   전역 객체 GFX 로 노출된다.
   ============================================================ */
(function () {
  "use strict";

  // ---- 캔버스 셋업 (레티나 대응) ----------------------------
  // canvas를 CSS 폭에 맞추고 devicePixelRatio 스케일을 적용한다.
  // 반환: { canvas, ctx, w, h }  (w,h 는 CSS 픽셀 기준 논리 크기)
  function setup(id) {
    const canvas = document.getElementById(id);
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // 논리 높이는 최초 1회만 읽는다. canvas.height 프로퍼티를 대입하면
    // HTML height 속성이 함께 바뀌므로, 매번 읽으면 dpr배씩 커지는
    // 피드백 루프가 생긴다(=데모가 세로로 무한정 길어짐).
    const baseH = parseInt(canvas.getAttribute("height")) || 300;

    function resize() {
      const cssW = canvas.clientWidth || canvas.parentElement.clientWidth;
      const cssH = baseH;
      canvas.style.height = cssH + "px";
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      canvas._cssW = cssW;
      canvas._cssH = cssH;
    }
    resize();
    window.addEventListener("resize", resize);
    return {
      canvas,
      ctx,
      get w() { return canvas._cssW; },
      get h() { return canvas._cssH; },
      onResize: resize,
    };
  }

  // ---- 색상 팔레트 ------------------------------------------
  const COL = {
    bg: "#0b0d13",
    grid: "#1c2130",
    gridAxis: "#3a4257",
    text: "#e6e8ee",
    dim: "#9aa1b2",
    accent: "#6ea8fe",   // 파랑
    green: "#7ee787",
    red: "#ff7b72",
    yellow: "#ffd166",
    purple: "#c792ea",
    cyan: "#56d4dd",
  };

  // ---- 드로잉 프리미티브 ------------------------------------
  function clear(ctx, w, h, color) {
    ctx.fillStyle = color || COL.bg;
    ctx.fillRect(0, 0, w, h);
  }

  // 화살표(벡터) 그리기
  function arrow(ctx, x1, y1, x2, y2, color, width) {
    color = color || COL.accent;
    width = width || 2.5;
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    if (len < 1) return;
    const a = Math.atan2(dy, dx);
    const head = Math.min(12, len * 0.4);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(a - 0.4), y2 - head * Math.sin(a - 0.4));
    ctx.lineTo(x2 - head * Math.cos(a + 0.4), y2 - head * Math.sin(a + 0.4));
    ctx.closePath();
    ctx.fill();
  }

  function dot(ctx, x, y, r, color) {
    ctx.fillStyle = color || COL.accent;
    ctx.beginPath();
    ctx.arc(x, y, r || 5, 0, Math.PI * 2);
    ctx.fill();
  }

  function line(ctx, x1, y1, x2, y2, color, width, dash) {
    ctx.strokeStyle = color || COL.dim;
    ctx.lineWidth = width || 1;
    if (dash) ctx.setLineDash(dash); else ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function text(ctx, str, x, y, color, font, align) {
    ctx.fillStyle = color || COL.text;
    ctx.font = font || "13px 'JetBrains Mono', monospace";
    ctx.textAlign = align || "left";
    ctx.textBaseline = "middle";
    ctx.fillText(str, x, y);
    ctx.textAlign = "left";
  }

  // 배경 격자 (중심이 원점, +y가 위로 가는 수학 좌표계 옵션)
  // 반환된 함수 없이 그냥 그린다.
  function grid(ctx, w, h, step, color) {
    step = step || 40;
    ctx.strokeStyle = color || COL.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = 0; y <= h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
  }

  // 원점이 중앙, y축 위로 향하는 좌표계를 위한 변환 헬퍼 세트
  // scale: 픽셀/단위
  function centered(w, h, scale) {
    const ox = w / 2, oy = h / 2;
    return {
      ox, oy, scale,
      // 수학좌표 -> 화면픽셀
      sx: (x) => ox + x * scale,
      sy: (y) => oy - y * scale,
      // 화면픽셀 -> 수학좌표
      mx: (px) => (px - ox) / scale,
      my: (py) => (oy - py) / scale,
      drawAxes(ctx) {
        line(ctx, 0, oy, w, oy, COL.gridAxis, 1.5);
        line(ctx, ox, 0, ox, h, COL.gridAxis, 1.5);
      },
      drawGrid(ctx) {
        ctx.strokeStyle = COL.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = ox % scale; x <= w; x += scale) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
        for (let y = oy % scale; y <= h; y += scale) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
        ctx.stroke();
      },
    };
  }

  // ---- 드래그 가능한 핸들 관리 ------------------------------
  // points: [{x, y, color, label}] (화면 픽셀 좌표)
  // onChange(): 값이 바뀔 때 호출
  // 반환: { draw(ctx), points }
  function draggable(canvas, points, onChange, radius) {
    radius = radius || 10;
    let dragging = -1;

    function pos(e) {
      const r = canvas.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    }
    function hit(p) {
      for (let i = points.length - 1; i >= 0; i--) {
        if (Math.hypot(points[i].x - p.x, points[i].y - p.y) < radius + 8) return i;
      }
      return -1;
    }
    function down(e) {
      const p = pos(e);
      dragging = hit(p);
      if (dragging >= 0) e.preventDefault();
    }
    function move(e) {
      const p = pos(e);
      canvas.style.cursor = (dragging >= 0 || hit(p) >= 0) ? "grabbing" : "crosshair";
      if (dragging < 0) return;
      e.preventDefault();
      points[dragging].x = Math.max(0, Math.min(canvas._cssW, p.x));
      points[dragging].y = Math.max(0, Math.min(canvas._cssH, p.y));
      if (onChange) onChange();
    }
    function up() { dragging = -1; }

    canvas.addEventListener("mousedown", down);
    canvas.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    canvas.addEventListener("touchstart", down, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", up);

    return {
      points,
      drawHandles(ctx) {
        points.forEach((pt) => {
          ctx.fillStyle = pt.color || COL.accent;
          ctx.strokeStyle = "rgba(255,255,255,0.85)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          if (pt.label) text(ctx, pt.label, pt.x + radius + 4, pt.y, COL.text, "bold 13px sans-serif");
        });
      },
    };
  }

  // ---- UI 컨트롤 생성기 -------------------------------------
  // 슬라이더를 만들어 container에 추가. onInput(value) 호출.
  function slider(container, opts) {
    const wrap = document.createElement("div");
    wrap.className = "control";
    const lab = document.createElement("label");
    const name = document.createElement("span");
    name.textContent = opts.label;
    const val = document.createElement("span");
    val.className = "val";
    lab.appendChild(name); lab.appendChild(val);
    const input = document.createElement("input");
    input.type = "range";
    input.min = opts.min; input.max = opts.max;
    input.step = opts.step != null ? opts.step : 1;
    input.value = opts.value != null ? opts.value : opts.min;
    const fmt = opts.format || ((v) => (+v).toFixed(input.step % 1 ? 2 : 0));
    function update() {
      val.textContent = fmt(input.value);
      if (opts.onInput) opts.onInput(parseFloat(input.value));
    }
    input.addEventListener("input", update);
    wrap.appendChild(lab); wrap.appendChild(input);
    container.appendChild(wrap);
    update();
    return { input, set: (v) => { input.value = v; update(); }, get: () => parseFloat(input.value) };
  }

  function button(container, label, onClick, ghost) {
    const b = document.createElement("button");
    b.textContent = label;
    if (ghost) b.className = "ghost";
    b.addEventListener("click", onClick);
    container.appendChild(b);
    return b;
  }

  function checkbox(container, label, checked, onChange) {
    const wrap = document.createElement("label");
    wrap.className = "control";
    wrap.style.flexDirection = "row";
    wrap.style.alignItems = "center";
    wrap.style.cursor = "pointer";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!checked;
    cb.style.width = "auto";
    cb.addEventListener("change", () => onChange(cb.checked));
    const span = document.createElement("span");
    span.textContent = label;
    wrap.appendChild(cb); wrap.appendChild(span);
    container.appendChild(wrap);
    return cb;
  }

  // ---- 수학: 벡터/행렬 --------------------------------------
  const V = {
    add: (a, b) => a.map((v, i) => v + b[i]),
    sub: (a, b) => a.map((v, i) => v - b[i]),
    scale: (a, s) => a.map((v) => v * s),
    dot: (a, b) => a.reduce((s, v, i) => s + v * b[i], 0),
    len: (a) => Math.hypot(...a),
    norm: (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); },
    cross3: (a, b) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ],
    cross2: (a, b) => a[0] * b[1] - a[1] * b[0], // 스칼라
  };

  // 4x4 행렬 (열 우선, WebGL 관례). 배열 16개.
  const M4 = {
    identity: () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],
    mul(a, b) {
      const o = new Array(16).fill(0);
      for (let c = 0; c < 4; c++)
        for (let r = 0; r < 4; r++)
          for (let k = 0; k < 4; k++)
            o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
      return o;
    },
    translate: (x, y, z) => [1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1],
    scale: (x, y, z) => [x,0,0,0, 0,y,0,0, 0,0,z,0, 0,0,0,1],
    rotX(a) { const c = Math.cos(a), s = Math.sin(a);
      return [1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]; },
    rotY(a) { const c = Math.cos(a), s = Math.sin(a);
      return [c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]; },
    rotZ(a) { const c = Math.cos(a), s = Math.sin(a);
      return [c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1]; },
    // 원근 투영
    perspective(fovy, aspect, near, far) {
      const f = 1 / Math.tan(fovy / 2);
      const nf = 1 / (near - far);
      return [
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, (far + near) * nf, -1,
        0, 0, 2 * far * near * nf, 0,
      ];
    },
    // 카메라 LookAt
    lookAt(eye, center, up) {
      const z = V.norm(V.sub(eye, center));
      const x = V.norm(V.cross3(up, z));
      const y = V.cross3(z, x);
      return [
        x[0], y[0], z[0], 0,
        x[1], y[1], z[1], 0,
        x[2], y[2], z[2], 0,
        -V.dot(x, eye), -V.dot(y, eye), -V.dot(z, eye), 1,
      ];
    },
    // 점(벡터3, w=1) 변환 -> {x,y,z,w}
    apply(m, p) {
      const [x, y, z] = p;
      return {
        x: m[0]*x + m[4]*y + m[8]*z + m[12],
        y: m[1]*x + m[5]*y + m[9]*z + m[13],
        z: m[2]*x + m[6]*y + m[10]*z + m[14],
        w: m[3]*x + m[7]*y + m[11]*z + m[15],
      };
    },
  };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rad = (deg) => (deg * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;

  // 마우스 드래그로 회전각(궤도) 얻기 위한 헬퍼
  function orbitControl(canvas, state, onChange) {
    // state: {rx, ry}  (라디안). 드래그로 갱신.
    let last = null;
    function pos(e) { const t = e.touches ? e.touches[0] : e;
      const r = canvas.getBoundingClientRect(); return { x: t.clientX - r.left, y: t.clientY - r.top }; }
    canvas.addEventListener("mousedown", (e) => { last = pos(e); });
    window.addEventListener("mouseup", () => { last = null; });
    canvas.addEventListener("mousemove", (e) => {
      if (!last) return;
      const p = pos(e);
      state.ry += (p.x - last.x) * 0.01;
      state.rx += (p.y - last.y) * 0.01;
      last = p;
      if (onChange) onChange();
    });
    canvas.addEventListener("touchstart", (e) => { last = pos(e); }, { passive: true });
    window.addEventListener("touchend", () => { last = null; });
    canvas.addEventListener("touchmove", (e) => {
      if (!last) return; e.preventDefault();
      const p = pos(e);
      state.ry += (p.x - last.x) * 0.01;
      state.rx += (p.y - last.y) * 0.01;
      last = p; if (onChange) onChange();
    }, { passive: false });
  }

  // requestAnimationFrame 루프 헬퍼. fn(dt) 매 프레임 호출.
  // el(선택): 이 요소가 숨겨진 섹션(display:none → offsetParent === null)에 있으면
  //   그리기 콜백을 건너뛴다. 이 페이지는 섹션 하나만 보이는 SPA라, 안 보이는
  //   수십 개 데모의 rAF가 매 프레임 계산하면 페이지 전체가 느려진다. el을 넘기면
  //   보이는 데모만 실제로 그리고 나머지는 유휴 상태가 된다. (rAF 자체는 유지 —
  //   다시 보이면 즉시 재개, 백그라운드 탭은 브라우저가 알아서 rAF를 늦춘다.)
  function loop(fn, el) {
    let raf, prev = 0, running = true;
    function step(t) {
      if (!running) return;
      if (el && el.offsetParent === null) {
        prev = 0; // 다시 보일 때 dt가 크게 튀지 않도록 리셋
        raf = requestAnimationFrame(step);
        return;
      }
      const dt = prev ? (t - prev) / 1000 : 0;
      prev = t;
      fn(dt);
      raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
    return { stop() { running = false; cancelAnimationFrame(raf); } };
  }

  // 데모 지연 초기화 레지스트리. 각 데모를 canvasId와 함께 등록해 두고,
  // 그 캔버스가 화면에 보일 때(offsetParent !== null) 딱 한 번 init을 실행한다.
  // index.html은 섹션 하나만 보이는 SPA라, 보이는 섹션 데모만 초기화되어 로드가 빨라진다.
  const _pendingDemos = [];
  function deferInit(canvasId, fn) { _pendingDemos.push({ canvasId, fn, done: false }); }
  function runPendingDemos() {
    for (const d of _pendingDemos) {
      if (d.done) continue;
      const el = document.getElementById(d.canvasId);
      if (el && el.offsetParent !== null) {
        d.done = true;
        try { d.fn(); } catch (e) { console.error("[demo] init 실패:", d.canvasId, e); }
      }
    }
  }

  window.GFX = {
    setup, COL, clear, arrow, dot, line, text, grid, centered,
    draggable, slider, button, checkbox,
    V, M4, clamp, lerp, rad, deg, orbitControl, loop,
    deferInit, runPendingDemos,
  };
})();
