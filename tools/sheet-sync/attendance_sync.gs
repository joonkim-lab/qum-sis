/**
 * 출결 원본 시트 → qum-sis (Firestore) 자동 반영  (v2 · 2026-10-27)
 * 열: A Genius ID(자동) · B Date · C Student Name(자동) · D 한글 이름(입력) · E Code · F Note · G Slip No · H Approved · I Final Code(자동) · J Entered By
 * - D열에 한글 이름을 치면 A(Genius ID)·C(영문 이름)가 자동으로 채워집니다. 동명이인은 Students 탭의 한글 이름(박소윤(고)·박소윤(중))대로 씁니다.
 * - 15분마다 '바뀐 학기 탭'만 qum-sis로 보내고, 실제로 달라진 줄만 씁니다(Firestore 무료 한도 보호).
 * - 처음 한 번: 메뉴 qum-sis → '열 순서 바꾸기 (한 번만)'.
 */
const PROJECT = 'qum-sis';
const SCHOOL = 'qum';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const DOC_PREFIX = `projects/${PROJECT}/databases/(default)/documents/schools/${SCHOOL}/attendance/`;
const CODES = ['u.t', 'u.a', 'e.t', 'e.a'];
const LOG_SHEET = '동기화 기록';
const TERM_RE = /^\d{4}[SFU]$/;
const HEAD = ['Genius ID', 'Date', 'Student Name', '한글 이름 (입력)'];
const GRAY = '#efefef';

function onOpen() {
  SpreadsheetApp.getUi().createMenu('qum-sis')
    .addItem('지금 qum-sis로 보내기', 'syncAttendance')
    .addItem('자동 반영 켜기 (15분마다)', 'installTrigger')
    .addSeparator()
    .addItem('열 순서 바꾸기 (한 번만)', 'migrateLayout')
    .addToUi();
}

function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'syncAttendance') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncAttendance').timeBased().everyMinutes(15).create();
  syncAttendance();
  SpreadsheetApp.getActive().toast('자동 반영을 켰습니다. 15분마다 바뀐 것만 qum-sis로 보냅니다.', 'qum-sis', 5);
}

/* ---------- 학생 명단 ---------- */
function students_(ss) {
  const st = ss.getSheetByName('Students');
  const rows = st.getRange(2, 1, Math.max(st.getLastRow() - 1, 1), 4).getValues();
  const byId = {}, list = [];
  rows.forEach(r => {
    const id = String(r[0]).trim();
    if (!id) return;
    const s = { id, en: String(r[1] || '').trim(), ko: String(r[2] || '').trim(), grade: String(r[3] || '').trim() };
    byId[id] = s; list.push(s);
  });
  return { byId, list };
}

/** "박소윤", "박소윤 805", "805", "Xie" → 학생 하나 */
function resolve_(input, S) {
  const raw = String(input || '').trim();
  const num = (raw.match(/\d{3,5}/) || [])[0];
  if (num && S.byId[num]) return { s: S.byId[num] };
  const norm = x => String(x).toLowerCase().replace(/[\s,.()\d]/g, '');
  const t = norm(raw);
  if (!t) return { err: 'Students 탭에 없는 ID입니다' };
  let hits = S.list.filter(s => s.ko && norm(s.ko) === t);
  if (!hits.length) hits = S.list.filter(s => s.ko && norm(s.ko).startsWith(t));          // "박소윤" → 박소윤(고)·박소윤(중)
  if (!hits.length) hits = S.list.filter(s => norm(s.en) === t || (t.length >= 3 && norm(s.en).includes(t)));
  if (hits.length === 1) return { s: hits[0] };
  if (hits.length > 1) return { err: '동명이인: ' + hits.map(s => `"${s.ko || s.en}" (${s.grade}학년)`).join(' / ') + ' 중 하나로 쓰세요' };
  return { err: 'Students 탭에 없는 이름입니다. 철자를 확인하거나 Students 탭에 학생을 추가하세요' };
}

/* ---------- 한글 이름 입력 → ID 자동 ---------- */
function onEdit(e) {
  const sh = e.range.getSheet();
  if (!TERM_RE.test(sh.getName())) return;
  if (String(sh.getRange(1, 1).getValue()).trim() !== 'Genius ID') return;   // 아직 옛 열 순서
  const c0 = e.range.getColumn(), c1 = e.range.getLastColumn();
  if (c0 > 4 || c1 < 4) return;                                             // D열이 포함된 편집만
  const start = Math.max(e.range.getRow(), 2), end = e.range.getLastRow();
  if (end < start) return;
  const S = students_(e.source);
  const dRange = sh.getRange(start, 4, end - start + 1, 1);
  const A = [], D = [], N = [];
  dRange.getValues().forEach(([v]) => {
    if (String(v).trim() === '') { A.push(['']); D.push(['']); N.push(['']); return; }
    const r = resolve_(v, S);
    if (r.s) { A.push([Number(r.s.id) || r.s.id]); D.push([r.s.ko || r.s.en]); N.push(['']); }
    else { A.push(['이름 확인']); D.push([v]); N.push([r.err]); }
  });
  sh.getRange(start, 1, A.length, 1).setValues(A);
  dRange.setValues(D);
  dRange.setNotes(N);
}

