// =================================================
// EU연합 통합시스템 - 공통 유틸리티 (모든 페이지 첫 로드)
// =================================================

// ---- 연합 구조 (단일 진실 공급원) ----
const ALLIANCE = {
  name: "EU 연합",
  leader: { nickname: "스왚", guild: "쿠데타" },
  families: [
    { name: "쿠데타계",       guilds: ["쿠데타", "혁명", "반란", "난"] },
    { name: "주술사연합회계",  guilds: ["주술사연합회", "주스터콜", "주연", "주술사연맹", "주토피아", "주막왈숙네"] },
    { name: "로켓단계",       guilds: ["로켓단"] },
    { name: "매화계",         guilds: ["매화"] },
    { name: "신화계",         guilds: ["신화", "시"] },
    { name: "청룡계",         guilds: ["청룡"] },
    { name: "연가계",         guilds: ["월하", "연가", "연희"] },
  ],
};

const KST_OFFSET_MIN = 9 * 60;
const DEFAULT_ENDPOINT = "https://script.google.com/macros/s/AKfycbwuCTkMYPDZoQIXe63N5aFf0W-ViJeo8LX4kfspdmt9qporNmgJPWdFAH6GUy2JyN2x5A/exec";

// ---- DOM helpers ----
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function pad2(n) { return String(n).padStart(2, "0"); }

// ---- KST 시간 ----
function nowKst() { return new Date(Date.now() + KST_OFFSET_MIN * 60 * 1000); }

function todayKstString() {
  const d = nowKst();
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())}`;
}

// ---- 엔드포인트 ----
function getEndpoint() {
  return localStorage.getItem("juseter_endpoint") || DEFAULT_ENDPOINT;
}

// ---- 문파 → 계 ----
function guildToFamily(guild) {
  const g = (guild || "").trim();
  for (const f of ALLIANCE.families) {
    if (f.guilds.includes(g)) return f.name;
  }
  return "";
}

// ---- Tesseract.js 지연 로드 ----
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

// ---- 이미지 리사이즈 (긴 변 maxDim, JPEG) ----
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

// ---- OCR 전처리: 업스케일 + 그레이스케일 + 대비 향상 ----
async function preprocessForOcr(file, targetLong = 2400, contrast = 1.6) {
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
  const imgData = ctx.getImageData(0, 0, w, h);
  const px = imgData.data;
  for (let i = 0; i < px.length; i += 4) {
    const gray = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    let v = (gray - 128) * contrast + 128;
    if (v < 0) v = 0;
    else if (v > 255) v = 255;
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(imgData, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
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

// ---- localStorage SWR 캐시 (TTL 7일 + quota 보호) ----
const CACHE_PREFIX = "eubaram_cache_";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function readCache(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !("data" in obj)) return null;
    // ts 가 7일 이상 경과면 만료 처리 — 다음 fetch 때 갱신
    if (obj.ts && Date.now() - obj.ts > CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return obj.data;
  } catch { return null; }
}

function writeCache(key, data) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), data }));
  } catch (err) {
    // QuotaExceeded — eubaram_cache_* 키 전체 삭제 후 재시도
    try {
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(CACHE_PREFIX)) toRemove.push(k);
      }
      toRemove.forEach((k) => localStorage.removeItem(k));
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), data }));
    } catch {}
  }
}

// ---- 공성 카운트다운 ----
// 월~목 00:00 ~ 23:30 신청 가능. 그 외 시간은 다음 신청 시작 시각까지.
// kind: 'deadline' (오늘 마감까지), 'next-open' (다음 월요일 00:00 까지)
function getSiegeCountdown() {
  const d = nowKst();
  const day = d.getUTCDay();      // 0=일, 1=월, ..., 6=토
  const hour = d.getUTCHours();
  const min = d.getUTCMinutes();
  const sec = d.getUTCSeconds();
  const cur = hour * 3600 + min * 60 + sec;
  const close = 23 * 3600 + 30 * 60; // 23:30:00

  // 월~목 (1~4) + 마감 전이면 오늘 마감까지
  if (day >= 1 && day <= 4 && cur < close) {
    return { kind: "deadline", seconds: close - cur, day };
  }

  // 다음 월요일 00:00 까지 — 요일별 남은 일수 계산
  // 월 마감 후: 다음 월요일(6일 뒤), 화 마감 후: 다음 월(5일 뒤), ... 일요일: 1일 뒤
  let daysToNextMon;
  if (day === 0) daysToNextMon = 1;                  // 일
  else if (day >= 1 && day <= 4) daysToNextMon = 7 - day; // 월(마감후)~목(마감후) → 다음주 월
  else daysToNextMon = 8 - day;                      // 금=3, 토=2
  // (월 마감 후를 day>=1 && cur>=close 로도 구분하지만 결과적으론 위 식이 맞음)
  const secsToMidnight = (24 * 3600) - cur;
  const seconds = secsToMidnight + (daysToNextMon - 1) * 24 * 3600;
  return { kind: "next-open", seconds, day };
}

function formatCountdown(totalSec) {
  if (totalSec <= 0) return "00:00:00";
  const days = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (days > 0) return `${days}일 ${pad2(h)}:${pad2(m)}:${pad2(s)}`;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

// 카운트다운 DOM 갱신 (#siegeCountdown 요소가 있는 페이지에서만 동작)
function tickSiegeCountdown() {
  const el = document.getElementById("siegeCountdown");
  if (!el) return;
  const c = getSiegeCountdown();
  const labelMap = {
    "deadline": "오늘 마감까지",
    "next-open": "다음 신청 시작까지",
  };
  const label = labelMap[c.kind] || "";
  const time = formatCountdown(Math.max(0, c.seconds));
  // 1시간 이하면 위험 상태
  const urgent = c.kind === "deadline" && c.seconds <= 3600;
  el.classList.toggle("urgent", urgent);
  el.classList.toggle("offday", c.kind === "next-open");
  el.innerHTML = `<span class="cd-label">${label}</span><span class="cd-time">${time}</span>`;
}

// 페이지 로드 후 자동 시작 (1초 간격)
document.addEventListener("DOMContentLoaded", () => {
  tickSiegeCountdown();
  setInterval(tickSiegeCountdown, 1000);
});

// ---- Service Worker 자동 등록 (모든 페이지) ----
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
