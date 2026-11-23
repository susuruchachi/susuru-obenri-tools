// --- Android アプリ（android/ の WebView 版）とのやりとり（航海日誌の app-bridge.js と同じしくみ）---
// ・アプリの中で開いているときだけ window.KashikariApp がある（MainActivity.java の Bridge）
// ・ホーム画面のウィジェットに、返ってくる予定・返す予定・届いた「返したよ」を渡す（KashikariApp.setWidgetData）
// ・ウィジェットから開いたとき（「返したよ」を見る など）は window.__kashikariOpen(view) が呼ばれる
// 依存: ledger.js

// 公開している APK の versionCode（android/app/build.gradle と同じ数。作り直したら上げる）
const ANDROID_APK_CODE = 2;
const ANDROID_APK_URL = 'https://github.com/susuruchachi/susuru-obenri-tools/raw/main/apk/kashikari.apk';
const ANDROID_APK_SELF_URL = new URL('../apk/kashikari.apk', window.location.href.split(/[?#]/)[0].replace(/[^/]*$/, '')).toString();

function kkIsApp() { return !!(window.KashikariApp && window.KashikariApp.setWidgetData); }
function kkAppOutdated() {
  try { return kkIsApp() && window.KashikariApp.versionCode && window.KashikariApp.versionCode() < ANDROID_APK_CODE; } catch (e) { return false; }
}

// ウィジェットに渡すもの：
//   inSum / outSum … 返ってくる予定・返す予定の合計（みんなの帳簿ぜんぶ＋自分だけの帳簿）
//   lines … 相手ごとの差し引き [{ n: 名前, d: 'in'|'out', a: 金額 }]（大きい順に8つまで）
//   claims … 認めるのを待っている「返したよ」の数（自分が貸した分）
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
  return { signedIn: true, inSum, outSum, lines: lines.slice(0, 8), claims, today: KL.today(), at: Date.now() };
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

// ---- アプリの自動更新（航海日誌と同じ）----
let kkApk = { ready: false, silent: false, busy: false };
let _kkApkAsked = 0, _kkApkInstallAfter = false;
function kkApkAuto() { return !!(window.KashikariApp && window.KashikariApp.apkPrepare); }
function kkApkEmit() { try { window.dispatchEvent(new CustomEvent('kashikari-apk', { detail: { ...kkApk } })); } catch (e) {} }
function kkCheckApkUpdate(force) {
  if (!kkApkAuto() || !kkAppOutdated() || kkApk.busy) return;
  if (!force && Date.now() - _kkApkAsked < 4 * 3600000) return;
  _kkApkAsked = Date.now();
  kkApk.busy = true;
  try { window.KashikariApp.apkPrepare(ANDROID_APK_SELF_URL, ANDROID_APK_CODE); } catch (e) { kkApk.busy = false; }
}
window.__kashikariApkReady = function (ok, silent) {
  kkApk = { ready: !!ok, silent: !!silent, busy: false };
  if (ok && _kkApkInstallAfter) { _kkApkInstallAfter = false; window.KashikariApp.apkInstallNow(); }
  kkApkEmit();
};
function kkInstallApk() {
  if (!kkApkAuto()) { window.open(ANDROID_APK_URL, '_blank'); return; }
  try {
    if (window.KashikariApp.apkReady()) window.KashikariApp.apkInstallNow();
    else { _kkApkInstallAfter = true; kkCheckApkUpdate(true); }
  } catch (e) {}
}
// 書いている途中は、裏に回っても入れ替えない
function kkApkSetIdle(idle) { try { if (window.KashikariApp && window.KashikariApp.apkSetIdle) window.KashikariApp.apkSetIdle(!!idle); } catch (e) {} }
if (kkApkAuto()) {
  setTimeout(() => kkCheckApkUpdate(false), 3000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') kkCheckApkUpdate(false); });
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
