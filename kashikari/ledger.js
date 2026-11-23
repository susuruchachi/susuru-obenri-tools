// --- 計算（残り・差し引き）：画面（app.js）とウィジェット（app-bridge.js）で同じものを使う ---
const KL = (() => {
  const shareStat = (s) => {
    const paid = (s.repayments || []).reduce((a, r) => a + (r.amount || 0), 0);
    return { paid, rest: Math.max(0, (s.amount || 0) - paid) };
  };
  const loanTotal = (l) => l.shares.reduce((a, s) => a + s.amount, 0);
  const loanRest = (l) => l.shares.reduce((a, s) => a + shareStat(s).rest, 0);

  // owed[a][b] = b が a にまだ返していない額
  function owedMatrix(loans) {
    const m = {};
    (loans || []).forEach((l) => l.shares.forEach((s) => {
      if (s.to === l.lender) return;
      const r = shareStat(s).rest;
      if (!r) return;
      (m[l.lender] = m[l.lender] || {})[s.to] = ((m[l.lender] || {})[s.to] || 0) + r;
    }));
    return m;
  }
  const owed = (m, a, b) => (m[a] && m[a][b]) || 0;

  // その帳簿で、自分と相手ごとの差し引き：[{ id, net }]（net > 0：相手が自分に返す、< 0：自分が返す）
  function myNets(book, loans, me) {
    const m = owedMatrix(loans);
    const ids = new Set(book.members);
    (loans || []).forEach((l) => { ids.add(l.lender); l.shares.forEach((s) => ids.add(s.to)); });
    ids.delete(me);
    return [...ids].map((id) => ({ id, lent: owed(m, me, id), borrowed: owed(m, id, me), net: owed(m, me, id) - owed(m, id, me) }));
  }

  // 帳簿のみんなの差し引き：[{ from, to, amt }]（from が to に返す）
  function pairNets(book, loans) {
    const m = owedMatrix(loans);
    const ids = new Set(book.members);
    (loans || []).forEach((l) => { ids.add(l.lender); l.shares.forEach((s) => ids.add(s.to)); });
    const list = [...ids], out = [];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j], net = owed(m, a, b) - owed(m, b, a);
      if (net > 0) out.push({ from: b, to: a, amt: net });
      else if (net < 0) out.push({ from: a, to: b, amt: -net });
    }
    return out.sort((x, y) => y.amt - x.amt);
  }

  // 自分だけの帳簿
  const entryStat = (e) => {
    const paid = (e.repayments || []).reduce((a, r) => a + (r.amount || 0), 0);
    return { paid, rest: Math.max(0, (e.amount || 0) - paid) };
  };
  // 相手ごと（名前ごと）の差し引き：[{ who, lent, borrowed, net }]
  function personalNets(entries) {
    const by = {};
    (entries || []).forEach((e) => {
      const r = entryStat(e).rest;
      if (!r) return;
      const k = (e.who || '').trim() || '（名前なし）';
      const x = by[k] = by[k] || { who: k, lent: 0, borrowed: 0 };
      if (e.dir === 'lent') x.lent += r; else x.borrowed += r;
    });
    return Object.values(by).map((x) => ({ ...x, net: x.lent - x.borrowed })).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  }

  const yen = (n) => '¥' + Math.round(n || 0).toLocaleString('ja-JP');
  const pad = (n) => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

  return { shareStat, loanTotal, loanRest, owedMatrix, owed, myNets, pairNets, entryStat, personalNets, yen, today };
})();
