/* ============================================================
   main.js — 내비게이션(단일 섹션 토글) + 활성 표시
   왼쪽 버튼 하나를 누르면 해당 섹션 "한 개"만 오른쪽에 표시한다.
   데모 초기화는 각 demos-*.js 가 DOMContentLoaded 에서 처리.
   ============================================================ */
(function () {
  "use strict";

  const links = Array.from(document.querySelectorAll(".sidebar a"));
  const sections = Array.from(
    document.querySelectorAll(".layout main.content > section")
  );
  const ids = sections.map((s) => s.id);

  // href="#id" 에서 id만 추출
  function idFromHref(href) {
    return href && href.charAt(0) === "#" ? href.slice(1) : "";
  }

  // 지정한 섹션 하나만 보이게 하고 나머지는 숨긴다.
  function activate(id) {
    // 유효하지 않으면 첫 섹션으로 폴백
    if (!id || ids.indexOf(id) === -1) id = ids[0];
    if (!id) return;

    sections.forEach((s) =>
      s.classList.toggle("section-active", s.id === id)
    );
    links.forEach((a) =>
      a.classList.toggle("active", idFromHref(a.getAttribute("href")) === id)
    );

    // 모바일: 링크 클릭 시 사이드바 닫기
    const sb = document.querySelector(".sidebar");
    if (sb) sb.classList.remove("open");

    // 맨 위로. (섹션이 통째로 바뀌므로 스크롤 위치를 리셋)
    window.scrollTo(0, 0);

    // 숨겨져 있던 캔버스는 폭이 0이라 비어 보인다.
    // resize 이벤트를 쏘면 lib.js가 캔버스를 다시 크기 맞추고
    // 각 데모가 등록한 리스너가 다시 그린다.
    window.dispatchEvent(new Event("resize"));
  }

  // 해시 → 섹션
  function activateFromHash() {
    activate(idFromHref(location.hash));
  }

  // 링크 클릭: 같은 해시를 눌러도(=hashchange 미발생) 동작하도록 직접 처리
  links.forEach((a) => {
    a.addEventListener("click", (e) => {
      const id = idFromHref(a.getAttribute("href"));
      if (ids.indexOf(id) === -1) return; // 섹션 링크가 아니면 기본 동작
      e.preventDefault();
      if (location.hash !== "#" + id) {
        location.hash = id; // hashchange → activateFromHash
      } else {
        activate(id); // 이미 같은 해시면 수동으로
      }
    });
  });

  window.addEventListener("hashchange", activateFromHash);

  // 초기 표시
  activateFromHash();
})();
