// =================================================
// 주스터콜/EU연합 - 관리자 대시보드
// =================================================

const ADMIN_PW_KEY = "juseter_admin_pw";
const DEFAULT_ENDPOINT = "https://script.google.com/macros/s/AKfycbwuCTkMYPDZoQIXe63N5aFf0W-ViJeo8LX4kfspdmt9qporNmgJPWdFAH6GUy2JyN2x5A/exec";

// EU 연합 구조 (수동 관리)
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

function allGuilds() {
  const out = [];
  ALLIANCE.families.forEach((f) => f.guilds.forEach((g) => out.push({ family: f.name, guild: g })));
  return out;
}

function guildToFamily(guild) {
  const g = (guild || "").trim();
  for (const f of ALLIANCE.families) {
    if (f.guilds.includes(g)) return f.name;
  }
  return "";
}

// ---- DOM helpers ----
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function pad2(n) { return String(n).padStart(2, "0"); }

// ---- Endpoint / API ----

function getEndpoint() {
  return localStorage.getItem("juseter_endpoint") || DEFAULT_ENDPOINT;
}

function getPassword() {
  return sessionStorage.getItem(ADMIN_PW_KEY) || "";
}
function setPassword(pw) {
  if (pw) sessionStorage.setItem(ADMIN_PW_KEY, pw);
  else sessionStorage.removeItem(ADMIN_PW_KEY);
}

async function api(payload) {
  const ep = getEndpoint();
  const res = await fetch(ep, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...payload, password: getPassword() }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data;
}

