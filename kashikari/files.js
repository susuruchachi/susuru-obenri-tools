// --- ファイルを保存する（レシートの写真・まとめた ZIP）---
// アプリ（Android / iOS）では KashikariApp.saveFile で「ダウンロード」へ。ブラウザではダウンロードのリンクで
// ZIP は「圧縮しない」形（レシートは JPEG なので、圧縮してもほとんど小さくならない）。ファイル名は UTF-8（日本語OK）
const KFiles = (() => {
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8) {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  const enc = new TextEncoder();
  // data:image/jpeg;base64,... → バイト
  function dataUrlBytes(url) {
    const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(url || '');
    if (!m) return null;
    if (!m[2]) return enc.encode(decodeURIComponent(m[3]));
    const bin = atob(m[3]), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const textBytes = (s) => enc.encode(s);
  // ファイル名に使えない文字を外す
  const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80);
  // entries: [{ name, data: Uint8Array, date: 'YYYY-MM-DD' }] → ZIP のバイト
  function zip(entries) {
    const parts = [], central = [];
    let offset = 0;
    const used = new Set();
    entries.forEach((e) => {
      let name = e.name, n = 2;
      while (used.has(name)) { const dot = e.name.lastIndexOf('.'); name = dot > 0 ? `${e.name.slice(0, dot)}_${n}${e.name.slice(dot)}` : `${e.name}_${n}`; n++; }
      used.add(name);
      const nb = enc.encode(name), data = e.data, crc = crc32(data);
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.date || '');
      const dosDate = m ? ((Math.max(1980, +m[1]) - 1980) << 9) | (+m[2] << 5) | +m[3] : (1 << 5) | 1;
      const dosTime = 12 << 11;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nb.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), nb, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nb.length, true);
      ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), nb);
      offset += 30 + nb.length + data.length;
    });
    const cdSize = central.reduce((a, x) => a + x.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, used.size, true); end.setUint16(10, used.size, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)], out = new Uint8Array(offset + cdSize + 22);
    let p = 0;
    all.forEach((x) => { out.set(x, p); p += x.length; });
    return out;
  }
  function toBase64(u8) {
    let bin = '';
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  // 保存する。'app'：アプリの「ダウンロード」へ、'browser'：ブラウザのダウンロード、false：できなかった
  function save(name, mime, u8) {
    if (window.KashikariApp) {
      if (!window.KashikariApp.saveFile) return false;
      try { return window.KashikariApp.saveFile(name, mime, toBase64(u8)) ? 'app' : false; } catch (e) { return false; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([u8], { type: mime })); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    return 'browser';
  }
  return { crc32, zip, save, dataUrlBytes, textBytes, safeName };
})();
