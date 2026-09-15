# TODO — 작업 백로그

이 프로젝트의 **실행형 할 일 목록**이다. 작업을 시작하기 전에 이 파일을 먼저 읽고,
항목을 끝내면 `[x]`로 체크하거나 삭제한다.

- 여기(TODO.md)는 *지금/앞으로 할 구체적 작업*을 담는다.
- `docs/CURRICULUM.md`는 *렌더링 이론 전체 지도 + 작성 상태표(완성도 관리)*를 담는다. 역할이 다르니 섞지 않는다.
- 새 페이지·데모를 만들 때의 톤·템플릿·레이아웃 규칙은 `docs/CONTENT-GUIDE.md`와 `CLAUDE.md`를 따른다.

---

## 프로브 기반 간접광 (완료)

조명 계보: `06-pbr`(직접 스페큘러) → **06-ibl**(간접 스페큘러) → **06-gi**(간접 디퓨즈) → `06-screenspace`(SSR/SSAO).

- [x] **`impl/06-ibl.html` 신설** — 환경맵(큐브맵) → 디퓨즈 irradiance / 스페큘러 프리필터 → split-sum BRDF LUT.
      리플렉션 프로브(박스 parallax correction, 프로브 블렌딩, 정적·실시간 갱신)·리플렉션 캡쳐(UE 용어)까지 §5에서 다루고 SSR 폴백 체인 언급. WebGL 히어로 + split-sum gdemo 포함.
- [x] **`impl/06-gi.html` 보강** — 라이트 프로브 그리드 배치·삼선형 보간(§2-3)·DDGI 가시성 연결(§2-4) 확장. 히어로 배너 추가, `impl-badge` 제거.
- [x] 두 페이지 상호 링크 + `06-pbr`(IBL 콜아웃)·`06-screenspace`(SSR→프로브 폴백)에서 교차 링크. 허브 카드 추가(카드 2/9), gi 카드 topics 갱신.
- [x] `docs/CURRICULUM.md` PART 6-B / 6-D 상태칸 갱신.
- [x] **개념 트랙 반영**(§5 두 트랙 동시 반영): `index.html`에 `#ibl` 섹션 + 사이드바 링크 추가,
      `js/demos-adv1.js`에 `initIBL` split-sum 데모(거칠기=프리필터 밉·금속성=디퓨즈/스페큘러) 작성·등록,
      06-ibl→개념 섹션 역링크. CLAUDE.md에 "구현 트랙 후 개념 트랙 반영" 규칙 추가.

> 후속(선택): 리플렉션 프로브 전용 개념 데모·GI 프로브 그리드 개념 데모는 미착수(현재 #ibl 데모가 IBL split-sum을 커버, #gi가 GI를 커버). 필요 시 추가.

---

## 06-gi 기법별 세부 페이지 개편 (진행 중)

`06-gi.html`(단일 롱페이지) → **GI 허브 + 기법별 세부 페이지 5개**로 분해. 각 세부 페이지는 히어로 + 비주얼 데모 + "직접 구현" 콘텐츠.

- [x] `06-gi.html`을 허브로 재작성(히어로·큰그림·비교표·5카드·마무리표).
- [x] `06-gi-lightmap.html` — 라이트맵 베이킹 + 2D 베이킹 데모(방+텍셀+1D 라이트맵 스트립).
- [x] `06-gi-probe.html` — Irradiance 프로브(SH)·그리드·DDGI + 2D 프로브 그리드/누수 데모.
- [x] `06-gi-ssgi.html` — SSGI + WebGL 코넬박스 color bleeding(OFF|ON) 데모.
- [x] `06-gi-vxgi.html` — Voxel Cone Tracing + WebGL 콘 번짐 데모.
- [x] `06-gi-rtgi.html` — DXR RTGI + WebGL 노이즈→디노이즈 데모.
- [x] 06-ibl `#probe` 링크 → `06-gi-probe.html` 갱신, 허브 카드·CURRICULUM 6-D 갱신.
- [x] 5페이지 헤드리스 렌더 검증(히어로·데모·본문·JS문법·nav) 후 일괄 커밋·푸시.
- [x] 개념 트랙 `#gi`를 허브(06-gi.html) iframe 임베드로 전환(paths 패턴). 개념 트랙 GI 데모는 허브 안 "먼저 감 잡기" 직관 데모로 이관(전체 씬 GI 슬라이더: 0=직접광만 → 색번짐·그림자 채움).
