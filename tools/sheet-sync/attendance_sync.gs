/**
 * 출결 원본 시트 → qum-sis (Firestore) 자동 반영
 * - 학기 탭(2026F, 2027S …)을 읽어 schools/qum/attendance 에 씁니다.
 * - 시트가 원본입니다. 시트에서 지운 줄은 qum-sis에서도 지웁니다(앱에서 직접 넣은 줄은 건드리지 않음).
 * - 15분마다 자동 실행. 결과는 '동기화 기록' 탭에 남습니다.
 * - 처음 한 번: 메뉴 qum-sis → '자동 반영 켜기'.
 */
const PROJECT = 'qum-sis';
const SCHOOL = 'qum';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const DOC_PREFIX = `projects/${PROJECT}/databases/(default)/documents/schools/${SCHOOL}/attendance/`;
const CODES = ['u.t', 'u.a', 'e.t', 'e.a'];
const LOG_SHEET = '동기화 기록';

function onOpen() {
  SpreadsheetApp.getUi().createMenu('qum-sis')
    .addItem('지금 qum-sis로 보내기', 'syncAttendance')
    .addItem('자동 반영 켜기 (15분마다)', 'installTrigger')
    .addToUi();
}

function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'syncAttendance') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncAttendance').timeBased().everyMinutes(15).create();
  syncAttendance();
  SpreadsheetApp.getActive().toast('자동 반영을 켰습니다. 15분마다 qum-sis로 보냅니다.', 'qum-sis', 5);
}

function fmtDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd');
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})[-.\/\s]+(\d{1,2})[-.\/\s]+(\d{1,2})/);
  if (m) return `${m[1]}-${('0' + m[2]).slice(-2)}-${('0' + m[3]).slice(-2)}`;
  return '';
}
const termOf_ = d => { const [y, m] = d.split('-').map(Number); return m >= 8 ? `${y}F` : `${y}S`; };
const truthy_ = v => v === true || /^(true|y|yes|1|o|v|✓|승인)$/i.test(String(v).trim());