async function apiGet(action) {
  const ep = getEndpoint();
  const res = await fetch(`${ep}?action=${encodeURIComponent(action)}`, { method: "GET" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---- Login ----

async function tryLogin(pw) {
  setPassword(pw);
  try {
    const r = await api({ action: "admin:checkPw" });
    if (r && r.ok) return true;
  } catch (_) {}
  setPassword("");
  return false;
}

function showLogin() {
  $("#adminMain").hidden = true;
  $("#topActions").hidden = true;
  const dlg = $("#loginDialog");
  if (!dlg.open) dlg.showModal();
}

function hideLogin() {
  $("#adminMain").hidden = false;
  $("#topActions").hidden = false;
  const dlg = $("#loginDialog");
  if (dlg.open) dlg.close("login");
}

async function attemptLogin(e) {
  if (e) e.preventDefault();
  const pw = $("#pwInput").value.trim();
  const errEl = $("#loginError");
  errEl.hidden = true;
  if (!pw) { errEl.textContent = "비밀번호 입력"; errEl.hidden = false; return; }
  $("#loginBtn").disabled = true;
  $("#loginBtn").textContent = "확인 중…";
  const ok = await tryLogin(pw);
  $("#loginBtn").disabled = false;
  $("#loginBtn").textContent = "로그인";
  if (ok) {
    hideLogin();
    loadAll();
  } else {
    errEl.textContent = "비밀번호가 틀렸습니다";
    errEl.hidden = false;
  }
}

function logout() {
  setPassword("");
  $("#pwInput").value = "";
  showLogin();
}

// ---- Stats rendering ----

let cachedMembers = [];
let currentGuildFilter = "all"; // for filtering display

async function loadAll() {
  await Promise.all([
    loadWeekly(),
    loadComparison(),
    loadMonthly(),
    loadMembersList(),
  ]);
}

async function loadWeekly() {
  const tbody = $("#memberStatsTbody");
  tbody.innerHTML = `<tr><td colspan="6" class="empty">로딩 중…</td></tr>`;
  try {
    const r = await api({ action: "stats:weekly" });
    if (!r.ok) throw new Error(r.error || "조회 실패");
    renderWeekly(r);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">에러: ${escapeHtml(err.message)}</td></tr>`;
    $("#kpiSubmitted").textContent = "-";
    $("#kpiPercentage").textContent = "-";
  }
}

function renderWeekly(r) {
  $("#kpiSubmitted").textContent = `${r.submittedCount} / ${r.totalMembers}`;
  $("#kpiPercentage").textContent = `${r.percentage}%`;
  $("#kpiPeriod").textContent = `${(r.period.start || "").slice(5)} ~ ${(r.period.end || "").slice(5)}`;
  $("#progressFill").style.width = `${Math.min(100, r.percentage)}%`;

  const ec = r.eliteCounts || {};
  const eliteO = ec["O"] || 0;
  const eliteMax = ec["최대한 참여"] || 0;
  $("#kpiElite").textContent = `${eliteO}+${eliteMax}`;

  const breakdown = $("#eliteBreakdown");
  breakdown.innerHTML = `
    <span class="elite-pill elite-O">⭕ 참전 ${eliteO}</span>
    <span class="elite-pill elite-MAX">⏳ 최대한 ${eliteMax}</span>
    <span class="elite-pill elite-X">❌ 불참 ${ec["X"] || 0}</span>
  `;

  // 신청자/미신청자 테이블
  const filterMode = $("#memberFilter").value;
  let rows = r.members.slice();
  // 정렬: 미신청자 먼저, 그다음 점수 높은 순
  rows.sort((a, b) => {
    if (a.submitted !== b.submitted) return a.submitted ? 1 : -1;
    return (parseFloat(b.score) || 0) - (parseFloat(a.score) || 0);
  });
  if (filterMode === "submitted") rows = rows.filter((x) => x.submitted);
  else if (filterMode === "notSubmitted") rows = rows.filter((x) => !x.submitted);

  const tbody = $("#memberStatsTbody");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">해당 조건에 일치하는 문원이 없습니다</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((m) => {
    if (m.submitted) {
      return `<tr>
        <td>${escapeHtml(m.nickname)}</td>
        <td class="status-submitted">✓ 신청</td>
        <td class="num">${escapeHtml(m.score || "")}</td>
        <td>${renderElitePill(m.elite)}</td>
        <td>${escapeHtml(m.castle || "")}</td>
        <td>${escapeHtml((m.dateKst || "").slice(5, 16))}</td>
      </tr>`;
    }
    return `<tr>
      <td>${escapeHtml(m.nickname)}</td>
      <td class="status-not">✗ 미신청</td>
      <td class="num">-</td><td>-</td><td>-</td><td>-</td>
    </tr>`;
  }).join("");

  // 비문원 등록 시도
  if (r.nonMemberEntries && r.nonMemberEntries.length) {
    $("#nonMemberSection").hidden = false;
    $("#nonMemberTbody").innerHTML = r.nonMemberEntries.map((e) => `<tr>
      <td>${escapeHtml(e.nickname)}</td>
      <td class="num">${escapeHtml(e.score)}</td>
      <td>${escapeHtml(e.castle || "")}</td>
      <td>${escapeHtml((e.dateKst || "").slice(5, 16))}</td>
    </tr>`).join("");
  } else {
    $("#nonMemberSection").hidden = true;
  }
}

function renderElitePill(v) {
  v = (v || "").trim();
  if (v === "O") return `<span class="elite-pill elite-O">⭕</span>`;
  if (v === "X") return `<span class="elite-pill elite-X">❌</span>`;
  if (v === "최대한 참여" || v === "최대") return `<span class="elite-pill elite-MAX">⏳</span>`;
  return `<span style="color:var(--muted)">-</span>`;
}

async function loadComparison() {
  const tbody = $("#comparisonTbody");
  tbody.innerHTML = `<tr><td colspan="4" class="empty">로딩 중…</td></tr>`;
  try {
    const r = await api({ action: "stats:comparison" });
    if (!r.ok) throw new Error(r.error || "");
    const rows = r.rows
      .filter((x) => x.thisScore !== null || x.lastScore !== null)
      .sort((a, b) => (b.diff ?? -Infinity) - (a.diff ?? -Infinity));
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty">비교할 데이터가 없습니다 (지난주/이번주 모두 미신청)</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((row) => {
      const tEsc = row.thisScore !== null ? row.thisScore.toFixed(2) : "-";
      const lEsc = row.lastScore !== null ? row.lastScore.toFixed(2) : "-";
      let diffHtml = `<span class="diff-zero">-</span>`;
      if (row.diff !== null) {
        const sign = row.diff > 0 ? "+" : "";
        const cls = row.diff > 0 ? "diff-pos" : row.diff < 0 ? "diff-neg" : "diff-zero";
        diffHtml = `<span class="${cls}">${sign}${row.diff.toFixed(2)}</span>`;
      }
      return `<tr>
        <td>${escapeHtml(row.nickname)}</td>
        <td class="num">${lEsc}</td>
        <td class="num">${tEsc}</td>
        <td class="num">${diffHtml}</td>
      </tr>`;
    }).join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty">에러: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function loadMonthly() {
  const tbody = $("#monthlyTbody");
  tbody.innerHTML = `<tr><td colspan="5" class="empty">로딩 중…</td></tr>`;
  try {
    const r = await api({ action: "stats:monthly" });
    if (!r.ok) throw new Error(r.error || "");
    const rows = r.rows.filter((x) => x.count > 0);
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty">최근 28일 데이터가 없습니다</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((row) => {
      const first = row.firstScore !== null ? row.firstScore.toFixed(2) : "-";
      const last = row.lastScore !== null ? row.lastScore.toFixed(2) : "-";
      let diffHtml = `<span class="diff-zero">-</span>`;
      if (row.diff !== null) {
        const sign = row.diff > 0 ? "+" : "";
        const cls = row.diff > 0 ? "diff-pos" : row.diff < 0 ? "diff-neg" : "diff-zero";
        diffHtml = `<span class="${cls}">${sign}${row.diff.toFixed(2)}</span>`;
      }
      return `<tr>
        <td>${escapeHtml(row.nickname)}</td>
        <td class="num">${first}</td>
        <td class="num">${last}</td>
        <td class="num">${diffHtml}</td>
        <td class="num">${row.count}</td>
      </tr>`;
    }).join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">에러: ${escapeHtml(err.message)}</td></tr>`;
  }
}

