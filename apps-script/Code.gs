/**
 * 주스터콜 공성신청 - Google Apps Script Backend
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
 */

const SPREADSHEET_ID = ''; // 바인딩 스크립트는 빈 문자열로 두세요
const SHEET_NAME = '점수신청';
const HEADERS = ['성', '닉네임', '점수', '시간(KST)', '비고', '갱신여부', '정예참전', '문파'];

const MEMBER_SHEET = '문파원';
const MEMBER_HEADERS = ['닉네임', '문파', '계', '비고/직책', '추가일(KST)'];

// 관리자 비밀번호: PropertiesService 에 저장. 미설정 시 기본값 '1234'.
const ADMIN_PASSWORD_DEFAULT = '1234';

function getAdminPassword_() {
  const v = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  return v || ADMIN_PASSWORD_DEFAULT;
}

function setAdminPasswordProp_(newPw) {
  PropertiesService.getScriptProperties().setProperty('ADMIN_PASSWORD', newPw);
}

function changeAdminPassword_(body) {
  if (!checkAdmin_(body)) return { ok: false, error: 'unauthorized' };
  const newPw = (body.newPassword || '').toString().trim();
  if (newPw.length < 3) return { ok: false, error: '비밀번호는 3자 이상이어야 합니다' };
  if (newPw.length > 64) return { ok: false, error: '비밀번호는 64자 이하' };
  setAdminPasswordProp_(newPw);
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
  if (!checkAdmin_(body)) return { ok: false, error: 'unauthorized' };
  const castle = (body.castle || '').toString();
  const nickname = (body.nickname || '').toString().trim();
  const guild = (body.guild || '').toString().trim();
  if (['주작성','현무성','청룡성','백호성'].indexOf(castle) < 0) {
    return { ok: false, error: '유효하지 않은 성' };
  }
  const lords = getCastleLords_();
  lords[castle] = nickname
    ? {
        nickname,
        guild,
        updatedAt: Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'),
      }
    : null;
  PropertiesService.getScriptProperties().setProperty('CASTLE_LORDS', JSON.stringify(lords));
  return { ok: true };
}

// ====================================================
// 연합 지침 (공지/안내문)
// ====================================================

function getGuidelines_() {
  return PropertiesService.getScriptProperties().getProperty('GUIDELINES') || '';
}

