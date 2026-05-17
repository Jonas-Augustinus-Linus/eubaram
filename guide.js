// =================================================
// EU연합 - 공성 가이드 페이지
// =================================================

// 옥좌공성 단계 — pts/label 은 운영진 정정 가능 (정확한 룰 공지 후 업데이트)
const SIEGE_STAGES = [
  { tag: "1단계", label: "성문 돌파",         pts: 17, color: "#ff5147" },
  { tag: "2단계", label: "봉인석",            pts: 8,  color: "#ff8a4c" },
  { tag: "3단계", label: "몽무탑 / 신물",     pts: 10, color: "#FFCC00" },
  { tag: "4단계", label: "단기흑수",          pts: 16, color: "#2ea043" },
  { tag: "5단계", label: "신수수호령",        pts: 21, color: "#58a6ff" },
  { tag: "최종", label: "옥좌 혈투",          pts: 28, color: "#a371f7" },
];

function renderMissionBar() {
  const bar = document.getElementById("missionBar");
  const list = document.getElementById("missionList");
  if (!bar || !list) return;
  const total = SIEGE_STAGES.reduce((a, m) => a + m.pts, 0);
  bar.innerHTML = SIEGE_STAGES.map((m) => {
    const pct = (m.pts / total) * 100;
    return `<div class="mission-seg" style="width:${pct}%; background:${m.color}" title="${m.tag} ${m.label} · ${m.pts}점" aria-label="${m.tag} ${m.label} ${m.pts}점">
      <span class="seg-pts">${m.pts}</span>
    </div>`;
  }).join("");
  list.innerHTML = SIEGE_STAGES.map((m) => `
    <div class="mission-row">
      <span class="m-tag">${m.tag}</span>
      <span class="m-name">${m.label}</span>
      <span class="m-pts">${m.pts}점</span>
    </div>`).join("");
}

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
  renderMissionBar();
  setupCalculator();
  setupTocScroll();
});
