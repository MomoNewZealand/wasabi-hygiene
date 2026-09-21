/* ===========================================================
   TOKYO WASABI 衛生記録 ― スタッフ用の画面

   QR コードから ?site=ken のように拠点を指定して開く。
   指定がなければ、拠点を選ぶ画面を出す。

   画面は3つ。
     拠点えらび → ホーム（営業前 / 営業後をえらぶ）→ 記録フォーム
   =========================================================== */
'use strict';

/* ---------- いまの状態 ---------- */

const S = {
  site: null, // 選んでいる拠点
  date: todayYmd(), // 記録の対象日
  screen: 'home', // 'sites' | 'home' | 'form'
  timing: null, // フォームを開いているときの 'before' / 'after'
  editing: null, // 訂正するとき、元になる記録
  staffList: [], // 記録者の名簿（スプレッドシートの「設定」シートから）
  records: [], // その日のその拠点の記録
  values: {}, // フォームの入力内容
  ngNotes: {}, // 「否」だったときの対応
  staff: '',
  note: '',
  loading: false,
  sending: false,
};

const app = document.getElementById('app');

/* ---------- 送れなかった記録をためておく箱 ---------- */

/* キッチンカーは電波が届かない場所がある。
   送信に失敗したら端末にためておき、つながったときに自動で送り直す。
   記録が消えてしまうのがいちばん困るので、ここは丁寧にやる */

const OUTBOX_KEY = 'wasabi-hygiene:outbox:v1';

function outboxRead() {
  try {
    const raw = lsGet(OUTBOX_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function outboxWrite(list) {
  lsSet(OUTBOX_KEY, JSON.stringify(list));
}

function outboxAdd(payload) {
  const list = outboxRead();
  list.push(payload);
  outboxWrite(list);
}

/** ためてある記録を順に送る。送れたものだけ箱から消す */
async function outboxFlush(quiet) {
  let list = outboxRead();
  if (!list.length) return 0;

  let sent = 0;
  for (const payload of list.slice()) {
    try {
      await apiPost(payload);
      sent++;
      // 1件送るたびに書き戻す。途中で閉じられても、送れた分は消えている
      list = list.filter(function (p) {
        return p.clientId !== payload.clientId;
      });
      outboxWrite(list);
    } catch (err) {
      break; // まだつながらない。残りは次の機会に
    }
  }
  if (sent && !quiet) {
    toast('たまっていた記録 ' + sent + ' 件を送信しました');
  }
  return sent;
}

/* ---------- 起動 ---------- */

function pickSiteFromUrl() {
  const q = new URLSearchParams(location.search);
  const key = q.get('site');
  return key && SITE_BY_KEY[key] ? SITE_BY_KEY[key] : null;
}

async function boot() {
  S.site = pickSiteFromUrl();
  if (!S.site) {
    S.screen = 'sites';
    render();
    return;
  }
  document.title = S.site.name + ' 衛生記録 | TOKYO WASABI';
  render();
  await refresh();
}

/** 名簿とその日の記録を読み直す */
async function refresh() {
  if (!S.site) return;
  S.loading = true;
  render();
  try {
    await outboxFlush(true);
    const data = await apiGet({ action: 'day', site: S.site.key, date: S.date });
    S.staffList = Array.isArray(data.staff) ? data.staff : [];
    S.records = Array.isArray(data.records) ? data.records : [];
    if (S.staffList.length) lsSet('wasabi-hygiene:staffList', JSON.stringify(S.staffList));
  } catch (err) {
    // 読めなくても記録はできるようにする。名簿は前回の控えを使う
    try {
      const cached = lsGet('wasabi-hygiene:staffList');
      if (cached) S.staffList = JSON.parse(cached);
    } catch (e) {
      /* 控えがなければ、記録者は手入力にする */
    }
    S.records = [];
    toast(err.message || '読み込めませんでした', { type: 'error' });
  } finally {
    S.loading = false;
    render();
  }
}

/** その日・そのタイミングの、いちばん新しい記録（訂正があれば訂正が勝つ） */
function recordFor(timing) {
  const list = S.records.filter(function (r) {
    return r.timing === timing;
  });
  if (!list.length) return null;
  return list[list.length - 1];
}

/** 送信待ちのうち、いま見ている拠点・日付のもの */
function pendingFor(timing) {
  return outboxRead().filter(function (p) {
    return p.site === S.site.key && p.date === S.date && p.timing === timing;
  }).length;
}

/* ===========================================================
   画面を組み立てる
   =========================================================== */

function render() {
  if (S.screen === 'sites') return renderSites();
  if (S.screen === 'form') return renderForm();
  return renderHome();
}

/* ---------- 拠点えらび（QR に拠点が入っていないとき） ---------- */

function renderSites() {
  app.innerHTML =
    '<div class="wrap">' +
    '<p class="lead">どこの記録をつけますか？</p>' +
    '<div class="site-list">' +
    SITES.map(function (s) {
      return (
        '<button type="button" class="site-btn" data-site="' +
        esc(s.key) +
        '">' +
        '<b>' +
        esc(s.name) +
        '</b><span>' +
        esc(s.sub) +
        '</span></button>'
      );
    }).join('') +
    '</div>' +
    '<p class="hint">ふだんは、それぞれの場所に貼った QR コードから開いてください。</p>' +
    '</div>';

  app.querySelectorAll('.site-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      // 選んだ拠点を URL に残す。ホーム画面に追加したときも覚えていてくれる
      location.search = '?site=' + b.dataset.site;
    });
  });
  head(null);
}

