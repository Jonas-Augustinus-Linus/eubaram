/**
 * EU연합 통합시스템 - Google Apps Script Backend
 *
 * 두 가지 방식 모두 지원:
 *  A) 바인딩 스크립트 (권장):
 *     - 구글 시트 → 확장 프로그램 → Apps Script 로 열어 사용
 *     - SPREADSHEET_ID 설정 불필요
 *  B) 독립 스크립트:
 *     - script.google.com 에서 새 프로젝트로 시작
 *     - 아래 SPREADSHEET_ID 를 본인 시트 ID 로 교체
 *
 * 공통 배포:
 *  1. 메뉴 → 배포 → 새 배포 → 유형: 웹 앱
 *     - 다음 사용자로 실행: 나
 *     - 액세스 권한: "모든 사용자"
 *     - 배포 → 권한 승인
 *  2. 발급된 웹앱 URL (...exec) 을 웹페이지 "엔드포인트 설정" 에 붙여넣기
 *
 * 최초 1회 관리자 초기화 (필수!):
 *  - Apps Script 편집기에서 setupInitialAdmin() 한 번 실행 → 초기 admin 계정 생성
 *  - 또는 Script Properties 에 ADMIN_ACCOUNTS JSON 직접 입력
 *  - 기본 admin/1234 폴백은 보안상 제거됨. 초기화 안 하면 모든 admin 액션이 실패.
 */

const SPREADSHEET_ID = ''; // 바인딩 스크립트는 빈 문자열로 두세요
const SHEET_NAME = '점수신청';
const HEADERS = ['성', '닉네임', '점수', '시간(KST)', '비고', '갱신여부', '정예참전', '문파'];

const MEMBER_SHEET = '문파원';
const MEMBER_HEADERS = ['닉네임', '문파', '계', '비고/직책', '추가일(KST)'];

// ========================================
// 보안 헬퍼
// ========================================

/**
 * 시트 셀 값 sanitize — 수식 주입(=, +, -, @ 시작) 차단.
 * Excel/Sheets 가 자동 평가하지 않도록 앞에 ' 를 붙임.
 */