/* ---------- 열 순서 바꾸기 (한 번만) ---------- */
function migrateLayout() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActive();
    const S = students_(ss);
    let done = 0;
    ss.getSheets().filter(s => TERM_RE.test(s.getName())).forEach(sh => {
      if (String(sh.getRange(1, 1).getValue()).trim() === 'Genius ID') return;   // 이미 바뀜
      const n = sh.getMaxRows() - 1;
      if (n < 1) return;
      const old = sh.getRange(2, 1, n, 4).getValues();   // 옛 순서: Date, Genius ID, 영문, 한글
      const A = [], B = [], C = [], D = [];
      old.forEach((r, i) => {
        const row = i + 2;
        const sid = String(r[1] || '').trim();
        const ok = sid && sid !== '이름 확인' && sid !== 'ID 확인';
        const s = S.byId[sid];
        A.push([ok ? (Number(sid) || sid) : '']);
        B.push([r[0]]);
        C.push([`=IF(A${row}="","",IFERROR(VLOOKUP(A${row},Students!$A:$B,2,FALSE),"ID 확인"))`]);
        D.push([ok ? (s ? (s.ko || s.en) : r[3]) : '']);
      });
      const block = sh.getRange(2, 1, n, 4);
      block.clearDataValidations();
      block.clearNote();
      sh.getRange(2, 1, n, 1).setValues(A).setNumberFormat('0').setBackground(GRAY);
      sh.getRange(2, 2, n, 1).setValues(B).setNumberFormat('yyyy-mm-dd').setBackground(null);
      sh.getRange(2, 3, n, 1).setFormulas(C).setBackground(GRAY);
      sh.getRange(2, 4, n, 1).setValues(D).setBackground(null);
      sh.getRange(2, 9, n, 1).setBackground(GRAY);
      sh.getRange(1, 1, 1, 4).setValues([HEAD]);
      sh.setColumnWidth(1, 80); sh.setColumnWidth(2, 95); sh.setColumnWidth(3, 180); sh.setColumnWidth(4, 130);
      [1, 3, 9].forEach(c => sh.getRange(2, c, n, 1).protect().setDescription('자동 칸 — 손대지 않기').setWarningOnly(true));
      done++;
    });
    const g = ss.getSheetByName('안내');
    if (g) {
      g.getRange('A5').setValue('입력 순서: Date → 한글 이름(D열)에 이름을 치면 Genius ID·영문 이름이 자동으로 채워짐 → Code(u.t 무단 지각 / u.a 무단 결석 / e.t 인정 지각 / e.a 인정 결석). 동명이인은 박소윤(고)·박소윤(중)처럼 씀');
      g.getRange('A9').setValue('회색 칸(Genius ID · Student Name · Final Code)은 자동이니 손대지 않습니다. 이름이 틀리면 한글 이름 칸만 다시 쓰면 됩니다. 줄을 지우면 qum-sis에서도 지워집니다. 최신 학기 탭이 맨 앞에 있습니다.');
    }
    ss.toast(`${done}개 학기 탭의 열 순서를 바꿨습니다.`, 'qum-sis', 5);
  } finally {
    lock.releaseLock();
  }
}