// ---- Member management ----

async function loadMembersList() {
  try {
    const r = await apiGet("members");
    if (!r.ok) throw new Error(r.error || "");
    cachedMembers = r.members || [];
    renderMembersList();
  } catch (err) {
    $("#memberList").innerHTML = `<div class="hint error">에러: ${escapeHtml(err.message)}</div>`;
  }
}

function renderMembersList() {
  $("#memberCountLabel").textContent = `총 ${cachedMembers.length}명`;
  const wrap = $("#memberList");
  if (!cachedMembers.length) {
    wrap.innerHTML = `<div class="hint">등록된 문원이 없습니다. 위 '일괄 등록' 으로 시작해 주세요.</div>`;
    return;
  }
  // group by guild
  const byGuild = new Map();
  cachedMembers.forEach((m) => {
    const g = m.guild || "(미지정)";
    if (!byGuild.has(g)) byGuild.set(g, []);
    byGuild.get(g).push(m);
  });

  const sections = [];
  ALLIANCE.families.forEach((fam) => {
    fam.guilds.forEach((g) => {
      const list = byGuild.get(g);
      if (!list) return;
      sections.push({ guild: g, family: fam.name, members: list });
      byGuild.delete(g);
    });
  });
  // any remaining (unknown guild)
  byGuild.forEach((list, g) => sections.push({ guild: g, family: "", members: list }));

  wrap.innerHTML = sections.map((s) => {
    const isLeaderGuild = s.guild === ALLIANCE.leader.guild;
    return `
      <div class="member-group">
        <div class="member-group-header">
          <strong>${escapeHtml(s.guild)}</strong>
          <span class="member-group-meta">${escapeHtml(s.family)} · ${s.members.length}명${isLeaderGuild ? ' · 👑 연합장 문파' : ''}</span>
        </div>
        <div class="member-group-list">
          ${s.members.map((m) => `
            <span class="member-chip" data-nick="${escapeHtml(m.nickname)}">
              ${escapeHtml(m.nickname)}${m.nickname === ALLIANCE.leader.nickname ? ' 👑' : ''}
              <button type="button" data-remove="${escapeHtml(m.nickname)}" title="삭제">✕</button>
            </span>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");

  $$("#memberList button[data-remove]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const nick = btn.dataset.remove;
      if (!confirm(`정말로 [${nick}] 을(를) 명단에서 제거할까요?`)) return;
      try {
        const r = await api({ action: "members:remove", nickname: nick });
        if (!r.ok) throw new Error(r.error || "");
        await loadMembersList();
        await loadWeekly();
      } catch (err) {
        alert("삭제 실패: " + err.message);
      }
    });
  });
}

