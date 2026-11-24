// --- Android アプリ（android/ の WebView 版）とのやりとり（航海日誌の app-bridge.js と同じしくみ）---
// ・アプリの中で開いているときだけ window.KashikariApp がある（MainActivity.java の Bridge）
// ・ホーム画面のウィジェットに、返ってくる予定・返す予定・届いた「返したよ」を渡す（KashikariApp.setWidgetData）
// ・ウィジェットから開いたとき（「返したよ」を見る など）は window.__kashikariOpen(view) が呼ばれる
// 依存: ledger.js

// 公開している APK の versionCode（android/app/build.gradle と同じ数。作り直したら上げる）
const ANDROID_APK_CODE = 7;
const ANDROID_APK_URL = 'https://github.com/susuruchachi/susuru-obenri-tools/raw/main/apk/kashikari.apk';
const ANDROID_APK_SELF_URL = new URL('../apk/kashikari.apk', window.location.href.split(/[?#]/)[0].replace(/[^/]*$/, '')).toString();
// いちばん新しい版の情報（{ code, name, date, notes }）。「更新を確認する」で毎回読む（古い画面が残っていても正しくわかるように）
const ANDROID_VERSION_URL = new URL('../apk/version.json', window.location.href.split(/[?#]/)[0].replace(/[^/]*$/, '')).toString();

function kkIsApp() { return !!(window.KashikariApp && window.KashikariApp.setWidgetData); }
// 入っているアプリの版（アプリの外では null）
function kkAppVersion() {
  try { return kkIsApp() ? { code: window.KashikariApp.versionCode ? window.KashikariApp.versionCode() : 0, name: window.KashikariApp.version ? window.KashikariApp.version() : '' } : null; } catch (e) { return null; }
}
let kkLatest = { code: ANDROID_APK_CODE, name: '', date: '', notes: [], checkedAt: 0, error: '' };
function kkAppOutdated() {
  const v = kkAppVersion();
  return !!(v && v.code && v.code < kkLatest.code);
}
// apk/version.json を読む（読めなくても ANDROID_APK_CODE で比べられる）
async function kkFetchLatest() {
  try {
    const r = await fetch(ANDROID_VERSION_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const code = Math.max(+j.code || 0, ANDROID_APK_CODE);
    kkLatest = { code, name: +j.code === code ? String(j.name || '') : '', date: String(j.date || ''), notes: Array.isArray(j.notes) ? j.notes.map(String).slice(0, 10) : [], checkedAt: Date.now(), error: '' };
  } catch (e) {
    kkLatest = { ...kkLatest, checkedAt: Date.now(), error: '新しい版の情報を読めませんでした（' + (e.message || e) + '）' };
  }
  kkApkEmit();
  return kkLatest;
}

// ウィジェットに渡すもの：
//   inSum / outSum … 返ってくる予定・返す予定の合計（みんなの帳簿ぜんぶ＋自分だけの帳簿）
//   lines … 相手ごとの差し引き [{ n: 名前, d: 'in'|'out', a: 金額 }]（大きい順に8つまで）
//   claims … 認めるのを待っている「返したよ」の数（自分が貸した分）
//   due … 返す期限：{ over: 期限すぎの数, soon: 7日以内の数, next: { d, who, amt, due, days } }（無ければ null）
function kkBuildWidgetData(st) {
  const me = st.user && st.user.uid;
  if (!me) return { signedIn: false, at: Date.now() };
  let inSum = 0, outSum = 0, claims = 0;
  const lines = [];
  const many = st.books.length > 1;
  st.books.forEach((b) => {
    KL.myNets(b, st.loans[b.id] || [], me).forEach((x) => {
      inSum += x.lent; outSum += x.borrowed;
      if (!x.net) return;
      lines.push({ n: (b.names[x.id] || 'だれか') + (many ? `（${b.name}）` : ''), d: x.net > 0 ? 'in' : 'out', a: Math.abs(x.net) });
    });
    claims += (st.claims[b.id] || []).filter((c) => c.lender === me && c.status === 'pending').length;
  });
  KL.personalNets(st.personal).forEach((x) => {
    inSum += x.lent; outSum += x.borrowed;
    if (x.net) lines.push({ n: '📒 ' + x.who, d: x.net > 0 ? 'in' : 'out', a: Math.abs(x.net) });
  });
  lines.sort((a, b) => b.a - a.a);
  // 家計簿：今月の支出・収入・予算（{ m: 月, exp, inc, budget } か null）
  let kb = null;
  try { kb = window.__kkKbWidget ? window.__kkKbWidget() : null; } catch (e) {}
  // 返す期限：期限すぎ・7日以内の数と、いちばん近いもの
  let due = null;
  try {
    // 貸し借りの期限と、家計簿の「まだ払っていない後払い」の払う予定の日
    const items = KL.dueItems(st.books, st.loans, st.personal, me).concat(window.__kkKbDue ? window.__kkKbDue() : []).sort((x, y) => x.due.localeCompare(y.due));
    const over = items.filter((x) => x.days < 0).length, soon = items.filter((x) => x.days >= 0 && x.days <= 7).length;
    const n = items[0];
    if (over || soon) due = { over, soon, next: n ? { d: n.d, who: n.who, amt: n.amt, due: n.due, days: n.days } : null };
  } catch (e) {}
  return { signedIn: true, inSum, outSum, lines: lines.slice(0, 8), claims, kb, due, today: KL.today(), at: Date.now() };
}

let _kkWidgetTimer = null, _kkWidgetLast = '';
function kkSendWidget(st) {
  if (!kkIsApp()) return;
  clearTimeout(_kkWidgetTimer);
  _kkWidgetTimer = setTimeout(() => {
    try {
      const d = kkBuildWidgetData(st);
      const key = JSON.stringify({ ...d, at: 0 });
      if (key === _kkWidgetLast) return;
      _kkWidgetLast = key;
      window.KashikariApp.setWidgetData(JSON.stringify(d));
    } catch (e) {}
  }, 500);
}

// 開いたときの URL の ?view=claims / ?view=personal（ウィジェットから）
function kkStartView() {
  try { return new URLSearchParams(window.location.search).get('view') || ''; } catch (e) { return ''; }
}

// ---- アプリの自動更新（航海日誌と同じ）と、「アプリと更新」の画面（1.3.0 から）----
// phase：idle（まだ）・checking（確認中）・downloading（ダウンロード中）・ready（入れ替えの準備ができた）・installing（入れ替え中）・failed（うまくいかなかった）
let kkApk = { ready: false, silent: false, busy: false, phase: 'idle', error: '' };
let _kkApkAsked = 0, _kkApkInstallAfter = false;
function kkApkAuto() { return !!(window.KashikariApp && window.KashikariApp.apkPrepare); }
function kkApkEmit() { try { window.dispatchEvent(new CustomEvent('kashikari-apk', { detail: { ...kkApk } })); } catch (e) {} }
// アプリが覚えている更新のようす（1.3.0 から。前の版では null）
function kkApkStatus() {
  try { return window.KashikariApp && window.KashikariApp.apkStatus ? JSON.parse(window.KashikariApp.apkStatus()) : null; } catch (e) { return null; }
}
// 新しい版があるか確かめて、あればダウンロードする（force：4時間待たずに）
async function kkCheckApkUpdate(force) {
  if (!kkApkAuto() || kkApk.busy) return;
  if (!force && Date.now() - _kkApkAsked < 4 * 3600000) return;
  _kkApkAsked = Date.now();
  kkApk = { ...kkApk, busy: true, phase: 'checking', error: '' }; kkApkEmit();
  await kkFetchLatest();
  if (!kkAppOutdated()) { kkApk = { ...kkApk, busy: false, phase: 'idle' }; kkApkEmit(); return; }
  kkApk = { ...kkApk, phase: 'downloading' }; kkApkEmit();
  try { window.KashikariApp.apkPrepare(ANDROID_APK_SELF_URL, kkLatest.code); }
  catch (e) { kkApk = { ...kkApk, busy: false, phase: 'failed', error: 'ダウンロードを始められませんでした' }; kkApkEmit(); }
}
window.__kashikariApkReady = function (ok, silent) {
  const st = kkApkStatus();
  kkApk = { ready: !!ok, silent: !!silent, busy: false, phase: ok ? 'ready' : 'failed', error: ok ? '' : ((st && st.error) || 'ダウンロードできませんでした。電波のよいところで「更新を確認する」を押してください') };
  if (ok && _kkApkInstallAfter) { _kkApkInstallAfter = false; kkApk.phase = 'installing'; window.KashikariApp.apkInstallNow(); }
  kkApkEmit();
};
// 「更新する」：ダウンロード済みなら入れる（確認の画面が出る）。まだならダウンロードしてから
function kkInstallApk() {
  if (!kkApkAuto()) { kkOpenApkInBrowser(); return; }
  try {
    if (window.KashikariApp.apkReady()) { kkApk = { ...kkApk, phase: 'installing', error: '' }; kkApkEmit(); window.KashikariApp.apkInstallNow(); setTimeout(kkApkRecheck, 4000); }
    else { _kkApkInstallAfter = true; kkCheckApkUpdate(true); }
  } catch (e) {}
}
// 入れ替えを頼んだあと、うまくいかなかったか（アプリが覚えている理由）を見直す
function kkApkRecheck() {
  const st = kkApkStatus();
  if (st && st.error && kkApk.phase === 'installing') { kkApk = { ...kkApk, phase: 'failed', error: st.error }; kkApkEmit(); }
}
// うまくいかないとき：ブラウザで APK をダウンロードして、自分で入れる（アプリの外のブラウザで開く）
function kkOpenApkInBrowser() { window.open(ANDROID_APK_URL, '_blank'); }
// 「アプリと更新」の画面に出すもの
function kkApkInfo() {
  return { inApp: kkIsApp(), auto: kkApkAuto(), current: kkAppVersion(), latest: { ...kkLatest }, outdated: kkAppOutdated(), apk: { ...kkApk }, status: kkApkStatus() };
}
// 書いている途中は、裏に回っても入れ替えない
function kkApkSetIdle(idle) { try { if (window.KashikariApp && window.KashikariApp.apkSetIdle) window.KashikariApp.apkSetIdle(!!idle); } catch (e) {} }
if (kkApkAuto()) {
  setTimeout(() => kkCheckApkUpdate(false), 3000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { kkCheckApkUpdate(false); kkApkRecheck(); } });
}
// ---- Android アプリのダウンロード（ブラウザで開いたときだけ）----
// Android の端末では上に大きく出す（×で閉じると、この端末では次から下の小さいリンクだけ）。ほかの端末では下に小さく
(function () {
  if (kkIsApp()) return;
  const card = document.getElementById('getApp'), foot = document.getElementById('getAppFoot');
  if (!card || !foot) return;
  let closed = false;
  try { closed = localStorage.getItem('kashikari-getapp-closed') === '1'; } catch (e) {}
  const android = /Android/i.test(navigator.userAgent || '');
  card.hidden = !(android && !closed);
  foot.hidden = !card.hidden;
  document.getElementById('getAppClose').addEventListener('click', () => {
    try { localStorage.setItem('kashikari-getapp-closed', '1'); } catch (e) {}
    card.hidden = true; foot.hidden = false;
  });
})();
