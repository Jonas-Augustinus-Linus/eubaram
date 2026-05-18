// EU연합 공성신청 - Siege 페이지 로직
// =====================================
// (ALLIANCE / $ / $$ / escapeHtml / pad2 / nowKst / todayKstString / getEndpoint /
//  ensureTesseractLoaded / resizeImage / preprocessForOcr / blobToBase64 /
//  readCache / writeCache 는 shared.js 에서 제공)

// 현재 페이지의 문파 컨텍스트 (URL param ?guild=...)
const CURRENT_GUILD = (() => {
  try {
    const p = new URLSearchParams(location.search);
    return (p.get("guild") || "").trim();
  } catch { return ""; }
})();

// 요일 → 성 매핑 (KST 기준, 월~목)
// Note: getDay() returns 0=일, 1=월, 2=화, 3=수, 4=목
const CASTLE_BY_DAY = {
  1: { name: "주작성", openHour: 0, openMin: 0, closeHour: 23, closeMin: 30 },
  2: { name: "현무성", openHour: 0, openMin: 0, closeHour: 23, closeMin: 30 },
  3: { name: "청룡성", openHour: 0, openMin: 0, closeHour: 23, closeMin: 30 },
  4: { name: "백호성", openHour: 0, openMin: 0, closeHour: 23, closeMin: 30 },
};

const DAY_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

// ----- Helpers (page-local) -----

function getCastleContext(date) {
  const d = date || nowKst();
  // Use the UTC accessors on the shifted Date — its UTC fields represent KST wall-clock time.
  const day = d.getUTCDay();
  const hour = d.getUTCHours();
  const min = d.getUTCMinutes();
  const cfg = CASTLE_BY_DAY[day];
  if (!cfg) {
    return {
      day,
      dayLabel: DAY_LABEL[day],
      castle: null,
      isOpen: false,
      reason: "월~목요일만 신청 가능합니다",
    };
  }
  const cur = hour * 60 + min;
  const open = cfg.openHour * 60 + cfg.openMin;
  const close = cfg.closeHour * 60 + cfg.closeMin;
  const isOpen = cur >= open && cur <= close;
  return {
    day,
    dayLabel: DAY_LABEL[day],
    castle: cfg.name,
    isOpen,
    reason: isOpen ? "" : "오늘 신청 시간이 지났습니다 (00:00 ~ 23:30)",
  };
}

function formatKstDateTime(date) {
  const d = date || nowKst();
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function setEndpoint(url) {
  if (url) localStorage.setItem("juseter_endpoint", url);
  else localStorage.removeItem("juseter_endpoint");
}

// ----- API -----

async function apiList() {
  const ep = getEndpoint();
  if (!ep) return [];
  const url = `${ep}?action=list`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`목록 조회 실패 (HTTP ${res.status})`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "목록 조회 실패");
  const out = data.entries || [];
  writeCache("entries", out);
  return out;
}

async function apiMembers() {
  const ep = getEndpoint();
  if (!ep) return [];
  const url = `${ep}?action=members`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "");
  const out = data.members || [];
  writeCache("members", out);
  return out;
}

async function apiSubmit(payload) {
  const ep = getEndpoint();
  if (!ep) throw new Error("Apps Script 엔드포인트가 설정되지 않았습니다");
  // Use text/plain to avoid CORS preflight (Apps Script web app limitation)
  const res = await fetch(ep, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`전송 실패 (HTTP ${res.status})`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "전송 실패");
  return data;
}

// ----- OCR (ensureTesseractLoaded / resizeImage / preprocessForOcr /
//         blobToBase64 는 shared.js) -----

// 게임 스크린샷에는 "등록한 공성전 참가점수 : 2818.23" 형태로 표기됨.
// 이 라벨 뒤의 숫자를 1순위 후보로 잡고, 나머지는 보조 후보로 추가.
function extractScoreCandidates(rawText) {
  // 1) 라벨 매칭 — OCR 오인식을 감안해 공백/구두점 유연하게
  const labelPatterns = [
    /등록한?\s*공\s*성\s*전?\s*참\s*가\s*점\s*수\s*[:：·.,]?\s*([0-9][0-9.,\s]{1,15})/,
    /공\s*성\s*전?\s*참\s*가\s*점\s*수\s*[:：·.,]?\s*([0-9][0-9.,\s]{1,15})/,
    /참\s*가\s*점\s*수\s*[:：·.,]?\s*([0-9][0-9.,\s]{1,15})/,
  ];
  let primary = null;
  for (const pat of labelPatterns) {
    const m = rawText.match(pat);
    if (!m) continue;
    const cleaned = m[1].replace(/\s/g, "").replace(/,/g, "");
    if (/^\d{1,5}(\.\d{1,3})?$/.test(cleaned)) {
      primary = cleaned;
      break;
    }
  }

  // 2) 보조 후보 수집
  const others = new Set();
  const decRe = /(\d{3,5}\.\d{1,3})/g;
  let m;
  while ((m = decRe.exec(rawText)) !== null) others.add(m[1]);
  const intRe = /(?<!\d)(\d{3,5})(?!\d)/g;
  while ((m = intRe.exec(rawText)) !== null) {
    const n = parseInt(m[1], 10);
    if (n >= 500 && n <= 99999) others.add(m[1]);
  }
  const ptRe = /(\d{3,5})\s*점/g;
  while ((m = ptRe.exec(rawText)) !== null) others.add(m[1]);

  if (primary) others.delete(primary);

  const sorted = Array.from(others)
    .map((s) => ({ s, n: parseFloat(s) }))
    .sort((a, b) => b.n - a.n)
    .map((x) => x.s);

  return {
    primary,
    list: primary ? [primary, ...sorted] : sorted,
  };
}

