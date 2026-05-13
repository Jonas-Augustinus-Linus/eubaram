// =================================================
// EU연합 통합시스템 - 랜딩 페이지 로직
// =================================================

const DEFAULT_ENDPOINT = "https://script.google.com/macros/s/AKfycbwuCTkMYPDZoQIXe63N5aFf0W-ViJeo8LX4kfspdmt9qporNmgJPWdFAH6GUy2JyN2x5A/exec";
const KST_OFFSET_MIN = 9 * 60;

const ALLIANCE = {
  name: "EU 연합",
  leader: { nickname: "스왚", guild: "쿠데타" },
  families: [
    { name: "쿠데타계",       guilds: ["쿠데타", "혁명", "반란", "난", "문파"] },
    { name: "주술사연합회계",  guilds: ["주술사연합회", "주술사연맹", "주스터콜", "주토피아", "주막왈숙네"] },
    { name: "로켓단계",       guilds: ["로켓단"] },
    { name: "매화계",         guilds: ["매화"] },
    { name: "신화계",         guilds: ["신화", "시"] },
    { name: "청룡계",         guilds: ["청룡"] },
    { name: "연가계",         guilds: ["월하", "연가", "연희"] },
  ],
};

const CASTLE_BY_DAY = {
  1: "주작성", 2: "현무성", 3: "청룡성", 4: "백호성",
};
const DAY_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function pad2(n) { return String(n).padStart(2, "0"); }

function nowKst() { return new Date(Date.now() + KST_OFFSET_MIN * 60 * 1000); }

