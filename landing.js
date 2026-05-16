// =================================================
// EU연합 통합시스템 - 랜딩 페이지 로직
// =================================================

const DEFAULT_ENDPOINT = "https://script.google.com/macros/s/AKfycbwuCTkMYPDZoQIXe63N5aFf0W-ViJeo8LX4kfspdmt9qporNmgJPWdFAH6GUy2JyN2x5A/exec";
const KST_OFFSET_MIN = 9 * 60;

const ALLIANCE = {
  name: "EU 연합",
  leader: { nickname: "스왚", guild: "쿠데타" },
  families: [
    { name: "쿠데타계",       guilds: ["쿠데타", "혁명", "반란", "난"] },
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

// ---- API + SWR 캐시 ----

function getEndpoint() {
  return localStorage.getItem("juseter_endpoint") || DEFAULT_ENDPOINT;
}

const CACHE_PREFIX = "eubaram_cache_";

function readCache(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj && "data" in obj ? obj.data : null;
  } catch { return null; }
}

function writeCache(key, data) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), data }));
  } catch {}
}

async function apiList() {
  try {
    const res = await fetch(`${getEndpoint()}?action=list`);
    if (!res.ok) return [];
    const d = await res.json();
    const out = d.entries || [];
    writeCache("entries", out);
    return out;
  } catch { return []; }
}

async function apiMembers() {
  try {
    const res = await fetch(`${getEndpoint()}?action=members`);
    if (!res.ok) return [];
    const d = await res.json();
    const out = d.members || [];
    writeCache("members", out);
    return out;
  } catch { return []; }
}

async function apiCastleLords() {
  try {
    const res = await fetch(`${getEndpoint()}?action=castleLords`);
    if (!res.ok) return {};
    const d = await res.json();
    const out = d.lords || {};
    writeCache("lords", out);
    return out;
  } catch { return {}; }
}

async function apiGuidelines() {
  try {
    const res = await fetch(`${getEndpoint()}?action=guidelines`);
    if (!res.ok) return "";
    const d = await res.json();
    const out = d.text || "";
    writeCache("guidelines", out);
    return out;
  } catch { return ""; }
}

function renderCastleLords(lords) {
  const castles = ["주작성", "현무성", "청룡성", "백호성"];
  castles.forEach((c) => {
    const cell = document.querySelector(`#lord-${c}`);
    if (!cell) return;
    const lord = lords[c];
    const guild = lord && lord.guild ? lord.guild : "";
    if (guild) {
      cell.classList.remove("empty");
      // 연합 내 문파인지 확인
      const inAlliance = ALLIANCE.families.some((f) => f.guilds.includes(guild));
      const family = ALLIANCE.families.find((f) => f.guilds.includes(guild));
      cell.innerHTML = `<span class="lord-guild ${inAlliance ? 'in-alliance' : 'outsider'}">${escapeHtml(guild)}</span>${family ? `<div class="cl-lord-family">${escapeHtml(family.name)}</div>` : ""}`;
    } else {
      cell.classList.add("empty");
      cell.textContent = "미점령";
    }
  });
}

function renderParticipating(guilds, guildStats) {
  const wrap = document.querySelector("#participatingList");
  if (!wrap) return;
  if (!guilds.length) {
    wrap.innerHTML = `<span class="hint">아직 이번주 신청 문파가 없습니다</span>`;
    return;
  }
  // 정렬: 신청률 높은 순
  const sorted = guilds.slice().sort((a, b) => {
    const sa = guildStats(a).pct;
    const sb = guildStats(b).pct;
    return sb - sa;
  });
  wrap.innerHTML = sorted.map((g) => {
    const s = guildStats(g);
    const fam = ALLIANCE.families.find((f) => f.guilds.includes(g));
    const famLabel = fam ? `<span class="participating-fam">${escapeHtml(fam.name)}</span>` : "";
    return `<a class="participating-pill" href="siege.html?guild=${encodeURIComponent(g)}">
      <span class="participating-guild">${escapeHtml(g)}</span>
      ${famLabel}
      ${s.total > 0 ? `<span class="participating-pct">${s.pct}%</span>` : ""}
    </a>`;
  }).join("");
}

