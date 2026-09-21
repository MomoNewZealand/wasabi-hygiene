/* ===========================================================
   TOKYO WASABI 衛生記録 ― 管理用の画面（Momo 専用）

   拠点と年月をえらぶと、いまの紙とおなじ形の月次チェック表を出す。
   そのまま印刷（PDF 保存）できるので、保健所に出すときはこれを使う。
   CSV でも書き出せる。

   責任者が「この月を確認した」を記録することもできる。
   手引書で「責任者は月に1回以上記録をチェックする」とされているため。

   一度見た月は端末に控えを残すので、圏外でも前に見た内容は出せる。

   スタッフ用の画面からはリンクしていない。
   =========================================================== */
'use strict';

const A = {
  site: SITES[0],
  ym: thisMonth(),
  records: [],
  reviews: [],
  staffList: [],
  reviewers: [], // 責任者の名簿（設定シートの C 列）。記録者とは分けている
  loading: false,
  error: '',
  offline: false, // 端末の控えを表示しているか
  savedAt: 0, // その控えを保存した時刻
  sending: false,
};

const app = document.getElementById('app');

function thisMonth() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

/** '2026-09' → その月の日数 */
function daysInMonth(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return 31;
  return new Date(Number(m[1]), Number(m[2]), 0).getDate();
}

function ymParts(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(ym) || [];
  return { y: Number(m[1]) || 0, m: Number(m[2]) || 0 };
}

/* ---------- 端末に残す控え ----------

   保健所は、電波の届かないキッチンカーの現場でも記録の提示を求めることがある。
   一度でも表示した月は端末に残しておき、つながらないときはそれを出す。
   ただし「いつ時点の控えか」を画面にはっきり出す */

function cacheKey(site, ym) {
  return 'wasabi-hygiene:month:' + site + ':' + ym;
}

function cacheSave() {
  lsSet(
    cacheKey(A.site.key, A.ym),
    JSON.stringify({
      savedAt: Date.now(),
      records: A.records,
      reviews: A.reviews,
      staff: A.staffList,
      reviewers: A.reviewers,
    })
  );
}