/* ---------- ホーム ---------- */

function renderHome() {
  const site = S.site;
  const pendingAll = outboxRead().length;

  const cards = TIMINGS.map(function (t) {
    const rec = recordFor(t.key);
    const pending = pendingFor(t.key);
    const label = timingLabel(t.key, site);
    const ico = t.key === 'before' ? 'sunrise' : 'sunset';

    let state = '';
    if (pending) {
      state = '<span class="pill pill-wait">' + icon('cloud') + '送信待ち</span>';
    } else if (rec) {
      state =
        '<span class="pill pill-done">' +
        icon('check') +
        '記録済み</span><span class="pill-sub">' +
        esc(rec.time || '') +
        ' ' +
        esc(rec.staff || '') +
        '</span>';
    } else {
      state = '<span class="pill pill-todo">まだ</span>';
    }

    return (
      '<div class="time-card' +
      (rec || pending ? ' is-done' : '') +
      '">' +
      '<button type="button" class="time-main" data-timing="' +
      t.key +
      '">' +
      '<span class="time-ico">' +
      icon(ico) +
      '</span>' +
      '<span class="time-body"><b>' +
      esc(label) +
      'の記録</b>' +
      state +
      '</span>' +
      '</button>' +
      (rec && !pending
        ? '<button type="button" class="time-fix" data-fix="' + t.key + '">訂正する</button>'
        : '') +
      '</div>'
    );
  }).join('');

  app.innerHTML =
    '<div class="wrap">' +
    '<div class="date-bar">' +
    '<label for="date">記録する日</label>' +
    '<input type="date" id="date" value="' +
    esc(S.date) +
    '" max="' +
    esc(todayYmd()) +
    '">' +
    (S.date !== todayYmd() ? '<span class="date-note">今日ではありません</span>' : '') +
    '</div>' +
    (S.loading ? '<div class="loading"><span class="spinner"></span>読み込み中…</div>' : '') +
    '<div class="time-list">' +
    cards +
    '</div>' +
    (pendingAll
      ? '<div class="notice notice-wait">' +
        icon('cloud') +
        '<div><b>送信待ちが ' +
        pendingAll +
        ' 件あります</b><p>記録は端末に残っています。電波の届くところでこの画面を開くと、自動で送信します。</p></div>' +
        '<button type="button" id="flush">いま送る</button></div>'
      : '') +
    '<p class="hint">記録した内容は、あとから消せません。間違えたときは「訂正する」から入れ直してください。</p>' +
    /* 保健所は「衛生管理計画」と「記録表」の両方を見ます。
       現場で聞かれたときにその場で出せるよう、ここから開けるようにしておく */
    '<a class="plan-link" href="plan.html?site=' +
    esc(site.key) +
    '">' +
    icon('clipboard') +
    '衛生管理計画を見る</a>' +
    '</div>';

  head(site);

  app.querySelectorAll('[data-timing]').forEach(function (b) {
    b.addEventListener('click', function () {
      openForm(b.dataset.timing, null);
    });
  });
  app.querySelectorAll('[data-fix]').forEach(function (b) {
    b.addEventListener('click', function () {
      openForm(b.dataset.fix, recordFor(b.dataset.fix));
    });
  });

  const d = document.getElementById('date');
  if (d) {
    d.addEventListener('change', function () {
      S.date = d.value || todayYmd();
      refresh();
    });
  }

  const f = document.getElementById('flush');
  if (f) {
    f.addEventListener('click', async function () {
      f.disabled = true;
      await outboxFlush(false);
      await refresh();
    });
  }
}