function safeCell_(v) {
  const s = String(v == null ? '' : v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

/**
 * 에러 메시지 sanitize — 스택트레이스/내부 경로 노출 방지.
 * 콘솔에는 상세 기록, 사용자에겐 일반화된 메시지만.
 */
function safeErr_(err) {
  try { console.log(err && (err.stack || err.message) || err); } catch (_) {}
  return '서버 처리 중 오류가 발생했습니다';
}

/**
 * 간단한 rate limit (CacheService 기반).
 * key 별로 limitN 회 / windowSec 초 초과 시 차단.
 */
function rateLimit_(key, limitN, windowSec) {
  try {
    const cache = CacheService.getScriptCache();
    const cur = parseInt(cache.get(key) || '0', 10);
    if (cur >= limitN) return false;
    cache.put(key, String(cur + 1), windowSec);
    return true;
  } catch (_) { return true; } // 캐시 실패 시 통과 (가용성 우선)
}

// ========================================
// 다중 관리자 계정 (전체 관리자 + 문파별 관리자)
// 저장 형식 (PropertiesService 'ADMIN_ACCOUNTS'): { username: { password, scope } }
//   - scope: 'all' (전체) 또는 계 이름 (예: '쿠데타계')
//   - 기본 admin/1234 폴백은 제거됨 — setupInitialAdmin() 1회 실행 필요.
// ========================================

function getAccounts_() {
  const raw = PropertiesService.getScriptProperties().getProperty('ADMIN_ACCOUNTS');
  if (!raw) return {};
  try {
    return JSON.parse(raw) || {};
  } catch (_) {
    return {};
  }
}

function saveAccounts_(accts) {
  PropertiesService.getScriptProperties().setProperty('ADMIN_ACCOUNTS', JSON.stringify(accts));
}

/**
 * Apps Script 편집기에서 1회 수동 실행해서 초기 admin 생성.
 * 실행 시점에 비번 입력 다이얼로그 → 12자 이상 + 영숫자 조합 권장.
 * 실행 후 즉시 admin.html 에 로그인하고 비번 한번 더 변경 권장.
 */
function setupInitialAdmin() {
  const accts = getAccounts_();
  if (accts.admin) {
    return 'admin 계정이 이미 존재합니다. 변경하려면 관리자 페이지에서 비밀번호 변경.';
  }
  // 임시 강력 비밀번호 자동 생성
  const tmp = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  accts.admin = { password: tmp, scope: 'all' };
  saveAccounts_(accts);
  return '초기 admin 계정 생성됨. 비밀번호: ' + tmp + ' — 즉시 로그인 후 변경하세요!';
}

// body 안의 {username, password} 를 검증하여 {ok, scope, username} 반환
function authenticate_(body) {
  const u = ((body && body.username) || '').toString().trim();
  const pw = ((body && body.password) || '').toString();
  if (!u || !pw) return { ok: false };
  if (u.length > 64 || pw.length > 128) return { ok: false };
  const accts = getAccounts_();
  for (const name in accts) {
    if (name.toLowerCase() === u.toLowerCase()) {
      const info = accts[name];
      if (info && info.password === pw) return { ok: true, scope: info.scope || '', username: name };
      return { ok: false };
    }
  }
  return { ok: false };
}

function isSuperAdmin_(body) {
  const a = authenticate_(body);
  return a.ok && a.scope === 'all';
}

// 연합 트리 (Apps Script 내 캐시) — 프론트와 동일
const ALLIANCE_TREE_ = {
  '쿠데타계':       ['쿠데타', '혁명', '반란', '난'],
  '주술사연합회계':  ['주술사연합회', '주스터콜', '주연', '주술사연맹', '주토피아', '주막왈숙네'],
  '로켓단계':       ['로켓단'],
  '매화계':         ['매화'],
  '신화계':         ['신화', '시'],
  '청룡계':         ['청룡'],
  '연가계':         ['월하', '연가', '연희'],
};

// 스코프에 해당하는 문파 목록 반환. 'all' → null (모든 문파), 계 이름 → 소속 문파 배열, 그 외 → [단일 문파]
function guildsForScope_(scope) {
  if (!scope || scope === 'all') return null;
  if (ALLIANCE_TREE_[scope]) return ALLIANCE_TREE_[scope];
  return [scope];
}

// 스코프가 특정 문파를 포함하는지
function scopeIncludes_(scope, guild) {
  const list = guildsForScope_(scope);
  if (list === null) return true;
  return list.indexOf(guild) >= 0;
}

// 권한 체크: 'all' 스코프이면 모든 권한, 아니면 해당 문파만
function authorize_(body, requiredGuild) {
  const a = authenticate_(body);
  if (!a.ok) return { ok: false, error: 'unauthorized' };
  if (a.scope === 'all') return { ok: true, auth: a };
  if (requiredGuild && a.scope !== requiredGuild) return { ok: false, error: '권한 없음' };
  return { ok: true, auth: a };
}

// checkAdmin_: 명시적 username/password 만 허용 (옛 password-only 폴백 제거 — 보안)
function checkAdmin_(body) {
  return authenticate_(body).ok;
}

// 비밀번호 변경 (자기 계정)
function changeAdminPassword_(body) {
  const a = authenticate_(body);
  if (!a.ok) return { ok: false, error: 'unauthorized' };
  const newPw = (body.newPassword || '').toString().trim();
  if (newPw.length < 3) return { ok: false, error: '비밀번호는 3자 이상이어야 합니다' };
  if (newPw.length > 64) return { ok: false, error: '64자 이하' };
  const accts = getAccounts_();
  accts[a.username] = { password: newPw, scope: a.scope };
  saveAccounts_(accts);
  return { ok: true };
}

// 계정 목록 (전체관리자 전용)
function listAccounts_(body) {
  if (!isSuperAdmin_(body)) return { ok: false, error: 'forbidden' };
  const accts = getAccounts_();
  const list = Object.keys(accts).map((u) => ({
    username: u,
    scope: accts[u].scope,
  }));
  return { ok: true, accounts: list };
}

// 계정 추가/수정 (전체관리자 전용)
function setAccount_(body) {
  if (!isSuperAdmin_(body)) return { ok: false, error: 'forbidden' };
  const target = (body.targetUsername || '').toString().trim();
  const pw = (body.newPassword || '').toString();
  const scope = (body.scope || '').toString();
  if (!target) return { ok: false, error: '아이디 누락' };
  if (target.toLowerCase() === 'admin' && scope !== 'all') {
    return { ok: false, error: 'admin 계정은 전체 스코프 고정' };
  }
  if (pw.length < 3) return { ok: false, error: '비밀번호 3자 이상' };
  const accts = getAccounts_();
  accts[target] = { password: pw, scope };
  saveAccounts_(accts);
  return { ok: true };
}

// 계정 삭제 (전체관리자 전용, admin 계정은 삭제 불가)
function removeAccount_(body) {
  if (!isSuperAdmin_(body)) return { ok: false, error: 'forbidden' };
  const target = (body.targetUsername || '').toString().trim();
  if (!target || target.toLowerCase() === 'admin') return { ok: false, error: 'admin 은 삭제 불가' };
  const accts = getAccounts_();
  if (!accts[target]) return { ok: false, error: '없음' };
  delete accts[target];
  saveAccounts_(accts);
  return { ok: true };
}

// ====================================================
// 성주 현황 (4성: 주작/현무/청룡/백호)
// ====================================================

function getCastleLords_() {
  const raw = PropertiesService.getScriptProperties().getProperty('CASTLE_LORDS');
  const defaults = { '주작성': null, '현무성': null, '청룡성': null, '백호성': null };
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw);
    return Object.assign(defaults, parsed);
  } catch (_) {
    return defaults;
  }
}