// 서버 OCR (Apps Script → Gemini 2.5 Flash → Vision → Drive 자동 폴백)
// schemaType='siege' 보내면 Gemini 가 구조화 JSON {score, nickname} 직접 반환.
async function runOcrRemote(file) {
  const ep = getEndpoint();
  if (!ep) throw new Error("엔드포인트 미설정");
  $("#ocrStatusText").textContent = "이미지 압축 중…";
  const blob = await resizeImage(file, 1600, 0.85);
  $("#ocrStatusText").textContent = "서버 OCR 실행 중…";
  const b64 = await blobToBase64(blob);
  const res = await fetch(ep, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "ocr", image: b64, mime: blob.type || "image/jpeg", schemaType: "siege" }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "OCR 실패");
  return {
    text: data.text || "",
    structured: data.structured || null,
    engine: data.engine || "remote",
  };
}

// 클라이언트 폴백 OCR (Tesseract.js) - 전처리 후 실행, 단어 레벨 데이터까지 추출
async function runOcrLocal(file) {
  $("#ocrStatusText").textContent = "OCR 엔진 로드 중…";
  await ensureTesseractLoaded();
  $("#ocrStatusText").textContent = "이미지 전처리 중…";
  const blob = await preprocessForOcr(file, 2400, 1.6);
  $("#ocrStatusText").textContent = "Tesseract OCR 실행 중…";
  const result = await Tesseract.recognize(blob, "kor+eng", {
    logger: (msg) => {
      if (msg.status === "recognizing text") {
        const pct = Math.round((msg.progress || 0) * 100);
        $("#ocrStatusText").textContent = `Tesseract OCR ${pct}%…`;
      }
    },
  });
  const text = result.data.text || "";
  // 단어 레벨 데이터 (높은 신뢰도 단어만)
  const words = (result.data.words || [])
    .filter((w) => w.confidence > 50)
    .map((w) => w.text);
  return { text, words };
}

// 우선순위: Gemini (구조화) → Vision (text) → Drive (text) → Tesseract (text 폴백)
// 구조화 응답(structured)이 있으면 정규식 파싱 스킵 가능 → 호출자가 우선 사용.
async function runOcr(file) {
  try {
    const result = await runOcrRemote(file);
    // 구조화 응답이 있으면 text 없어도 OK
    if (result.structured || (result.text && result.text.trim().length > 0)) {
      return result;
    }
    throw new Error("empty");
  } catch (err) {
    console.warn("서버 OCR 실패, Tesseract 폴백:", err.message);
    $("#ocrStatusText").textContent = "Tesseract 폴백 실행 중…";
    const { text, words } = await runOcrLocal(file);
    const combinedText = text + "\n" + (words || []).join(" ");
    return { text: combinedText, structured: null, engine: "tesseract" };
  }
}

// ----- DOM helpers -----


function setMessage(text, kind) {
  const el = $("#formMessage");
  el.textContent = text || "";
  el.className = "hint" + (kind ? " " + kind : "");
}

// ----- UI: today banner -----

function renderTodayBanner() {
  const ctx = getCastleContext();
  const label = `오늘은 ${ctx.dayLabel}요일`;
  $("#todayLabel").textContent = label;
  const tag = $("#castleTag");
  if (ctx.castle) {
    tag.textContent = ctx.isOpen ? `${ctx.castle} 신청 가능` : `${ctx.castle} (마감)`;
    tag.classList.toggle("disabled", !ctx.isOpen);
  } else {
    tag.textContent = "신청 불가일";
    tag.classList.add("disabled");
  }
  return ctx;
}

function renderGuildContext() {
  const titleEl = $("#brandTitle");
  const ctxEl = $("#guildContext");
  if (!titleEl) return;
  if (CURRENT_GUILD) {
    titleEl.textContent = `${CURRENT_GUILD} 공성신청`;
    if (ctxEl) {
      ctxEl.innerHTML = `<span class="guild-badge">📜 ${escapeHtml(CURRENT_GUILD)} 전용</span>`;
    }
    document.title = `${CURRENT_GUILD} 공성신청 · EU연합`;
  } else {
    titleEl.textContent = "공성신청";
    if (ctxEl) {
      ctxEl.innerHTML = `<span class="guild-badge warn">⚠️ 문파 미선택 - <a href="index.html">홈에서 문파를 선택해 주세요</a></span>`;
    }
  }
}

// ----- UI: candidates -----

function renderCandidates(cands, primary) {
  const wrap = $("#candidates");
  wrap.innerHTML = "";
  if (!cands.length) {
    $("#candidatesField").hidden = true;
    return;
  }
  cands.slice(0, 8).forEach((c) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "candidate-chip";
    if (c === primary) btn.classList.add("primary-match");
    btn.textContent = c === primary ? `★ ${c}` : c;
    btn.title = c === primary ? "「참가점수」 라벨 매칭" : "보조 후보";
    btn.addEventListener("click", () => {
      $("#score").value = c;
    });
    wrap.appendChild(btn);
  });
  $("#candidatesField").hidden = false;
}

// ----- UI: entries table -----

let cachedEntries = [];
let cachedMembers = [];

async function refreshMembers() {
  try {
    cachedMembers = await apiMembers();
  } catch (err) {
    console.warn("문파원 조회 실패:", err);
    cachedMembers = [];
  }
}

function isMemberAllowed(nickname) {
  // 명단이 비어 있으면 (관리자가 아직 안 채움) 일단 허용
  if (!cachedMembers.length) return true;
  const n = (nickname || "").trim().toLowerCase();
  // 현재 페이지의 문파 컨텍스트가 있으면 해당 문파 소속만 허용
  if (CURRENT_GUILD) {
    return cachedMembers.some((m) =>
      (m.nickname || "").trim().toLowerCase() === n &&
      (m.guild || "").trim() === CURRENT_GUILD
    );
  }
  return cachedMembers.some((m) => (m.nickname || "").trim().toLowerCase() === n);
}

