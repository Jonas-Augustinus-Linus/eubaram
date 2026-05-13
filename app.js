// 주스터콜 공성신청 - Frontend Logic
// =====================================

const ENDPOINT_KEY = "juseter_endpoint";
const KST_OFFSET_MIN = 9 * 60;

// 요일 → 성 매핑 (KST 기준, 월~목)
// Note: getDay() returns 0=일, 1=월, 2=화, 3=수, 4=목
const CASTLE_BY_DAY = {
  1: { name: "주작성", openHour: 0, openMin: 0, closeHour: 23, closeMin: 30 },
  2: { name: "현무성", openHour: 0, openMin: 0, closeHour: 23, closeMin: 30 },
  3: { name: "청룡성", openHour: 0, openMin: 0, closeHour: 23, closeMin: 30 },
  4: { name: "백호성", openHour: 0, openMin: 0, closeHour: 23, closeMin: 30 },
};

const DAY_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

// ----- Helpers -----

function nowKst() {
  const utc = Date.now();
  return new Date(utc + KST_OFFSET_MIN * 60 * 1000);
}

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

function pad2(n) { return String(n).padStart(2, "0"); }

function formatKstDateTime(date) {
  const d = date || nowKst();
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function getEndpoint() {
  return localStorage.getItem(ENDPOINT_KEY) || "";
}

function setEndpoint(url) {
  if (url) localStorage.setItem(ENDPOINT_KEY, url);
  else localStorage.removeItem(ENDPOINT_KEY);
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
  return data.entries || [];
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

// ----- OCR -----

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

// 이미지 전처리: 긴 변 기준 maxDim 으로 리사이즈, JPEG 로 인코딩
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
  const out = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  return out;
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

// 서버 OCR (Google Drive API 사용) - Tesseract 보다 훨씬 정확
async function runOcrRemote(file) {
  const ep = getEndpoint();
  if (!ep) throw new Error("엔드포인트 미설정");
  $("#ocrStatusText").textContent = "이미지 리사이즈 중…";
  const blob = await resizeImage(file, 1600, 0.85);
  $("#ocrStatusText").textContent = "Google Drive OCR 실행 중… (3-10초)";
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

// 클라이언트 폴백 OCR (Tesseract.js)
async function runOcrLocal(file) {
  $("#ocrStatusText").textContent = "로컬 OCR (Tesseract) 실행 중…";
  // 가독성 향상을 위해 큰 사이즈로 입력 (Tesseract 는 더 큰 이미지에서 더 잘 동작)
  const blob = await resizeImage(file, 2200, 0.92);
  const result = await Tesseract.recognize(blob, "kor+eng", {
    logger: (msg) => {
      if (msg.status === "recognizing text") {
        const pct = Math.round((msg.progress || 0) * 100);
        $("#ocrStatusText").textContent = `로컬 OCR ${pct}%…`;
      }
    },
  });
  return result.data.text || "";
}

async function runOcr(file) {
  // 1순위: 서버 OCR (Google Drive API). 실패 시 Tesseract 로 폴백.
  try {
    const text = await runOcrRemote(file);
    if (text && text.trim().length >= 2) return { text, engine: "drive" };
    // 빈 결과면 폴백
  } catch (err) {
    console.warn("Drive OCR 실패, Tesseract 로 폴백:", err);
    $("#ocrStatusText").textContent = `Drive OCR 실패 (${err.message}) — Tesseract 폴백…`;
  }
  const text = await runOcrLocal(file);
  return { text, engine: "tesseract" };
}

// ----- DOM helpers -----

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

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

function todayKstString() {
  const d = nowKst();
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function filterEntries(entries, mode) {
  if (mode === "all") return entries;
  if (mode === "today") {
    const today = todayKstString();
    return entries.filter((e) => (e.dateKst || "").startsWith(today));
  }
  return entries.filter((e) => e.castle === mode);
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

function renderEntries() {
  const mode = $("#castleFilter").value;
  const filtered = filterEntries(cachedEntries, mode)
    .slice()
    .sort((a, b) => (b.dateKst || "").localeCompare(a.dateKst || ""));
  const tbody = $("#entriesTbody");
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">기록이 없습니다</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map((e) => {
    const castle = escapeHtml(e.castle || "");
    const nick = escapeHtml(e.nickname || "");
    const score = escapeHtml(e.score || "");
    const dt = escapeHtml(formatDisplayTime(e.dateKst));
    const note = escapeHtml(e.note || "");
    return `<tr>
      <td><span class="castle-pill pill-${castle}">${castle}</span></td>
      <td class="nick-cell">${nick}</td>
      <td class="score-cell num">${score}</td>
      <td class="time-cell">${dt}</td>
      <td class="note-cell">${note}</td>
    </tr>`;
  }).join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
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

// ----- Submit flow -----

async function handleSubmit() {
  setMessage("");
  const ctx = getCastleContext();
  if (!ctx.castle) {
    setMessage(ctx.reason, "error");
    return;
  }
  if (!ctx.isOpen) {
    setMessage(ctx.reason, "error");
    return;
  }

  const nickname = $("#nickname").value.trim();
  const score = $("#score").value.trim();
  const note = $("#note").value.trim();

  if (!nickname) {
    setMessage("닉네임을 입력해 주세요", "error");
    return;
  }
  if (!score) {
    setMessage("점수를 입력하거나 스크린샷에서 선택해 주세요", "error");
    return;
  }

  if (!getEndpoint()) {
    openConfigDialog(true);
    return;
  }

  // 중복 체크
  const todayStr = todayKstString();
  const dup = findDuplicate(nickname, ctx.castle, todayStr);
  if (dup) {
    const ok = await askConfirm(
      `이미 ${ctx.castle}에 [${dup.nickname}] 점수 ${dup.score} 가(이) 등록되어 있습니다. 점수갱신을 하신겁니까?`
    );
    if (!ok) {
      setMessage("취소되었습니다", "");
      return;
    }
  }

  const btn = $("#submitBtn");
  btn.disabled = true;
  setMessage("전송 중…");
  try {
    const payload = {
      action: "submit",
      nickname,
      score,
      note,
      castle: ctx.castle,
      dateKst: formatKstDateTime(),
      update: !!dup,
    };
    const res = await apiSubmit(payload);
    setMessage(res.updated ? "점수가 갱신되었습니다 ✅" : "신청 완료 ✅", "success");
    $("#score").value = "";
    $("#note").value = "";
    $("#preview").hidden = true;
    $("#preview").src = "";
    $("#candidatesField").hidden = true;
    await refreshEntries();
  } catch (err) {
    setMessage(`전송 실패: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
  }
}

function askConfirm(detail) {
  return new Promise((resolve) => {
    const dlg = $("#confirmDialog");
    $("#confirmDetail").textContent = detail;
    const onClose = () => {
      dlg.removeEventListener("close", onClose);
      resolve(dlg.returnValue === "confirm");
    };
    dlg.addEventListener("close", onClose);
    dlg.showModal();
  });
}

// ----- File / OCR handling -----

async function handleFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    setMessage("이미지 파일만 가능합니다", "error");
    return;
  }
  // preview
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = $("#preview");
    img.src = e.target.result;
    img.hidden = false;
  };
  reader.readAsDataURL(file);

  // OCR
  $("#ocrStatus").hidden = false;
  $("#ocrStatusText").textContent = "이미지에서 점수를 읽고 있어요…";
  $("#rawOcrText").textContent = "";
  $("#rawOcrSection").hidden = true;
  try {
    const { text, engine } = await runOcr(file);
    const { primary, list } = extractScoreCandidates(text);
    renderCandidates(list, primary);
    const engLabel = engine === "drive" ? "Drive OCR" : "Tesseract";
    if (primary) {
      $("#score").value = primary;
      $("#ocrStatusText").textContent = `${engLabel} → 「참가점수」 라벨에서 ${primary} 인식 ✓`;
    } else if (list.length) {
      // 라벨을 못 찾으면 자동 채우지 않음 - 사용자가 칩에서 직접 선택
      $("#ocrStatusText").textContent = `${engLabel} → 라벨 못 찾음. 아래 후보에서 골라주세요 (${list.length}개) 또는 직접 입력`;
    } else {
      $("#ocrStatusText").textContent = `${engLabel} → 점수 인식 실패. 직접 입력해 주세요.`;
    }
    // 디버그용 원본 텍스트 표시 (접혀있음)
    if (text) {
      $("#rawOcrText").textContent = text;
      $("#rawOcrSection").hidden = false;
    }
  } catch (err) {
    $("#ocrStatusText").textContent = `OCR 실패: ${err.message}`;
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
    // 파라미터 제거하고 깨끗한 URL 로
    history.replaceState({}, "", location.pathname);
  }

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
  $("#refreshBtn").addEventListener("click", refreshEntries);
  $("#castleFilter").addEventListener("change", renderEntries);

  $("#openConfig").addEventListener("click", (e) => {
    e.preventDefault();
    openConfigDialog(false);
  });
  $("#configCancel").addEventListener("click", () => $("#configDialog").close("cancel"));

  if (!getEndpoint()) {
    openConfigDialog(true);
  } else {
    refreshEntries();
  }
}

document.addEventListener("DOMContentLoaded", init);
