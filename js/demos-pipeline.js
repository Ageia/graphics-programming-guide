/* ============================================================
   demos-pipeline.js — 캡스톤: 렌더 파이프라인 (RenderDoc 스타일)
   타임라인을 드래그하면 한 프레임이 패스 순서대로 만들어진다:
     Clear → Shadow Map → G-buffer(Albedo/Normal/Position)
     → Deferred Lighting → Bloom → Tonemap+Gamma
   실제 WebGL1 다중 패스(오프스크린 FBO) 렌더러. 실패 시 Canvas2D 폴백.
   전역 GFX(lib.js)의 M4/V/loop/slider/button 등을 사용.
   ============================================================ */
(function () {
  "use strict";
  const G = window.GFX;
  const M4 = G.M4, V = G.V, rad = G.rad, clamp = G.clamp;

  // 파이프라인 단계 정의(타임라인 t ∈ [0, N])
  const STAGES = [
    { key: "clear",    name: "Clear",              res: "Backbuffer",     desc: "컬러·깊이 버퍼를 지운다. 지난 프레임 흔적을 없애고 빈 캔버스에서 시작." },
    { key: "shadow",   name: "Shadow Map",         res: "shadowTex",      desc: "빛의 시점에서 씬을 렌더해 각 지점까지의 거리(깊이)를 기록. 나중에 그림자 판정에 쓴다." },
    { key: "albedo",   name: "G-buffer · Albedo",  res: "gAlbedo",        desc: "화면의 각 픽셀에 '재질 고유색'만 저장(조명 아직 없음). 지연 셰이딩의 첫 채널." },
    { key: "normal",   name: "G-buffer · Normal",  res: "gNormal",        desc: "각 픽셀의 표면 법선(월드 방향)을 저장. 조명 계산이 어느 쪽을 향하는지 알려준다." },
    { key: "position", name: "G-buffer · Position",res: "gPosition",      desc: "각 픽셀의 월드 좌표를 저장. 빛·카메라와의 거리/방향을 픽셀 단위로 복원." },
    { key: "light",    name: "Deferred Lighting",  res: "litTex",         desc: "G-buffer + 그림자맵을 읽어 픽셀마다 확산·스페큘러·그림자를 계산. 물체 수와 무관하게 조명당 1회." },
    { key: "bloom",    name: "Bloom",              res: "bloomTex",       desc: "밝은 부분만 추출→가우시안 블러→더하기. 빛이 번지는 광채를 얹는 포스트프로세스." },
    { key: "tonemap",  name: "Tonemap + Gamma",    res: "Backbuffer",     desc: "HDR 색을 ACES 곡선으로 눌러 0~1로 매핑하고 감마 보정. 최종 화면 색이 완성." },
  ];
  const N = STAGES.length; // 8

  function initPipeline() {
    const canvas = document.getElementById("c-pipeline");
    if (!canvas) return;
    const ctl = document.getElementById("ctl-pipeline");
    const readout = document.getElementById("r-pipeline");

    let gl = null;
    try {
      const opts = { antialias: true, alpha: false, preserveDrawingBuffer: false, depth: true };
      gl = canvas.getContext("webgl", opts) || canvas.getContext("experimental-webgl", opts);
    } catch (e) { gl = null; }

    if (!gl) { initFallback(canvas, ctl, readout); return; }
    try {
      initGL(canvas, gl, ctl, readout);
    } catch (e) {
      console.error("[demo] pipeline WebGL 실패, 폴백:", e);
      try { initFallback(canvas, ctl, readout); } catch (e2) { console.error(e2); }
    }
  }

  // ============================================================
  //  공유 타임라인 UI (WebGL/폴백 공통)
  // ============================================================
  function buildTimelineUI(ctl, state, onChange) {
    if (!ctl) return { syncSlider: function () {} };
    // 재생/일시정지 + 슬라이더
    const btn = G.button(ctl, "▶ 재생", function () {
      state.playing = !state.playing;
      btn.textContent = state.playing ? "⏸ 일시정지" : "▶ 재생";
    });
    const s = G.slider(ctl, {
      label: "타임라인 (파이프라인 패스)",
      min: 0, max: 1000, step: 1, value: 0,
      format: function () {
        const si = Math.min(N - 1, Math.floor(state.t));
        return (si + 1) + "/" + N + " " + STAGES[si].name;
      },
      onInput: function (v) {
        state.t = v / 1000 * N;
        state.playing = false;
        btn.textContent = "▶ 재생";
        if (onChange) onChange();
      },
    });
    // 단계 라벨 칩(클릭 시 점프)
    const chips = document.createElement("div");
    chips.className = "pipe-chips";
    STAGES.forEach(function (st, i) {
      const c = document.createElement("button");
      c.className = "pipe-chip";
      c.textContent = (i + 1) + ". " + st.name;
      c.addEventListener("click", function () {
        state.t = i + 0.999; // 해당 패스 완료 지점
        state.playing = false;
        btn.textContent = "▶ 재생";
        if (onChange) onChange();
      });
      chips.appendChild(c);
    });
    ctl.appendChild(chips);
    state._chips = chips.querySelectorAll(".pipe-chip");
    return {
      syncSlider: function () {
        s.set(state.t / N * 1000);
      },
    };
  }

  function activeStage(t) { return Math.min(N - 1, Math.floor(t)); }

  function highlightChip(state) {
    if (!state._chips) return;
    const si = activeStage(state.t);
    for (let i = 0; i < state._chips.length; i++) {
      state._chips[i].classList.toggle("on", i === si);
    }
  }

  function updateReadout(readout, state) {
    if (!readout) return;
    const si = activeStage(state.t);
    const st = STAGES[si];
    readout.innerHTML =
      '<span class="pipe-badge">PASS ' + (si + 1) + "/" + N + "</span> " +
      '<b style="color:var(--accent2)">' + st.name + "</b> " +
      '<span style="color:var(--text-dim)">→ ' + st.res + "</span><br>" +
      '<span style="color:var(--text-dim)">' + st.desc + "</span>";
  }

  // ============================================================
  //  WebGL 경로
  // ============================================================
  function initGL(canvas, gl, ctl, readout) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const baseH = parseInt(canvas.getAttribute("height")) || 480;
    const STRIP = 96; // 하단 썸네일 스트립 높이(css px)

    function sizeCanvas() {
      const cssW = canvas.clientWidth || (canvas.parentElement && canvas.parentElement.clientWidth) || 800;
      const cssH = baseH;
      canvas.style.height = cssH + "px";
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas._cssW = cssW; canvas._cssH = cssH;
      sizeOverlay();
      return { cssW, cssH };
    }

    // 텍스트 라벨용 2D 오버레이 캔버스(GL 위에 겹침)
    const overlay = document.createElement("canvas");
    overlay.className = "pipe-overlay";
    const parent = canvas.parentElement;
    if (parent && getComputedStyle(parent).position === "static") parent.style.position = "relative";
    // 캔버스 바로 뒤에 삽입
    if (canvas.nextSibling) parent.insertBefore(overlay, canvas.nextSibling);
    else parent.appendChild(overlay);
    const octx = overlay.getContext("2d");
    function sizeOverlay() {
      overlay.style.position = "absolute";
      overlay.style.left = canvas.offsetLeft + "px";
      overlay.style.top = canvas.offsetTop + "px";
      overlay.style.width = canvas._cssW + "px";
      overlay.style.height = canvas._cssH + "px";
      overlay.style.pointerEvents = "none";
      overlay.width = Math.round(canvas._cssW * dpr);
      overlay.height = Math.round(canvas._cssH * dpr);
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    sizeCanvas();
    window.addEventListener("resize", sizeCanvas);

    // ---- GL 헬퍼 ----
    function compile(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error("shader: " + gl.getShaderInfoLog(s) + "\n" + src);
      return s;
    }
    function program(vsrc, fsrc) {
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, vsrc));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsrc));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        throw new Error("link: " + gl.getProgramInfoLog(p));
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
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        throw new Error("framebuffer incomplete");
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { fb: fb, tex: tex, w: w, h: h, depth: depth };
    }

    // ---- 지오메트리 ----
    function makeSphere(seg) {
      const pos = [], nrm = [], idx = [];
      for (let y = 0; y <= seg; y++) {
        const v = y / seg, phi = v * Math.PI;
        for (let x = 0; x <= seg; x++) {
          const u = x / seg, th = u * Math.PI * 2;
          const nx = Math.sin(phi) * Math.cos(th), ny = Math.cos(phi), nz = Math.sin(phi) * Math.sin(th);
          pos.push(nx, ny, nz); nrm.push(nx, ny, nz);
        }
      }
      for (let y = 0; y < seg; y++)
        for (let x = 0; x < seg; x++) {
          const a = y * (seg + 1) + x, b = a + seg + 1;
          idx.push(a, b, a + 1, a + 1, b, b + 1);
        }
      return buildMesh(pos, nrm, idx);
    }
    function makeCube() {
      const p = [], n = [], idx = [];
      const faces = [
        [[ 1,0,0],[0,0,-1],[0,1,0]], [[-1,0,0],[0,0,1],[0,1,0]],
        [[0, 1,0],[1,0,0],[0,0,1]],  [[0,-1,0],[1,0,0],[0,0,-1]],
        [[0,0, 1],[1,0,0],[0,1,0]],  [[0,0,-1],[-1,0,0],[0,1,0]],
      ];
      faces.forEach(function (f) {
        const nrm = f[0], ax = f[1], ay = f[2];
        const base = p.length / 3;
        for (let j = 0; j < 4; j++) {
          const sx = (j === 1 || j === 2) ? 1 : -1;
          const sy = (j >= 2) ? 1 : -1;
          p.push(nrm[0] + ax[0] * sx + ay[0] * sy, nrm[1] + ax[1] * sx + ay[1] * sy, nrm[2] + ax[2] * sx + ay[2] * sy);
          n.push(nrm[0], nrm[1], nrm[2]);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      });
      return buildMesh(p, n, idx);
    }
    function makePlane() {
      const s = 6;
      const p = [-s, 0, -s, s, 0, -s, s, 0, s, -s, 0, s];
      const n = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
      const idx = [0, 1, 2, 0, 2, 3];
      return buildMesh(p, n, idx);
    }
    function buildMesh(pos, nrm, idx) {
      const pb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, pb);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
      const nb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, nb);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(nrm), gl.STATIC_DRAW);
      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
      return { pb: pb, nb: nb, ib: ib, count: idx.length };
    }

    const sphere = makeSphere(28), cube = makeCube(), plane = makePlane();

    // 씬 오브젝트
    const objs = [
      { mesh: plane,  model: M4.translate(0, -1.0, 0),                                  albedo: [0.38, 0.40, 0.46] },
      { mesh: sphere, model: M4.mul(M4.translate(-1.7, -0.3, 0.2), M4.scale(0.7,0.7,0.7)), albedo: [0.92, 0.28, 0.30] },
      { mesh: sphere, model: M4.mul(M4.translate(1.6, -0.35, -0.6), M4.scale(0.65,0.65,0.65)), albedo: [0.25, 0.55, 0.95] },
      { mesh: cube,   model: M4.mul(M4.translate(0.1, -0.35, 0.9), M4.scale(0.6,0.6,0.6)),  albedo: [0.95, 0.78, 0.28] },
      { mesh: sphere, model: M4.mul(M4.translate(0.2, 0.55, -0.2), M4.scale(0.5,0.5,0.5)), albedo: [0.55, 0.90, 0.55] },
    ];

    // ---- 셰이더 ----
    const V_SCENE =
      "attribute vec3 aPos; attribute vec3 aNormal;" +
      "uniform mat4 uModel,uView,uProj;" +
      "varying vec3 vWorld; varying vec3 vNormal;" +
      "void main(){ vec4 wp=uModel*vec4(aPos,1.0); vWorld=wp.xyz;" +
      " vNormal=mat3(uModel)*aNormal; gl_Position=uProj*uView*wp; }";
    const V_QUAD =
      "attribute vec2 aPos; varying vec2 vUv;" +
      "void main(){ vUv=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }";
    const POSSCALE = 8.0, LFAR = 22.0;

    const progShadow = program(V_SCENE,
      "precision highp float; varying vec3 vWorld; uniform vec3 uLightPos;" +
      "void main(){ float d=length(vWorld-uLightPos)/" + LFAR.toFixed(1) + ";" +
      " gl_FragColor=vec4(vec3(d),1.0); }");
    const progAlbedo = program(V_SCENE,
      "precision highp float; uniform vec3 uAlbedo;" +
      "void main(){ gl_FragColor=vec4(uAlbedo,1.0); }");
    const progNormal = program(V_SCENE,
      "precision highp float; varying vec3 vNormal;" +
      "void main(){ gl_FragColor=vec4(normalize(vNormal)*0.5+0.5,1.0); }");
    const progPosition = program(V_SCENE,
      "precision highp float; varying vec3 vWorld;" +
      "void main(){ gl_FragColor=vec4(vWorld/" + POSSCALE.toFixed(1) + "*0.5+0.5,1.0); }");

    const progLight = program(V_QUAD,
      "precision highp float; varying vec2 vUv;" +
      "uniform sampler2D uAlbedo,uNormal,uPosition,uShadow;" +
      "uniform vec3 uLightPos,uLightColor,uCamPos;" +
      "uniform mat4 uLightVP; uniform float uAmbient;" +
      "vec3 sky(vec2 uv){ return mix(vec3(0.09,0.11,0.17),vec3(0.16,0.22,0.36),uv.y); }" +
      "void main(){ vec4 a=texture2D(uAlbedo,vUv);" +
      " if(a.a<0.5){ gl_FragColor=vec4(sky(vUv),1.0); return; }" +
      " vec3 alb=a.rgb;" +
      " vec3 nS=texture2D(uNormal,vUv).rgb; vec3 N=normalize(nS*2.0-1.0);" +
      " vec3 wp=(texture2D(uPosition,vUv).rgb*2.0-1.0)*" + POSSCALE.toFixed(1) + ";" +
      " vec3 Ld=normalize(uLightPos-wp); float ndl=max(dot(N,Ld),0.0);" +
      " vec4 lc=uLightVP*vec4(wp,1.0); vec3 ndc=lc.xyz/lc.w; vec2 suv=ndc.xy*0.5+0.5;" +
      " float sh=1.0;" +
      " if(suv.x>0.0&&suv.x<1.0&&suv.y>0.0&&suv.y<1.0){" +
      "   float stored=texture2D(uShadow,suv).r*" + LFAR.toFixed(1) + ";" +
      "   float cur=length(wp-uLightPos); sh=cur>stored+0.18?0.0:1.0; }" +
      " vec3 Vv=normalize(uCamPos-wp); vec3 H=normalize(Ld+Vv);" +
      " float spec=pow(max(dot(N,H),0.0),56.0);" +
      " vec3 col=alb*uAmbient + sh*(alb*uLightColor*ndl + uLightColor*spec*0.55);" +
      " gl_FragColor=vec4(col,1.0); }");

    const progBright = program(V_QUAD,
      "precision highp float; varying vec2 vUv; uniform sampler2D uTex; uniform float uThr;" +
      "void main(){ vec3 c=texture2D(uTex,vUv).rgb; float l=dot(c,vec3(0.2126,0.7152,0.0722));" +
      " gl_FragColor=vec4(l>uThr?c:vec3(0.0),1.0); }");
    const progBlur = program(V_QUAD,
      "precision highp float; varying vec2 vUv; uniform sampler2D uTex; uniform vec2 uDir;" +
      "void main(){ vec3 s=vec3(0.0);" +
      " s+=texture2D(uTex,vUv).rgb*0.227;" +
      " s+=texture2D(uTex,vUv+uDir*1.0).rgb*0.194; s+=texture2D(uTex,vUv-uDir*1.0).rgb*0.194;" +
      " s+=texture2D(uTex,vUv+uDir*2.0).rgb*0.121; s+=texture2D(uTex,vUv-uDir*2.0).rgb*0.121;" +
      " s+=texture2D(uTex,vUv+uDir*3.0).rgb*0.054; s+=texture2D(uTex,vUv-uDir*3.0).rgb*0.054;" +
      " gl_FragColor=vec4(s,1.0); }");

    // present: 메인 뷰포트/썸네일에 텍스처를 그림. uMode로 표시 방식 선택.
    const progPresent = program(V_QUAD,
      "precision highp float; varying vec2 vUv;" +
      "uniform sampler2D uA,uB,uBloom; uniform float uMode,uMix,uBloomAmt,uFade;" +
      "vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0); }" +
      "void main(){ vec3 o;" +
      " if(uMode<0.5){ o=texture2D(uA,vUv).rgb*uFade; }" +               // 0: raw
      " else if(uMode<1.5){ o=mix(texture2D(uA,vUv).rgb,texture2D(uB,vUv).rgb,uMix); }" + // 1: albedo→lit
      " else if(uMode<2.5){ o=texture2D(uB,vUv).rgb+texture2D(uBloom,vUv).rgb*uBloomAmt*uMix; }" + // 2: +bloom
      " else { vec3 c=texture2D(uB,vUv).rgb+texture2D(uBloom,vUv).rgb*uBloomAmt;" +      // 3: tonemap+gamma
      "        vec3 t=aces(c); o=mix(c,pow(t,vec3(1.0/2.2)),uMix); }" +
      " gl_FragColor=vec4(o,1.0); }");

    // 풀스크린 쿼드
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);

    // 렌더 타겟
    const RW = 640, RH = 360, SW = 512, BW = 320, BH = 180;
    const shadowT = target(SW, SW, true, gl.LINEAR);
    const gAlb = target(RW, RH, true);
    const gNrm = target(RW, RH, true);
    const gPos = target(RW, RH, true);
    const litT = target(RW, RH, false);
    const brightT = target(BW, BH, false);
    const blurA = target(BW, BH, false);
    const blurB = target(BW, BH, false);

    // 씬 draw 헬퍼
    function bindSceneAttribs(prog) {
      const pl = gl.getAttribLocation(prog, "aPos");
      const nl = gl.getAttribLocation(prog, "aNormal");
      return { pl: pl, nl: nl };
    }
    function drawMesh(prog, locs, mesh) {
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.pb);
      gl.enableVertexAttribArray(locs.pl);
      gl.vertexAttribPointer(locs.pl, 3, gl.FLOAT, false, 0, 0);
      if (locs.nl >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.nb);
        gl.enableVertexAttribArray(locs.nl);
        gl.vertexAttribPointer(locs.nl, 3, gl.FLOAT, false, 0, 0);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ib);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
    }
    function scenePass(prog, tgt, view, proj, setPerObj, clearCol) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, tgt.fb);
      gl.viewport(0, 0, tgt.w, tgt.h);
      gl.clearColor(clearCol[0], clearCol[1], clearCol[2], clearCol[3]);
      gl.enable(gl.DEPTH_TEST);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(prog);
      const locs = bindSceneAttribs(prog);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, "uView"), false, view);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, "uProj"), false, proj);
      const uModel = gl.getUniformLocation(prog, "uModel");
      objs.forEach(function (o) {
        gl.uniformMatrix4fv(uModel, false, o.model);
        if (setPerObj) setPerObj(prog, o);
        drawMesh(prog, locs, o.mesh);
      });
    }
    function fsPass(prog, tgt, setUniforms) {
      if (tgt) { gl.bindFramebuffer(gl.FRAMEBUFFER, tgt.fb); gl.viewport(0, 0, tgt.w, tgt.h); }
      gl.useProgram(prog);
      gl.disable(gl.DEPTH_TEST);
      const pl = gl.getAttribLocation(prog, "aPos");
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(pl);
      gl.vertexAttribPointer(pl, 2, gl.FLOAT, false, 0, 0);
      if (setUniforms) setUniforms(prog);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    function bindTex(prog, name, tex, unit) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(gl.getUniformLocation(prog, name), unit);
    }

    // 상태
    const state = { t: 0, playing: true, orbit: { rx: 0.35, ry: 0.6 }, dragging: false, _chips: null };
    G.orbitControl(canvas, state.orbit);
    canvas.addEventListener("mousedown", function () { state.dragging = true; });
    window.addEventListener("mouseup", function () { state.dragging = false; });

    const ui = buildTimelineUI(ctl, state, function () { /* 즉시 반영은 루프가 */ });

    let auto = 0;
    const sky = [0.10, 0.13, 0.20];

    function render(dt) {
      if (state.playing) {
        state.t += dt * 1.05; // 초당 ~1패스
        if (state.t >= N + 0.6) state.t = 0;
        ui.syncSlider();
      }
      if (!state.dragging) auto += dt * 0.25;

      // 카메라
      const aspect = RW / RH;
      const camModel = M4.mul(M4.rotX(state.orbit.rx), M4.rotY(state.orbit.ry + auto));
      const eye = mulPoint(inverseRot(camModel), [0, 0.6, 6.2]); // 회전된 카메라 위치
      const vmat = M4.lookAt(eye, [0, -0.1, 0], [0, 1, 0]);
      const proj = M4.perspective(rad(45), aspect, 0.1, 100);

      // 조명(천천히 도는 포인트 라이트)
      const la = auto * 0.6 + 0.8;
      const lightPos = [Math.cos(la) * 4.5, 5.0, Math.sin(la) * 4.5];
      const lightColor = [1.25, 1.15, 0.95];
      const lightView = M4.lookAt(lightPos, [0, -0.3, 0], [0, 1, 0]);
      const lightProj = M4.perspective(rad(70), 1, 0.5, LFAR);
      const lightVP = M4.mul(lightProj, lightView);

      // ---- 모든 패스를 FBO에 완전 렌더(썸네일/조명용) ----
      // 1) Shadow
      scenePass(progShadow, shadowT, lightView, lightProj, function (p) {
        gl.uniform3fv(gl.getUniformLocation(p, "uLightPos"), lightPos);
      }, [1, 1, 1, 1]);
      // 2) G-buffer
      scenePass(progAlbedo, gAlb, vmat, proj, function (p, o) {
        gl.uniform3fv(gl.getUniformLocation(p, "uAlbedo"), o.albedo);
      }, [sky[0], sky[1], sky[2], 0]);
      scenePass(progNormal, gNrm, vmat, proj, null, [0.5, 0.5, 1.0, 0]);
      scenePass(progPosition, gPos, vmat, proj, null, [0.5, 0.5, 0.5, 0]);
      // 3) Lighting
      fsPass(progLight, litT, function (p) {
        bindTex(p, "uAlbedo", gAlb.tex, 0);
        bindTex(p, "uNormal", gNrm.tex, 1);
        bindTex(p, "uPosition", gPos.tex, 2);
        bindTex(p, "uShadow", shadowT.tex, 3);
        gl.uniform3fv(gl.getUniformLocation(p, "uLightPos"), lightPos);
        gl.uniform3fv(gl.getUniformLocation(p, "uLightColor"), lightColor);
        gl.uniform3fv(gl.getUniformLocation(p, "uCamPos"), eye);
        gl.uniformMatrix4fv(gl.getUniformLocation(p, "uLightVP"), false, lightVP);
        gl.uniform1f(gl.getUniformLocation(p, "uAmbient"), 0.22);
      });
      // 4) Bloom: bright → blur H → blur V
      fsPass(progBright, brightT, function (p) {
        bindTex(p, "uTex", litT.tex, 0);
        gl.uniform1f(gl.getUniformLocation(p, "uThr"), 0.72);
      });
      fsPass(progBlur, blurA, function (p) {
        bindTex(p, "uTex", brightT.tex, 0);
        gl.uniform2f(gl.getUniformLocation(p, "uDir"), 1.0 / BW, 0);
      });
      fsPass(progBlur, blurB, function (p) {
        bindTex(p, "uTex", blurA.tex, 0);
        gl.uniform2f(gl.getUniformLocation(p, "uDir"), 0, 1.0 / BH);
      });

      // ---- 메인 뷰포트: 스크럽 위치의 활성 렌더타겟 ----
      const si = activeStage(state.t);
      const frac = clamp(state.t - si, 0, 1);
      const cssW = canvas._cssW, cssH = canvas._cssH;
      const mainH = cssH - STRIP;
      const mainY = Math.round(STRIP * dpr);
      const mainVW = Math.round(cssW * dpr), mainVH = Math.round(mainH * dpr);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.enable(gl.SCISSOR_TEST);
      gl.viewport(0, mainY, mainVW, mainVH);
      gl.scissor(0, mainY, mainVW, mainVH);
      gl.clearColor(0.02, 0.02, 0.03, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      presentStage(si, frac);

      // ---- 하단 썸네일 스트립 ----
      gl.scissor(0, 0, Math.round(cssW * dpr), Math.round(STRIP * dpr));
      gl.clearColor(0.04, 0.04, 0.055, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const thumbs = [
        { tex: shadowT.tex, stage: 1 }, { tex: gAlb.tex, stage: 2 },
        { tex: gNrm.tex, stage: 3 }, { tex: gPos.tex, stage: 4 },
        { tex: litT.tex, stage: 5 }, { tex: blurB.tex, stage: 6 },
      ];
      const pad = 10, gap = 8, labelH = 20;
      const tw = (cssW - pad * 2 - gap * (thumbs.length - 1)) / thumbs.length;
      const th = STRIP - labelH - pad;
      const rects = [];
      thumbs.forEach(function (t, i) {
        const x = pad + i * (tw + gap);
        const y = pad; // css top within strip
        // GL 좌표(하단 원점): 스트립은 캔버스 하단부. y_gl = (STRIP - y - th)
        const glx = Math.round(x * dpr);
        const gly = Math.round((STRIP - y - th) * dpr);
        gl.viewport(glx, gly, Math.round(tw * dpr), Math.round(th * dpr));
        gl.scissor(glx, gly, Math.round(tw * dpr), Math.round(th * dpr));
        fsPass(progPresent, null, function (p) {
          gl.uniform1f(gl.getUniformLocation(p, "uMode"), 0);
          gl.uniform1f(gl.getUniformLocation(p, "uFade"), 1);
          bindTex(p, "uA", t.tex, 0);
        });
        rects.push({ x: x, y: cssH - STRIP + y, w: tw, h: th, stage: t.stage });
      });
      gl.disable(gl.SCISSOR_TEST);

      drawOverlay(rects, si);
      highlightChip(state);
      updateReadout(readout, state);
    }

    function presentStage(si, frac) {
      const key = STAGES[si].key;
      if (key === "clear") {
        // 빈(지워진) 버퍼: 아무것도 그리지 않고 어두운 클리어 그대로 둔다.
        return;
      }
      const rawTex = { shadow: shadowT.tex, albedo: gAlb.tex, normal: gNrm.tex, position: gPos.tex }[key];
      if (rawTex) {
        fsPass(progPresent, null, function (p) {
          gl.uniform1f(gl.getUniformLocation(p, "uMode"), 0);
          gl.uniform1f(gl.getUniformLocation(p, "uFade"), 1);
          bindTex(p, "uA", rawTex, 0);
        });
        return;
      }
      if (key === "light") {
        fsPass(progPresent, null, function (p) {
          gl.uniform1f(gl.getUniformLocation(p, "uMode"), 1);
          gl.uniform1f(gl.getUniformLocation(p, "uMix"), frac);
          bindTex(p, "uA", gAlb.tex, 0);
          bindTex(p, "uB", litT.tex, 1);
        });
        return;
      }
      if (key === "bloom") {
        fsPass(progPresent, null, function (p) {
          gl.uniform1f(gl.getUniformLocation(p, "uMode"), 2);
          gl.uniform1f(gl.getUniformLocation(p, "uMix"), frac);
          gl.uniform1f(gl.getUniformLocation(p, "uBloomAmt"), 1.1);
          bindTex(p, "uB", litT.tex, 1);
          bindTex(p, "uBloom", blurB.tex, 2);
        });
        return;
      }
      // tonemap
      fsPass(progPresent, null, function (p) {
        gl.uniform1f(gl.getUniformLocation(p, "uMode"), 3);
        gl.uniform1f(gl.getUniformLocation(p, "uMix"), frac);
        gl.uniform1f(gl.getUniformLocation(p, "uBloomAmt"), 1.1);
        bindTex(p, "uB", litT.tex, 1);
        bindTex(p, "uBloom", blurB.tex, 2);
      });
    }

    function drawOverlay(rects, si) {
      const w = canvas._cssW, h = canvas._cssH;
      octx.clearRect(0, 0, w, h);
      // 메인 캡션
      const st = STAGES[si];
      octx.font = "600 15px system-ui, sans-serif";
      octx.fillStyle = "rgba(0,0,0,0.45)";
      octx.fillRect(12, 12, octx.measureText((si + 1) + " / " + N + "  " + st.name).width + 24, 30);
      octx.fillStyle = "#eaf0ff";
      octx.fillText((si + 1) + " / " + N + "  " + st.name, 24, 32);
      // 진행 막대
      const barW = w - 24, bx = 12, by = h - STRIP - 8;
      octx.fillStyle = "rgba(255,255,255,0.12)";
      octx.fillRect(bx, by, barW, 3);
      octx.fillStyle = "#6ea8fe";
      octx.fillRect(bx, by, barW * (state.t / N), 3);
      // 썸네일 라벨 + 활성 하이라이트
      const labels = ["Shadow", "Albedo", "Normal", "Position", "Lit", "Bloom"];
      rects.forEach(function (r, i) {
        const active = (r.stage === si);
        const pending = (r.stage > si); // 아직 실행 안 된 패스는 어둡게
        if (pending) { octx.fillStyle = "rgba(6,7,10,0.68)"; octx.fillRect(r.x, r.y, r.w, r.h); }
        octx.strokeStyle = active ? "#ffd166" : "rgba(255,255,255,0.18)";
        octx.lineWidth = active ? 2 : 1;
        octx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
        octx.font = active ? "700 11px system-ui, sans-serif" : "500 11px system-ui, sans-serif";
        octx.fillStyle = active ? "#ffd166" : (pending ? "rgba(200,205,215,0.4)" : "rgba(220,225,235,0.78)");
        octx.fillText(labels[i], r.x + 2, r.y + r.h + 14);
      });
    }

    // 초기 1회 강제 그리기
    G.loop(render, canvas);

    // ---- 작은 수학 헬퍼(카메라 위치용) ----
    function inverseRot(m) {
      // 회전 전용 행렬의 전치(=역행렬)
      return [
        m[0], m[4], m[8], 0,
        m[1], m[5], m[9], 0,
        m[2], m[6], m[10], 0,
        0, 0, 0, 1,
      ];
    }
    function mulPoint(m, p) {
      const r = M4.apply(m, p);
      return [r.x, r.y, r.z];
    }
  }

  // ============================================================
  //  Canvas2D 폴백 — 단계별 정적 일러스트 + 동일 타임라인
  // ============================================================
  function initFallback(canvas, ctl, readout) {
    const S = G.setup(canvas.id);
    const state = { t: 0, playing: true, _chips: null };
    const ui = buildTimelineUI(ctl, state, null);

    function draw(dt) {
      if (state.playing) { state.t += dt * 1.05; if (state.t >= N + 0.6) state.t = 0; ui.syncSlider(); }
      const w = S.w, h = S.h, ctx = S.ctx;
      if (!w) return;
      G.clear(ctx, w, h);
      const si = activeStage(state.t);
      const frac = clamp(state.t - si, 0, 1);
      // 간단한 씬: 하늘 그라디언트 + 바닥 + 원 3개
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#1a2740"); g.addColorStop(1, "#0c1018");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      const cx = w / 2, gy = h * 0.7;
      const balls = [
        { x: cx - 120, y: gy - 30, r: 46, c: [235, 72, 76] },
        { x: cx + 110, y: gy - 20, r: 40, c: [64, 140, 242] },
        { x: cx + 6, y: gy - 70, r: 32, c: [242, 200, 72] },
      ];
      function drawScene(mode) {
        // mode: albedo|normal|lit
        ctx.fillStyle = "#20242e"; ctx.fillRect(0, gy, w, h - gy);
        balls.forEach(function (b) {
          const grd = ctx.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.1, b.x, b.y, b.r);
          let col;
          if (mode === "albedo") col = "rgb(" + b.c.join(",") + ")";
          else if (mode === "normal") col = "#8080ff";
          else col = "rgb(" + b.c.join(",") + ")";
          if (mode === "lit") {
            grd.addColorStop(0, "rgba(255,255,255,0.9)");
            grd.addColorStop(0.4, col);
            grd.addColorStop(1, "rgba(0,0,0,0.6)");
            ctx.fillStyle = grd;
          } else ctx.fillStyle = col;
          ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
        });
      }
      const key = STAGES[si].key;
      if (key === "clear") { /* 배경만 */ }
      else if (key === "shadow") {
        balls.forEach(function (b) {
          ctx.fillStyle = "rgba(0,0,0,0.5)";
          ctx.beginPath(); ctx.ellipse(b.x + 40, gy + 10, b.r * 1.1, b.r * 0.35, 0, 0, Math.PI * 2); ctx.fill();
        });
      } else if (key === "albedo") drawScene("albedo");
      else if (key === "normal") drawScene("normal");
      else if (key === "position") {
        balls.forEach(function (b) {
          const grd = ctx.createLinearGradient(b.x - b.r, b.y - b.r, b.x + b.r, b.y + b.r);
          grd.addColorStop(0, "#334"); grd.addColorStop(1, "#cc9");
          ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
        });
      } else if (key === "light") { drawScene("lit"); }
      else if (key === "bloom") { drawScene("lit"); ctx.globalCompositeOperation = "lighter"; drawScene("lit"); ctx.globalCompositeOperation = "source-over"; }
      else { drawScene("lit"); ctx.fillStyle = "rgba(255,220,180," + (0.12 * frac) + ")"; ctx.fillRect(0, 0, w, h); }

      G.text(ctx, (si + 1) + " / " + N + "  " + STAGES[si].name, 16, 26, "#eaf0ff", "600 15px system-ui, sans-serif");
      highlightChip(state);
      updateReadout(readout, state);
    }
    G.loop(draw, canvas);
  }

  G.deferInit("c-pipeline", initPipeline);
})();
