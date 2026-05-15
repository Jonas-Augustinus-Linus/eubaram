// =================================================
// 주스터콜/EU연합 - 관리자 대시보드
// =================================================

const ADMIN_USER_KEY = "juseter_admin_user";
const ADMIN_PW_KEY = "juseter_admin_pw";
const ADMIN_SCOPE_KEY = "juseter_admin_scope";
const DEFAULT_ENDPOINT = "https://script.google.com/macros/s/AKfycbwuCTkMYPDZoQIXe63N5aFf0W-ViJeo8LX4kfspdmt9qporNmgJPWdFAH6GUy2JyN2x5A/exec";

// EU 연합 구조 (수동 관리)
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

function getUsername() { return sessionStorage.getItem(ADMIN_USER_KEY) || ""; }
function setUsername(u) { if (u) sessionStorage.setItem(ADMIN_USER_KEY, u); else sessionStorage.removeItem(ADMIN_USER_KEY); }
function getPassword() { return sessionStorage.getItem(ADMIN_PW_KEY) || ""; }
function setPassword(pw) { if (pw) sessionStorage.setItem(ADMIN_PW_KEY, pw); else sessionStorage.removeItem(ADMIN_PW_KEY); }
function getScope() { return sessionStorage.getItem(ADMIN_SCOPE_KEY) || ""; }
function setScope(s) { if (s) sessionStorage.setItem(ADMIN_SCOPE_KEY, s); else sessionStorage.removeItem(ADMIN_SCOPE_KEY); }

async function api(payload) {
  const ep = getEndpoint();
  const guildFilter = currentGuildFilter !== "all" ? currentGuildFilter : "";
  const res = await fetch(ep, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      ...payload,
      username: getUsername(),
      password: getPassword(),
      ...(guildFilter ? { guildFilter } : {}),
    }),
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

async function tryLogin(user, pw) {
  setUsername(user);
  setPassword(pw);
  try {
    const r = await api({ action: "admin:login" });
    if (r && r.ok) {
      setScope(r.scope || "");
      return { scope: r.scope || "", error: null };
    }
    return { scope: null, error: r && r.error ? r.error : "아이디/비밀번호 불일치" };
  } catch (err) {
    console.error("login error:", err);
    return { scope: null, error: `요청 실패: ${err.message}` };
  } finally {
    // 실패시 정리는 attemptLogin 에서
  }
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
  const user = $("#userInput").value.trim();
  const pw = $("#pwInput").value.trim();
  const errEl = $("#loginError");
  errEl.hidden = true;
  if (!user || !pw) { errEl.textContent = "아이디/비밀번호 입력"; errEl.hidden = false; return; }
  $("#loginBtn").disabled = true;
  $("#loginBtn").textContent = "확인 중…";
  const result = await tryLogin(user, pw);
  $("#loginBtn").disabled = false;
  $("#loginBtn").textContent = "로그인";
  if (result.scope !== null) {
    applyScope(result.scope);
    hideLogin();
    loadAll();
  } else {
    setUsername("");
    setPassword("");
    setScope("");
    errEl.textContent = result.error || "로그인 실패";
    errEl.hidden = false;
  }
}

function logout() {
  setUsername("");
  setPassword("");
  setScope("");
  $("#pwInput").value = "";
  $("#userInput").value = "";
  showLogin();
}

function guildsInScope(scope) {
  if (!scope || scope === "all") {
    const out = [];
    ALLIANCE.families.forEach((f) => f.guilds.forEach((g) => out.push(g)));
    return out;
  }
  const fam = ALLIANCE.families.find((f) => f.name === scope);
  if (fam) return fam.guilds.slice();
  return [scope];
}

function applyScope(scope) {
  const tag = $("#scopeTag");
  if (tag) {
    if (scope === "all") {
      tag.textContent = "👑 전체 관리자";
      tag.className = "scope-tag scope-all";
    } else if (scope) {
      tag.textContent = `📌 ${scope} 관리자`;
      tag.className = "scope-tag scope-family";
    } else {
      tag.textContent = "";
      tag.className = "scope-tag";
    }
  }
  // scope-all-only 섹션은 전체 관리자에게만 보임
  document.querySelectorAll(".scope-all-only").forEach((el) => {
    el.hidden = scope !== "all";
  });
  // 문파 필터: 스코프 내 문파들로 채움 (스코프=all 이면 전체)
  populateGuildFilter(scope);
  currentGuildFilter = "all";
}

