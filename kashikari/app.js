// --- 貸し借り帳の画面 ---
// 依存: store.js（KStore）, ledger.js（KL）, app-bridge.js
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const { yen, today, shareStat, entryStat } = KL;
  const fmtDate = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); if (!m) return ''; const d = new Date(+m[1], +m[2] - 1, +m[3]); return `${+m[2]}/${+m[3]}(${'日月火水木金土'[d.getDay()]})`; };
  const fmtDateY = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? `${m[1]}年${+m[2]}月${+m[3]}日` : ''; };
  const toInt = (s) => {
    const t = String(s ?? '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[^\d]/g, '');
    return t ? Math.min(parseInt(t, 10), 1e10) : 0;
  };
  const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const okDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; };

  // ---------- 画面の状態 ----------
  const U = {
    tab: store('kashikari-tab') === 'personal' ? 'personal' : 'shared',
    bookId: store('kashikari-book') || '',
    sub: 'summary', filter: 'all', showDone: false, pFilter: 'all', pShowDone: false,
    sheet: null, repay: null, claimForm: null, confirm: null,
    login: { email: '', pw: '', create: false, err: '', busy: false },
    pendingJoin: '', apk: { ready: false, silent: false },
    cardId: '', cardMonth: '', // 💳 カード：えらんでいるカードと月
  };
  let S = KStore.state();
  // 自分の帳簿（家計簿）：kakeibo.js
  const KB = Kakeibo({ esc: (v) => esc(v), yen: (n) => yen(n), today: () => today(), toast: (m, b) => toast(m, b), run: (p, m) => run(p, m), S: () => S, U: () => U,
    openSheet: (k, x) => openSheet(k, x), closeSheet: () => closeSheet(), drawSheet: () => drawSheet(), sheetErr: (m) => sheetErr(m), foot: (l, x) => foot(l, x) });
  window.__kkKbWidget = () => KB.widget();
  window.__kkKbDue = () => KB.dueItems();

  // ?join=帳簿ID（招待リンク）
  try {
    const q = new URLSearchParams(location.search);
    const j = q.get('join') || sessionStorage.getItem('kashikari-join') || '';
    if (/^[A-Za-z0-9]{10,40}$/.test(j)) { U.pendingJoin = j; sessionStorage.setItem('kashikari-join', j); }
    if (q.has('join')) { q.delete('join'); history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash); }
    const v = kkStartView();
    if (v === 'personal') U.tab = 'personal';
    if (v === 'claims') { U.tab = 'shared'; U.sub = 'summary'; }
  } catch (e) {}

  // ---------- 便利 ----------
  const me = () => S.user && S.user.uid;
  const book = () => S.books.find((b) => b.id === U.bookId) || S.books[0] || null;
  const loansOf = (b) => (b ? S.loans[b.id] || [] : []);
  const claimsOf = (b) => (b ? S.claims[b.id] || [] : []);
  const nameIn = (b, id) => (b && b.names[id]) || 'だれか';
  const nameH = (b, id) => esc(nameIn(b, id)) + (id === me() ? '<span class="faint">（あなた）</span>' : '');
  const defaultNick = () => { const u = S.user || {}; return (u.name || (u.email || '').split('@')[0] || '').slice(0, 20); };
  const sortByDate = (a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0);
  const myLoan = (id) => loansOf(book()).find((l) => l.id === id && l.lender === me());
  // 返す期限
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dueTag = (due, rest) => {
    if (!due || !rest) return '';
    const n = KL.daysLeft(due);
    const t = n < 0 ? `期限すぎ（${-n}日）` : n === 0 ? '今日が期限' : `あと${n}日`;
    return `<span class="tag ${n < 0 ? 'due' : n <= 3 ? 'part' : 'soft'}">⏰ ${esc(fmtDate(due))}・${t}</span>`;
  };
  const dueField = (X, label) => `<div class="field"><label for="sh-due">${label || '返す期限（なくてもOK）'}</label>
    <div class="row"><input id="sh-due" type="date" class="plain-input due-input" data-bind="sheet.due" value="${esc(X.due || '')}">
    <button type="button" class="pillbtn" data-act="due-set" data-v="7">1週間後</button><button type="button" class="pillbtn" data-act="due-set" data-v="14">2週間後</button>
    <button type="button" class="pillbtn" data-act="due-set" data-v="end">月末</button>${X.due ? '<button type="button" class="pillbtn" data-act="due-set" data-v="">なし</button>' : ''}</div></div>`;
  // 期限の一覧（まとめに出す）
  const dueList = (items, withBook) => !items.length ? '' : `<h3 class="sec-title"><span class="mark">⏰</span> 返す期限</h3><ul class="lines">${items.slice(0, 8).map((x) =>
    `<li><div class="who">${x.d === 'in' ? `${esc(x.who)}<span class="arrow">→</span>あなた` : `あなた<span class="arrow">→</span>${esc(x.who)}`}<small>${esc(x.title || '（内容なし）')}${withBook && x.book ? '・' + esc(x.book) : ''}</small>${dueTag(x.due, x.amt)}</div><div class="amt ${x.d}">${yen(x.amt)}</div></li>`).join('')}</ul>${items.length > 8 ? `<p class="hint">ほか ${items.length - 8}件</p>` : ''}`;
  // 肩代わりできる借り（ほかの人どうしの、まだ返っていない分。返したよの確認待ちは除く）
  function coverCandidates(b) {
    const out = [];
    const pend = claimsOf(b).filter((c) => c.status === 'pending');
    loansOf(b).forEach((l) => {
      if (l.lender === me()) return;
      l.shares.forEach((s) => {
        const r = shareStat(s).rest;
        if (!r || s.to === me() || s.to === l.lender) return;
        if (pend.some((c) => c.loanId === l.id && (c.for || c.from) === s.to)) return;
        out.push({ l, s, rest: r });
      });
    });
    return out.sort((x, y) => (x.l.date || '').localeCompare(y.l.date || ''));
  }

  function errText(e) {
    const c = (e && e.code) || '';
    if (c === 'permission-denied') return '書けませんでした（この記録を変えてよい人ではないか、Firestore のルールがまだ入っていません）';
    if (c === 'app/not-signed-in') return 'ログインしてください';
    if (c === 'not-found') return 'その記録はもうありません（ほかの端末で消されたかも）';
    if (c === 'unavailable') return 'つながりません。電波のよいところでもう一度';
    return `うまくいきませんでした（${c || (e && e.message) || '原因不明'}）`;
  }
  function run(p, okMsg) {
    if (okMsg) toast(okMsg);
    return Promise.resolve(p).then(() => true, (e) => { console.error(e); toast(errText(e), true); return false; });
  }
  let toastTimer = 0;
  function toast(msg, bad) {
    const t = $('#toast');
    t.textContent = msg; t.classList.toggle('bad', !!bad); t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, bad ? 5000 : 2400);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('✓ コピーしました'); }
    catch (e) { toast('コピーできませんでした。長押しで選んでコピーしてください', true); }
  }
  const inviteUrl = (id) => location.href.split(/[?#]/)[0] + '?join=' + id;

  // ---------- 描く ----------
  let queued = false;
  function render() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; draw(); });
  }
  function draw() {
    const a = document.activeElement;
    const f = a && a.id && $('#main').contains(a) ? { id: a.id, s: a.selectionStart, e: a.selectionEnd } : null;
    $('#syncBtn').textContent = syncLabel();
    $('#syncBtn').classList.toggle('on', !!(S.user && S.online && !S.pending));
    $('#tabs').hidden = !S.user;
    const waiting = pendingForMe().length;
    $('#tabs').innerHTML = `
      <button role="tab" data-act="tab" data-v="shared" aria-selected="${U.tab === 'shared'}">👪 みんなの帳簿${waiting ? `<span class="badge">${waiting}</span>` : ''}</button>
      <button role="tab" data-act="tab" data-v="personal" aria-selected="${U.tab === 'personal'}">📒 自分の帳簿</button>`;
    $('#apk').hidden = !(U.apk.ready && !U.apk.silent && kkAppOutdated());
    $('#appDot').hidden = !kkAppOutdated();
    $('#main').innerHTML = viewMain();
    if (f) { const el = document.getElementById(f.id); if (el) { el.focus(); try { if (f.s != null) el.setSelectionRange(f.s, f.e); } catch (e) {} } }
    kkApkSetIdle(!U.sheet && !U.repay && !U.claimForm);
  }
  function syncLabel() {
    if (!S.authReady) return '☁️ …';
    if (!S.user) return '☁️ ログイン';
    if (S.error) return '⚠️ 同期';
    if (!S.online) return '📴 オフライン';
    if (S.pending) return '☁️ 送信中…';
    return '☁️ 同期中';
  }
  const pendingForMe = () => {
    const out = [];
    S.books.forEach((b) => (S.claims[b.id] || []).forEach((c) => { if (c.lender === me() && c.status === 'pending') out.push({ b, c }); }));
    return out;
  };

  function viewMain() {
    if (S.configMissing) return `<section class="sec"><h2 class="sec-title"><span class="mark">⚙️</span> まだ準備中です</h2><p class="hint">Firebase の設定（kashikari/firebase-config.js）がまだ入っていません。入れると使えるようになります。</p></section>`;
    if (!S.available && S.authReady) return `<section class="sec"><p class="hint">Firebase を読み込めませんでした。電波のよいところで開き直してください。</p></section>`;
    if (!S.authReady) return `<section class="sec"><p class="empty">読み込み中…</p></section>`;
    if (!S.user) return viewLogin();
    return U.tab === 'personal' ? KB.view(viewPersonal) : viewShared();
  }

  // ---------- ログイン ----------
  function viewLogin() {
    const L = U.login;
    return `<section class="sec">
      <h2 class="sec-title"><span class="mark">⚓</span> ログインして使います</h2>
      <p class="hint">Google かメールでログインします。記録は、同じアカウントのほかの端末（スマホ・パソコン・Android アプリ）にも届きます。</p>
      ${U.pendingJoin ? `<p class="hint" style="color:var(--brass-bright)">招待された帳簿があります。ログインすると参加できます。</p>` : ''}
      <button class="btn primary wide" data-act="login-google" ${L.busy ? 'disabled' : ''}>Google でログイン</button>
      ${KStore.canBrowserSignIn() ? `<div class="row end"><button class="btn link" data-act="login-browser">うまくいかないとき：ブラウザでログイン</button></div>` : ''}
    </section>
    <form class="sec" data-form="login">
      <h2 class="sec-title"><span class="mark">✉</span> メールでログイン</h2>
      <div class="field"><label for="lg-email">メールアドレス</label><input id="lg-email" type="email" autocomplete="email" data-bind="login.email" value="${esc(L.email)}"></div>
      <div class="field"><label for="lg-pw">パスワード</label><input id="lg-pw" type="password" autocomplete="${L.create ? 'new-password' : 'current-password'}" data-bind="login.pw" value="${esc(L.pw)}"></div>
      <label class="check"><input type="checkbox" id="lg-create" data-bind="login.create" ${L.create ? 'checked' : ''}> はじめて使う（アカウントを作る）</label>
      ${L.err ? `<p class="err">${esc(L.err)}</p>` : ''}
      <button class="btn wide" type="submit" ${L.busy ? 'disabled' : ''}>${L.create ? 'アカウントを作ってログイン' : 'ログイン'}</button>
    </form>`;
  }
  async function doLogin(kind) {
    const L = U.login;
    L.err = ''; L.busy = true; render();
    try {
      if (kind === 'google') await KStore.signInGoogle();
      else if (kind === 'browser') await KStore.signInGoogleBrowser();
      else {
        if (!L.email || !L.pw) throw Object.assign(new Error('メールアドレスとパスワードを入れてください'), { code: 'app/empty' });
        await KStore.signInEmail(L.email.trim(), L.pw, L.create);
      }
      L.pw = '';
    } catch (e) {
      const c = e.code || '';
      L.err = c === 'auth/wrong-password' || c === 'auth/invalid-credential' || c === 'auth/invalid-login-credentials' ? 'メールアドレスかパスワードがちがいます'
        : c === 'auth/user-not-found' ? 'そのメールアドレスのアカウントはありません（はじめてなら「アカウントを作る」に✓）'
        : c === 'auth/email-already-in-use' ? 'そのメールアドレスはもう使われています（✓を外してログイン）'
        : c === 'auth/weak-password' ? 'パスワードは6文字以上にしてください'
        : c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request' ? ''
        : e.message || 'ログインできませんでした';
    }
    L.busy = false; render();
  }

  // ---------- みんなの帳簿 ----------
  function viewShared() {
    if (!S.booksReady) return `<section class="sec"><p class="empty">帳簿を読み込み中…</p></section>`;
    const b = book();
    if (!b) {
      return `<section class="sec">
        <h2 class="sec-title"><span class="mark">👪</span> まだ帳簿がありません</h2>
        <p class="hint">きょうだいや家族で使う帳簿を1つ作って、招待リンクを送ってください。招待された人は、リンクを開くか招待コードを入れると参加できます。</p>
        <div class="row"><button class="btn primary" data-act="sheet" data-v="newbook">＋ 帳簿をつくる</button><button class="btn" data-act="sheet" data-v="join">招待コードで参加</button></div>
      </section>`;
    }
    if (U.bookId !== b.id) { U.bookId = b.id; store('kashikari-book', b.id); }
    let h = `<section class="sec">
      <div class="bookbar">
        <div class="grow"><div class="name">${esc(b.name)}</div><div class="people">${b.members.length}人：${b.members.map((id) => nameH(b, id)).join('・')}</div></div>
        <button class="btn small" data-act="sheet" data-v="invite">招待する</button>
        <button class="btn small" data-act="sheet" data-v="books" aria-label="帳簿をえらぶ・設定">帳簿 ▾</button>
      </div>
    </section>`;
    if (b.closing) {
      return h + `<section class="sec"><div class="notice"><h3>🗑 この帳簿は消している途中です</h3>
        <p class="hint">${b.owner === me() ? '途中で止まったようです。「続きを消す」を押してください。' : 'つくった人が消しています。もう書けません。'}</p>
        ${b.owner === me() ? '<div class="row end"><button class="btn danger small" data-act="delbook-go">続きを消す</button></div>' : ''}</div></section>`;
    }
    h += viewClaimsToMe(b) + viewMyClaims(b);
    h += `<section class="sec">
      <div class="row between">
        <div class="subtabs" role="tablist">
          <button role="tab" data-act="sub" data-v="summary" aria-selected="${U.sub === 'summary'}">まとめ</button>
          <button role="tab" data-act="sub" data-v="entries" aria-selected="${U.sub === 'entries'}">記録</button>
          <button role="tab" data-act="sub" data-v="card" aria-selected="${U.sub === 'card'}">💳 カード</button>
        </div>
        ${U.sub === 'card' ? '' : '<button class="btn primary small" data-act="loan-new">＋ 貸した記録</button>'}
      </div>
      ${U.sub === 'summary' ? viewSummary(b) : U.sub === 'card' ? viewCards(b) : viewEntries(b)}
    </section>`;
    return h;
  }

  function viewClaimsToMe(b) {
    const list = claimsOf(b).filter((c) => c.lender === me() && c.status === 'pending').sort((x, y) => x.createdAt - y.createdAt);
    if (!list.length) return '';
    return `<section class="sec"><div class="notice">
      <h3>🔔 「返したよ」が届いています</h3>
      ${list.map((c) => claimRow(b, c)).join('')}
      <p class="hint">「認める」と、その記録に返済として入ります。</p>
    </div></section>`;
  }
  function claimRow(b, c) {
    const l = loansOf(b).find((x) => x.id === c.loanId);
    const s = l && l.shares.find((x) => x.to === (c.for || c.from));
    const rest = s ? shareStat(s).rest : 0;
    const over = s && c.amount > rest;
    return `<div class="claim">
      <div>${c.for ? `<b>${nameH(b, c.from)}</b> が <b>${nameH(b, c.for)}</b> の代わりに <span class="num" style="color:var(--signal)">${yen(c.amount)}</span> 返したよ <span class="tag part">肩代わり</span>`
        : `<b>${nameH(b, c.from)}</b> が <span class="num" style="color:var(--signal)">${yen(c.amount)}</span> 返したよ`}</div>
      <div class="sub">${esc(fmtDate(c.date))}・${l ? esc(l.title || '（内容なし）') : '（消した記録）'}${c.note ? `・「${esc(c.note)}」` : ''}${s ? `・残り ${yen(rest)}` : ''}</div>
      ${over && rest ? `<div class="sub" style="color:var(--brass-bright)">残りより多いので、認めると残り ${yen(rest)} を返済として入れます</div>` : ''}
      <div class="row end">
        <button class="btn small danger" data-act="claim-reject" data-id="${esc(c.id)}">断る</button>
        <button class="btn small primary" data-act="claim-approve" data-id="${esc(c.id)}" ${s && rest ? '' : 'disabled'}>認める</button>
      </div>
    </div>`;
  }
  function viewMyClaims(b) {
    const list = claimsOf(b).filter((c) => c.from === me() && c.status !== 'approved').sort((x, y) => y.createdAt - x.createdAt);
    if (!list.length) return '';
    return `<section class="sec"><div class="notice quiet">
      <h3>⏳ 自分が出した「返したよ」</h3>
      ${list.map((c) => {
        const l = loansOf(b).find((x) => x.id === c.loanId);
        return `<div class="claim">
          <div>${nameH(b, c.lender)} に ${c.for ? `<b>${nameH(b, c.for)}</b> の代わりに ` : ''}<span class="num">${yen(c.amount)}</span>（${esc(fmtDate(c.date))}・${l ? esc(l.title || '（内容なし）') : '（消した記録）'}）</div>
          <div class="row between"><span class="tag ${c.status === 'rejected' ? 'due' : 'wait'}">${c.status === 'rejected' ? '断られました' : '確認待ち'}</span>
          ${c.for ? `<button class="btn small" data-act="cover-cancel" data-id="${esc(c.id)}">${c.status === 'rejected' ? '消す' : '取り消す'}（${esc(nameIn(b, c.for))}への貸しも）</button>`
            : `<button class="btn small" data-act="claim-delete" data-id="${esc(c.id)}">${c.status === 'rejected' ? '消す' : '取り消す'}</button>`}</div>
        </div>`;
      }).join('')}
    </div></section>`;
  }

  function viewSummary(b) {
    const nets = KL.myNets(b, loansOf(b), me());
    const inSum = nets.reduce((a, x) => a + x.lent, 0), outSum = nets.reduce((a, x) => a + x.borrowed, 0);
    let h = `<div class="balances">
      <div class="bal in"><span class="label">返ってくる予定</span><span class="num">${yen(inSum)}</span></div>
      <div class="bal out"><span class="label">返す予定</span><span class="num">${yen(outSum)}</span></div>
    </div>`;
    h += dueList(KL.dueItems([b], S.loans, [], me()), false);
    h += `<h3 class="sec-title"><span class="mark">⚓</span> 相手ごと（差し引き）</h3>`;
    h += nets.length ? `<ul class="lines">${nets.map((x) => {
      const detail = x.lent && x.borrowed ? `<small>貸し ${yen(x.lent)}・借り ${yen(x.borrowed)} を差し引き</small>` : '';
      if (x.net > 0) return `<li><div class="who">${nameH(b, x.id)}<span class="arrow">→</span>あなた${detail}</div><div class="amt in">${yen(x.net)}</div></li>`;
      if (x.net < 0) return `<li><div class="who">あなた<span class="arrow">→</span>${nameH(b, x.id)}${detail}</div><div class="amt out">${yen(-x.net)}</div></li>`;
      return `<li><div class="who">${nameH(b, x.id)}${detail}</div><div class="amt zero">貸し借りなし</div></li>`;
    }).join('')}</ul>` : `<p class="empty">まだほかの人がいません。「招待する」からリンクを送ってください。</p>`;
    const pairs = KL.pairNets(b, loansOf(b));
    h += `<h3 class="sec-title"><span class="mark">★</span> みんなの状況（だれがだれに返す？）</h3>`;
    h += pairs.length ? `<ul class="lines">${pairs.map((p) => `<li><div class="who">${nameH(b, p.from)}<span class="arrow">→</span>${nameH(b, p.to)}</div><div class="amt">${yen(p.amt)}</div></li>`).join('')}
      <li><div class="who"><small>まだ返っていないお金の合計</small></div><div class="amt">${yen(pairs.reduce((a, p) => a + p.amt, 0))}</div></li></ul>`
      : `<p class="empty">いま返していないお金はありません ✦</p>`;
    return h;
  }

  function viewEntries(b) {
    const f = U.filter;
    let list = loansOf(b).slice().sort(sortByDate);
    if (f === 'lent') list = list.filter((l) => l.lender === me());
    if (f === 'borrowed') list = list.filter((l) => l.shares.some((s) => s.to === me()));
    const doneN = list.filter((l) => l.shares.length && KL.loanRest(l) === 0).length;
    if (!U.showDone) list = list.filter((l) => !l.shares.length || KL.loanRest(l) > 0);
    const pill = (v, t) => `<button class="pillbtn" data-act="filter" data-v="${v}" aria-pressed="${f === v}">${t}</button>`;
    let h = `<div class="filters">${pill('all', 'ぜんぶ')}${pill('lent', '自分が貸した')}${pill('borrowed', '自分が借りた')}
      <label class="check"><input type="checkbox" id="show-done" ${U.showDone ? 'checked' : ''}> 返済済みも${doneN ? `（${doneN}件）` : ''}</label></div>`;
    if (!list.length) return h + `<p class="empty">${!U.showDone && doneN ? '返していない記録はありません ✦<br>返済済みの記録は上の✓で出せます。' : 'まだ記録がありません。<br>お金を貸したら「＋ 貸した記録」から書きましょう。'}</p>`;
    return h + `<div class="entries">${list.map((l) => viewLoan(b, l)).join('')}</div>`;
  }

  function viewLoan(b, l) {
    const mine = l.lender === me();
    const rest = KL.loanRest(l), done = l.shares.length > 0 && rest === 0;
    const claims = claimsOf(b).filter((c) => c.loanId === l.id && c.status === 'pending');
    const split = l.mode === 'split' && l.total ? `<span>${l.shares.length + (l.includeSelf ? 1 : 0)}人で割り勘（合計 <b class="num">${yen(l.total)}</b>）</span>` : '';
    const shares = l.shares.map((s) => {
      const { paid, rest: r } = shareStat(s);
      const myClaim = claims.find((c) => (c.for || c.from) === s.to);
      const tag = r === 0 ? '<span class="tag ok">完済</span>' : myClaim ? '<span class="tag wait">確認待ち</span>' : paid ? '<span class="tag part">一部返済</span>' : '<span class="tag due">まだ</span>';
      const hist = s.repayments.length ? `<ul class="history">${s.repayments.map((rp) => {
        const conf = U.confirm && U.confirm.kind === 'rep' && U.confirm.id === l.id && U.confirm.to === s.to && U.confirm.rid === rp.id;
        return `<li><span class="mono">${esc(fmtDate(rp.date))}</span><span class="num">${yen(rp.amount)}</span>返済${rp.by && rp.by !== s.to ? `（${esc(nameIn(b, rp.by))} が肩代わり）` : rp.claim ? '（返したよ）' : ''}
          ${mine ? (conf ? `<span class="confirm"><span>取り消す？</span><button class="btn small danger" data-act="rep-del-yes">取り消す</button><button class="btn small" data-act="confirm-no">やめる</button></span>`
            : `<button class="x" data-act="rep-del" data-id="${esc(l.id)}" data-to="${esc(s.to)}" data-rid="${esc(rp.id)}">取り消す</button>`) : ''}</li>`;
      }).join('')}</ul>` : '';
      let act = '';
      if (mine && r > 0) {
        act = U.repay && U.repay.scope === 'loan' && U.repay.id === l.id && U.repay.to === s.to ? repayForm(r)
          : `<div class="row"><button class="btn small" data-act="repay-open" data-id="${esc(l.id)}" data-to="${esc(s.to)}">返済を記録</button></div>`;
      } else if (s.to === me() && r > 0) {
        act = myClaim ? (myClaim.for ? `<p class="hint">${nameH(b, myClaim.from)} があなたの代わりに ${yen(myClaim.amount)} 返したよ（肩代わり）。${nameH(b, l.lender)} が認めると返済に入り、その分は ${nameH(b, myClaim.from)} に返すことになります。</p>`
            : `<p class="hint">「返したよ」（${yen(myClaim.amount)}）を出しました。${nameH(b, l.lender)} が認めると返済に入ります。</p>`)
          : U.claimForm && U.claimForm.loanId === l.id ? claimForm(r)
          : `<div class="row"><button class="btn small" data-act="claim-open" data-id="${esc(l.id)}">返したよ</button></div>`;
      }
      return `<li class="share">
        <div class="share-main"><div><span class="share-name">${nameH(b, s.to)}</span>
          <div class="figures"><span>貸した <span class="num">${yen(s.amount)}</span></span><span>返済 <span class="num">${yen(paid)}</span></span><span class="rest">残り <span class="num">${yen(r)}</span></span></div></div>${tag}</div>
        ${hist}${act}</li>`;
    }).join('');
    const conf = U.confirm && U.confirm.kind === 'loan' && U.confirm.id === l.id;
    const vc = l.via ? claimsOf(b).find((c) => c.id === l.via.claimId) : null;
    const via = l.via ? `<div class="via">🔁 ${nameH(b, l.via.lender)} への返済（${esc(l.via.title || '（内容なし）')}）を、${nameH(b, l.via.for)} の代わりに返した
      ${vc ? (vc.status === 'pending' ? `<span class="tag wait">${esc(nameIn(b, l.via.lender))} の確認待ち</span>` : vc.status === 'rejected' ? `<span class="tag due">${esc(nameIn(b, l.via.lender))} に断られました</span>` : '<span class="tag ok">認められました</span>') : ''}
      ${vc && vc.status === 'rejected' && mine ? '<p class="hint">まちがいなら「消す」で取り消せます。</p>' : ''}</div>` : '';
    const paidTo = l.paidTo || l.paidToName ? `<span>払った先 <b>${l.paidTo ? nameH(b, l.paidTo) : esc(l.paidToName)}</b>（立て替え）</span>` : '';
    const actions = mine ? `<div class="row end">${conf
      ? `<span class="confirm"><span>この記録を消しますか？（返済の記録${vc && vc.status !== 'approved' ? '・返したよ' : ''}も消えます）</span><button class="btn small danger" data-act="loan-del-yes">消す</button><button class="btn small" data-act="confirm-no">やめる</button></span>`
      : `<button class="btn small" data-act="loan-edit" data-id="${esc(l.id)}">直す</button><button class="btn small danger" data-act="loan-del" data-id="${esc(l.id)}">消す</button>`}</div>` : '';
    return `<article class="entry${done ? ' done' : ''}">${done ? '<div class="stamp">完済</div>' : ''}
      <div class="entry-head"><h3>${esc(l.title || '（内容なし）')}</h3><time>${esc(fmtDate(l.date))}</time></div>
      <div class="meta"><span>貸した人 <b>${nameH(b, l.lender)}</b></span><span>合計 <b class="num">${yen(KL.loanTotal(l))}</b></span>${rest ? `<span>残り <b class="num">${yen(rest)}</b></span>` : ''}${split}${paidTo}${dueTag(l.due, rest)}</div>
      ${via}${l.memo ? `<p class="memo">${esc(l.memo)}</p>` : ''}
      <ul class="shares">${shares}</ul>${actions}</article>`;
  }

  function repayForm(rest) {
    const R = U.repay;
    return `<form class="mini-form" data-form="repay">
      <div class="row">
        <div class="field"><label for="rp-amount">返してもらった金額</label><div class="yen"><span>¥</span><input id="rp-amount" inputmode="numeric" data-bind="repay.amount" value="${esc(R.amount)}"></div></div>
        <div class="field"><label for="rp-date">日付</label><input id="rp-date" type="date" class="plain-input" data-bind="repay.date" value="${esc(R.date)}"></div>
      </div>
      <div class="row"><button type="button" class="btn small" data-act="repay-full">残り全部（${yen(rest)}）</button><span class="grow"></span>
        <button type="button" class="btn small" data-act="repay-cancel">やめる</button><button class="btn small primary" type="submit">記録する</button></div>
    </form>`;
  }
  function claimForm(rest) {
    const C = U.claimForm;
    return `<form class="mini-form" data-form="claim">
      <p class="hint">貸した人に「返したよ」を知らせます。認めてもらうと返済に入ります。</p>
      <div class="row">
        <div class="field"><label for="cl-amount">返した金額</label><div class="yen"><span>¥</span><input id="cl-amount" inputmode="numeric" data-bind="claimForm.amount" value="${esc(C.amount)}"></div></div>
        <div class="field"><label for="cl-date">返した日</label><input id="cl-date" type="date" class="plain-input" data-bind="claimForm.date" value="${esc(C.date)}"></div>
      </div>
      <div class="field"><label for="cl-note">ひとこと（なくてもOK）</label><input id="cl-note" maxlength="100" data-bind="claimForm.note" value="${esc(C.note)}" placeholder="例：手渡しで返したよ"></div>
      <div class="row"><span class="hint">残り ${yen(rest)}</span><span class="grow"></span>
        <button type="button" class="btn small" data-act="claim-cancel">やめる</button><button class="btn small primary" type="submit">返したよを送る</button></div>
    </form>`;
  }

  // ---------- 💳 家族のカード（親のカードで、きょうだいが昼食などを買う）----------
  // 使った人：いつ・いくら・何に（とレシートの写真）を報告。持ち主：カードの明細の額を入れて、人ごと・月ごとに報告と合うかを見る
  const cardsOf = (b) => (b ? S.cards[b.id] || [] : []);
  const ymNow = () => today().slice(0, 7);
  const ymAdd = (m, n) => { let y = +m.slice(0, 4), mo = +m.slice(5, 7) + n; while (mo > 12) { mo -= 12; y++; } while (mo < 1) { mo += 12; y--; } return `${y}-${String(mo).padStart(2, '0')}`; };
  const dayDiff = (a, b2) => Math.abs((new Date(a) - new Date(b2)) / 86400000);
  // 報告と明細を結ぶ：おなじ人・おなじ額で、日付が3日以内（いちばん近いもの）。明細に report があればそれを先に
  function cardMatch(reps, chs) {
    const used = new Set(), byReport = {};
    reps.forEach((r) => { const c = chs.find((x) => x.report === r.id && x.for === r.by); if (c) { used.add(c.id); byReport[r.id] = c.id; } });
    reps.slice().sort((a, b2) => a.date.localeCompare(b2.date)).forEach((r) => {
      if (byReport[r.id]) return;
      let best = null, bd = 99;
      chs.forEach((c) => { if (used.has(c.id) || c.report || c.for !== r.by || c.amount !== r.amount) return; const dd = dayDiff(c.date, r.date); if (dd <= 3 && dd < bd) { best = c; bd = dd; } });
      if (best) { used.add(best.id); byReport[r.id] = best.id; }
    });
    return { byReport, used };
  }
  function viewCards(b) {
    const cards = cardsOf(b);
    if (!cards.length) return `<p class="hint">家族のカード（親のカードなど）を、きょうだいで使うとき：使った人が「いつ・いくら・何に」とレシートの写真を報告して、カードの持ち主が明細の額を入れると、報告と合っているか・差額がいくらかを見られます。</p>
      <div class="row"><button class="btn primary small" data-act="card-new">＋ カードを登録する（持ち主はあなた）</button></div>`;
    const c = cards.find((x) => x.id === U.cardId) || cards[0];
    if (!U.cardMonth) U.cardMonth = ymNow();
    const m = U.cardMonth, holder = c.holder === me();
    const reps = (S.cardReports[b.id] || []).filter((r) => r.card === c.id && r.date.startsWith(m));
    const chs = (S.cardCharges[b.id] || []).filter((x) => x.card === c.id && x.date.startsWith(m));
    const mt = cardMatch(reps, chs);
    const ppl = holder ? [...new Set([...b.members.filter((id) => id !== c.holder), ...reps.map((r) => r.by), ...chs.map((x) => x.for)])] : [me()];
    const sum = (l) => l.reduce((a, x) => a + x.amount, 0);
    const rows = ppl.map((id) => {
      const rp = sum(reps.filter((r) => r.by === id)), ch = sum(chs.filter((x) => x.for === id)), diff = ch - rp;
      const st = !rp && !ch ? '<span class="faint">なし</span>' : !ch ? '<span class="tag soft">明細まだ</span>' : diff === 0 ? '<span class="tag ok">✓ 一致</span>' : `<span class="tag due">差 ${diff > 0 ? '+' : '−'}${yen(Math.abs(diff))}</span>`;
      return `<tr><td>${nameH(b, id)}</td><td class="r num">${yen(rp)}</td><td class="r num">${ch ? yen(ch) : '—'}</td><td class="r">${st}</td></tr>`;
    }).join('');
    const myReps = (holder ? reps : reps.filter((r) => r.by === me())).sort((a, b2) => b2.date.localeCompare(a.date) || b2.createdAt - a.createdAt);
    const lonely = chs.filter((x) => !mt.used.has(x.id) && (holder || x.for === me())).sort((a, b2) => b2.date.localeCompare(a.date));
    const repRow = (r) => {
      const ch = mt.byReport[r.id] ? chs.find((x) => x.id === mt.byReport[r.id]) : null, mine = r.by === me();
      return `<li class="crep"><div class="crep-main"><div><b>${holder ? nameH(b, r.by) + '・' : ''}${esc(r.place || '（何に？）')}</b><small>${esc(fmtDate(r.date))}${r.memo ? '・' + esc(r.memo) : ''}</small></div><div class="num">${yen(r.amount)}</div></div>
        <div class="row">${ch ? (ch.amount === r.amount ? `<span class="tag ok">✓ 明細あり${ch.date !== r.date ? `（${esc(fmtDate(ch.date))}）` : ''}</span>`
            : `<span class="tag due">明細 ${yen(ch.amount)}（差 ${ch.amount > r.amount ? '+' : '−'}${yen(Math.abs(ch.amount - r.amount))}）</span>`) : '<span class="tag soft">明細なし</span>'}${r.checked ? '<span class="tag ok">持ち主が確認</span>' : ''}
          ${r.hasPhoto ? `<button class="btn small" data-act="card-photo" data-id="${esc(r.id)}">📷 レシート</button>` : '<span class="faint" style="font-size:.74rem">写真なし</span>'}
          <span class="grow"></span>
          ${holder ? `${!ch ? `<button class="btn small" data-act="charge-from" data-id="${esc(r.id)}">この額で明細に</button>` : ''}<button class="btn small" data-act="card-check" data-id="${esc(r.id)}" data-v="${r.checked ? '' : '1'}">${r.checked ? '確認を外す' : '✓ 確認した'}</button>` : ''}
          ${mine ? `<button class="btn small" data-act="creport-edit" data-id="${esc(r.id)}">直す</button>` : ''}</div></li>`;
    };
    return `<div class="row between">${cards.length > 1 ? `<div class="filters">${cards.map((x) => `<button class="pillbtn" data-act="card-pick" data-id="${esc(x.id)}" aria-pressed="${x.id === c.id}">💳 ${esc(x.name)}</button>`).join('')}</div>` : `<h3 class="sec-title">💳 ${esc(c.name)}</h3>`}
        <button class="btn small" data-act="card-new">＋ カード</button></div>
      <p class="hint">持ち主：${nameH(b, c.holder)}${holder ? '（あなた）・明細の額を入れると、報告と照らし合わせます' : '・使ったら、レシートの写真といっしょに報告してください'}${holder ? `　<button class="btn link" data-act="card-edit" data-id="${esc(c.id)}">カードを直す</button>` : ''}</p>
      <div class="kb-nav"><button class="btn small" data-act="card-month" data-v="-1" aria-label="前の月">◀</button><h3 class="display">${+m.slice(0, 4)}年${+m.slice(5, 7)}月</h3><button class="btn small" data-act="card-month" data-v="1" aria-label="次の月">▶</button>
        <span class="grow"></span>${holder ? '<button class="btn primary small" data-act="charge-new">＋ 明細を入れる</button>' : '<button class="btn primary small" data-act="creport-new">＋ 使ったのを報告</button>'}</div>
      <div class="ctable"><table><thead><tr><th>だれ</th><th class="r">報告</th><th class="r">明細</th><th class="r"></th></tr></thead><tbody>${rows}</tbody></table></div>
      <h3 class="sec-title"><span class="mark">🧾</span> ${holder ? 'みんなの報告' : 'あなたの報告'}</h3>
      ${myReps.length ? `<ul class="creps">${myReps.map(repRow).join('')}</ul>` : '<p class="empty">この月の報告はまだありません。</p>'}
      ${lonely.length ? `<h3 class="sec-title"><span class="mark">⚠</span> 報告がない明細</h3><ul class="lines">${lonely.map((x) => `<li><div class="who">${holder ? nameH(b, x.for) + '・' : ''}${esc(x.place || '（明細）')}<small>${esc(fmtDate(x.date))}${x.memo ? '・' + esc(x.memo) : ''}</small>
          ${holder ? `<button class="btn link" data-act="charge-edit" data-id="${esc(x.id)}">直す</button>` : '<span class="hint">報告してください</span>'}</div><div class="amt">${yen(x.amount)}</div></li>`).join('')}</ul>` : ''}`;
  }
  // 写真を小さくする（長い辺 1280px・JPEG。Firestore に入るように 700KB くらいまで）
  function shrinkImage(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onerror = () => rej(new Error('写真を読めませんでした'));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => rej(new Error('写真を読めませんでした'));
        img.onload = () => {
          let max = 1280, d = '';
          for (let t = 0; t < 4; t++, max = Math.round(max * 0.75)) {
            const k = Math.min(1, max / Math.max(img.width, img.height)), w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
            const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
            const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
            for (let q = 0.72; q >= 0.4; q -= 0.08) { d = cv.toDataURL('image/jpeg', q); if (d.length < 700000) return res(d); }
          }
          res(d);
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  function cardSheetBody(k, X, b) {
    if (k === 'card') return `<div class="field"><label for="cd-name">カードの名前</label><input id="cd-name" maxlength="30" data-bind="sheet.name" value="${esc(X.name)}" placeholder="例：お母さんのカード"></div>
      <p class="hint">持ち主（明細を入れる人）は、あなたになります。</p>
      ${X.id ? (X.del ? `<div class="confirm"><span>このカードを消しますか？（報告・明細は残ります）</span><button type="button" class="btn small danger" data-act="card-del-yes">消す</button><button type="button" class="btn small" data-act="card-del-no">やめる</button></div>` : '<div class="row"><button type="button" class="btn small danger" data-act="card-del">消す</button></div>') : ''}
      ${foot('保存する')}`;
    if (k === 'creport') return `<div class="two">
        <div class="field"><label for="cr-amount">使った額</label><div class="yen"><span>¥</span><input id="cr-amount" inputmode="numeric" data-bind="sheet.amount" value="${esc(X.amount)}" placeholder="0"></div></div>
        <div class="field"><label for="cr-date">使った日</label><input id="cr-date" type="date" data-bind="sheet.date" value="${esc(X.date)}"></div></div>
      <div class="field"><label for="cr-place">何に・どこで</label><input id="cr-place" maxlength="40" list="cr-places" data-bind="sheet.place" value="${esc(X.place)}" placeholder="例：コンビニで昼ごはん"><datalist id="cr-places">${[...new Set((S.cardReports[b.id] || []).filter((r) => r.by === me()).map((r) => r.place).filter(Boolean))].slice(0, 20).map((p) => `<option value="${esc(p)}">`).join('')}</datalist></div>
      <div class="field"><label for="cr-photo">レシートの写真</label>
        ${X.preview ? `<img class="receipt" src="${esc(X.preview)}" alt="レシートの写真">` : X.hasPhoto && X.photo === null ? '<p class="hint">📷 写真あり（入れ替えるときは、下でえらび直す）</p>' : ''}
        <input id="cr-photo" type="file" accept="image/*" capture="environment">
        ${X.preview || (X.hasPhoto && X.photo === null) ? '<div class="row"><button type="button" class="btn small" data-act="cr-photo-clear">写真を外す</button></div>' : ''}
        <span class="hint" id="cr-photo-note">${X.busy ? '写真を小さくしています…' : ''}</span></div>
      <div class="field"><label for="cr-memo">メモ（なくてもOK）</label><input id="cr-memo" maxlength="200" data-bind="sheet.memo" value="${esc(X.memo)}"></div>
      ${X.id ? (X.del ? `<div class="confirm"><span>この報告を消しますか？</span><button type="button" class="btn small danger" data-act="creport-del-yes">消す</button><button type="button" class="btn small" data-act="card-del-no">やめる</button></div>` : '<div class="row"><button type="button" class="btn small danger" data-act="card-del">消す</button></div>') : ''}
      ${foot(X.id ? '保存する' : '報告する')}`;
    if (k === 'charge') {
      const c = cardsOf(b).find((x) => x.id === X.card) || {};
      const ppl = b.members.filter((id) => id !== c.holder);
      return `<p class="hint">カードの明細（利用明細）に出ている額を入れます。</p>
      <fieldset><legend>だれが使った？</legend><div class="filters">${ppl.map((id) => `<button type="button" class="pillbtn" data-act="charge-for" data-v="${esc(id)}" aria-pressed="${X.for === id}">${esc(nameIn(b, id))}</button>`).join('')}</div></fieldset>
      <div class="two">
        <div class="field"><label for="ch-amount">明細の額</label><div class="yen"><span>¥</span><input id="ch-amount" inputmode="numeric" data-bind="sheet.amount" value="${esc(X.amount)}" placeholder="0"></div></div>
        <div class="field"><label for="ch-date">明細の日付</label><input id="ch-date" type="date" data-bind="sheet.date" value="${esc(X.date)}"></div></div>
      <div class="field"><label for="ch-place">明細の利用先</label><input id="ch-place" maxlength="40" data-bind="sheet.place" value="${esc(X.place)}" placeholder="例：セブンイレブン"></div>
      <div class="field"><label for="ch-memo">メモ（なくてもOK）</label><input id="ch-memo" maxlength="200" data-bind="sheet.memo" value="${esc(X.memo)}"></div>
      ${X.id ? (X.del ? `<div class="confirm"><span>この明細を消しますか？</span><button type="button" class="btn small danger" data-act="charge-del-yes">消す</button><button type="button" class="btn small" data-act="card-del-no">やめる</button></div>` : '<div class="row"><button type="button" class="btn small danger" data-act="card-del">消す</button></div>') : ''}
      ${foot('保存する')}`;
    }
    if (k === 'cphoto') return X.data ? `<img class="receipt big" src="${esc(X.data)}" alt="レシートの写真"><div class="row end"><button type="button" class="btn" data-act="sheet-close">とじる</button></div>`
      : `<p class="empty">${X.err ? esc(X.err) : '写真を読み込み中…'}</p><div class="row end"><button type="button" class="btn" data-act="sheet-close">とじる</button></div>`;
    return '';
  }
  async function submitCardSheet(k) {
    const X = U.sheet, b = book();
    if (k === 'card') {
      const name = X.name.trim(); if (!name) return sheetErr('カードの名前を入れてください');
      run(KStore.saveCard(b.id, X.id, name).then((id) => { U.cardId = id; }), '✓ カードを保存しました'); closeSheet(); return;
    }
    if (k === 'creport') {
      const amount = toInt(X.amount);
      if (amount <= 0) return sheetErr('使った額を入れてください');
      if (!okDate(X.date)) return sheetErr('使った日を入れてください');
      if (!X.place.trim()) return sheetErr('何に・どこで使ったかを入れてください');
      if (X.busy) return sheetErr('写真を小さくしています。少し待ってください');
      const id = X.id || KStore.newCardReportId(b.id);
      run(KStore.saveCardReport(b.id, id, { card: X.card, date: X.date, amount, place: X.place.trim(), memo: X.memo.trim(), hasPhoto: X.hasPhoto, checked: X.checked || false, createdAt: X.createdAt || 0 }, X.photo),
        X.id ? '✓ 直しました' : `✓ ${yen(amount)} を報告しました${X.photo ? '（写真つき）' : ''}`);
      U.cardMonth = X.date.slice(0, 7); closeSheet(); return;
    }
    if (k === 'charge') {
      const amount = toInt(X.amount);
      if (!X.for) return sheetErr('だれが使ったかをえらんでください');
      if (amount <= 0) return sheetErr('明細の額を入れてください');
      if (!okDate(X.date)) return sheetErr('明細の日付を入れてください');
      run(KStore.saveCardCharge(b.id, X.id, { card: X.card, for: X.for, date: X.date, amount, place: X.place.trim(), memo: X.memo.trim(), report: X.report || '', createdAt: X.createdAt || 0 }), '✓ 明細を入れました');
      U.cardMonth = X.date.slice(0, 7); closeSheet();
    }
  }
  function cardClick(a, d) {
    const b = book(), X = U.sheet, c = cardsOf(b).find((x) => x.id === U.cardId) || cardsOf(b)[0];
    switch (a) {
      case 'card-new': openSheet('card', { id: null, name: '', del: false }); return true;
      case 'card-edit': { const x = cardsOf(b).find((y) => y.id === d.id); if (x) openSheet('card', { id: x.id, name: x.name, del: false }); return true; }
      case 'card-pick': U.cardId = d.id; render(); return true;
      case 'card-month': U.cardMonth = ymAdd(U.cardMonth || ymNow(), +d.v); render(); return true;
      case 'creport-new': openSheet('creport', { id: null, card: c.id, date: today(), amount: '', place: '', memo: '', photo: null, hasPhoto: false, preview: '', del: false }); return true;
      case 'creport-edit': { const r = (S.cardReports[b.id] || []).find((y) => y.id === d.id); if (r) openSheet('creport', { ...r, amount: String(r.amount), photo: null, preview: '', del: false }); return true; }
      case 'cr-photo-clear': if (X) { X.photo = ''; X.preview = ''; X.hasPhoto = false; drawSheet(); } return true;
      case 'charge-new': openSheet('charge', { id: null, card: c.id, for: '', date: today(), amount: '', place: '', memo: '', report: '', del: false }); return true;
      case 'charge-edit': { const x = (S.cardCharges[b.id] || []).find((y) => y.id === d.id); if (x) openSheet('charge', { ...x, amount: String(x.amount), del: false }); return true; }
      case 'charge-from': { const r = (S.cardReports[b.id] || []).find((y) => y.id === d.id); if (r) openSheet('charge', { id: null, card: r.card, for: r.by, date: r.date, amount: String(r.amount), place: r.place, memo: '', report: r.id, del: false }); return true; }
      case 'charge-for': if (X) { X.for = d.v; drawSheet(); } return true;
      case 'card-check': run(KStore.checkCardReport(b.id, d.id, d.v === '1'), d.v === '1' ? '✓ 確認しました' : '確認を外しました'); return true;
      case 'card-photo': {
        openSheet('cphoto', { rid: d.id, data: '', err: '' });
        KStore.getCardPhoto(b.id, d.id).then((data) => { if (U.sheet && U.sheet.rid === d.id) { U.sheet.data = data; U.sheet.err = data ? '' : '写真が見つかりません'; drawSheet(); } }, (e) => { if (U.sheet) { U.sheet.err = errText(e); drawSheet(); } });
        return true;
      }
      case 'card-del': if (X) { X.del = true; drawSheet(); } return true;
      case 'card-del-no': if (X) { X.del = false; drawSheet(); } return true;
      case 'card-del-yes': run(KStore.deleteCard(b.id, X.id), 'カードを消しました'); U.cardId = ''; closeSheet(); return true;
      case 'creport-del-yes': run(KStore.deleteCardReport(b.id, X.id, X.hasPhoto), '報告を消しました'); closeSheet(); return true;
      case 'charge-del-yes': run(KStore.deleteCardCharge(b.id, X.id), '明細を消しました'); closeSheet(); return true;
      default: return false;
    }
  }

  // ---------- 自分だけの帳簿 ----------
  function viewPersonal() {
    if (!S.privateReady) return `<section class="sec"><p class="empty">読み込み中…</p></section>`;
    const nets = KL.personalNets(S.personal);
    const inSum = nets.reduce((a, x) => a + x.lent, 0), outSum = nets.reduce((a, x) => a + x.borrowed, 0);
    let h = `<section class="sec">
      <h2 class="sec-title"><span class="mark">🤝</span> 自分だけの貸し借り<span class="grow"></span><button class="btn primary small" data-act="pentry-new">＋ 記録をつける</button></h2>
      <p class="hint">友だちなど、アプリを使っていない人との貸し借りを書いておけます。ここに書いたものは、あなたにしか見えません。</p>
      <div class="balances">
        <div class="bal in"><span class="label">返ってくる予定</span><span class="num">${yen(inSum)}</span></div>
        <div class="bal out"><span class="label">返す予定</span><span class="num">${yen(outSum)}</span></div>
      </div>
      ${nets.length ? `<ul class="lines">${nets.map((x) => {
        const detail = x.lent && x.borrowed ? `<small>貸し ${yen(x.lent)}・借り ${yen(x.borrowed)} を差し引き</small>` : '';
        return x.net > 0 ? `<li><div class="who">${esc(x.who)}<span class="arrow">→</span>あなた${detail}</div><div class="amt in">${yen(x.net)}</div></li>`
          : x.net < 0 ? `<li><div class="who">あなた<span class="arrow">→</span>${esc(x.who)}${detail}</div><div class="amt out">${yen(-x.net)}</div></li>`
          : `<li><div class="who">${esc(x.who)}${detail}</div><div class="amt zero">差し引き0</div></li>`;
      }).join('')}</ul>` : ''}
      ${dueList(KL.dueItems([], {}, S.personal, me()), false)}
    </section>`;
    const f = U.pFilter;
    let list = S.personal.slice().sort(sortByDate);
    if (f !== 'all') list = list.filter((e) => e.dir === f);
    const doneN = list.filter((e) => entryStat(e).rest === 0).length;
    if (!U.pShowDone) list = list.filter((e) => entryStat(e).rest > 0);
    const pill = (v, t) => `<button class="pillbtn" data-act="pfilter" data-v="${v}" aria-pressed="${f === v}">${t}</button>`;
    h += `<section class="sec"><div class="filters">${pill('all', 'ぜんぶ')}${pill('lent', '貸した')}${pill('borrowed', '借りた')}
      <label class="check"><input type="checkbox" id="pshow-done" ${U.pShowDone ? 'checked' : ''}> 返済済みも${doneN ? `（${doneN}件）` : ''}</label></div>`;
    h += list.length ? `<div class="entries">${list.map(viewPEntry).join('')}</div>`
      : `<p class="empty">${!U.pShowDone && doneN ? '返していない記録はありません ✦' : 'まだ記録がありません。<br>「＋ 記録をつける」から書きましょう。'}</p>`;
    return h + '</section>';
  }
  function viewPEntry(e) {
    const { paid, rest } = entryStat(e);
    const lent = e.dir === 'lent';
    const tag = rest === 0 ? '<span class="tag ok">完済</span>' : paid ? '<span class="tag part">一部返済</span>' : '<span class="tag due">まだ</span>';
    const hist = e.repayments.length ? `<ul class="history">${e.repayments.map((rp) => {
      const conf = U.confirm && U.confirm.kind === 'prep' && U.confirm.id === e.id && U.confirm.rid === rp.id;
      return `<li><span class="mono">${esc(fmtDate(rp.date))}</span><span class="num">${yen(rp.amount)}</span>${lent ? '返してもらった' : '返した'}
        ${conf ? `<span class="confirm"><span>取り消す？</span><button class="btn small danger" data-act="prep-del-yes">取り消す</button><button class="btn small" data-act="confirm-no">やめる</button></span>`
          : `<button class="x" data-act="prep-del" data-id="${esc(e.id)}" data-rid="${esc(rp.id)}">取り消す</button>`}</li>`;
    }).join('')}</ul>` : '';
    const open = U.repay && U.repay.scope === 'personal' && U.repay.id === e.id;
    const conf = U.confirm && U.confirm.kind === 'pentry' && U.confirm.id === e.id;
    return `<article class="entry${rest === 0 ? ' done' : ''}">${rest === 0 ? '<div class="stamp">完済</div>' : ''}
      <div class="entry-head"><h3>${esc(e.title || '（内容なし）')}</h3><time>${esc(fmtDate(e.date))}</time></div>
      <div class="share-main"><div>
        <span class="share-name">${lent ? `あなた<span class="arrow">→</span>${esc(e.who || '（名前なし）')}` : `${esc(e.who || '（名前なし）')}<span class="arrow">→</span>あなた`}</span>
        <div class="figures"><span>${lent ? '貸した' : '借りた'} <span class="num">${yen(e.amount)}</span></span><span>返済 <span class="num">${yen(paid)}</span></span><span class="rest">残り <span class="num">${yen(rest)}</span></span></div>
        ${dueTag(e.due, rest)}
      </div>${tag}</div>
      ${e.memo ? `<p class="memo">${esc(e.memo)}</p>` : ''}
      ${hist}
      ${rest > 0 ? (open ? repayForm(rest).replace('返してもらった金額', lent ? '返してもらった金額' : '返した金額') : `<div class="row"><button class="btn small" data-act="prepay-open" data-id="${esc(e.id)}">${lent ? '返してもらった' : '返した'}を記録</button></div>`) : ''}
      <div class="row end">${conf
        ? `<span class="confirm"><span>この記録を消しますか？</span><button class="btn small danger" data-act="pentry-del-yes">消す</button><button class="btn small" data-act="confirm-no">やめる</button></span>`
        : `<button class="btn small" data-act="pentry-edit" data-id="${esc(e.id)}">直す</button><button class="btn small danger" data-act="pentry-del" data-id="${esc(e.id)}">消す</button>`}</div>
    </article>`;
  }

  // ---------- 下から出る画面 ----------
  function openSheet(kind, extra) {
    const b = book();
    const base = { sheetKind: kind, err: '', busy: false };
    if (kind === 'newbook') U.sheet = { ...base, name: S.books.length ? '' : 'きょうだいの帳簿', nick: defaultNick() };
    else if (kind === 'join') U.sheet = { ...base, code: (extra && extra.code) || '', peek: null, nick: defaultNick() };
    else if (kind === 'rename') U.sheet = { ...base, nick: b ? b.names[me()] || '' : '' };
    else if (kind === 'renamebook') U.sheet = { ...base, name: b ? b.name : '' };
    else if (kind === 'loan') U.sheet = { ...base, ...extra };
    else if (kind === 'pentry' || KB.has(kind) || ['card', 'creport', 'charge', 'cphoto'].includes(kind)) U.sheet = { ...base, ...extra, sheetKind: kind };
    else if (kind === 'delbook') U.sheet = { ...base, confirmName: '' };
    else U.sheet = base;
    drawSheet();
    if (kind === 'join' && U.sheet.code) peekJoin();
    // 最初の欄にカーソルを置く（もうどこかに入力しはじめていたら動かさない）
    setTimeout(() => {
      const box = $('#sheet'), act = document.activeElement;
      if (act && box.contains(act) && act.matches('input, textarea, select')) return;
      const el = $('#sheet input:not([type=checkbox]):not([type=date]):not([type=file]), #sheet textarea');
      if (el && kind !== 'invite' && kind !== 'books' && kind !== 'account' && kind !== 'cphoto') el.focus();
    }, 30);
  }
  function closeSheet() { U.sheet = null; drawSheet(); render(); }
  function drawSheet() {
    document.body.classList.toggle('locked', !!U.sheet);
    const box = $('#sheet');
    if (!U.sheet) { box.innerHTML = ''; return; }
    const k = U.sheet.sheetKind;
    const title = KB.has(k) ? KB.title(k) : { card: U.sheet.id ? '💳 カードを直す' : '💳 カードを登録する', creport: U.sheet.id ? '🧾 報告を直す' : '🧾 使ったのを報告', charge: U.sheet.id ? '明細を直す' : '明細を入れる', cphoto: '📷 レシート', appinfo: '⚙️ アプリと更新', delbook: '帳簿を消す', leavebook: '帳簿から抜ける', newbook: '帳簿をつくる', join: '招待コードで参加', invite: '招待する', books: '帳簿', rename: '呼び名を変える', renamebook: '帳簿の名前を変える', loan: U.sheet.id ? '記録を直す' : '貸した記録をつける', pentry: U.sheet.id ? '記録を直す' : '自分だけの帳簿に書く', account: 'アカウント' }[k];
    box.innerHTML = `<div class="backdrop" data-act="backdrop"><form class="sheet" role="dialog" aria-modal="true" aria-labelledby="sh-title" data-form="sheet">
      <div class="sheet-head"><h2 id="sh-title">${title}</h2><button type="button" class="close" data-act="sheet-close" aria-label="閉じる">×</button></div>
      ${KB.has(k) ? KB.sheetBody(k) : sheetBody(k)}
      <p class="err" id="sh-err" ${U.sheet.err ? '' : 'hidden'}>${esc(U.sheet.err)}</p>
    </form></div>`;
    updatePreview();
    KB.afterDraw();
  }
  function sheetErr(msg) {
    if (!U.sheet) return;
    U.sheet.err = msg;
    const el = $('#sh-err'); if (el) { el.textContent = msg; el.hidden = !msg; }
  }
  const foot = (label, extra) => `<div class="row end">${extra || ''}<button type="button" class="btn" data-act="sheet-close">やめる</button><button type="submit" class="btn primary">${label}</button></div>`;

  function sheetBody(k) {
    const X = U.sheet, b = book();
    if (k === 'newbook') return `
      <p class="hint">帳簿をつくったら、「招待する」でリンクを送ってください。</p>
      <div class="field"><label for="nb-name">帳簿の名前</label><input id="nb-name" maxlength="40" data-bind="sheet.name" value="${esc(X.name)}" placeholder="例：きょうだいの帳簿"></div>
      <div class="field"><label for="nb-nick">あなたの呼び名（みんなに見えます）</label><input id="nb-nick" maxlength="20" data-bind="sheet.nick" value="${esc(X.nick)}" placeholder="例：兄・ゆうき"></div>
      ${foot('つくる')}`;
    if (k === 'join') return `
      <div class="field"><label for="jn-code">招待コード（招待リンクでもOK）</label>
        <div class="codebox"><input id="jn-code" class="plain-input" data-bind="sheet.code" value="${esc(X.code)}" placeholder="例：a1B2c3D4e5F6g7H8i9J0"><button type="button" class="btn small" data-act="join-peek">確かめる</button></div></div>
      ${X.peek ? `<div class="notice quiet"><h3>「${esc(X.peek.name)}」</h3><p class="hint">いま ${X.peek.members.length}人：${X.peek.members.map((id) => esc(X.peek.names[id] || 'だれか')).join('・')}</p></div>
        <div class="field"><label for="jn-nick">あなたの呼び名（みんなに見えます）</label><input id="jn-nick" maxlength="20" data-bind="sheet.nick" value="${esc(X.nick)}" placeholder="例：姉"></div>
        ${foot('参加する')}` : `<div class="row end"><button type="button" class="btn" data-act="sheet-close">やめる</button></div>`}`;
    if (k === 'invite') {
      const url = inviteUrl(b.id);
      return `<p class="hint">このリンクを LINE などで送ってください。開いてログインすると「${esc(b.name)}」に参加できます。アプリの人は、招待コードを「帳簿 ▾」→「招待コードで参加」に入れても参加できます。</p>
        <div class="field"><label for="iv-url">招待リンク</label><div class="codebox"><input id="iv-url" class="plain-input" readonly value="${esc(url)}"><button type="button" class="btn small" data-act="copy" data-v="${esc(url)}">コピー</button></div></div>
        <div class="field"><label for="iv-code">招待コード</label><div class="codebox"><input id="iv-code" class="plain-input" readonly value="${esc(b.id)}"><button type="button" class="btn small" data-act="copy" data-v="${esc(b.id)}">コピー</button></div></div>
        <p class="hint">リンクを知っている人はだれでも参加できるので、家族にだけ送ってください。</p>`;
    }
    if (k === 'books') return `
      <div class="choice">${S.books.map((x) => `<button type="button" data-act="book-pick" data-id="${esc(x.id)}" aria-current="${x.id === (b && b.id)}">${esc(x.name)}<small>${x.members.length}人・あなたは「${esc(x.names[me()] || '')}」</small></button>`).join('')}</div>
      <div class="row"><button type="button" class="btn" data-act="sheet" data-v="newbook">＋ 新しい帳簿</button><button type="button" class="btn" data-act="sheet" data-v="join">招待コードで参加</button></div>
      ${b ? `<div class="row"><button type="button" class="btn small" data-act="sheet" data-v="rename">自分の呼び名を変える</button>${b.owner === me() ? `<button type="button" class="btn small" data-act="sheet" data-v="renamebook">帳簿の名前を変える</button>` : ''}</div>` : ''}
      ${b ? `<div class="row">${b.owner === me() ? `<button type="button" class="btn small danger" data-act="sheet" data-v="delbook">🗑 「${esc(b.name)}」を消す</button>` : `<button type="button" class="btn small danger" data-act="sheet" data-v="leavebook">「${esc(b.name)}」から抜ける</button>`}</div>` : ''}`;
    if (k === 'rename') return `
      <div class="field"><label for="rn-nick">「${esc(b.name)}」での呼び名</label><input id="rn-nick" maxlength="20" data-bind="sheet.nick" value="${esc(X.nick)}"></div>${foot('変える')}`;
    if (k === 'renamebook') return `
      <div class="field"><label for="rb-name">帳簿の名前</label><input id="rb-name" maxlength="40" data-bind="sheet.name" value="${esc(X.name)}"></div>${foot('変える')}`;
    if (k === 'account') return `
      <p class="hint">${esc((S.user && (S.user.email || S.user.name)) || '')} でログインしています。</p>
      <p class="hint">${S.online ? (S.pending ? '☁️ 送信中…（つながったら送ります）' : '☁️ 同期中：ほかの端末にもすぐ届きます') : '📴 オフライン：書いたものはこの端末に覚えておき、つながったら送ります'}</p>
      ${S.error ? `<p class="err">⚠️ ${esc(S.error)}</p>` : ''}
      <div class="row end"><button type="button" class="btn danger" data-act="logout">ログアウト</button></div>`;
    if (k === 'appinfo') return appInfoBody();
    if (['card', 'creport', 'charge', 'cphoto'].includes(k)) return cardSheetBody(k, X, b);
    if (k === 'delbook') return `
      <p class="hint">「${esc(b.name)}」と、中の記録（${loansOf(b).length}件）・返したよを<b>ぜんぶ消します</b>。参加しているみんなの画面からも消えて、もとに戻せません。</p>
      <p class="hint">消すときは、下に帳簿の名前「${esc(b.name)}」を打ってください。</p>
      <div class="field"><label for="db-name">帳簿の名前</label><input id="db-name" class="plain-input" data-bind="sheet.confirmName" value="${esc(X.confirmName)}" autocomplete="off"></div>
      <div class="row end"><button type="button" class="btn" data-act="sheet-close">やめる</button><button type="submit" class="btn danger" ${X.busy ? 'disabled' : ''}>${X.busy ? '消しています…' : 'ぜんぶ消す'}</button></div>`;
    if (k === 'leavebook') return `
      <p class="hint">「${esc(b.name)}」から抜けると、この帳簿が見られなくなります。あなたが書いた記録は帳簿に残ります（ほかの人は見られます）。もう一度入るには、招待リンクが要ります。</p>
      <div class="row end"><button type="button" class="btn" data-act="sheet-close">やめる</button><button type="button" class="btn danger" data-act="leave-yes">抜ける</button></div>`;
    if (k === 'loan') return loanBody(X, b);
    if (k === 'pentry') return pentryBody(X);
    return '';
  }

  // 貸した記録
  function loanOpen(id) {
    const l = id ? myLoan(id) : null;
    const X = {
      id: l ? l.id : null, date: l ? l.date || today() : today(), title: l ? l.title : '', memo: l ? l.memo : '',
      mode: l ? l.mode : 'each', total: l && l.total ? String(l.total) : '', includeSelf: l ? l.includeSelf : true,
      selected: l ? l.shares.map((s) => s.to) : [], amounts: {}, paid: {}, createdAt: l ? l.createdAt : 0,
      due: l ? l.due : '', paidTo: l ? l.paidTo : '', paidToName: l ? l.paidToName : '', via: l ? l.via : null,
      ltype: 'lend', cvKey: '', cvAmount: '', cvNote: '',
    };
    if (l) l.shares.forEach((s) => { X.amounts[s.to] = String(s.amount); X.paid[s.to] = shareStat(s).paid; });
    openSheet('loan', X);
  }
  function splitCalc(X) {
    const total = toInt(X.total), n = X.selected.length + (X.includeSelf ? 1 : 0);
    if (!total || !X.selected.length) return null;
    const per = Math.floor(total / n);
    return { total, n, per, rem: total - per * n };
  }
  function loanBody(X, b) {
    // 肩代わりの記録を直すとき：期限とメモだけ
    if (X.via) return `<p class="hint">🔁 ${nameH(b, X.via.lender)} への返済を、${nameH(b, X.via.for)} の代わりに返した記録です。直せるのは返す期限とメモだけです（金額を変えたいときは、消してから書き直してください）。</p>
      ${dueField(X, `${esc(nameIn(b, X.via.for))} があなたに返す期限（なくてもOK）`)}
      <div class="field"><label for="ld-memo">メモ（なくてもOK）</label><textarea id="ld-memo" maxlength="300" data-bind="sheet.memo">${esc(X.memo)}</textarea></div>
      ${foot('保存する')}`;
    const typeSeg = X.id ? '' : `<div><div class="seg"><button type="button" data-act="ld-type" data-v="lend" aria-pressed="${X.ltype === 'lend'}">貸した・立て替えた</button><button type="button" data-act="ld-type" data-v="cover" aria-pressed="${X.ltype === 'cover'}">代わりに返した（肩代わり）</button></div></div>`;
    if (X.ltype === 'cover') return typeSeg + coverBody(X, b);
    const others = b.members.filter((id) => id !== me());
    X.selected.forEach((id) => { if (!others.includes(id)) others.push(id); });
    const chips = others.length ? `<div class="filters">${others.map((id) => {
      const on = X.selected.includes(id), locked = on && X.paid[id] > 0;
      return `<button type="button" class="pillbtn" data-act="ld-toggle" data-to="${esc(id)}" aria-pressed="${on}" ${locked ? 'disabled title="返済の記録があるので外せません"' : ''}>${esc(nameIn(b, id))}</button>`;
    }).join('')}</div>` : `<p class="hint">まだほかの人がいません。「招待する」でリンクを送って、参加してもらってください。</p>`;
    const amounts = X.mode === 'each'
      ? (X.selected.length ? `<div class="amount-rows">${X.selected.map((id) => `<div class="amount-row"><label class="name" for="amt-${esc(id)}">${esc(nameIn(b, id))}${X.paid[id] ? `<small>返済済み ${yen(X.paid[id])}</small>` : ''}</label>
          <div class="yen"><span>¥</span><input id="amt-${esc(id)}" inputmode="numeric" data-bind="sheet.amount" data-key="${esc(id)}" value="${esc(X.amounts[id] || '')}" placeholder="0"></div></div>`).join('')}</div>` : '')
      : `<div class="two"><div class="field"><label for="ld-total">払った合計</label><div class="yen"><span>¥</span><input id="ld-total" inputmode="numeric" data-bind="sheet.total" value="${esc(X.total)}" placeholder="12000"></div></div>
          <label class="check" style="align-self:end"><input type="checkbox" id="ld-self" data-bind="sheet.includeSelf" ${X.includeSelf ? 'checked' : ''}> 自分の分も入れて割る</label></div>`;
    const payChips = others.map((id) => `<button type="button" class="pillbtn" data-act="ld-paidto" data-to="${esc(id)}" aria-pressed="${X.paidTo === id}">${esc(nameIn(b, id))}</button>`).join('');
    return `${typeSeg}<div class="two">
        <div class="field"><label for="ld-title">なにに貸した？</label><input id="ld-title" maxlength="60" data-bind="sheet.title" value="${esc(X.title)}" placeholder="例：焼肉代・電車代"></div>
        <div class="field"><label for="ld-date">貸した日</label><input id="ld-date" type="date" data-bind="sheet.date" value="${esc(X.date)}"></div>
      </div>
      <fieldset><legend>だれに貸した？（何人でも）</legend>${chips}</fieldset>
      <fieldset><legend>金額の決め方</legend>
        <div><div class="seg"><button type="button" data-act="ld-mode" data-v="each" aria-pressed="${X.mode === 'each'}">人ごとに入れる</button><button type="button" data-act="ld-mode" data-v="split" aria-pressed="${X.mode === 'split'}">合計を割り勘</button></div></div>
        ${amounts}<div class="preview" id="sh-preview"></div>
      </fieldset>
      ${dueField(X)}
      <fieldset><legend>だれかに払ってあげた？（立て替えたとき・なくてもOK）</legend>
        <p class="hint">例：A が B に払う分を、あなたが B に払った → 「だれに貸した？」は A、ここは B。</p>
        <div class="filters">${payChips}</div>
        <div class="field"><label for="ld-payname">ほか（お店など）</label><input id="ld-payname" maxlength="30" data-bind="sheet.paidToName" value="${esc(X.paidToName)}" placeholder="例：焼肉屋"></div>
      </fieldset>
      <div class="field"><label for="ld-memo">メモ（なくてもOK）</label><textarea id="ld-memo" maxlength="300" data-bind="sheet.memo" placeholder="例：給料日に返すって">${esc(X.memo)}</textarea></div>
      ${foot('保存する')}`;
  }
  // 肩代わり：A が B に借りている分を、あなたが代わりに B に返した
  function coverBody(X, b) {
    const cands = coverCandidates(b);
    const pick = cands.find((x) => `${x.l.id}|${x.s.to}` === X.cvKey);
    const list = cands.length ? `<div class="choice">${cands.map((x) => `<button type="button" data-act="cv-pick" data-v="${esc(x.l.id + '|' + x.s.to)}" aria-current="${X.cvKey === x.l.id + '|' + x.s.to}">
        ${esc(nameIn(b, x.s.to))} <span class="arrow">→</span> ${esc(nameIn(b, x.l.lender))}　<b class="num">${yen(x.rest)}</b><small>${esc(x.l.title || '（内容なし）')}・${esc(fmtDate(x.l.date))}${x.l.due ? '・期限 ' + esc(fmtDate(x.l.due)) : ''}</small></button>`).join('')}</div>`
      : `<p class="hint">いま、ほかの人どうしの返していない借りはありません。<br>まだ記録になっていない分を立て替えたときは「貸した・立て替えた」で、借りた人をえらんで「だれかに払ってあげた？」に払った先を入れてください。</p>`;
    return `<p class="hint">だれかの借りを、あなたが代わりに返したとき。返した先が「認める」と、その人の借りが減って、代わりにあなたに返すことになります。</p>
      <fieldset><legend>だれの借りを、代わりに返した？（借りた人 → 貸した人）</legend>${list}</fieldset>
      ${pick ? `<div class="two">
        <div class="field"><label for="cv-amount">代わりに返した金額</label><div class="yen"><span>¥</span><input id="cv-amount" inputmode="numeric" data-bind="sheet.cvAmount" value="${esc(X.cvAmount)}"></div></div>
        <div class="field"><label for="ld-date">返した日</label><input id="ld-date" type="date" data-bind="sheet.date" value="${esc(X.date)}"></div></div>
        ${dueField(X, `${esc(nameIn(b, pick.s.to))} があなたに返す期限（なくてもOK）`)}
        <div class="field"><label for="cv-note">ひとこと（なくてもOK）</label><input id="cv-note" maxlength="100" data-bind="sheet.cvNote" value="${esc(X.cvNote)}" placeholder="例：間に合わなかったので代わりに払いました"></div>
        <div class="preview" id="sh-preview"></div>${foot('記録する')}` : `<div class="row end"><button type="button" class="btn" data-act="sheet-close">やめる</button></div>`}`;
  }
  function saveCover() {
    const X = U.sheet, b = book();
    const pick = coverCandidates(b).find((x) => `${x.l.id}|${x.s.to}` === X.cvKey);
    if (!pick) return sheetErr('だれの借りかをえらんでください');
    const amt = toInt(X.cvAmount);
    if (amt <= 0) return sheetErr('代わりに返した金額を入れてください');
    if (amt > pick.rest) return sheetErr(`${nameIn(b, pick.s.to)} の残りは ${yen(pick.rest)} です`);
    if (!okDate(X.date)) return sheetErr('返した日を入れてください');
    const A = pick.s.to, B = pick.l.lender;
    const body = { title: `${nameIn(b, B)}への返済を肩代わり`, date: X.date, memo: (X.cvNote || '').trim(), mode: 'each', total: 0, includeSelf: false, due: X.due || '',
      shares: [{ to: A, amount: amt, repayments: [] }] };
    run(KStore.coverDebt(b.id, { loanId: pick.l.id, lender: B, for: A, amount: amt, date: X.date, note: (X.cvNote || '').trim(), title: pick.l.title }, body),
      `✓ ${nameIn(b, A)} の代わりに ${nameIn(b, B)} に返した記録をつけました`);
    closeSheet(); U.sub = 'entries'; render();
  }
  function updatePreview() {
    const X = U.sheet, el = $('#sh-preview');
    if (!X || !el) return;
    const b = book();
    if (X.sheetKind !== 'loan') return;
    if (X.ltype === 'cover') {
      const pick = coverCandidates(b).find((x) => `${x.l.id}|${x.s.to}` === X.cvKey), amt = toInt(X.cvAmount);
      if (pick) el.innerHTML = `${esc(nameIn(b, pick.l.lender))} に、${esc(nameIn(b, pick.s.to))} の代わりに <span class="num">${yen(amt)}</span> 返した記録になります。<br>${esc(nameIn(b, pick.l.lender))} が認めると、${esc(nameIn(b, pick.s.to))} の ${esc(nameIn(b, pick.l.lender))} への借りが ${yen(amt)} 減って、${esc(nameIn(b, pick.s.to))} はあなたに ${yen(amt)} 返すことになります。`;
      return;
    }
    if (X.mode === 'split') {
      const c = splitCalc(X);
      el.innerHTML = !c ? '相手をえらんで合計を入れると、1人いくらかが出ます。'
        : `${c.n}人で割って1人 <span class="num">${yen(c.per)}</span>。${X.selected.map((id) => esc(nameIn(b, id))).join('・')} に ${yen(c.per)} ずつ貸した記録になります。${c.rem ? `<br>割り切れない ${yen(c.rem)} はあなたの分になります。` : ''}`;
    } else {
      el.innerHTML = X.selected.length ? `貸した合計 <span class="num">${yen(X.selected.reduce((a, id) => a + toInt(X.amounts[id]), 0))}</span>` : '相手をえらぶと、ここに合計が出ます。';
    }
  }
  function saveLoan() {
    const X = U.sheet, b = book();
    if (X.ltype === 'cover' && !X.id) return saveCover();
    if (X.via) {
      const prev = myLoan(X.id);
      if (!prev) return closeSheet();
      run(KStore.saveLoan(b.id, X.id, { ...prev, id: undefined, due: X.due || '', memo: X.memo.trim() }), '✓ 直しました');
      return closeSheet();
    }
    if (!okDate(X.date)) return sheetErr('貸した日を入れてください');
    if (!X.selected.length) return sheetErr('貸した相手を1人以上えらんでください');
    const amounts = {};
    if (X.mode === 'split') {
      const c = splitCalc(X);
      if (!c) return sheetErr('払った合計を入れてください');
      if (c.per <= 0) return sheetErr('1人あたりが0円になってしまいます。合計を見直してください');
      X.selected.forEach((id) => { amounts[id] = c.per; });
    } else {
      for (const id of X.selected) { const v = toInt(X.amounts[id]); if (v <= 0) return sheetErr(`${nameIn(b, id)} に貸した金額を入れてください`); amounts[id] = v; }
    }
    for (const id of X.selected) if (X.paid[id] > amounts[id]) return sheetErr(`${nameIn(b, id)} はもう ${yen(X.paid[id])} 返しているので、それより少なくはできません`);
    const prev = X.id ? myLoan(X.id) : null;
    const shares = X.selected.map((id) => ({ to: id, amount: amounts[id], repayments: prev ? ((prev.shares.find((s) => s.to === id) || {}).repayments || []) : [] }));
    const body = { title: X.title.trim(), date: X.date, memo: X.memo.trim(), mode: X.mode, total: X.mode === 'split' ? toInt(X.total) : 0, includeSelf: X.mode === 'split' && !!X.includeSelf, shares, createdAt: X.createdAt || 0,
      due: X.due || '', paidTo: X.paidTo && !X.selected.includes(X.paidTo) ? X.paidTo : '', paidToName: X.paidTo ? '' : (X.paidToName || '').trim() };
    const isNew = !X.id;
    run(KStore.saveLoan(b.id, X.id, body), isNew ? '✓ 記録しました' : '✓ 直しました');
    closeSheet();
    if (isNew) { U.sub = 'entries'; render(); }
  }

  // 自分だけの帳簿の記録
  function pentryOpen(id) {
    const e = id ? S.personal.find((x) => x.id === id) : null;
    openSheet('pentry', {
      id: e ? e.id : null, dir: e ? e.dir : 'lent', who: e ? e.who : '', title: e ? e.title : '', date: e ? e.date || today() : today(),
      amount: e ? String(e.amount) : '', memo: e ? e.memo : '', paid: e ? entryStat(e).paid : 0, createdAt: e ? e.createdAt : 0, due: e ? e.due : '',
    });
  }
  function pentryBody(X) {
    const names = [...new Set(S.personal.map((e) => e.who).filter(Boolean))];
    return `<div><div class="seg"><button type="button" data-act="pe-dir" data-v="lent" aria-pressed="${X.dir === 'lent'}">貸した</button><button type="button" data-act="pe-dir" data-v="borrowed" aria-pressed="${X.dir === 'borrowed'}">借りた</button></div></div>
      <div class="two">
        <div class="field"><label for="pe-who">${X.dir === 'lent' ? 'だれに貸した？' : 'だれに借りた？'}</label><input id="pe-who" maxlength="30" list="pe-names" data-bind="sheet.who" value="${esc(X.who)}" placeholder="例：たけし"><datalist id="pe-names">${names.map((n) => `<option value="${esc(n)}">`).join('')}</datalist></div>
        <div class="field"><label for="pe-date">日付</label><input id="pe-date" type="date" data-bind="sheet.date" value="${esc(X.date)}"></div>
      </div>
      <div class="two">
        <div class="field"><label for="pe-title">なにの？</label><input id="pe-title" maxlength="60" data-bind="sheet.title" value="${esc(X.title)}" placeholder="例：ゲーム代"></div>
        <div class="field"><label for="pe-amount">金額</label><div class="yen"><span>¥</span><input id="pe-amount" inputmode="numeric" data-bind="sheet.amount" value="${esc(X.amount)}" placeholder="0"></div>${X.paid ? `<span class="hint">返済済み ${yen(X.paid)}</span>` : ''}</div>
      </div>
      ${dueField(X)}
      <div class="field"><label for="pe-memo">メモ（なくてもOK）</label><textarea id="pe-memo" maxlength="300" data-bind="sheet.memo">${esc(X.memo)}</textarea></div>
      ${foot('保存する')}`;
  }
  function savePentry() {
    const X = U.sheet;
    const amount = toInt(X.amount);
    if (!X.who.trim()) return sheetErr('相手の名前を入れてください');
    if (!okDate(X.date)) return sheetErr('日付を入れてください');
    if (amount <= 0) return sheetErr('金額を入れてください');
    if (X.paid > amount) return sheetErr(`もう ${yen(X.paid)} 返済しているので、それより少なくはできません`);
    const prev = X.id ? S.personal.find((e) => e.id === X.id) : null;
    run(KStore.savePersonal(X.id, { dir: X.dir, who: X.who.trim(), title: X.title.trim(), date: X.date, amount, memo: X.memo.trim(), due: X.due || '', repayments: prev ? prev.repayments : [], createdAt: X.createdAt || 0 }), X.id ? '✓ 直しました' : '✓ 記録しました');
    closeSheet();
  }

  // 帳簿
  async function peekJoin() {
    const X = U.sheet;
    if (!X || X.sheetKind !== 'join') return;
    const m = /([A-Za-z0-9]{10,40})\s*$/.exec((X.code || '').replace(/[?&#].*join=/, ' ').trim());
    const code = m ? m[1] : '';
    if (!code) return sheetErr('招待コードを入れてください');
    const have = S.books.find((x) => x.id === code);
    if (have) { U.bookId = code; store('kashikari-book', code); U.tab = 'shared'; toast(`「${have.name}」にはもう参加しています`); closeSheet(); return; }
    sheetErr(''); X.busy = true;
    const p = await KStore.peekBook(code);
    if (U.sheet !== X) return;
    X.busy = false;
    if (!p) return sheetErr('その招待コードの帳簿が見つかりません。コードを確かめてください');
    X.code = code; X.peek = p; drawSheet();
  }
  async function submitSheet() {
    const X = U.sheet;
    if (!X || X.busy) return;
    const b = book();
    if (KB.has(X.sheetKind)) return KB.submit(X.sheetKind);
    if (X.sheetKind === 'loan') return saveLoan();
    if (X.sheetKind === 'pentry') return savePentry();
    if (X.sheetKind === 'delbook') return deleteBook();
    if (['card', 'creport', 'charge'].includes(X.sheetKind)) return submitCardSheet(X.sheetKind);
    if (X.sheetKind === 'newbook') {
      const name = X.name.trim(), nick = X.nick.trim();
      if (!name) return sheetErr('帳簿の名前を入れてください');
      if (!nick) return sheetErr('呼び名を入れてください');
      X.busy = true;
      try { const id = await KStore.createBook(name, nick); U.bookId = id; store('kashikari-book', id); U.tab = 'shared'; toast('✓ 帳簿をつくりました。「招待する」でリンクを送ってください'); closeSheet(); }
      catch (e) { X.busy = false; sheetErr(errText(e)); }
      return;
    }
    if (X.sheetKind === 'join') {
      if (!X.peek) return peekJoin();
      const nick = X.nick.trim();
      if (!nick) return sheetErr('呼び名を入れてください');
      X.busy = true;
      try {
        await KStore.joinBook(X.peek.id, nick);
        U.bookId = X.peek.id; store('kashikari-book', X.peek.id); U.tab = 'shared'; U.pendingJoin = '';
        try { sessionStorage.removeItem('kashikari-join'); } catch (e) {}
        toast(`✓ 「${X.peek.name}」に参加しました`); closeSheet();
      } catch (e) { X.busy = false; sheetErr(errText(e)); }
      return;
    }
    if (X.sheetKind === 'rename') {
      const nick = X.nick.trim(); if (!nick) return sheetErr('呼び名を入れてください');
      run(KStore.renameMe(b.id, nick), '✓ 呼び名を変えました'); closeSheet(); return;
    }
    if (X.sheetKind === 'renamebook') {
      const name = X.name.trim(); if (!name) return sheetErr('名前を入れてください');
      run(KStore.renameBook(b.id, name), '✓ 帳簿の名前を変えました'); closeSheet();
    }
  }

  // 「⚙️ アプリと更新」：いまの版・いちばん新しい版・更新を確認する・更新する・うまくいかなかった理由
  function appInfoBody() {
    const I = kkApkInfo(), L = I.latest, st = I.status || {};
    const when = (t) => { if (!t) return ''; const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
    const vname = (name, code) => (name ? `${esc(name)}` : '') + (code ? `<small class="faint">（${code}）</small>` : '');
    const notes = L.notes.length ? `<div><p class="hint">${L.name ? esc(L.name) + ' で' : '新しい版で'}変わったこと</p><ul class="notes">${L.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>` : '';
    const reload = `<div class="row"><button type="button" class="btn small" data-act="page-reload">画面を読み込み直す</button><span class="hint">画面（ウェブ版）が古いままのときに</span></div>`;
    if (!I.inApp) {
      return `<p class="hint">Android アプリ（ホーム画面のウィジェット付き）のいちばん新しい版です。</p>
        <div class="vers"><div class="bal"><span class="label">いちばん新しい版</span><span class="num">${vname(L.name, L.code) || '…'}</span></div>
          <div class="bal"><span class="label">確認した時刻</span><span class="num">${when(L.checkedAt) || '…'}</span></div></div>
        ${L.error ? `<div class="upd-state bad">⚠️ ${esc(L.error)}</div>` : ''}
        <div class="row"><a class="btn primary" href="${esc(ANDROID_APK_SELF_URL)}" download="kashikari.apk">📲 ダウンロード</a><button type="button" class="btn small" data-act="apk-check-web">もう一度確認</button></div>
        ${notes}${reload}`;
    }
    const A = I.apk, cur = I.current || {};
    let state, cls;
    if (A.phase === 'checking') { state = '確認しています…'; cls = ''; }
    else if (A.phase === 'downloading') { state = `📥 新しい版（${esc(L.name || L.code)}）をダウンロードしています…`; cls = 'new'; }
    else if (A.phase === 'installing') { state = '📲 入れ替えています。確認の画面が出たら「更新」（またはインストール）を押してください。終わるとアプリが開き直します'; cls = 'new'; }
    else if (A.phase === 'failed') { state = `⚠️ うまくいきませんでした：${esc(A.error)}`; cls = 'bad'; }
    else if (I.outdated && (A.ready || st.ready >= L.code)) { state = A.silent || st.canSilent ? '✓ 新しい版をダウンロードしました。アプリを閉じて1分たつと自動で入れ替わります（いま「更新する」でもOK）' : '✓ 新しい版をダウンロードしました。「更新する」を押すと確認の画面が出ます'; cls = 'new'; }
    else if (I.outdated) { state = `新しい版（${esc(L.name || L.code)}）があります。「更新する」を押してください`; cls = 'new'; }
    else if (L.checkedAt) { state = '✦ いちばん新しい版です'; cls = 'ok'; }
    else { state = '確認しています…'; cls = ''; }
    const lastErr = st.error && A.phase !== 'failed' ? `<div class="upd-state bad">前にうまくいかなかったこと（${when(st.errorAt)}）：${esc(st.error)}<div class="row end"><button type="button" class="btn small" data-act="apk-clear">消す</button></div></div>` : '';
    const perm = st.canInstall === false ? `<p class="hint">「この提供元のアプリを許可」がオフです。「更新する」を押すと設定の画面が開くので、オンにしてから戻ってもう一度押してください。</p>` : '';
    const busy = A.phase === 'checking' || A.phase === 'downloading';
    return `<div class="vers">
        <div class="bal"><span class="label">いまのアプリ</span><span class="num">${vname(cur.name, cur.code) || '?'}</span></div>
        <div class="bal"><span class="label">いちばん新しい版</span><span class="num">${vname(L.name, L.code)}</span></div>
      </div>
      <div class="upd-state ${cls}">${state}</div>
      ${L.error ? `<p class="hint">${esc(L.error)}</p>` : ''}
      ${lastErr}${perm}
      <div class="row"><button type="button" class="btn" data-act="apk-check" ${busy ? 'disabled' : ''}>🔄 更新を確認する</button>
        <button type="button" class="btn primary" data-act="apk-install" ${I.outdated && !busy ? '' : 'disabled'}>📲 更新する</button></div>
      <p class="hint">ふだんは、アプリを開いたときに自動で確かめて、新しい版があればアプリを閉じたときに入れ替わります${L.checkedAt ? `（最後に確認：${when(L.checkedAt)}）` : ''}。</p>
      <div class="row"><button type="button" class="btn link" data-act="apk-browser">うまくいかないとき：ブラウザでダウンロードして入れる</button></div>
      ${notes}${reload}`;
  }

  // 帳簿を消す（つくった人だけ）。閉じる → 中の記録を消す → 帳簿を消す。途中で止まっても、もう一度で続きから
  async function deleteBook() {
    const b = book(), X = U.sheet;
    if (!b || b.owner !== me()) return;
    if (X && X.sheetKind === 'delbook') {
      if (X.busy) return;
      if (X.confirmName.trim() !== b.name) return sheetErr('帳簿の名前がちがいます');
      X.busy = true; sheetErr(''); drawSheet();
    }
    try {
      await KStore.deleteBook(b.id);
      toast(`🗑 「${b.name}」を消しました`);
      U.bookId = ''; store('kashikari-book', null);
      if (U.sheet) closeSheet(); else render();
    } catch (e) {
      if (U.sheet) { U.sheet.busy = false; drawSheet(); sheetErr(errText(e)); } else toast(errText(e), true);
    }
  }

  // 返済
  function saveRepay() {
    const R = U.repay;
    if (!R) return;
    const amt = toInt(R.amount);
    if (!okDate(R.date)) return toast('日付を入れてください', true);
    if (R.scope === 'loan') {
      const l = myLoan(R.id), s = l && l.shares.find((x) => x.to === R.to);
      if (!s) { U.repay = null; render(); return; }
      const rest = shareStat(s).rest;
      if (amt <= 0) return toast('金額を入れてください', true);
      if (amt > rest) return toast(`残りは ${yen(rest)} です`, true);
      const shares = l.shares.map((x) => ({ ...x, repayments: x.to === R.to ? [...x.repayments, { id: rid(), date: R.date, amount: amt }] : x.repayments }));
      U.repay = null; render();
      run(KStore.setShares(book().id, l.id, shares), rest === amt ? `✓ ${nameIn(book(), R.to)} の分が完済になりました` : '✓ 返済を記録しました');
    } else {
      const e = S.personal.find((x) => x.id === R.id);
      if (!e) { U.repay = null; render(); return; }
      const rest = entryStat(e).rest;
      if (amt <= 0) return toast('金額を入れてください', true);
      if (amt > rest) return toast(`残りは ${yen(rest)} です`, true);
      U.repay = null; render();
      run(KStore.savePersonal(e.id, { ...e, id: undefined, repayments: [...e.repayments, { id: rid(), date: R.date, amount: amt }] }), rest === amt ? '✓ 完済になりました' : '✓ 返済を記録しました');
    }
  }
  function sendClaim() {
    const C = U.claimForm, b = book();
    const l = C && loansOf(b).find((x) => x.id === C.loanId);
    const s = l && l.shares.find((x) => x.to === me());
    if (!s) { U.claimForm = null; render(); return; }
    const amt = toInt(C.amount), rest = shareStat(s).rest;
    if (amt <= 0) return toast('返した金額を入れてください', true);
    if (amt > rest) return toast(`残りは ${yen(rest)} です`, true);
    if (!okDate(C.date)) return toast('返した日を入れてください', true);
    U.claimForm = null; render();
    run(KStore.sendClaim(b.id, { loanId: l.id, lender: l.lender, amount: amt, date: C.date, note: (C.note || '').trim() }), `✓ ${nameIn(b, l.lender)} に「返したよ」を送りました`);
  }
  function approveClaim(id) {
    const b = book(), c = claimsOf(b).find((x) => x.id === id);
    const who = c && (c.for || c.from);
    const l = c && myLoan(c.loanId), s = l && l.shares.find((x) => x.to === who);
    if (!s) return toast('その記録が見つかりません。「断る」で閉じてください', true);
    const rest = shareStat(s).rest, amt = Math.min(rest, c.amount);
    if (!amt) return;
    const shares = l.shares.map((x) => ({ ...x, repayments: x.to === who ? [...x.repayments, { id: c.id, date: c.date, amount: amt, claim: c.id, by: c.from }] : x.repayments }));
    run(KStore.approveClaim(b.id, c, shares), rest === amt ? `✓ 認めました。${nameIn(b, who)} の分が完済です` : '✓ 認めました');
  }

  // ---------- 操作 ----------
  function setPath(path, t) {
    const [root, key] = path.split('.');
    const o = root === 'kb' ? KB.state : root === 'login' ? U.login : root === 'repay' ? U.repay : root === 'claimForm' ? U.claimForm : root === 'sheet' ? U.sheet : null;
    if (!o) return;
    if (key === 'amount' && root === 'sheet' && U.sheet.sheetKind === 'loan') U.sheet.amounts[t.dataset.key] = t.value;
    else if (key === 'cat' && root === 'sheet' && U.sheet.sheetKind === 'kb-budget') U.sheet.cats[t.dataset.key] = t.value;
    else if (key === 'mv' && root === 'sheet' && U.sheet.moves) U.sheet.moves[+t.dataset.key].amount = t.value;
    else o[key] = t.type === 'checkbox' ? t.checked : t.value;
    if (root === 'sheet') { updatePreview(); KB.afterDraw(); }
    if (root === 'kb') render();
    if (root === 'login' && key === 'create') render();
  }
  const onBind = (e) => { const p = e.target.dataset && e.target.dataset.bind; if (p) setPath(p, e.target); };
  document.addEventListener('input', onBind);
  document.addEventListener('change', (e) => {
    onBind(e);
    if (e.target.id === 'show-done') { U.showDone = e.target.checked; render(); }
    if (e.target.id === 'pshow-done') { U.pShowDone = e.target.checked; render(); }
    if (e.target.id === 'cr-photo' && U.sheet && e.target.files && e.target.files[0]) {
      const X = U.sheet; X.busy = true; const note = $('#cr-photo-note'); if (note) note.textContent = '写真を小さくしています…';
      shrinkImage(e.target.files[0]).then((data) => { X.busy = false; X.photo = data; X.preview = data; X.hasPhoto = true; if (U.sheet === X) drawSheet(); },
        (err) => { X.busy = false; if (U.sheet === X) sheetErr(err.message || '写真を読めませんでした'); });
    }
  });
  document.addEventListener('submit', (e) => {
    e.preventDefault();
    const k = e.target.dataset.form;
    if (k === 'login') doLogin('email');
    else if (k === 'repay') saveRepay();
    else if (k === 'claim') sendClaim();
    else if (k === 'sheet') submitSheet();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && U.sheet) closeSheet(); });
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const a = el.dataset.act, d = el.dataset;
    if (a === 'backdrop') { if (e.target === el) closeSheet(); return; }
    switch (a) {
      case 'tab': U.tab = d.v; store('kashikari-tab', d.v); U.confirm = null; U.repay = null; U.claimForm = null; window.scrollTo(0, 0); break;
      case 'sub': U.sub = d.v; U.confirm = null; break;
      case 'filter': U.filter = d.v; break;
      case 'pfilter': U.pFilter = d.v; break;
      case 'login-google': doLogin('google'); return;
      case 'login-browser': doLogin('browser'); return;
      case 'logout': closeSheet(); run(KStore.signOut(), 'ログアウトしました'); return;
      case 'sheet': openSheet(d.v); return;
      case 'sheet-close': closeSheet(); return;
      case 'copy': copy(d.v); return;
      case 'book-pick': U.bookId = d.id; store('kashikari-book', d.id); U.confirm = null; U.repay = null; U.claimForm = null; closeSheet(); return;
      case 'join-peek': peekJoin(); return;
      case 'loan-new': loanOpen(null); return;
      case 'loan-edit': U.confirm = null; loanOpen(d.id); return;
      case 'loan-del': U.confirm = { kind: 'loan', id: d.id }; break;
      case 'loan-del-yes': {
        const c = U.confirm; U.confirm = null; const l = c && myLoan(c.id);
        if (l) {
          const vc = l.via ? claimsOf(book()).find((x) => x.id === l.via.claimId && x.from === me() && x.status !== 'approved') : null;
          run(vc ? KStore.deleteCover(book().id, l.id, vc.id) : KStore.deleteLoan(book().id, l.id), '記録を消しました');
        }
        break;
      }
      case 'cover-cancel': {
        const c = claimsOf(book()).find((x) => x.id === d.id);
        if (c) run(KStore.deleteCover(book().id, c.coverLoanId && myLoan(c.coverLoanId) ? c.coverLoanId : '', c.id), c.status === 'rejected' ? '消しました' : '肩代わりを取り消しました');
        return;
      }
      case 'ld-type': if (U.sheet) { U.sheet.ltype = d.v; U.sheet.err = ''; drawSheet(); } return;
      case 'cv-pick': if (U.sheet) { U.sheet.cvKey = d.v; const p = coverCandidates(book()).find((x) => `${x.l.id}|${x.s.to}` === d.v); if (p) U.sheet.cvAmount = String(p.rest); drawSheet(); } return;
      case 'ld-paidto': if (U.sheet) { U.sheet.paidTo = U.sheet.paidTo === d.to ? '' : d.to; drawSheet(); } return;
      case 'due-set': if (U.sheet) {
        const t = new Date();
        if (d.v === 'end') { const e = new Date(t.getFullYear(), t.getMonth() + 1, 0); U.sheet.due = ymd(e.getDate() === t.getDate() ? new Date(t.getFullYear(), t.getMonth() + 2, 0) : e); }
        else if (d.v) { t.setDate(t.getDate() + +d.v); U.sheet.due = ymd(t); } else U.sheet.due = '';
        drawSheet();
      } return;
      case 'ld-mode': if (U.sheet) { U.sheet.mode = d.v; drawSheet(); } return;
      case 'ld-toggle': if (U.sheet) { const X = U.sheet, i = X.selected.indexOf(d.to); if (i >= 0) { if (X.paid[d.to] > 0) return; X.selected.splice(i, 1); } else X.selected.push(d.to); drawSheet(); } return;
      case 'pe-dir': if (U.sheet) { U.sheet.dir = d.v; drawSheet(); } return;
      case 'repay-open': { const l = myLoan(d.id), s = l && l.shares.find((x) => x.to === d.to); U.repay = { scope: 'loan', id: d.id, to: d.to, amount: s ? String(shareStat(s).rest) : '', date: today() }; U.confirm = null; break; }
      case 'prepay-open': { const x = S.personal.find((y) => y.id === d.id); U.repay = { scope: 'personal', id: d.id, amount: x ? String(entryStat(x).rest) : '', date: today() }; U.confirm = null; break; }
      case 'repay-full': {
        const R = U.repay; if (!R) return;
        if (R.scope === 'loan') { const l = myLoan(R.id), s = l && l.shares.find((x) => x.to === R.to); if (s) R.amount = String(shareStat(s).rest); }
        else { const x = S.personal.find((y) => y.id === R.id); if (x) R.amount = String(entryStat(x).rest); }
        const i = $('#rp-amount'); if (i) i.value = R.amount; return;
      }
      case 'repay-cancel': U.repay = null; break;
      case 'rep-del': U.confirm = { kind: 'rep', id: d.id, to: d.to, rid: d.rid }; break;
      case 'rep-del-yes': {
        const c = U.confirm; U.confirm = null; const l = c && myLoan(c.id);
        if (l) run(KStore.setShares(book().id, l.id, l.shares.map((x) => ({ ...x, repayments: x.repayments.filter((r) => !(x.to === c.to && r.id === c.rid)) }))), '返済の記録を取り消しました');
        break;
      }
      case 'claim-open': { const l = loansOf(book()).find((x) => x.id === d.id), s = l && l.shares.find((x) => x.to === me()); U.claimForm = { loanId: d.id, amount: s ? String(shareStat(s).rest) : '', date: today(), note: '' }; break; }
      case 'claim-cancel': U.claimForm = null; break;
      case 'claim-approve': approveClaim(d.id); return;
      case 'claim-reject': run(KStore.rejectClaim(book().id, d.id), '断りました'); return;
      case 'claim-delete': run(KStore.deleteClaim(book().id, d.id), '消しました'); return;
      case 'pentry-new': pentryOpen(null); return;
      case 'pentry-edit': U.confirm = null; pentryOpen(d.id); return;
      case 'pentry-del': U.confirm = { kind: 'pentry', id: d.id }; break;
      case 'pentry-del-yes': { const c = U.confirm; U.confirm = null; if (c) run(KStore.deletePersonal(c.id), '記録を消しました'); break; }
      case 'prep-del': U.confirm = { kind: 'prep', id: d.id, rid: d.rid }; break;
      case 'prep-del-yes': {
        const c = U.confirm; U.confirm = null; const x = c && S.personal.find((y) => y.id === c.id);
        if (x) run(KStore.savePersonal(x.id, { ...x, id: undefined, repayments: x.repayments.filter((r) => r.id !== c.rid) }), '返済の記録を取り消しました');
        break;
      }
      case 'confirm-no': U.confirm = null; break;
      case 'apk-install': kkInstallApk(); return;
      case 'apk-check': kkCheckApkUpdate(true); return;
      case 'apk-check-web': kkFetchLatest(); return;
      case 'apk-browser': kkOpenApkInBrowser(); return;
      case 'apk-clear': try { window.KashikariApp.apkClearError(); } catch (e) {} drawSheet(); return;
      case 'page-reload': location.reload(); return;
      case 'leave-yes': { const b = book(); if (b) { run(KStore.leaveBook(b.id), `「${b.name}」から抜けました`); U.bookId = ''; store('kashikari-book', null); } closeSheet(); return; }
      case 'delbook-go': deleteBook(); return;
      default: { if (cardClick(a, d)) return; const r = KB.click(a, d); if (r === 'render') break; return; }
    }
    render();
    if (a === 'repay-open' || a === 'prepay-open' || a === 'claim-open') setTimeout(() => { const i = $('#rp-amount') || $('#cl-amount'); if (i) { i.focus(); i.select(); } }, 40);
  });

  // Android アプリ：戻るボタン（開いているものを閉じる。閉じるものが無ければ false）
  window.kashikariAppBack = () => {
    if (U.sheet) { closeSheet(); return true; }
    if (U.repay || U.claimForm || U.confirm) { U.repay = null; U.claimForm = null; U.confirm = null; render(); return true; }
    return false;
  };
  // ウィジェットから開いた
  window.__kashikariOpen = (view) => {
    if (U.sheet) closeSheet();
    if (view === 'personal') U.tab = 'personal';
    else { U.tab = 'shared'; U.sub = 'summary'; const p = pendingForMe()[0]; if (p) U.bookId = p.b.id; }
    window.scrollTo(0, 0); render();
  };
  window.addEventListener('kashikari-apk', (e) => { U.apk = e.detail || {}; render(); if (U.sheet && U.sheet.sheetKind === 'appinfo') drawSheet(); });

  // ---------- データが変わったら ----------
  let joinAsked = false;
  KStore.subscribe((s) => {
    S = s;
    // 消えた記録への入力・確認をとじる
    if (U.repay && U.repay.scope === 'loan' && !myLoan(U.repay.id)) U.repay = null;
    if (U.confirm && (U.confirm.kind === 'loan' || U.confirm.kind === 'rep') && !myLoan(U.confirm.id)) U.confirm = null;
    // 招待リンクから来た
    if (S.user && S.booksReady && U.pendingJoin && !joinAsked) {
      joinAsked = true;
      const code = U.pendingJoin;
      if (S.books.some((b) => b.id === code)) { U.bookId = code; U.pendingJoin = ''; try { sessionStorage.removeItem('kashikari-join'); } catch (e) {} }
      else { U.tab = 'shared'; openSheet('join', { code }); }
    }
    render();
    KB.fillRecurring();
    KB.publishLink();
    kkSendWidget(S);
  });
  $('#appBtn').addEventListener('click', () => { openSheet('appinfo'); kkFetchLatest(); });
  $('#syncBtn').addEventListener('click', () => { if (S.user) openSheet('account'); else { U.tab = 'shared'; render(); } });
  $('#apk').addEventListener('click', (e) => { if (e.target.closest('button')) kkInstallApk(); });
})();