function lookupGuild(nickname) {
  if (CURRENT_GUILD) return CURRENT_GUILD;
  const n = (nickname || "").trim().toLowerCase();
  const m = cachedMembers.find((x) => (x.nickname || "").trim().toLowerCase() === n);
  return m ? (m.guild || "") : "";
}

function memberOfOtherGuild(nickname) {
  const n = (nickname || "").trim().toLowerCase();
  const m = cachedMembers.find((x) => (x.nickname || "").trim().toLowerCase() === n);
  if (!m) return null;
  if (CURRENT_GUILD && (m.guild || "").trim() !== CURRENT_GUILD) return m.guild || "(미지정)";
  return null;
}

function showMemberWarning(nickname) {
  const dlg = $("#memberWarnDialog");
  const otherGuild = memberOfOtherGuild(nickname);
  let msg;
  if (otherGuild) {
    msg = `[${nickname}] 은(는) ${otherGuild} 소속입니다. 현재 페이지는 ${CURRENT_GUILD} 전용입니다. 홈에서 본인 문파를 선택해 주세요.`;
  } else if (CURRENT_GUILD) {
    msg = `[${nickname}] 닉네임은 ${CURRENT_GUILD} 문파원 명단에 없습니다. 닉네임 확인 또는 관리자에게 문의해 주세요.`;
  } else {
    msg = `[${nickname}] 닉네임은 문파원 명단에 없습니다. 닉네임 확인 또는 관리자에게 문의해 주세요.`;
  }
  $("#memberWarnDetail").textContent = msg;
  dlg.showModal();
}

// todayKstString — shared.js

function filterEntries(entries, mode) {
  let base = entries;
  // 현재 페이지에 문파 컨텍스트가 있으면 해당 문파만
  if (CURRENT_GUILD) {
    base = base.filter((e) => (e.guild || "").trim() === CURRENT_GUILD);
  }
  if (mode === "all") return base;
  if (mode === "today") {
    const today = todayKstString();
    return base.filter((e) => (e.dateKst || "").startsWith(today));
  }
  return base.filter((e) => e.castle === mode);
}

// "yyyy-MM-dd HH:mm" 또는 Date toString 형태 모두 받아서 짧게 정리
function formatDisplayTime(raw) {
  if (!raw) return "";
  // "yyyy-MM-dd HH:mm" 형태가 표준
  const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (m) {
    const [, y, mo, d, hh, mm] = m;
    const today = todayKstString();
    if (`${y}-${mo}-${d}` === today) return `${hh}:${mm}`;
    return `${mo}-${d} ${hh}:${mm}`;
  }
  // Date toString 폴백 (서버가 옛 데이터를 Date 로 저장한 경우)
  const dObj = new Date(raw);
  if (!isNaN(dObj.getTime())) {
    const y = dObj.getFullYear();
    const mo = pad2(dObj.getMonth() + 1);
    const d = pad2(dObj.getDate());
    const hh = pad2(dObj.getHours());
    const mm = pad2(dObj.getMinutes());
    const today = todayKstString();
    if (`${y}-${mo}-${d}` === today) return `${hh}:${mm}`;
    return `${mo}-${d} ${hh}:${mm}`;
  }
  return String(raw).slice(0, 16);
}

function renderElitePill(value) {
  const v = (value || "").trim();
  if (v === "O") return `<span class="elite-pill elite-O">⭕ 참전</span>`;
  if (v === "X") return `<span class="elite-pill elite-X">❌ 불참</span>`;
  if (v === "최대한 참여" || v === "최대") return `<span class="elite-pill elite-MAX">⏳ 최대한</span>`;
  return `<span class="elite-NONE">-</span>`;
}

function renderEntries() {
  const mode = $("#castleFilter").value;
  const filtered = filterEntries(cachedEntries, mode)
    .slice()
    .sort((a, b) => (b.dateKst || "").localeCompare(a.dateKst || ""));
  const tbody = $("#entriesTbody");
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">기록이 없습니다</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map((e) => {
    const castle = escapeHtml(e.castle || "");
    const nick = escapeHtml(e.nickname || "");
    const score = escapeHtml(e.score || "");
    const elite = renderElitePill(e.elite);
    const dt = escapeHtml(formatDisplayTime(e.dateKst));
    const note = escapeHtml(e.note || "");
    return `<tr>
      <td><span class="castle-pill pill-${castle}">${castle}</span></td>
      <td class="nick-cell">${nick}</td>
      <td class="score-cell num">${score}</td>
      <td class="elite-cell">${elite}</td>
      <td class="time-cell">${dt}</td>
      <td class="note-cell">${note}</td>
    </tr>`;
  }).join("");
}

async function refreshEntries() {
  const tbody = $("#entriesTbody");
  tbody.innerHTML = `<tr><td colspan="5" class="empty">불러오는 중…</td></tr>`;
  try {
    cachedEntries = await apiList();
    renderEntries();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">불러오기 실패: ${escapeHtml(err.message)}</td></tr>`;
  }
}

// ----- Duplicate detection -----

function findDuplicate(nickname, castle, dateKstPrefix) {
  const n = nickname.trim().toLowerCase();
  return cachedEntries.find((e) =>
    (e.nickname || "").trim().toLowerCase() === n &&
    e.castle === castle &&
    (e.dateKst || "").startsWith(dateKstPrefix)
  );
}

// ----- Submit / Update flow -----

