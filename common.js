/* ===========================================================
   TOKYO WASABI 衛生記録 ― 共通部品
   index.html / admin.html の両方から読み込む

   このファイルの前半は「何を記録するか」の定義です。
   保健所に出している衛生管理計画を、そのまま写してあります。
   計画を変えたときは、ここと gas/Code.gs の COLUMNS を直してください。
   =========================================================== */
'use strict';

/* Apps Script のウェブアプリ URL（JSON API）。
   GAS を作り直して URL が変わったときは、ここだけ書き換える */
const ENDPOINT =
  'https://script.google.com/macros/s/AKfycbzocHPiaEV63BaW-RVI7aC1mo3ZNlkTOn75Jff__MgBM3kxYncrk4p1FuOSdui5AHfMHw/exec';

/* 合言葉。'' のままなら、URL を知っている人は誰でも記録・閲覧できる。
   あとで制限したくなったら、ここと Code.gs の ACCESS_KEY に
   同じ文字を入れるだけでよい */
const ACCESS_KEY = '';

/* ---------- 拠点 ----------
   plan は、どちらの衛生管理計画に沿うか。
   factory = 漬物製造およびそうざい製造 / shokudo = 一般飲食店 */

const SITES = [
  { key: 'factory', name: '工場', sub: '漬物・そうざい製造', plan: 'factory' },
  { key: 'ken', name: 'わさび食堂（牽引）', sub: 'キッチンカー', plan: 'shokudo' },
  { key: 'jiso', name: 'わさび食堂（自走）', sub: 'キッチンカー', plan: 'shokudo' },
];

const SITE_BY_KEY = SITES.reduce(function (m, s) {
  m[s.key] = s;
  return m;
}, {});

/* 記録のタイミング。工場は「作業」、キッチンカーは「営業」と呼び分ける */
const TIMINGS = [
  { key: 'before', label: { factory: '作業前', shokudo: '営業前' } },
  { key: 'after', label: { factory: '作業後', shokudo: '営業後' } },
];

/** timingLabel('before', site) → '営業前' */
function timingLabel(timingKey, site) {
  const t = TIMINGS.filter(function (x) {
    return x.key === timingKey;
  })[0];
  if (!t) return String(timingKey || '');
  return t.label[(site && site.plan) || 'shokudo'];
}

/* ---------- 記録する項目 ----------

   id       … データの列を決める名前。あとから変えないこと
   no       … 衛生管理計画での番号（① ③-1 など）
   group    … 'ippan'（一般的衛生管理） / 'juyo'（重要管理）
   name     … 項目名
   type     … 'good'   良・否
               'goodNA' 良・否・該当なし（納入がない日、作らなかった日など）
               'temp'   温度（℃の数値）
               'text'   自由記入
   when     … 'before' / 'after' … どちらの画面に出すか
   plans    … どの衛生管理計画にある項目か
   whenText … 計画の「いつ」
   how      … 計画の「どのように」
   ng       … 計画の「問題があったとき」
   menu     … 重要管理の「メニュー」

   how / ng / menu は、計画ごとに文面が違うものだけ
   { factory: '…', shokudo: '…' } の形で書く */