function populateGuildFilter(scope) {
  const gf = $("#guildFilter");
  if (!gf) return;
  const guilds = guildsInScope(scope);
  // 하나뿐이면 dropdown 숨김
  if (guilds.length <= 1) {
    gf.hidden = true;
    gf.innerHTML = `<option value="all" selected>${guilds[0] || "전체"}</option>`;
    return;
  }
  gf.hidden = false;
  const label = scope === "all" ? "🔍 전체 문파" : `🔍 ${scope} 전체`;
  // selected 속성을 명시적으로 부여
  gf.innerHTML = `<option value="all" selected>${label}</option>` +
    guilds.map((g) => `<option value="${g}">${g}</option>`).join("");
  gf.value = "all";
  gf.selectedIndex = 0;
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
    loadCastleLords(),
    loadGuidelines(),
    loadAccountList(),
  ]);
  populateGuildDatalist();
}

function populateGuildDatalist() {
  const dl = document.querySelector("#guildOptions");
  if (!dl) return;
  const all = [];
  ALLIANCE.families.forEach((f) => f.guilds.forEach((g) => all.push(g)));
  dl.innerHTML = all.map((g) => `<option value="${g}">`).join("");

  // 계정 추가 dropdown 도 동시에 채우기 (계 스코프)
  const acctScope = document.querySelector("#acctScope");
  if (acctScope && acctScope.options.length <= 2) {
    const opts = ['<option value="">계 선택…</option>', '<option value="all">전체 (총관리자)</option>'];
    ALLIANCE.families.forEach((f) => {
      opts.push(`<option value="${f.name}">${f.name}</option>`);
    });
    acctScope.innerHTML = opts.join("");
  }
}

async function loadAccountList() {
  const wrap = document.querySelector("#accountList");
  if (!wrap) return;
  try {
    const r = await api({ action: "admin:accounts:list" });
    if (!r.ok) {
      wrap.innerHTML = "";
      return;
    }
    const list = r.accounts || [];
    if (!list.length) {
      wrap.innerHTML = `<div class="hint">계정 없음</div>`;
      return;
    }
    wrap.innerHTML = list.map((acc) => `
      <div class="acct-row">
        <span class="acct-user">${escapeHtml(acc.username)}</span>
        <span class="acct-scope ${acc.scope === 'all' ? 'super' : ''}">${escapeHtml(acc.scope || '미지정')}</span>
        ${acc.username.toLowerCase() === 'admin' ? '' : `<button type="button" class="ghost small-btn" data-remove="${escapeHtml(acc.username)}">삭제</button>`}
      </div>
    `).join("");
    wrap.querySelectorAll('button[data-remove]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        const u = btn.dataset.remove;
        if (!confirm(`[${u}] 계정을 정말 삭제할까요?`)) return;
        try {
          const r = await api({ action: "admin:accounts:remove", targetUsername: u });
          if (!r.ok) throw new Error(r.error || "");
          await loadAccountList();
        } catch (err) {
          alert("삭제 실패: " + err.message);
        }
      });
    });
  } catch (err) {
    wrap.innerHTML = `<div class="hint error">${escapeHtml(err.message)}</div>`;
  }
}

async function handleSaveAccount() {
  const user = document.querySelector("#acctUser").value.trim();
  const pw = document.querySelector("#acctPw").value;
  const scope = document.querySelector("#acctScope").value;
  const msg = document.querySelector("#acctMsg");
  msg.className = "hint";
  if (!user) { msg.textContent = "아이디 입력"; msg.className = "hint error"; return; }
  if (!pw || pw.length < 3) { msg.textContent = "비밀번호 3자 이상"; msg.className = "hint error"; return; }
  if (!scope) { msg.textContent = "권한 범위 선택"; msg.className = "hint error"; return; }
  try {
    const r = await api({ action: "admin:accounts:set", targetUsername: user, newPassword: pw, scope });
    if (!r.ok) throw new Error(r.error || "");
    msg.textContent = "저장 완료 ✓";
    msg.className = "hint success";
    document.querySelector("#acctUser").value = "";
    document.querySelector("#acctPw").value = "";
    document.querySelector("#acctScope").value = "";
    await loadAccountList();
  } catch (err) {
    msg.textContent = "실패: " + err.message;
    msg.className = "hint error";
  }
}