function getSelectedElite() {
  const sel = document.querySelector("#eliteSegmented .seg-btn.selected");
  return sel ? sel.dataset.value : "";
}

function clearEliteSelection() {
  document.querySelectorAll("#eliteSegmented .seg-btn").forEach((b) => {
    b.classList.remove("selected");
    b.setAttribute("aria-checked", "false");
  });
}

function validateForm(ctx) {
  if (!ctx.castle) {
    setMessage(ctx.reason, "error");
    return null;
  }
  if (!ctx.isOpen) {
    setMessage(ctx.reason, "error");
    return null;
  }
  const nickname = $("#nickname").value.trim();
  const score = $("#score").value.trim();
  const note = $("#note").value.trim();
  const elite = getSelectedElite();
  if (!nickname) { setMessage("닉네임을 입력해 주세요", "error"); return null; }
  if (!isMemberAllowed(nickname)) {
    showMemberWarning(nickname);
    setMessage("등록된 문원이 아닙니다", "error");
    return null;
  }
  if (!score) { setMessage("점수를 입력하거나 스크린샷에서 선택해 주세요", "error"); return null; }
  if (!elite) { setMessage("정예참전 여부를 선택해 주세요", "error"); return null; }
  return { nickname, score, note, elite };
}

async function doSubmit(asUpdate) {
  setMessage("");
  const ctx = getCastleContext();
  const mainV = validateForm(ctx);
  if (!mainV) return;

  // 다계정 추가 행들 수집/검증
  const extras = collectMultiAccData();
  const extraErrors = [];
  const seenNicks = new Set([mainV.nickname.toLowerCase()]);
  for (let i = 0; i < extras.length; i++) {
    const e = extras[i];
    const tag = `#${i + 2}`;
    if (!e.nickname) { extraErrors.push(`${tag} 닉네임 비어있음`); continue; }
    if (!e.score) { extraErrors.push(`${tag} ${e.nickname}: 점수 비어있음`); continue; }
    if (!e.elite) { extraErrors.push(`${tag} ${e.nickname}: 정예 미선택`); continue; }
    if (seenNicks.has(e.nickname.toLowerCase())) { extraErrors.push(`${tag} ${e.nickname}: 닉네임 중복`); continue; }
    if (!isMemberAllowed(e.nickname)) { extraErrors.push(`${tag} ${e.nickname}: 등록 문원 아님`); continue; }
    seenNicks.add(e.nickname.toLowerCase());
  }
  if (extraErrors.length) {
    setMessage("⚠️ 다계정 입력 확인: " + extraErrors.join(" · "), "error");
    return;
  }

  // 전체 등록 대상 합치기 (메인 #1 + 다계정 #2..)
  const allEntries = [
    { nickname: mainV.nickname, score: mainV.score, note: mainV.note, elite: mainV.elite, _row: null },
    ...extras.map((e) => ({ nickname: e.nickname, score: e.score, note: "", elite: e.elite, _row: e._row })),
  ];

  // 중복 체크 (이미 등록됐는지)
  const todayStr = todayKstString();
  for (let i = 0; i < allEntries.length; i++) {
    const a = allEntries[i];
    const dup = findDuplicate(a.nickname, ctx.castle, todayStr);
    const tag = `#${i + 1}`;
    if (asUpdate && !dup) {
      setMessage(`${tag} [${a.nickname}] ${ctx.castle} 신청 내역이 없습니다. 첫 신청은 '✓ 신청하기' 를 사용하세요`, "error");
      return;
    }
    if (!asUpdate && dup) {
      setMessage(`${tag} [${dup.nickname}] 이미 ${ctx.castle}에 ${dup.score}점 등록됨. 점수 갱신은 '⟳ 갱신하기' 사용`, "error");
      return;
    }
  }

  const submitBtn = $("#submitBtn");
  const updateBtn = $("#updateBtn");
  submitBtn.disabled = true;
  updateBtn.disabled = true;

  const results = [];
  for (let i = 0; i < allEntries.length; i++) {
    const a = allEntries[i];
    setMessage(`${i + 1}/${allEntries.length} ${asUpdate ? "갱신" : "신청"} 중… (${a.nickname})`);
    try {
      const payload = {
        action: "submit",
        nickname: a.nickname,
        score: a.score,
        note: a.note,
        elite: a.elite,
        castle: ctx.castle,
        dateKst: formatKstDateTime(),
        update: !!asUpdate,
        guild: lookupGuild(a.nickname),
      };
      await apiSubmit(payload);
      results.push({ ok: true, nickname: a.nickname, score: a.score, _row: a._row });
    } catch (err) {
      results.push({ ok: false, nickname: a.nickname, error: err.message, _row: a._row });
    }
  }

  const okResults = results.filter((r) => r.ok);
  const failResults = results.filter((r) => !r.ok);
  const verb = asUpdate ? "갱신" : "신청";

  if (failResults.length === 0) {
    if (okResults.length === 1) {
      setMessage(`${verb} 완료 ✅ (${okResults[0].nickname} · ${okResults[0].score})`, "success");
    } else {
      const list = okResults.map((r) => `${r.nickname}(${r.score})`).join(", ");
      setMessage(`✅ ${okResults.length}건 ${verb} 완료: ${list}`, "success");
    }
    // 폼 초기화 (닉네임은 유지)
    $("#score").value = "";
    $("#note").value = "";
    clearEliteSelection();
    $("#preview").src = "";
    $("#previewWrap").hidden = true;
    $("#previewActions").hidden = true;
    $("#candidatesField").hidden = true;
    $("#ocrStatus").hidden = true;
    $("#rawOcrSection").hidden = true;
    $("#fileInput").value = "";
    lastUploadedFile = null;
    // 다계정 행 비우기
    clearMultiAccRows();
  } else {
    // 실패한 항목의 행은 그대로 두고, 성공한 다계정 행만 제거
    okResults.forEach((r) => { if (r._row) r._row.remove(); });
    renumberMultiAcc();
    updateMultiAccCount();
    const okTxt = okResults.length ? `성공 ${okResults.length}건 (${okResults.map((r) => r.nickname).join(", ")})` : "";
    const failTxt = `실패 ${failResults.length}건: ${failResults.map((r) => `${r.nickname}-${r.error}`).join(" / ")}`;
    setMessage(`⚠️ ${[okTxt, failTxt].filter(Boolean).join(" · ")}`, "error");
  }

  submitBtn.disabled = false;
  updateBtn.disabled = false;
  await refreshEntries();
}

