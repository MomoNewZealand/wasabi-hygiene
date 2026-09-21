/**
 * ===========================================================
 * TOKYO WASABI 衛生記録 ― Apps Script（データを受け取る側）
 *
 * このコードは Google スプレッドシートの
 *   拡張機能 → Apps Script
 * に貼りつけて使います。手順は README.md を見てください。
 *
 * やること
 *   1. アプリから送られてきた記録を、シートに1行ずつ足す
 *   2. アプリや管理画面から聞かれたら、記録を返す
 *   3. 責任者が「この月を確認した」という記録を残す
 *   4. 月に1回、バックアップの CSV を Google ドライブに書き出す
 *
 * 記録は足すだけで、消したり書き換えたりはしません。
 * 間違いの訂正は「訂正」として新しい行を足します。
 * 保健所に出す書類なので、あとから書き換えられない形にしてあります。
 * ===========================================================
 */

/* 合言葉。'' のままなら、URL を知っている人は誰でも記録・閲覧できる。
   制限したくなったら、ここと common.js の ACCESS_KEY に同じ文字を入れる */
var ACCESS_KEY = '';

var SHEET_LOG = '記録';
var SHEET_REVIEW = '責任者確認';
var SHEET_SETTING = '設定';
var BACKUP_FOLDER = '衛生記録バックアップ';
var TZ = 'Asia/Tokyo';

/* シートの列。common.js の ITEMS と同じ順番・同じ id にしておくこと。
   項目を増やしたときは、ここにも足して setup() をもう一度実行する */
var COLUMNS = [
  { key: 'id', head: '記録ID' },
  { key: 'submittedAt', head: '送信日時' },
  { key: 'date', head: '対象日' },
  { key: 'site', head: '拠点コード' },
  { key: 'siteName', head: '拠点' },
  { key: 'timing', head: 'タイミングコード' },
  { key: 'timingLabel', head: 'タイミング' },
  { key: 'staff', head: '記録者（日々チェック）' },
  { key: 'kind', head: '種別' },
  { key: 'targetId', head: '訂正元ID' },
  { key: 'clientId', head: '端末の送信ID' },

  /* ここから記録の中身（common.js の ITEMS と対応） */
  { key: 'uke', head: '① 原材料の受入', item: true },
  { key: 'reizo', head: '② 冷蔵庫（℃）', item: true },
  { key: 'reito', head: '② 冷凍庫（℃）', item: true },
  { key: 'kenko', head: '④-1 健康管理', item: true },
  { key: 'tearai', head: '④-2 手洗い', item: true },
  { key: 'kosa', head: '③-1 交差汚染の防止', item: true },
  { key: 'kigu', head: '③-2 器具の洗浄・消毒', item: true },
  { key: 'toilet', head: '③-3 トイレの洗浄・消毒', item: true },
  { key: 'haiki', head: '廃棄物の取扱い', item: true },
  { key: 'kj1', head: '第1 非加熱', item: true },
  { key: 'kj2', head: '第2 加熱', item: true },
  { key: 'kj2h', head: '第2 高温保管', item: true },
  { key: 'kj3', head: '第3 加熱後、冷却', item: true },
  { key: 'seizo', head: '製造物', item: true },

  { key: 'ngNote', head: '否への対応' },
  { key: 'note', head: '特記事項' },
];

/* 責任者確認シートの列 */
var REVIEW_COLUMNS = [
  { key: 'id', head: '確認ID' },
  { key: 'reviewedAt', head: '確認日時' },
  { key: 'site', head: '拠点コード' },
  { key: 'siteName', head: '拠点' },
  { key: 'ym', head: '対象年月' },
  { key: 'reviewer', head: '責任者' },
  { key: 'memo', head: 'メモ' },
  { key: 'clientId', head: '端末の送信ID' },
];

/* ===========================================================
   はじめの準備
   =========================================================== */

