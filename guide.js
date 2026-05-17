// =================================================
// EU연합 - 공성 가이드 페이지
// =================================================

// 옥좌공성은 단계가 없음 (옛날방식): 30분 후 랜덤 종료, 종료 시점 옥좌 점유 문주 = 성주.
// 시각화는 guide.html 내 throne-timeline (정적 HTML) 이 담당.

// =================================================
// 체마 → 점수 / 필요 경험치 계산기
// 원본: https://barambook.com/expcal (코드 분석 + API 프록시)
// =================================================

// 직업 정보 (차수별 최소 체마)
const JOBS = {
  Warrior: {
    label: "전사",
    ranks: [
      { name: "검객", hp: 70000,   mp: 0 },
      { name: "검제", hp: 200000,  mp: 0 },
      { name: "검황", hp: 600000,  mp: 0 },
      { name: "검성", hp: 1400000, mp: 0 },
    ],
  },
  Sheif: {
    label: "도적",
    ranks: [
      { name: "자객", hp: 65000,   mp: 0 },
      { name: "진검", hp: 220000,  mp: 0 },
      { name: "귀검", hp: 600000,  mp: 0 },
      { name: "태성", hp: 1400000, mp: 0 },
    ],
  },
  Magic: {
    label: "주술사",
    ranks: [
      { name: "술사", hp: 30000,  mp: 20000 },
      { name: "현사", hp: 150000, mp: 100000 },
      { name: "현인", hp: 300000, mp: 500000 },
      { name: "현자", hp: 650000, mp: 900000 },
    ],
  },
  Hill: {
    label: "도사",
    ranks: [
      { name: "도인", hp: 25000,  mp: 25000 },
      { name: "명인", hp: 80000,  mp: 70000 },
      { name: "진인", hp: 250000, mp: 250000 },
      { name: "진선", hp: 600000, mp: 750000 },
    ],
  },
};

// EXP cost 표 (직업군별 — Sword vs Magic 다름)
// 각 행: [HP 상한, cost_per_step]. step = 50 HP (또는 25 MP).
const SWORD_HP_TIERS = [
  [800000, 1], [1000000, 2], [1200000, 5], [1500000, 10],
  [1700000, 20], [2000000, 30], [2100000, 40], [2200000, 50],
  [2300000, 60], [2400000, 70], [2500000, 80], [2600000, 90],
  [2700000, 100],
];
const SWORD_MP_TIERS = [
  [100000, 1], [150000, 2], [200000, 5], [250000, 10],
  [300000, 20], [350000, 30], [400000, 40], [450000, 50],
  [500000, 60], [550000, 70], [600000, 80], [650000, 90],
  [700000, 100],
];
const MAGIC_HP_TIERS = [
  [400000, 1], [500000, 2], [600000, 5], [700000, 10],
  [800000, 20], [900000, 30], [1000000, 40], [1100000, 50],
  [1200000, 60], [1300000, 70], [1400000, 80], [1500000, 90],
  [1600000, 100],
];
const MAGIC_MP_TIERS = [
  [600000, 1], [700000, 2], [800000, 5], [900000, 10],
  [1000000, 20], [1100000, 30], [1200000, 40], [1300000, 50],
  [1400000, 60], [1500000, 70], [1600000, 80], [1700000, 90],
  [1800000, 100],
];

const HP_STEP = 50;
const MP_STEP = 25;
const EXP_UNIT = 10000000; // 0x989680 = 10M

// 한 stat 의 current → target 까지의 EXP cost 단위 누적
function tierCost(tiers, current, target, step) {
  if (target <= current) return 0;
  let cost = 0;
  let v = current;
  while (v < target) {
    // 마지막 구간 초과면 노옵 (cap)
    const tier = tiers.find((t) => v < t[0]);
    if (!tier) break;
    cost += tier[1];
    v += step;
  }
  return cost;
}

function calcExp(jobCode, currentHp, targetHp, currentMp, targetMp) {
  const isSword = jobCode === "Warrior" || jobCode === "Sheif";
  const hpTiers = isSword ? SWORD_HP_TIERS : MAGIC_HP_TIERS;
  const mpTiers = isSword ? SWORD_MP_TIERS : MAGIC_MP_TIERS;
  const hpCost = tierCost(hpTiers, Math.max(0, currentHp), Math.max(0, targetHp), HP_STEP);
  const mpCost = tierCost(mpTiers, Math.max(0, currentMp), Math.max(0, targetMp), MP_STEP);
  return {
    hpExp: hpCost * EXP_UNIT,
    mpExp: mpCost * EXP_UNIT,
    totalExp: (hpCost + mpCost) * EXP_UNIT,
  };
}