/* ---------- 記録フォーム ---------- */

function openForm(timing, editing) {
  S.timing = timing;
  S.editing = editing || null;
  S.values = {};
  S.ngNotes = {};
  S.note = '';
  S.staff = lsGet('wasabi-hygiene:staff') || '';

  // 訂正のときは、元の記録を入れた状態から始める
  if (editing) {
    const v = editing.values || {};
    Object.keys(v).forEach(function (k) {
      if (v[k] !== '' && v[k] != null) S.values[k] = v[k];
    });
    S.note = editing.note || '';
    S.staff = editing.staff || S.staff;
  }

  S.screen = 'form';
  window.scrollTo(0, 0);
  render();
}

function closeForm() {
  S.screen = 'home';
  S.timing = null;
  S.editing = null;
  window.scrollTo(0, 0);
  render();
}

function renderForm() {
  const site = S.site;
  const label = timingLabel(S.timing, site);
  const items = itemsFor(site, S.timing);

  const ippan = items.filter(function (i) {
    return i.group === 'ippan';
  });
  const juyo = items.filter(function (i) {
    return i.group === 'juyo';
  });

  const sections = [];
  if (ippan.length) {
    sections.push(section('一般的衛生管理', ippan, site));
  }
  if (juyo.length) {
    sections.push(section('⑤ 重要管理のポイント', juyo, site));
  }

  /* 記録者 */
  let staffHtml;
  if (S.staffList.length) {
    staffHtml =
      '<div class="staff-list">' +
      S.staffList
        .map(function (n) {
          return (
            '<button type="button" class="staff-btn' +
            (S.staff === n ? ' on' : '') +
            '" data-staff="' +
            esc(n) +
            '">' +
            esc(n) +
            '</button>'
          );
        })
        .join('') +
      '</div>';
  } else {
    staffHtml =
      '<input type="text" id="staff-free" class="text-in" placeholder="名前を入れてください" value="' +
      esc(S.staff) +
      '">';
  }

  app.innerHTML =
    '<form class="wrap form" id="form" novalidate>' +
    '<div class="form-head">' +
    '<button type="button" class="back-btn" id="back">' +
    icon('back') +
    'やめる</button>' +
    '<div class="form-title"><b>' +
    esc(label) +
    'の記録</b><span>' +
    esc(dateLabel(S.date)) +
    ' ・ ' +
    esc(site.name) +
    '</span></div>' +
    '</div>' +
    (S.editing
      ? '<div class="notice notice-fix">' +
        icon('alert') +
        '<div><b>訂正として記録します</b><p>もとの記録は消えません。あとから入れ直したことが分かる形で残ります。</p></div></div>'
      : '') +
    '<button type="button" class="all-ok" id="allok">' +
    icon('check') +
    'すべて「良」にする</button>' +
    sections.join('') +
    '<section class="card">' +
    '<h2>記録した人</h2>' +
    staffHtml +
    '</section>' +
    '<section class="card">' +
    '<h2>特記事項<span class="opt">なければ空のままで大丈夫です</span></h2>' +
    '<textarea id="note" class="text-in" rows="3" placeholder="気づいたこと、いつもと違ったこと">' +
    esc(S.note) +
    '</textarea>' +
    '</section>' +
    '<div class="submit-bar">' +
    '<button type="submit" class="submit-btn" id="submit"' +
    (S.sending ? ' disabled' : '') +
    '>' +
    (S.sending ? '送信中…' : '記録する') +
    '</button>' +
    '</div>' +
    '</form>';

  head(site);
  bindForm();
}