function setCastleLord_(body) {
  if (!isSuperAdmin_(body)) return { ok: false, error: 'forbidden: 전체 관리자만' };
  const castle = (body.castle || '').toString();
  const guild = (body.guild || '').toString().trim();
  if (['주작성','현무성','청룡성','백호성'].indexOf(castle) < 0) {
    return { ok: false, error: '유효하지 않은 성' };
  }
  const lords = getCastleLords_();
  lords[castle] = guild
    ? {
        guild,
        updatedAt: Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'),
      }
    : null;
  PropertiesService.getScriptProperties().setProperty('CASTLE_LORDS', JSON.stringify(lords));
  invalidateBootstrap_();
  return { ok: true };
}

// ====================================================
// 연합 지침 (공지/안내문)
// ====================================================

function getGuidelines_() {
  return PropertiesService.getScriptProperties().getProperty('GUIDELINES') || '';
}

function setGuidelines_(body) {
  if (!isSuperAdmin_(body)) return { ok: false, error: 'forbidden: 전체 관리자만' };
  const text = (body.text || '').toString();
  if (text.length > 20000) return { ok: false, error: '20,000자 초과' };
  PropertiesService.getScriptProperties().setProperty('GUIDELINES', text);
  PropertiesService.getScriptProperties().setProperty('GUIDELINES_UPDATED_AT',
    Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm')
  );
  invalidateBootstrap_();
  return { ok: true };
}

function getSheet_() {
  const ss = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('스프레드시트 연결 실패: 바인딩 스크립트로 열거나 SPREADSHEET_ID 설정 필요');
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  // ensure headers
  const firstRow = sh.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (firstRow.join('|') !== HEADERS.join('|')) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sh.setFrozenRows(1);
  }
  // 시간 컬럼이 Date 로 자동 변환되지 않게 텍스트로 고정
  sh.getRange('D2:D').setNumberFormat('@');
  return sh;
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'list';
    if (action === 'list') return jsonOut_({ ok: true, entries: listEntries_() });
    if (action === 'members') return jsonOut_({ ok: true, members: listMembers_() });
    if (action === 'castleLords') return jsonOut_({ ok: true, lords: getCastleLords_() });
    if (action === 'guidelines') return jsonOut_({ ok: true, text: getGuidelines_() });
    if (action === 'bootstrap') return jsonOut_(getBootstrap_());
    return jsonOut_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return jsonOut_({ ok: false, error: safeErr_(err) });
  }
}

// ====================================================
// Bootstrap: 랜딩/siege 가 필요로 하는 4종을 단일 호출로 묶음.
// CacheService 로 30초 캐시 → cold-start 영향 최소화.
// 변경 액션 (submit / members:* / castleLord:set / guidelines:set) 에서 invalidate.
// ====================================================

const BOOTSTRAP_CACHE_KEY = 'bootstrap_v1';
const BOOTSTRAP_CACHE_SEC = 30;