const ITEMS = [
  /* ===== 一般的衛生管理のポイント ===== */

  {
    id: 'uke',
    no: '①',
    group: 'ippan',
    when: 'before',
    name: '原材料の受入の確認',
    short: '原材料の受入',
    type: 'goodNA',
    naLabel: '納入なし',
    plans: ['factory', 'shokudo'],
    whenText: '原材料の納入時',
    how: '外観、におい、包装の状態、表示（期限・保存方法）、品温などを確認する。',
    ng: '廃棄する。',
  },
  {
    id: 'reizo',
    no: '②',
    group: 'ippan',
    when: 'before',
    name: '庫内温度の確認（冷蔵庫）',
    short: '冷蔵庫',
    type: 'temp',
    limit: 5,
    limitText: '5℃以下',
    plans: ['factory', 'shokudo'],
    whenText: '始業前',
    how: '温度計で庫内温度を確認する（冷蔵：5℃以下）。',
    ng: '設定温度や原因を確認するなどして改善する。適正な温度を超えていた場合は、食材の状態を確認する。',
  },
  {
    id: 'reito',
    no: '②',
    group: 'ippan',
    when: 'before',
    name: '庫内温度の確認（冷凍庫）',
    short: '冷凍庫',
    type: 'temp',
    limit: -15,
    limitText: '-15℃以下',
    plans: ['factory'],
    whenText: '始業前',
    how: '温度計で庫内温度を確認する（冷凍：-15℃以下）。',
    ng: '設定温度や原因を確認するなどして改善する。適正な温度を超えていた場合は、食材の状態を確認する。',
  },
  {
    id: 'kenko',
    no: '④-1',
    group: 'ippan',
    when: 'before',
    name: '従業員の健康管理等',
    short: '健康管理',
    type: 'good',
    plans: ['factory', 'shokudo'],
    whenText: '始業前',
    how: '従事者の体調（下痢、嘔吐、発熱など）を確認する。手の傷の有無を確認する。',
    ng: '医療機関で受診し、食品に触れる作業をしない。傷を保護した後、ビニール手袋などを装着する。',
  },
  {
    id: 'tearai',
    no: '④-2',
    group: 'ippan',
    when: 'before',
    name: '手洗いの実施',
    short: '手洗い',
    type: 'good',
    plans: ['factory', 'shokudo'],
    whenText:
      '始業時、トイレの後、作業内容変更時、生肉や生魚などを扱った後、金銭をさわった後、清掃を行った後',
    how: '手洗い設備で衛生的な手洗いを実施する。',
    ng: '手洗いの方法やタイミングが不適切な場合は十分な手洗いを実施する。',
  },
  {
    id: 'kosa',
    no: '③-1',
    group: 'ippan',
    when: 'after',
    name: '交差汚染・二次汚染の防止',
    short: '交差汚染の防止',
    type: 'good',
    plans: ['factory', 'shokudo'],
    whenText: '作業中',
    how: '器具などの用途別使用を確認する。冷蔵庫内の区分、保管を確認する。',
    ng: '器具などの洗浄、消毒を実施する。',
  },
  {
    id: 'kigu',
    no: '③-2',
    group: 'ippan',
    when: 'after',
    name: '器具等の洗浄・消毒・殺菌',
    short: '器具の洗浄・消毒',
    type: 'good',
    plans: ['factory', 'shokudo'],
    whenText: '使用の都度',
    how: '使用した器具などは、洗浄・消毒する。',
    ng: '汚れや洗剤などが残っていた場合は再度洗浄・すすぎ・消毒を行う。',
  },
  {
    id: 'toilet',
    no: '③-3',
    group: 'ippan',
    when: 'after',
    name: 'トイレの洗浄・消毒',
    short: 'トイレの洗浄・消毒',
    type: 'good',
    plans: ['factory'],
    whenText: '業務終了後',
    how: 'エプロンや作業着を脱いで、洗浄・消毒する（グローブを装着する）。便座、水洗レバー、ドアノブなどを消毒する。',
    ng: 'トイレが汚れていた場合は、洗剤で洗浄し、消毒する。',
  },
  {
    id: 'haiki',
    no: '追加',
    group: 'ippan',
    when: 'after',
    name: '廃棄物の取扱い',
    short: '廃棄物の取扱い',
    type: 'good',
    plans: ['factory'],
    whenText: '業務終了後',
    how: 'ゴミ捨てを行い、周囲を清掃する。',
    ng: '再清掃を行う。',
  },

  /* ===== ⑤ 重要管理のポイント ===== */

  {
    id: 'kj1',
    no: '第1',
    group: 'juyo',
    when: 'after',
    name: '非加熱のもの（冷蔵品を冷たいまま提供）',
    short: '非加熱',
    type: 'goodNA',
    naLabel: '扱わなかった',
    plans: ['factory', 'shokudo'],
    menu: {
      factory: '原料一次加工、ピクルス等',
      shokudo: '丼ぶりトッピング（生わさび、ピクルス等）、ローストビーフ',
    },
    how: {
      factory:
        '冷蔵庫で保管する（わさびの葉や茎は室温が10℃以下の時は常温でもOK）。作業前に手洗いを十分に行う。',
      shokudo:
        'わさびは十分に洗浄する。冷蔵庫で保管する。盛り付け前に手洗いを十分に行う（必要に応じてグローブを着用する）。',
    },
    ng: '再加熱する、または廃棄する。',
  },
  {
    id: 'kj2',
    no: '第2',
    group: 'juyo',
    when: 'after',
    name: '加熱するもの（冷蔵品を加熱し、熱いまま提供）',
    short: '加熱',
    type: 'goodNA',
    naLabel: '扱わなかった',
    plans: ['shokudo'],
    menu: { shokudo: '丼ぶり肉（豚肉、牛肉）、ソーセージ、トーストサンド' },
    how: { shokudo: '加熱が十分に行われたことを、見た目（外観、肉汁の色）や食感（弾力）で確認する。' },
    ng: '再加熱する、または廃棄する。',
  },
  {
    id: 'kj2h',
    no: '第2',
    group: 'juyo',
    when: 'after',
    name: '加熱した後、高温保管するもの',
    short: '高温保管',
    type: 'goodNA',
    naLabel: '扱わなかった',
    plans: ['shokudo'],
    menu: { shokudo: 'ソーセージ' },
    how: {
      shokudo: 'すぐに提供できるように鉄板の上に網を敷き、その上にソーセージを置いておく。',
    },
    ng: '再加熱する、または廃棄する。',
  },
  {
    id: 'kj3',
    no: '第3',
    group: 'juyo',
    when: 'after',
    name: '加熱後、冷却するもの',
    short: '加熱後、冷却',
    type: 'goodNA',
    naLabel: '作らなかった',
    plans: ['factory'],
    menu: { factory: 'おにぎり、いなり、ソーセージ' },
    how: {
      factory:
        '加熱および再加熱が十分に行われたことを、見た目（外観、肉汁の色）や食感（弾力）で確認する。',
    },
    ng: '再加熱する、または廃棄する。',
  },
  {
    id: 'seizo',
    no: '',
    group: 'juyo',
    when: 'after',
    name: '製造物',
    short: '製造物',
    type: 'text',
    placeholder: '例）わさび漬け、しぐれ煮、おにぎり',
    plans: ['factory'],
  },
];