/** 項目のまとまり（一般的衛生管理 / 重要管理）を組み立てる */
function section(title, items, site) {
  /* 冷蔵庫と冷凍庫のように、計画では同じ番号の項目が続くことがある。
     番号は先頭の1件にだけ出して、続きは番号を空にすると読みやすい */
  let prevNo = null;

  const body = items
    .map(function (it) {
      const sameAsPrev = it.no && it.no === prevNo;
      prevNo = it.no;
      return itemCard(it, site, sameAsPrev);
    })
    .join('');

  return '<section class="group"><h2 class="group-title">' + esc(title) + '</h2>' + body + '</section>';
}

function itemCard(item, site, hideNo) {
  const v = S.values[item.id];
  const how = textFor(item, 'how', site);
  const menu = textFor(item, 'menu', site);
  const ngText = textFor(item, 'ng', site);

  let control = '';
  if (item.type === 'text') {
    control =
      '<input type="text" class="text-in" data-text="' +
      esc(item.id) +
      '" placeholder="' +
      esc(item.placeholder || '') +
      '" value="' +
      esc(v == null ? '' : v) +
      '">';
  } else if (item.type === 'temp') {
    const n = num(v);
    const over = n != null && !withinLimit(item, n);
    control =
      '<div class="temp-row' +
      (over ? ' over' : '') +
      '">' +
      '<span class="temp-ico">' +
      icon('thermo') +
      '</span>' +
      '<input type="number" inputmode="decimal" step="0.1" class="temp-in" data-temp="' +
      esc(item.id) +
      '" value="' +
      (n == null ? '' : esc(n)) +
      '" placeholder="--">' +
      '<span class="temp-unit">℃</span>' +
      '<span class="temp-limit">目安 ' +
      esc(item.limitText) +
      '</span>' +
      '</div>' +
      (over
        ? '<p class="over-msg">' + icon('alert') + '目安を超えています。下に対応を書いてください。</p>'
        : '');
  } else {
    const opts = [{ v: '良', cls: 'ok' }, { v: '否', cls: 'ng' }];
    if (item.type === 'goodNA') opts.push({ v: '該当なし', cls: 'na', label: item.naLabel });
    control =
      '<div class="choice">' +
      opts
        .map(function (o) {
          return (
            '<button type="button" class="ch ch-' +
            o.cls +
            (v === o.v ? ' on' : '') +
            '" data-set="' +
            esc(item.id) +
            '" data-val="' +
            esc(o.v) +
            '">' +
            esc(o.label || o.v) +
            '</button>'
          );
        })
        .join('') +
      '</div>';
  }

  const needNote = ngNeeded(item, v);
  const noteHtml = needNote
    ? '<div class="ng-box">' +
      '<label for="ng-' +
      esc(item.id) +
      '">どう対応しましたか？</label>' +
      (ngText ? '<p class="ng-plan">計画では「' + esc(ngText) + '」</p>' : '') +
      '<textarea id="ng-' +
      esc(item.id) +
      '" class="text-in" rows="2" data-ng="' +
      esc(item.id) +
      '">' +
      esc(S.ngNotes[item.id] || '') +
      '</textarea>' +
      '</div>'
    : '';

  return (
    '<div class="card item' +
    (needNote ? ' is-ng' : '') +
    (isFilled(item, v) ? ' is-filled' : '') +
    '" data-card="' +
    esc(item.id) +
    '">' +
    '<div class="item-head">' +
    (item.no && !hideNo ? '<span class="item-no">' + esc(item.no) + '</span>' : '') +
    '<h3>' +
    esc(item.name) +
    '</h3>' +
    '</div>' +
    (menu ? '<p class="item-menu">' + esc(menu) + '</p>' : '') +
    (how ? '<p class="item-how">' + esc(how) + '</p>' : '') +
    control +
    noteHtml +
    '</div>'
  );
}

