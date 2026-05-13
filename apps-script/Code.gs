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
const HEADERS = ['성', '닉네임', '점수', '시간(KST)', '비고', '갱신여부', '정예참전'];

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
    if (action === 'list') {
      return jsonOut_({ ok: true, entries: listEntries_() });
    }
    return jsonOut_({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = body.action || 'submit';
    if (action === 'submit') {
      return jsonOut_(submitEntry_(body));
    }
    if (action === 'ocr') {
      return jsonOut_(ocrImage_(body));
    }
    return jsonOut_({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
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
    }));
}

function submitEntry_(body) {
  const nickname = (body.nickname || '').toString().trim();
  const score = (body.score || '').toString().trim();
  const castle = (body.castle || '').toString().trim();
  const dateKst = (body.dateKst || '').toString().trim();
  const note = (body.note || '').toString().trim();
  const elite = (body.elite || '').toString().trim();
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
      castle, nickname, score, dateKst, note, '갱신', elite,
    ]]);
    return { ok: true, updated: true };
  }

  // 신청 의도: 중복이면 에러
  if (dupRow > 0) {
    return { ok: false, error: 'duplicate', duplicate: true };
  }

  sh.appendRow([castle, nickname, score, dateKst, note, '', elite]);
  return { ok: true, updated: false };
}