function api_(method, path, body) {
  const res = UrlFetchApp.fetch(BASE + path, {
    method, contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'x-goog-user-project': PROJECT },
    payload: body ? JSON.stringify(body) : undefined,
  });
  const code = res.getResponseCode(), text = res.getContentText();
  if (code >= 300) throw new Error(`Firestore ${code}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

/** 한 학기의 qum-sis 출결 문서 {docId: {...}} */
function remoteTerm_(term) {
  const out = {};
  const rows = api_('post', `/schools/${SCHOOL}:runQuery`, { structuredQuery: {
    from: [{ collectionId: 'attendance' }],
    where: { fieldFilter: { field: { fieldPath: 'termCode' }, op: 'EQUAL', value: { stringValue: term } } },
  } });
  rows.forEach(r => {
    if (!r.document) return;
    const f = r.document.fields || {}, g = k => (f[k] || {}).stringValue || '';
    out[r.document.name.split('/').pop()] = { source: g('source'), studentId: g('studentId'), date: g('date'), code: g('code'), note: g('note'), slipNo: g('slipNo'), approved: !!(f.approved || {}).booleanValue };
  });
  return out;
}

function syncAttendance() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  const ss = SpreadsheetApp.getActive();
  const problems = [];
  let written = 0, deleted = 0, pulled = 0;
  try {
    const students = {};
    const st = ss.getSheetByName('Students');
    st.getRange(2, 1, Math.max(st.getLastRow() - 1, 1), 1).getValues().forEach(r => { if (r[0] !== '') students[String(r[0]).trim()] = true; });

    const tabs = ss.getSheets().filter(s => /^\d{4}[SF]$/.test(s.getName()));
    const want = {}, firstEmpty = {};
    tabs.forEach(sh => {
      const term = sh.getName();
      const last = sh.getLastRow();
      const vals = last > 1 ? sh.getRange(2, 1, last - 1, 10).getValues() : [];
      vals.forEach((r, i) => {
        const rowNo = i + 2;
        const [dRaw, idRaw, , , codeRaw, note, slip, appr] = r;
        const code = String(codeRaw || '').trim().toLowerCase();
        const id = String(idRaw || '').trim();
        if (!dRaw && !id && !code) { if (!firstEmpty[term]) firstEmpty[term] = rowNo; return; }   // 빈 줄
        const date = fmtDate_(dRaw);
        if (!date) { problems.push([term, rowNo, '날짜 형식 확인 (2026-10-27처럼)']); return; }
        if (!students[id]) { problems.push([term, rowNo, `Genius ID ${id || '(비어 있음)'} 가 Students 탭에 없음`]); return; }
        if (!CODES.includes(code)) { problems.push([term, rowNo, `Code '${codeRaw}' 확인 (u.t/u.a/e.t/e.a)`]); return; }
        if (termOf_(date) !== term) problems.push([term, rowNo, `날짜 ${date}는 ${termOf_(date)} 학기 — 그 학기로 들어감`]);
        if (want[`${id}_${date}`]) problems.push([term, rowNo, `같은 학생·같은 날짜가 두 줄 — 아래 줄이 반영됨`]);
        want[`${id}_${date}`] = { studentId: id, date, termCode: termOf_(date), code, note: String(note || ''), slipNo: String(slip || '').trim(), approved: truthy_(appr) };
      });
    });

    const now = new Date().toISOString();
    const writes = [];
    Object.entries(want).forEach(([docId, d]) => {
      const fields = {
        studentId: { stringValue: d.studentId }, date: { stringValue: d.date }, termCode: { stringValue: d.termCode },
        code: { stringValue: d.code }, note: { stringValue: d.note }, slipNo: { stringValue: d.slipNo },
        approved: { booleanValue: d.approved }, source: { stringValue: 'sheet' }, syncedAt: { timestampValue: now },
      };
      writes.push({ update: { name: DOC_PREFIX + docId, fields }, updateMask: { fieldPaths: Object.keys(fields) } });
    });
    tabs.forEach(sh => {
      const term = sh.getName();
      const remote = remoteTerm_(term);
      Object.entries(remote).forEach(([docId, d]) => {
        if (want[docId]) return;
        if (d.source === 'app') {
          // 예전에 qum-sis 앱 화면에서 직접 넣은 출결 → 시트로 한 번 옮겨 와서 이후엔 시트가 관리
          let row = firstEmpty[term] || sh.getLastRow() + 1;
          firstEmpty[term] = row + 1;
          sh.getRange(row, 1, 1, 2).setValues([[d.date, Number(d.studentId) || d.studentId]]);
          sh.getRange(row, 5, 1, 4).setValues([[d.code, d.note, d.slipNo, d.approved]]);
          sh.getRange(row, 10).setValue('app');
          pulled++;
        } else {
          writes.push({ delete: DOC_PREFIX + docId });
        }
      });
    });
    for (let i = 0; i < writes.length; i += 400) {
      const chunk = writes.slice(i, i + 400);
      api_('post', ':commit', { writes: chunk });
      chunk.forEach(w => w.delete ? deleted++ : written++);
    }
    log_(ss, `OK · ${tabs.length}개 학기 · ${written}줄 반영 · ${deleted}줄 삭제 · 앱 입력 ${pulled}줄 시트로 옮김 · 확인 필요 ${problems.length}`, problems);
  } catch (e) {
    log_(ss, '실패: ' + e.message, problems);
    throw e;
  } finally {
    lock.releaseLock();
  }
}

function log_(ss, summary, problems) {
  let sh = ss.getSheetByName(LOG_SHEET);
  if (!sh) sh = ss.insertSheet(LOG_SHEET);
  sh.clear();
  sh.getRange(1, 1, 2, 2).setValues([['마지막 반영', Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm')], ['결과', summary]]);
  sh.getRange(4, 1, 1, 3).setValues([['학기 탭', '줄', '확인할 것']]).setFontWeight('bold');
  if (problems.length) sh.getRange(5, 1, problems.length, 3).setValues(problems);
  else sh.getRange(5, 1).setValue('없음');
  sh.setColumnWidth(3, 420);
}