const ITEM_BY_ID = ITEMS.reduce(function (m, it) {
  m[it.id] = it;
  return m;
}, {});

/** その拠点・そのタイミングで記録する項目だけを返す（when 省略で全部） */
function itemsFor(site, when) {
  return ITEMS.filter(function (it) {
    if (it.plans.indexOf(site.plan) < 0) return false;
    return !when || it.when === when;
  });
}

/** how / ng / menu は、計画ごとに文面が違うものがある。どちらでも取り出せるように */
function textFor(item, field, site) {
  const v = item[field];
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return v[site.plan] || '';
}

/** 「否」を選べる項目か（自由記入だけは良・否がない） */
function hasNg(item) {
  return item.type !== 'text';
}

/* ---------- 小道具 ---------- */

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/** 空文字・null は null に。数値にできなければ null */
function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const WDAY = ['日', '月', '火', '水', '木', '金', '土'];

/** Date → '2026-09-21'（端末の日付をそのまま使う） */
function ymd(d) {
  const p = function (n) {
    return String(n).padStart(2, '0');
  };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/** '2026-09-21' → '9月21日（日）' */
function dateLabel(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return String(s || '');
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number(m[2]) + '月' + Number(m[3]) + '日（' + WDAY[d.getDay()] + '）';
}

/** 今日 / 昨日 の 'YYYY-MM-DD' */
function todayYmd() {
  return ymd(new Date());
}
function yesterdayYmd() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return ymd(d);
}

