/* ============================================================
   demos-api.js — #api-overview 데모
   그래픽스 API 5종(OpenGL / DirectX 12 / Vulkan / Metal / WebGPU)을
   (A) 추상화↔제어권 산점도, (B) 코드량 막대그래프로 비교한다.
   전역 GFX(lib.js)를 사용한다. 순수 바닐라 JS.
   ============================================================ */
window.GFX.deferInit("c-apichart", function initApiChart() {
  try {
    // 대상 캔버스가 없으면 조용히 종료
    if (!document.getElementById("c-apichart")) return;

    var GFX = window.GFX;
    var COL = GFX.COL;

    // ---- 데이터 -------------------------------------------------
    // abst  : 추상화 수준(0=매우 낮음/저수준 ~ 1=매우 높음/자동)
    // ctrl  : 개발자 제어권(0=낮음 ~ 1=완전 제어)
    // loc   : 삼각형 하나 띄우기에 필요한 대략적 코드 라인 수(교육용 근사치)
    var APIS = [
      { name: "OpenGL",      abst: 0.80, ctrl: 0.30, loc: 60,   color: COL.green,
        platform: "크로스플랫폼",        note: "원리 학습·프로토타이핑에 최적, 자료 풍부" },
      { name: "WebGPU",      abst: 0.55, ctrl: 0.50, loc: 200,  color: COL.cyan,
        platform: "웹 브라우저",         note: "웹 GPU, WebGL의 후계" },
      { name: "Metal",       abst: 0.50, ctrl: 0.65, loc: 300,  color: COL.purple,
        platform: "Apple(macOS/iOS)",    note: "애플 플랫폼 전용 최적화" },
      { name: "DirectX 12",  abst: 0.20, ctrl: 0.85, loc: 900,  color: COL.accent,
        platform: "Windows·Xbox",        note: "Windows 게임·엔진, 최대 성능" },
      { name: "Vulkan",      abst: 0.08, ctrl: 0.97, loc: 1000, color: COL.red,
        platform: "Win/Linux/Android",   note: "저수준 제어·멀티스레드, 이식성" },
    ];
    var MAX_LOC = 1000;

    // ---- 셋업 ---------------------------------------------------
    var S = GFX.setup("c-apichart");
    var canvas = S.canvas, ctx = S.ctx;

    // 상태: 표시 모드와 마우스가 올라간 API 인덱스
    var mode = "both";      // "both" | "scatter" | "bars"
    var hover = -1;         // 산점도 점 호버 인덱스
    var mouse = { x: -1, y: -1 };
    // 그려진 점 위치 캐시(히트 테스트용, 화면 픽셀)
    var dots = [];

    // ---- 컨트롤 -------------------------------------------------
    var ctl = document.getElementById("ctl-apichart");
    if (ctl) {
      GFX.button(ctl, "둘 다 보기", function () { mode = "both"; draw(); });
      GFX.button(ctl, "산점도만", function () { mode = "scatter"; draw(); }, true);
      GFX.button(ctl, "코드량 막대만", function () { mode = "bars"; draw(); }, true);
    }

    // ---- 마우스 처리(호버 툴팁) --------------------------------
    // clientX/Y -> 캔버스 로컬 좌표(CSS 픽셀)로 변환
    function toLocal(e) {
      var r = canvas.getBoundingClientRect();
      var t = e.touches ? e.touches[0] : e;
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    }
    canvas.addEventListener("mousemove", function (e) {
      mouse = toLocal(e);
      var h = hitDot(mouse.x, mouse.y);
      if (h !== hover) { hover = h; canvas.style.cursor = h >= 0 ? "pointer" : "default"; draw(); }
      else if (h >= 0) { draw(); } // 툴팁이 커서를 따라오도록 갱신
    });
    canvas.addEventListener("mouseleave", function () {
      mouse = { x: -1, y: -1 };
      if (hover !== -1) { hover = -1; draw(); }
    });

    function hitDot(x, y) {
      for (var i = dots.length - 1; i >= 0; i--) {
        var d = dots[i];
        if (Math.hypot(d.x - x, d.y - y) < d.r + 6) return d.idx;
      }
      return -1;
    }

    // 리사이즈 시 재드로우
    var _resize = S.onResize;
    window.addEventListener("resize", function () { _resize(); draw(); });

    // ---- 그리기 -------------------------------------------------
    function draw() {
      var w = S.w, h = S.h;
      GFX.clear(ctx, w, h, COL.bg);
      dots = [];

      // 영역 배분: both면 상단 산점도 / 하단 막대
      if (mode === "scatter") {
        drawScatter(0, 0, w, h);
      } else if (mode === "bars") {
        drawBars(0, 0, w, h);
      } else {
        var splitY = Math.round(h * 0.58);
        drawScatter(0, 0, w, splitY);
        GFX.line(ctx, 12, splitY, w - 12, splitY, COL.grid, 1);
        drawBars(0, splitY, w, h - splitY);
      }

      // 툴팁은 항상 맨 위에
      if (hover >= 0) drawTooltip(APIS[hover]);
    }

    // (A) 산점도: X=추상화(오른쪽이 높음/자동), Y=제어권(위가 높음/완전제어)
    function drawScatter(x0, y0, ww, hh) {
      var padL = 62, padR = 150, padT = 30, padB = 40;
      var px = x0 + padL, py = y0 + padT;
      var pw = ww - padL - padR, ph = hh - padT - padB;
      if (pw < 40 || ph < 40) return;

      GFX.text(ctx, "추상화 수준 ↔ 제어권", x0 + 12, y0 + 14, COL.text, "bold 13px sans-serif");

      // 격자 + 축
      ctx.save();
      for (var g = 0; g <= 4; g++) {
        var gx = px + (pw * g) / 4;
        var gy = py + (ph * g) / 4;
        GFX.line(ctx, gx, py, gx, py + ph, COL.grid, 1);
        GFX.line(ctx, px, gy, px + pw, gy, COL.grid, 1);
      }
      // 테두리 축
      GFX.line(ctx, px, py + ph, px + pw, py + ph, COL.gridAxis, 1.5); // X축
      GFX.line(ctx, px, py, px, py + ph, COL.gridAxis, 1.5);           // Y축
      ctx.restore();

      // 축 라벨(한글)
      GFX.text(ctx, "저수준·완전제어", px, py + ph + 22, COL.dim, "11px sans-serif", "left");
      GFX.text(ctx, "고수준·자동", px + pw, py + ph + 22, COL.dim, "11px sans-serif", "right");
      GFX.text(ctx, "X축: 추상화(→ 쉬움/자동)", px + pw / 2, py + ph + 22, COL.dim, "11px sans-serif", "center");
      // Y축 라벨(세로 텍스트)
      ctx.save();
      ctx.translate(x0 + 16, py + ph / 2);
      ctx.rotate(-Math.PI / 2);
      GFX.text(ctx, "제어권(↑ 완전제어)", 0, 0, COL.dim, "11px sans-serif", "center");
      ctx.restore();

      // 좌표 변환: abst 0..1 -> x(왼→오 증가), ctrl 0..1 -> y(아래→위)
      function sx(a) { return px + a * pw; }
      function sy(c) { return py + ph - c * ph; }

      // 점 그리기
      for (var i = 0; i < APIS.length; i++) {
        var d = APIS[i];
        var cx = sx(d.abst), cy = sy(d.ctrl);
        var r = (i === hover) ? 9 : 6.5;
        // 호버 강조 링
        if (i === hover) {
          ctx.strokeStyle = "rgba(255,255,255,0.5)";
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(cx, cy, r + 4, 0, Math.PI * 2); ctx.stroke();
        }
        GFX.dot(ctx, cx, cy, r, d.color);
        // 라벨(겹침 최소화를 위해 점 오른쪽 위)
        GFX.text(ctx, d.name, cx + r + 5, cy - 1,
                 (i === hover) ? COL.text : COL.dim, "bold 12px sans-serif", "left");
        dots.push({ x: cx, y: cy, r: r, idx: i });
      }

      // 범례(우측)
      drawLegend(px + pw + 16, py + 4);
    }

    function drawLegend(lx, ly) {
      GFX.text(ctx, "범례", lx, ly, COL.dim, "bold 11px sans-serif", "left");
      for (var i = 0; i < APIS.length; i++) {
        var yy = ly + 18 + i * 20;
        GFX.dot(ctx, lx + 6, yy, 5, APIS[i].color);
        GFX.text(ctx, APIS[i].name, lx + 18, yy, COL.text, "12px sans-serif", "left");
      }
    }

    // (B) 막대그래프: 코드량(LOC) 비교
    function drawBars(x0, y0, ww, hh) {
      var padL = 92, padR = 60, padT = 30, padB = 14;
      var bx = x0 + padL, by = y0 + padT;
      var bw = ww - padL - padR, bh = hh - padT - padB;
      if (bw < 40 || bh < 30) return;

      GFX.text(ctx, "삼각형 하나 띄우기에 필요한 대략적 코드량 (라인 수)",
               x0 + 12, y0 + 14, COL.text, "bold 13px sans-serif");

      var n = APIS.length;
      var slot = bh / n;
      var barH = Math.min(24, slot * 0.6);

      for (var i = 0; i < n; i++) {
        var d = APIS[i];
        var cy = by + slot * i + slot / 2;
        var len = (d.loc / MAX_LOC) * bw;
        // 배경 트랙
        ctx.fillStyle = COL.grid;
        ctx.fillRect(bx, cy - barH / 2, bw, barH);
        // 실제 막대
        ctx.fillStyle = d.color;
        ctx.fillRect(bx, cy - barH / 2, Math.max(2, len), barH);
        // API 이름(왼쪽)
        GFX.text(ctx, d.name, bx - 8, cy, COL.text, "12px sans-serif", "right");
        // 수치(막대 끝)
        GFX.text(ctx, "~" + d.loc, bx + Math.max(2, len) + 6, cy, COL.dim, "bold 12px sans-serif", "left");
      }
    }

    // ---- 툴팁 박스 ----------------------------------------------
    function drawTooltip(d) {
      var pad = 10, lh = 18;
      var lines = [
        { t: d.name, c: d.color, f: "bold 13px sans-serif" },
        { t: "플랫폼: " + d.platform, c: COL.dim, f: "12px sans-serif" },
        { t: d.note, c: COL.text, f: "12px sans-serif" },
      ];
      // 폭 측정
      var maxW = 0;
      for (var i = 0; i < lines.length; i++) {
        ctx.font = lines[i].f;
        maxW = Math.max(maxW, ctx.measureText(lines[i].t).width);
      }
      var boxW = maxW + pad * 2;
      var boxH = lines.length * lh + pad * 2 - 4;

      // 위치: 커서 오른쪽 아래, 화면 밖으로 안 나가게 보정
      var tx = mouse.x + 14, ty = mouse.y + 14;
      if (tx + boxW > S.w) tx = mouse.x - boxW - 14;
      if (ty + boxH > S.h) ty = mouse.y - boxH - 14;
      if (tx < 4) tx = 4;
      if (ty < 4) ty = 4;

      // 배경
      ctx.fillStyle = "rgba(12,15,24,0.96)";
      ctx.strokeStyle = d.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(tx, ty, boxW, boxH, 6);
      else ctx.rect(tx, ty, boxW, boxH);
      ctx.fill(); ctx.stroke();

      // 텍스트
      for (var j = 0; j < lines.length; j++) {
        GFX.text(ctx, lines[j].t, tx + pad, ty + pad + j * lh + 6, lines[j].c, lines[j].f, "left");
      }
    }

    // 최초 렌더
    draw();
  } catch (err) {
    // 데모 실패가 페이지 전체를 막지 않도록 콘솔에만 기록
    if (window.console) console.error("demos-api.js 오류:", err);
  }
});
