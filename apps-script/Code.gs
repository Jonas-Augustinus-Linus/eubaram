/**
 * 주스터콜 공성신청 - Google Apps Script Backend
 *
 * 배포 방법:
 *  1. https://script.google.com 접속 → 새 프로젝트
 *  2. 이 파일 내용 전체를 Code.gs 에 붙여넣기
 *  3. 상단의 SPREADSHEET_ID 를 본인 구글 시트 ID 로 교체
 *     (시트 URL 의 /d/{여기}/edit 부분)
 *  4. 메뉴 → 배포 → 새 배포 → 유형: 웹 앱
 *     - 다음 사용자로 실행: 나
 *     - 액세스 권한: "모든 사용자"
 *     - 배포 → 권한 승인
 *  5. 발급된 웹앱 URL (...exec) 을 웹페이지 "엔드포인트 설정" 에 붙여넣기
 */

const SPREADSHEET_ID = 'PUT_YOUR_SHEET_ID_HERE';
const SHEET_NAME = '점수신청';
const HEADERS = ['성', '닉네임', '점수', '시간(KST)', '비고', '갱신여부'];

function getSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
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
    return jsonOut_({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
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
      dateKst: String(r[3] || ''),
      note: String(r[4] || ''),
      updated: String(r[5] || '') === '갱신',
    }));
}

function submitEntry_(body) {
  const nickname = (body.nickname || '').toString().trim();
  const score = (body.score || '').toString().trim();
  const castle = (body.castle || '').toString().trim();
  const dateKst = (body.dateKst || '').toString().trim();
  const note = (body.note || '').toString().trim();
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

  if (dupRow > 0) {
    if (!wantUpdate) {
      return { ok: false, error: 'duplicate', duplicate: true };
    }
    sh.getRange(dupRow, 1, 1, HEADERS.length).setValues([[
      castle, nickname, score, dateKst, note, '갱신',
    ]]);
    return { ok: true, updated: true };
  }

  sh.appendRow([castle, nickname, score, dateKst, note, '']);
  return { ok: true, updated: false };
}
