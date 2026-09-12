/* ============================================================
   demos-adv4.js — 고급 렌더링 데모 4
   1) 투명도와 정렬 (Transparency & Order)
   2) 앰비언트 오클루전 (Ambient Occlusion)
   3) LOD & 컬링 (Level of Detail & Culling)
   전역 GFX 헬퍼를 사용한다.
   ============================================================ */
(function () {
  "use strict";
  const G = window.GFX;

  document.addEventListener("DOMContentLoaded", function () {
    initTransparency();
    initAO();
    initLOD();
  });

  /* ==========================================================
     1) 투명도와 정렬
     반투명 카드 3장을 서로 다른 깊이(z)에 놓고,
     알파 블렌딩이 뒤→앞 정렬을 필요로 함을 보인다.
     - 정렬 O : 깊이순(뒤→앞)으로 그려 색이 올바르게 섞임
     - 정렬 X : 고정된 잘못된 순서로 그려 겹침 색이 틀림
     ========================================================== */
  function initTransparency() {
    if (!document.getElementById("c-transparency")) return;
    try {
      const S = G.setup("c-transparency");
      const ctl = document.getElementById("ctl-transparency");
      const ctx = S.ctx;

      // 카드 정의: base 색(rgb), 기본 깊이 z (클수록 뒤쪽=멀다)
      const cards = [
        { name: "빨강", rgb: [255, 90, 90], z: 3, dx: -60 },
        { name: "초록", rgb: [90, 210, 120], z: 2, dx: 0 },
        { name: "파랑", rgb: [90, 150, 255], z: 1, dx: 60 },
      ];

      let sorted = true;   // 깊이 정렬 on/off
      let alpha = 0.55;    // 카드 알파
      let midZ = 2;        // 가운데(초록) 카드 깊이

      G.checkbox(ctl, "깊이 정렬(뒤→앞)", sorted, (v) => { sorted = v; draw(); });
      G.slider(ctl, {
        label: "가운데 카드 깊이 z", min: 0.2, max: 3.8, step: 0.1, value: midZ,
        format: (v) => (+v).toFixed(1),
        onInput: (v) => { midZ = v; draw(); },
      });
      G.slider(ctl, {
        label: "알파(투명도)", min: 0.15, max: 0.9, step: 0.05, value: alpha,
        format: (v) => (+v).toFixed(2),
        onInput: (v) => { alpha = v; draw(); },
      });

      // 두 패널을 나란히: 좌 = 정렬 결과, 우 = 참고용(항상 올바른 정렬)
      // 단, 사용자가 정렬 체크박스를 끄면 좌측이 "정렬 X" 상태가 된다.

      // 하나의 사각형을 아이소메트릭 느낌으로 그린다.
      function cardRect(cx, cy) {
        const w = 130, h = 150;
        return { x0: cx - w / 2, y0: cy - h / 2, w, h };
      }

      // 한 카드 그리기 (수동 알파 합성 대신 globalAlpha + 명시적 순서)
      function drawCard(c, cx, cy, a) {
        const r = cardRect(cx, cy);
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = `rgb(${c.rgb[0]},${c.rgb[1]},${c.rgb[2]})`;
        roundRect(ctx, r.x0, r.y0, r.w, r.h, 12);
        ctx.fill();
        ctx.restore();
        // 테두리 + 라벨(불투명)
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 1.5;
        roundRect(ctx, r.x0, r.y0, r.w, r.h, 12);
        ctx.stroke();
        G.text(ctx, c.name, cx, r.y0 + 14, "rgba(255,255,255,0.9)",
          "bold 12px sans-serif", "center");
        G.text(ctx, "z=" + c.z.toFixed(1), cx, r.y0 + 30, "rgba(255,255,255,0.75)",
          "11px monospace", "center");
      }

      // 한 패널 렌더: doSort=true면 뒤→앞 정렬, false면 잘못된 고정순서
      function drawPanel(px, py, doSort, title) {
        // 현재 카드 상태 복제 (가운데 깊이 반영)
        const list = cards.map((c) => Object.assign({}, c));
        list[1].z = midZ;

        // 그릴 순서 결정
        let order;
        if (doSort) {
          // 뒤(큰 z)부터 앞(작은 z)으로: z 내림차순
          order = list.slice().sort((a, b) => b.z - a.z);
        } else {
          // 잘못된 고정 순서: 정의된 배열 순서 그대로 (빨강,초록,파랑)
          // -> 깊이와 무관하므로 겹침 색이 틀리게 나온다.
          order = list.slice();
        }

        order.forEach((c) => {
          drawCard(c, px + c.dx, py, alpha);
        });

        // 라벨
        const tagOK = doSort;
        const tag = tagOK ? "정렬 O" : "정렬 X";
        const tagCol = tagOK ? G.COL.green : G.COL.red;
        G.text(ctx, title, px, py - 105, G.COL.text, "bold 13px sans-serif", "center");
        G.text(ctx, tag, px, py + 105, tagCol, "bold 15px sans-serif", "center");
      }

      function draw() {
        G.clear(ctx, S.w, S.h);
        const cxL = S.w * 0.28;
        const cxR = S.w * 0.72;
        const cy = S.h * 0.46;

        // 좌: 사용자 설정에 따른 결과
        drawPanel(cxL, cy, sorted, sorted ? "정렬 켜짐" : "정렬 꺼짐");
        // 우: 항상 올바른 정렬(비교 기준)
        drawPanel(cxR, cy, true, "올바른 결과(기준)");

        // 구분선
        G.line(ctx, S.w * 0.5, 30, S.w * 0.5, S.h - 40, G.COL.grid, 1, [4, 4]);

        // 설명
        const note = sorted
          ? "정렬 O: 뒤→앞 순서로 블렌딩 → 겹침 색이 올바름"
          : "정렬 X: 깊이 무시하고 그림 → 겹침 색이 틀림 (좌우 비교)";
        G.text(ctx, note, S.w / 2, S.h - 18, sorted ? G.COL.green : G.COL.red,
          "12px sans-serif", "center");
        G.text(ctx, "불투명은 Z-buffer로 해결되지만, 반투명은 반드시 정렬이 필요하다.",
          S.w / 2, 16, G.COL.dim, "11px sans-serif", "center");
      }

      S.onResize = ((orig) => function () { orig(); draw(); })(S.onResize);
      window.addEventListener("resize", draw);
      draw();
    } catch (e) {
      console.error("initTransparency 실패:", e);
    }
  }

  // 둥근 사각형 경로 (fill/stroke는 호출측에서)
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ==========================================================
     2) 앰비언트 오클루전 (AO)
     바닥 위에 놓인 여러 원(구)들. 접촉부/틈새/코너에서
     주변 지오메트리가 반구 하늘광을 가려 어두워짐을 보인다.
     - 소프트웨어 ImageData 방식(적당한 해상도).
     - AO 항: 각 표면 픽셀 주변 반경 내 점유량(occluder coverage)으로
       근사. 가까이 막힌 곳일수록 어둡게.
     ========================================================== */
  function initAO() {
    if (!document.getElementById("c-ao")) return;
    try {
      const S = G.setup("c-ao");
      const ctl = document.getElementById("ctl-ao");
      const ctx = S.ctx;

      let aoOn = true;
      let strength = 0.9;  // AO 강도
      let radius = 34;     // AO 반경 (씬 픽셀)

      G.checkbox(ctl, "앰비언트 오클루전(AO) 켜기", aoOn, (v) => { aoOn = v; draw(); });
      G.slider(ctl, {
        label: "AO 강도", min: 0, max: 1, step: 0.05, value: strength,
        format: (v) => (+v).toFixed(2),
        onInput: (v) => { strength = v; draw(); },
      });
      G.slider(ctl, {
        label: "AO 반경", min: 10, max: 70, step: 2, value: radius,
        format: (v) => (+v).toFixed(0) + "px",
        onInput: (v) => { radius = v; draw(); },
      });

      // 씬: 오프스크린 저해상도 버퍼에서 계산 후 확대.
      // 원들과 바닥선을 정의 (씬 좌표, 버퍼 픽셀 기준으로 스케일함)
      // 정규화된 배치(0~1) → 버퍼 크기에 맞춰 사용.
      const scene = [
        { nx: 0.30, r: 0.16 },
        { nx: 0.46, r: 0.13 },
        { nx: 0.62, r: 0.18 },
        { nx: 0.80, r: 0.11 },
      ];

      let off = null, offW = 0, offH = 0;

      function buildScene() {
        // 버퍼 해상도(적당히): 폭 기준
        offW = Math.max(160, Math.min(340, Math.round(S.w * 0.9)));
        offH = Math.round(offW * (S.h / S.w));
        off = document.createElement("canvas");
        off.width = offW; off.height = offH;
      }

      // 반환: {kind, cx, cy, r} 원 목록 (버퍼 픽셀), groundY
      function circlesPx() {
        const groundY = offH * 0.74;
        const baseR = offW * 0.5; // r 스케일 기준
        return {
          groundY,
          circles: scene.map((s) => {
            const r = s.r * offW * 0.55;
            return { cx: s.nx * offW, cy: groundY - r, r };
          }),
        };
      }

      // AO 근사: 한 표면점 (px,py)에서 주변 반경 내 오클루더(원 내부+바닥 아래)
      // 점유 비율을 샘플링하여 [0..1] 가림값 반환. 자기 자신 포함은 완화.
      function computeAO(px, py, circles, groundY, selfIdx) {
        const R = radius * (offW / Math.max(1, S.w)); // 반경을 버퍼스케일로
        const samples = 12;
        let occluded = 0, total = 0;
        for (let a = 0; a < samples; a++) {
          const ang = (a / samples) * Math.PI * 2;
          for (let d = 0.35; d <= 1.0; d += 0.325) {
            const sx = px + Math.cos(ang) * R * d;
            const sy = py + Math.sin(ang) * R * d;
            total++;
            // 다른 원 내부에 들어가면 가려짐
            let hit = false;
            for (let i = 0; i < circles.length; i++) {
              if (i === selfIdx) continue;
              const c = circles[i];
              if ((sx - c.cx) ** 2 + (sy - c.cy) ** 2 < c.r * c.r) { hit = true; break; }
            }
            // 바닥 표면점의 경우: 근처 원이 하늘을 가림 (위쪽 샘플)
            if (!hit && selfIdx < 0 && sy < py) {
              for (let i = 0; i < circles.length; i++) {
                const c = circles[i];
                if ((sx - c.cx) ** 2 + (sy - c.cy) ** 2 < c.r * c.r) { hit = true; break; }
              }
            }
            if (hit) occluded++;
          }
        }
        return total ? occluded / total : 0;
      }

      function draw() {
        if (!off) buildScene();
        const octx = off.getContext("2d");
        const { groundY, circles } = circlesPx();

        // 베이스 색 렌더 (평평한 셰이딩)
        octx.fillStyle = "#12151d";
        octx.fillRect(0, 0, offW, offH);
        // 바닥
        octx.fillStyle = "#2b3242";
        octx.fillRect(0, groundY, offW, offH - groundY);
        // 원(구) — 간단한 방향광 그라디언트
        circles.forEach((c) => {
          const g = octx.createRadialGradient(
            c.cx - c.r * 0.35, c.cy - c.r * 0.4, c.r * 0.1,
            c.cx, c.cy, c.r);
          g.addColorStop(0, "#cdd6e8");
          g.addColorStop(1, "#69748c");
          octx.fillStyle = g;
          octx.beginPath();
          octx.arc(c.cx, c.cy, c.r, 0, Math.PI * 2);
          octx.fill();
        });

        // AO 적용: 픽셀 단위로 어둡게
        if (aoOn && strength > 0) {
          const img = octx.getImageData(0, 0, offW, offH);
          const data = img.data;
          for (let y = 0; y < offH; y++) {
            for (let x = 0; x < offW; x++) {
              // 표면 판정: 바닥 위 픽셀 또는 원 내부 픽셀만 AO 계산
              let selfIdx = -1;
              let isSurface = false;
              for (let i = 0; i < circles.length; i++) {
                const c = circles[i];
                if ((x - c.cx) ** 2 + (y - c.cy) ** 2 < c.r * c.r) { selfIdx = i; isSurface = true; break; }
              }
              if (!isSurface && y >= groundY) isSurface = true;
              if (!isSurface) continue;

              const ao = computeAO(x, y, circles, groundY, selfIdx);
              if (ao <= 0) continue;
              const dark = 1 - G.clamp(ao * strength, 0, 0.85);
              const idx = (y * offW + x) * 4;
              data[idx] *= dark;
              data[idx + 1] *= dark;
              data[idx + 2] *= dark;
            }
          }
          octx.putImageData(img, 0, 0);
        }

        // 화면에 확대 출력
        G.clear(ctx, S.w, S.h);
        ctx.imageSmoothingEnabled = true;
        const drawW = S.w, drawH = S.w * (offH / offW);
        const oy = (S.h - drawH) / 2;
        ctx.drawImage(off, 0, oy, drawW, drawH);

        // 라벨
        const tag = aoOn ? "AO 켜짐 — 접촉부/틈새가 어두워져 물체가 바닥에 놓인 느낌"
                         : "AO 꺼짐 — 평평하고 떠 보임 (접촉 그림자 없음)";
        G.text(ctx, tag, S.w / 2, S.h - 14, aoOn ? G.COL.green : G.COL.yellow,
          "12px sans-serif", "center");
        G.text(ctx, "앰비언트 오클루전: 주변 지오메트리에 가려진 하늘광을 근사하여 어둡게",
          S.w / 2, 14, G.COL.dim, "11px sans-serif", "center");
      }

      S.onResize = ((orig) => function () { orig(); off = null; draw(); })(S.onResize);
      window.addEventListener("resize", () => { off = null; draw(); });
      draw();
    } catch (e) {
      console.error("initAO 실패:", e);
    }
  }

  /* ==========================================================
     3) LOD & 컬링
     탑다운 도식: 카메라 + 시야 절두체(원뿔) + 다수 물체 점.
     - 프러스텀 컬링: 절두체 밖 물체는 컬링(회색, 카운트 제외)
     - LOD: 카메라 거리에 따라 저/중/고 폴리곤 전환
     - 실시간 삼각형 수 / 그린 물체 수 표시
     ========================================================== */
  function initLOD() {
    if (!document.getElementById("c-lod")) return;
    try {
      const S = G.setup("c-lod");
      const ctl = document.getElementById("ctl-lod");
      const ctx = S.ctx;

      // 월드 좌표: 0..1 정규화 필드에 물체 배치 (고정 시드 배열)
      const N = 30;
      const objs = [];
      let seed = 1234;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      for (let i = 0; i < N; i++) objs.push({ x: rnd(), y: rnd() });

      // LOD 레벨별 구(sphere) 삼각형 수: subdivision 기반
      // segments s -> 삼각형 대략 s*s*2 (경위도 구 근사)
      const LOD = [
        { seg: 24, name: "고" },  // 근거리
        { seg: 12, name: "중" },  // 중거리
        { seg: 6,  name: "저" },  // 원거리
      ];
      function triOfSeg(seg) {
        // 경위도 구: stacks=seg, slices=2*seg 근사 → 삼각형 수
        const slices = seg * 2, stacks = seg;
        return slices * (stacks - 1) * 2 + slices * 2; // 옆면 + 양극 캡
      }

      let camDist = 0.55;  // 카메라를 필드 아래쪽 밖에 두고 위를 봄
      let camX = 0.5;      // 카메라 x 위치(0..1)
      let fov = 55;        // 시야각(도)
      let cullOn = true;
      let lodOn = true;

      G.slider(ctl, {
        label: "카메라 X 위치", min: 0, max: 1, step: 0.02, value: camX,
        format: (v) => (+v).toFixed(2),
        onInput: (v) => { camX = v; draw(); },
      });
      G.slider(ctl, {
        label: "카메라 거리", min: 0.15, max: 1.0, step: 0.02, value: camDist,
        format: (v) => (+v).toFixed(2),
        onInput: (v) => { camDist = v; draw(); },
      });
      G.slider(ctl, {
        label: "시야각(FOV)", min: 20, max: 110, step: 1, value: fov,
        format: (v) => (+v).toFixed(0) + "°",
        onInput: (v) => { fov = v; draw(); },
      });
      G.checkbox(ctl, "프러스텀 컬링 켜기", cullOn, (v) => { cullOn = v; draw(); });
      G.checkbox(ctl, "LOD 켜기", lodOn, (v) => { lodOn = v; draw(); });

      // 씬을 캔버스에 매핑: 필드는 상단 영역, 카메라는 하단
      function layout() {
        const pad = 24;
        const fieldTop = 40, fieldH = S.h - 130;
        return {
          fx: (x) => pad + x * (S.w - pad * 2),
          fy: (y) => fieldTop + y * fieldH,
          fieldTop, fieldH, pad,
        };
      }

      // 카메라 위치(월드): 필드 아래쪽(y>1)에서 위(+ 방향)를 바라봄
      function camState() {
        const cx = camX;
        const cy = 1 + camDist;         // 필드 아래
        const dir = { x: 0, y: -1 };    // 위(작은 y)를 봄
        return { cx, cy, dir, half: G.rad(fov) / 2 };
      }

      // 물체가 절두체 안인지: 카메라→물체 벡터와 시선 방향 각도 < half,
      // 그리고 너무 뒤(카메라 뒤)면 제외.
      function inFrustum(o, cam) {
        const vx = o.x - cam.cx, vy = o.y - cam.cy;
        const dist = Math.hypot(vx, vy) || 1e-6;
        const dot = (vx * cam.dir.x + vy * cam.dir.y) / dist; // cos(angle)
        if (dot <= 0) return false; // 뒤쪽
        const ang = Math.acos(G.clamp(dot, -1, 1));
        return ang <= cam.half;
      }

      // 거리 → LOD 인덱스
      function lodOf(o, cam) {
        const d = Math.hypot(o.x - cam.cx, o.y - cam.cy);
        if (!lodOn) return 0; // LOD 끄면 항상 최고 품질
        if (d < 0.45) return 0;
        if (d < 0.85) return 1;
        return 2;
      }

      const lodColor = [G.COL.green, G.COL.yellow, G.COL.red];

      function draw() {
        G.clear(ctx, S.w, S.h);
        const L = layout();
        const cam = camState();

        // 필드 영역 테두리
        ctx.strokeStyle = G.COL.grid;
        ctx.lineWidth = 1;
        ctx.strokeRect(L.pad, L.fieldTop, S.w - L.pad * 2, L.fieldH);

        // 카메라 화면 좌표 (cy는 1보다 큼 → 필드 아래)
        const camSx = L.fx(cam.cx);
        const camSy = L.fy(cam.cy);

        // 절두체(부채꼴) 그리기
        const reach = 2.2; // 시선 길이(월드)
        const c = Math.cos, s = Math.sin;
        const baseAng = Math.atan2(cam.dir.y, cam.dir.x);
        const a1 = baseAng - cam.half, a2 = baseAng + cam.half;
        const p1x = L.fx(cam.cx + c(a1) * reach), p1y = L.fy(cam.cy + s(a1) * reach);
        const p2x = L.fx(cam.cx + c(a2) * reach), p2y = L.fy(cam.cy + s(a2) * reach);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(camSx, camSy);
        ctx.lineTo(p1x, p1y);
        ctx.lineTo(p2x, p2y);
        ctx.closePath();
        ctx.fillStyle = cullOn ? "rgba(110,168,254,0.10)" : "rgba(110,168,254,0.05)";
        ctx.fill();
        ctx.strokeStyle = "rgba(110,168,254,0.5)";
        ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        // 물체 렌더 + 통계
        let drawn = 0, tris = 0, culled = 0;
        objs.forEach((o) => {
          const sx = L.fx(o.x), sy = L.fy(o.y);
          const visible = !cullOn || inFrustum(o, cam);
          if (!visible) {
            // 컬링됨: 회색 점, 카운트 제외
            G.dot(ctx, sx, sy, 4, "rgba(120,128,145,0.4)");
            culled++;
            return;
          }
          const li = lodOf(o, cam);
          const seg = LOD[li].seg;
          const t = triOfSeg(seg);
          tris += t;
          drawn++;
          // LOD 레벨별 색/크기 (원을 다각형으로 그려 폴리곤 느낌)
          const col = lodOn ? lodColor[li] : G.COL.green;
          drawPolyDot(ctx, sx, sy, 7, Math.max(4, Math.round(seg / 3)), col);
        });

        // 카메라 아이콘
        G.dot(ctx, camSx, camSy, 6, G.COL.cyan);
        G.text(ctx, "카메라", camSx, camSy + 16, G.COL.cyan, "bold 11px sans-serif", "center");

        // 통계 패널
        const total = objs.length;
        const stats = [
          "전체 물체: " + total,
          "그린 물체: " + drawn + (cullOn ? ("  (컬링 " + culled + ")") : ""),
          "삼각형 수: " + tris.toLocaleString(),
        ];
        let sy0 = L.fieldTop + L.fieldH + 22;
        ctx.textAlign = "left";
        G.text(ctx, stats[0], L.pad, sy0, G.COL.text, "12px monospace");
        G.text(ctx, stats[1], L.pad, sy0 + 18, G.COL.text, "12px monospace");
        G.text(ctx, stats[2], L.pad, sy0 + 36, G.COL.accent, "bold 13px monospace");

        // LOD 범례
        if (lodOn) {
          let lx = S.w - L.pad - 150, ly = sy0;
          const names = ["근(고폴리)", "중", "원(저폴리)"];
          names.forEach((nm, i) => {
            G.dot(ctx, lx, ly + i * 16, 5, lodColor[i]);
            G.text(ctx, nm, lx + 12, ly + i * 16, G.COL.dim, "11px sans-serif");
          });
        }

        // 상단 설명
        G.text(ctx, "탑다운 도식: 보이지 않는 것은 그리지 말고(컬링), 먼 것은 싸게 그린다(LOD)",
          S.w / 2, 16, G.COL.dim, "11px sans-serif", "center");
      }

      // 다각형 점 (LOD 레벨 시각화)
      function drawPolyDot(ctx, cx, cy, r, sides, color) {
        sides = Math.max(3, sides);
        ctx.fillStyle = color;
        ctx.strokeStyle = "rgba(255,255,255,0.25)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i <= sides; i++) {
          const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
          const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      S.onResize = ((orig) => function () { orig(); draw(); })(S.onResize);
      window.addEventListener("resize", draw);
      draw();
    } catch (e) {
      console.error("initLOD 실패:", e);
    }
  }
})();