/** 温度が目安の内側か */
function withinLimit(item, n) {
  // 冷蔵は 5℃以下、冷凍は -15℃以下。どちらも「その数字以下ならよい」
  return n <= item.limit;
}

/** 入力が済んでいるか */
function isFilled(item, v) {
  if (item.type === 'text') return true; // 製造物は空でもよい
  if (item.type === 'temp') return num(v) != null;
  return v === '良' || v === '否' || v === '該当なし';
}

/** 対応の記入が必要か（否、または温度が目安を超えたとき） */
function ngNeeded(item, v) {
  if (item.type === 'temp') {
    const n = num(v);
    return n != null && !withinLimit(item, n);
  }
  return v === '否';
}

/* ---------- フォームの操作 ---------- */

function bindForm() {
  document.getElementById('back').addEventListener('click', closeForm);

  document.getElementById('allok').addEventListener('click', function () {
    itemsFor(S.site, S.timing).forEach(function (it) {
      if (it.type === 'good' || it.type === 'goodNA') S.values[it.id] = '良';
    });
    keepScroll(render);
  });

  app.querySelectorAll('[data-set]').forEach(function (b) {
    b.addEventListener('click', function () {
      const id = b.dataset.set;
      // 同じものをもう一度押したら選び直せるように、選択を外す
      S.values[id] = S.values[id] === b.dataset.val ? undefined : b.dataset.val;
      if (S.values[id] !== '否') delete S.ngNotes[id];
      keepScroll(render);
    });
  });

  app.querySelectorAll('[data-temp]').forEach(function (i) {
    // 打っている途中で作り直すとカーソルが飛ぶので、入力が終わってから作り直す
    i.addEventListener('input', function () {
      S.values[i.dataset.temp] = i.value;
    });
    i.addEventListener('blur', function () {
      keepScroll(render);
    });
  });

  app.querySelectorAll('[data-text]').forEach(function (i) {
    i.addEventListener('input', function () {
      S.values[i.dataset.text] = i.value;
    });
  });

  app.querySelectorAll('[data-ng]').forEach(function (t) {
    t.addEventListener('input', function () {
      S.ngNotes[t.dataset.ng] = t.value;
    });
  });

  app.querySelectorAll('[data-staff]').forEach(function (b) {
    b.addEventListener('click', function () {
      S.staff = b.dataset.staff;
      keepScroll(render);
    });
  });

  const free = document.getElementById('staff-free');
  if (free) {
    free.addEventListener('input', function () {
      S.staff = free.value;
    });
  }

  const note = document.getElementById('note');
  note.addEventListener('input', function () {
    S.note = note.value;
  });

  document.getElementById('form').addEventListener('submit', function (e) {
    e.preventDefault();
    submit();
  });
}

/** 作り直しても、見ていた位置が変わらないようにする */
function keepScroll(fn) {
  const y = window.scrollY;
  fn();
  window.scrollTo(0, y);
}

