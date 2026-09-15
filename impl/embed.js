/* embed.js — impl 페이지가 부모 index.html의 iframe에 임베드됐을 때 처리.
   모든 impl 페이지가 <head>에서 로드한다(렌더 전 class 부여로 크롬 깜빡임 방지).
   1) html.embedded 클래스 → 자체 페이지 크롬(뒤로가기/네비) 숨김(impl.css)
   2) 내용 높이를 부모에 postMessage → iframe이 내용에 맞춰져 내부 스크롤 없음.
      (임베드 안에서 다른 세부 페이지로 이동해도 각 페이지가 자기 높이를 보고) */
(function () {
  if (window.self === window.top) return; // 임베드 아님 → 아무것도 안 함
  var el = document.documentElement;
  el.classList.add("embedded");

  function postHeight() {
    var h = Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0
    );
    parent.postMessage({ t: "embedHeight", h: h }, "*");
  }

  window.addEventListener("load", postHeight);
  window.addEventListener("resize", postHeight);
  document.addEventListener("DOMContentLoaded", postHeight);
  if (window.ResizeObserver) {
    document.addEventListener("DOMContentLoaded", function () {
      new ResizeObserver(postHeight).observe(document.body);
    });
  }
  // 폰트/데모 로드 후 보정
  setTimeout(postHeight, 300);
  setTimeout(postHeight, 1200);

  // 부모가 섹션을 보이게 한 뒤 보내는 reflow 신호 → 내부 데모를 다시 그린다.
  // (숨겨진 동안 폭 0으로 그려진 캔버스 데모가 갱신 안 되던 문제 해결.)
  window.addEventListener("message", function (e) {
    if (e.data && e.data.t === "reflow") {
      // 숨겨진 채 로드되면 offsetParent가 null이라 데모 init이 건너뛰어졌을 수 있다.
      // 보이게 된 지금 다시 초기화(runPendingDemos)하고 resize로 다시 그린다.
      if (window.GFX && GFX.runPendingDemos) GFX.runPendingDemos();
      window.dispatchEvent(new Event("resize"));
      postHeight();
    }
  });
})();