/**
 * いちばん最初に1回だけ、手で実行する。
 * 必要なシートを作り、見出しを入れ、「記録」シートを保護する。
 * 項目を増やしたあとにもう一度実行しても、記録は消えない（見出しだけ直す）。
 */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(TZ);

  var log = ss.getSheetByName(SHEET_LOG) || ss.insertSheet(SHEET_LOG);
  writeHead(log, COLUMNS);

  var rev = ss.getSheetByName(SHEET_REVIEW) || ss.insertSheet(SHEET_REVIEW);
  writeHead(rev, REVIEW_COLUMNS);

  var st = ss.getSheetByName(SHEET_SETTING);
  if (!st) {
    st = ss.insertSheet(SHEET_SETTING);
    st.getRange(1, 1, 1, 3).setValues([['記録者', '拠点（空欄なら全部）', '責任者']]);
    st.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#e8efe9');
    // A列＝日々の記録をつける人、C列＝月に1回まとめて確認する責任者
    st.getRange(2, 1, 3, 1).setValues([['もも'], ['ひとし'], ['たっちゃん']]);
    st.getRange(2, 3, 2, 1).setValues([['ひとし'], ['もも']]);
    st.setFrozenRows(1);
  }

  removeEmptyDefaultSheet(ss);

  /* 記録を手で書き換えられないように保護する。
     アプリ（このスクリプト）はシートの持ち主として動くので、今までどおり書けます。
     ほかの人と共有していても、その人たちは記録を直せなくなります */
  protectSheet(log, '衛生記録。手で書き換えないでください（アプリから追加するだけ）');
  protectSheet(rev, '責任者確認の記録。手で書き換えないでください');

  SpreadsheetApp.getUi().alert(
    '準備ができました。\n\n' +
      '・「設定」シートの A 列に記録する人、C 列に責任者の名前を入れてください。\n' +
      '・「記録」「責任者確認」シートは、手で書き換えられないように保護しました。\n' +
      '・バックアップを自動にするには、あわせて setupBackupTrigger も実行してください。'
  );
}

/**
 * 新しいスプレッドシートに最初からある「シート1」を片づける。
 * 空のまま残っていると、どれが本物の記録か分かりにくいため。
 * 中身が1行でも入っていたら、何かに使っているかもしれないので消さない。
 */
function removeEmptyDefaultSheet(ss) {
  var sheets = ss.getSheets();
  if (sheets.length < 2) return;

  for (var i = 0; i < sheets.length; i++) {
    var sh = sheets[i];
    var name = sh.getName();
    if (name !== 'シート1' && name !== 'Sheet1') continue;
    if (sh.getLastRow() > 0 || sh.getLastColumn() > 0) continue;
    ss.deleteSheet(sh);
    return;
  }
}

function writeHead(sheet, cols) {
  var heads = cols.map(function (c) {
    return c.head;
  });
  sheet.getRange(1, 1, 1, heads.length).setValues([heads]);
  sheet.getRange(1, 1, 1, heads.length).setFontWeight('bold').setBackground('#e8efe9');
  sheet.setFrozenRows(1);
}

function protectSheet(sheet, description) {
  try {
    var prot = sheet.protect().setDescription(description);
    // 持ち主以外を編集者から外す
    prot.removeEditors(prot.getEditors());
    if (prot.canDomainEdit()) prot.setDomainEdit(false);
  } catch (e) {
    // 保護できない共有設定のこともある。そのときは README の注意書きで運用する
  }
}

/* ===========================================================
   バックアップ（月に1回、CSV を Google ドライブに置く）
   =========================================================== */

/**
 * これを1回実行しておくと、毎月1日に backup() が自動で動くようになる。
 */
function setupBackupTrigger() {
  // 二重に登録しないよう、同じものがあれば消してから作る
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backup') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('backup').timeBased().onMonthDay(1).atHour(4).create();
  SpreadsheetApp.getUi().alert(
    '毎月1日の朝に、バックアップの CSV を\n' +
      'Google ドライブの「' + BACKUP_FOLDER + '」フォルダへ書き出します。'
  );
}

/**
 * 「記録」シートをまるごと CSV にして、ドライブのフォルダに置く。
 * CSV にしておくと、将来この仕組みをやめても中身を読めます。
 */