/* ---------- 送信 ---------- */

function submit() {
  if (S.sending) return;
  const site = S.site;
  const items = itemsFor(site, S.timing);

  /* 入れ忘れがないか確かめる */
  const missing = items.filter(function (it) {
    return !isFilled(it, S.values[it.id]);
  });
  if (missing.length) {
    focusCard(missing[0].id);
    toast('「' + missing[0].name + '」がまだ入っていません', { type: 'error' });
    return;
  }

  const noNote = items.filter(function (it) {
    return ngNeeded(it, S.values[it.id]) && !String(S.ngNotes[it.id] || '').trim();
  });
  if (noNote.length) {
    focusCard(noNote[0].id);
    toast('「' + noNote[0].name + '」の対応を書いてください', { type: 'error' });
    return;
  }

  if (!String(S.staff || '').trim()) {
    toast('記録した人を選んでください', { type: 'error' });
    return;
  }

  /* 「否」の対応を、ひとつの文にまとめる。月次表の特記事項に出る */
  const ngNote = items
    .filter(function (it) {
      return ngNeeded(it, S.values[it.id]);
    })
    .map(function (it) {
      const head = (it.no ? it.no + ' ' : '') + it.short;
      return head + '：' + String(S.ngNotes[it.id] || '').trim();
    })
    .join(' ／ ');

  /* 送る形にまとめる。値は文字と数字だけにしておく */
  const values = {};
  items.forEach(function (it) {
    const v = S.values[it.id];
    if (it.type === 'temp') values[it.id] = num(v);
    else values[it.id] = v == null ? '' : String(v);
  });

  const payload = {
    action: 'submit',
    clientId: deviceId() + '-' + Date.now().toString(36),
    site: site.key,
    siteName: site.name,
    date: S.date,
    timing: S.timing,
    timingLabel: timingLabel(S.timing, site),
    staff: String(S.staff).trim(),
    kind: S.editing ? '訂正' : '記録',
    targetId: S.editing ? S.editing.id : '',
    values: values,
    ngNote: ngNote,
    note: String(S.note || '').trim(),
  };

  lsSet('wasabi-hygiene:staff', payload.staff);
  send(payload);
}

async function send(payload) {
  S.sending = true;
  render();
  try {
    await apiPost(payload);
    S.sending = false;
    closeForm();
    toast('記録しました');
    refresh();
  } catch (err) {
    S.sending = false;
    if (err.temporary) {
      // 電波のせい。端末にためて、あとで自動で送る
      outboxAdd(payload);
      closeForm();
      toast('電波が届かないので、この端末に保存しました。つながったら自動で送ります', {
        timeout: 9000,
      });
    } else {
      render();
      toast(err.message || '送信できませんでした', { type: 'error' });
    }
  }
}

function focusCard(id) {
  const el = app.querySelector('[data-card="' + id + '"]');
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('shake');
  setTimeout(function () {
    el.classList.remove('shake');
  }, 600);
}

/* ---------- ヘッダー ---------- */

function head(site) {
  const h = document.getElementById('head');
  h.innerHTML =
    '<div class="head-top">' +
    '<h1>衛生記録<span class="head-sub">' +
    esc(site ? site.name : 'TOKYO WASABI') +
    '</span></h1>' +
    (site && S.screen !== 'form'
      ? '<button type="button" class="icon-btn" id="reload" aria-label="最新の状態に読み込み直す">' +
        icon('refresh') +
        '</button>'
      : '') +
    '</div>';

  const r = document.getElementById('reload');
  if (r) {
    r.addEventListener('click', function () {
      r.classList.add('spin');
      refresh();
    });
  }
}

/* ---------- 電波が戻ったら、ためてある記録を送る ---------- */

window.addEventListener('online', function () {
  outboxFlush(false).then(function (n) {
    if (n && S.screen === 'home') refresh();
  });
});

boot();
