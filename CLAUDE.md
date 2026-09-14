# CLAUDE.md

이 저장소에서 작업할 때 Claude Code가 따르는 프로젝트 지침이다.

## 프로젝트 개요

순수 HTML/CSS/JavaScript로 만든 **그래픽스 프로그래밍 학습 가이드** (빌드 도구·프레임워크·의존성 없음). 브라우저에서 `index.html`을 열면 바로 동작한다.

두 개의 트랙으로 구성:
- **개념·데모 트랙** (`index.html`) — 벡터부터 텍스처 매핑까지 개념을 Canvas 인터랙티브 데모로 설명. 좌측 사이드바 버튼으로 섹션 하나씩 토글해서 본다.
- **구현 트랙** (`impl/`) — 같은 주제를 C++ / Direct3D 11 / HLSL로 직접 구현하는 실무자용 가이드. 챕터별 허브 페이지 + 세부 페이지 구조.

## 구조

```
index.html          # 개념 트랙 단일 페이지 (좌측 목차 + <section id="..."> 38개)
css/style.css       # 개념 트랙 스타일 (impl은 .layout을 안 써서 격리됨)
js/
  lib.js            # 모든 데모 공용 헬퍼. window.GFX 로 노출 (setup/그리기/수학/슬라이더 등)
  main.js           # 사이드바 내비게이션 = 단일 섹션 토글(SPA). 해시 기반.
  demos-*.js        # 섹션별 데모. 각 파일이 DOMContentLoaded에서 init 함수들을 try/catch로 격리 실행.
impl/
  index.html        # 구현 허브
  impl.css          # 구현 트랙 스타일
  NN-topic.html     # 챕터별 세부 페이지
  highlight.js      # 코드 하이라이팅
```

## 핵심 동작 규칙 (건드릴 때 주의)

- **캔버스 크기 조정 피드백 루프 금지.** `canvas.height`(프로퍼티) 대입은 HTML `height` 속성을 함께 바꾼다. 따라서 논리 높이는 `getAttribute("height")`로 **최초 1회만** 읽어 변수에 저장하고, resize마다 다시 읽으면 안 된다. 다시 읽으면 매 resize마다 dpr배씩 커져 데모가 세로로 무한정 길어진다. (`lib.js` setup, `demos-gpu.js` sizeCanvas 참고)
- **섹션 토글 방식.** `main.js`가 해시(`#vector` 등)에 맞는 `<section>` 하나만 `.section-active`로 표시한다. 숨겨진 섹션의 캔버스는 폭이 0이므로, 섹션을 켤 때 `window.dispatchEvent(new Event("resize"))`로 다시 크기 맞추고 그린다. 각 데모는 `resize` 리스너나 rAF 루프(`GFX.loop`)로 다시 그려진다.
- **CSS 격리.** 개념 트랙 전용 규칙은 `.layout` 하위로 스코프한다. `impl/` 페이지는 `.layout`이 없고 `<section>`도 없어 영향받지 않는다.
- **데모 추가.** 새 데모는 해당 `demos-*.js`에 `initXxx()`를 만들고 부팅 배열에 추가한다. 대상 요소가 없으면 조용히 `return`하고, 초기화는 try/catch로 격리해 다른 데모를 깨뜨리지 않는다.

## 확인 방법

빌드가 없으므로 브라우저로 `index.html`을 직접 열어 확인한다. 좌측 목차를 눌러 섹션이 하나만 뜨는지, 캔버스가 정상 크기로 그려지는지, 여러 번 왕복해도 세로로 늘어나지 않는지 본다. JS 수정 후에는 `node --check <파일>`로 문법을 확인한다.

## Git: 자동 커밋 & 푸시

작업(코드/문서 변경)을 완료하면 **매번 자동으로 커밋하고 `origin main`에 푸시한다.** 사용자가 따로 커밋을 요청하지 않아도 수행한다.

절차:
1. `git add -A`
2. 변경 내용을 요약한 한국어 커밋 메시지로 커밋 (아래 Co-Authored-By 트레일러 포함)
3. `git push origin main`

```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

예외 — 다음 경우엔 푸시 전에 사용자에게 먼저 알린다:
- `git push`가 실패(충돌·거부)하거나 rebase/force-push가 필요할 때
- 시크릿·자격증명·대용량 바이너리 등 커밋하면 안 되는 파일이 포함될 때
- 되돌리기 어려운 히스토리 변경(force push, reset --hard 등)이 필요할 때