/* ---------- Firestore ---------- */
function fmtDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd');
  const s = String(v || '').trim();
  const m = s.match(/^(\d{4})[-.\/\s]+(\d{1,2})[-.\/\s]+(\d{1,2})/);
  if (m) return `${m[1]}-${('0' + m[2]).slice(-2)}-${('0' + m[3]).slice(-2)}`;
  return '';
}
const termOf_ = d => { const [y, m] = d.split('-').map(Number); return m >= 8 ? `${y}F` : `${y}S`; };
const truthy_ = v => v === true || /^(true|y|yes|1|o|v|✓|승인)$/i.test(String(v).trim());
const md5_ = x => Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(x)));

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
  const props = PropertiesService.getScriptProperties();
  const problems = [];
  let written = 0, deleted = 0, pulled = 0;
  try {
    const S = students_(ss);
    const tabs = ss.getSheets().filter(s => TERM_RE.test(s.getName()));
    const want = {}, firstEmpty = {}, fp = {}, dirty = new Set(), layout = {};
    tabs.forEach(sh => {
      const term = sh.getName();
      const idFirst = String(sh.getRange(1, 1).getValue()).trim() === 'Genius ID';
      layout[term] = idFirst;
      const last = sh.getLastRow();
      const vals = last > 1 ? sh.getRange(2, 1, last - 1, 8).getValues() : [];
      fp[term] = md5_(vals.map(r => [r[0], r[1], r[4], r[5], r[6], r[7]]));
      const isDirty = props.getProperty('fp_' + term) !== fp[term];
      if (isDirty) dirty.add(term);
      vals.forEach((r, i) => {
        const rowNo = i + 2;
        const idRaw = idFirst ? r[0] : r[1], dRaw = idFirst ? r[1] : r[0];
        const [, , , , codeRaw, note, slip, appr] = r;
        const code = String(codeRaw || '').trim().toLowerCase();
        const id = String(idRaw || '').trim();
        if (!dRaw && !id && !code) { if (!firstEmpty[term]) firstEmpty[term] = rowNo; return; }   // 빈 줄
        const date = fmtDate_(dRaw);
        if (!date) { problems.push([term, rowNo, '날짜 형식 확인 (2026-10-27처럼)']); return; }
        if (!S.byId[id]) { problems.push([term, rowNo, `학생 확인: Genius ID '${id || '(비어 있음)'}' — 한글 이름 칸을 다시 입력하세요`]); return; }
        if (!CODES.includes(code)) { problems.push([term, rowNo, `Code '${codeRaw}' 확인 (u.t/u.a/e.t/e.a)`]); return; }
        if (termOf_(date) !== term) problems.push([term, rowNo, `날짜 ${date}는 ${termOf_(date)} 학기 — 그 학기로 들어감`]);
        if (want[`${id}_${date}`]) problems.push([term, rowNo, '같은 학생·같은 날짜가 두 줄 — 아래 줄이 반영됨']);
        if (isDirty) dirty.add(termOf_(date));
        want[`${id}_${date}`] = { studentId: id, date, termCode: termOf_(date), code, note: String(note || ''), slipNo: String(slip || '').trim(), approved: truthy_(appr) };
      });
    });

    const now = new Date().toISOString();
    const writes = [];
    [...dirty].forEach(term => {
      const remote = remoteTerm_(term);
      Object.entries(want).forEach(([docId, d]) => {
        if (d.termCode !== term) return;
        const r = remote[docId];
        if (r && r.source === 'sheet' && r.studentId === d.studentId && r.date === d.date && r.code === d.code &&
            r.note === d.note && r.slipNo === d.slipNo && r.approved === d.approved) return;   // 그대로면 안 씀
        const fields = {
          studentId: { stringValue: d.studentId }, date: { stringValue: d.date }, termCode: { stringValue: d.termCode },
          code: { stringValue: d.code }, note: { stringValue: d.note }, slipNo: { stringValue: d.slipNo },
          approved: { booleanValue: d.approved }, source: { stringValue: 'sheet' }, syncedAt: { timestampValue: now },
        };
        writes.push({ update: { name: DOC_PREFIX + docId, fields }, updateMask: { fieldPaths: Object.keys(fields) } });
      });
      Object.entries(remote).forEach(([docId, d]) => {
        if (want[docId]) return;
        const sh = ss.getSheetByName(term);
        if (d.source === 'app' && sh) {
          // 예전에 qum-sis 앱에서 직접 넣은 출결 → 시트로 한 번 옮겨 오고, 이후엔 시트가 관리
          const row = firstEmpty[term] || sh.getLastRow() + 1;
          firstEmpty[term] = row + 1;
          const s = S.byId[d.studentId];
          const idv = Number(d.studentId) || d.studentId;
          if (layout[term]) { sh.getRange(row, 1, 1, 2).setValues([[idv, d.date]]); sh.getRange(row, 4).setValue(s ? (s.ko || s.en) : ''); }
          else sh.getRange(row, 1, 1, 2).setValues([[d.date, idv]]);
          sh.getRange(row, 5, 1, 4).setValues([[d.code, d.note, d.slipNo, d.approved]]);
          sh.getRange(row, 10).setValue('app');
          pulled++;
        } else if (d.source !== 'app') {
          writes.push({ delete: DOC_PREFIX + docId });
        }
      });
    });
    for (let i = 0; i < writes.length; i += 400) {
      const chunk = writes.slice(i, i + 400);
      api_('post', ':commit', { writes: chunk });
      chunk.forEach(w => w.delete ? deleted++ : written++);
    }
    const save = {};
    Object.entries(fp).forEach(([t, h]) => save['fp_' + t] = h);
    props.setProperties(save);
    const which = dirty.size ? [...dirty].sort().join(', ') : '없음';
    log_(ss, `OK · 바뀐 학기: ${which} · ${written}줄 반영 · ${deleted}줄 삭제 · 앱 입력 ${pulled}줄 시트로 옮김 · 확인 필요 ${problems.length}`, problems);
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
