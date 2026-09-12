/* ============================================================
   main.js — 내비게이션 활성화 + 스크롤스파이
   데모 초기화는 각 demos-*.js 가 DOMContentLoaded 에서 처리.
   ============================================================ */
(function () {
  "use strict";
  const links = Array.from(document.querySelectorAll(".sidebar a"));
  const sections = links
    .map((a) => document.querySelector(a.getAttribute("href")))
    .filter(Boolean);

  function onScroll() {
    let current = sections[0];
    const y = window.scrollY + 120;
    for (const s of sections) if (s.offsetTop <= y) current = s;
    links.forEach((a) =>
      a.classList.toggle("active", a.getAttribute("href") === "#" + current.id)
    );
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("load", onScroll);

  // 모바일: 링크 클릭 시 사이드바 닫기
  links.forEach((a) =>
    a.addEventListener("click", () =>
      document.querySelector(".sidebar").classList.remove("open")
    )
  );
})();
