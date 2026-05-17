// =================================================
// EU연합 - 공성 가이드 페이지
// =================================================

// 옥좌공성은 단계가 없음 (옛날방식): 30분 후 랜덤 종료, 종료 시점 옥좌 점유 문주 = 성주.
// 시각화는 guide.html 내 throne-timeline (정적 HTML) 이 담당.

// 체마 점수 계산기
function setupCalculator() {
  const hp = document.getElementById("calcHp");
  const mp = document.getElementById("calcMp");
  const result = document.getElementById("calcResult");
  const resultW = document.getElementById("calcResultWeighted");
  if (!hp || !mp || !result || !resultW) return;

  function compute() {
    const h = parseFloat(hp.value) || 0;
    const m = parseFloat(mp.value) || 0;
    const base = (h * 1 + m * 2) / 1000;
    if (base <= 0) {
      result.textContent = "-";
      resultW.textContent = "-";
      return;
    }
    result.textContent = base.toFixed(2) + " 점";
    resultW.textContent = (base * 1.30).toFixed(2) + " 점";
  }
  hp.addEventListener("input", compute);
  mp.addEventListener("input", compute);
  compute();
}

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
  setupCalculator();
  setupTocScroll();
});