function todayKstString() {
  const d = nowKst();
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())}`;
}

function getCastleContext() {
  const d = nowKst();
  const day = d.getUTCDay();
  const hour = d.getUTCHours();
  const min = d.getUTCMinutes();
  const castle = CASTLE_BY_DAY[day];
  if (!castle) {
    return { dayLabel: DAY_LABEL[day], castle: null, isOpen: false };
  }
  const cur = hour * 60 + min;
  const isOpen = cur <= 23 * 60 + 30;
  return { dayLabel: DAY_LABEL[day], castle, isOpen };
}

function renderTodayBanner() {
  const ctx = getCastleContext();
  $("#todayLabel").textContent = `오늘은 ${ctx.dayLabel}요일`;
  const tag = $("#castleTag");
  if (ctx.castle) {
    tag.textContent = ctx.isOpen ? `${ctx.castle} 신청 가능` : `${ctx.castle} (마감)`;
    tag.classList.toggle("disabled", !ctx.isOpen);
  } else {
    tag.textContent = "신청 불가일";
    tag.classList.add("disabled");
  }
}

// ---- API ----

function getEndpoint() {
  return localStorage.getItem("juseter_endpoint") || DEFAULT_ENDPOINT;
}

async function apiList() {
  try {
    const res = await fetch(`${getEndpoint()}?action=list`);
    if (!res.ok) return [];
    const d = await res.json();
    return d.entries || [];
  } catch { return []; }
}

async function apiMembers() {
  try {
    const res = await fetch(`${getEndpoint()}?action=members`);
    if (!res.ok) return [];
    const d = await res.json();
    return d.members || [];
  } catch { return []; }
}

// ---- This week range (KST) ----

function thisWeekRange() {
  const d = nowKst();
  const dow = d.getUTCDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(d.getTime());
  mon.setUTCDate(mon.getUTCDate() + offset);
  const sun = new Date(mon.getTime());
  sun.setUTCDate(sun.getUTCDate() + 6);
  const fmt = (x) => `${x.getUTCFullYear()}-${pad2(x.getUTCMonth()+1)}-${pad2(x.getUTCDate())}`;
  return { start: fmt(mon), end: fmt(sun) };
}

function inRange(dateStr, start, end) {
  const d = (dateStr || "").slice(0, 10);
  return d >= start && d <= end;
}

// ---- Family / guild grid ----

function bestPerNick(entries) {
  const map = new Map();
  entries.forEach((e) => {
    const k = (e.nickname || "").trim().toLowerCase();
    if (!k) return;
    const s = parseFloat(e.score) || 0;
    const prev = map.get(k);
    if (!prev || s > parseFloat(prev.score)) map.set(k, e);
  });
  return map;
}

function renderGrid(members, entries) {
  const range = thisWeekRange();
  const weekEntries = entries.filter((e) => inRange(e.dateKst, range.start, range.end));
  const bestMap = bestPerNick(weekEntries);

  // members 를 문파별로 그룹
  const byGuild = new Map();
  members.forEach((m) => {
    const g = (m.guild || "").trim();
    if (!g) return;
    if (!byGuild.has(g)) byGuild.set(g, []);
    byGuild.get(g).push(m);
  });

  // 문파별 통계
  function guildStats(guildName) {
    const list = byGuild.get(guildName) || [];
    if (!list.length) return { total: 0, submitted: 0, pct: 0 };
    const submitted = list.filter((m) =>
      bestMap.has((m.nickname || "").trim().toLowerCase())
    ).length;
    const pct = Math.round((submitted / list.length) * 100);
    return { total: list.length, submitted, pct };
  }

  // 총합 (전체 KPI)
  let totalAll = 0;
  let submittedAll = 0;
  ALLIANCE.families.forEach((f) => f.guilds.forEach((g) => {
    const s = guildStats(g);
    totalAll += s.total;
    submittedAll += s.submitted;
  }));
  const pctAll = totalAll > 0 ? Math.round((submittedAll / totalAll) * 100) : 0;
  $("#statSubmitted").textContent = submittedAll;
  $("#statTotal").textContent = totalAll || "-";
  $("#statPct").textContent = `${pctAll}%`;
  $("#statFill").style.width = `${pctAll}%`;

  // 그리드
  const grid = $("#familyGrid");
  grid.innerHTML = ALLIANCE.families.map((fam) => {
    const isLeaderFam = fam.guilds.includes(ALLIANCE.leader.guild);
    const famTotal = fam.guilds.reduce((acc, g) => acc + (guildStats(g).total || 0), 0);
    const famSubmitted = fam.guilds.reduce((acc, g) => acc + (guildStats(g).submitted || 0), 0);
    const famPct = famTotal > 0 ? Math.round((famSubmitted / famTotal) * 100) : 0;

    const guildCards = fam.guilds.map((g) => {
      const s = guildStats(g);
      const isLeader = g === ALLIANCE.leader.guild;
      const url = `siege.html?guild=${encodeURIComponent(g)}`;
      let meta;
      if (s.total === 0) {
        meta = `<span class="guild-meta">미등록</span>`;
      } else {
        const submittedClass = s.submitted > 0 ? "submitted-on" : "";
        meta = `<span class="guild-meta ${submittedClass}">${s.submitted}/${s.total} · ${s.pct}%</span>`;
      }
      return `<a href="${url}" class="guild-card ${isLeader ? "is-leader" : ""}">
        <span class="guild-name">${escapeHtml(g)}</span>
        ${meta}
      </a>`;
    }).join("");

    return `
      <div class="family-card ${isLeaderFam ? "is-leader" : ""}" data-family="${escapeHtml(fam.name)}">
        <div class="family-header">
          <span class="family-name">${escapeHtml(fam.name)}</span>
          <span class="family-stats">
            <span class="family-pct">${famPct}%</span>
            <span>${famSubmitted}/${famTotal || "-"}</span>
            <span class="family-arrow">▼</span>
          </span>
        </div>
        <div class="guild-list">${guildCards}</div>
      </div>
    `;
  }).join("");

  // 헤더 클릭 토글
  $$(".family-header").forEach((h) => {
    h.addEventListener("click", () => {
      const card = h.parentElement;
      card.classList.toggle("open");
    });
  });

  // 기본: 모든 family 펼치기 (초기 사용감 좋게)
  $$(".family-card").forEach((c) => c.classList.add("open"));
}

// ---- Init ----

async function init() {
  renderTodayBanner();
  setInterval(renderTodayBanner, 60 * 1000);

  // skeleton 렌더 (members/entries 없이도 그리드는 보임)
  renderGrid([], []);

  const [members, entries] = await Promise.all([apiMembers(), apiList()]);
  renderGrid(members, entries);
}

document.addEventListener("DOMContentLoaded", init);
