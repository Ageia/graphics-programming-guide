/* ============================================================
   demos-gpu.js — "4. GPU · 셰이더" 섹션의 인터랙티브 데모들
   1) GPU 병렬 경주 (#c-parallel)
   2) Vertex Shader 물결 (#c-vertexshader)
   3) Fragment Shader (실제 WebGL, #c-fragshader)
   4) Compute / 파티클 (#c-compute)
   전역 GFX 헬퍼를 사용한다.
   ============================================================ */
(function () {
  "use strict";
  const G = window.GFX;

  /* =========================================================
     1) GPU 병렬 경주 — CPU(직렬) vs GPU(병렬) 픽셀 처리
     ========================================================= */
  function initParallel() {
      if (!document.getElementById("c-parallel")) return;
      const { canvas, ctx } = G.setup("c-parallel");
      const ctl = document.getElementById("ctl-parallel");

      // 채울 대상 이미지: 24x16 격자, 각 칸에 절차적 색을 부여
      const COLS = 24, ROWS = 16;
      const N = COLS * ROWS;
      const cells = new Array(N);
      for (let j = 0; j < ROWS; j++) {
        for (let i = 0; i < COLS; i++) {
          // 무늬(원형 + 줄무늬)로 알아보기 쉬운 그림 생성
          const cx = i - COLS / 2 + 0.5, cy = j - ROWS / 2 + 0.5;
          const d = Math.hypot(cx, cy) / (COLS / 2);
          const hue = (Math.atan2(cy, cx) / (Math.PI * 2) + 0.5) * 360;
          const light = 40 + 30 * Math.cos(d * 6);
          cells[j * COLS + i] = `hsl(${hue.toFixed(0)},70%,${light.toFixed(0)}%)`;
        }
      }

      // 상태: 각 칸이 채워졌는지 (진행도)
      let cpuFilled = 0;    // CPU가 채운 칸 수 (한 tick에 1칸)
      let gpuFilled = 0;    // GPU가 채운 칸 수 (한 tick에 cores칸)
      let cores = 32;       // GPU 병렬 폭
      let running = false;
      let cpuTime = 0, gpuTime = 0; // 완료까지 걸린 tick 수(가상 시간)
      let cpuDone = false, gpuDone = false;
      // "가상 시간"은 프레임(dt)이 아니라 tick 단위로 셈: 한 프레임 = 1 tick
      const CPU_PER_TICK = 1;

      function reset() {
        cpuFilled = 0; gpuFilled = 0;
        cpuTime = 0; gpuTime = 0;
        cpuDone = false; gpuDone = false;
        running = false;
      }

      // 컨트롤: 출발 / 다시 / GPU 코어 수 슬라이더
      const startBtn = G.button(ctl, "출발", () => {
        if (running) return;
        reset();
        running = true;
      });
      G.button(ctl, "다시", () => { reset(); }, true);
      G.slider(ctl, {
        label: "GPU 코어 수 (병렬 폭)", min: 1, max: 128, step: 1, value: cores,
        format: (v) => v + "개",
        onInput: (v) => { cores = v; },
      });

      // 한 패널(그림)을 그린다
      function drawPanel(x0, y0, pw, ph, filled, label, labelCol) {
        const cw = pw / COLS, ch = ph / ROWS;
        for (let k = 0; k < N; k++) {
          const i = k % COLS, j = (k / COLS) | 0;
          const px = x0 + i * cw, py = y0 + j * ch;
          if (k < filled) {
            ctx.fillStyle = cells[k];
          } else {
            ctx.fillStyle = "#2a2d3a"; // 아직 안 채워진 칸(배경과 구분되게 밝게)
          }
          ctx.fillRect(px, py, cw + 0.6, ch + 0.6);
        }
        // 셀 격자선(빈 상태에서도 그리드가 보이도록)
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.lineWidth = 1;
        for (let i = 1; i < COLS; i++) { ctx.beginPath(); ctx.moveTo(x0 + i * cw, y0); ctx.lineTo(x0 + i * cw, y0 + ph); ctx.stroke(); }
        for (let j = 1; j < ROWS; j++) { ctx.beginPath(); ctx.moveTo(x0, y0 + j * ch); ctx.lineTo(x0 + pw, y0 + j * ch); ctx.stroke(); }
        // 테두리 + 라벨
        ctx.strokeStyle = G.COL.gridAxis;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x0, y0, pw, ph);
        G.text(ctx, label, x0, y0 - 12, labelCol, "bold 14px sans-serif");
      }

      G.loop(function () {
        const w = canvas._cssW, h = canvas._cssH;
        G.clear(ctx, w, h);

        // 애니메이션 진행 (running일 때만 tick 증가)
        if (running) {
          if (!cpuDone) {
            cpuFilled = Math.min(N, cpuFilled + CPU_PER_TICK);
            cpuTime++;
            if (cpuFilled >= N) cpuDone = true;
          }
          if (!gpuDone) {
            gpuFilled = Math.min(N, gpuFilled + cores);
            gpuTime++;
            if (gpuFilled >= N) gpuDone = true;
          }
          if (cpuDone && gpuDone) running = false;
        }

        // 레이아웃: 좌 CPU, 우 GPU
        const pad = 24, gap = 40, topPad = 58, botPad = 46;
        const pw = (w - pad * 2 - gap) / 2;
        const ph = h - topPad - botPad;
        drawPanel(pad, topPad, pw, ph, cpuFilled, "CPU (직렬) — 한 번에 1칸", G.COL.accent);
        drawPanel(pad + pw + gap, topPad, pw, ph, gpuFilled,
          `GPU (병렬) — 한 번에 ${cores}칸`, G.COL.green);

        // 진행/타이머 표시
        const by = h - botPad + 18;
        const cpuPct = ((cpuFilled / N) * 100) | 0;
        const gpuPct = ((gpuFilled / N) * 100) | 0;
        G.text(ctx, `진행 ${cpuPct}% · 시간 ${cpuTime} tick${cpuDone ? " ✓" : ""}`,
          pad, by, cpuDone ? G.COL.green : G.COL.dim, "13px 'JetBrains Mono', monospace");
        G.text(ctx, `진행 ${gpuPct}% · 시간 ${gpuTime} tick${gpuDone ? " ✓" : ""}`,
          pad + pw + gap, by, gpuDone ? G.COL.green : G.COL.dim, "13px 'JetBrains Mono', monospace");

        // 승자 안내
        if (cpuDone && gpuDone) {
          let msg;
          if (gpuTime < cpuTime) msg = `GPU가 ${(cpuTime / gpuTime).toFixed(1)}배 빠르게 완료!`;
          else if (gpuTime > cpuTime) msg = "이번엔 CPU가 먼저 끝났어요 (코어=1?)";
          else msg = "동시에 완료!";
          G.text(ctx, msg, w / 2, 16, G.COL.yellow, "bold 14px sans-serif", "center");
        } else if (!running && cpuFilled === 0) {
          G.text(ctx, "「출발」을 눌러 같은 그림을 두 방식으로 채워보세요",
            w / 2, 16, G.COL.dim, "13px sans-serif", "center");
        }
      });
    }

    /* =========================================================
       2) Vertex Shader 물결 — 격자 정점의 높이를 sin으로 변위
       ========================================================= */
    function initVertexShader() {
      if (!document.getElementById("c-vertexshader")) return;
      const { canvas, ctx } = G.setup("c-vertexshader");
      const ctl = document.getElementById("ctl-vertexshader");

      const GRID = 22;          // 정점 격자 크기 (GRID x GRID)
      let amp = 0.8;            // 진폭
      let freq = 1.4;           // 주파수
      let speed = 1.0;          // 애니메이션 속도
      let t = 0;

      G.slider(ctl, { label: "진폭 (amplitude)", min: 0, max: 2, step: 0.05, value: amp,
        onInput: (v) => amp = v });
      G.slider(ctl, { label: "주파수 (frequency)", min: 0.2, max: 4, step: 0.05, value: freq,
        onInput: (v) => freq = v });
      G.slider(ctl, { label: "애니메이션 속도", min: 0, max: 3, step: 0.05, value: speed,
        onInput: (v) => speed = v });

      // 3D 점 -> 화면 (간단한 등각/원근 혼합 투영)
      // 카메라를 위에서 비스듬히 내려다보는 고정 궤도
      function project(x, y, z, w, h) {
        // 회전 (Y축, X축)
        const ry = 0.0, rx = -0.9; // 내려다보는 각
        // Y축 회전
        let x1 = x, z1 = z;
        // (ry=0 이라 생략 가능하지만 확장성 위해 유지)
        const cy = Math.cos(ry), sy = Math.sin(ry);
        const x2 = x1 * cy + z1 * sy;
        const z2 = -x1 * sy + z1 * cy;
        // X축 회전
        const cx = Math.cos(rx), sx = Math.sin(rx);
        const y3 = y * cx - z2 * sx;
        const z3 = y * sx + z2 * cx;
        // 원근 투영
        const dist = 6;
        const f = 3.4 / (dist + z3);
        return {
          sx: w / 2 + x2 * f * (w * 0.16),
          sy: h / 2 - y3 * f * (h * 0.30) + h * 0.06,
          depth: z3,
        };
      }

      // 정점 높이(버텍스 셰이더의 핵심 수식)
      function heightAt(gx, gz) {
        // gx,gz: -1..1 정규화 좌표
        const r = Math.hypot(gx, gz);
        return Math.sin(gx * freq * Math.PI + t) * amp * 0.5
             + Math.cos(gz * freq * Math.PI - t * 0.8) * amp * 0.5
             + Math.sin(r * freq * Math.PI * 2 - t * 1.2) * amp * 0.25;
      }

      // 값 -> 색 (높이에 따른 셰이딩)
      function shade(hgt) {
        const tt = G.clamp((hgt / (amp + 0.001) + 1) / 2, 0, 1);
        const r = (60 + 160 * tt) | 0;
        const g = (90 + 120 * tt) | 0;
        const b = (200 - 60 * tt) | 0;
        return `rgb(${r},${g},${b})`;
      }

      G.loop(function (dt) {
        t += dt * speed * 2;
        const w = canvas._cssW, h = canvas._cssH;
        G.clear(ctx, w, h);

        // 정점 좌표 계산
        const pts = new Array(GRID * GRID);
        for (let j = 0; j < GRID; j++) {
          for (let i = 0; i < GRID; i++) {
            const gx = (i / (GRID - 1)) * 2 - 1;
            const gz = (j / (GRID - 1)) * 2 - 1;
            const y = heightAt(gx, gz);
            pts[j * GRID + i] = project(gx * 1.6, y, gz * 1.6, w, h);
            pts[j * GRID + i].hy = y;
          }
        }

        // 쿼드(사각형)를 뒤에서 앞으로 그려 깊이감 (painter's algorithm)
        const quads = [];
        for (let j = 0; j < GRID - 1; j++) {
          for (let i = 0; i < GRID - 1; i++) {
            const a = pts[j * GRID + i];
            const b = pts[j * GRID + i + 1];
            const c = pts[(j + 1) * GRID + i + 1];
            const d = pts[(j + 1) * GRID + i];
            const depth = (a.depth + b.depth + c.depth + d.depth) / 4;
            const hy = (a.hy + b.hy + c.hy + d.hy) / 4;
            quads.push({ a, b, c, d, depth, hy });
          }
        }
        quads.sort((p, q) => q.depth - p.depth); // 먼 것 먼저

        for (const qd of quads) {
          ctx.beginPath();
          ctx.moveTo(qd.a.sx, qd.a.sy);
          ctx.lineTo(qd.b.sx, qd.b.sy);
          ctx.lineTo(qd.c.sx, qd.c.sy);
          ctx.lineTo(qd.d.sx, qd.d.sy);
          ctx.closePath();
          ctx.fillStyle = shade(qd.hy);
          ctx.fill();
          ctx.strokeStyle = "rgba(230,235,255,0.25)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // 안내 텍스트
        G.text(ctx, "각 정점: y += sin(x·f + t)·a  →  표면이 출렁임",
          14, 18, G.COL.dim, "12px 'JetBrains Mono', monospace");
      });
    }

    /* =========================================================
       3) Fragment Shader — 실제 WebGL, 실패 시 Canvas2D 대체
       ========================================================= */
    function initFragShader() {
      const canvas = document.getElementById("c-fragshader");
      if (!canvas) return;
      const ctl = document.getElementById("ctl-fragshader");
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      // 논리 높이는 최초 1회만 읽는다(피드백 루프 방지, lib.js setup 주석 참고)
      const baseH = parseInt(canvas.getAttribute("height")) || 340;

      // 표시 크기 설정 (lib의 setup은 2D 컨텍스트를 잡으므로 여기선 직접 처리)
      function sizeCanvas() {
        const cssW = canvas.clientWidth || (canvas.parentElement && canvas.parentElement.clientWidth) || 600;
        const cssH = baseH;
        canvas.style.height = cssH + "px";
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        canvas._cssW = cssW; canvas._cssH = cssH;
        return { cssW, cssH };
      }
      sizeCanvas();

      // 프리셋 프래그먼트 셰이더 (GLSL). uv(0..1) + u_time 만으로 색 계산.
      const FRAG = {
        gradient: `
          precision mediump float;
          varying vec2 vUv;
          uniform float u_time;
          void main(){
            vec3 c = mix(vec3(0.9,0.2,0.3), vec3(0.2,0.4,1.0),
                         vUv.x + 0.15*sin(u_time+vUv.y*6.2831));
            gl_FragColor = vec4(c, 1.0);
          }`,
        circle: `
          precision mediump float;
          varying vec2 vUv;
          uniform float u_time;
          void main(){
            vec2 p = vUv - 0.5;
            float r = 0.28 + 0.05*sin(u_time*2.0);
            float d = length(p) - r;          // 원의 SDF
            float e = smoothstep(0.01, -0.01, d);
            vec3 col = mix(vec3(0.06,0.08,0.14), vec3(0.4,0.85,0.85), e);
            gl_FragColor = vec4(col, 1.0);
          }`,
        checker: `
          precision mediump float;
          varying vec2 vUv;
          uniform float u_time;
          void main(){
            vec2 uv = vUv * 8.0 + vec2(u_time*0.5, 0.0);
            float c = mod(floor(uv.x)+floor(uv.y), 2.0);
            vec3 col = mix(vec3(0.10,0.12,0.18), vec3(0.78,0.57,0.92), c);
            gl_FragColor = vec4(col, 1.0);
          }`,
        plasma: `
          precision mediump float;
          varying vec2 vUv;
          uniform float u_time;
          void main(){
            vec2 p = vUv * 6.2831;
            float t = u_time;
            float v = sin(p.x + t)
                    + sin(p.y + t*1.3)
                    + sin((p.x+p.y)*0.5 + t*0.7)
                    + sin(length(p-3.1416)*1.5 - t);
            v *= 0.25;
            vec3 col = vec3(0.5+0.5*sin(v*3.1416),
                            0.5+0.5*sin(v*3.1416+2.0),
                            0.5+0.5*sin(v*3.1416+4.0));
            gl_FragColor = vec4(col, 1.0);
          }`,
      };
      const VERT = `
        attribute vec2 a_pos;
        varying vec2 vUv;
        void main(){
          vUv = a_pos * 0.5 + 0.5;      // -1..1 -> 0..1
          gl_Position = vec4(a_pos, 0.0, 1.0);
        }`;

      const ORDER = ["gradient", "circle", "plasma", "checker"];
      const NAMES = { gradient: "그라디언트", circle: "원형 SDF (원)",
                      checker: "체커보드", plasma: "플라스마" };
      let current = "gradient";
      let mode = "WebGL"; // 또는 "Canvas2D"

      // 현재 효과 이름 표시용 라벨
      const nameLabel = document.createElement("div");
      nameLabel.className = "readout";
      nameLabel.style.marginTop = "8px";

      // ---- WebGL 시도 ----
      let gl = null, program = null, uTimeLoc = null, glOk = false;
      try {
        gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      } catch (e) { gl = null; }

      function compile(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          throw new Error(gl.getShaderInfoLog(s) || "shader compile failed");
        }
        return s;
      }
      function buildProgram(fragSrc) {
        const vs = compile(gl.VERTEX_SHADER, VERT);
        const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
        const p = gl.createProgram();
        gl.attachShader(p, vs); gl.attachShader(p, fs);
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
          throw new Error(gl.getProgramInfoLog(p) || "link failed");
        }
        gl.deleteShader(vs); gl.deleteShader(fs);
        return p;
      }

      function setupGL() {
        // 풀스크린 쿼드 (두 삼각형)
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER,
          new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
        useShader(current);
        return buf;
      }
      function useShader(key) {
        program = buildProgram(FRAG[key]);
        gl.useProgram(program);
        const loc = gl.getAttribLocation(program, "a_pos");
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        uTimeLoc = gl.getUniformLocation(program, "u_time");
      }

      if (gl) {
        try {
          setupGL();
          glOk = true;
          mode = "WebGL";
        } catch (e) {
          glOk = false;
          gl = null;
        }
      }

      // ---- Canvas2D 소프트웨어 대체 (동일 효과, 저해상도 ImageData) ----
      let ctx2d = null, img = null, RW = 0, RH = 0;
      function setupSoft() {
        ctx2d = canvas.getContext("2d");
        mode = "Canvas2D";
        allocSoft();
      }
      function allocSoft() {
        RW = 120; RH = Math.max(1, Math.round(RW * (canvas._cssH / canvas._cssW)));
        img = ctx2d.createImageData(RW, RH);
      }
      function renderSoft(time) {
        const data = img.data;
        for (let y = 0; y < RH; y++) {
          for (let x = 0; x < RW; x++) {
            const u = x / (RW - 1), v = 1 - y / (RH - 1); // WebGL과 v 방향 맞춤
            let r = 0, g = 0, b = 0;
            if (current === "gradient") {
              const mixv = G.clamp(u + 0.15 * Math.sin(time + v * 6.2831), 0, 1);
              r = 0.9 + (0.2 - 0.9) * mixv; g = 0.2 + (0.4 - 0.2) * mixv; b = 0.3 + (1.0 - 0.3) * mixv;
            } else if (current === "circle") {
              const px = u - 0.5, py = v - 0.5;
              const rad = 0.28 + 0.05 * Math.sin(time * 2);
              const d = Math.hypot(px, py) - rad;
              const e = G.clamp((0.01 - d) / 0.02, 0, 1);
              r = 0.06 + (0.4 - 0.06) * e; g = 0.08 + (0.85 - 0.08) * e; b = 0.14 + (0.85 - 0.14) * e;
            } else if (current === "checker") {
              const uu = u * 8 + time * 0.5, vv = v * 8;
              const c = (Math.floor(uu) + Math.floor(vv)) % 2 === 0 ? 0 : 1;
              r = 0.10 + (0.78 - 0.10) * c; g = 0.12 + (0.57 - 0.12) * c; b = 0.18 + (0.92 - 0.18) * c;
            } else { // plasma
              const px = u * 6.2831, py = v * 6.2831;
              let val = Math.sin(px + time)
                      + Math.sin(py + time * 1.3)
                      + Math.sin((px + py) * 0.5 + time * 0.7)
                      + Math.sin(Math.hypot(px - 3.1416, py - 3.1416) * 1.5 - time);
              val *= 0.25;
              r = 0.5 + 0.5 * Math.sin(val * Math.PI);
              g = 0.5 + 0.5 * Math.sin(val * Math.PI + 2);
              b = 0.5 + 0.5 * Math.sin(val * Math.PI + 4);
            }
            const idx = (y * RW + x) * 4;
            data[idx] = (r * 255) | 0;
            data[idx + 1] = (g * 255) | 0;
            data[idx + 2] = (b * 255) | 0;
            data[idx + 3] = 255;
          }
        }
        // 저해상도 이미지를 캔버스 전체로 확대 (부드럽게)
        // 임시 캔버스에 그린 뒤 확대 draw
        renderSoft._tmp = renderSoft._tmp || document.createElement("canvas");
        const tmp = renderSoft._tmp;
        tmp.width = RW; tmp.height = RH;
        tmp.getContext("2d").putImageData(img, 0, 0);
        ctx2d.imageSmoothingEnabled = true;
        ctx2d.clearRect(0, 0, canvas.width, canvas.height);
        ctx2d.drawImage(tmp, 0, 0, canvas.width, canvas.height);
      }

      if (!glOk) setupSoft();

      // 리사이즈 처리
      window.addEventListener("resize", function () {
        sizeCanvas();
        if (glOk) {
          gl.viewport(0, 0, canvas.width, canvas.height);
        } else {
          allocSoft();
        }
      });

      // 효과 전환 버튼
      ORDER.forEach((key) => {
        G.button(ctl, NAMES[key], () => {
          current = key;
          if (glOk) {
            try { useShader(key); } catch (e) {
              // 컴파일 실패 시 소프트웨어로 폴백
              glOk = false; gl = null; setupSoft();
            }
          }
          updateLabel();
        }, key !== current);
      });
      ctl.parentElement.appendChild(nameLabel);
      function updateLabel() {
        nameLabel.textContent = `현재 효과: ${NAMES[current]}  ·  실행: ${mode}` +
          (mode === "Canvas2D" ? " (WebGL 미지원 → 소프트웨어 대체)" : " (GPU 실제 실행)");
      }
      updateLabel();

      // 애니메이션 루프
      let start = performance.now();
      function frame() {
        // 숨겨진 섹션이면 렌더 생략(페이지 SPA — 안 보이는 데모는 그리지 않음)
        if (canvas.offsetParent === null) { requestAnimationFrame(frame); return; }
        const time = (performance.now() - start) / 1000;
        if (glOk) {
          gl.viewport(0, 0, canvas.width, canvas.height);
          gl.uniform1f(uTimeLoc, time);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        } else {
          renderSoft(time);
        }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }

    /* =========================================================
       4) Compute / 파티클 — 같은 규칙을 N개 데이터에 병렬 적용
       ========================================================= */
    function initCompute() {
      if (!document.getElementById("c-compute")) return;
      const { canvas, ctx } = G.setup("c-compute");
      const ctl = document.getElementById("ctl-compute");

      const MAX = 8000;
      let count = 1500;
      // 미리 할당한 typed array (루프 내 할당 방지)
      const px = new Float32Array(MAX);
      const py = new Float32Array(MAX);
      const vx = new Float32Array(MAX);
      const vy = new Float32Array(MAX);

      function spawn(i, w, h) {
        px[i] = Math.random() * w;
        py[i] = Math.random() * h;
        vx[i] = (Math.random() - 0.5) * 20;
        vy[i] = (Math.random() - 0.5) * 20;
      }
      function initAll() {
        const w = canvas._cssW, h = canvas._cssH;
        for (let i = 0; i < MAX; i++) spawn(i, w, h);
      }
      initAll();

      G.slider(ctl, {
        label: "파티클 수", min: 100, max: MAX, step: 100, value: count,
        format: (v) => (+v).toLocaleString() + "개",
        onInput: (v) => { count = v | 0; },
      });

      // FPS 측정
      let fps = 0, acc = 0, frames = 0;

      G.loop(function (dt) {
        const w = canvas._cssW, h = canvas._cssH;
        // dt 폭주 방지
        const step = Math.min(dt, 0.05);

        // FPS 갱신
        acc += dt; frames++;
        if (acc >= 0.4) { fps = frames / acc; acc = 0; frames = 0; }

        // 잔상 효과를 위해 반투명하게 덮기
        ctx.fillStyle = "rgba(11,13,19,0.28)";
        ctx.fillRect(0, 0, w, h);

        const cx = w / 2, cy = h / 2;
        // ---- "컴퓨트 셰이더" 코어 루프: 모든 파티클이 동일 규칙 실행 ----
        // 규칙: 중심으로 끌림 + 소용돌이(swirl) + 가장자리 랩어라운드
        ctx.fillStyle = G.COL.cyan;
        for (let i = 0; i < count; i++) {
          const dx = cx - px[i], dy = cy - py[i];
          const dist = Math.hypot(dx, dy) + 0.001;
          // 중심 방향 인력
          const pull = 60;
          let ax = (dx / dist) * pull;
          let ay = (dy / dist) * pull;
          // 소용돌이: 수직 방향 성분 추가
          const swirl = 90;
          ax += (-dy / dist) * swirl;
          ay += (dx / dist) * swirl;
          // 속도 갱신 (약간의 감쇠)
          vx[i] = vx[i] * 0.99 + ax * step;
          vy[i] = vy[i] * 0.99 + ay * step;
          px[i] += vx[i] * step;
          py[i] += vy[i] * step;
          // 가장자리 랩어라운드
          if (px[i] < 0) px[i] += w; else if (px[i] > w) px[i] -= w;
          if (py[i] < 0) py[i] += h; else if (py[i] > h) py[i] -= h;
          // 점 찍기 (fillRect가 arc보다 빠름)
          ctx.fillRect(px[i], py[i], 2, 2);
        }

        // 텍스트 정보 (배경 살짝 깔아 가독성 확보)
        ctx.fillStyle = "rgba(11,13,19,0.6)";
        ctx.fillRect(8, 8, 260, 40);
        G.text(ctx, `파티클: ${count.toLocaleString()}개  ·  FPS: ${fps.toFixed(0)}`,
          16, 22, G.COL.text, "13px 'JetBrains Mono', monospace");
        G.text(ctx, "모든 점이 동일한 규칙을 자기 데이터로 실행",
          16, 40, G.COL.dim, "11px 'JetBrains Mono', monospace");
      });

      // 리사이즈 시 파티클 위치 재초기화(범위 밖 방지)
      window.addEventListener("resize", function () {
        // 화면 밖으로 나간 것만 다시 뿌림
        const w = canvas._cssW, h = canvas._cssH;
        for (let i = 0; i < MAX; i++) {
          if (px[i] > w || py[i] > h) spawn(i, w, h);
        }
      });
    }

  // ---- 각 데모를 지연 초기화로 등록 (보이는 섹션만 init) ----
  G.deferInit("c-parallel", initParallel);
  G.deferInit("c-vertexshader", initVertexShader);
  G.deferInit("c-fragshader", initFragShader);
  G.deferInit("c-compute", initCompute);
})();