/** この端末を見分ける ID。二重送信を防ぐのに使う */
function deviceId() {
  let id = null;
  try {
    id = localStorage.getItem('wasabi-hygiene:device');
  } catch (e) {
    /* 保存できない設定の端末でも動くようにする */
  }
  if (!id) {
    id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    try {
      localStorage.setItem('wasabi-hygiene:device', id);
    } catch (e) {
      /* 保存できなければ、その場かぎりの ID として使う */
    }
  }
  return id;
}

/* localStorage は端末の設定によっては使えない。落ちないように包んでおく */
function lsGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}
function lsSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------- アイコン（インライン SVG の線画） ---------- */

const ICON_PATHS = {
  check: '<path d="M4.8 12.6 9.6 17.4 19.2 6.6"/>',
  clipboard:
    '<path d="M9.2 4.3H7.4A1.4 1.4 0 0 0 6 5.7v12.9A1.4 1.4 0 0 0 7.4 20h9.2a1.4 1.4 0 0 0 1.4-1.4V5.7a1.4 1.4 0 0 0-1.4-1.4h-1.8"/><rect x="9" y="2.7" width="6" height="3.2" rx="1.1"/><path d="M9.3 12.7l2 2 3.5-3.9"/>',
  sunrise:
    '<path d="M12 3.4v3.2"/><path d="M5.6 9.1 7.8 11.3"/><path d="M18.4 9.1 16.2 11.3"/><path d="M2.8 17.2h18.4"/><path d="M6.6 17.2a5.4 5.4 0 0 1 10.8 0"/><path d="M5.2 20.6h13.6"/>',
  sunset:
    '<path d="M12 6.6V3.4"/><path d="M5.6 9.1 7.8 11.3"/><path d="M18.4 9.1 16.2 11.3"/><path d="M2.8 17.2h18.4"/><path d="M6.6 17.2a5.4 5.4 0 0 1 10.8 0"/><path d="M5.2 20.6h13.6"/><path d="M9.4 5 12 7.6 14.6 5"/>',
  alert: '<path d="M12 3.6 21.2 19.4H2.8L12 3.6Z"/><path d="M12 9.6v4.1"/><path d="M12 16.5h.01"/>',
  clock: '<circle cx="12" cy="12" r="8.7"/><path d="M12 6.8v5.4l3.4 2"/>',
  thermo:
    '<path d="M14 14.8V5.4a2 2 0 1 0-4 0v9.4a4 4 0 1 0 4 0Z"/><path d="M12 17.6h.01"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  refresh: '<path d="M20.2 12a8.2 8.2 0 1 1-2.4-5.8"/><path d="M20.4 4.4v4.4H16"/>',
  print:
    '<path d="M6.6 9.4V3.6h10.8v5.8"/><path d="M6.6 18.2H4.8A1.8 1.8 0 0 1 3 16.4v-5.2a1.8 1.8 0 0 1 1.8-1.8h14.4a1.8 1.8 0 0 1 1.8 1.8v5.2a1.8 1.8 0 0 1-1.8 1.8h-1.8"/><rect x="6.6" y="14.6" width="10.8" height="5.8" rx="1"/>',
  download: '<path d="M12 3.6v11"/><path d="M7.6 10.2 12 14.6l4.4-4.4"/><path d="M4 18.4h16"/>',
  cloud:
    '<path d="M7.2 18.4A4.2 4.2 0 0 1 7.6 10a5.6 5.6 0 0 1 10.7 1.5 3.6 3.6 0 0 1-.7 7h-10Z"/>',
};

function icon(name) {
  const d = ICON_PATHS[name] || ICON_PATHS.check;
  return (
    '<svg class="svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    d +
    '</svg>'
  );
}

/* ---------- 通信 ---------- */

/** 電波や GAS 側の一時的な不調が原因のエラーに印をつける */
function tempError(message) {
  const e = new Error(message);
  e.temporary = true;
  return e;
}

async function readJson(res) {
  // GAS は script.googleusercontent.com に転送されるとき、たまに 404 を返す。
  // 中身が壊れているわけではないので、こういうものは「一時的」として送り直す
  if (!res.ok) throw tempError('サーバーエラー（' + res.status + '）');
  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw tempError('サーバーの応答を読み取れませんでした');
  }
  // GAS が ok:false を返したときは内容の問題。何度送っても同じなので送り直さない
  if (!data || data.ok !== true) {
    throw new Error((data && data.error) || '処理に失敗しました');
  }
  return data;
}

