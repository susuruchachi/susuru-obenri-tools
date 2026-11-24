// --- 貸し借り帳のデータ（Firebase：貸し借り帳だけのプロジェクト。設定は firebase-config.js）---
// ・ログインは Google かメール
// ・みんなの帳簿：kashikari_books/{帳簿ID} = { name, owner, members: [uid], names: { uid: 呼び名 }, createdAt }
//     帳簿ID を知っている人（招待リンク・招待コード）だけが中を見て、参加できる
//   貸した記録：kashikari_books/{帳簿ID}/loans/{id} = { lender, title, date, memo, mode, total, includeSelf, shares: [{ to, amount, repayments: [{ id, date, amount, claim? }] }], createdAt, updatedAt }
//     書けるのは貸した人（lender）だけ（Firestore のルールで決めている。kashikari/firestore.rules）
//   付け替え：kashikari_books/{帳簿ID}/handoffs/{id} = { loanId, lender, from: いま借りている人, to: 代わりに返す人, by: 頼んだ人, amount, note, title,
//             toOk, lenderOk, status: pending|done|declined|rejected, newLoanId, createdAt, decidedAt }
//   返したよ：kashikari_books/{帳簿ID}/claims/{id} = { loanId, lender, from, amount, date, note, status: pending|approved|rejected, createdAt, decidedAt }
//     借りた人が出して、貸した人が「認める」と、貸した記録に返済が入る
// ・自分だけの帳簿：kashikari_private/{uid}/entries/{id} = { dir: lent|borrowed, who, title, date, memo, amount, repayments, createdAt, updatedAt }（本人しか読めない）
// ・オフラインで変えた分は、この端末に覚えておき（enablePersistence）、つながったら送る
(function () {
  const SETTINGS = window.KASHIKARI_FIREBASE || {};
  const FIREBASE_CONFIG = SETTINGS.config || {};
  const WEB_CLIENT_ID = SETTINGS.webClientId || '';
  const BOOKS = 'kashikari_books', PRIVATE = 'kashikari_private';

  let auth = null, db = null, user = null;
  let booksUnsub = null, privUnsub = null, txUnsub = null, kbUnsub = null, shUnsub = null, linkUnsub = null, linkCode = '';
  const bookSubs = {}; // 帳簿ID -> [unsub, unsub]
  const st = {
    available: false, configMissing: !(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId), authReady: false, user: null, error: '',
    online: typeof navigator === 'undefined' || navigator.onLine !== false, pending: false,
    booksReady: false, books: [], loans: {}, claims: {}, handoffs: {}, privateReady: false, personal: [],
    cards: {}, cardReports: {}, cardCharges: {}, // 家族のカード（帳簿ID ごと）
    txReady: false, tx: [], kbReady: false, kb: null, // 家計簿（収入・支出・振替）と、その設定（分類・口座・予算・固定費）
    shiftsReady: false, shifts: [], // 固定費・定期収入の前借り・後払い
    link: null, // 航海日誌との連携：kashikari_links/{連携コード} = { owner, feed, warn, feedAt, koukai: 航海日誌の予定, koukaiAt }
  };
  const listeners = new Set();
  let emitQueued = false;
  function emit() {
    if (emitQueued) return;
    emitQueued = true;
    Promise.resolve().then(() => { emitQueued = false; listeners.forEach((fn) => { try { fn(st); } catch (e) { console.error(e); } }); });
  }

  // ---- 読んだデータを整える（ほかの人が書いたものなので、形を確かめる）----
  const num = (v) => (typeof v === 'number' && isFinite(v) && v >= 0 ? Math.round(v) : 0);
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n || 200) : '');
  const reps = (a) => (Array.isArray(a) ? a.filter((r) => r && typeof r === 'object').map((r) => ({ id: str(r.id, 40), date: str(r.date, 10), amount: num(r.amount), claim: str(r.claim, 40), by: str(r.by, 128), handoff: str(r.handoff, 40), moveTo: str(r.moveTo, 128) })) : []);
  const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '');
  function cleanBook(id, v) {
    v = v || {};
    const names = {};
    if (v.names && typeof v.names === 'object') Object.keys(v.names).forEach((k) => { names[k] = str(v.names[k], 20); });
    return { id, name: str(v.name, 40) || '帳簿', closing: v.closing === true, owner: str(v.owner, 128), members: Array.isArray(v.members) ? v.members.filter((x) => typeof x === 'string') : [], names, createdAt: num(v.createdAt) };
  }
  function cleanLoan(id, v) {
    v = v || {};
    return {
      id, lender: str(v.lender, 128), title: str(v.title, 60), date: str(v.date, 10), memo: str(v.memo, 300),
      mode: v.mode === 'split' ? 'split' : 'each', total: num(v.total), includeSelf: !!v.includeSelf,
      due: day(v.due), paidTo: str(v.paidTo, 128), paidToName: str(v.paidToName, 30),
      // 肩代わり（ほかの人の借りを代わりに返した）：{ claimId, loanId, lender: 返した先, for: 代わりに返してあげた人, title: 元の記録 }
      via: v.via && typeof v.via === 'object' ? { claimId: str(v.via.claimId, 40), loanId: str(v.via.loanId, 40), lender: str(v.via.lender, 128), for: str(v.via.for, 128), title: str(v.via.title, 60) } : null,
      // 付け替え（from の借りを、この記録の借り手が引き受けた）：{ id: 付け替えID, loanId: 元の記録, from: 元の借り手, title: 元の記録の内容 }
      handoff: v.handoff && typeof v.handoff === 'object' ? { id: str(v.handoff.id, 40), loanId: str(v.handoff.loanId, 40), from: str(v.handoff.from, 128), title: str(v.handoff.title, 60) } : null,
      shares: Array.isArray(v.shares) ? v.shares.filter((s) => s && typeof s.to === 'string').map((s) => ({ to: s.to, amount: num(s.amount), repayments: reps(s.repayments) })) : [],
      createdAt: num(v.createdAt), updatedAt: num(v.updatedAt),
    };
  }
  function cleanHandoff(id, v) {
    v = v || {};
    return {
      id, loanId: str(v.loanId, 40), lender: str(v.lender, 128), from: str(v.from, 128), to: str(v.to, 128), by: str(v.by, 128), amount: num(v.amount),
      note: str(v.note, 100), title: str(v.title, 60), toOk: v.toOk === true, lenderOk: v.lenderOk === true,
      status: ['done', 'declined', 'rejected'].includes(v.status) ? v.status : 'pending', newLoanId: str(v.newLoanId, 40), createdAt: num(v.createdAt), decidedAt: num(v.decidedAt),
    };
  }
  function cleanClaim(id, v) {
    v = v || {};
    return {
      id, loanId: str(v.loanId, 40), lender: str(v.lender, 128), from: str(v.from, 128), amount: num(v.amount), date: str(v.date, 10),
      note: str(v.note, 100), for: str(v.for, 128), coverLoanId: str(v.coverLoanId, 40), status: ['approved', 'rejected'].includes(v.status) ? v.status : 'pending', createdAt: num(v.createdAt), decidedAt: num(v.decidedAt),
    };
  }
  function cleanTx(id, v) {
    v = v || {};
    return {
      id, kind: ['income', 'transfer', 'adjust'].includes(v.kind) ? v.kind : 'expense', dir: v.dir === 'minus' ? 'minus' : 'plus', date: str(v.date, 10), amount: num(v.amount),
      cat: str(v.cat, 40), account: str(v.account, 40), toAccount: str(v.toAccount, 40), title: str(v.title, 60), memo: str(v.memo, 300),
      rec: str(v.rec, 40), base: num(v.base), shifted: num(v.shifted), shift: str(v.shift, 40),
      from: str(v.from, 60), event: str(v.event, 40), // from：どの収入から移したか（振替）。event：どの予定で使ったか
      wish: str(v.wish, 40), wdir: v.wdir === 'out' ? 'out' : '', // wish：どのほしい物のために貯めた振替か（wdir out は取り崩し）
      createdAt: num(v.createdAt), updatedAt: num(v.updatedAt),
    };
  }
  // 前借り（定期収入）・後払い（定期の支払い）：kashikari_private/{uid}/shifts/{id}
  //   { kind: advance|defer, rec: 固定費ID, period: 何の分か（毎月 YYYY-MM・毎年 YYYY・毎週 YYYY-MM-DD）, amount, date: 前借りした日・後払いを払う予定の日,
  //     account, memo, txId: 入った（払った）記録, paid: 後払いを払ったか, paidDate }
  function cleanShift(id, v) {
    v = v || {};
    return {
      id, kind: v.kind === 'defer' ? 'defer' : 'advance', rec: str(v.rec, 40), period: str(v.period, 10), amount: num(v.amount), date: day(v.date),
      account: str(v.account, 40), memo: str(v.memo, 200), txId: str(v.txId, 60), paid: v.paid === true, paidDate: day(v.paidDate), createdAt: num(v.createdAt),
    };
  }
  function cleanEntry(id, v) {
    v = v || {};
    return {
      id, dir: v.dir === 'borrowed' ? 'borrowed' : 'lent', who: str(v.who, 30), title: str(v.title, 60), date: str(v.date, 10), memo: str(v.memo, 300),
      amount: num(v.amount), repayments: reps(v.repayments), due: day(v.due), createdAt: num(v.createdAt), updatedAt: num(v.updatedAt),
    };
  }

  // ---- 見ておく（その帳簿の記録と返したよ）----
  // 帳簿をつくった・参加した直後は、まだサーバーに届いていなくて断られることがある。断られたら少し待って見直す（5回まで）
  const retries = {}, retryTimers = {};
  function watchBook(id) {
    if (bookSubs[id]) return;
    const ref = db.collection(BOOKS).doc(id);
    const failed = (e) => {
      const n = retries[id] = (retries[id] || 0) + 1;
      unwatchBook(id, true);
      if (n <= 5 && user) retryTimers[id] = setTimeout(() => { delete retryTimers[id]; if (st.books.some((b) => b.id === id)) watchBook(id); }, 800 * n);
      else { st.error = e.code || e.message; emit(); }
    };
    const a = ref.collection('loans').onSnapshot({ includeMetadataChanges: true }, (snap) => {
      retries[id] = 0;
      st.loans = { ...st.loans, [id]: snap.docs.map((d) => cleanLoan(d.id, d.data())) };
      st.pending = snap.metadata.hasPendingWrites;
      emit();
    }, failed);
    const b = ref.collection('claims').onSnapshot((snap) => {
      st.claims = { ...st.claims, [id]: snap.docs.map((d) => cleanClaim(d.id, d.data())) };
      emit();
    }, failed);
    // 家族のカード：カード・使った報告（写真は別の文書 cardPhotos/{報告ID}）・持ち主が入れた明細
    const c1 = ref.collection('cards').onSnapshot((snap) => { st.cards = { ...st.cards, [id]: snap.docs.map((d) => ({ id: d.id, name: str(d.data().name, 30) || 'カード', holder: str(d.data().holder, 128), createdAt: num(d.data().createdAt) })) }; emit(); }, failed);
    const c2 = ref.collection('cardReports').onSnapshot((snap) => {
      st.cardReports = { ...st.cardReports, [id]: snap.docs.map((d) => { const v = d.data(); return { id: d.id, card: str(v.card, 40), by: str(v.by, 128), date: day(v.date), amount: num(v.amount), place: str(v.place, 40), memo: str(v.memo, 200), hasPhoto: v.hasPhoto === true, checked: v.checked === true, createdAt: num(v.createdAt) }; }) };
      emit();
    }, failed);
    const c3 = ref.collection('cardCharges').onSnapshot((snap) => {
      st.cardCharges = { ...st.cardCharges, [id]: snap.docs.map((d) => { const v = d.data(); return { id: d.id, card: str(v.card, 40), for: str(v.for, 128), date: day(v.date), amount: num(v.amount), place: str(v.place, 40), memo: str(v.memo, 200), report: str(v.report, 40), createdAt: num(v.createdAt) }; }) };
      emit();
    }, failed);
    const h = ref.collection('handoffs').onSnapshot((snap) => {
      st.handoffs = { ...st.handoffs, [id]: snap.docs.map((d) => cleanHandoff(d.id, d.data())) };
      emit();
    }, failed);
    bookSubs[id] = [a, b, c1, c2, c3, h];
  }
  function unwatchBook(id, keepData) {
    (bookSubs[id] || []).forEach((u) => { try { u(); } catch (e) {} });
    delete bookSubs[id];
    if (!keepData && retryTimers[id]) { clearTimeout(retryTimers[id]); delete retryTimers[id]; }
    if (keepData) return;
    const l = { ...st.loans }; delete l[id]; st.loans = l;
    const c = { ...st.claims }; delete c[id]; st.claims = c;
    const hh = { ...st.handoffs }; delete hh[id]; st.handoffs = hh;
    ['cards', 'cardReports', 'cardCharges'].forEach((k) => { const x = { ...st[k] }; delete x[id]; st[k] = x; });
  }
  function stopAll() {
    if (booksUnsub) { try { booksUnsub(); } catch (e) {} booksUnsub = null; }
    if (privUnsub) { try { privUnsub(); } catch (e) {} privUnsub = null; }
    if (txUnsub) { try { txUnsub(); } catch (e) {} txUnsub = null; }
    if (kbUnsub) { try { kbUnsub(); } catch (e) {} kbUnsub = null; }
    if (shUnsub) { try { shUnsub(); } catch (e) {} shUnsub = null; }
    if (linkUnsub) { try { linkUnsub(); } catch (e) {} linkUnsub = null; } linkCode = ''; st.link = null;
    st.tx = []; st.kb = null; st.txReady = false; st.kbReady = false; st.shifts = []; st.shiftsReady = false;
    Object.keys(bookSubs).concat(Object.keys(retryTimers)).forEach((id) => unwatchBook(id));
    st.books = []; st.loans = {}; st.claims = {}; st.handoffs = {}; st.cards = {}; st.cardReports = {}; st.cardCharges = {}; st.personal = []; st.booksReady = false; st.privateReady = false;
  }
  function start() {
    stopAll();
    if (!user) { emit(); return; }
    const uid = user.uid;
    booksUnsub = db.collection(BOOKS).where('members', 'array-contains', uid).onSnapshot({ includeMetadataChanges: true }, (snap) => {
      if (!user || user.uid !== uid) return;
      st.books = snap.docs.map((d) => cleanBook(d.id, d.data())).sort((x, y) => x.createdAt - y.createdAt);
      st.booksReady = true; st.error = '';
      const ids = new Set(st.books.map((b) => b.id));
      // サーバーに届いた帳簿だけ、中を見に行く（届く前に見に行くと断られる）
      snap.docs.forEach((d) => { if (!d.metadata.hasPendingWrites) watchBook(d.id); });
      Object.keys(bookSubs).concat(Object.keys(retryTimers)).forEach((id) => { if (!ids.has(id)) unwatchBook(id); });
      emit();
    }, (e) => { st.booksReady = true; st.error = e.code || e.message; emit(); });
    privUnsub = db.collection(PRIVATE).doc(uid).collection('entries').onSnapshot({ includeMetadataChanges: true }, (snap) => {
      if (!user || user.uid !== uid) return;
      st.personal = snap.docs.map((d) => cleanEntry(d.id, d.data()));
      st.privateReady = true;
      st.pending = snap.metadata.hasPendingWrites;
      emit();
    }, (e) => { st.privateReady = true; st.error = e.code || e.message; emit(); });
    // 家計簿
    txUnsub = db.collection(PRIVATE).doc(uid).collection('tx').onSnapshot({ includeMetadataChanges: true }, (snap) => {
      if (!user || user.uid !== uid) return;
      st.tx = snap.docs.map((d) => cleanTx(d.id, d.data()));
      st.txReady = true;
      st.pending = snap.metadata.hasPendingWrites;
      emit();
    }, (e) => { st.txReady = true; st.error = e.code || e.message; emit(); });
    shUnsub = db.collection(PRIVATE).doc(uid).collection('shifts').onSnapshot((snap) => {
      if (!user || user.uid !== uid) return;
      st.shifts = snap.docs.map((d) => cleanShift(d.id, d.data()));
      st.shiftsReady = true;
      emit();
    }, (e) => { st.shiftsReady = true; st.error = e.code || e.message; emit(); });
    kbUnsub = db.collection(PRIVATE).doc(uid).collection('kakeibo').doc('settings').onSnapshot((snap) => {
      if (!user || user.uid !== uid) return;
      st.kb = snap.exists ? snap.data() : null;
      st.kbReady = true;
      emit();
    }, (e) => { st.kbReady = true; st.error = e.code || e.message; emit(); });
    emit();
  }

  // ---- Android アプリ：ブラウザでログインして戻ってきたら、アプリが受け取ったトークンでログインする（航海日誌と同じ）----
  function takeNativeLogin() {
    const A = window.KashikariApp;
    if (!A || !A.takeLogin || !auth) return;
    let t = null;
    try { t = JSON.parse(A.takeLogin() || 'null'); } catch (e) { t = null; }
    if (!t) return;
    const wait = window.__kashikariNativeLogin; window.__kashikariNativeLogin = null;
    if (!t.idToken) {
      if (!wait) return;
      const err = new Error(t.kind === 'cancel'
        ? `ログインしませんでした。アカウントを選んだのに戻ってきたときは「ブラウザでログイン」を試してください（${t.error || ''}）`
        : `アカウントを選ぶ画面でログインできませんでした。「ブラウザでログイン」を試してください（${t.error || ''}）`);
      err.code = t.kind === 'cancel' ? 'app/cancelled' : 'app/sign-in-failed';
      wait.reject(err);
      return;
    }
    auth.signInWithCredential(firebase.auth.GoogleAuthProvider.credential(t.idToken, t.accessToken || null))
      .then((r) => { if (wait) wait.resolve(r); }, (e) => { if (wait) wait.reject(e); else { st.error = e.code || e.message; emit(); } });
  }
  window.__kashikariLoginArrived = takeNativeLogin;

  function init() {
    if (st.configMissing || !window.firebase || !firebase.initializeApp) { st.authReady = true; emit(); return; }
    try {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      auth = firebase.auth(); db = firebase.firestore();
      st.available = true;
      try { if (db.enablePersistence) db.enablePersistence({ synchronizeTabs: true }).catch(() => {}); } catch (e) {}
      window.addEventListener('online', () => { st.online = true; emit(); });
      window.addEventListener('offline', () => { st.online = false; emit(); });
      auth.onAuthStateChanged((u) => {
        user = u; st.authReady = true;
        st.user = u ? { uid: u.uid, name: u.displayName || '', email: u.email || '' } : null;
        start();
      });
      auth.getRedirectResult().catch(() => {});
      takeNativeLogin();
    } catch (e) { st.error = e.message; st.authReady = true; emit(); }
  }

  const need = () => { if (!db || !user) { const e = new Error('ログインしてください'); e.code = 'app/not-signed-in'; throw e; } };
  const now = () => Date.now();
  const clean = (o) => JSON.parse(JSON.stringify(o));
  const bookRef = (id) => db.collection(BOOKS).doc(id);

  window.KStore = {
    state: () => st,
    subscribe(fn) { listeners.add(fn); fn(st); return () => listeners.delete(fn); },

    // ---- ログイン ----
    async signInGoogle() {
      if (!auth) throw new Error('Firebase を読み込めませんでした');
      if (window.KashikariApp && window.KashikariApp.googleSignIn) {
        if (!WEB_CLIENT_ID) {
          const e = new Error('アプリの「Google でログイン」がまだ設定されていません（firebase-config.js の webClientId）。「ブラウザでログイン」かメールでログインしてください');
          e.code = 'app/no-client-id'; throw e;
        }
        return new Promise((resolve, reject) => { window.__kashikariNativeLogin = { resolve, reject }; window.KashikariApp.googleSignIn(WEB_CLIENT_ID); });
      }
      const p = new firebase.auth.GoogleAuthProvider();
      p.setCustomParameters({ prompt: 'select_account' });
      try { await auth.signInWithPopup(p); }
      catch (e) { if (/popup|operation-not-supported|web-storage/.test(e.code || '')) return auth.signInWithRedirect(p); throw e; }
    },
    canBrowserSignIn() { return !!(window.KashikariApp && window.KashikariApp.googleSignInBrowser); },
    async signInGoogleBrowser() {
      if (!auth) throw new Error('Firebase を読み込めませんでした');
      return new Promise((resolve, reject) => { window.__kashikariNativeLogin = { resolve, reject }; window.KashikariApp.googleSignInBrowser(); });
    },
    async signInEmail(email, pw, create) {
      if (!auth) throw new Error('Firebase を読み込めませんでした');
      return create ? auth.createUserWithEmailAndPassword(email, pw) : auth.signInWithEmailAndPassword(email, pw);
    },
    async signOut() {
      if (auth) await auth.signOut();
      try { if (window.KashikariApp && window.KashikariApp.signOutGoogle) window.KashikariApp.signOutGoogle(); } catch (e) {}
    },

    // ---- 帳簿 ----
    async createBook(name, nickname) {
      need();
      const ref = db.collection(BOOKS).doc();
      await ref.set({ name, owner: user.uid, members: [user.uid], names: { [user.uid]: nickname }, createdAt: now() });
      return ref.id;
    },
    // 招待コードの帳簿を見る（参加する前の確認）。無い・読めないときは null
    async peekBook(id) {
      need();
      if (!/^[A-Za-z0-9]{10,40}$/.test(id || '')) return null;
      try { const s = await bookRef(id).get(); return s.exists ? cleanBook(s.id, s.data()) : null; } catch (e) { return null; }
    },
    async joinBook(id, nickname) {
      need();
      await bookRef(id).update({ members: firebase.firestore.FieldValue.arrayUnion(user.uid), [`names.${user.uid}`]: nickname });
    },
    async renameMe(id, nickname) { need(); await bookRef(id).update({ [`names.${user.uid}`]: nickname }); },
    async renameBook(id, name) { need(); await bookRef(id).update({ name }); },
    // 帳簿から抜ける（つくった人以外）
    async leaveBook(id) { need(); await bookRef(id).update({ members: firebase.firestore.FieldValue.arrayRemove(user.uid) }); },
    // 帳簿を消す（つくった人だけ）：閉じる（もう書けなくなる）→ 中の記録・返したよを消す → 帳簿を消す
    // 途中で止まっても、閉じた帳簿はもう一度「消す」で続きから消せる
    async deleteBook(id) {
      need();
      const ref = bookRef(id);
      const b = await ref.get();
      if (b.exists && b.data().closing !== true) await ref.update({ closing: true });
      for (const sub of ['loans', 'claims', 'handoffs', 'cards', 'cardReports', 'cardPhotos', 'cardCharges']) {
        const docs = (await ref.collection(sub).get()).docs;
        for (let i = 0; i < docs.length; i += 400) {
          const batch = db.batch();
          docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
      }
      await ref.delete();
    },

    // ---- 貸した記録（自分が貸したものだけ書ける）----
    async saveLoan(bookId, id, body) {
      need();
      const col = bookRef(bookId).collection('loans');
      const ref = id ? col.doc(id) : col.doc();
      await ref.set(clean({ ...body, lender: user.uid, updatedAt: now(), createdAt: body.createdAt || now() }));
      return ref.id;
    },
    async setShares(bookId, loanId, shares) { need(); await bookRef(bookId).collection('loans').doc(loanId).update(clean({ shares, updatedAt: now() })); },
    async deleteLoan(bookId, loanId) { need(); await bookRef(bookId).collection('loans').doc(loanId).delete(); },

    // ---- 返したよ ----
    async sendClaim(bookId, c) {
      need();
      await bookRef(bookId).collection('claims').doc().set(clean({ ...c, from: user.uid, status: 'pending', createdAt: now(), decidedAt: 0 }));
    },
    async deleteClaim(bookId, claimId) { need(); await bookRef(bookId).collection('claims').doc(claimId).delete(); },
    // 肩代わり：ほかの人（for）の借り（lender の記録 loanId）を、自分が代わりに返した
    //   → lender への「返したよ」（for の代わりに）と、自分 → for の貸しを、いっしょに書く（lender が認めると for の借りが減る）
    async coverDebt(bookId, c, loanBody) {
      need();
      const claimRef = bookRef(bookId).collection('claims').doc(), loanRef = bookRef(bookId).collection('loans').doc();
      const b = db.batch();
      b.set(claimRef, clean({ loanId: c.loanId, lender: c.lender, for: c.for, coverLoanId: loanRef.id, from: user.uid, amount: c.amount, date: c.date, note: c.note || '', status: 'pending', createdAt: now(), decidedAt: 0 }));
      b.set(loanRef, clean({ ...loanBody, via: { claimId: claimRef.id, loanId: c.loanId, lender: c.lender, for: c.for, title: c.title || '' }, lender: user.uid, createdAt: now(), updatedAt: now() }));
      await b.commit();
    },
    // 肩代わりを取り消す：自分の貸しと、まだ決まっていない（断られた）返したよを消す
    async deleteCover(bookId, loanId, claimId) {
      need();
      const b = db.batch();
      if (loanId) b.delete(bookRef(bookId).collection('loans').doc(loanId));
      if (claimId) b.delete(bookRef(bookId).collection('claims').doc(claimId));
      await b.commit();
    },
    // 認める：貸した記録に返済を入れて、返したよを「認めた」にする（まとめて1回で書く）
    async approveClaim(bookId, claim, shares) {
      need();
      const b = db.batch();
      b.update(bookRef(bookId).collection('loans').doc(claim.loanId), clean({ shares, updatedAt: now() }));
      b.update(bookRef(bookId).collection('claims').doc(claim.id), { status: 'approved', decidedAt: now() });
      await b.commit();
    },
    // ---- 付け替え（借りている人の代わりに、ほかのメンバーが返す）----
    // 頼む：list = [{ loanId, lender, from, to, amount, note, title }]（借りている人か、貸した人が出す）
    async askHandoffs(bookId, list) {
      need();
      const b = db.batch();
      list.forEach((x) => b.set(bookRef(bookId).collection('handoffs').doc(), clean({ ...x, by: user.uid, toOk: false, lenderOk: x.lender === user.uid, status: 'pending', newLoanId: '', createdAt: now(), decidedAt: 0 })));
      await b.commit();
    },
    async answerHandoff(bookId, id, ok) {
      need();
      await bookRef(bookId).collection('handoffs').doc(id).update(ok ? { toOk: true } : { status: 'declined', decidedAt: now() });
    },
    async lenderHandoff(bookId, id, ok) {
      need();
      await bookRef(bookId).collection('handoffs').doc(id).update(ok ? { lenderOk: true } : { status: 'rejected', decidedAt: now() });
    },
    // 付け替える（貸した人だけ）：元の記録の from の分に「付け替え」を入れ、to への新しい貸しの記録をつくる
    async applyHandoff(bookId, h, shares, newLoan) {
      need();
      const b = db.batch(), loanRef = bookRef(bookId).collection('loans').doc();
      b.update(bookRef(bookId).collection('loans').doc(h.loanId), clean({ shares, updatedAt: now() }));
      b.set(loanRef, clean({ ...newLoan, lender: user.uid, createdAt: now(), updatedAt: now() }));
      b.update(bookRef(bookId).collection('handoffs').doc(h.id), { status: 'done', lenderOk: true, newLoanId: loanRef.id, decidedAt: now() });
      await b.commit();
    },
    async deleteHandoff(bookId, id) { need(); await bookRef(bookId).collection('handoffs').doc(id).delete(); },
    // 付け替えを取り消す（貸した人だけ）：元の記録から付け替えを外し、新しい貸しの記録と付け替えを消す
    async undoHandoff(bookId, x) {
      need();
      const b = db.batch();
      if (x.loanId) b.update(bookRef(bookId).collection('loans').doc(x.loanId), clean({ shares: x.shares, updatedAt: now() }));
      if (x.newLoanId) b.delete(bookRef(bookId).collection('loans').doc(x.newLoanId));
      if (x.handoffId) b.delete(bookRef(bookId).collection('handoffs').doc(x.handoffId));
      await b.commit();
    },
    async rejectClaim(bookId, claimId) { need(); await bookRef(bookId).collection('claims').doc(claimId).update({ status: 'rejected', decidedAt: now() }); },

    // ---- 自分だけの帳簿 ----
    async savePersonal(id, body) {
      need();
      const col = db.collection(PRIVATE).doc(user.uid).collection('entries');
      const ref = id ? col.doc(id) : col.doc();
      await ref.set(clean({ ...body, updatedAt: now(), createdAt: body.createdAt || now() }));
    },
    async deletePersonal(id) { need(); await db.collection(PRIVATE).doc(user.uid).collection('entries').doc(id).delete(); },

    // ---- 家計簿 ----
    // 収入・支出・振替：kashikari_private/{uid}/tx/{id}
    async saveTx(id, body) {
      need();
      const col = db.collection(PRIVATE).doc(user.uid).collection('tx');
      const ref = id ? col.doc(id) : col.doc();
      await ref.set(clean({ ...body, updatedAt: now(), createdAt: body.createdAt || now() }));
      return ref.id;
    },
    async deleteTx(id) { need(); await db.collection(PRIVATE).doc(user.uid).collection('tx').doc(id).delete(); },
    // 固定費をまとめて入れる（id は rec_固定費ID_年-月 で決まっているので、2回入れても1つになる）
    async putTxMany(list) {
      need();
      const col = db.collection(PRIVATE).doc(user.uid).collection('tx');
      for (let i = 0; i < list.length; i += 400) {
        const batch = db.batch();
        list.slice(i, i + 400).forEach(({ id, body }) => batch.set(col.doc(id), clean({ ...body, updatedAt: now(), createdAt: now() })));
        await batch.commit();
      }
    },
    // 設定（分類・口座・予算・固定費）：kashikari_private/{uid}/kakeibo/settings
    // 家計簿をまとめて書く（前借り・後払いと、それに合わせた記録を1回で）：ops = [{ op: set|delete, col: tx|shifts, id, body }]
    newKbId(col) { need(); return db.collection(PRIVATE).doc(user.uid).collection(col).doc().id; },
    async kbBatch(ops) {
      need();
      const base = db.collection(PRIVATE).doc(user.uid), b = db.batch();
      ops.forEach((o) => {
        const ref = base.collection(o.col).doc(o.id);
        if (o.op === 'delete') b.delete(ref); else b.set(ref, clean({ ...o.body, updatedAt: now(), createdAt: o.body.createdAt || now() }));
      });
      await b.commit();
    },
    // ---- 家族のカード ----
    async saveCard(bookId, id, name) {
      need();
      const ref = id ? bookRef(bookId).collection('cards').doc(id) : bookRef(bookId).collection('cards').doc();
      await ref.set({ name, holder: user.uid, createdAt: now() }, { merge: true });
      return ref.id;
    },
    async deleteCard(bookId, id) { need(); await bookRef(bookId).collection('cards').doc(id).delete(); },
    newCardReportId(bookId) { need(); return bookRef(bookId).collection('cardReports').doc().id; },
    // 使った報告（写真があれば、別の文書に入れる。photo：null＝そのまま、''＝消す、data:…＝入れ替える）
    async saveCardReport(bookId, id, body, photo) {
      need();
      const b = db.batch(), r = bookRef(bookId);
      const hasPhoto = photo === null ? !!body.hasPhoto : !!photo;
      b.set(r.collection('cardReports').doc(id), clean({ ...body, hasPhoto, by: user.uid, createdAt: body.createdAt || now(), updatedAt: now() }));
      if (photo) b.set(r.collection('cardPhotos').doc(id), { card: body.card, by: user.uid, data: photo });
      else if (photo === '') b.delete(r.collection('cardPhotos').doc(id));
      await b.commit();
    },
    async deleteCardReport(bookId, id, hasPhoto) {
      need();
      const b = db.batch(), r = bookRef(bookId);
      b.delete(r.collection('cardReports').doc(id));
      if (hasPhoto) b.delete(r.collection('cardPhotos').doc(id));
      await b.commit();
    },
    async checkCardReport(bookId, id, checked) { need(); await bookRef(bookId).collection('cardReports').doc(id).update({ checked, checkedAt: now() }); },
    async getCardPhoto(bookId, id) { need(); const s = await bookRef(bookId).collection('cardPhotos').doc(id).get(); return s.exists ? s.data().data || '' : ''; },
    async saveCardCharge(bookId, id, body) {
      need();
      const ref = id ? bookRef(bookId).collection('cardCharges').doc(id) : bookRef(bookId).collection('cardCharges').doc();
      await ref.set(clean({ ...body, createdAt: body.createdAt || now(), updatedAt: now() }));
    },
    async deleteCardCharge(bookId, id) { need(); await bookRef(bookId).collection('cardCharges').doc(id).delete(); },

    // ---- 航海日誌との連携（連携コード＝文書のID を知っているアプリだけが読める。航海日誌は koukai だけ書ける）----
    async linkCreate() {
      need();
      const b = new Uint8Array(18); crypto.getRandomValues(b);
      const code = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').replace(/[-_]/g, 'x');
      await db.collection('kashikari_links').doc(code).set({ owner: user.uid, feed: [], warn: null, feedAt: now(), koukai: [], koukaiAt: 0 });
      return code;
    },
    // 自分の連携の文書を見ておく（航海日誌から届く予定）
    linkWatch(code) {
      if (!db || !user || code === linkCode) return;
      if (linkUnsub) { try { linkUnsub(); } catch (e) {} linkUnsub = null; }
      linkCode = code || ''; st.link = null;
      if (!code) { emit(); return; }
      linkUnsub = db.collection('kashikari_links').doc(code).onSnapshot((snap) => {
        st.link = snap.exists ? { code, ...snap.data() } : { code, missing: true };
        emit();
      }, () => { st.link = { code, missing: true }; emit(); });
    },
    async linkPublish(code, feed, warn) { need(); await db.collection('kashikari_links').doc(code).set(clean({ owner: user.uid, feed, warn: warn || null, feedAt: now() }), { merge: true }); },
    async linkDelete(code) { need(); try { await db.collection('kashikari_links').doc(code).delete(); } catch (e) {} },
    async saveKb(settings) { need(); await db.collection(PRIVATE).doc(user.uid).collection('kakeibo').doc('settings').set(clean({ ...settings, updatedAt: now() })); },
  };
  init();
})();