async function loadCastleLords() {
  try {
    const res = await fetch(`${getEndpoint()}?action=castleLords`);
    if (!res.ok) return;
    const d = await res.json();
    const lords = d.lords || {};
    ["주작성", "현무성", "청룡성", "백호성"].forEach((c) => {
      const row = document.querySelector(`.cl-row[data-castle="${c}"]`);
      if (!row) return;
      const l = lords[c];
      const guildIn = row.querySelector('[data-field="guild"]');
      if (guildIn) guildIn.value = l && l.guild ? l.guild : "";
    });
  } catch (err) {
    console.warn("성주 현황 로드 실패:", err);
  }
}

async function saveCastleLord(castle) {
  const row = document.querySelector(`.cl-row[data-castle="${castle}"]`);
  if (!row) return;
  const guild = row.querySelector('[data-field="guild"]').value.trim();
  const btn = row.querySelector('button');
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = "…";
  try {
    const r = await api({ action: "castleLord:set", castle, guild });
    if (!r.ok) throw new Error(r.error || "");
    btn.textContent = "✓";
    setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1500);
  } catch (err) {
    btn.textContent = orig;
    btn.disabled = false;
    alert("저장 실패: " + err.message);
  }
}

async function loadGuidelines() {
  try {
    const res = await fetch(`${getEndpoint()}?action=guidelines`);
    if (!res.ok) return;
    const d = await res.json();
    const ta = document.querySelector("#guidelinesArea");
    if (ta) ta.value = d.text || "";
  } catch (err) {
    console.warn("지침 로드 실패:", err);
  }
}

async function saveGuidelines() {
  const ta = document.querySelector("#guidelinesArea");
  const msgEl = document.querySelector("#guidelinesMsg");
  const text = ta ? ta.value : "";
  if (msgEl) { msgEl.textContent = "저장 중…"; msgEl.className = "hint"; }
  try {
    const r = await api({ action: "guidelines:set", text });
    if (!r.ok) throw new Error(r.error || "");
    if (msgEl) { msgEl.textContent = "저장 완료 ✓"; msgEl.className = "hint success"; }
  } catch (err) {
    if (msgEl) { msgEl.textContent = "저장 실패: " + err.message; msgEl.className = "hint error"; }
  }
}

async function changeAdminPw() {
  const newPw = document.querySelector("#newPwInput").value.trim();
  const confirmPw = document.querySelector("#newPwConfirm").value.trim();
  const msgEl = document.querySelector("#pwChangeMsg");
  msgEl.className = "hint";
  if (!newPw || newPw.length < 3) {
    msgEl.textContent = "비밀번호는 3자 이상이어야 합니다";
    msgEl.className = "hint error";
    return;
  }
  if (newPw !== confirmPw) {
    msgEl.textContent = "두 입력값이 다릅니다";
    msgEl.className = "hint error";
    return;
  }
  msgEl.textContent = "변경 중…";
  try {
    const r = await api({ action: "admin:changePw", newPassword: newPw });
    if (!r.ok) throw new Error(r.error || "");
    setPassword(newPw);
    msgEl.textContent = "비밀번호 변경 완료 ✓";
    msgEl.className = "hint success";
    document.querySelector("#newPwInput").value = "";
    document.querySelector("#newPwConfirm").value = "";
  } catch (err) {
    msgEl.textContent = "실패: " + err.message;
    msgEl.className = "hint error";
  }
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

// ---- 문원 OCR 일괄 추출 ----

let memberOcrFiles = [];
const MEMBER_OCR_MAX = 15;

let _tesseractLoadingPromise = null;
function ensureTesseractLoaded() {
  if (typeof Tesseract !== "undefined") return Promise.resolve();
  if (_tesseractLoadingPromise) return _tesseractLoadingPromise;
  _tesseractLoadingPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Tesseract.js 로드 실패"));
    document.head.appendChild(s);
  });
  return _tesseractLoadingPromise;
}