function setGuidelines_(body) {
  if (!checkAdmin_(body)) return { ok: false, error: 'unauthorized' };
  const text = (body.text || '').toString();
  if (text.length > 20000) return { ok: false, error: '20,000자 초과' };
  PropertiesService.getScriptProperties().setProperty('GUIDELINES', text);
  PropertiesService.getScriptProperties().setProperty('GUIDELINES_UPDATED_AT',
    Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm')
  );
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
    return jsonOut_({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = body.action || 'submit';
    if (action === 'submit') return jsonOut_(submitEntry_(body));
    if (action === 'ocr') return jsonOut_(ocrImage_(body));
    if (action === 'members:list') return jsonOut_({ ok: true, members: listMembers_() });
    if (action === 'members:set') return jsonOut_(setMembers_(body));
    if (action === 'members:add') return jsonOut_(addMember_(body));
    if (action === 'members:remove') return jsonOut_(removeMember_(body));
    if (action === 'stats:weekly') return jsonOut_(getWeeklyStats_(body));
    if (action === 'stats:comparison') return jsonOut_(getComparison_(body));
    if (action === 'stats:monthly') return jsonOut_(getMonthlyGrowth_(body));
    if (action === 'admin:checkPw') return jsonOut_({ ok: checkAdmin_(body) });
    if (action === 'admin:changePw') return jsonOut_(changeAdminPassword_(body));
    if (action === 'castleLord:set') return jsonOut_(setCastleLord_(body));
    if (action === 'guidelines:set') return jsonOut_(setGuidelines_(body));
    return jsonOut_({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
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

function checkAdmin_(body) {
  const pw = (body && body.password) || '';
  return String(pw) === getAdminPassword_();
}

// body.members: Array<{nickname, guild, family, role}> or Array<string>
// body.replaceGuild (선택): 'all' 또는 특정 문파명. 해당 범위만 교체.
function setMembers_(body) {
  if (!checkAdmin_(body)) return { ok: false, error: 'unauthorized' };
  const rawList = Array.isArray(body.members) ? body.members : [];
  const replaceGuild = (body.replaceGuild || 'all').toString();
  const sh = getMemberSheet_();
  const last = sh.getLastRow();
  // 기존 내용 - 'all' 이면 전부, 아니면 해당 문파만 삭제
  if (last >= 2) {
    if (replaceGuild === 'all') {
      sh.getRange(2, 1, last - 1, MEMBER_HEADERS.length).clearContent();
    } else {
      const all = sh.getRange(2, 1, last - 1, MEMBER_HEADERS.length).getValues();
      // 해당 문파에 속한 행 삭제 (뒤에서부터)
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
    const nick = String(obj.nickname || '').trim();
    if (!nick) return;
    const key = nick.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    rows.push([
      nick,
      String(obj.guild || '').trim(),
      String(obj.family || '').trim(),
      String(obj.role || '').trim(),
      now,
    ]);
  });
  if (rows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, MEMBER_HEADERS.length).setValues(rows);
  }
  return { ok: true, count: rows.length };
}

function addMember_(body) {
  if (!checkAdmin_(body)) return { ok: false, error: 'unauthorized' };
  const nickname = (body.nickname || '').toString().trim();
  if (!nickname) return { ok: false, error: '닉네임 누락' };
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
    nickname,
    String(body.guild || '').trim(),
    String(body.family || '').trim(),
    String(body.role || '').trim(),
    now,
  ]);
  return { ok: true };
}

function removeMember_(body) {
  if (!checkAdmin_(body)) return { ok: false, error: 'unauthorized' };
  const nickname = (body.nickname || '').toString().trim().toLowerCase();
  if (!nickname) return { ok: false, error: '닉네임 누락' };
  const sh = getMemberSheet_();
  const last = sh.getLastRow();
  if (last < 2) return { ok: false, error: 'not_found' };
  const vals = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][0] || '').trim().toLowerCase() === nickname) {
      sh.deleteRow(i + 2);
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
  if (!checkAdmin_(body)) return { ok: false, error: 'unauthorized' };
  const range = body.range === 'last' ? lastWeekRange_() : thisWeekRange_();
  const entries = listEntries_();
  const members = listMembers_();
  const inRange = entriesInRange_(entries, range.start, range.end);

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
  if (!checkAdmin_(body)) return { ok: false, error: 'unauthorized' };
  const thisR = thisWeekRange_();
  const lastR = lastWeekRange_();
  const entries = listEntries_();
  const members = listMembers_();

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
  if (!checkAdmin_(body)) return { ok: false, error: 'unauthorized' };
  // 최근 28일 (4주)
  const end = kstNow_();
  const start = new Date(end.getTime());
  start.setUTCDate(start.getUTCDate() - 28);
  const range = { start: kstDateStr_(start), end: kstDateStr_(end) };

  const entries = listEntries_();
  const members = listMembers_();
  const inRange = entriesInRange_(entries, range.start, range.end);

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
 * Google Drive 의 OCR 기능을 사용해 이미지에서 텍스트 추출.
 * Tesseract.js 보다 게임 UI / 폰 사진 인식률이 훨씬 좋음.
 *
 * 사전 준비:
 *   1) 좌측 사이드바 「서비스」 → + → "Drive API" v2 추가
 *   2) 편집기에서 setupOcrPermissions 함수 1회 실행 → Drive 권한 승인
 *   3) 「배포 관리」 → ✏️ → 새 버전 → 배포
 */
function ocrImage_(body) {
  try {
    if (typeof Drive === 'undefined' || !Drive.Files) {
      return { ok: false, error: 'Drive API v2 서비스가 활성화되지 않았습니다. Apps Script 편집기 → 서비스 → Drive API 추가 후 재배포 하세요.' };
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
    return { ok: true, text: text };
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
  const note = (body.note || '').toString().trim();
  const elite = (body.elite || '').toString().trim();
  const guild = (body.guild || '').toString().trim();
  const wantUpdate = !!body.update;

  if (!nickname) return { ok: false, error: '닉네임 누락' };
  if (!score) return { ok: false, error: '점수 누락' };
  if (!castle) return { ok: false, error: '성 누락' };

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
    // 갱신 의도: 기존 신청이 있어야만 갱신 가능
    if (dupRow <= 0) {
      return { ok: false, error: 'not_found', notFound: true };
    }
    sh.getRange(dupRow, 1, 1, HEADERS.length).setValues([[
      castle, nickname, score, dateKst, note, '갱신', elite, guild,
    ]]);
    return { ok: true, updated: true };
  }

  // 신청 의도: 중복이면 에러
  if (dupRow > 0) {
    return { ok: false, error: 'duplicate', duplicate: true };
  }

  sh.appendRow([castle, nickname, score, dateKst, note, '', elite, guild]);
  return { ok: true, updated: false };
}