function backup() {
  var sheet = logSheet();
  var last = sheet.getLastRow();
  if (last < 1) return;

  var values = sheet.getRange(1, 1, last, COLUMNS.length).getValues();
  var csv = values
    .map(function (row) {
      return row
        .map(function (v) {
          if (v instanceof Date) v = Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm:ss');
          var s = String(v == null ? '' : v);
          return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        })
        .join(',');
    })
    .join('\r\n');

  var folder = backupFolder();

  var name = '衛生記録_' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd') + '.csv';
  // Excel で開いても文字化けしないように、先頭に BOM を付ける
  folder.createFile(name, '\uFEFF' + csv, MimeType.CSV);
}

/**
 * バックアップの置き場所を返す。
 *
 * スプレッドシートと「同じフォルダの中」に作るのが大事。
 * DriveApp.createFolder() をそのまま使うと、実行した人の
 * マイドライブに作られてしまう。そうすると、スプレッドシートを
 * 共有ドライブに移しても、バックアップだけ個人のドライブに
 * 取り残されて、アカウントが使えなくなったときに一緒に消える。
 */
function backupFolder() {
  var file = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId());
  var parents = file.getParents();
  var parent = parents.hasNext() ? parents.next() : null;

  if (parent) {
    var found = parent.getFoldersByName(BACKUP_FOLDER);
    return found.hasNext() ? found.next() : parent.createFolder(BACKUP_FOLDER);
  }

  // 親が取れないときだけ、しかたなくマイドライブに作る
  var f = DriveApp.getFoldersByName(BACKUP_FOLDER);
  return f.hasNext() ? f.next() : DriveApp.createFolder(BACKUP_FOLDER);
}

/* ===========================================================
   アプリからの読み込み（GET）
   =========================================================== */

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    checkKey(p.key);

    if (p.action === 'day') {
      return json({
        ok: true,
        staff: staffList(p.site),
        reviewers: reviewerList(),
        records: readRecords(function (r) {
          return r.site === p.site && r.date === p.date;
        }),
      });
    }

    if (p.action === 'month') {
      // ym は '2026-09'。対象日がその月で始まるものを集める
      var prefix = String(p.ym || '');
      return json({
        ok: true,
        staff: staffList(p.site),
        reviewers: reviewerList(),
        records: readRecords(function (r) {
          return r.site === p.site && r.date.indexOf(prefix) === 0;
        }),
        reviews: readReviews(p.site, prefix),
      });
    }

    return json({ ok: false, error: '知らない action です：' + p.action });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) });
  }
}

/* ===========================================================
   アプリからの書き込み（POST）
   =========================================================== */

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    checkKey(body.key);

    // 同時に送られてきても、行が混ざらないように順番待ちをする
    lock.waitLock(20000);

    if (body.action === 'submit') return json(submitRecord(body));
    if (body.action === 'review') return json(submitReview(body));

    return json({ ok: false, error: '知らない action です：' + body.action });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) });
  } finally {
    try {
      lock.releaseLock();
    } catch (e2) {
      /* ロックを取れていなければ、外す必要もない */
    }
  }
}

/* ---------- 記録を足す ---------- */