function setupMemberOcr() {
  const fileInput = $("#memberOcrFiles");
  const runBtn = $("#runOcrBtn");
  const clearBtn = $("#clearOcrBtn");
  const guildSel = $("#ocrGuildPick");
  if (!fileInput || !runBtn || !clearBtn || !guildSel) return;

  // 문파 dropdown 채우기 (계 → 문파 그룹)
  const opts = ['<option value="">문파 선택 (선택)</option>'];
  ALLIANCE.families.forEach((f) => {
    opts.push(`<optgroup label="${escapeHtml(f.name)}">`);
    f.guilds.forEach((g) => opts.push(`<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`));
    opts.push(`</optgroup>`);
  });
  guildSel.innerHTML = opts.join("");

  fileInput.addEventListener("change", () => {
    const picked = Array.from(fileInput.files || []);
    const remaining = MEMBER_OCR_MAX - memberOcrFiles.length;
    const toAdd = picked.slice(0, Math.max(0, remaining));
    memberOcrFiles.push(...toAdd);
    if (memberOcrFiles.length > MEMBER_OCR_MAX) memberOcrFiles = memberOcrFiles.slice(0, MEMBER_OCR_MAX);
    fileInput.value = ""; // allow re-picking same files
    renderOcrPreviews();
    if (picked.length > remaining) {
      $("#ocrResultMsg").textContent = `⚠️ 최대 ${MEMBER_OCR_MAX}장까지만 가능합니다 (${picked.length - remaining}장 무시됨)`;
      $("#ocrResultMsg").className = "hint error";
    }
  });

  runBtn.addEventListener("click", runMemberOcr);
  clearBtn.addEventListener("click", () => {
    memberOcrFiles = [];
    renderOcrPreviews();
    $("#ocrResultMsg").textContent = "";
    $("#ocrResultMsg").className = "hint";
    $("#ocrProgress").hidden = true;
  });
}

function renderOcrPreviews() {
  const wrap = $("#ocrPreviews");
  const runBtn = $("#runOcrBtn");
  const clearBtn = $("#clearOcrBtn");
  if (!wrap || !runBtn || !clearBtn) return;

  if (!memberOcrFiles.length) {
    wrap.innerHTML = "";
    runBtn.disabled = true;
    clearBtn.disabled = true;
    return;
  }
  runBtn.disabled = false;
  clearBtn.disabled = false;

  // revoke previous URLs to avoid leaks
  wrap.querySelectorAll("img").forEach((img) => {
    if (img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);
  });

  wrap.innerHTML = memberOcrFiles.map((f, i) => {
    const url = URL.createObjectURL(f);
    return `<div class="ocr-thumb" data-idx="${i}">
      <img src="${url}" alt="">
      <span class="ocr-thumb-idx">${i + 1}</span>
      <button type="button" class="ocr-thumb-remove" data-rm="${i}" title="제거">✕</button>
    </div>`;
  }).join("");

  wrap.querySelectorAll("button[data-rm]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = parseInt(btn.dataset.rm, 10);
      memberOcrFiles.splice(i, 1);
      renderOcrPreviews();
    });
  });
}

// 이미지 리사이즈 + JPEG 압축 (Apps Script 업로드 페이로드 최소화)
async function resizeImage(file, maxDim = 1600, quality = 0.85) {
  const dataUrl = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = dataUrl;
  });
  const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.round(img.width * ratio);
  const h = Math.round(img.height * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = fr.result || "";
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

async function callServerOcr(blob) {
  const ep = getEndpoint();
  if (!ep) throw new Error("엔드포인트 미설정");
  const b64 = await blobToBase64(blob);
  const res = await fetch(ep, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "ocr", image: b64, mime: blob.type || "image/jpeg" }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "OCR 실패");
  return data.text || "";
}

async function tesseractOcr(file) {
  await ensureTesseractLoaded();
  const blob = await preprocessImageForOcr(file).catch(() => file);
  const { data: { text } } = await Tesseract.recognize(blob, "kor");
  return text || "";
}