// ----- 다계정 추가 등록 -----

let multiAccIdSeq = 0;

function setupMultiAcc() {
  const addBtn = $("#addAccBtn");
  const clearBtn = $("#clearAccBtn");
  if (!addBtn) return;
  addBtn.addEventListener("click", () => {
    const sec = $("#multiAccSection");
    if (sec && !sec.open) sec.open = true;
    addMultiAccRow();
  });
  if (clearBtn) clearBtn.addEventListener("click", () => clearMultiAccRows());
  updateMultiAccCount();
}

function addMultiAccRow() {
  const list = $("#multiAccList");
  if (!list) return;
  const id = ++multiAccIdSeq;
  const row = document.createElement("div");
  row.className = "multi-acc-row";
  row.dataset.id = String(id);
  row.innerHTML = `
    <div class="multi-acc-row-head">
      <span class="multi-acc-num"></span>
      <input type="text" class="multi-nick" placeholder="닉네임 (예: 힐킵2)" maxlength="6" autocomplete="off" spellcheck="false" enterkeyhint="next">
      <button type="button" class="multi-rm" title="이 계정 제거" aria-label="제거">✕</button>
    </div>
    <label class="multi-drop-zone">
      <input type="file" accept="image/*">
      <button type="button" class="multi-drop-clear" title="사진 제거" aria-label="사진 제거">✕</button>
      <div class="multi-drop-default">
        <span class="multi-drop-icon" aria-hidden="true">📸</span>
        <div>
          <div class="multi-drop-text">사진을 끌어다 놓거나 탭하세요</div>
          <div class="multi-drop-sub">OCR 로 점수 자동 추출</div>
        </div>
      </div>
      <div class="multi-drop-preview" hidden>
        <img class="multi-drop-img" alt="">
        <span class="multi-drop-status">대기 중…</span>
      </div>
    </label>
    <div class="multi-acc-row-bottom">
      <input type="text" class="multi-score" placeholder="점수 (직접 입력 가능)" inputmode="decimal" enterkeyhint="next">
      <div class="multi-elite-mini" role="radiogroup" aria-label="정예참전 여부">
        <button type="button" data-v="O" title="⭕ 참전" aria-label="참전">⭕</button>
        <button type="button" data-v="X" title="❌ 불참" aria-label="불참">❌</button>
        <button type="button" data-v="최대한 참여" title="⏳ 최대한 참여" aria-label="최대한 참여">⏳</button>
      </div>
    </div>
  `;
  list.appendChild(row);

  // remove row
  row.querySelector(".multi-rm").addEventListener("click", () => {
    row.remove();
    renumberMultiAcc();
    updateMultiAccCount();
  });

  // elite buttons
  row.querySelectorAll(".multi-elite-mini button").forEach((b) => {
    b.addEventListener("click", () => {
      row.querySelectorAll(".multi-elite-mini button").forEach((x) => x.classList.remove("selected"));
      b.classList.add("selected");
    });
  });

  // drop-zone wiring
  const dropZone = row.querySelector(".multi-drop-zone");
  const fileInput = dropZone.querySelector("input[type='file']");
  const clearBtn = dropZone.querySelector(".multi-drop-clear");

  fileInput.addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) handleRowFile(row, f);
  });

  // 드래그&드롭
  ["dragenter", "dragover"].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropZone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropZone.classList.remove("dragover");
    })
  );
  dropZone.addEventListener("drop", (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleRowFile(row, f);
  });

  // X 버튼 (사진 제거): label 클릭이 새 파일 다이얼로그를 열지 않게 stopPropagation
  clearBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearRowFile(row);
  });

  renumberMultiAcc();
  updateMultiAccCount();
  // focus 첫 input
  row.querySelector(".multi-nick").focus();
}

function handleRowFile(row, file) {
  if (!file || !file.type.startsWith("image/")) {
    setMessage("이미지 파일만 가능합니다", "error");
    return;
  }
  const dz = row.querySelector(".multi-drop-zone");
  const def = row.querySelector(".multi-drop-default");
  const prev = row.querySelector(".multi-drop-preview");
  const img = row.querySelector(".multi-drop-img");
  const status = row.querySelector(".multi-drop-status");

  // 미리보기로 전환
  const fr = new FileReader();
  fr.onload = (e) => { img.src = e.target.result; };
  fr.readAsDataURL(file);

  def.hidden = true;
  prev.hidden = false;
  dz.classList.add("has-file");
  dz.classList.remove("done", "error-state");
  dz.classList.add("processing");
  status.className = "multi-drop-status";
  status.innerHTML = `<span class="multi-drop-spinner" aria-hidden="true"></span><span>OCR 실행 중…</span>`;

  runRowOcr(row, file);
}