function submitRecord(body) {
  var sheet = logSheet();

  /* 電波が悪くて送り直されたとき、同じ記録が2行にならないようにする。
     アプリは送るたびに違う clientId を付けるので、
     同じ clientId がすでにあれば、それは送り直し */
  var already = findByClientId(sheet, COLUMNS, body.clientId);
  if (already) return { ok: true, id: already, duplicate: true };

  var now = new Date();
  var rec = {
    id: newId(now, 'R'),
    submittedAt: Utilities.formatDate(now, TZ, 'yyyy-MM-dd HH:mm:ss'),
    date: String(body.date || '').slice(0, 10),
    site: String(body.site || ''),
    siteName: String(body.siteName || ''),
    timing: String(body.timing || ''),
    timingLabel: String(body.timingLabel || ''),
    staff: String(body.staff || '').trim(),
    kind: body.kind === '訂正' ? '訂正' : '記録',
    targetId: String(body.targetId || ''),
    clientId: String(body.clientId || ''),
    ngNote: String(body.ngNote || ''),
    note: String(body.note || ''),
  };

  /* 手引書で必須とされている4点（日付・項目の良否・否のときの対応・記録者）が
     そろっているかを、こちら側でも確かめる。
     アプリの画面でも確かめているが、画面を通さずに送られたときの備え */
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rec.date)) return { ok: false, error: '対象日が正しくありません' };
  if (!rec.site || !rec.timing) return { ok: false, error: '拠点・タイミングが足りません' };
  if (!rec.staff) return { ok: false, error: '記録者が入っていません' };

  // 未来の日付は受け取らない（あとから作った記録に見えてしまうため）
  var today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  if (rec.date > today) return { ok: false, error: '未来の日付では記録できません' };

  var values = body.values || {};
  var filled = 0;
  COLUMNS.forEach(function (c) {
    if (c.item && values[c.key] !== '' && values[c.key] != null) filled++;
  });
  if (!filled) return { ok: false, error: '記録の中身が空です' };

  // 「否」があるのに対応が書かれていない記録は受け取らない
  var hasNg = false;
  COLUMNS.forEach(function (c) {
    if (c.item && values[c.key] === '否') hasNg = true;
  });
  if (hasNg && !rec.ngNote) {
    return { ok: false, error: '「否」のときは、対応した内容が必要です' };
  }

  var row = COLUMNS.map(function (c) {
    if (c.item) {
      var v = values[c.key];
      return v == null ? '' : v;
    }
    return rec[c.key] == null ? '' : rec[c.key];
  });

  sheet.appendRow(row);
  return { ok: true, id: rec.id };
}

/* ---------- 責任者が「この月を確認した」を足す ---------- */

function submitReview(body) {
  var sheet = reviewSheet();

  var already = findByClientId(sheet, REVIEW_COLUMNS, body.clientId);
  if (already) return { ok: true, id: already, duplicate: true };

  var now = new Date();
  var rev = {
    id: newId(now, 'C'),
    reviewedAt: Utilities.formatDate(now, TZ, 'yyyy-MM-dd HH:mm:ss'),
    site: String(body.site || ''),
    siteName: String(body.siteName || ''),
    ym: String(body.ym || '').slice(0, 7),
    reviewer: String(body.reviewer || '').trim(),
    memo: String(body.memo || ''),
    clientId: String(body.clientId || ''),
  };

  if (!rev.site) return { ok: false, error: '拠点が足りません' };
  if (!/^\d{4}-\d{2}$/.test(rev.ym)) return { ok: false, error: '対象年月が正しくありません' };
  if (!rev.reviewer) return { ok: false, error: '責任者の名前が入っていません' };

  sheet.appendRow(
    REVIEW_COLUMNS.map(function (c) {
      return rev[c.key] == null ? '' : rev[c.key];
    })
  );
  return { ok: true, id: rev.id };
}

/* ===========================================================
   中で使う部品
   =========================================================== */

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function checkKey(key) {
  if (ACCESS_KEY && String(key || '') !== ACCESS_KEY) {
    throw new Error('合言葉が違います');
  }
}

function logSheet() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_LOG);
  if (!sheet) throw new Error('「記録」シートがありません。setup() を実行してください');
  return sheet;
}

function reviewSheet() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_REVIEW);
  if (!sheet) throw new Error('「責任者確認」シートがありません。setup() を実行してください');
  return sheet;
}

/** ID を作る。'R20260921-083012-4f2' のような形 */
function newId(now, prefix) {
  return (
    prefix +
    Utilities.formatDate(now, TZ, 'yyyyMMdd-HHmmss') +
    '-' +
    Math.random().toString(36).slice(2, 5)
  );
}

