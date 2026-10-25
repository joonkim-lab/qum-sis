const PROJECT = 'qum-sis';
const SCHOOL = 'qum';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const DOC = `projects/${PROJECT}/databases/(default)/documents/schools/${SCHOOL}/`;
const LOG_SHEET = '동기화 기록';
const LIVE_FROM = '2026F';
const ALIAS_SHEET = 'ID 짝';
const SEED_ALIASES = [
  ['jihye.choi', 743, 'Choi, Ji Hye = Choi, Julia'], ['shawn.lee2', 706, 'Lee, Shawn (Kyung Hyun)'], ['shawn.lee', 706, 'Lee, Shawn'],
  ['reuben.lee', 784, 'Lee, Reuben'], ['jinseo.park', 854, 'Park, Jinseo = Park, Vivian'], ['hwang.seo', 710, 'Seo, Andrew Hwang'],
  ['sophie.shim', 913, 'Shim, Sophie Ga Eun'], ['joowon.oh', 860, 'Oh, Joowon = Oh, Juwon (재학)'], ['Oh, Joowon', 860, '계정 없는 줄'],
  ['jordanh.chun', 828, 'Chun, Jordan (졸업)'], ['Han, Daniel Heesoo', 850, 'Han, Daniel (졸업)'], ['hannahyujin.lee', 858, 'Lee, Hannah Yujin (졸업)'],
  ['yujin.lee', 858, 'Lee, Hannah Yujin (졸업)'], ['sungmin.so', 753, 'So, Seongmin (졸업)'], ['jihoon.cho', 809, 'Cho, Matthew (자퇴)'],
];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('qum-sis')
    .addItem('1. 미리보기 (qum-sis에 쓰지 않음)', 'previewElectives')
    .addItem('2. qum-sis로 보내기', 'syncElectives')
    .addSeparator()
    .addItem('자동 반영 켜기 (1시간마다)', 'installTrigger')
    .addToUi();
}
function previewElectives() { run_(true); }
function syncElectives() { run_(false); }
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'syncElectives') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncElectives').timeBased().everyHours(1).create();
  run_(false);
}

const slug_ = t => String(t || '').toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const normTitle_ = t => String(t || '').replace(/\.\.\.\s*$/, '').replace(/\s*\((Spring|Fall)[^)]*\)/gi, '').replace(/\s+Sem\s*[12].*$/i, '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
const sameTitle_ = (a, b) => a === b || (Math.min(a.length, b.length) >= 10 && (a.startsWith(b) || b.startsWith(a)));
const normName_ = n => String(n || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z]/g, '');
const termKey_ = t => { const m = /^(\d{4})([FSU])$/.exec(t || ''); return m ? +m[1] + ({ F: 0.5, S: 0, U: 0.25 })[m[2]] : 0; };
const isLive_ = t => termKey_(t) >= termKey_(LIVE_FROM);
const letterOf_ = s => s >= 90 ? 'A' : s >= 80 ? 'B' : s >= 70 ? 'C' : s >= 60 ? 'D' : 'F';

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
const sv_ = f => (f || {}).stringValue !== undefined ? f.stringValue : ((f || {}).integerValue !== undefined ? String(f.integerValue) : '');
function query_(collection, where) {
  const q = { from: [{ collectionId: collection }] };
  if (where) q.where = { fieldFilter: { field: { fieldPath: where[0] }, op: 'EQUAL', value: { stringValue: where[1] } } };
  return api_('post', `/schools/${SCHOOL}:runQuery`, { structuredQuery: q }).filter(r => r.document)
    .map(r => ({ id: r.document.name.split('/').pop(), f: r.document.fields || {} }));
}