// 큰 숫자 포맷 (조/억/천만/만)
function formatBigNum(n) {
  if (!n || n <= 0) return "0";
  let out = "";
  let v = n;
  const cho = 1000000000000; // 1조
  const eok = 100000000;     // 1억
  const cm  = 10000000;      // 천만
  const man = 10000;         // 만
  if (v >= cho) { out += Math.floor(v / cho) + "조 "; v %= cho; }
  if (v >= eok) { out += Math.floor(v / eok) + "억 "; v %= eok; }
  if (v >= cm)  { out += Math.floor(v / cm)  + "천만 "; v %= cm; }
  if (v >= man && !out) { out += Math.floor(v / man) + "만"; }
  return out.trim() || (n + "");
}

// 공성 점수 조회 (Apps Script 프록시)
async function fetchScore(jobCode, hp, mp) {
  try {
    const url = `${getEndpoint()}?action=scoreCalc&job_code=${encodeURIComponent(jobCode)}&hp=${hp}&mp=${mp}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const d = await res.json();
    if (!d.ok) return null;
    return d.score || "0.00";
  } catch { return null; }
}

let _scoreFetchSeq = 0;

function setupCalculator() {
  const jobSel = document.getElementById("calcJob");
  const rankSel = document.getElementById("calcRank");
  const cHp = document.getElementById("calcCurrentHp");
  const cMp = document.getElementById("calcCurrentMp");
  const tHp = document.getElementById("calcTargetHp");
  const tMp = document.getElementById("calcTargetMp");
  const eHp = document.getElementById("calcExpHp");
  const eMp = document.getElementById("calcExpMp");
  const eTotal = document.getElementById("calcExpTotal");
  const sDelta = document.getElementById("calcScoreDelta");
  const sSub = document.getElementById("calcScoreSub");
  if (!jobSel || !cHp) return;

  function refillRanks() {
    const job = JOBS[jobSel.value];
    if (!job) return;
    rankSel.innerHTML = `<option value="">직접 입력</option>` +
      job.ranks.map((r, i) => `<option value="${i}">${i + 1}차 · ${r.name} (${r.hp.toLocaleString()} / ${r.mp.toLocaleString()})</option>`).join("");
    // 마력 사용 없으면 MP 입력 비활성
    const usesMp = job.ranks.some((r) => r.mp > 0);
    cMp.disabled = !usesMp;
    tMp.disabled = !usesMp;
    if (!usesMp) { cMp.value = "0"; tMp.value = "0"; }
  }

  function applyRank() {
    const idx = parseInt(rankSel.value, 10);
    if (!isFinite(idx)) return;
    const job = JOBS[jobSel.value];
    if (!job || !job.ranks[idx]) return;
    cHp.value = job.ranks[idx].hp;
    cMp.value = job.ranks[idx].mp;
    compute();
  }

  async function compute() {
    const job = jobSel.value;
    const cH = parseInt(cHp.value, 10) || 0;
    const cM = parseInt(cMp.value, 10) || 0;
    const tH = parseInt(tHp.value, 10) || 0;
    const tM = parseInt(tMp.value, 10) || 0;
    const exp = calcExp(job, cH, tH, cM, tM);
    eHp.textContent = formatBigNum(exp.hpExp);
    eMp.textContent = formatBigNum(exp.mpExp);
    eTotal.textContent = formatBigNum(exp.totalExp);

    // 점수는 비동기 (race condition 방어용 seq)
    const mySeq = ++_scoreFetchSeq;
    sDelta.textContent = "계산 중…";
    sSub.textContent = "";
    if (!cH && !cM && !tH && !tM) {
      sDelta.textContent = "- → -";
      return;
    }
    const [scoreBefore, scoreAfter] = await Promise.all([
      fetchScore(job, cH, cM),
      fetchScore(job, tH, tM),
    ]);
    if (mySeq !== _scoreFetchSeq) return; // 이미 새 입력이 들어왔으면 무시
    if (scoreBefore === null || scoreAfter === null) {
      sDelta.textContent = "점수 조회 실패";
      sSub.textContent = "서버 응답 없음";
      return;
    }
    const before = parseFloat(scoreBefore) || 0;
    const after = parseFloat(scoreAfter) || 0;
    const diff = after - before;
    sDelta.textContent = `${scoreBefore} → ${scoreAfter}`;
    const sign = diff > 0 ? "+" : "";
    sSub.textContent = `Δ ${sign}${diff.toFixed(2)} · 정예 적용 ${(after * 1.30).toFixed(2)}`;
  }

  jobSel.addEventListener("change", () => { refillRanks(); compute(); });
  rankSel.addEventListener("change", applyRank);
  [cHp, cMp, tHp, tMp].forEach((el) => el.addEventListener("input", compute));
  refillRanks();
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