const sleep = function (ms) {
  return new Promise(function (r) {
    setTimeout(r, ms);
  });
};

/** 一時的な失敗のときだけ、少し待って送り直す */
async function withRetry(send, tries) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await send();
    } catch (err) {
      last = err;
      if (!err.temporary || i === tries - 1) throw err;
      await sleep(400 + i * 900);
    }
  }
  throw last;
}

/** 読み込み。読むだけなので何度でも送り直してよい */
async function apiGet(params) {
  const q = new URLSearchParams(params);
  if (ACCESS_KEY) q.set('key', ACCESS_KEY);
  return withRetry(async function () {
    let res;
    try {
      res = await fetch(ENDPOINT + '?' + q.toString(), { method: 'GET' });
    } catch (e) {
      throw tempError('通信できませんでした。電波の状態を確認してください');
    }
    return readJson(res);
  }, 3);
}

/** 書き込み。CORS のプリフライトを避けるため text/plain + JSON 文字列
 *
 *  記録の送信は、同じ clientId なら GAS 側が二重に足さないようにしてあるので、
 *  電波が悪くて返事が来なかったときも、そのまま送り直してよい */
async function apiPost(payload) {
  if (ACCESS_KEY) payload.key = ACCESS_KEY;
  return withRetry(async function () {
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      throw tempError('通信できませんでした。電波の状態を確認してください');
    }
    return readJson(res);
  }, 2);
}

/* ---------- トースト（画面下に出る短い知らせ） ---------- */

let toastRoot = null;

function toast(message, opts) {
  opts = opts || {};
  if (!toastRoot) {
    toastRoot = document.createElement('div');
    toastRoot.className = 'toasts';
    toastRoot.setAttribute('role', 'status');
    toastRoot.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastRoot);
  }

  const el = document.createElement('div');
  el.className = 'toast' + (opts.type === 'error' ? ' toast-error' : '');

  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = message;
  el.appendChild(text);

  let timer = null;
  const close = function () {
    if (timer) clearTimeout(timer);
    el.classList.add('out');
    setTimeout(function () {
      el.remove();
    }, 220);
  };

  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'toast-close';
  x.setAttribute('aria-label', '閉じる');
  x.innerHTML = icon('x');
  x.addEventListener('click', close);
  el.appendChild(x);

  toastRoot.appendChild(el);
  timer = setTimeout(close, opts.timeout || 4500);
  return close;
}

/* ---------- 何かで落ちたときに、原因を画面に出す ---------- */

/* 端末によっては、こちらで再現できない理由で止まることがある。
   画面が真っ白になると「エラーになった」以上のことが分からないので、
   赤い帯で中身を出し、撮って送ってもらえるようにしておく */

function showFatal(message, where) {
  try {
    const put = function () {
      if (document.getElementById('fatal')) return; // 最初の1件だけ出す
      const d = document.createElement('div');
      d.id = 'fatal';
      d.className = 'fatal';
      const t = document.createElement('b');
      t.textContent = 'アプリでエラーが起きました';
      const p = document.createElement('p');
      p.textContent = 'この画面を撮って Momo に送ってください。';
      const c = document.createElement('code');
      c.textContent = String(message || '不明なエラー') + (where ? '\n' + where : '');
      d.appendChild(t);
      d.appendChild(p);
      d.appendChild(c);
      document.body.appendChild(d);
    };
    if (document.body) put();
    else document.addEventListener('DOMContentLoaded', put);
  } catch (e) {
    /* ここで失敗したら打つ手がない */
  }
}

window.addEventListener('error', function (e) {
  if (!e || !e.message) return;
  const file = String(e.filename || '').split('/').pop();
  showFatal(e.message, file ? file + ' ' + e.lineno + '行目' : '');
});

/* ---------- ホーム画面に追加できるようにする ---------- */

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () {
      /* 登録できなくてもアプリは普通に動くので、何も知らせない */
    });
  });
}
