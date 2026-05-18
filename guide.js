// =================================================
// EU연합 - 공성 가이드 페이지
// (체마 계산기는 바람비전 expcal 외부 링크로 대체됨 — 자체 구현 제거)
// =================================================

// 부드러운 앵커 스크롤
function setupTocScroll() {
  document.querySelectorAll(".guide-toc a").forEach((a) => {
    a.addEventListener("click", (e) => {
      const id = a.getAttribute("href");
      if (!id || !id.startsWith("#")) return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      history.replaceState(null, "", id);
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setupTocScroll();
});