function getBootstrap_() {
  try {
    const cache = CacheService.getScriptCache();
    const cached = cache.get(BOOTSTRAP_CACHE_KEY);
    if (cached) {
      try { return JSON.parse(cached); } catch (_) {}
    }
    const out = {
      ok: true,
      entries: listEntries_(),
      members: listMembers_(),
      lords: getCastleLords_(),
      guidelines: getGuidelines_(),
      serverTime: Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'),
    };
    try { cache.put(BOOTSTRAP_CACHE_KEY, JSON.stringify(out), BOOTSTRAP_CACHE_SEC); } catch (_) {}
    return out;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function invalidateBootstrap_() {
  try { CacheService.getScriptCache().remove(BOOTSTRAP_CACHE_KEY); } catch (_) {}
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = body.action || 'submit';

    // 익명 액션 (submit, ocr) 레이트 리밋 — 닉네임/이미지 길이로 단순 키 생성
    if (action === 'submit') {
      const key = 'rl:submit:' + (body.nickname || 'anon').toString().slice(0, 16);
      if (!rateLimit_(key, 6, 60)) return jsonOut_({ ok: false, error: '신청 빈도가 너무 잦습니다. 1분 후 다시 시도해 주세요.' });
      return jsonOut_(submitEntry_(body));
    }
    if (action === 'ocr') {
      const key = 'rl:ocr:' + (body.mime || 'x').toString().slice(0, 16);
      if (!rateLimit_(key, 30, 60)) return jsonOut_({ ok: false, error: 'OCR 빈도가 너무 잦습니다.' });
      return jsonOut_(ocrImage_(body));
    }

    if (action === 'members:list') return jsonOut_({ ok: true, members: listMembers_() });
    if (action === 'members:set') return jsonOut_(setMembers_(body));
    if (action === 'members:add') return jsonOut_(addMember_(body));
    if (action === 'members:remove') return jsonOut_(removeMember_(body));
    if (action === 'stats:weekly') return jsonOut_(getWeeklyStats_(body));
    if (action === 'stats:comparison') return jsonOut_(getComparison_(body));
    if (action === 'stats:monthly') return jsonOut_(getMonthlyGrowth_(body));
    if (action === 'admin:checkPw') return jsonOut_({ ok: checkAdmin_(body) });
    if (action === 'admin:login') {
      const a = authenticate_(body);
      return jsonOut_({ ok: a.ok, scope: a.scope || null, username: a.username || null });
    }
    if (action === 'admin:changePw') return jsonOut_(changeAdminPassword_(body));
    if (action === 'admin:accounts:list') return jsonOut_(listAccounts_(body));
    if (action === 'admin:accounts:set') return jsonOut_(setAccount_(body));
    if (action === 'admin:accounts:remove') return jsonOut_(removeAccount_(body));
    if (action === 'castleLord:set') return jsonOut_(setCastleLord_(body));
    if (action === 'guidelines:set') return jsonOut_(setGuidelines_(body));
    return jsonOut_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return jsonOut_({ ok: false, error: safeErr_(err) });
  }
}

// ====================================================
// 문파원 명단 관리
// ====================================================

function getMemberSheet_() {
  const ss = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('스프레드시트 연결 실패');
  let sh = ss.getSheetByName(MEMBER_SHEET);
  if (!sh) {
    sh = ss.insertSheet(MEMBER_SHEET);
    sh.appendRow(MEMBER_HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, MEMBER_HEADERS.length).setFontWeight('bold');
  }
  const firstRow = sh.getRange(1, 1, 1, MEMBER_HEADERS.length).getValues()[0];
  if (firstRow.join('|') !== MEMBER_HEADERS.join('|')) {
    sh.getRange(1, 1, 1, MEMBER_HEADERS.length).setValues([MEMBER_HEADERS]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function listMembers_() {
  const sh = getMemberSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  const vals = sh.getRange(2, 1, last - 1, MEMBER_HEADERS.length).getValues();
  return vals
    .filter((r) => String(r[0] || '').trim())
    .map((r) => ({
      nickname: String(r[0] || '').trim(),
      guild: String(r[1] || '').trim(),
      family: String(r[2] || '').trim(),
      role: String(r[3] || ''),
      addedAt: formatDateValue_(r[4]),
    }));
}

// body.members: Array<{nickname, guild, family, role}> or Array<string>
// body.replaceGuild (선택): 'all' 또는 특정 문파명. 해당 범위만 교체.
function setMembers_(body) {
  const a = authenticate_(body);
  if (!a.ok) return { ok: false, error: 'unauthorized' };
  const rawList = Array.isArray(body.members) ? body.members : [];
  if (rawList.length > 500) return { ok: false, error: '한 번에 최대 500명' };
  let replaceGuild = (body.replaceGuild || 'all').toString();
  const allowedGuilds = guildsForScope_(a.scope);
  if (allowedGuilds !== null) {
    rawList.forEach((raw) => {
      if (raw && typeof raw === 'object') {
        if (!raw.guild || allowedGuilds.indexOf(raw.guild) < 0) {
          raw.guild = allowedGuilds[0];
        }
      }
    });
    if (replaceGuild !== 'all' && allowedGuilds.indexOf(replaceGuild) < 0) {
      replaceGuild = 'all';
    }
  }

  const lock = LockService.getScriptLock();
  try { lock.waitLock(5000); } catch (_) { return { ok: false, error: '서버가 바쁩니다.' }; }
  try {
    const sh = getMemberSheet_();
    const last = sh.getLastRow();
    if (last >= 2) {
      if (replaceGuild === 'all') {
        sh.getRange(2, 1, last - 1, MEMBER_HEADERS.length).clearContent();
      } else {
        const all = sh.getRange(2, 1, last - 1, MEMBER_HEADERS.length).getValues();
        for (let i = all.length - 1; i >= 0; i--) {
          if (String(all[i][1] || '').trim() === replaceGuild) {
            sh.deleteRow(i + 2);
          }
        }
      }
    }
    const now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
    const seen = new Set();
    const rows = [];
    rawList.forEach((raw) => {
      const obj = typeof raw === 'string' ? { nickname: raw } : (raw || {});
      const nick = String(obj.nickname || '').trim().slice(0, 32);
      if (!nick) return;
      const key = nick.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      rows.push([
        safeCell_(nick),
        safeCell_(String(obj.guild || '').trim().slice(0, 32)),
        safeCell_(String(obj.family || '').trim().slice(0, 32)),
        safeCell_(String(obj.role || '').trim().slice(0, 32)),
        now,
      ]);
    });
    if (rows.length) {
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, MEMBER_HEADERS.length).setValues(rows);
    }
    invalidateBootstrap_();
    return { ok: true, count: rows.length };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function addMember_(body) {
  const a = authenticate_(body);
  if (!a.ok) return { ok: false, error: 'unauthorized' };
  const nickname = (body.nickname || '').toString().trim();
  if (!nickname) return { ok: false, error: '닉네임 누락' };
  if (nickname.length > 32) return { ok: false, error: '닉네임이 너무 깁니다 (최대 32자)' };
  const allowedGuilds = guildsForScope_(a.scope);
  if (allowedGuilds !== null) {
    const g = (body.guild || '').toString().trim();
    if (!g || allowedGuilds.indexOf(g) < 0) {
      return { ok: false, error: '권한 범위 외 문파' };
    }
    body.family = a.scope;
  }

  const lock = LockService.getScriptLock();
  try { lock.waitLock(5000); } catch (_) { return { ok: false, error: '서버가 바쁩니다.' }; }
  try {
    const sh = getMemberSheet_();
    const last = sh.getLastRow();
    if (last >= 2) {
      const existing = sh.getRange(2, 1, last - 1, 1).getValues().flat()
        .map((s) => String(s || '').trim().toLowerCase());
      if (existing.includes(nickname.toLowerCase())) {
        return { ok: false, error: '이미 등록된 문원' };
      }
    }
    const now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
    sh.appendRow([
      safeCell_(nickname),
      safeCell_(String(body.guild || '').trim().slice(0, 32)),
      safeCell_(String(body.family || '').trim().slice(0, 32)),
      safeCell_(String(body.role || '').trim().slice(0, 32)),
      now,
    ]);
    invalidateBootstrap_();
    return { ok: true };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function removeMember_(body) {
  const a = authenticate_(body);
  if (!a.ok) return { ok: false, error: 'unauthorized' };
  const nickname = (body.nickname || '').toString().trim().toLowerCase();
  if (!nickname) return { ok: false, error: '닉네임 누락' };
  const sh = getMemberSheet_();
  const last = sh.getLastRow();
  if (last < 2) return { ok: false, error: 'not_found' };
  // 문파 관리자는 자기 문파 사람만 삭제 가능
  const vals = sh.getRange(2, 1, last - 1, MEMBER_HEADERS.length).getValues();
  for (let i = vals.length - 1; i >= 0; i--) {
    const rowNick = String(vals[i][0] || '').trim().toLowerCase();
    const rowGuild = String(vals[i][1] || '').trim();
    if (rowNick === nickname) {
      const allowedGuilds = guildsForScope_(a.scope);
      if (allowedGuilds !== null && allowedGuilds.indexOf(rowGuild) < 0) {
        return { ok: false, error: '권한 없음 (다른 계 문원)' };
      }
      sh.deleteRow(i + 2);
      invalidateBootstrap_();
      return { ok: true };
    }
  }
  return { ok: false, error: 'not_found' };
}

// ====================================================
// 통계
// ====================================================

function kstNow_() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function kstDateStr_(d) {
  return Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd');
}

// 이번 주 월요일 ~ 일요일 (KST)
function thisWeekRange_() {
  const d = kstNow_();
  const dow = d.getUTCDay(); // 0=Sun
  const offset = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(d.getTime());
  mon.setUTCDate(mon.getUTCDate() + offset);
  const sun = new Date(mon.getTime());
  sun.setUTCDate(sun.getUTCDate() + 6);
  return { start: kstDateStr_(mon), end: kstDateStr_(sun) };
}

function lastWeekRange_() {
  const t = thisWeekRange_();
  const ms = new Date(t.start + 'T00:00:00Z');
  ms.setUTCDate(ms.getUTCDate() - 7);
  const me = new Date(t.end + 'T00:00:00Z');
  me.setUTCDate(me.getUTCDate() - 7);
  return { start: kstDateStr_(ms), end: kstDateStr_(me) };
}

function entriesInRange_(entries, start, end) {
  return entries.filter((e) => {
    const d = (e.dateKst || '').slice(0, 10);
    return d >= start && d <= end;
  });
}

function bestPerNick_(entries) {
  // returns Map<nickLower, {score, ...entry}>
  const map = new Map();
  entries.forEach((e) => {
    const k = (e.nickname || '').trim().toLowerCase();
    if (!k) return;
    const s = parseFloat(e.score) || 0;
    const prev = map.get(k);
    if (!prev || s > parseFloat(prev.score)) {
      map.set(k, e);
    }
  });
  return map;
}

function getWeeklyStats_(body) {
  const a = authenticate_(body);
  if (!a.ok) return { ok: false, error: 'unauthorized' };
  // 스코프로 1차 필터, 그 안에서 guildFilter (사용자 선택) 로 2차 필터
  const allowedGuilds = guildsForScope_(a.scope); // null = 전체
  const requested = (body.guildFilter || '').toString().trim();
  // 'all' 또는 빈 값이면 allowedGuilds 전부, 특정 문파면 그 문파만 (단, allowedGuilds 안에 있어야 함)
  let activeGuilds = allowedGuilds; // null 가능
  if (requested && requested !== 'all') {
    if (allowedGuilds && allowedGuilds.indexOf(requested) < 0) {
      return { ok: false, error: '권한 외 문파' };
    }
    activeGuilds = [requested];
  }
  const range = body.range === 'last' ? lastWeekRange_() : thisWeekRange_();
  const allEntries = listEntries_();
  let members = listMembers_();
  let inRange = entriesInRange_(allEntries, range.start, range.end);
  if (activeGuilds !== null) {
    members = members.filter((m) => activeGuilds.indexOf(m.guild || '') >= 0);
    inRange = inRange.filter((e) => activeGuilds.indexOf(e.guild || '') >= 0);
  }

  const bestMap = bestPerNick_(inRange);
  const memberMap = new Map();
  members.forEach((m) => memberMap.set(m.nickname.toLowerCase(), m.nickname));

  const memberStats = members.map((m) => {
    const k = m.nickname.toLowerCase();
    const e = bestMap.get(k);
    if (!e) return { nickname: m.nickname, submitted: false };
    return {
      nickname: m.nickname,
      submitted: true,
      score: e.score,
      castle: e.castle,
      dateKst: e.dateKst,
      elite: e.elite,
      note: e.note,
    };
  });

  // 비문원 신청자
  const nonMember = inRange.filter((e) => !memberMap.has((e.nickname || '').toLowerCase()));

  const totalMembers = members.length;
  const submittedCount = memberStats.filter((s) => s.submitted).length;
  const pct = totalMembers > 0 ? Math.round((submittedCount / totalMembers) * 1000) / 10 : 0;

  // Elite 통계
  const eliteCounts = { O: 0, X: 0, '최대한 참여': 0, '': 0 };
  memberStats.forEach((s) => {
    if (!s.submitted) return;
    const v = s.elite || '';
    if (eliteCounts.hasOwnProperty(v)) eliteCounts[v]++;
    else eliteCounts[''] = (eliteCounts[''] || 0) + 1;
  });

  return {
    ok: true,
    period: range,
    totalMembers,
    submittedCount,
    percentage: pct,
    members: memberStats,
    nonMemberEntries: nonMember,
    eliteCounts,
  };
}

function getComparison_(body) {
  const a = authenticate_(body);
  if (!a.ok) return { ok: false, error: 'unauthorized' };
  const allowedGuilds = guildsForScope_(a.scope);
  const requested = (body.guildFilter || '').toString().trim();
  let activeGuilds = allowedGuilds;
  if (requested && requested !== 'all') {
    if (allowedGuilds && allowedGuilds.indexOf(requested) < 0) return { ok: false, error: '권한 외 문파' };
    activeGuilds = [requested];
  }
  const thisR = thisWeekRange_();
  const lastR = lastWeekRange_();
  const entries = listEntries_();
  let members = listMembers_();
  if (activeGuilds !== null) members = members.filter((m) => activeGuilds.indexOf(m.guild || '') >= 0);

  const thisBest = bestPerNick_(entriesInRange_(entries, thisR.start, thisR.end));
  const lastBest = bestPerNick_(entriesInRange_(entries, lastR.start, lastR.end));

  const rows = members.map((m) => {
    const k = m.nickname.toLowerCase();
    const t = thisBest.get(k);
    const l = lastBest.get(k);
    const tScore = t ? parseFloat(t.score) || 0 : null;
    const lScore = l ? parseFloat(l.score) || 0 : null;
    const diff = (tScore !== null && lScore !== null) ? Math.round((tScore - lScore) * 100) / 100 : null;
    return { nickname: m.nickname, thisScore: tScore, lastScore: lScore, diff };
  });

  return { ok: true, thisRange: thisR, lastRange: lastR, rows };
}

function getMonthlyGrowth_(body) {
  const a = authenticate_(body);
  if (!a.ok) return { ok: false, error: 'unauthorized' };
  const allowedGuilds = guildsForScope_(a.scope);
  const requested = (body.guildFilter || '').toString().trim();
  let activeGuilds = allowedGuilds;
  if (requested && requested !== 'all') {
    if (allowedGuilds && allowedGuilds.indexOf(requested) < 0) return { ok: false, error: '권한 외 문파' };
    activeGuilds = [requested];
  }
  const end = kstNow_();
  const start = new Date(end.getTime());
  start.setUTCDate(start.getUTCDate() - 28);
  const range = { start: kstDateStr_(start), end: kstDateStr_(end) };

  const entries = listEntries_();
  let members = listMembers_();
  let inRange = entriesInRange_(entries, range.start, range.end);
  if (activeGuilds !== null) {
    members = members.filter((m) => activeGuilds.indexOf(m.guild || '') >= 0);
    inRange = inRange.filter((e) => activeGuilds.indexOf(e.guild || '') >= 0);
  }

  const rows = members.map((m) => {
    const k = m.nickname.toLowerCase();
    const userEntries = inRange
      .filter((e) => (e.nickname || '').trim().toLowerCase() === k)
      .sort((a, b) => (a.dateKst || '').localeCompare(b.dateKst || ''));
    if (userEntries.length < 1) return { nickname: m.nickname, count: 0, firstScore: null, lastScore: null, diff: null };
    const scores = userEntries.map((e) => parseFloat(e.score) || 0);
    const first = scores[0];
    const last = Math.max(...scores);
    return {
      nickname: m.nickname,
      count: userEntries.length,
      firstScore: first,
      lastScore: last,
      diff: Math.round((last - first) * 100) / 100,
    };
  });

  rows.sort((a, b) => {
    if (a.diff === null && b.diff === null) return 0;
    if (a.diff === null) return 1;
    if (b.diff === null) return -1;
    return b.diff - a.diff;
  });

  return { ok: true, range, rows };
}

/**
 * 1회 권한 부여 트리거:
 *   편집기에서 이 함수 한 번 실행 → Google 이 Drive 권한 다이얼로그 표시 → 승인.
 *   승인 후엔 ocrImage_ 가 정상 동작합니다.
 *   (서비스 추가만으로는 OAuth 스코프가 확장 안되므로 이 단계 필요)
 */
function setupOcrPermissions() {
  const blob = Utilities.newBlob('setup', 'text/plain', 'setup.txt');
  const f = Drive.Files.insert({title: 'setup-' + Date.now(), mimeType: 'text/plain'}, blob, {convert: false});
  DriveApp.getFileById(f.id).setTrashed(true);
  return 'OK';
}

/**
 * OCR 디스패처.
 * 1) VISION_API_KEY 스크립트 속성이 있으면 Google Cloud Vision API 사용 (권장, 인식률 최고).
 * 2) 없으면 Drive API v2 의 OCR 기능 폴백 (rate limit 있음).
 *
 * Vision API 설정 (1회만):
 *   1) console.cloud.google.com 접속 → Apps Script 와 같은 프로젝트 선택
 *   2) "API 및 서비스 → 라이브러리" → "Cloud Vision API" 사용 설정
 *   3) "사용자 인증 정보 → 사용자 인증 정보 만들기 → API 키" 생성
 *   4) 키 제한: "API 제한사항" → "키 제한" → Cloud Vision API 만 허용 (권장)
 *   5) Apps Script 편집기 → 프로젝트 설정 (⚙️) → 스크립트 속성 → 속성 추가
 *      이름: VISION_API_KEY  값: AIza... (위에서 받은 키)
 *   6) 「배포 관리」 → ✏️ → 새 버전 → 배포
 *
 *   * 무료 한도: 월 1,000 호출. 초과 시 $1.50 / 1,000건.
 */
// 이미지 base64 최대 크기 (~7MB base64 = ~5MB raw). Apps Script payload 한도 + Vision API 안전 마진.
const OCR_MAX_B64_BYTES = 7 * 1024 * 1024;

function ocrImage_(body) {
  // 입력 크기 검증
  const raw = ((body && body.image) || '').toString();
  if (!raw) return { ok: false, error: '이미지 없음' };
  if (raw.length > OCR_MAX_B64_BYTES) {
    return { ok: false, error: '이미지가 너무 큽니다 (최대 5MB). 압축 후 다시 시도해 주세요.' };
  }
  const visionKey = PropertiesService.getScriptProperties().getProperty('VISION_API_KEY');
  if (visionKey) return visionOcr_(body, visionKey);
  return driveOcr_(body);
}

function visionOcr_(body, apiKey) {
  try {
    const raw = (body.image || '').toString();
    const b64 = raw.replace(/^data:[^,]+,/, '');
    if (!b64) return { ok: false, error: '이미지 없음' };
    const reqBody = {
      requests: [{
        image: { content: b64 },
        features: [{ type: 'TEXT_DETECTION', maxResults: 1 }],
        imageContext: { languageHints: ['ko', 'en'] },
      }],
    };
    const res = UrlFetchApp.fetch(
      'https://vision.googleapis.com/v1/images:annotate?key=' + encodeURIComponent(apiKey),
      {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(reqBody),
        muteHttpExceptions: true,
      }
    );
    const code = res.getResponseCode();
    const raw_resp = res.getContentText();
    let data;
    try { data = JSON.parse(raw_resp); } catch (_) { data = {}; }
    if (code !== 200) {
      const errMsg = (data.error && data.error.message) || ('HTTP ' + code);
      return { ok: false, error: 'Vision API: ' + errMsg };
    }
    const ann = data.responses && data.responses[0];
    if (ann && ann.error) {
      return { ok: false, error: 'Vision API: ' + ann.error.message };
    }
    const text = ann && ann.fullTextAnnotation ? ann.fullTextAnnotation.text : '';
    return { ok: true, text: text, engine: 'vision' };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function driveOcr_(body) {
  try {
    if (typeof Drive === 'undefined' || !Drive.Files) {
      return { ok: false, error: 'Drive API v2 서비스가 활성화되지 않았고 VISION_API_KEY 도 없습니다. 둘 중 하나를 설정하세요.' };
    }
    const raw = (body.image || '').toString();
    const b64 = raw.replace(/^data:[^,]+,/, '');
    if (!b64) return { ok: false, error: '이미지 없음' };
    const mime = (body.mime || 'image/png').toString();
    const bytes = Utilities.base64Decode(b64);
    const blob = Utilities.newBlob(bytes, mime, 'ocr-input');
    const resource = {
      title: 'ocr-temp-' + Date.now(),
      mimeType: mime,
    };
    const file = Drive.Files.insert(resource, blob, {
      convert: true,
      ocr: true,
      ocrLanguage: 'ko',
    });
    let text = '';
    try {
      const doc = DocumentApp.openById(file.id);
      text = doc.getBody().getText();
    } finally {
      try { DriveApp.getFileById(file.id).setTrashed(true); } catch (_) {}
    }
    return { ok: true, text: text, engine: 'drive' };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function formatDateValue_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  }
  return String(v || '');
}

function listEntries_() {
  const sh = getSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  const values = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  return values
    .filter((r) => r[1] || r[2])
    .map((r) => ({
      castle: String(r[0] || ''),
      nickname: String(r[1] || ''),
      score: String(r[2] || ''),
      dateKst: formatDateValue_(r[3]),
      note: String(r[4] || ''),
      updated: String(r[5] || '') === '갱신',
      elite: String(r[6] || ''),
      guild: String(r[7] || ''),
    }));
}

function submitEntry_(body) {
  const nickname = (body.nickname || '').toString().trim();
  const score = (body.score || '').toString().trim();
  const castle = (body.castle || '').toString().trim();
  const dateKst = (body.dateKst || '').toString().trim();
  let note = (body.note || '').toString().trim();
  const elite = (body.elite || '').toString().trim();
  const guild = (body.guild || '').toString().trim();
  const wantUpdate = !!body.update;

  // --- 입력 검증 (서버측 화이트리스트, 클라이언트 maxlength 로는 부족) ---
  if (!nickname) return { ok: false, error: '닉네임 누락' };
  if (nickname.length > 32) return { ok: false, error: '닉네임이 너무 깁니다 (최대 32자)' };
  if (!score) return { ok: false, error: '점수 누락' };
  if (!/^-?\d{1,5}(\.\d{1,3})?$/.test(score)) return { ok: false, error: '점수 형식 오류 (예: 2818.23)' };
  if (!castle) return { ok: false, error: '성 누락' };
  if (['주작성','현무성','청룡성','백호성'].indexOf(castle) < 0) return { ok: false, error: '유효하지 않은 성' };
  if (dateKst && !/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}/.test(dateKst)) return { ok: false, error: '시간 형식 오류' };
  if (elite && ['O','X','최대한 참여'].indexOf(elite) < 0) return { ok: false, error: '정예 값 오류' };
  if (guild.length > 32) return { ok: false, error: '문파명이 너무 깁니다' };
  if (note.length > 200) note = note.slice(0, 200);

  // --- 동시성 락 (중복 검색 ~ append 사이 race 차단) ---
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
  } catch (_) {
    return { ok: false, error: '서버가 바쁩니다. 잠시 후 다시 시도해 주세요.' };
  }
  try {
    const sh = getSheet_();
    const last = sh.getLastRow();
    const todayPrefix = (dateKst || '').slice(0, 10);

    // 중복 검색: 같은 닉네임 + 성 + 같은 날(YYYY-MM-DD)
    let dupRow = -1;
    if (last >= 2 && todayPrefix) {
      const values = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
      for (let i = 0; i < values.length; i++) {
        const r = values[i];
        if (
          String(r[0] || '').trim() === castle &&
          String(r[1] || '').trim().toLowerCase() === nickname.toLowerCase() &&
          String(r[3] || '').slice(0, 10) === todayPrefix
        ) {
          dupRow = i + 2;
          break;
        }
      }
    }

    if (wantUpdate) {
      if (dupRow <= 0) return { ok: false, error: 'not_found', notFound: true };
      sh.getRange(dupRow, 1, 1, HEADERS.length).setValues([[
        safeCell_(castle), safeCell_(nickname), safeCell_(score), safeCell_(dateKst),
        safeCell_(note), '갱신', safeCell_(elite), safeCell_(guild),
      ]]);
      invalidateBootstrap_();
      return { ok: true, updated: true };
    }

    if (dupRow > 0) return { ok: false, error: 'duplicate', duplicate: true };

    sh.appendRow([
      safeCell_(castle), safeCell_(nickname), safeCell_(score), safeCell_(dateKst),
      safeCell_(note), '', safeCell_(elite), safeCell_(guild),
    ]);
    invalidateBootstrap_();
    return { ok: true, updated: false };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}