function cacheLoad(site, ym) {
  try {
    const raw = lsGet(cacheKey(site, ym));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/* ---------- 読み込み ---------- */

async function load() {
  A.loading = true;
  A.error = '';
  A.offline = false;
  A.reviewAgain = false;

  /* 圏外だと、つながらないと分かるまで10秒ほどかかる。
     保健所の人を待たせないよう、控えがあれば先に出してしまい、
     つながったら最新に入れ替える */
  const first = cacheLoad(A.site.key, A.ym);
  if (first) {
    A.records = first.records || [];
    A.reviews = first.reviews || [];
    A.staffList = first.staff || [];
    A.reviewers = first.reviewers || [];
    A.offline = true;
    A.savedAt = first.savedAt || 0;
  } else {
    A.records = [];
    A.reviews = [];
    A.staffList = [];
    A.reviewers = [];
  }
  render();

  try {
    const data = await apiGet({ action: 'month', site: A.site.key, ym: A.ym });
    A.records = Array.isArray(data.records) ? data.records : [];
    A.reviews = Array.isArray(data.reviews) ? data.reviews : [];
    A.staffList = Array.isArray(data.staff) ? data.staff : [];
    A.reviewers = Array.isArray(data.reviewers) ? data.reviewers : [];
    A.offline = false;
    cacheSave();
  } catch (err) {
    // 控えを先に出してあるときは、そのまま見せ続ける（圏外の断りは出したまま）
    if (!first) A.error = err.message || '読み込めませんでした';
  } finally {
    A.loading = false;
    render();
  }
}

/** いちばん新しい責任者確認 */
function latestReview() {
  return A.reviews.length ? A.reviews[A.reviews.length - 1] : null;
}

/* ---------- 日ごとにまとめる ----------

   1日に「営業前」と「営業後」の2件がある。月次表は紙とおなじく1日1行なので、
   両方の記録をひとつにまとめる。
   同じ日・同じタイミングの記録が複数あるときは、あとから出した訂正が勝つ */

function byDay() {
  const map = {};
  A.records.forEach(function (r) {
    const d = String(r.date || '');
    if (!map[d]) map[d] = { before: null, after: null };
    map[d][r.timing === 'before' ? 'before' : 'after'] = r; // 新しいもので上書き
  });
  return map;
}

/** その日の値をひとつのまとまりとして取り出す */
function dayCell(day) {
  const values = {};
  const staff = [];
  const notes = [];

  ['before', 'after'].forEach(function (t) {
    const r = day && day[t];
    if (!r) return;
    const v = r.values || {};
    Object.keys(v).forEach(function (k) {
      if (v[k] !== '' && v[k] != null) values[k] = v[k];
    });
    if (r.staff && staff.indexOf(r.staff) < 0) staff.push(r.staff);
    if (r.ngNote) notes.push(r.ngNote);
    if (r.note) notes.push(r.note);
    if (r.kind === '訂正') notes.push('（' + timingLabel(t, A.site) + 'の記録を訂正）');
  });

  return {
    values: values,
    staff: staff.join('・'),
    note: notes.join(' ／ '),
    has: !!(day && (day.before || day.after)),
  };
}

/* ---------- 画面 ---------- */

function render() {
  const p = ymParts(A.ym);

  app.innerHTML =
    '<div class="wrap admin-wrap">' +
    '<div class="pick no-print">' +
    '<label>拠点<select id="site">' +
    SITES.map(function (s) {
      return (
        '<option value="' +
        esc(s.key) +
        '"' +
        (s.key === A.site.key ? ' selected' : '') +
        '>' +
        esc(s.name) +
        '</option>'
      );
    }).join('') +
    '</select></label>' +
    '<label>年月<input type="month" id="ym" value="' + esc(A.ym) + '"></label>' +
    '<button type="button" id="go" class="btn">表示</button>' +
    '<span class="pick-gap"></span>' +
    '<a href="plan.html" class="btn btn-ghost" id="plan">' + icon('clipboard') + '衛生管理計画</a>' +
    '<button type="button" id="print" class="btn btn-ghost">' + icon('print') + '印刷・PDF</button>' +
    '<button type="button" id="csv" class="btn btn-ghost">' + icon('download') + 'CSV</button>' +
    '</div>' +
    (A.loading ? '<div class="loading"><span class="spinner"></span>読み込み中…</div>' : '') +
    (A.error
      ? '<div class="notice notice-err">' + icon('alert') + '<div>' + esc(A.error) + '</div></div>'
      : '') +
    (A.offline
      ? '<div class="notice notice-wait no-print">' +
        icon('cloud') +
        '<div><b>' +
        (A.loading
          ? 'この端末の控えを出しています（最新を確認中…）'
          : 'つながらないので、この端末の控えを出しています') +
        '</b><p>' +
        esc(savedAtText()) +
        ' に読み込んだ内容です。そのあとに増えた記録は入っていません。</p></div></div>'
      : '') +
    (!A.error && (A.records.length || !A.loading) ? summary() + reviewPanel() : '') +
    '<div class="sheet-title"><b>' +
    esc(A.site.name) +
    '</b><span>' +
    p.y +
    '年 ' +
    p.m +
    '月　衛生管理記録</span></div>' +
    (A.error || (A.loading && !A.records.length) ? '' : table('ippan') + table('juyo')) +
    '</div>';

  head();
  bind();
}

function savedAtText() {
  if (!A.savedAt) return '前';
  const d = new Date(A.savedAt);
  return d.getMonth() + 1 + '月' + d.getDate() + '日 ' + d.getHours() + ':' +
    String(d.getMinutes()).padStart(2, '0');
}

function summary() {
  const map = byDay();
  const days = Object.keys(map).length;
  let ng = 0;
  Object.keys(map).forEach(function (d) {
    const c = dayCell(map[d]);
    itemsFor(A.site).forEach(function (it) {
      if (ngNeededFlat(it, c.values[it.id])) ng++;
    });
  });
  return (
    '<div class="summary no-print">' +
    '記録のある日：<b>' +
    days +
    '</b> 日' +
    (ng ? '　／　「否」や目安超え：<b class="ng-count">' + ng + '</b> 件' : '　／　すべて「良」') +
    '</div>'
  );
}

/* ---------- 責任者確認 ----------

   手引書では「責任者は月に1回以上記録をチェックし、問題があればすみやかに改善する」
   とされている。その確認をここで記録する */

function reviewPanel() {
  const rev = latestReview();
  const p = ymParts(A.ym);
  /* 責任者は「設定」シートの C 列の人だけ。
     名簿が空のときだけ、記録者の名簿から選べるようにしておく */
  const names = A.reviewers.length ? A.reviewers : A.staffList;

  if (rev && !A.reviewAgain) {
    return (
      '<div class="notice notice-done no-print">' +
      icon('check') +
      '<div><b>責任者確認ずみ</b>' +
      '<p>' +
      esc(rev.reviewer) +
      ' が ' +
      esc(String(rev.reviewedAt).slice(0, 10)) +
      ' に ' +
      p.y +
      '年' +
      p.m +
      '月分を確認しました。' +
      (rev.memo ? '（' + esc(rev.memo) + '）' : '') +
      '</p></div>' +
      '<button type="button" id="review-again">もう一度確認する</button>' +
      '</div>'
    );
  }

  return (
    '<div class="review-box no-print">' +
    '<b>' + p.y + '年' + p.m + '月分の責任者確認</b>' +
    '<p>記録をひととおり見たら、ここに残してください。月次表の「確認者」欄に入ります。</p>' +
    '<div class="review-row">' +
    (names.length
      ? '<select id="reviewer"><option value="">責任者をえらぶ</option>' +
        names.map(function (n) {
          return '<option value="' + esc(n) + '">' + esc(n) + '</option>';
        }).join('') +
        '</select>'
      : '<input type="text" id="reviewer" placeholder="責任者の名前">') +
    '<input type="text" id="review-memo" placeholder="気づいたこと・改善したこと（任意）">' +
    '<button type="button" class="btn" id="review-go"' +
    (A.sending ? ' disabled' : '') +
    '>' +
    (A.sending ? '記録中…' : '確認した') +
    '</button>' +
    '</div>' +
    '</div>'
  );
}

async function sendReview() {
  const el = document.getElementById('reviewer');
  const memo = document.getElementById('review-memo');
  const name = String((el && el.value) || '').trim();
  if (!name) {
    toast('責任者の名前をえらんでください', { type: 'error' });
    return;
  }

  A.sending = true;
  render();
  try {
    await apiPost({
      action: 'review',
      clientId: deviceId() + '-' + Date.now().toString(36),
      site: A.site.key,
      siteName: A.site.name,
      ym: A.ym,
      reviewer: name,
      memo: String((memo && memo.value) || '').trim(),
    });
    A.sending = false;
    toast('責任者確認を記録しました');
    load();
  } catch (err) {
    A.sending = false;
    render();
    toast(err.message || '記録できませんでした', { type: 'error' });
  }
}

/** 温度は目安を超えていたら「否」あつかい */
function ngNeededFlat(item, v) {
  if (item.type === 'temp') {
    const n = num(v);
    return n != null && n > item.limit;
  }
  return v === '否';
}

/* ---------- 月次表 ----------

   紙の様式にならって、列は
     日 → 各項目（良否・温度）→ 日々チェック → 製造物 → 特記事項 → 確認者
   の順。
   「日々チェック」はその日に記録した人、「確認者」は月に1回見る責任者 */

function table(group) {
  const site = A.site;
  const all = itemsFor(site).filter(function (i) {
    return i.group === group;
  });
  const marks = all.filter(function (i) {
    return i.type !== 'text';
  });
  const texts = all.filter(function (i) {
    return i.type === 'text';
  });
  if (!marks.length && !texts.length) return '';

  const map = byDay();
  const n = daysInMonth(A.ym);
  const p = ymParts(A.ym);
  const rev = latestReview();

  const thead =
    '<tr><th class="c-day">日</th>' +
    marks
      .map(function (it) {
        return '<th><span class="th-no">' + esc(it.no || '') + '</span>' + esc(it.short) + '</th>';
      })
      .join('') +
    '<th class="c-staff">日々<br>チェック</th>' +
    texts
      .map(function (it) {
        return '<th class="c-free">' + esc(it.short) + '</th>';
      })
      .join('') +
    '<th class="c-note">特記事項</th>' +
    '<th class="c-staff">確認者</th></tr>';

  let rows = '';
  for (let d = 1; d <= n; d++) {
    const key = p.y + '-' + String(p.m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const c = dayCell(map[key]);
    const wday = new Date(p.y, p.m - 1, d).getDay();

    rows +=
      '<tr class="' +
      (c.has ? '' : 'empty ') +
      (wday === 0 ? 'sun' : wday === 6 ? 'sat' : '') +
      '">' +
      '<td class="c-day">' + d + '</td>' +
      marks
        .map(function (it) {
          return (
            '<td class="' + cellClass(it, c.values[it.id]) + '">' + cellText(it, c.values[it.id]) + '</td>'
          );
        })
        .join('') +
      '<td class="c-staff">' + esc(c.staff) + '</td>' +
      texts
        .map(function (it) {
          return '<td class="c-free">' + cellText(it, c.values[it.id]) + '</td>';
        })
        .join('') +
      '<td class="c-note">' + esc(c.note) + '</td>' +
      // 確認者は、責任者がその月を確認したときに、記録のある日だけ入る
      '<td class="c-staff">' + (rev && c.has ? esc(rev.reviewer) : '') + '</td>' +
      '</tr>';
  }

  const title = group === 'ippan' ? '一般的衛生管理' : '⑤ 重要管理のポイント';

  /* 印刷すると2枚になる。どちらの紙だけを見ても、どこの何月の記録か
     分かるように、見出しに拠点名と年月を入れておく */
  return (
    '<section class="sheet">' +
    '<h2 class="sheet-h">' +
    '<span class="sheet-h-where">' + esc(A.site.name) + '　' + p.y + '年' + p.m + '月</span>' +
    esc(title) +
    '</h2>' +
    '<div class="table-scroll"><table class="grid"><thead>' +
    thead +
    '</thead><tbody>' +
    rows +
    '</tbody></table></div>' +
    reviewFoot(rev) +
    '</section>'
  );
}

/** 紙の下につける責任者の確認欄。アプリで確認ずみならその内容を刷る */
function reviewFoot(rev) {
  if (rev) {
    return (
      '<p class="sheet-foot">責任者確認：<b>' +
      esc(rev.reviewer) +
      '</b>　確認日：' +
      esc(String(rev.reviewedAt).slice(0, 10)) +
      (rev.memo ? '　' + esc(rev.memo) : '') +
      '</p>'
    );
  }
  // まだのときは、手で書ける空欄にしておく
  return '<p class="sheet-foot">責任者確認：＿＿＿＿＿＿＿＿　確認日：＿＿＿＿年＿＿月＿＿日</p>';
}

function cellText(item, v) {
  if (v == null || v === '') return '';
  if (item.type === 'temp') {
    const t = num(v);
    return t == null ? '' : esc(t) + '℃';
  }
  if (item.type === 'text') return esc(v);
  if (v === '該当なし') return '—';
  return esc(v);
}

function cellClass(item, v) {
  if (ngNeededFlat(item, v)) return 'c-ng';
  if (v === '該当なし') return 'c-na';
  return 'c-ok';
}

/* ---------- CSV ---------- */

/* Excel が文字化けしないように、先頭に BOM を付ける */
function toCsv() {
  const site = A.site;
  const items = itemsFor(site);
  const rev = latestReview();

  const headers = ['記録ID', '送信日時', '対象日', '拠点', 'タイミング', '記録者（日々チェック）', '種別', '訂正元ID']
    .concat(
      items.map(function (it) {
        return (it.no ? it.no + ' ' : '') + it.short;
      })
    )
    .concat(['否への対応', '特記事項', '責任者確認', '責任者確認日']);

  const q = function (v) {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const lines = [headers.map(q).join(',')];
  A.records.forEach(function (r) {
    const v = r.values || {};
    const row = [r.id, r.submittedAt, r.date, r.siteName || site.name, r.timingLabel, r.staff, r.kind, r.targetId]
      .concat(
        items.map(function (it) {
          return v[it.id] == null ? '' : v[it.id];
        })
      )
      .concat([
        r.ngNote,
        r.note,
        rev ? rev.reviewer : '',
        rev ? String(rev.reviewedAt).slice(0, 10) : '',
      ]);
    lines.push(row.map(q).join(','));
  });

  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '衛生記録_' + site.name + '_' + A.ym + '.csv';
  a.click();
  setTimeout(function () {
    URL.revokeObjectURL(a.href);
  }, 1000);
}

/* ---------- 操作 ---------- */

function bind() {
  const s = document.getElementById('site');
  const y = document.getElementById('ym');

  document.getElementById('go').addEventListener('click', function () {
    A.site = SITE_BY_KEY[s.value] || SITES[0];
    A.ym = y.value || thisMonth();
    load();
  });

  document.getElementById('print').addEventListener('click', function () {
    window.print();
  });

  document.getElementById('csv').addEventListener('click', function () {
    if (!A.records.length) {
      toast('この月の記録がありません', { type: 'error' });
      return;
    }
    toCsv();
  });

  const go = document.getElementById('review-go');
  if (go) go.addEventListener('click', sendReview);

  const again = document.getElementById('review-again');
  if (again) {
    again.addEventListener('click', function () {
      // 入力欄をもう一度出すだけ。前の確認は消えず、新しい確認が下に足される
      A.reviewAgain = true;
      render();
    });
  }
}

function head() {
  document.getElementById('head').innerHTML =
    '<div class="head-top">' +
    '<h1>衛生記録<span class="head-sub">管理用</span></h1>' +
    '</div>';
}

load();