async function handleSaveBulk() {
  const text = $("#bulkArea").value;
  // 파싱: 한 줄 한 항목. 형식 지원:
  //   1) "닉네임"                    → guild/family 미지정
  //   2) "닉네임, 문파"              → family 자동
  //   3) "닉네임, 문파, 비고"
  const lines = text.split(/\r?\n/);
  const list = [];
  for (const ln of lines) {
    const s = ln.trim();
    if (!s) continue;
    const parts = s.split(/[,\t|]/).map((p) => p.trim());
    const nickname = parts[0];
    if (!nickname) continue;
    const guild = parts[1] || "";
    const family = guildToFamily(guild) || "";
    const role = parts[2] || "";
    list.push({ nickname, guild, family, role });
  }
  if (!list.length) { alert("빈 입력입니다. 닉네임을 한 줄에 하나씩 입력해 주세요."); return; }
  if (!confirm(`총 ${list.length}명을 등록합니다. 기존 명단은 모두 교체됩니다. 계속할까요?`)) return;
  $("#saveBulkBtn").disabled = true;
  try {
    const r = await api({ action: "members:set", members: list, replaceGuild: "all" });
    if (!r.ok) throw new Error(r.error || "");
    alert(`저장 완료: ${r.count}명`);
    $("#bulkArea").value = "";
    await loadMembersList();
    await loadWeekly();
  } catch (err) {
    alert("저장 실패: " + err.message);
  } finally {
    $("#saveBulkBtn").disabled = false;
  }
}

function handleLoadCurrent() {
  if (!cachedMembers.length) {
    $("#bulkArea").value = "";
    return;
  }
  const lines = cachedMembers
    .map((m) => [m.nickname, m.guild || "", m.role || ""].filter(Boolean).join(", "))
    .join("\n");
  $("#bulkArea").value = lines;
}

async function handleAddMember() {
  const input = $("#newMemberInput");
  const nickname = input.value.trim();
  if (!nickname) return;
  // simple prompt for guild
  const guild = prompt(`[${nickname}] 의 문파는? (예: 주스터콜, 쿠데타, 매화…)`, "");
  if (guild === null) return;
  const family = guildToFamily(guild.trim()) || "";
  try {
    const r = await api({ action: "members:add", nickname, guild: guild.trim(), family });
    if (!r.ok) throw new Error(r.error || "");
    input.value = "";
    await loadMembersList();
    await loadWeekly();
  } catch (err) {
    alert("추가 실패: " + err.message);
  }
}

// ---- Init ----

function init() {
  // Login form
  $("#loginForm").addEventListener("submit", attemptLogin);
  $("#loginBtn").addEventListener("click", attemptLogin);
  $("#logoutBtn").addEventListener("click", logout);

  // Filters
  $("#memberFilter").addEventListener("change", loadWeekly);
  $("#reloadComparisonBtn").addEventListener("click", loadComparison);
  $("#reloadMonthlyBtn").addEventListener("click", loadMonthly);

  // Member mgmt
  $("#saveBulkBtn").addEventListener("click", handleSaveBulk);
  $("#loadCurrentBtn").addEventListener("click", handleLoadCurrent);
  $("#addMemberBtn").addEventListener("click", handleAddMember);
  $("#newMemberInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); handleAddMember(); }
  });

  // 로그인 상태 확인
  if (getPassword()) {
    tryLogin(getPassword()).then((ok) => {
      if (ok) {
        hideLogin();
        loadAll();
      } else {
        showLogin();
      }
    });
  } else {
    showLogin();
  }
}

document.addEventListener("DOMContentLoaded", init);