async function runMemberOcr() {
  if (!memberOcrFiles.length) return;

  const runBtn = $("#runOcrBtn");
  const clearBtn = $("#clearOcrBtn");
  const pickLabel = document.querySelector(".ocr-pick-label");
  const guildSel = $("#ocrGuildPick");
  const progress = $("#ocrProgress");
  const fill = $("#ocrProgressFill");
  const txt = $("#ocrProgressText");
  const msg = $("#ocrResultMsg");

  const guild = guildSel.value || "";

  runBtn.disabled = true;
  clearBtn.disabled = true;
  if (pickLabel) pickLabel.style.pointerEvents = "none";
  progress.hidden = false;
  msg.textContent = "";
  msg.className = "hint";

  fill.style.width = "2%";
  txt.textContent = "이미지 압축 중…";

  // 이전 thumb 상태 초기화
  document.querySelectorAll(".ocr-thumb").forEach((t) => {
    t.classList.remove("processing", "done");
  });

  // 1) 모든 이미지를 병렬로 압축
  const compressed = await Promise.all(memberOcrFiles.map((f) => resizeImage(f, 1600, 0.85).catch(() => f)));

  // 2) 서버 OCR (Vision API) 병렬 호출 — 최대 동시 3개로 제한
  const CONCURRENCY = 3;
  const allParsed = [];
  let completed = 0;
  let serverFailedAll = true;

  async function processOne(i) {
    const thumb = document.querySelector(`.ocr-thumb[data-idx="${i}"]`);
    if (thumb) thumb.classList.add("processing");
    const file = compressed[i];
    let text = "";
    try {
      text = await callServerOcr(file);
      serverFailedAll = false;
    } catch (err) {
      console.warn(`이미지 #${i+1} 서버 OCR 실패:`, err.message);
      // Tesseract 폴백
      try {
        text = await tesseractOcr(memberOcrFiles[i]);
        serverFailedAll = false;
      } catch (err2) {
        console.warn(`이미지 #${i+1} Tesseract 폴백도 실패:`, err2.message);
      }
    }
    if (text) {
      const parsed = parseRosterOcrText(text);
      allParsed.push(...parsed);
    }
    completed++;
    txt.textContent = `${completed}/${memberOcrFiles.length} 인식 완료…`;
    fill.style.width = `${(completed / memberOcrFiles.length) * 100}%`;
    if (thumb) {
      thumb.classList.remove("processing");
      if (text) thumb.classList.add("done");
    }
  }

  // 동시 실행 제한
  const queue = memberOcrFiles.map((_, i) => i);
  const workers = Array(Math.min(CONCURRENCY, queue.length)).fill(0).map(async () => {
    while (queue.length) {
      const i = queue.shift();
      if (i === undefined) return;
      await processOne(i);
    }
  });
  await Promise.all(workers);

  // dedupe: 문파장 > 부문파장 > 일반(문파원)
  const rolePri = (r) => (r === "문파장" ? 2 : r === "부문파장" ? 1 : 0);
  const byNick = new Map();
  for (const p of allParsed) {
    const existing = byNick.get(p.nickname);
    if (!existing || rolePri(p.role) > rolePri(existing.role)) {
      byNick.set(p.nickname, p);
    }
  }
  const final = Array.from(byNick.values());

  // 검증
  const leaderCount = final.filter((x) => x.role === "문파장").length;
  const viceCount = final.filter((x) => x.role === "부문파장").length;

  // textarea 에 append (또는 비어있으면 그대로 채움)
  const ta = $("#bulkArea");
  const existing = (ta.value || "").trim();
  const newLines = final.map((p) => {
    return [p.nickname, guild, p.role].filter(Boolean).join(", ");
  }).join("\n");
  ta.value = existing ? `${existing}\n${newLines}` : newLines;

  // 결과 메시지
  const warnings = [];
  if (leaderCount === 0) warnings.push("문파장 0명 (예상 1명)");
  else if (leaderCount > 1) warnings.push(`문파장 ${leaderCount}명 (예상 1명)`);
  if (viceCount > 2) warnings.push(`부문파장 ${viceCount}명 (예상 2명)`);
  if (viceCount < 2 && viceCount > 0) warnings.push(`부문파장 ${viceCount}명 (예상 2명)`);

  txt.textContent = `완료 · ${final.length}명 추출 (문파장 ${leaderCount}, 부문파장 ${viceCount})`;
  if (warnings.length) {
    msg.textContent = "⚠️ " + warnings.join(" · ") + " — 일괄 입력란을 확인 후 수정해 주세요.";
    msg.className = "hint error";
  } else {
    msg.textContent = `✓ ${final.length}명 추출 완료. 일괄 입력란을 검토한 뒤 저장하세요.`;
    msg.className = "hint success";
  }

  runBtn.disabled = false;
  clearBtn.disabled = false;
  if (pickLabel) pickLabel.style.pointerEvents = "";
}