function clearRowFile(row) {
  const dz = row.querySelector(".multi-drop-zone");
  const def = row.querySelector(".multi-drop-default");
  const prev = row.querySelector(".multi-drop-preview");
  const img = row.querySelector(".multi-drop-img");
  const fi = row.querySelector(".multi-drop-zone input[type='file']");
  if (fi) fi.value = "";
  if (img) img.src = "";
  def.hidden = false;
  prev.hidden = true;
  dz.classList.remove("has-file", "processing", "done", "error-state");
}

function renumberMultiAcc() {
  const rows = $$("#multiAccList .multi-acc-row");
  rows.forEach((r, i) => {
    const num = r.querySelector(".multi-acc-num");
    if (num) num.textContent = `#${i + 2}`;
  });
}

function updateMultiAccCount() {
  const n = $$("#multiAccList .multi-acc-row").length;
  const el = $("#multiAccCount");
  const clearBtn = $("#clearAccBtn");
  if (el) {
    if (n > 0) {
      el.textContent = `${n}개 추가됨`;
      el.classList.add("active");
    } else {
      el.textContent = "선택사항";
      el.classList.remove("active");
    }
  }
  if (clearBtn) clearBtn.hidden = n === 0;
}

function clearMultiAccRows() {
  const list = $("#multiAccList");
  if (list) list.innerHTML = "";
  updateMultiAccCount();
}

function collectMultiAccData() {
  const rows = $$("#multiAccList .multi-acc-row");
  const out = [];
  for (const r of rows) {
    const nickname = r.querySelector(".multi-nick").value.trim();
    const score = r.querySelector(".multi-score").value.trim();
    const eliteBtn = r.querySelector(".multi-elite-mini button.selected");
    const elite = eliteBtn ? eliteBtn.dataset.v : "";
    // 완전히 빈 행은 무시
    if (!nickname && !score && !elite) continue;
    out.push({ nickname, score, elite, _row: r });
  }
  return out;
}

async function runRowOcr(row, file) {
  const dz = row.querySelector(".multi-drop-zone");
  const status = row.querySelector(".multi-drop-status");
  const rowIdx = Array.from(row.parentElement.children).indexOf(row) + 2;
  try {
    const { text, structured, engine } = await runOcr(file);
    // Gemini 구조화 응답 우선
    let pick = null;
    if (structured && typeof structured.score === "number") {
      pick = structured.score.toString();
    } else if (text) {
      const { primary, list } = extractScoreCandidates(text);
      pick = primary || list[0];
    }
    dz.classList.remove("processing");
    if (pick) {
      row.querySelector(".multi-score").value = pick;
      dz.classList.add("done");
      status.className = "multi-drop-status success";
      const tag = engine === "gemini" ? "AI 인식" : "OCR 인식";
      status.innerHTML = `<span>✓ ${tag} ${pick}</span>`;
    } else {
      dz.classList.add("error-state");
      status.className = "multi-drop-status error";
      status.innerHTML = `<span>점수를 못 찾았어요. 직접 입력해 주세요</span>`;
      setMessage(`#${rowIdx} 사진에서 점수를 찾지 못했습니다. 직접 입력해 주세요.`, "error");
    }
  } catch (err) {
    dz.classList.remove("processing");
    dz.classList.add("error-state");
    status.className = "multi-drop-status error";
    status.innerHTML = `<span>인식 실패: ${escapeHtml(err.message)}</span>`;
    setMessage(`#${rowIdx} 사진 인식 실패: ${err.message}`, "error");
  }
}

function handleSubmit() { return doSubmit(false); }
function handleUpdate() { return doSubmit(true); }

// ----- File / OCR handling -----

let lastUploadedFile = null;

async function handleFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    setMessage("이미지 파일만 가능합니다", "error");
    return;
  }
  lastUploadedFile = file;
  // preview
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = $("#preview");
    img.src = e.target.result;
    $("#previewWrap").hidden = false;
    $("#previewActions").hidden = false;
  };
  reader.readAsDataURL(file);

  // OCR
  $("#ocrStatus").hidden = false;
  $("#ocrStatusText").textContent = "이미지에서 점수를 읽고 있어요…";
  $("#rawOcrText").textContent = "";
  $("#rawOcrSection").hidden = true;
  try {
    const { text, structured, engine } = await runOcr(file);
    // Gemini 구조화 응답 우선
    if (structured && typeof structured.score === "number") {
      const score = structured.score.toString();
      $("#score").value = score;
      $("#ocrStatusText").textContent = `🤖 AI 인식: ${score}점${structured.nickname ? ` (${structured.nickname})` : ""}`;
      renderCandidates([score], score);
      if (text) { $("#rawOcrText").textContent = text; $("#rawOcrSection").hidden = false; }
      return;
    }
    // 텍스트 정규식 폴백 (Vision/Drive/Tesseract)
    const { primary, list } = extractScoreCandidates(text || "");
    renderCandidates(list, primary);
    if (primary) {
      $("#score").value = primary;
      $("#ocrStatusText").textContent = `「참가점수」 라벨에서 ${primary} 인식 ✓`;
    } else if (list.length) {
      $("#ocrStatusText").innerHTML = `숫자 후보 ${list.length}개 인식됨. 아래에서 선택하거나, <button type="button" class="link-btn-inline" id="cropTrigger">점수 영역만 직접 선택</button>해 보세요.`;
      $("#cropTrigger")?.addEventListener("click", () => startCropMode());
    } else {
      $("#ocrStatusText").innerHTML = `점수 인식 실패. <button type="button" class="link-btn-inline" id="cropTrigger">점수 영역만 직접 선택</button>해 보세요. 또는 직접 입력.`;
      $("#cropTrigger")?.addEventListener("click", () => startCropMode());
    }
    if (text) {
      $("#rawOcrText").textContent = text;
      $("#rawOcrSection").hidden = false;
    }
  } catch (err) {
    $("#ocrStatusText").textContent = `OCR 실패: ${err.message}`;
  }
}