function renderGuidelines(text) {
  const c = document.querySelector("#guidelinesContent");
  if (!c) return;
  if (!text || !text.trim()) {
    c.innerHTML = `<p class="hint">지침이 아직 등록되지 않았습니다.</p>`;
    return;
  }
  c.innerHTML = `<div>${escapeHtml(text)}</div>`;
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

// 어떤 성을 어떤 문파가 차지하고 있는지 매핑
function castlesByGuild(lords) {
  const map = new Map();
  Object.entries(lords || {}).forEach(([castle, info]) => {
    if (info && info.guild) {
      const g = info.guild;
      if (!map.has(g)) map.set(g, []);
      map.get(g).push(castle);
    }
  });
  return map;
}

function renderGrid(members, entries, lords) {
  const range = thisWeekRange();
  const weekEntries = entries.filter((e) => inRange(e.dateKst, range.start, range.end));
  const bestMap = bestPerNick(weekEntries);
  const castleMap = castlesByGuild(lords || {});

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

  // 이번주 참전 문파 목록 (1건이라도 신청한 문파)
  const participatingGuilds = new Set();
  weekEntries.forEach((e) => {
    if (e.guild) participatingGuilds.add(e.guild.trim());
  });
  // entries 에 guild 가 없을 수도 있으므로 (구 데이터), 닉네임 → 문파 매핑으로도 보완
  const nickToGuild = new Map();
  members.forEach((m) => {
    const k = (m.nickname || "").trim().toLowerCase();
    if (k && m.guild) nickToGuild.set(k, m.guild);
  });
  weekEntries.forEach((e) => {
    if (!e.guild) {
      const g = nickToGuild.get((e.nickname || "").trim().toLowerCase());
      if (g) participatingGuilds.add(g);
    }
  });
  renderParticipating(Array.from(participatingGuilds), guildStats);

  // 그리드
  const grid = $("#familyGrid");
  grid.innerHTML = ALLIANCE.families.map((fam) => {
    const isLeaderFam = fam.guilds.includes(ALLIANCE.leader.guild);
    const famTotal = fam.guilds.reduce((acc, g) => acc + (guildStats(g).total || 0), 0);
    const famSubmitted = fam.guilds.reduce((acc, g) => acc + (guildStats(g).submitted || 0), 0);
    const famPct = famTotal > 0 ? Math.round((famSubmitted / famTotal) * 100) : 0;

    // 이 계에 속한 문파가 차지한 성들
    const famCastles = [];
    fam.guilds.forEach((g) => {
      const cs = castleMap.get(g);
      if (cs) cs.forEach((c) => famCastles.push({ guild: g, castle: c }));
    });

    const guildCards = fam.guilds.map((g) => {
      const s = guildStats(g);
      const isLeader = g === ALLIANCE.leader.guild;
      const myCastles = castleMap.get(g) || [];
      const url = `siege.html?guild=${encodeURIComponent(g)}`;
      const tagPills = [];
      if (isLeader) tagPills.push(`<span class="leader-badge">👑 연합장</span>`);
      myCastles.forEach((c) => tagPills.push(`<span class="castle-lord-badge">🏰 ${escapeHtml(c).replace("성","")}</span>`));
      const castleBadges = tagPills.length
        ? `<div class="castle-tags">${tagPills.join("")}</div>`
        : "";
      // 원형 progress (SVG)
      const circ = 2 * Math.PI * 18;
      const offset = circ * (1 - s.pct / 100);
      const pctColor = s.pct >= 80 ? "#69d586" : s.pct >= 40 ? "#FFCC00" : s.pct > 0 ? "#ff8a82" : "#3a424e";
      return `<a href="${url}" class="guild-card ${isLeader ? "is-leader" : ""} ${myCastles.length ? "is-castle-lord" : ""}" title="${escapeHtml(g)} 신청 페이지로">
        <div class="guild-name">${escapeHtml(g)}</div>
        <div class="ring-wrap">
          <svg class="guild-ring" viewBox="0 0 48 48" aria-hidden="true">
            <circle class="ring-bg" cx="24" cy="24" r="18" />
            <circle class="ring-fg" cx="24" cy="24" r="18"
              style="stroke: ${pctColor}; stroke-dasharray: ${circ}; stroke-dashoffset: ${offset};" />
          </svg>
          <span class="ring-pct">${s.pct}<small>%</small></span>
        </div>
        <div class="guild-meta">총원 ${s.total}</div>
        ${castleBadges}
      </a>`;
    }).join("");

    const famPills = [];
    if (isLeaderFam) famPills.push(`<span class="family-leader-badge">👑 연합장 문파</span>`);
    famCastles.forEach((x) => famPills.push(`<span class="family-castle-badge">🏰 ${escapeHtml(x.castle)}주 (${escapeHtml(x.guild)})</span>`));
    const famBadgeLine = famPills.length ? `<div class="family-castle-line">${famPills.join(" ")}</div>` : "";

    return `
      <div class="family-card ${isLeaderFam ? "is-leader" : ""} ${famCastles.length ? "has-castle" : ""}" data-family="${escapeHtml(fam.name)}">
        <div class="family-header">
          <div class="family-title">
            <span class="family-name">${escapeHtml(fam.name)}</span>
            ${famBadgeLine}
          </div>
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

async function apiBootstrap() {
  try {
    const res = await fetch(`${getEndpoint()}?action=bootstrap`);
    if (!res.ok) return null;
    const d = await res.json();
    if (!d.ok) return null;
    writeCache("members", d.members || []);
    writeCache("entries", d.entries || []);
    writeCache("lords", d.lords || {});
    writeCache("guidelines", d.guidelines || "");
    return d;
  } catch { return null; }
}

async function init() {
  renderTodayBanner();
  setInterval(renderTodayBanner, 60 * 1000);

  // SW 등록 (있으면)
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  // 1) 캐시 즉시 표시 (있으면)
  const cMembers = readCache("members") || [];
  const cEntries = readCache("entries") || [];
  const cLords = readCache("lords") || {};
  const cGuidelines = readCache("guidelines");
  const hasCache = cMembers.length || cEntries.length || Object.keys(cLords).length || cGuidelines;
  if (hasCache) {
    renderGrid(cMembers, cEntries, cLords);
    renderCastleLords(cLords);
    if (typeof cGuidelines === "string") renderGuidelines(cGuidelines);
  } else {
    renderGrid([], [], {});
  }

  // 2) 백그라운드로 최신 데이터 페치 → 다시 렌더
  // bootstrap (단일 호출) 우선 시도. 실패 시 개별 호출로 폴백.
  const boot = await apiBootstrap();
  if (boot) {
    renderGrid(boot.members || [], boot.entries || [], boot.lords || {});
    renderCastleLords(boot.lords || {});
    renderGuidelines(boot.guidelines || "");
  } else {
    const [members, entries, lords, guidelines] = await Promise.all([
      apiMembers(), apiList(), apiCastleLords(), apiGuidelines(),
    ]);
    renderGrid(members, entries, lords);
    renderCastleLords(lords);
    renderGuidelines(guidelines);
  }
}

document.addEventListener("DOMContentLoaded", init);