function parseRosterOcrText(raw) {
  // 바람의나라 클래식 문파원 화면 형식:
  //   [직책] [닉네임] : [기타 정보 ...]
  // 또는
  //   [닉네임] [직책] : [기타 정보 ...]
  // 직책: 문파장 (1명) / 부문파장 (2명) / 문파원 (일반)
  // ":" 왼쪽만 사용. ":" 가 없으면 줄 전체 사용.
  const out = [];
  const seenLocal = new Set();
  const lines = (raw || "").split(/\r?\n/);
  for (const ln of lines) {
    let s = ln.trim();
    if (!s) continue;

    // ":" 또는 "：" (전각) 또는 ";" (오인식) 왼쪽만 사용
    const colonIdx = s.search(/[:：;]/);
    let left = colonIdx >= 0 ? s.slice(0, colonIdx) : s;
    left = left.trim();
    if (!left) continue;

    // 역할 마커 탐지 (오인식 대비: 공백 허용)
    let role = "";
    if (/부\s*문\s*파\s*장/.test(left)) role = "부문파장";
    else if (/문\s*파\s*장/.test(left)) role = "문파장";
    // 문파원은 명시적 마커가 있을 수도 있으나 기본값이라 role 비워둠

    // 직책 단어 + 장식 제거
    let cleaned = left
      .replace(/부\s*문\s*파\s*장/g, " ")
      .replace(/문\s*파\s*장/g, " ")
      .replace(/문\s*파\s*원/g, " ")
      .replace(/<<[^>]*>>/g, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/【[^】]*】/g, " ")
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\([^)]*\)/g, " ");

    cleaned = cleaned.replace(/\s+/g, " ").trim();
    if (!cleaned) continue;

    // 토큰 분리 후 닉네임 추출 (한글 포함 1~6자 우선)
    const tokens = cleaned.split(/\s+/);
    let nickname = "";
    for (const t of tokens) {
      const c = t.replace(/[^가-힣ㄱ-ㆎa-zA-Z0-9]/g, "");
      if (c && c.length >= 1 && c.length <= 6 && /[가-힣]/.test(c)) {
        nickname = c;
        break;
      }
    }
    // 폴백: 영숫자만으로 된 닉네임
    if (!nickname) {
      for (const t of tokens) {
        const c = t.replace(/[^가-힣ㄱ-ㆎa-zA-Z0-9]/g, "");
        if (c && c.length >= 2 && c.length <= 6) { nickname = c; break; }
      }
    }
    if (!nickname) continue;
    // 헤더성 단어 필터
    if (/^(문파|문파원|문파장|부문파장|목록|레벨|직업|이름|닉네임|상태|접속|미접속|순위|등급|레벨|레)$/.test(nickname)) continue;
    if (seenLocal.has(nickname)) continue;
    seenLocal.add(nickname);
    out.push({ nickname, role });
  }
  return out;
}

// OCR 용 이미지 전처리: 스케일업 + 그레이스케일 + 대비 향상.
// 게임 UI 의 작은 글씨 인식률을 크게 높임.
async function preprocessImageForOcr(file, targetLong = 2200, contrast = 1.5) {
  const dataUrl = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = dataUrl;
  });
  const longSide = Math.max(img.width, img.height);
  const scale = longSide < targetLong ? targetLong / longSide : 1;
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    let v = (g - 128) * contrast + 128;
    if (v < 0) v = 0; else if (v > 255) v = 255;
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(data, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
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
  setupMemberOcr();

  // 성주 현황
  $$("#castleLordForm [data-action='save']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = btn.closest(".cl-row");
      if (row) saveCastleLord(row.dataset.castle);
    });
  });

  // 지침
  document.querySelector("#saveGuidelinesBtn")?.addEventListener("click", saveGuidelines);
  document.querySelector("#reloadGuidelinesBtn")?.addEventListener("click", loadGuidelines);

  // 비밀번호 변경
  document.querySelector("#changePwBtn")?.addEventListener("click", changeAdminPw);

  // 계정 관리
  document.querySelector("#acctSaveBtn")?.addEventListener("click", handleSaveAccount);

  // 문파 필터
  document.querySelector("#guildFilter")?.addEventListener("change", (e) => {
    currentGuildFilter = e.target.value;
    loadWeekly();
    loadComparison();
    loadMonthly();
  });

  // SW 등록
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  // 로그인 상태 확인 (세션 유지)
  if (getUsername() && getPassword()) {
    tryLogin(getUsername(), getPassword()).then((result) => {
      if (result.scope !== null) {
        applyScope(result.scope);
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