// ----- Crop mode (사용자가 점수 영역을 직접 선택) -----

let cropState = null;

function startCropMode() {
  if (!lastUploadedFile) {
    setMessage("먼저 이미지를 업로드해 주세요", "error");
    return;
  }
  const overlay = $("#cropOverlay");
  const rect = $("#cropRect");
  rect.hidden = true;
  rect.style.left = "0px";
  rect.style.top = "0px";
  rect.style.width = "0px";
  rect.style.height = "0px";
  overlay.hidden = false;
  cropState = { startX: 0, startY: 0, curX: 0, curY: 0, dragging: false };
  setMessage("점수 숫자를 드래그로 감싸세요", "");
}

function endCropMode() {
  const overlay = $("#cropOverlay");
  overlay.hidden = true;
  cropState = null;
}

function getCropPointer(e) {
  const overlay = $("#cropOverlay");
  const r = overlay.getBoundingClientRect();
  const t = e.touches && e.touches[0];
  const cx = t ? t.clientX : e.clientX;
  const cy = t ? t.clientY : e.clientY;
  return { x: cx - r.left, y: cy - r.top };
}

function onCropDown(e) {
  if (!cropState) return;
  e.preventDefault();
  const p = getCropPointer(e);
  cropState.dragging = true;
  cropState.startX = p.x;
  cropState.startY = p.y;
  cropState.curX = p.x;
  cropState.curY = p.y;
  updateCropRect();
}

function onCropMove(e) {
  if (!cropState || !cropState.dragging) return;
  e.preventDefault();
  const p = getCropPointer(e);
  cropState.curX = p.x;
  cropState.curY = p.y;
  updateCropRect();
}

async function onCropUp(e) {
  if (!cropState || !cropState.dragging) return;
  cropState.dragging = false;
  const rect = $("#cropRect");
  const w = Math.abs(cropState.curX - cropState.startX);
  const h = Math.abs(cropState.curY - cropState.startY);
  if (w < 12 || h < 8) {
    // 너무 작은 영역 - 무시
    setMessage("선택 영역이 너무 작아요. 다시 드래그해 주세요", "error");
    return;
  }
  await runCropOcr();
}

function updateCropRect() {
  if (!cropState) return;
  const rect = $("#cropRect");
  const x = Math.min(cropState.startX, cropState.curX);
  const y = Math.min(cropState.startY, cropState.curY);
  const w = Math.abs(cropState.curX - cropState.startX);
  const h = Math.abs(cropState.curY - cropState.startY);
  rect.style.left = x + "px";
  rect.style.top = y + "px";
  rect.style.width = w + "px";
  rect.style.height = h + "px";
  rect.hidden = false;
}

async function runCropOcr() {
  if (!cropState || !lastUploadedFile) return;
  const preview = $("#preview");
  const overlay = $("#cropOverlay");
  const ovRect = overlay.getBoundingClientRect();
  const x0 = Math.min(cropState.startX, cropState.curX);
  const y0 = Math.min(cropState.startY, cropState.curY);
  const w0 = Math.abs(cropState.curX - cropState.startX);
  const h0 = Math.abs(cropState.curY - cropState.startY);

  // 표시 좌표 → 원본 이미지 좌표 변환
  const imgEl = preview;
  const scaleX = imgEl.naturalWidth / ovRect.width;
  const scaleY = imgEl.naturalHeight / ovRect.height;
  const cropX = Math.max(0, Math.round(x0 * scaleX));
  const cropY = Math.max(0, Math.round(y0 * scaleY));
  const cropW = Math.round(w0 * scaleX);
  const cropH = Math.round(h0 * scaleY);

  // 원본 이미지를 로드해서 크롭
  const imgUrl = preview.src;
  const fullImg = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = imgUrl;
  });

  // 크롭 영역을 충분히 크게 (긴 변 ~ 800px) 업스케일
  const targetLong = 800;
  const scale = targetLong / Math.max(cropW, cropH);
  const outW = Math.round(cropW * scale);
  const outH = Math.round(cropH * scale);
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(fullImg, cropX, cropY, cropW, cropH, 0, 0, outW, outH);

  // 그레이스케일 + 대비 향상
  const imgData = ctx.getImageData(0, 0, outW, outH);
  const px = imgData.data;
  for (let i = 0; i < px.length; i += 4) {
    const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    let v = (g - 128) * 1.8 + 128;
    if (v < 0) v = 0;
    else if (v > 255) v = 255;
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(imgData, 0, 0);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.95));

  endCropMode();
  $("#ocrStatus").hidden = false;
  $("#ocrStatusText").textContent = "OCR 엔진 로드 중…";

  try {
    await ensureTesseractLoaded();
    $("#ocrStatusText").textContent = "선택 영역 OCR 실행 중…";
    // 숫자/소수점 위주로 인식 - 디지트 화이트리스트
    const result = await Tesseract.recognize(blob, "eng", {
      logger: (msg) => {
        if (msg.status === "recognizing text") {
          const pct = Math.round((msg.progress || 0) * 100);
          $("#ocrStatusText").textContent = `선택 영역 OCR ${pct}%…`;
        }
      },
      // tessjs 5.x: tessedit_char_whitelist not always honored, but try
    });
    const text = result.data.text || "";
    const words = (result.data.words || [])
      .filter((w) => w.confidence > 30)
      .map((w) => w.text)
      .join(" ");
    const combined = text + "\n" + words;
    const { primary, list } = extractScoreCandidates(combined);
    renderCandidates(list, primary || (list[0] || null));
    const pick = primary || list[0];
    if (pick) {
      $("#score").value = pick;
      $("#ocrStatusText").textContent = `선택 영역에서 ${pick} 인식 ✓`;
    } else {
      $("#ocrStatusText").textContent = "선택 영역에서 숫자를 찾지 못했어요. 다시 선택하거나 직접 입력해 주세요.";
    }
    if (combined.trim()) {
      $("#rawOcrText").textContent = "[크롭 영역 OCR]\n" + combined;
      $("#rawOcrSection").hidden = false;
    }
  } catch (err) {
    $("#ocrStatusText").textContent = `크롭 OCR 실패: ${err.message}`;
  }
}

