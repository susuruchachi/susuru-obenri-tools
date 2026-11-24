// --- 自分の帳簿：家計簿（収入・支出・振替・口座の通帳・予算・固定費・1年の流れ・検索・書き出し）---
// 依存: ledger.js（KL）。画面の部品（シート・トースト・保存）は app.js が ctx で渡す
// データ：kashikari_private/{uid}/tx/{id} = { kind: expense|income|transfer|adjust, date, amount, cat, account, toAccount, dir, title, memo, rec }
//         kashikari_private/{uid}/kakeibo/settings = { expenseCats, incomeCats, accounts, budget: { total, cats }, recurring }
// 固定費・定期収入（毎月・毎年・毎週）は、その日になったら tx/rec_{固定費ID}_{何の分} として自動で入る（2回入れても1つ）。消した分は skip に覚えて入れ直さない
//   何の分（period）：毎月は YYYY-MM、毎年は YYYY、毎週は その日 YYYY-MM-DD
// 前借り（定期収入）・後払い（定期の支払い）：shifts/{id}。その分が自動で入るときに、前借り・後払いした額を差し引く（もう入っていれば、その記録の額を直す）
//   前借り：前借りした日に収入として入れる。後払い：「まだ払っていない」に出し、「払った」でその日の支出として入れる
const Kakeibo = (ctx) => {
  const { esc, yen, today, toast, run } = ctx;
  const pad = (n) => String(n).padStart(2, '0');
  const curYM = () => today().slice(0, 7);
  const addMonth = (m, n) => { let y = +m.slice(0, 4), mo = +m.slice(5, 7) + n; while (mo > 12) { mo -= 12; y++; } while (mo < 1) { mo += 12; y--; } return `${y}-${pad(mo)}`; };
  const daysIn = (m) => new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate();
  const ymLabel = (m) => `${+m.slice(0, 4)}年${+m.slice(5, 7)}月`;
  const md = (d) => { const x = new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)); return `${+d.slice(5, 7)}/${+d.slice(8, 10)}(${'日月火水木金土'[x.getDay()]})`; };
  const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  // 金額：全角・カンマ・¥ を取り、「1200+300-50」のような足し算・引き算もできる
  const calc = (s) => {
    const t = String(s ?? '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[＋]/g, '+').replace(/[－ー−]/g, '-').replace(/[,，¥￥円\s]/g, '');
    if (!t) return 0;
    if (!/^[\d+-]+$/.test(t)) return parseInt(t.replace(/\D/g, ''), 10) || 0;
    const v = (t.match(/[+-]?\d+/g) || []).reduce((a, x) => a + parseInt(x, 10), 0);
    return Math.max(0, Math.min(v, 1e10));
  };
  const hasOp = (s) => /\d\s*[+＋\-－]\s*\d/.test(String(s || ''));

  const DEF = {
    expenseCats: [
      { id: 'food', name: '食費', icon: '🍙' }, { id: 'snack', name: 'おやつ・飲み物', icon: '🧃' }, { id: 'daily', name: '日用品', icon: '🧻' },
      { id: 'transport', name: '交通', icon: '🚃' }, { id: 'fun', name: '趣味・遊び', icon: '🎮' }, { id: 'clothes', name: '服・美容', icon: '👕' },
      { id: 'study', name: '勉強・本', icon: '📚' }, { id: 'phone', name: '通信・サブスク', icon: '📱' }, { id: 'home', name: '住まい', icon: '🏠' },
      { id: 'utility', name: '水道・光熱', icon: '💡' }, { id: 'health', name: '医療', icon: '🏥' }, { id: 'gift', name: '交際・プレゼント', icon: '🎁' },
      { id: 'other', name: 'その他', icon: '📦' },
    ],
    incomeCats: [
      { id: 'salary', name: '給料', icon: '💴' }, { id: 'parttime', name: 'バイト', icon: '💼' }, { id: 'allowance', name: 'お小遣い', icon: '🪙' },
      { id: 'gifted', name: 'もらった', icon: '🎁' }, { id: 'iother', name: 'その他', icon: '📦' },
    ],
    accounts: [{ id: 'wallet', name: '財布', icon: '👛', initial: 0 }, { id: 'bank', name: '銀行', icon: '🏦', initial: 0 }, { id: 'emoney', name: '電子マネー', icon: '📱', initial: 0 }],
    budget: { total: 0, cats: {} },
    recurring: [],
  };
  const arr = (a, d) => (Array.isArray(a) && a.length ? a : d);
  function settings() {
    const k = ctx.S().kb || {};
    return {
      expenseCats: arr(k.expenseCats, DEF.expenseCats), incomeCats: arr(k.incomeCats, DEF.incomeCats), accounts: arr(k.accounts, DEF.accounts),
      budget: { total: (k.budget && +k.budget.total) || 0, cats: (k.budget && k.budget.cats) || {} },
      recurring: Array.isArray(k.recurring) ? k.recurring : [],
      // 貸し借りを家計簿に入れる：{ on, account: いつもの口座, since: この日から, cat: 割り勘の自分の分・立て替えてもらった分の分類, links: { key: { account, off, as, cat } } }
      lend: {
        on: !(k.lend && k.lend.on === false), account: (k.lend && k.lend.account) || arr(k.accounts, DEF.accounts)[0].id,
        since: (k.lend && k.lend.since) || '', cat: (k.lend && k.lend.cat) || 'food',
        links: (k.lend && k.lend.links && typeof k.lend.links === 'object') ? k.lend.links : {},
      },
      // 一度きりの予定：[{ id, name, icon, date, end, budget, memo }]
      events: Array.isArray(k.events) ? k.events : [],
    };
  }
  const saveSettings = (next, msg) => run(KStore.saveKb(next), msg);
  const catOf = (kind, id) => {
    const s = settings(), list = kind === 'income' ? s.incomeCats : s.expenseCats;
    return list.find((c) => c.id === id) || { id, name: 'その他', icon: '📦' };
  };
  const acctOf = (id) => settings().accounts.find((a) => a.id === id) || { id, name: '（消した口座）', icon: '❔', initial: 0 };
  const txs = () => ctx.S().tx || [];
  const shifts = () => ctx.S().shifts || [];

  // ---- 貸し借りを家計簿に入れる（記録を2重に書かず、貸し借りの記録から毎回つくる。収入・支出には数えない）----
  //   lendout：出ていく（貸した・返した）、lendin：入る（借りた・返ってきた）、expense：割り勘の自分の分・立て替えてもらった分
  let vCache = { key: null, list: [] };
  function vtx() {
    const S = ctx.S();
    const ck = [S.loans, S.personal, S.kb, S.books, S.user && S.user.uid];
    if (vCache.key && ck.every((x, i) => x === vCache.key[i])) return vCache.list;
    const s = settings(), L = s.lend, out = [];
    if (L.on && S.user) {
      const me = S.user.uid;
      const add = (key, o) => {
        const k = L.links[key] || {};
        if (k.off || o.amount <= 0 || (L.since && o.date < L.since)) return;
        let kind = o.kind;
        if (o.canAs && (k.as || o.defAs) === 'off') return;
        if (o.canAs) kind = (k.as || o.defAs) === 'expense' ? 'expense' : 'lendin';
        out.push({ ...o, id: 'v:' + key, key, virt: true, kind, account: k.account || L.account, cat: kind === 'expense' ? (k.cat || o.cat || L.cat) : '', memo: '', createdAt: 0 });
      };
      S.books.forEach((b) => (S.loans[b.id] || []).forEach((l) => {
        const nm = (id) => b.names[id] || 'だれか', base = `b:${b.id}:${l.id}`, ttl = l.title || '（内容なし）';
        if (l.lender === me) {
          const lent = l.shares.filter((x) => x.to !== me).reduce((a, x) => a + x.amount, 0);
          add(`${base}:out`, { kind: 'lendout', date: l.date, amount: lent, title: `${l.shares.map((x) => nm(x.to)).join('・')} に貸した`, sub: `${ttl}・${b.name}` });
          if (l.mode === 'split' && l.includeSelf && l.total) add(`${base}:self`, { kind: 'expense', date: l.date, amount: Math.max(0, l.total - lent), title: `${ttl}（自分の分）`, sub: `割り勘・${b.name}`, cat: L.cat });
          l.shares.forEach((x) => x.repayments.forEach((rp) => add(`${base}:r:${rp.id}`, {
            kind: 'lendin', date: rp.date, amount: rp.amount, title: rp.by && rp.by !== x.to ? `${nm(rp.by)} から返ってきた（${nm(x.to)} の肩代わり）` : `${nm(x.to)} から返ってきた`, sub: `${ttl}・${b.name}`,
          })));
        } else {
          const mine = l.shares.find((x) => x.to === me);
          if (!mine) return;
          // 借りた：肩代わりはお金が動いていないので入れない。割り勘・立て替えは支出（立て替えてもらった）、そのほかは現金で借りた
          const defAs = l.via ? 'off' : (l.mode === 'split' || l.paidTo || l.paidToName) ? 'expense' : 'cash';
          add(`${base}:in`, { kind: 'lendin', canAs: true, defAs, date: l.date, amount: mine.amount, title: defAs === 'expense' ? `${ttl}（${nm(l.lender)} が立て替え）` : `${nm(l.lender)} から借りた`, sub: `${ttl}・${b.name}` });
          mine.repayments.forEach((rp) => { if (!rp.by || rp.by === me) add(`${base}:r:${rp.id}`, { kind: 'lendout', date: rp.date, amount: rp.amount, title: `${nm(l.lender)} に返した`, sub: `${ttl}・${b.name}` }); });
        }
      }));
      (S.personal || []).forEach((e) => {
        const who = e.who || '（名前なし）', ttl = e.title || '自分だけの貸し借り', lent = e.dir === 'lent';
        if (lent) add(`p:${e.id}`, { kind: 'lendout', date: e.date, amount: e.amount, title: `${who} に貸した`, sub: ttl });
        else add(`p:${e.id}`, { kind: 'lendin', canAs: true, defAs: 'cash', date: e.date, amount: e.amount, title: `${who} から借りた`, sub: ttl });
        e.repayments.forEach((rp) => add(`p:${e.id}:r:${rp.id}`, { kind: lent ? 'lendin' : 'lendout', date: rp.date, amount: rp.amount, title: lent ? `${who} から返ってきた` : `${who} に返した`, sub: ttl }));
      });
    }
    vCache = { key: ck, list: out };
    return out;
  }
  const all = () => txs().concat(vtx());

  // ---- 固定費の繰り返し（毎月・毎年・毎週）と「何の分」----
  const WD = '日月火水木金土';
  const freqOf = (r) => (r.freq === 'year' || r.freq === 'week' ? r.freq : 'month');
  const startDateOf = (r) => (/^\d{4}-\d{2}-\d{2}$/.test(r.startDate || '') ? r.startDate : `${/^\d{4}-\d{2}$/.test(r.start || '') ? r.start : curYM()}-01`);
  const ymdOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseD = (x) => new Date(+x.slice(0, 4), +x.slice(5, 7) - 1, +x.slice(8, 10));
  const addDays = (x, n) => { const d = parseD(x); d.setDate(d.getDate() + n); return ymdOf(d); };
  // from〜to（日付）の間の回：[{ period, date }]
  function occurrences(r, from, to, max) {
    const out = [], f = freqOf(r), st = startDateOf(r), lim = max || 60;
    if (f === 'month') {
      // 毎月：はじめた月から（はじめた月は、その日をすぎていてもその月の分から）
      let m = (from > st ? from : st).slice(0, 7);
      for (let n = 0; m <= to.slice(0, 7) && n < lim; m = addMonth(m, 1), n++) {
        const date = `${m}-${pad(Math.min(r.day || 1, daysIn(m)))}`;
        if (date >= from && date <= to) out.push({ period: m, date });
      }
    } else if (f === 'year') {
      const mo = Math.min(12, Math.max(1, r.month || 1));
      for (let y = Math.max(+from.slice(0, 4), +st.slice(0, 4)), n = 0; y <= +to.slice(0, 4) && n < lim; y++, n++) {
        const date = `${y}-${pad(mo)}-${pad(Math.min(r.day || 1, daysIn(`${y}-${pad(mo)}`)))}`;
        if (date >= from && date <= to && date >= st) out.push({ period: String(y), date });
      }
    } else {
      let d = parseD(from > st ? from : st);
      while (d.getDay() !== ((r.wday || 0) % 7)) d.setDate(d.getDate() + 1);
      for (let n = 0; ymdOf(d) <= to && n < lim; n++, d.setDate(d.getDate() + 7)) out.push({ period: ymdOf(d), date: ymdOf(d) });
    }
    return out;
  }
  const freqLabel = (r) => { const f = freqOf(r); return f === 'year' ? `毎年${r.month || 1}/${r.day || 1}` : f === 'week' ? `毎週${WD[(r.wday || 0) % 7]}曜` : `毎月${(r.day || 1) >= 31 ? '末' : (r.day || 1) + '日'}`; };
  const periodLabel = (p) => (/^\d{4}$/.test(p) ? `${p}年分` : /^\d{4}-\d{2}$/.test(p) ? `${+p.slice(0, 4)}年${+p.slice(5, 7)}月分` : /^\d{4}-\d{2}-\d{2}$/.test(p) ? `${md(p)}分` : p);
  const recName = (r) => r.title || catOf(r.kind, r.cat).name;
  const recTxId = (r, p) => `rec_${r.id}_${p}`;
  const shiftSum = (rid, p, exceptId) => shifts().filter((x) => x.rec === rid && x.period === p && x.id !== exceptId).reduce((a, x) => a + x.amount, 0);
  const shiftWord = (r) => (r.kind === 'income' ? '前借り' : '後払い');
  // その分がもう自動で入っていたら、前借り・後払いの合計（sum）に合わせて額を直す
  function recTxOps(r, p, sum) {
    const t = txs().find((x) => x.id === recTxId(r, p));
    if (!t) return [];
    const base = t.base || r.amount, body = { ...t, amount: Math.max(0, base - sum), base, shifted: sum };
    delete body.id;
    return [{ op: 'set', col: 'tx', id: t.id, body }];
  }

  // 口座に効く額（出ていく：マイナス、入る：プラス）
  function effect(t, acct) {
    let v = 0;
    if (t.kind === 'expense' && t.account === acct) v -= t.amount;
    if (t.kind === 'income' && t.account === acct) v += t.amount;
    if (t.kind === 'transfer') { if (t.account === acct) v -= t.amount; if (t.toAccount === acct) v += t.amount; }
    if (t.kind === 'adjust' && t.account === acct) v += t.dir === 'minus' ? -t.amount : t.amount;
    if (t.kind === 'lendout' && t.account === acct) v -= t.amount;
    if (t.kind === 'lendin' && t.account === acct) v += t.amount;
    return v;
  }
  const balance = (a) => (a.initial || 0) + all().reduce((s, t) => s + effect(t, a.id), 0);
  function monthSum(m) {
    let inc = 0, exp = 0, lout = 0, lin = 0; const byCat = {};
    all().forEach((t) => {
      if (!t.date.startsWith(m)) return;
      if (t.kind === 'income') inc += t.amount;
      if (t.kind === 'expense') { exp += t.amount; byCat[t.cat] = (byCat[t.cat] || 0) + t.amount; }
      if (t.kind === 'lendout') lout += t.amount;
      if (t.kind === 'lendin') lin += t.amount;
    });
    return { inc, exp, byCat, lout, lin };
  }

  const KB = { sub: 'month', month: curYM(), year: curYM().slice(0, 4), cat: '', search: '', acct: '', evOpen: '', evAll: false, evFor: '', showOff: false };

  // ---------- 画面 ----------
  function view(lendView) {
    const S = ctx.S();
    const tab = (v, t) => `<button role="tab" data-act="kb-sub" data-v="${v}" aria-selected="${KB.sub === v}">${t}</button>`;
    let h = `<section class="sec"><div class="kb-tabs" role="tablist">${tab('month', '📅 家計簿')}${tab('accounts', '👛 口座')}${tab('events', '🎟 予定')}${tab('lend', '🤝 貸し借り')}${tab('year', '📈 1年')}${tab('settings', '⚙️ 設定')}</div></section>`;
    if (KB.sub === 'lend') return h + lendView();
    if (!S.txReady || !S.kbReady) return h + `<section class="sec"><p class="empty">読み込み中…</p></section>`;
    if (KB.sub === 'accounts') return h + viewAccounts();
    if (KB.sub === 'year') return h + viewYear();
    if (KB.sub === 'events') return h + viewEvents();
    if (KB.sub === 'settings') return h + viewSettings();
    return h + viewMonth();
  }

  function viewMonth() {
    const s = settings(), m = KB.month, sum = monthSum(m), cur = m === curYM();
    let h = `<section class="sec">
      <div class="kb-nav"><button class="btn small" data-act="kb-month" data-v="-1" aria-label="前の月">◀</button>
        <h2 class="display">${ymLabel(m)}</h2>
        <button class="btn small" data-act="kb-month" data-v="1" aria-label="次の月">▶</button>
        ${cur ? '' : '<button class="btn small" data-act="kb-month" data-v="0">今月</button>'}
        <span class="grow"></span><button class="btn primary small" data-act="kb-new" data-v="expense">＋ 入れる</button></div>
      <div class="kb-sum">
        <div class="bal in"><span class="label">収入</span><span class="num">${yen(sum.inc)}</span></div>
        <div class="bal out"><span class="label">支出</span><span class="num">${yen(sum.exp)}</span></div>
        <div class="bal"><span class="label">収支</span><span class="num" style="color:${sum.inc - sum.exp >= 0 ? 'var(--signal)' : 'var(--danger-text)'}">${sum.inc - sum.exp < 0 ? '−' : ''}${yen(Math.abs(sum.inc - sum.exp))}</span></div>
      </div>
      ${sum.lout || sum.lin ? `<p class="hint">🤝 貸し借りで 出た <b class="num out">${yen(sum.lout)}</b>・入った <b class="num in">${yen(sum.lin)}</b>（収入・支出には数えていません）</p>` : ''}
      ${budgetBlock(m, sum)}
    </section>${eventBlock(m)}${shiftBlock()}`;
    // 分類ごと
    const cats = Object.entries(sum.byCat).sort((a, b) => b[1] - a[1]);
    if (cats.length) {
      h += `<section class="sec"><h3 class="sec-title"><span class="mark">◔</span> 何に使った？<span class="grow"></span>${KB.cat ? '<button class="btn link" data-act="kb-cat-filter" data-v="">ぜんぶ見る</button>' : ''}</h3>
        <ul class="kb-cats">${cats.map(([id, v]) => {
          const c = catOf('expense', id), b = +s.budget.cats[id] || 0, w = Math.round((v / sum.exp) * 100);
          const over = b && v > b;
          return `<li><button data-act="kb-cat-filter" data-v="${esc(id)}" aria-pressed="${KB.cat === id}">
            <span class="kb-cat-name">${esc(c.icon)} ${esc(c.name)}</span><span class="num">${yen(v)}</span>
            <span class="meter"><span style="width:${b ? Math.min(100, Math.round((v / b) * 100)) : w}%" class="${over ? 'over' : ''}"></span></span>
            <small>${b ? `予算 ${yen(b)}${over ? `・<b class="over-t">${yen(v - b)} オーバー</b>` : `・あと ${yen(b - v)}`}` : `${w}%`}</small></button></li>`;
        }).join('')}</ul></section>`;
    }
    // 一覧（さがす）
    h += `<section class="sec"><div class="field"><label for="kb-search">🔍 さがす（内容・メモ・分類・金額。ぜんぶの月から）</label>
      <input id="kb-search" class="plain-input" data-bind="kb.search" value="${esc(KB.search)}" placeholder="例：コンビニ"></div>`;
    let list;
    if (KB.search.trim()) {
      const q = KB.search.trim().toLowerCase();
      list = all().filter((t) => {
        const c = t.kind === 'income' || t.kind === 'expense' ? catOf(t.kind, t.cat).name : '';
        return [t.title, t.memo, t.sub || '', c, String(t.amount), acctOf(t.account).name].join(' ').toLowerCase().includes(q);
      });
      const ex = list.filter((t) => t.kind === 'expense').reduce((a, t) => a + t.amount, 0), inc = list.filter((t) => t.kind === 'income').reduce((a, t) => a + t.amount, 0);
      h += `<p class="hint">${list.length}件・支出 ${yen(ex)}・収入 ${yen(inc)}</p>`;
    } else {
      list = all().filter((t) => t.date.startsWith(m) && (!KB.cat || (t.kind === 'expense' && t.cat === KB.cat)));
      if (KB.cat) h += `<p class="hint">${esc(catOf('expense', KB.cat).icon)} ${esc(catOf('expense', KB.cat).name)} だけ出しています</p>`;
    }
    h += dayList(list, !!KB.search.trim()) + '</section>';
    return h;
  }

  // 前借り・後払い：まだ払っていない後払いと、これから入る分の前借り
  function shiftBlock() {
    const s = settings(), now = today();
    const items = shifts().map((x) => ({ x, r: s.recurring.find((r) => r.id === x.rec) })).filter(({ x, r }) => r && (x.kind === 'defer' ? !x.paid : !txs().some((t) => t.id === recTxId(r, x.period))));
    if (!items.length) return '';
    items.sort((a, b) => (a.x.kind === b.x.kind ? (a.x.date || '9').localeCompare(b.x.date || '9') : a.x.kind === 'defer' ? -1 : 1));
    return `<section class="sec"><h3 class="sec-title"><span class="mark">🔁</span> 前借り・後払い</h3><ul class="lines">${items.map(({ x, r }) => {
      const c = catOf(r.kind, r.cat), lbl = periodLabel(x.period);
      if (x.kind === 'defer') {
        const n = x.date ? Math.round((parseD(x.date) - parseD(now)) / 86400000) : null;
        const due = x.date ? `<span class="tag ${n < 0 ? 'due' : n <= 3 ? 'part' : 'soft'}">⏰ ${esc(md(x.date))}・${n < 0 ? `すぎ（${-n}日）` : n === 0 ? '今日' : `あと${n}日`}</span>` : '';
        return `<li><div class="who">${esc(c.icon)} ${esc(recName(r))}（${esc(lbl)}）<small>後払い・まだ払っていない</small>${due}</div>
          <div class="amt out">${yen(x.amount)}<br><button class="btn small" data-act="kb-shift-edit" data-id="${esc(x.id)}">払った</button></div></li>`;
      }
      const left = Math.max(0, r.amount - shiftSum(r.id, x.period));
      return `<li><div class="who">${esc(c.icon)} ${esc(recName(r))}（${esc(lbl)}）から前借り<small>${esc(lbl)}は ${yen(left)} になります${x.date ? '・' + esc(md(x.date)) + 'に前借り' : ''}</small></div>
        <div class="amt in">${yen(x.amount)}<br><button class="btn small" data-act="kb-shift-edit" data-id="${esc(x.id)}">見る</button></div></li>`;
    }).join('')}</ul></section>`;
  }
  const unpaidDefers = () => { const s = settings(); return shifts().filter((x) => x.kind === 'defer' && !x.paid && s.recurring.some((r) => r.id === x.rec)); };

  // ---- 一度きりの予定（遊びに行く など）と、その予算 ----
  const events = () => settings().events;
  const evEnd = (e) => e.end || e.date;
  const evSpent = (e) => txs().filter((t) => t.kind === 'expense' && t.event === e.id).reduce((a, t) => a + t.amount, 0);
  const evWhen = (e) => {
    const n = KL.daysLeft(e.date), ne = KL.daysLeft(evEnd(e));
    return ne < 0 ? 'おわった' : n > 0 ? `あと${n}日` : n === 0 ? '今日' : 'いま';
  };
  const evDate = (e) => `${md(e.date)}${e.end && e.end !== e.date ? '〜' + md(e.end) : ''}`;
  // まだ使っていない予定の予算（その月のこれからの予定の分）
  const evReserve = (m) => events().filter((e) => evEnd(e) >= today() && e.date.slice(0, 7) <= m && evEnd(e).slice(0, 7) >= m).reduce((a, e) => a + Math.max(0, (e.budget || 0) - evSpent(e)), 0);
  function eventCard(e, open) {
    const sp = evSpent(e), b = e.budget || 0, left = b - sp, pct = b ? Math.min(100, Math.round((sp / b) * 100)) : 0, w = evWhen(e);
    const list = open ? txs().filter((t) => t.kind === 'expense' && t.event === e.id).sort((x, y) => y.date.localeCompare(x.date)) : [];
    return `<article class="entry ev"><div class="entry-head"><h3>${esc(e.icon || '🎟')} ${esc(e.name)}</h3><time>${esc(evDate(e))}</time></div>
      <div class="row between"><span class="tag ${w === 'おわった' ? 'soft' : w === '今日' || w === 'いま' ? 'part' : 'soft'}">${esc(w)}</span>
        <span class="num">${b ? `予算 ${yen(b)}・` : ''}使った ${yen(sp)}${b ? (left >= 0 ? `・<b style="color:var(--brass-bright)">あと ${yen(left)}</b>` : `・<b class="over-t">${yen(-left)} オーバー</b>`) : ''}</span></div>
      ${b ? `<span class="meter big"><span style="width:${pct}%" class="${left < 0 ? 'over' : ''}"></span></span>` : ''}
      ${e.memo ? `<p class="memo">${esc(e.memo)}</p>` : ''}
      ${open ? (list.length ? `<ul class="kb-list">${list.map(txLine).join('')}</ul>` : '<p class="hint">まだこの予定で使った記録はありません。</p>') : ''}
      <div class="row end"><button class="btn small" data-act="kb-ev-open" data-id="${esc(e.id)}">${open ? 'とじる' : `くわしく${sp ? `（${txs().filter((t) => t.event === e.id).length}件）` : ''}`}</button>
        <button class="btn small" data-act="kb-ev-edit" data-id="${esc(e.id)}">直す</button>
        ${w !== 'おわった' || open ? `<button class="btn small primary" data-act="kb-ev-add" data-id="${esc(e.id)}">＋ 使ったのを入れる</button>` : ''}</div></article>`;
  }
  function viewEvents() {
    const now = today(), list = events().slice();
    const up = list.filter((e) => evEnd(e) >= now).sort((a, b) => a.date.localeCompare(b.date));
    const past = list.filter((e) => evEnd(e) < now).sort((a, b) => b.date.localeCompare(a.date));
    return `<section class="sec">
      <h2 class="sec-title"><span class="mark">🎟</span> 予定と予算<span class="grow"></span><button class="btn primary small" data-act="kb-ev-edit" data-id="">＋ 予定を足す</button></h2>
      <p class="hint">遊びに行く・旅行・誕生日など、一度きりの予定に予算を決めておけます。家計簿に入れるときに予定をえらぶと、あといくら使えるかが出ます。</p>
      ${up.length ? `<div class="entries">${up.map((e) => eventCard(e, KB.evOpen === e.id)).join('')}</div>` : '<p class="empty">これからの予定はありません。<br>「＋ 予定を足す」から書きましょう。</p>'}
    </section>
    ${past.length ? `<section class="sec"><h3 class="sec-title"><span class="mark">✦</span> おわった予定</h3><div class="entries">${past.slice(0, KB.evAll ? 999 : 5).map((e) => eventCard(e, KB.evOpen === e.id)).join('')}</div>
      ${past.length > 5 && !KB.evAll ? `<button class="btn link" data-act="kb-ev-all">ぜんぶ見る（${past.length}件）</button>` : ''}</section>` : ''}`;
  }
  // 家計簿の月：その月の予定
  function eventBlock(m) {
    const list = events().filter((e) => e.date.slice(0, 7) <= m && evEnd(e).slice(0, 7) >= m).sort((a, b) => a.date.localeCompare(b.date));
    if (!list.length) return '';
    return `<section class="sec"><h3 class="sec-title"><span class="mark">🎟</span> ${+m.slice(5, 7)}月の予定<span class="grow"></span><button class="btn link" data-act="kb-sub" data-v="events">予定を見る</button></h3>
      <ul class="lines">${list.map((e) => { const sp = evSpent(e), b = e.budget || 0; return `<li><div class="who">${esc(e.icon || '🎟')} ${esc(e.name)}<small>${esc(evDate(e))}・${esc(evWhen(e))}</small></div>
        <div class="amt">${b ? (b - sp >= 0 ? `あと ${yen(b - sp)}` : `<span class="over-t">${yen(sp - b)} オーバー</span>`) : `使った ${yen(sp)}`}<br><small class="faint">${b ? `予算 ${yen(b)}・使った ${yen(sp)}` : ''}</small></div></li>`; }).join('')}</ul></section>`;
  }
  // 家計簿に入れるとき：予定をえらぶ（おわって30日たったものは出さない）
  function eventField(X) {
    const lim = addDays(today(), -30), list = events().filter((e) => evEnd(e) >= lim || e.id === X.event).sort((a, b) => a.date.localeCompare(b.date));
    if (!list.length) return '';
    return `<fieldset><legend>予定（なくてもOK）</legend><div class="filters">${list.map((e) => `<button type="button" class="pillbtn" data-act="kb-pick-event" data-v="${esc(e.id)}" aria-pressed="${X.event === e.id}">${esc(e.icon || '🎟')} ${esc(e.name)}・${esc(md(e.date))}</button>`).join('')}</div></fieldset>`;
  }

  function budgetBlock(m, sum) {
    const total = settings().budget.total;
    if (!total) return `<p class="hint">予算を決めると、あといくら使えるかが出ます（⚙️ 設定 → 予算）</p>`;
    const left = total - sum.exp, pct = Math.min(100, Math.round((sum.exp / total) * 100));
    let pace = '', reserve = '';
    if (m === curYM()) {
      const days = daysIn(m) - +today().slice(8, 10) + 1, rv = evReserve(m), free = left - rv;
      pace = left > 0 ? `・今日から1日 ${yen(Math.floor(Math.max(0, free) / days))} まで（あと${days}日）` : '';
      if (rv) reserve = `<small class="hint">🎟 予定の分 ${yen(rv)} を残しておくと、使えるのは${free >= 0 ? `あと <b style="color:var(--brass-bright)">${yen(free)}</b>` : `<b class="over-t">${yen(-free)} たりない</b>`}</small>`;
    }
    return `<div class="kb-budget"><div class="row between"><span>予算 ${yen(total)}</span><span class="num" style="color:${left < 0 ? 'var(--danger-text)' : 'var(--brass-bright)'}">${left < 0 ? `${yen(-left)} オーバー` : `あと ${yen(left)}`}</span></div>
      <span class="meter big"><span style="width:${pct}%" class="${left < 0 ? 'over' : ''}"></span></span><small class="hint">${pct}% 使いました${pace}</small>${reserve ? '<br>' + reserve : ''}</div>`;
  }

  function txLine(t) {
    let icon, name, amt, cls, sub;
    if (t.kind === 'transfer') { icon = '🔁'; name = t.title || '振替'; amt = yen(t.amount); cls = ''; sub = `${acctOf(t.account).name} → ${acctOf(t.toAccount).name}`; }
    else if (t.kind === 'adjust') { icon = '⚖️'; name = t.title || '残高を合わせた'; amt = (t.dir === 'minus' ? '−' : '+') + yen(t.amount); cls = ''; sub = acctOf(t.account).name; }
    else if (t.kind === 'lendout' || t.kind === 'lendin') { icon = '🤝'; name = t.title; amt = (t.kind === 'lendin' ? '+' : '−') + yen(t.amount); cls = 'lend'; sub = `${t.sub}・${acctOf(t.account).name}`; }
    else {
      const c = catOf(t.kind, t.cat); icon = c.icon; name = t.title || c.name;
      amt = (t.kind === 'income' ? '+' : '−') + yen(t.amount); cls = t.kind === 'income' ? 'in' : 'out';
      sub = `${t.title ? c.name + '・' : ''}${acctOf(t.account).name}${t.virt ? '・' + t.sub : ''}`;
      if (t.kind === 'income') { const mv = txs().filter((x) => x.from === t.id); if (mv.length) sub += '・' + mv.map((x) => `→ ${acctOf(x.toAccount).name} ${yen(x.amount)}`).join('、'); }
      if (t.event) { const ev = settings().events.find((e) => e.id === t.event); if (ev) sub += `・🎟 ${ev.name}`; }
    }
    return `<li><button data-act="kb-edit" data-id="${esc(t.id)}"><span class="kb-ic">${esc(icon)}</span>
      <span class="kb-tx"><span class="kb-tx-name">${esc(name)}${t.virt ? ' <small class="tag soft">貸し借り</small>' : ''}${t.rec ? ' <small class="tag part">固定費</small>' : ''}${t.shift ? ` <small class="tag soft">${t.kind === 'income' ? '前借り' : '後払い'}</small>` : ''}</span><small>${esc(sub)}${t.rec && t.shifted ? `・${t.kind === 'income' ? '前借り' : '後払い'} ${yen(t.shifted)} を差し引き` : ''}${t.memo ? '・' + esc(t.memo) : ''}</small></span>
      <span class="amt ${cls}">${amt}</span></button></li>`;
  }
  function dayList(list, withYear) {
    if (!list.length) return `<p class="empty">${KB.search.trim() ? '見つかりませんでした' : 'この月の記録はまだありません。<br>「＋ 入れる」から書きましょう。'}</p>`;
    const by = {};
    list.forEach((t) => { (by[t.date] = by[t.date] || []).push(t); });
    return Object.keys(by).sort().reverse().map((d) => {
      const items = by[d].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      const net = items.reduce((a, t) => a + (t.kind === 'income' || t.kind === 'lendin' ? t.amount : t.kind === 'expense' || t.kind === 'lendout' ? -t.amount : 0), 0);
      return `<div class="kb-day"><div class="kb-day-head"><span class="mono">${withYear ? d.slice(0, 4) + ' ' : ''}${md(d)}</span><span class="num ${net >= 0 ? 'in' : 'out'}">${net ? (net > 0 ? '+' : '−') + yen(Math.abs(net)) : ''}</span></div>
        <ul class="kb-list">${items.map(txLine).join('')}</ul></div>`;
    }).join('');
  }

  // 口座と通帳
  function viewAccounts() {
    const s = settings(), S = ctx.S();
    if (KB.acct) return viewPassbook(acctOf(KB.acct));
    const total = s.accounts.reduce((a, x) => a + balance(x), 0);
    // 貸し借り（自分だけの帳簿＋みんなの帳簿）
    let lent = 0, borrowed = 0;
    KL.personalNets(S.personal).forEach((x) => { lent += x.lent; borrowed += x.borrowed; });
    S.books.forEach((b) => KL.myNets(b, S.loans[b.id] || [], S.user.uid).forEach((x) => { lent += x.lent; borrowed += x.borrowed; }));
    const unpaid = unpaidDefers().reduce((a, x) => a + x.amount, 0);
    return `<section class="sec">
      <h2 class="sec-title"><span class="mark">👛</span> 口座<span class="grow"></span><button class="btn small" data-act="kb-new" data-v="transfer">🔁 振替</button><button class="btn primary small" data-act="kb-acct-new">＋ 口座</button></h2>
      <ul class="kb-accts">${s.accounts.map((a) => { const v = balance(a); return `<li>
        <button class="kb-acct" data-act="kb-passbook" data-id="${esc(a.id)}"><span class="kb-ic">${esc(a.icon)}</span><span class="grow">${esc(a.name)}<small>通帳を見る</small></span><span class="num ${v < 0 ? 'out' : ''}">${v < 0 ? '−' : ''}${yen(Math.abs(v))}</span></button>
        <button class="btn small" data-act="kb-acct-edit" data-id="${esc(a.id)}" aria-label="${esc(a.name)} を直す">⚙</button></li>`; }).join('')}</ul>
      <ul class="lines">
        <li><div class="who">口座の合計</div><div class="amt">${total < 0 ? '−' : ''}${yen(Math.abs(total))}</div></li>
        <li><div class="who">＋ 貸している（返ってくる予定）<small>みんなの帳簿と、自分だけの帳簿の貸し借り</small></div><div class="amt in">${yen(lent)}</div></li>
        <li><div class="who">− 借りている（返す予定）</div><div class="amt out">${yen(borrowed)}</div></li>
        ${unpaid ? `<li><div class="who">− まだ払っていない後払い</div><div class="amt out">${yen(unpaid)}</div></li>` : ''}
        <li><div class="who"><b>ぜんぶ合わせると</b></div><div class="amt" style="color:var(--brass-bright)">${total + lent - borrowed - unpaid < 0 ? '−' : ''}${yen(Math.abs(total + lent - borrowed - unpaid))}</div></li>
      </ul>
      <p class="hint">口座の残高が合わないときは、口座の通帳で「残高を合わせる」を押すと、ほんとうの残高に直せます。</p>
    </section>`;
  }
  function viewPassbook(a) {
    // 通帳：古い順に残高を数えて、新しい順に出す
    const list = all().filter((t) => effect(t, a.id) !== 0 || ((t.account === a.id || t.toAccount === a.id) && t.amount === 0))
      .sort((x, y) => x.date.localeCompare(y.date) || (x.createdAt || 0) - (y.createdAt || 0));
    let bal = a.initial || 0;
    const rows = list.map((t) => { const e = effect(t, a.id); bal += e; return { t, e, bal }; }).reverse();
    const name = (t) => t.kind === 'transfer' ? (t.title || (t.account === a.id ? `振替 → ${acctOf(t.toAccount).name}` : `振替 ← ${acctOf(t.account).name}`))
      : t.kind === 'adjust' ? (t.title || '残高を合わせた') : t.virt ? `🤝 ${t.title}` : (t.title || catOf(t.kind, t.cat).name);
    return `<section class="sec">
      <div class="kb-nav"><button class="btn small" data-act="kb-passbook" data-id="">◀ 口座</button><h2 class="display">${esc(a.icon)} ${esc(a.name)} の通帳</h2></div>
      <div class="row between"><span class="hint">いまの残高</span><span class="num" style="font-size:1.3rem;color:var(--brass-bright)">${balance(a) < 0 ? '−' : ''}${yen(Math.abs(balance(a)))}</span></div>
      <div class="row"><button class="btn small" data-act="kb-adjust" data-id="${esc(a.id)}">⚖️ 残高を合わせる</button><button class="btn small" data-act="kb-new" data-v="transfer">🔁 振替</button></div>
      <div class="passbook"><table><thead><tr><th>日付</th><th>内容</th><th class="r">お引出し</th><th class="r">お預入れ</th><th class="r">残高</th></tr></thead><tbody>
      ${rows.map(({ t, e, bal: b }) => `<tr data-act="kb-edit" data-id="${esc(t.id)}"><td class="mono">${+t.date.slice(5, 7)}/${+t.date.slice(8, 10)}</td><td>${esc(name(t))}</td>
        <td class="r num out">${e < 0 ? yen(-e) : ''}</td><td class="r num in">${e > 0 ? yen(e) : ''}</td><td class="r num">${b < 0 ? '−' : ''}${yen(Math.abs(b))}</td></tr>`).join('')}
      <tr class="start"><td></td><td>はじめの残高</td><td></td><td></td><td class="r num">${yen(a.initial || 0)}</td></tr>
      </tbody></table></div>
    </section>`;
  }

  // 1年の流れ
  function viewYear() {
    const y = KB.year, months = Array.from({ length: 12 }, (_, i) => `${y}-${pad(i + 1)}`);
    const sums = months.map(monthSum);
    const inc = sums.reduce((a, x) => a + x.inc, 0), exp = sums.reduce((a, x) => a + x.exp, 0);
    const used = sums.filter((x) => x.inc || x.exp).length || 1;
    const max = Math.max(1, ...sums.map((x) => Math.max(x.inc, x.exp)));
    // 棒グラフ（収入・支出）
    const W = 340, H = 150, top = 10, bot = 22, bw = W / 12, ph = H - top - bot;
    const bars = sums.map((x, i) => {
      const hi = Math.round((x.inc / max) * ph), he = Math.round((x.exp / max) * ph), x0 = i * bw + bw * 0.16, w = bw * 0.3;
      return `<g data-act="kb-goto" data-v="${months[i]}" style="cursor:pointer"><rect x="${i * bw}" y="0" width="${bw}" height="${H}" fill="transparent"/>
        <rect x="${x0.toFixed(1)}" y="${top + ph - hi}" width="${w.toFixed(1)}" height="${hi}" rx="2" fill="var(--signal)"/>
        <rect x="${(x0 + w + 1).toFixed(1)}" y="${top + ph - he}" width="${w.toFixed(1)}" height="${he}" rx="2" fill="var(--danger-text)"/>
        <text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--parchment-dim)">${i + 1}</text></g>`;
    }).join('');
    const byCat = {};
    sums.forEach((x) => Object.entries(x.byCat).forEach(([k, v]) => { byCat[k] = (byCat[k] || 0) + v; }));
    const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    return `<section class="sec">
      <div class="kb-nav"><button class="btn small" data-act="kb-year" data-v="-1" aria-label="前の年">◀</button><h2 class="display">${y}年</h2><button class="btn small" data-act="kb-year" data-v="1" aria-label="次の年">▶</button></div>
      <div class="kb-sum">
        <div class="bal in"><span class="label">収入</span><span class="num">${yen(inc)}</span></div>
        <div class="bal out"><span class="label">支出</span><span class="num">${yen(exp)}</span></div>
        <div class="bal"><span class="label">収支</span><span class="num" style="color:${inc - exp >= 0 ? 'var(--signal)' : 'var(--danger-text)'}">${inc - exp < 0 ? '−' : ''}${yen(Math.abs(inc - exp))}</span></div>
      </div>
      <p class="hint">1か月の平均：支出 ${yen(Math.round(exp / used))}・収入 ${yen(Math.round(inc / used))}（記録のある${used}か月）</p>
      <div class="kb-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${y}年の月ごとの収入と支出">
        <line x1="0" y1="${top + ph}" x2="${W}" y2="${top + ph}" stroke="var(--chart-line)"/>${bars}</svg>
        <div class="legend"><span><i style="background:var(--signal)"></i>収入</span><span><i style="background:var(--danger-text)"></i>支出</span><span class="hint">月を押すとその月へ</span></div></div>
    </section>
    <section class="sec"><h3 class="sec-title"><span class="mark">◔</span> ${y}年に何に使った？</h3>
      ${cats.length ? `<ul class="lines">${cats.map(([id, v]) => { const c = catOf('expense', id); return `<li><div class="who">${esc(c.icon)} ${esc(c.name)}<small>月に ${yen(Math.round(v / used))}・${Math.round((v / exp) * 100)}%</small></div><div class="amt">${yen(v)}</div></li>`; }).join('')}</ul>` : '<p class="empty">この年の支出はまだありません</p>'}
    </section>`;
  }

  // 設定
  function viewSettings() {
    const s = settings();
    const catList = (kind, list) => `<div class="filters">${list.map((c) => `<button class="pillbtn" data-act="kb-cat-edit" data-kind="${kind}" data-id="${esc(c.id)}">${esc(c.icon)} ${esc(c.name)}</button>`).join('')}
      <button class="pillbtn" data-act="kb-cat-edit" data-kind="${kind}" data-id="">＋ 足す</button></div>`;
    return `<section class="sec">
      <h2 class="sec-title"><span class="mark">🎯</span> 予算（1か月）<span class="grow"></span><button class="btn small" data-act="kb-budget">直す</button></h2>
      <p class="hint">${s.budget.total ? `ぜんぶで ${yen(s.budget.total)}` : 'まだ決めていません'}${Object.keys(s.budget.cats).filter((k) => +s.budget.cats[k]).length ? `・分類ごと：${Object.entries(s.budget.cats).filter(([, v]) => +v).map(([k, v]) => `${esc(catOf('expense', k).name)} ${yen(+v)}`).join('、')}` : ''}</p>
    </section>
    <section class="sec">
      <h2 class="sec-title"><span class="mark">🔁</span> 固定費・定期の収入<span class="grow"></span><button class="btn small" data-act="kb-rec-edit" data-id="">＋ 足す</button></h2>
      <p class="hint">家賃・スマホ代・サブスク・お小遣い・給料など。毎月・毎年・毎週の、その日になると自動で家計簿に入ります。</p>
      <p class="hint">収入は「前借り」、支払いは「後払い」ができます。何月（何年・何日）の分かをえらぶと、その分が入るときに差し引きます。</p>
      ${s.recurring.length ? `<ul class="lines">${s.recurring.map((r) => { const c = catOf(r.kind, r.cat); return `<li><div class="who"><button class="btn link" data-act="kb-rec-edit" data-id="${esc(r.id)}">${esc(c.icon)} ${esc(recName(r))}</button>
        <small>${esc(freqLabel(r))}・${esc(acctOf(r.account).name)}${(r.moves || []).length ? '・' + r.moves.map((mv) => `→ ${esc(acctOf(mv.account).name)} ${yen(mv.amount)}`).join('、') : ''}${r.active === false ? '・お休み中' : ''}</small>
        <button class="btn small" data-act="kb-shift-new" data-id="${esc(r.id)}">${r.kind === 'income' ? '💴 前借り' : '🕒 後払い'}</button></div>
        <div class="amt ${r.kind === 'income' ? 'in' : 'out'}">${r.kind === 'income' ? '+' : '−'}${yen(r.amount)}</div></li>`; }).join('')}</ul>` : ''}
    </section>
    <section class="sec">
      <h2 class="sec-title"><span class="mark">🤝</span> 貸し借りを家計簿に入れる<span class="grow"></span><button class="btn small" data-act="kb-lendset">直す</button></h2>
      <p class="hint">${s.lend.on ? `入れる・いつもの口座は ${esc(acctOf(s.lend.account).icon)} ${esc(acctOf(s.lend.account).name)}${s.lend.since ? `・${esc(md(s.lend.since))}から` : ''}` : '入れない'}。1件ずつの口座や「入れない」は、家計簿の 🤝 の記録を押して直せます。</p>
      ${Object.entries(s.lend.links).filter(([, v]) => v && (v.off || v.as === 'off')).length ? `<button class="btn link" data-act="kb-voff-list">入れないにした記録（${Object.entries(s.lend.links).filter(([, v]) => v && (v.off || v.as === 'off')).length}件）</button>
        ${KB.showOff ? `<ul class="lines">${Object.entries(s.lend.links).filter(([, v]) => v && (v.off || v.as === 'off')).map(([key]) => { const v = vtxRaw(key); return v ? `<li><div class="who"><button class="btn link" data-act="kb-edit" data-id="v:${esc(key)}">🤝 ${esc(v.title)}</button><small>${esc(v.sub)}・${esc(md(v.date))}</small></div><div class="amt">${yen(v.amount)}</div></li>` : ''; }).join('')}</ul>` : ''}` : ''}
    </section>
    <section class="sec">
      <h2 class="sec-title"><span class="mark">🏷</span> 分類</h2>
      <p class="hint">支出</p>${catList('expense', s.expenseCats)}
      <p class="hint">収入</p>${catList('income', s.incomeCats)}
    </section>
    <section class="sec">
      <h2 class="sec-title"><span class="mark">💾</span> 書き出し（CSV）</h2>
      <p class="hint">Excel や Google スプレッドシートで開けます。${window.KashikariApp ? (/KashikariIOS/.test(navigator.userAgent) ? 'アプリでは共有の画面が出るので、「"ファイル"に保存」などを選んでください。' : 'アプリでは「ダウンロード」フォルダーに保存します。') : ''}</p>
      <div class="row"><button class="btn small" data-act="kb-csv" data-v="tx">家計簿を書き出す</button><button class="btn small" data-act="kb-csv" data-v="lend">自分の貸し借りを書き出す</button></div>
    </section>`;
  }

  // ---------- 入れる・直す（シート）----------
  const titles = { 'kb-tx': '家計簿に入れる', 'kb-acct': '口座', 'kb-cat': '分類', 'kb-budget': '予算（1か月）', 'kb-rec': '固定費・定期の収入', 'kb-adjust': '残高を合わせる' };
  const title = (k) => {
    const X = ctx.U().sheet;
    if (k === 'kb-shift') { const r = settings().recurring.find((x) => x.id === X.rec); return r ? `${r.kind === 'income' ? '💴 前借り' : '🕒 後払い'}：${recName(r)}` : '前借り・後払い'; }
    if (k === 'kb-vlink') return '🤝 貸し借りの記録';
    if (k === 'kb-event') return X.id ? '🎟 予定を直す' : '🎟 予定を足す';
    if (k === 'kb-lendset') return '🤝 貸し借りを家計簿に入れる';
    return k === 'kb-tx' && X.id ? '記録を直す' : titles[k];
  };

  function openTx(kind, id) {
    const s = settings();
    const t = id ? txs().find((x) => x.id === id) : null;
    if (id && !t) return;
    const k = t ? t.kind : kind;
    if (k === 'adjust') { openAdjust(t.account, t); return; }
    const last = (kk) => (txs().filter((x) => x.kind === kk).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || {});
    const l = last(k);
    ctx.openSheet('kb-tx', {
      id: t ? t.id : null, kind: k, amount: t ? String(t.amount) : '', date: t ? t.date : (KB.month === curYM() ? today() : `${KB.month}-01`),
      cat: t ? t.cat : (k === 'income' ? s.incomeCats[0].id : (KB.cat || s.expenseCats[0].id)),
      account: t ? t.account : (KB.acct || l.account || s.accounts[0].id), toAccount: t ? t.toAccount : (l.toAccount || (s.accounts[1] || s.accounts[0]).id),
      title: t ? t.title : '', memo: t ? t.memo : '', rec: t ? t.rec : '', shift: t ? t.shift : '', moves: [], event: t ? t.event : (KB.evFor || ''), from: t ? t.from : '', base: t ? t.base : 0, shifted: t ? t.shifted : 0, createdAt: t ? t.createdAt : 0, del: false,
    });
  }
  function openAdjust(acctId, t) {
    ctx.openSheet('kb-adjust', { id: t ? t.id : null, account: acctId, actual: '', date: t ? t.date : today(), edit: !!t, amount: t ? t.amount : 0, dir: t ? t.dir : 'plus', del: false });
  }
  const chips = (list, act, cur) => `<div class="filters">${list.map((c) => `<button type="button" class="pillbtn" data-act="${act}" data-v="${esc(c.id)}" aria-pressed="${cur === c.id}">${esc(c.icon)} ${esc(c.name)}</button>`).join('')}</div>`;
  const delRow = (X, label) => X.id ? (X.del
    ? `<div class="confirm"><span>${label}</span><button type="button" class="btn small danger" data-act="kb-del-yes">消す</button><button type="button" class="btn small" data-act="kb-del-no">やめる</button></div>`
    : `<div class="row"><button type="button" class="btn small danger" data-act="kb-del">消す</button></div>`) : '';

  // 収入から、ほかの口座に移す（PayPay など）
  function movesField(X) {
    const s = settings(), others = s.accounts.filter((a) => a.id !== X.account);
    return `<fieldset><legend>そのうち、ほかの口座に移した？（PayPay など・なくてもOK）</legend>
      ${(X.moves || []).map((mv, i) => `<div class="mv-row"><div class="filters">${others.map((a) => `<button type="button" class="pillbtn" data-act="kb-mv-acct" data-i="${i}" data-v="${esc(a.id)}" aria-pressed="${mv.account === a.id}">${esc(a.icon)} ${esc(a.name)}</button>`).join('')}</div>
        <div class="row"><div class="yen"><span>¥</span><input id="kb-mv-${i}" inputmode="numeric" data-bind="sheet.mv" data-key="${i}" value="${esc(mv.amount)}" placeholder="0"></div><button type="button" class="btn small" data-act="kb-mv-del" data-i="${i}" aria-label="この移す先をやめる">×</button></div></div>`).join('')}
      ${others.length ? '<div class="row"><button type="button" class="btn small" data-act="kb-mv-add">＋ 移す先を足す</button></div>' : ''}</fieldset>`;
  }
  // 移す先を確かめて、振替の記録にする（収入の口座から）
  function moveTx(X, amount, incomeId, date, title) {
    const list = (X.moves || []).filter((mv) => mv.account && calc(mv.amount) > 0);
    const sum = list.reduce((a, mv) => a + calc(mv.amount), 0);
    if (sum > amount) return { err: `移す額（${yen(sum)}）が、収入（${yen(amount)}）より多いです` };
    return { ops: list.map((mv) => ({ op: 'set', col: 'tx', id: KStore.newKbId('tx'), body: { kind: 'transfer', date, amount: calc(mv.amount), account: X.account, toAccount: mv.account, title: `${title}から移した`, memo: '', from: incomeId } })) };
  }

  function sheetBody(k) {
    const X = ctx.U().sheet, s = settings();
    if (k === 'kb-tx') {
      const seg = (v, t) => `<button type="button" data-act="kb-kind" data-v="${v}" aria-pressed="${X.kind === v}">${t}</button>`;
      const recentTitles = [...new Set(txs().filter((t) => t.kind === X.kind && t.title).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map((t) => t.title))].slice(0, 30);
      return `<div><div class="seg">${seg('expense', '支出')}${seg('income', '収入')}${seg('transfer', '振替')}</div></div>
        <div class="two">
          <div class="field"><label for="kb-amount">金額（1200+300 のような足し算もOK）</label><div class="yen"><span>¥</span><input id="kb-amount" inputmode="text" data-bind="sheet.amount" value="${esc(X.amount)}" placeholder="0"></div><span class="hint" id="kb-calc"></span></div>
          <div class="field"><label for="kb-date">日付</label><input id="kb-date" type="date" data-bind="sheet.date" value="${esc(X.date)}"></div>
        </div>
        ${X.kind === 'transfer'
          ? `<fieldset><legend>どこから</legend>${chips(s.accounts, 'kb-pick-acct', X.account)}</fieldset><fieldset><legend>どこへ</legend>${chips(s.accounts, 'kb-pick-to', X.toAccount)}</fieldset>`
          : `<fieldset><legend>分類</legend>${chips(X.kind === 'income' ? s.incomeCats : s.expenseCats, 'kb-pick-cat', X.cat)}</fieldset>
             <fieldset><legend>${X.kind === 'income' ? 'どこに入った？' : 'どこから払った？'}</legend>${chips(s.accounts, 'kb-pick-acct', X.account)}</fieldset>
             ${X.kind === 'income' ? (X.id ? (() => { const mv = txs().filter((x) => x.from === X.id); return mv.length ? `<p class="hint">この収入から移した：${mv.map((x) => `${esc(acctOf(x.toAccount).name)} ${yen(x.amount)}`).join('、')}（振替の記録で直せます）</p>` : ''; })() : movesField(X)) : ''}
             ${X.kind === 'expense' ? eventField(X) : ''}`}
        <div class="two">
          <div class="field"><label for="kb-title">内容・お店（なくてもOK）</label><input id="kb-title" maxlength="60" list="kb-titles" data-bind="sheet.title" value="${esc(X.title)}" placeholder="${X.kind === 'income' ? '例：11月分' : X.kind === 'transfer' ? '例：ATMでおろした' : '例：コンビニ'}"><datalist id="kb-titles">${recentTitles.map((t) => `<option value="${esc(t)}">`).join('')}</datalist></div>
          <div class="field"><label for="kb-memo">メモ（なくてもOK）</label><input id="kb-memo" maxlength="300" data-bind="sheet.memo" value="${esc(X.memo)}"></div>
        </div>
        ${X.rec ? '<p class="hint">固定費で自動で入った記録です。消すと、この分はもう入りません。</p>' : ''}
        ${X.shift ? '<p class="hint">前借り・後払いの記録です。消すと、前借り（後払いを払ったこと）も取り消します。</p>' : ''}
        ${delRow(X, txs().some((x) => x.from === X.id) ? 'この記録を消しますか？（この収入から移した記録も消えます）' : 'この記録を消しますか？')}
        <div class="row end">${X.id ? '' : '<button type="button" class="btn" data-act="kb-save-more">保存して続ける</button>'}<button type="button" class="btn" data-act="sheet-close">やめる</button><button type="submit" class="btn primary">保存する</button></div>`;
    }
    if (k === 'kb-adjust') {
      const a = acctOf(X.account), cur = balance(a) - (X.edit ? (X.dir === 'minus' ? -X.amount : X.amount) : 0);
      return X.edit
        ? `<p class="hint">${esc(a.name)} の残高を ${X.dir === 'minus' ? '−' : '+'}${yen(X.amount)} 合わせた記録です（${esc(X.date)}）。</p>${delRow(X, 'この記録を消しますか？')}<div class="row end"><button type="button" class="btn" data-act="sheet-close">とじる</button></div>`
        : `<p class="hint">${esc(a.icon)} ${esc(a.name)}：この帳簿では <b class="num">${cur < 0 ? '−' : ''}${yen(Math.abs(cur))}</b>。ほんとうの残高を入れると、差の分を「残高を合わせた」として入れます（収入・支出には数えません）。</p>
          <div class="two"><div class="field"><label for="kb-actual">ほんとうの残高</label><div class="yen"><span>¥</span><input id="kb-actual" inputmode="numeric" data-bind="sheet.actual" value="${esc(X.actual)}"></div></div>
          <div class="field"><label for="kb-adate">日付</label><input id="kb-adate" type="date" data-bind="sheet.date" value="${esc(X.date)}"></div></div>
          ${ctx.foot('合わせる')}`;
    }
    if (k === 'kb-acct') return `<div class="two">
        <div class="field"><label for="ka-name">口座の名前</label><input id="ka-name" maxlength="20" data-bind="sheet.name" value="${esc(X.name)}" placeholder="例：ゆうちょ・PayPay"></div>
        <div class="field"><label for="ka-icon">しるし（絵文字1つ）</label><input id="ka-icon" maxlength="4" data-bind="sheet.icon" value="${esc(X.icon)}"></div></div>
        <div class="field"><label for="ka-init">はじめの残高（記録をつけはじめたときの残高）</label><div class="yen"><span>¥</span><input id="ka-init" inputmode="numeric" data-bind="sheet.initial" value="${esc(X.initial)}"></div></div>
        ${X.id ? (X.used ? '<p class="hint">この口座を使った記録があるので消せません。</p>' : delRow(X, 'この口座を消しますか？')) : ''}${ctx.foot('保存する')}`;
    if (k === 'kb-cat') return `<p class="hint">${X.kind === 'income' ? '収入' : '支出'}の分類</p><div class="two">
        <div class="field"><label for="kc-name">名前</label><input id="kc-name" maxlength="16" data-bind="sheet.name" value="${esc(X.name)}" placeholder="例：推し活"></div>
        <div class="field"><label for="kc-icon">しるし（絵文字1つ）</label><input id="kc-icon" maxlength="4" data-bind="sheet.icon" value="${esc(X.icon)}"></div></div>
        ${X.id ? delRow(X, 'この分類を消しますか？（記録は「その他」として出ます）') : ''}${ctx.foot('保存する')}`;
    if (k === 'kb-budget') return `<div class="field"><label for="kbu-total">1か月の予算（ぜんぶで）</label><div class="yen"><span>¥</span><input id="kbu-total" inputmode="numeric" data-bind="sheet.total" value="${esc(X.total)}" placeholder="0（決めない）"></div></div>
        <fieldset><legend>分類ごと（決めたいものだけ）</legend><div class="amount-rows">${s.expenseCats.map((c) => `<div class="amount-row"><label class="name" for="kbu-${esc(c.id)}">${esc(c.icon)} ${esc(c.name)}</label>
          <div class="yen"><span>¥</span><input id="kbu-${esc(c.id)}" inputmode="numeric" data-bind="sheet.cat" data-key="${esc(c.id)}" value="${esc(X.cats[c.id] || '')}"></div></div>`).join('')}</div></fieldset>${ctx.foot('保存する')}`;
    if (k === 'kb-shift') return shiftBody();
    if (k === 'kb-vlink') return vlinkBody();
    if (k === 'kb-event') return eventBody();
    if (k === 'kb-lendset') return lendsetBody();
    if (k === 'kb-rec') {
      const seg = (v, t) => `<button type="button" data-act="kb-rkind" data-v="${v}" aria-pressed="${X.kind === v}">${t}</button>`;
      return `<div><div class="seg">${seg('expense', '支出')}${seg('income', '収入')}</div></div>
        <div class="two"><div class="field"><label for="kr-title">名前</label><input id="kr-title" maxlength="40" data-bind="sheet.title" value="${esc(X.title)}" placeholder="${X.kind === 'income' ? '例：お小遣い' : '例：スマホ代'}"></div>
          <div class="field"><label for="kr-amount">金額</label><div class="yen"><span>¥</span><input id="kr-amount" inputmode="numeric" data-bind="sheet.amount" value="${esc(X.amount)}"></div></div></div>
        <fieldset><legend>くり返し</legend><div><div class="seg">${['month', 'year', 'week'].map((f) => `<button type="button" data-act="kb-rfreq" data-v="${f}" aria-pressed="${X.freq === f}">${{ month: '毎月', year: '毎年', week: '毎週' }[f]}</button>`).join('')}</div></div>
          ${X.freq === 'week' ? `<div class="filters">${[...WD].map((w, i) => `<button type="button" class="pillbtn" data-act="kb-rwday" data-v="${i}" aria-pressed="${+X.wday === i}">${w}</button>`).join('')}</div>`
            : `<div class="row">${X.freq === 'year' ? `<div class="field"><label for="kr-month">何月？</label><input id="kr-month" class="plain-input" inputmode="numeric" data-bind="sheet.month" value="${esc(X.month)}" style="max-width:5em"></div>` : ''}
              <div class="field"><label for="kr-day">何日？（31 で月末）</label><input id="kr-day" class="plain-input" inputmode="numeric" data-bind="sheet.day" value="${esc(X.day)}" style="max-width:5em"></div></div>`}
        </fieldset>
        <fieldset><legend>分類</legend>${chips(X.kind === 'income' ? s.incomeCats : s.expenseCats, 'kb-pick-cat', X.cat)}</fieldset>
        <fieldset><legend>${X.kind === 'income' ? 'どこに入る？' : 'どこから払う？'}</legend>${chips(s.accounts, 'kb-pick-acct', X.account)}</fieldset>
        ${X.kind === 'income' ? movesField(X).replace('そのうち、ほかの口座に移した？（PayPay など・なくてもOK）', '入ったら毎回、ほかの口座に移す？（PayPay など・なくてもOK）') : ''}
        <label class="check"><input type="checkbox" id="kr-active" data-bind="sheet.active" ${X.active ? 'checked' : ''}> 自動で入れる（外すとお休み）</label>
        <p class="hint">${X.id ? '' : X.freq === 'month' ? `${ymLabel(curYM())}から入ります（その日をすぎていれば、すぐに入ります）。` : '今日から入ります。'}</p>
        ${X.id ? delRow(X, 'この固定費を消しますか？（もう入った記録は残ります）') : ''}${ctx.foot('保存する')}`;
    }
    return '';
  }
  function afterDraw() {
    const X = ctx.U().sheet, el = document.getElementById('kb-calc');
    const pv = document.getElementById('sf-preview');
    if (X && pv && X.sheetKind === 'kb-shift') { const r = settings().recurring.find((y) => y.id === X.rec); if (r) pv.innerHTML = shiftPreview(X, r); }
    if (X && X.kind && el) el.textContent = hasOp(X.amount) ? `＝ ${yen(calc(X.amount))}` : '';
    if (X && X.sheetKind === 'kb-event' && el) el.textContent = hasOp(X.budget) ? `＝ ${yen(calc(X.budget))}` : '';
  }

  function submit(k, more) {
    const X = ctx.U().sheet, s = settings();
    if (k === 'kb-shift') return submitShift();
    if (k === 'kb-vlink') return submitVLink();
    if (k === 'kb-event') {
      const name = X.name.trim();
      if (!name) return ctx.sheetErr('予定の名前を入れてください');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(X.date)) return ctx.sheetErr('いつかを入れてください');
      if (X.end && X.end < X.date) return ctx.sheetErr('最後の日が、はじめの日より前です');
      const e = { id: X.id || 'e' + rid(), name, icon: X.icon.trim() || '🎟', date: X.date, end: X.end && X.end !== X.date ? X.end : '', budget: calc(X.budget), memo: X.memo.trim() };
      saveSettings({ ...s, events: X.id ? s.events.map((x) => (x.id === X.id ? e : x)) : [...s.events, e] }, '✓ 予定を保存しました');
      return ctx.closeSheet();
    }
    if (k === 'kb-lendset') { const L = settings().lend; saveSettings({ ...s, lend: { ...L, on: !!X.on, account: X.account, cat: X.cat, since: X.since || '' } }, '✓ 保存しました'); return ctx.closeSheet(); }
    if (k === 'kb-tx') {
      const amount = calc(X.amount);
      if (amount <= 0) return ctx.sheetErr('金額を入れてください');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(X.date)) return ctx.sheetErr('日付を入れてください');
      if (X.kind === 'transfer' && X.account === X.toAccount) return ctx.sheetErr('「どこから」と「どこへ」がおなじです');
      const body = { kind: X.kind, date: X.date, amount, account: X.account, title: X.title.trim(), memo: X.memo.trim(), createdAt: X.createdAt || 0 };
      if (X.kind === 'transfer') body.toAccount = X.toAccount; else body.cat = X.cat;
      if (X.rec) { body.rec = X.rec; if (X.base) { body.base = X.base; body.shifted = X.shifted; } }
      if (X.shift) body.shift = X.shift;
      if (X.from && X.kind === 'transfer') body.from = X.from;
      if (X.kind === 'expense' && X.event) body.event = X.event;
      const label = X.id ? '✓ 直しました' : `✓ ${X.kind === 'income' ? '収入' : X.kind === 'transfer' ? '振替' : '支出'} ${yen(amount)} を入れました`;
      if (!X.id && X.kind === 'income' && (X.moves || []).length) {
        const id = KStore.newKbId('tx'), mv = moveTx(X, amount, id, X.date, X.title.trim() || catOf('income', X.cat).name);
        if (mv.err) return ctx.sheetErr(mv.err);
        run(KStore.kbBatch([{ op: 'set', col: 'tx', id, body }, ...mv.ops]), mv.ops.length ? `${label}（${mv.ops.length}か所に移した）` : label);
      } else run(KStore.saveTx(X.id, body), label);
      KB.month = X.date.slice(0, 7);
      if (more) { X.amount = ''; X.title = ''; X.memo = ''; X.err = ''; X.moves = []; ctx.drawSheet(); setTimeout(() => { const i = document.getElementById('kb-amount'); if (i) i.focus(); }, 30); }
      else ctx.closeSheet();
      return;
    }
    if (k === 'kb-adjust') {
      if (String(X.actual).trim() === '') return ctx.sheetErr('ほんとうの残高を入れてください');
      const a = acctOf(X.account), diff = calc(X.actual) - balance(a);
      if (!diff) { toast('もう合っています ✦'); ctx.closeSheet(); return; }
      run(KStore.saveTx(null, { kind: 'adjust', date: X.date, amount: Math.abs(diff), dir: diff < 0 ? 'minus' : 'plus', account: X.account, title: '残高を合わせた' }), `✓ ${a.name} の残高を合わせました`);
      ctx.closeSheet(); return;
    }
    if (k === 'kb-acct') {
      const name = X.name.trim(); if (!name) return ctx.sheetErr('名前を入れてください');
      const a = { id: X.id || 'a' + rid(), name, icon: X.icon.trim() || '👛', initial: calc(X.initial) };
      const accounts = X.id ? s.accounts.map((x) => (x.id === X.id ? a : x)) : [...s.accounts, a];
      saveSettings({ ...s, accounts }, '✓ 口座を保存しました'); ctx.closeSheet(); return;
    }
    if (k === 'kb-cat') {
      const name = X.name.trim(); if (!name) return ctx.sheetErr('名前を入れてください');
      const key = X.kind === 'income' ? 'incomeCats' : 'expenseCats';
      const c = { id: X.id || 'c' + rid(), name, icon: X.icon.trim() || '🏷' };
      saveSettings({ ...s, [key]: X.id ? s[key].map((x) => (x.id === X.id ? c : x)) : [...s[key], c] }, '✓ 分類を保存しました'); ctx.closeSheet(); return;
    }
    if (k === 'kb-budget') {
      const cats = {}; Object.entries(X.cats).forEach(([id, v]) => { const n = calc(v); if (n) cats[id] = n; });
      saveSettings({ ...s, budget: { total: calc(X.total), cats } }, '✓ 予算を保存しました'); ctx.closeSheet(); return;
    }
    if (k === 'kb-rec') {
      const amount = calc(X.amount), day = Math.min(31, Math.max(1, parseInt(String(X.day).replace(/\D/g, ''), 10) || 0));
      const month = Math.min(12, Math.max(1, parseInt(String(X.month).replace(/\D/g, ''), 10) || 0));
      if (amount <= 0) return ctx.sheetErr('金額を入れてください');
      if (X.freq !== 'week' && !day) return ctx.sheetErr('何日かを入れてください（1〜31）');
      if (X.freq === 'year' && !month) return ctx.sheetErr('何月かを入れてください（1〜12）');
      const prev = s.recurring.find((r) => r.id === X.id);
      const r = { id: X.id || 'r' + rid(), kind: X.kind, title: X.title.trim(), amount, freq: X.freq, day: day || 1, month: month || 1, wday: +X.wday || 0, cat: X.cat, account: X.account, active: !!X.active,
        start: prev ? prev.start : curYM(), startDate: prev ? prev.startDate || '' : today(), skip: prev ? prev.skip || [] : [],
        moves: X.kind === 'income' ? (X.moves || []).filter((mv) => mv.account && mv.account !== X.account && calc(mv.amount) > 0).map((mv) => ({ account: mv.account, amount: calc(mv.amount) })) : [] };
      if (r.moves.reduce((a, mv) => a + mv.amount, 0) > amount) return ctx.sheetErr('移す額が、収入より多いです');
      saveSettings({ ...s, recurring: X.id ? s.recurring.map((x) => (x.id === X.id ? r : x)) : [...s.recurring, r] }, '✓ 固定費を保存しました');
      ctx.closeSheet(); setTimeout(fillRecurring, 300); return;
    }
  }

  function doDelete() {
    const X = ctx.U().sheet, s = settings();
    const sk = X.sheetKind;
    if (sk === 'kb-tx' || sk === 'kb-adjust') {
      const t = txs().find((x) => x.id === X.id);
      if (t && t.shift) { deleteShiftOf(t); ctx.closeSheet(); return; }
      const linked = t ? txs().filter((x) => x.from === t.id) : [];
      if (linked.length) {
        if (t.rec) { const [, rId, m] = /^rec_(.+)_(\d{4}(?:-\d{2}(?:-\d{2})?)?)$/.exec(t.id) || []; if (rId) saveSettings({ ...s, recurring: s.recurring.map((r) => (r.id === rId ? { ...r, skip: [...new Set([...(r.skip || []), m])] } : r)) }); }
        run(KStore.kbBatch([{ op: 'delete', col: 'tx', id: t.id }, ...linked.map((x) => ({ op: 'delete', col: 'tx', id: x.id }))]), `記録を消しました（移した記録 ${linked.length}件も）`);
        ctx.closeSheet(); return;
      }
      if (t && t.rec) {
        const [, rId, m] = /^rec_(.+)_(\d{4}(?:-\d{2}(?:-\d{2})?)?)$/.exec(t.id) || [];
        if (rId) saveSettings({ ...s, recurring: s.recurring.map((r) => (r.id === rId ? { ...r, skip: [...new Set([...(r.skip || []), m])] } : r)) });
      }
      run(KStore.deleteTx(X.id), '記録を消しました');
    } else if (sk === 'kb-acct') saveSettings({ ...s, accounts: s.accounts.filter((a) => a.id !== X.id) }, '口座を消しました');
    else if (sk === 'kb-cat') { const key = X.kind === 'income' ? 'incomeCats' : 'expenseCats'; saveSettings({ ...s, [key]: s[key].filter((c) => c.id !== X.id) }, '分類を消しました'); }
    else if (sk === 'kb-rec') saveSettings({ ...s, recurring: s.recurring.filter((r) => r.id !== X.id) }, '固定費を消しました');
    else if (sk === 'kb-shift') { const x = shifts().find((y) => y.id === X.id); if (x) deleteShift(x); }
    else if (sk === 'kb-event') saveSettings({ ...s, events: s.events.filter((e) => e.id !== X.id) }, '予定を消しました');
    ctx.closeSheet();
  }

  // ---------- 押したとき ----------
  function click(a, d) {
    const X = ctx.U().sheet, s = settings();
    switch (a) {
      case 'kb-sub': KB.sub = d.v; KB.acct = ''; window.scrollTo(0, 0); return 'render';
      case 'kb-month': KB.month = d.v === '0' ? curYM() : addMonth(KB.month, +d.v); KB.cat = ''; return 'render';
      case 'kb-year': KB.year = String(+KB.year + +d.v); return 'render';
      case 'kb-goto': KB.month = d.v; KB.sub = 'month'; KB.cat = ''; KB.search = ''; window.scrollTo(0, 0); return 'render';
      case 'kb-cat-filter': KB.cat = KB.cat === d.v ? '' : d.v; return 'render';
      case 'kb-new': openTx(d.v, null); return 'done';
      case 'kb-edit': if (String(d.id).startsWith('v:')) openVLink(d.id.slice(2)); else openTx(null, d.id); return 'done';
      case 'kb-kind': if (X) { X.kind = d.v; X.cat = d.v === 'income' ? s.incomeCats[0].id : s.expenseCats[0].id; ctx.drawSheet(); } return 'done';
      case 'kb-rkind': if (X) { X.kind = d.v; X.cat = d.v === 'income' ? s.incomeCats[0].id : s.expenseCats[0].id; ctx.drawSheet(); } return 'done';
      case 'kb-rfreq': if (X) { X.freq = d.v; ctx.drawSheet(); } return 'done';
      case 'kb-rwday': if (X) { X.wday = d.v; ctx.drawSheet(); } return 'done';
      case 'kb-shift-new': openShift(d.id, null); return 'done';
      case 'kb-vas': if (X) { X.as = d.v; ctx.drawSheet(); } return 'done';
      case 'kb-pick-event': if (X) { X.event = X.event === d.v ? '' : d.v; ctx.drawSheet(); } return 'done';
      case 'kb-ev-open': KB.evOpen = KB.evOpen === d.id ? '' : d.id; return 'render';
      case 'kb-ev-all': KB.evAll = true; return 'render';
      case 'kb-ev-add': { const e = s.events.find((x) => x.id === d.id); KB.evFor = d.id; openTx('expense', null); KB.evFor = ''; const X2 = ctx.U().sheet; if (X2 && e && e.date > today()) { X2.date = today(); } return 'done'; }
      case 'kb-ev-edit': { const e = s.events.find((x) => x.id === d.id); ctx.openSheet('kb-event', e ? { id: e.id, name: e.name, icon: e.icon || '🎟', date: e.date, end: e.end || '', budget: e.budget ? String(e.budget) : '', memo: e.memo || '', del: false }
          : { id: null, name: '', icon: '🎟', date: addDays(today(), 7), end: '', budget: '', memo: '', del: false }); return 'done'; }
      case 'kb-mv-add': if (X) { X.moves = [...(X.moves || []), { account: (s.accounts.find((a) => a.id !== X.account) || {}).id || '', amount: '' }]; ctx.drawSheet(); setTimeout(() => { const i = document.getElementById('kb-mv-' + (X.moves.length - 1)); if (i) i.focus(); }, 30); } return 'done';
      case 'kb-mv-del': if (X) { X.moves = X.moves.filter((_, i) => i !== +d.i); ctx.drawSheet(); } return 'done';
      case 'kb-mv-acct': if (X) { X.moves[+d.i].account = d.v; ctx.drawSheet(); } return 'done';
      case 'kb-vcat': if (X) { X.cat = d.v; ctx.drawSheet(); } return 'done';
      case 'kb-vacct': if (X) { X.account = d.v; ctx.drawSheet(); } return 'done';
      case 'kb-lacct': if (X) { X.account = d.v; ctx.drawSheet(); } return 'done';
      case 'kb-lcat': if (X) { X.cat = d.v; ctx.drawSheet(); } return 'done';
      case 'kb-lendset': { const L = s.lend; ctx.openSheet('kb-lendset', { on: L.on, account: L.account, cat: L.cat, since: L.since }); return 'done'; }
      case 'kb-voff-list': KB.showOff = !KB.showOff; return 'render';
      case 'kb-shift-edit': { const x = shifts().find((y) => y.id === d.id); if (x) openShift(x.rec, x); return 'done'; }
      case 'kb-shift-period': if (X) { X.period = d.v; const r = s.recurring.find((y) => y.id === X.rec); if (r) X.amount = String(Math.max(0, r.amount - shiftSum(r.id, d.v))); ctx.drawSheet(); } return 'done';
      case 'kb-shift-acct': if (X) { X.account = d.v; ctx.drawSheet(); } return 'done';
      case 'kb-pick-cat': if (X) { X.cat = d.v; ctx.drawSheet(); } return 'done';
      case 'kb-pick-acct': if (X) { X.account = d.v; ctx.drawSheet(); } return 'done';
      case 'kb-pick-to': if (X) { X.toAccount = d.v; ctx.drawSheet(); } return 'done';
      case 'kb-save-more': submit('kb-tx', true); return 'done';
      case 'kb-del': if (X) { X.del = true; ctx.drawSheet(); } return 'done';
      case 'kb-del-no': if (X) { X.del = false; ctx.drawSheet(); } return 'done';
      case 'kb-del-yes': doDelete(); return 'done';
      case 'kb-passbook': KB.acct = d.id; window.scrollTo(0, 0); return 'render';
      case 'kb-adjust': openAdjust(d.id, null); return 'done';
      case 'kb-acct-new': ctx.openSheet('kb-acct', { id: null, name: '', icon: '👛', initial: '', used: false, del: false }); return 'done';
      case 'kb-acct-edit': { const x = s.accounts.find((y) => y.id === d.id); if (x) ctx.openSheet('kb-acct', { id: x.id, name: x.name, icon: x.icon, initial: String(x.initial || 0), used: txs().some((t) => t.account === x.id || t.toAccount === x.id) || s.recurring.some((r) => r.account === x.id), del: false }); return 'done'; }
      case 'kb-cat-edit': { const list = d.kind === 'income' ? s.incomeCats : s.expenseCats, c = list.find((x) => x.id === d.id); ctx.openSheet('kb-cat', { id: c ? c.id : null, kind: d.kind, name: c ? c.name : '', icon: c ? c.icon : '🏷', del: false }); return 'done'; }
      case 'kb-budget': { const cats = {}; Object.entries(s.budget.cats).forEach(([k, v]) => { cats[k] = String(v); }); ctx.openSheet('kb-budget', { total: s.budget.total ? String(s.budget.total) : '', cats }); return 'done'; }
      case 'kb-rec-edit': {
        const r = s.recurring.find((x) => x.id === d.id);
        ctx.openSheet('kb-rec', r ? { id: r.id, kind: r.kind, title: r.title, amount: String(r.amount), freq: freqOf(r), day: String(r.day || 1), month: String(r.month || 1), wday: String(r.wday || 0), cat: r.cat, account: r.account, active: r.active !== false, del: false,
            moves: (r.moves || []).map((mv) => ({ account: mv.account, amount: String(mv.amount) })) }
          : { id: null, moves: [], kind: 'expense', title: '', amount: '', freq: 'month', day: '1', month: String(new Date().getMonth() + 1), wday: String(new Date().getDay()), cat: s.expenseCats[0].id, account: s.accounts[0].id, active: true, del: false });
        return 'done';
      }
      case 'kb-csv': exportCsv(d.v); return 'done';
      default: return '';
    }
  }

  // ---------- 固定費を自動で入れる ----------
  const asked = new Set();
  function fillRecurring() {
    const S = ctx.S();
    if (!S.user || !S.txReady || !S.kbReady || !S.shiftsReady) return;
    const s = settings(), have = new Set(txs().map((t) => t.id)), now = today(), list = [];
    s.recurring.forEach((r) => {
      if (r.active === false || !r.amount) return;
      // さかのぼるのは、毎月は3年・毎年は5年・毎週は1年まで
      const back = freqOf(r) === 'week' ? addDays(now, -366) : freqOf(r) === 'year' ? `${+now.slice(0, 4) - 5}-01-01` : `${addMonth(now.slice(0, 7), -36)}-01`;
      occurrences(r, back, now, 400).forEach(({ period, date }) => {
        const id = recTxId(r, period);
        if (have.has(id) || asked.has(id) || (r.skip || []).includes(period)) return;
        asked.add(id);
        const sh = shiftSum(r.id, period);
        const body = { kind: r.kind, date, amount: Math.max(0, r.amount - sh), base: r.amount, shifted: sh, cat: r.cat, account: r.account, title: r.title, memo: '', rec: r.id };
        list.push({ id, body });
        // 入ったら毎回移す（収入より多くは移さない）
        let left = body.amount;
        (r.kind === 'income' ? r.moves || [] : []).forEach((mv, i) => {
          const a = Math.min(mv.amount, left);
          if (a <= 0 || mv.account === r.account) return;
          left -= a;
          list.push({ id: `${id}_mv${i}`, body: { kind: 'transfer', date, amount: a, account: r.account, toAccount: mv.account, title: `${recName(r)}から移した`, memo: '', from: id } });
        });
      });
    });
    if (!list.length) return;
    run(KStore.putTxMany(list), `🔁 固定費を ${list.length}件 入れました`);
  }

  // ---------- 貸し借りを家計簿に（1件ずつの直し・設定）----------
  function openVLink(key) {
    const L = settings().lend, k = L.links[key] || {};
    // 入れないにしたものも直せるように、一度 off を外した形でさがす
    const v = vtx().find((x) => x.key === key) || vtxRaw(key);
    if (!v) return;
    ctx.openSheet('kb-vlink', { key, account: k.account || L.account, off: !!k.off, as: k.as || v.defAs || '', cat: k.cat || v.cat || L.cat, canAs: !!v.canAs, defAs: v.defAs || '', title: v.title, sub: v.sub, date: v.date, amount: v.amount, kind: v.kind });
  }
  // 入れないにしたものの中身（設定の一覧から開くとき）
  function vtxRaw(key) {
    const S = ctx.S(), s = settings(), L = { ...s.lend, links: { ...s.lend.links, [key]: { ...(s.lend.links[key] || {}), off: false, as: (s.lend.links[key] || {}).as === 'off' ? '' : (s.lend.links[key] || {}).as } } };
    const keep = S.kb; S.kb = { ...(S.kb || {}), lend: L }; vCache = { key: null, list: [] };
    const v = vtx().find((x) => x.key === key);
    S.kb = keep; vCache = { key: null, list: [] };
    return v;
  }
  function eventBody() {
    const X = ctx.U().sheet;
    return `<div class="two">
        <div class="field"><label for="ke-name">予定の名前</label><input id="ke-name" maxlength="30" data-bind="sheet.name" value="${esc(X.name)}" placeholder="例：遊園地・旅行"></div>
        <div class="field"><label for="ke-icon">しるし（絵文字1つ）</label><input id="ke-icon" maxlength="4" data-bind="sheet.icon" value="${esc(X.icon)}"></div></div>
      <div class="two">
        <div class="field"><label for="ke-date">いつ</label><input id="ke-date" type="date" data-bind="sheet.date" value="${esc(X.date)}"></div>
        <div class="field"><label for="ke-end">何日か続くなら、最後の日（なくてもOK）</label><input id="ke-end" type="date" data-bind="sheet.end" value="${esc(X.end)}"></div></div>
      <div class="field"><label for="ke-budget">予算（いくらくらいかかる？）</label><div class="yen"><span>¥</span><input id="ke-budget" inputmode="text" data-bind="sheet.budget" value="${esc(X.budget)}" placeholder="例：入場券4000+ごはん2000"></div><span class="hint" id="kb-calc"></span></div>
      <div class="field"><label for="ke-memo">メモ（なくてもOK）</label><input id="ke-memo" maxlength="200" data-bind="sheet.memo" value="${esc(X.memo)}" placeholder="例：電車代もふくむ"></div>
      ${X.id ? delRow(X, 'この予定を消しますか？（記録は残ります）') : ''}${ctx.foot('保存する')}`;
  }
  function vlinkBody() {
    const X = ctx.U().sheet, s = settings();
    const seg = (v, t) => `<button type="button" data-act="kb-vas" data-v="${v}" aria-pressed="${X.as === v}">${t}</button>`;
    const asExp = X.canAs ? X.as === 'expense' : X.kind === 'expense';
    return `<p class="hint">🤝 ${esc(X.title)}<br>${esc(X.sub)}・${esc(md(X.date))}・<b class="num">${yen(X.amount)}</b></p>
      <p class="hint">貸し借りの記録から、家計簿に自動で入っています。金額や日付は、貸し借りの記録の方で直してください。</p>
      ${X.canAs ? `<fieldset><legend>このお金は？</legend><div><div class="seg">${seg('cash', '現金で借りた')}${seg('expense', '立て替えてもらった')}${seg('off', '入れない')}</div></div>
        <p class="hint">「立て替えてもらった」は、自分の分の買い物（支出）として入れます。肩代わりしてもらった分は、お金が動いていないので「入れない」がはじめです。</p></fieldset>` : ''}
      ${asExp ? `<fieldset><legend>分類</legend><div class="filters">${s.expenseCats.map((c) => `<button type="button" class="pillbtn" data-act="kb-vcat" data-v="${esc(c.id)}" aria-pressed="${X.cat === c.id}">${esc(c.icon)} ${esc(c.name)}</button>`).join('')}</div></fieldset>` : ''}
      ${X.as !== 'off' ? `<fieldset><legend>${X.kind === 'lendin' && !asExp ? 'どこに入った？' : 'どこから出た？'}</legend><div class="filters">${s.accounts.map((a) => `<button type="button" class="pillbtn" data-act="kb-vacct" data-v="${esc(a.id)}" aria-pressed="${X.account === a.id}">${esc(a.icon)} ${esc(a.name)}</button>`).join('')}</div></fieldset>` : ''}
      <label class="check"><input type="checkbox" id="kv-off" data-bind="sheet.off" ${X.off ? 'checked' : ''}> この記録は家計簿に入れない</label>
      ${ctx.foot('保存する')}`;
  }
  function submitVLink() {
    const X = ctx.U().sheet, s = settings();
    const link = { account: X.account };
    if (X.off) link.off = true;
    if (X.canAs && X.as && X.as !== X.defAs) link.as = X.as;
    if (X.cat) link.cat = X.cat;
    saveSettings({ ...s, lend: { ...s.lend, links: { ...s.lend.links, [X.key]: link } } }, X.off ? '家計簿に入れないようにしました' : '✓ 保存しました');
    ctx.closeSheet();
  }
  function lendsetBody() {
    const X = ctx.U().sheet, s = settings();
    return `<label class="check"><input type="checkbox" id="kl-on" data-bind="sheet.on" ${X.on ? 'checked' : ''}> 貸し借り（みんなの帳簿・自分だけの貸し借り）を家計簿に入れる</label>
      <p class="hint">貸した・返したお金は口座から出ていき、借りた・返ってきたお金は口座に入ります。収入・支出には数えません。割り勘で自分の分も払ったときは、自分の分を支出として入れます。</p>
      <fieldset><legend>いつもの口座</legend><div class="filters">${s.accounts.map((a) => `<button type="button" class="pillbtn" data-act="kb-lacct" data-v="${esc(a.id)}" aria-pressed="${X.account === a.id}">${esc(a.icon)} ${esc(a.name)}</button>`).join('')}</div></fieldset>
      <fieldset><legend>割り勘の自分の分・立て替えてもらった分の分類</legend><div class="filters">${s.expenseCats.map((c) => `<button type="button" class="pillbtn" data-act="kb-lcat" data-v="${esc(c.id)}" aria-pressed="${X.cat === c.id}">${esc(c.icon)} ${esc(c.name)}</button>`).join('')}</div></fieldset>
      <div class="field"><label for="kl-since">この日からの貸し借りを入れる（空ならぜんぶ）</label><input id="kl-since" type="date" class="plain-input due-input" data-bind="sheet.since" value="${esc(X.since)}"></div>
      <p class="hint">前に自分で家計簿に入れていた分と重ならないように、入れはじめる日を決められます。</p>
      ${ctx.foot('保存する')}`;
  }

  // ---------- 前借り・後払い ----------
  // 選べる「何の分」：前借りはこれから入る分、後払いは近ごろ・もうすぐの分
  function shiftPeriods(r, kind) {
    const now = today(), f = freqOf(r);
    if (kind === 'advance') {
      const to = f === 'week' ? addDays(now, 70) : f === 'year' ? `${+now.slice(0, 4) + 3}-12-31` : `${addMonth(now.slice(0, 7), 12)}-28`;
      return occurrences(r, now, to, 60).filter((o) => !txs().some((t) => t.id === recTxId(r, o.period))).slice(0, f === 'year' ? 3 : f === 'week' ? 10 : 12);
    }
    const from = f === 'week' ? addDays(now, -42) : f === 'year' ? `${+now.slice(0, 4) - 1}-01-01` : `${addMonth(now.slice(0, 7), -3)}-01`;
    const to = f === 'week' ? addDays(now, 14) : f === 'year' ? `${+now.slice(0, 4)}-12-31` : `${addMonth(now.slice(0, 7), 1)}-28`;
    // もう来た分（新しい順）を先に、そのあとにこれから来る分
    const all = occurrences(r, from, to, 60);
    return all.filter((o) => o.date <= now).reverse().concat(all.filter((o) => o.date > now));
  }
  function openShift(recId, x) {
    const r = settings().recurring.find((y) => y.id === recId);
    if (!r) return;
    if (x) { ctx.openSheet('kb-shift', { id: x.id, rec: r.id, kind: x.kind, period: x.period, amount: String(x.amount), date: x.date, account: x.account || r.account, memo: x.memo, paid: x.paid, payDate: today(), del: false }); return; }
    const kind = r.kind === 'income' ? 'advance' : 'defer', ps = shiftPeriods(r, kind), p = ps[0];
    ctx.openSheet('kb-shift', { id: null, rec: r.id, kind, period: p ? p.period : '', amount: p ? String(Math.max(0, r.amount - shiftSum(r.id, p.period))) : '', date: kind === 'advance' ? today() : '', account: r.account, memo: '', del: false });
  }
  function shiftBody() {
    const X = ctx.U().sheet, s = settings(), r = s.recurring.find((y) => y.id === X.rec);
    if (!r) return '<p class="hint">その固定費はもうありません。</p>';
    const adv = X.kind === 'advance', lbl = periodLabel(X.period);
    if (X.id) {
      const x = shifts().find((y) => y.id === X.id) || {};
      const left = Math.max(0, r.amount - shiftSum(r.id, X.period));
      return `<p class="hint">${esc(recName(r))}（${esc(freqLabel(r))}・${yen(r.amount)}）の <b>${esc(lbl)}</b> を ${yen(+X.amount)} ${adv ? '前借りしました' : '後払いにしました'}。${esc(lbl)}は ${yen(left)} になります。</p>
        ${X.memo ? `<p class="memo">${esc(X.memo)}</p>` : ''}
        ${!adv && !x.paid ? `<div class="notice quiet"><h3>🕒 まだ払っていません${X.date ? `（払う予定 ${esc(md(X.date))}）` : ''}</h3>
          <div class="two"><div class="field"><label for="sf-paydate">払った日</label><input id="sf-paydate" type="date" data-bind="sheet.payDate" value="${esc(X.payDate)}"></div></div>
          <fieldset><legend>どこから払った？</legend>${chips(s.accounts, 'kb-shift-acct', X.account)}</fieldset>
          <div class="row end"><button type="submit" class="btn primary">払ったことにする（支出に入れる）</button></div></div>`
          : !adv ? `<p class="hint">✓ ${esc(md(x.paidDate || ''))}に払いました。</p>` : ''}
        ${delRow(X, adv ? 'この前借りを取り消しますか？（前借りで入った収入も消えます）' : 'この後払いを取り消しますか？（払った記録も消えます）')}
        <div class="row end"><button type="button" class="btn" data-act="sheet-close">とじる</button></div>`;
    }
    const ps = shiftPeriods(r, X.kind);
    const chipsP = ps.length ? `<div class="filters">${ps.map((o) => { const done = shiftSum(r.id, o.period); return `<button type="button" class="pillbtn" data-act="kb-shift-period" data-v="${esc(o.period)}" aria-pressed="${X.period === o.period}">${esc(periodLabel(o.period))}${done ? `（${adv ? '前借り' : '後払い'}済み ${yen(done)}）` : ''}</button>`; }).join('')}</div>`
      : `<p class="hint">${adv ? 'これから入る分がありません。' : '近ごろの分がありません。'}</p>`;
    return `<p class="hint">${esc(recName(r))}：${esc(freqLabel(r))}・${yen(r.amount)}</p>
      <fieldset><legend>${adv ? '何の分を前借りする？' : '何の分を後払いにする？'}</legend>${chipsP}</fieldset>
      ${X.period ? `<div class="two">
        <div class="field"><label for="sf-amount">${adv ? '前借りする金額' : '後払いにする金額'}</label><div class="yen"><span>¥</span><input id="sf-amount" inputmode="numeric" data-bind="sheet.amount" value="${esc(X.amount)}"></div></div>
        <div class="field"><label for="sf-date">${adv ? '前借りした日' : '払う予定の日（なくてもOK）'}</label><input id="sf-date" type="date" data-bind="sheet.date" value="${esc(X.date)}"></div></div>
        ${adv ? `<fieldset><legend>どこに入った？</legend>${chips(s.accounts, 'kb-shift-acct', X.account)}</fieldset>` : ''}
        <div class="field"><label for="sf-memo">メモ（なくてもOK）</label><input id="sf-memo" maxlength="200" data-bind="sheet.memo" value="${esc(X.memo)}"></div>
        <div class="preview" id="sf-preview">${shiftPreview(X, r)}</div>
        ${ctx.foot(adv ? '前借りする' : '後払いにする')}` : `<div class="row end"><button type="button" class="btn" data-act="sheet-close">やめる</button></div>`}`;
  }
  function shiftPreview(X, r) {
    const adv = X.kind === 'advance', lbl = periodLabel(X.period), amt = calc(X.amount), left = Math.max(0, r.amount - shiftSum(r.id, X.period) - amt);
    return `${adv ? `いま ${yen(amt)} を収入に入れて、` : `${esc(lbl)}の支払いから ${yen(amt)} を外して「まだ払っていない」に入れ、`}${esc(lbl)}は <span class="num">${yen(left)}</span> になります。`;
  }
  function submitShift() {
    const X = ctx.U().sheet, s = settings(), r = s.recurring.find((y) => y.id === X.rec);
    if (!r) return ctx.closeSheet();
    const adv = X.kind === 'advance', lbl = periodLabel(X.period), c = catOf(r.kind, r.cat);
    if (X.id) {
      // 後払いを払った
      const x = shifts().find((y) => y.id === X.id);
      if (!x || adv || x.paid) return ctx.closeSheet();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(X.payDate)) return ctx.sheetErr('払った日を入れてください');
      const txId = KStore.newKbId('tx'), body = { ...x }; delete body.id;
      run(KStore.kbBatch([
        { op: 'set', col: 'tx', id: txId, body: { kind: 'expense', date: X.payDate, amount: x.amount, cat: r.cat, account: X.account, title: `${recName(r)} ${lbl} 後払い`, memo: x.memo, shift: x.id } },
        { op: 'set', col: 'shifts', id: x.id, body: { ...body, paid: true, paidDate: X.payDate, txId, account: X.account } },
      ]), `✓ ${recName(r)}（${lbl}）の後払い ${yen(x.amount)} を払いました`);
      KB.month = X.payDate.slice(0, 7);
      return ctx.closeSheet();
    }
    const amount = calc(X.amount);
    if (!X.period) return ctx.sheetErr(adv ? '何の分を前借りするかをえらんでください' : '何の分を後払いにするかをえらんでください');
    if (amount <= 0) return ctx.sheetErr('金額を入れてください');
    const room = r.amount - shiftSum(r.id, X.period);
    if (amount > room) return ctx.sheetErr(`${lbl}は、あと ${yen(Math.max(0, room))} までです`);
    if (adv && !/^\d{4}-\d{2}-\d{2}$/.test(X.date)) return ctx.sheetErr('前借りした日を入れてください');
    if (X.date && !/^\d{4}-\d{2}-\d{2}$/.test(X.date)) return ctx.sheetErr('日付を入れてください');
    const id = KStore.newKbId('shifts'), ops = [];
    const sh = { kind: X.kind, rec: r.id, period: X.period, amount, date: X.date || '', account: X.account, memo: (X.memo || '').trim(), paid: false, txId: '' };
    if (adv) {
      sh.txId = KStore.newKbId('tx');
      ops.push({ op: 'set', col: 'tx', id: sh.txId, body: { kind: 'income', date: X.date, amount, cat: r.cat, account: X.account, title: `${recName(r)} ${lbl} 前借り`, memo: sh.memo, shift: id } });
    }
    ops.push({ op: 'set', col: 'shifts', id, body: sh });
    ops.push(...recTxOps(r, X.period, shiftSum(r.id, X.period) + amount));
    run(KStore.kbBatch(ops), adv ? `✓ ${recName(r)}（${lbl}）から ${yen(amount)} 前借りしました` : `✓ ${recName(r)}（${lbl}）の ${yen(amount)} を後払いにしました`);
    if (adv) KB.month = X.date.slice(0, 7);
    ctx.closeSheet();
  }
  // 取り消す：前借り・後払いと、それで入った記録を消し、その分の額を元にもどす
  function deleteShift(x) {
    const r = settings().recurring.find((y) => y.id === x.rec);
    const ops = [{ op: 'delete', col: 'shifts', id: x.id }];
    if (x.txId && txs().some((t) => t.id === x.txId)) ops.push({ op: 'delete', col: 'tx', id: x.txId });
    if (r) ops.push(...recTxOps(r, x.period, shiftSum(r.id, x.period, x.id)));
    run(KStore.kbBatch(ops), x.kind === 'advance' ? '前借りを取り消しました' : '後払いを取り消しました');
  }
  // 家計簿の記録の方から消したとき：前借りなら前借りごと取り消し、後払いを払った記録なら「まだ払っていない」にもどす
  function deleteShiftOf(t) {
    const x = shifts().find((y) => y.id === t.shift);
    if (!x) { run(KStore.deleteTx(t.id), '記録を消しました'); return; }
    if (x.kind === 'advance') { deleteShift(x); return; }
    const body = { ...x, paid: false, paidDate: '', txId: '' }; delete body.id;
    run(KStore.kbBatch([{ op: 'delete', col: 'tx', id: t.id }, { op: 'set', col: 'shifts', id: x.id, body }]), '払った記録を消しました（まだ払っていない、にもどしました）');
  }
  // ウィジェットの期限：まだ払っていない後払いで、払う予定の日があるもの
  function dueItems() {
    const s = settings();
    return unpaidDefers().filter((x) => x.date).map((x) => {
      const r = s.recurring.find((y) => y.id === x.rec);
      return { d: 'out', who: `${recName(r)}（${periodLabel(x.period)}）`, amt: x.amount, due: x.date, days: KL.daysLeft(x.date), title: '後払い' };
    });
  }

  // ---------- 書き出し ----------
  function exportCsv(which) {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    let rows, name;
    if (which === 'lend') {
      rows = [['日付', '貸した・借りた', '相手', '内容', '金額', '返済済み', '残り', 'メモ']];
      ctx.S().personal.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach((e) => { const st = KL.entryStat(e); rows.push([e.date, e.dir === 'lent' ? '貸した' : '借りた', e.who, e.title, e.amount, st.paid, st.rest, e.memo]); });
      name = `kashikari_${today()}.csv`;
    } else {
      const kinds = { expense: '支出', income: '収入', transfer: '振替', adjust: '残高合わせ', lendout: '貸し借り（出た）', lendin: '貸し借り（入った）' };
      rows = [['日付', '種類', '分類', '口座', '移し先', '金額', '内容', 'メモ']];
      all().slice().sort((a, b) => a.date.localeCompare(b.date)).forEach((t) => rows.push([
        t.date, kinds[t.kind], t.kind === 'income' || t.kind === 'expense' ? catOf(t.kind, t.cat).name : '', acctOf(t.account).name,
        t.kind === 'transfer' ? acctOf(t.toAccount).name : '', (t.kind === 'adjust' && t.dir === 'minus') || t.kind === 'lendout' ? -t.amount : t.amount, t.title, t.virt ? t.sub : t.memo]));
      name = `kakeibo_${today()}.csv`;
    }
    const text = '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n');
    if (window.KashikariApp && window.KashikariApp.saveFile) {
      try {
        const bytes = new TextEncoder().encode(text); let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        if (window.KashikariApp.saveFile(name, 'text/csv', btoa(bin))) return;
      } catch (e) {}
      toast('保存できませんでした', true); return;
    }
    if (window.KashikariApp) { toast('アプリを新しくすると書き出せます（ブラウザで開いても書き出せます）', true); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast(`✓ ${name} を書き出しました`);
  }

  // ウィジェット用：今月の支出・収入・予算
  function widget() {
    const S = ctx.S();
    if (!S.txReady) return null;
    const m = curYM(), x = monthSum(m), b = settings().budget.total;
    if (!x.exp && !x.inc && !b) return null;
    return { m: +m.slice(5, 7), exp: x.exp, inc: x.inc, budget: b };
  }

  return { view, sheetBody, title, submit, click, afterDraw, fillRecurring, widget, dueItems, state: KB, has: (k) => k.startsWith('kb-') };
};
