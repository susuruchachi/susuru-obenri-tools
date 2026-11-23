// --- 貸し借り帳のデータ（Firebase：すするanki・航海日誌と同じプロジェクト）---
// ・ログインは すするanki と同じアカウント（Google・メール）
// ・みんなの帳簿：kashikari_books/{帳簿ID} = { name, owner, members: [uid], names: { uid: 呼び名 }, createdAt }
//     帳簿ID を知っている人（招待リンク・招待コード）だけが中を見て、参加できる
//   貸した記録：kashikari_books/{帳簿ID}/loans/{id} = { lender, title, date, memo, mode, total, includeSelf, shares: [{ to, amount, repayments: [{ id, date, amount, claim? }] }], createdAt, updatedAt }
//     書けるのは貸した人（lender）だけ（Firestore のルールで決めている。kashikari/firestore.rules）
//   返したよ：kashikari_books/{帳簿ID}/claims/{id} = { loanId, lender, from, amount, date, note, status: pending|approved|rejected, createdAt, decidedAt }
//     借りた人が出して、貸した人が「認める」と、貸した記録に返済が入る
// ・自分だけの帳簿：kashikari_private/{uid}/entries/{id} = { dir: lent|borrowed, who, title, date, memo, amount, repayments, createdAt, updatedAt }（本人しか読めない）
// ・オフラインで変えた分は、この端末に覚えておき（enablePersistence）、つながったら送る
(function () {
  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyAGoYBRoupEFHng_cXoiHmZf9eAlX8ZCHA', authDomain: 'susuruanki.firebaseapp.com',
    projectId: 'susuruanki', storageBucket: 'susuruanki.firebasestorage.app',
    messagingSenderId: '926791749187', appId: '1:926791749187:web:2a96a39d61cbb4d3c7cef6',
  };
  const BOOKS = 'kashikari_books', PRIVATE = 'kashikari_private';

  let auth = null, db = null, user = null;
  let booksUnsub = null, privUnsub = null;
  const bookSubs = {}; // 帳簿ID -> [unsub, unsub]
  const st = {
    available: false, authReady: false, user: null, error: '',
    online: typeof navigator === 'undefined' || navigator.onLine !== false, pending: false,
    booksReady: false, books: [], loans: {}, claims: {}, privateReady: false, personal: [],
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
  const reps = (a) => (Array.isArray(a) ? a.filter((r) => r && typeof r === 'object').map((r) => ({ id: str(r.id, 40), date: str(r.date, 10), amount: num(r.amount), claim: str(r.claim, 40) })) : []);
  function cleanBook(id, v) {
    v = v || {};
    const names = {};
    if (v.names && typeof v.names === 'object') Object.keys(v.names).forEach((k) => { names[k] = str(v.names[k], 20); });
    return { id, name: str(v.name, 40) || '帳簿', owner: str(v.owner, 128), members: Array.isArray(v.members) ? v.members.filter((x) => typeof x === 'string') : [], names, createdAt: num(v.createdAt) };
  }
  function cleanLoan(id, v) {
    v = v || {};
    return {
      id, lender: str(v.lender, 128), title: str(v.title, 60), date: str(v.date, 10), memo: str(v.memo, 300),
      mode: v.mode === 'split' ? 'split' : 'each', total: num(v.total), includeSelf: !!v.includeSelf,
      shares: Array.isArray(v.shares) ? v.shares.filter((s) => s && typeof s.to === 'string').map((s) => ({ to: s.to, amount: num(s.amount), repayments: reps(s.repayments) })) : [],
      createdAt: num(v.createdAt), updatedAt: num(v.updatedAt),
    };
  }
  function cleanClaim(id, v) {
    v = v || {};
    return {
      id, loanId: str(v.loanId, 40), lender: str(v.lender, 128), from: str(v.from, 128), amount: num(v.amount), date: str(v.date, 10),
      note: str(v.note, 100), status: ['approved', 'rejected'].includes(v.status) ? v.status : 'pending', createdAt: num(v.createdAt), decidedAt: num(v.decidedAt),
    };
  }
  function cleanEntry(id, v) {
    v = v || {};
    return {
      id, dir: v.dir === 'borrowed' ? 'borrowed' : 'lent', who: str(v.who, 30), title: str(v.title, 60), date: str(v.date, 10), memo: str(v.memo, 300),
      amount: num(v.amount), repayments: reps(v.repayments), createdAt: num(v.createdAt), updatedAt: num(v.updatedAt),
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
    bookSubs[id] = [a, b];
  }
  function unwatchBook(id, keepData) {
    (bookSubs[id] || []).forEach((u) => { try { u(); } catch (e) {} });
    delete bookSubs[id];
    if (!keepData && retryTimers[id]) { clearTimeout(retryTimers[id]); delete retryTimers[id]; }
    if (keepData) return;
    const l = { ...st.loans }; delete l[id]; st.loans = l;
    const c = { ...st.claims }; delete c[id]; st.claims = c;
  }
  function stopAll() {
    if (booksUnsub) { try { booksUnsub(); } catch (e) {} booksUnsub = null; }
    if (privUnsub) { try { privUnsub(); } catch (e) {} privUnsub = null; }
    Object.keys(bookSubs).concat(Object.keys(retryTimers)).forEach((id) => unwatchBook(id));
    st.books = []; st.loans = {}; st.claims = {}; st.personal = []; st.booksReady = false; st.privateReady = false;
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
    if (!window.firebase || !firebase.initializeApp) { st.authReady = true; emit(); return; }
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
        return new Promise((resolve, reject) => { window.__kashikariNativeLogin = { resolve, reject }; window.KashikariApp.googleSignIn(); });
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
    // 認める：貸した記録に返済を入れて、返したよを「認めた」にする（まとめて1回で書く）
    async approveClaim(bookId, claim, shares) {
      need();
      const b = db.batch();
      b.update(bookRef(bookId).collection('loans').doc(claim.loanId), clean({ shares, updatedAt: now() }));
      b.update(bookRef(bookId).collection('claims').doc(claim.id), { status: 'approved', decidedAt: now() });
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
  };
  init();
})();