// ----- Config dialog -----

function openConfigDialog(required) {
  const dlg = $("#configDialog");
  $("#endpointInput").value = getEndpoint();
  dlg.showModal();
  const onClose = () => {
    dlg.removeEventListener("close", onClose);
    if (dlg.returnValue === "save") {
      const v = $("#endpointInput").value.trim();
      if (v) {
        setEndpoint(v);
        refreshEntries();
      }
    } else if (required) {
      setMessage("엔드포인트 설정 후 다시 시도해 주세요", "error");
    }
  };
  dlg.addEventListener("close", onClose);
}

// ----- Init -----

function init() {
  // URL 파라미터로 엔드포인트 미리 설정 가능 (?endpoint=...)
  const params = new URLSearchParams(location.search);
  const epParam = params.get("endpoint");
  if (epParam) {
    setEndpoint(epParam);
    // endpoint 제거하고 guild 만 남기기
    const g = params.get("guild");
    const newSearch = g ? `?guild=${encodeURIComponent(g)}` : "";
    history.replaceState({}, "", location.pathname + newSearch);
  }

  renderGuildContext();
  renderTodayBanner();
  // refresh banner every minute
  setInterval(renderTodayBanner, 60 * 1000);

  // 드롭존 자체가 <label for="fileInput"> 이므로 클릭하면 파일 선택이 자동으로 열림.
  $("#fileInput").addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
  });

  const dz = $("#dropZone");
  ["dragenter", "dragover"].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.remove("dragover");
    })
  );
  dz.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });

  $("#submitBtn").addEventListener("click", handleSubmit);
  $("#updateBtn").addEventListener("click", handleUpdate);
  $("#refreshBtn").addEventListener("click", refreshEntries);
  $("#castleFilter").addEventListener("change", renderEntries);

  // 정예참전 segmented control
  document.querySelectorAll("#eliteSegmented .seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#eliteSegmented .seg-btn").forEach((b) => {
        b.classList.remove("selected");
        b.setAttribute("aria-checked", "false");
      });
      btn.classList.add("selected");
      btn.setAttribute("aria-checked", "true");
    });
  });

  // 점수 영역 직접 선택 (크롭) 모드
  $("#cropBtn")?.addEventListener("click", startCropMode);
  $("#clearImgBtn")?.addEventListener("click", () => {
    lastUploadedFile = null;
    $("#preview").src = "";
    $("#previewWrap").hidden = true;
    $("#previewActions").hidden = true;
    $("#ocrStatus").hidden = true;
    $("#candidatesField").hidden = true;
    $("#rawOcrSection").hidden = true;
    $("#fileInput").value = "";
  });
  const cropOverlay = $("#cropOverlay");
  if (cropOverlay) {
    cropOverlay.addEventListener("mousedown", onCropDown);
    cropOverlay.addEventListener("mousemove", onCropMove);
    cropOverlay.addEventListener("mouseup", onCropUp);
    cropOverlay.addEventListener("mouseleave", onCropUp);
    cropOverlay.addEventListener("touchstart", onCropDown, { passive: false });
    cropOverlay.addEventListener("touchmove", onCropMove, { passive: false });
    cropOverlay.addEventListener("touchend", onCropUp);
  }

  // 다계정 추가 등록
  setupMultiAcc();

  $("#openConfig").addEventListener("click", (e) => {
    e.preventDefault();
    openConfigDialog(false);
  });
  $("#configCancel").addEventListener("click", () => $("#configDialog").close("cancel"));

  // 관리자 모드: ?admin=1 URL 파라미터 또는 제목 5회 클릭
  if (params.get("admin") === "1") {
    $("#openConfig").hidden = false;
  }
  let titleClicks = 0;
  document.querySelector(".brand")?.addEventListener("click", () => {
    titleClicks++;
    if (titleClicks >= 5) {
      $("#openConfig").hidden = false;
      titleClicks = 0;
    }
  });

  // SW 는 shared.js 가 자동 등록

  // 캐시 즉시 표시 (있으면) — 백그라운드로 최신 데이터 fetch
  const cEntries = readCache("entries");
  const cMembers = readCache("members");
  if (Array.isArray(cEntries) && cEntries.length) {
    cachedEntries = cEntries;
    renderEntries();
  }
  if (Array.isArray(cMembers) && cMembers.length) {
    cachedMembers = cMembers;
  }

  // bootstrap 으로 entries + members 한 번에 (실패 시 개별 호출 폴백)
  refreshViaBootstrap();
}

async function refreshViaBootstrap() {
  try {
    const ep = getEndpoint();
    if (!ep) return;
    const res = await fetch(`${ep}?action=bootstrap`);
    if (!res.ok) throw new Error("bootstrap http " + res.status);
    const d = await res.json();
    if (!d.ok) throw new Error("bootstrap not ok");
    cachedEntries = d.entries || [];
    cachedMembers = d.members || [];
    writeCache("entries", cachedEntries);
    writeCache("members", cachedMembers);
    renderEntries();
  } catch (err) {
    console.warn("bootstrap 실패, 개별 호출로 폴백:", err);
    refreshEntries();
    refreshMembers();
  }
}

document.addEventListener("DOMContentLoaded", init);
