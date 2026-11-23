// Service Worker（アプリとしてインストールできるようにするのと、電波が無いときに画面だけでも開けるように）
// 画面のファイルを変えたら CACHE_NAME の数を上げる（上げないと古い画面のままになることがある）
const CACHE_NAME = 'kashikari-v5';
const APP_SHELL = ['./', './index.html', './style.css', './firebase-config.js', './store.js', './ledger.js', './app-bridge.js', './kakeibo.js', './app.js', './manifest.json', './icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('kashikari-') && k !== CACHE_NAME).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// 同じサイトのファイルは、まずネットから（新しいものを使う）。つながらないときだけ覚えておいたもの
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || !u.pathname.includes('/kashikari/')) return;
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE_NAME).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))));
});