function run_(dry) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  const ss = SpreadsheetApp.getActive();
  const issues = [];
  const stat = { rows: 0, missingPast: 0, changed: 0, update: 0, same: 0, create: 0, remove: 0, noStudent: 0, onlyInSis: 0 };
  try {
    // 학생: qum-sis 명부에서 Username·이름 → Genius ID
    const byUser = {}, byName = {}, ids = {};
    query_('students').forEach(s => {
      ids[s.id] = true;
      const u = (sv_(s.f.genius_login) || sv_(s.f.email).split('@')[0]).toLowerCase();
      if (u) byUser[u] = s.id;
      const n = normName_(sv_(s.f.last_en) + sv_(s.f.first_en));
      if (n) byName[n] = byName[n] && byName[n] !== s.id ? 'DUP' : s.id;
    });

    // 과목: Courses 탭의 Genius Code / 확정 과목명
    // 'ID 짝' 탭: Username(또는 '성, 이름') → Genius ID. 없으면 만들어 둠
    let at = ss.getSheetByName(ALIAS_SHEET);
    if (!at) {
      at = ss.insertSheet(ALIAS_SHEET);
      at.getRange(1, 1, 1, 3).setValues([['Username 또는 시트의 학생 이름', 'Genius ID', '메모']]).setFontWeight('bold');
      at.getRange(2, 1, SEED_ALIASES.length, 3).setValues(SEED_ALIASES);
      at.setColumnWidth(1, 260); at.setColumnWidth(3, 300);
    }
    if (at.getLastRow() > 1) at.getRange(2, 1, at.getLastRow() - 1, 2).getValues().forEach(([k, v]) => {
      const key = String(k || '').trim(), id = String(v || '').trim();
      if (!key || !id) return;
      if (key.includes(',')) byName[normName_(key)] = id;
      else byUser[key.toLowerCase().split('@')[0]] = id;
    });

    const courses = {};
    const cs = ss.getSheetByName('Courses');
    cs.getRange(2, 1, Math.max(cs.getLastRow() - 1, 1), 7).getValues().forEach(r => {
      if (r[0]) courses[String(r[0]).trim()] = { code: String(r[1] || '').trim(), official: String(r[6] || '').trim() };
    });

    const sh = ss.getSheetByName('Grades');
    const last = sh.getLastRow();
    const vals = last > 1 ? sh.getRange(2, 1, last - 1, 13).getValues() : [];
    const idFill = [];
    const rows = [];
    vals.forEach((r, i) => {
      const rowNo = i + 2;
      const [term, gidRaw, user, name, course, , , , score, letterRaw] = r;
      if (!term && !name && !course) return;
      stat.rows++;
      let sid = String(gidRaw || '').trim();
      if (!sid) {
        const u = String(user || '').trim().toLowerCase();
        sid = byUser[u] || '';
        if (!sid) { const n = byName[normName_(name)]; if (n && n !== 'DUP') sid = n; }
        if (sid) idFill.push([rowNo, sid]);
      }
      if (!sid || !ids[sid]) { stat.noStudent++; issues.push([String(term), rowNo, `학생을 찾지 못함: ${name} ${user ? '(' + user + ')' : ''} — Genius ID 칸을 채워 주세요`]); return; }
      if (!/^\d{4}[FSU]$/.test(String(term))) { issues.push([String(term), rowNo, 'Semester 형식 확인 (2026F처럼)']); return; }
      const c = courses[String(course).trim()] || {};
      const title = c.official || String(course).trim();
      const sc = typeof score === 'number' ? score : (String(score).trim() !== '' && !isNaN(Number(score)) ? Number(score) : null);
      const grade = String(letterRaw || '').trim().toUpperCase() || (sc !== null ? letterOf_(sc) : '');
      if (!grade) { issues.push([String(term), rowNo, '성적(Score 또는 Letter)이 비어 있음']); return; }
      rows.push({ rowNo, sid, term: String(term), title, rawTitle: String(course).trim(), code: c.code, grade, score: sc });
    });

    // qum-sis에 이미 있는 선택과목 성적 (학기별)
    const terms = [...new Set(rows.map(r => r.term))];
    const remote = {};
    terms.forEach(t => query_('grades', ['termCode', t]).forEach(d => {
      if (sv_(d.f.source) !== 'elective') return;
      remote[d.id] = { id: d.id, sid: sv_(d.f.studentId), term: t, title: sv_(d.f.title), courseId: sv_(d.f.courseId), grade: sv_(d.f.grade), fromSheet: sv_(d.f.syncedFrom) === 'sheet', used: false };
    }));
    const remoteList = Object.values(remote);

    const now = new Date().toISOString();
    const writes = [];
    rows.forEach(r => {
      const cid = r.code || ('t_' + slug_(r.title.replace(/\s+Sem\s*[12].*$/i, '')));
      const docId = `${r.sid}_${r.term}_${cid}`.replace(/[\/\s]/g, '_');
      const nt = normTitle_(r.title), nr = normTitle_(r.rawTitle);
      let hit = remote[docId] && !remote[docId].used ? remote[docId] : null;
      if (!hit) hit = remoteList.find(d => !d.used && d.sid === r.sid && d.term === r.term && (d.courseId === cid || sameTitle_(normTitle_(d.title), nt) || sameTitle_(normTitle_(d.title), nr)));
      if (hit) {
        hit.used = true;
        if (hit.grade === r.grade && hit.fromSheet) { stat.same++; return; }
        stat.update++;
        if (hit.grade !== r.grade) { stat.changed++; issues.push([r.term, r.rowNo, `성적 바뀜: ${hit.title} (${r.sid}) ${hit.grade} → ${r.grade}`]); }
        const fields = { grade: { stringValue: r.grade }, syncedFrom: { stringValue: 'sheet' }, syncedAt: { timestampValue: now } };
        if (r.score !== null) fields.score = { doubleValue: r.score };
        writes.push({ update: { name: DOC + 'grades/' + hit.id, fields }, updateMask: { fieldPaths: Object.keys(fields) } });
      } else if (!isLive_(r.term)) {
        stat.missingPast++;
        issues.push([r.term, r.rowNo, `qum-sis에 없음 (지난 학기라 자동으로 넣지 않음): ${r.title} (${r.sid}) ${r.grade}`]);
      } else {
        stat.create++;
        issues.push([r.term, r.rowNo, `새로 추가됨: ${r.title} (${r.sid})`]);
        const fields = {
          studentId: { stringValue: r.sid }, courseId: { stringValue: cid }, code: { stringValue: r.code || '' }, title: { stringValue: r.title },
          school: { stringValue: 'Elite Open School' }, termCode: { stringValue: r.term }, grade: { stringValue: r.grade },
          credit: { doubleValue: 0.25 }, weighted: { booleanValue: false }, source: { stringValue: 'elective' },
          needsReview: { booleanValue: true }, syncedFrom: { stringValue: 'sheet' }, syncedAt: { timestampValue: now },
        };
        if (r.score !== null) fields.score = { doubleValue: r.score };
        writes.push({ update: { name: DOC + 'grades/' + docId, fields } });
        remote[docId] = { id: docId, used: true };
      }
    });
    remoteList.filter(d => !d.used).forEach(d => {
      if (d.fromSheet) { stat.remove++; writes.push({ delete: DOC + 'grades/' + d.id }); issues.push([d.term, '', `시트에서 지워져 qum-sis에서도 삭제: ${d.title} (${d.sid})`]); }
      else { stat.onlyInSis++; issues.push([d.term, '', `qum-sis에만 있음(그대로 둠): ${d.title} (${d.sid}) ${d.grade}`]); }
    });

    if (!dry) {
      for (let i = 0; i < writes.length; i += 400) api_('post', ':commit', { writes: writes.slice(i, i + 400) });
      idFill.forEach(([rowNo, sid]) => sh.getRange(rowNo, 2).setValue(Number(sid) || sid));
    }
    const head = dry ? '미리보기 (아직 안 보냄)' : 'OK (보냄)';
    log_(ss, `${head} · 시트 ${stat.rows}줄 · 연결됨 ${stat.same + stat.update} (그중 성적 바뀜 ${stat.changed}) · 새로 추가 ${stat.create} · 지난 학기 qum-sis에 없음 ${stat.missingPast} · 삭제 ${stat.remove} · 학생 못 찾음 ${stat.noStudent} · qum-sis에만 있음 ${stat.onlyInSis} · ID 자동 채움 ${idFill.length}`, issues);
  } catch (e) {
    log_(ss, '실패: ' + e.message, issues);
    throw e;
  } finally {
    lock.releaseLock();
  }
}

function log_(ss, summary, issues) {
  let sh = ss.getSheetByName(LOG_SHEET);
  if (!sh) sh = ss.insertSheet(LOG_SHEET);
  sh.clear();
  sh.getRange(1, 1, 2, 2).setValues([['마지막 실행', Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm')], ['결과', summary]]);
  sh.getRange(4, 1, 1, 3).setValues([['학기', 'Grades 줄', '내용']]).setFontWeight('bold');
  if (issues.length) sh.getRange(5, 1, issues.length, 3).setValues(issues.map(x => [x[0], x[1], x[2]]));
  else sh.getRange(5, 1).setValue('없음');
  sh.setColumnWidth(3, 520);
}