/** 同じ clientId の行があれば、その ID を返す */
function findByClientId(sheet, cols, clientId) {
  if (!clientId) return null;
  var last = sheet.getLastRow();
  if (last < 2) return null;

  var idCol = colIndex(cols, 'id');
  var cidCol = colIndex(cols, 'clientId');
  var n = last - 1;
  var ids = sheet.getRange(2, idCol, n, 1).getValues();
  var cids = sheet.getRange(2, cidCol, n, 1).getValues();

  // 送り直しは直前の送信なので、後ろから探すほうが早く見つかる
  for (var i = n - 1; i >= 0; i--) {
    if (String(cids[i][0]) === String(clientId)) return String(ids[i][0]);
  }
  return null;
}

/** 列の番号（1 から数える） */
function colIndex(cols, key) {
  for (var i = 0; i < cols.length; i++) {
    if (cols[i].key === key) return i + 1;
  }
  throw new Error('知らない列です：' + key);
}

/**
 * 記録を読み出す。keep(record) が true のものだけ返す。
 * 対象日はシートの設定によって日付として入ることがあるので、
 * どちらでも 'YYYY-MM-DD' の文字に揃えてから渡す。
 */
function readRecords(keep) {
  var sheet = logSheet();
  var last = sheet.getLastRow();
  if (last < 2) return [];

  var rows = sheet.getRange(2, 1, last - 1, COLUMNS.length).getValues();
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var rec = { values: {} };

    for (var c = 0; c < COLUMNS.length; c++) {
      var col = COLUMNS[c];
      var v = row[c];
      if (col.item) {
        rec.values[col.key] = v instanceof Date ? asYmd(v) : v;
      } else {
        rec[col.key] = v;
      }
    }

    rec.date = asYmd(rec.date);
    rec.submittedAt = asStamp(rec.submittedAt);
    rec.time = rec.submittedAt.slice(11, 16); // 'HH:mm'

    if (keep(rec)) out.push(rec);
  }
  return out;
}

/** その拠点・その年月の、責任者確認の記録 */
function readReviews(site, ym) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_REVIEW);
  if (!sheet) return [];
  var last = sheet.getLastRow();
  if (last < 2) return [];

  var rows = sheet.getRange(2, 1, last - 1, REVIEW_COLUMNS.length).getValues();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var rev = {};
    for (var c = 0; c < REVIEW_COLUMNS.length; c++) {
      rev[REVIEW_COLUMNS[c].key] = rows[i][c];
    }
    rev.reviewedAt = asStamp(rev.reviewedAt);
    rev.ym = String(rev.ym || '').slice(0, 7);
    if (String(rev.site) === String(site) && rev.ym === ym) out.push(rev);
  }
  return out;
}

/** 日付でも文字でも 'YYYY-MM-DD' にする */
function asYmd(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v == null ? '' : v).slice(0, 10);
}

/** 日時でも文字でも 'YYYY-MM-DD HH:mm:ss' にする */
function asStamp(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm:ss');
  return String(v == null ? '' : v);
}

/**
 * 「設定」シートの C 列にある責任者の名簿。
 * 月に1回、記録をまとめて確認する人。
 * 日々つける人と、それを見る人は役割が違うので、記録者とは分けている。
 */
function reviewerList() {
  var st = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SETTING);
  if (!st) return [];
  var last = st.getLastRow();
  if (last < 2) return [];

  var rows = st.getRange(2, 3, last - 1, 1).getValues();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var name = String(rows[i][0] || '').trim();
    if (name && out.indexOf(name) < 0) out.push(name);
  }
  return out;
}

/** 「設定」シートの記録者名簿。B 列に拠点コードがあれば、その拠点だけ */
function staffList(site) {
  var st = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SETTING);
  if (!st) return [];
  var last = st.getLastRow();
  if (last < 2) return [];

  var rows = st.getRange(2, 1, last - 1, 2).getValues();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var name = String(rows[i][0] || '').trim();
    var only = String(rows[i][1] || '').trim();
    if (!name) continue;
    if (only && site && only !== site) continue;
    if (out.indexOf(name) < 0) out.push(name);
  }
  return out;
}
