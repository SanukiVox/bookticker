// Taranmış PDF'ler için hızlı yol.
// pdf.js, Safari'de (iPhone) JPEG sayfa resimlerini JavaScript ile çözer; bu çok yavaştır.
// Taranmış kitapların her sayfası genelde tek bir JPEG resimdir. Bu modül PDF'in yapısını okuyup
// sayfadaki JPEG'in dosyadaki yerini bulur ve resmi doğrudan tarayıcının (donanım hızlandırmalı)
// çözücüsüyle açar. Sayfa basit bir tarama değilse null döner ve pdf.js ile çizilir.

const LAT = new TextDecoder('latin1');
const WS = /[\0\t\n\f\r ]/;
const DELIM = /[\0\t\n\f\r ()<>[\]{}/%]/;

// ---------- Küçük PDF sözdizimi çözücüsü ----------
class Lexer {
  constructor(s, pos = 0) { this.s = s; this.p = pos; }
  skip() {
    const s = this.s;
    for (;;) {
      const c = s[this.p];
      if (c === undefined) return;
      if (WS.test(c)) { this.p++; continue; }
      if (c === '%') { while (this.p < s.length && s[this.p] !== '\n' && s[this.p] !== '\r') this.p++; continue; }
      return;
    }
  }
  // Bir değer okur. Operatörleri (içerik akışında) { op } olarak döndürür.
  value(allowOps = false) {
    this.skip();
    const s = this.s, c = s[this.p];
    if (c === undefined) return undefined;
    if (c === '<' && s[this.p + 1] === '<') {
      this.p += 2; const d = {};
      for (;;) {
        this.skip();
        if (s[this.p] === '>' && s[this.p + 1] === '>') { this.p += 2; return d; }
        if (this.p >= s.length) throw new Error('eof');
        const k = this.value();
        if (typeof k !== 'object' || !k || !('n' in k)) throw new Error('key');
        d[k.n] = this.value();
      }
    }
    if (c === '[') {
      this.p++; const a = [];
      for (;;) {
        this.skip();
        if (s[this.p] === ']') { this.p++; return a; }
        if (this.p >= s.length) throw new Error('eof');
        a.push(this.value(allowOps));
      }
    }
    if (c === '/') {
      let e = this.p + 1; while (e < s.length && !DELIM.test(s[e])) e++;
      const n = s.slice(this.p + 1, e).replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      this.p = e; return { n };
    }
    if (c === '(') {
      let depth = 0, e = this.p;
      for (; e < s.length; e++) {
        const ch = s[e];
        if (ch === '\\') { e++; continue; }
        if (ch === '(') depth++;
        else if (ch === ')' && --depth === 0) break;
      }
      const str = s.slice(this.p + 1, e); this.p = e + 1; return { str };
    }
    if (c === '<') { const e = s.indexOf('>', this.p); const str = s.slice(this.p + 1, e); this.p = e + 1; return { hex: str }; }
    if (c === ']' || c === '>' || c === ')' || c === '{' || c === '}') { this.p++; if (allowOps) return { op: c }; throw new Error('delim'); }
    let e = this.p; while (e < s.length && !DELIM.test(s[e])) e++;
    const tok = s.slice(this.p, e); this.p = e;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) {
      // "12 0 R" → başvuru
      if (/^\d+$/.test(tok)) {
        const m = /^[\0\t\n\f\r ]+(\d+)[\0\t\n\f\r ]+R(?=[\0\t\n\f\r ()<>[\]{}/%]|$)/.exec(s.slice(this.p, this.p + 32));
        if (m) { this.p += m[0].length; return { r: Number(tok) }; }
      }
      return Number(tok);
    }
    if (tok === 'true') return true;
    if (tok === 'false') return false;
    if (tok === 'null') return null;
    if (allowOps) return { op: tok };
    throw new Error(`tok ${tok}`);
  }
}

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(await out);
}

// ---------- PDF dizini ----------
export class FastPdf {
  constructor(bytes) {
    this.b = bytes;
    this.objs = new Map(); // num → { v } | { dict, start, end } | { v, fromStm }
    this.pages = null;
    this.cache = new Map();
    this.stats = { fast: 0, slow: 0, why: {} };
  }

  // Dosyanın bir bölümünü metin olarak (bayt konumu = karakter konumu)
  text(start, len) { return LAT.decode(this.b.subarray(start, Math.min(this.b.length, start + len))); }
  // pos'taki değeri çöz; pencere yetmezse büyüt
  parseAt(pos) {
    for (let w = 4096; ; w *= 8) {
      const lx = new Lexer(this.text(pos, w));
      try {
        const v = lx.value();
        lx.skip();
        if (lx.p + 16 >= lx.s.length && pos + w < this.b.length) throw new Error('eof');
        return { v, end: pos + lx.p };
      } catch (e) { if (pos + w >= this.b.length || w > 1 << 24) throw e; }
    }
  }
  isWs(c) { return c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0; }
  isDigit(c) { return c >= 48 && c <= 57; }
  findBytes(pat, from) {
    const b = this.b, p0 = pat.charCodeAt(0);
    for (let i = b.indexOf(p0, from); i >= 0; i = b.indexOf(p0, i + 1)) {
      let k = 1; while (k < pat.length && b[i + k] === pat.charCodeAt(k)) k++;
      if (k === pat.length) return i;
    }
    return -1;
  }

  // "N G obj" başlıklarını baytlar üzerinde bul; akışların içini atla
  scan() {
    const b = this.b, objstms = [];
    let i = 0;
    while (i < b.length) {
      const j = b.indexOf(0x6f, i); // 'o'
      if (j < 0) break;
      i = j + 1;
      if (b[j + 1] !== 0x62 || b[j + 2] !== 0x6a) continue; // 'bj'
      const after = b[j + 3];
      if (after !== undefined && !this.isWs(after) && after !== 0x3c && after !== 0x5b && after !== 0x2f && after !== 0x25) continue;
      // geriye: boşluk, kuşak no, boşluk, nesne no
      let k = j - 1; if (!this.isWs(b[k])) continue;
      while (k >= 0 && this.isWs(b[k])) k--;
      let e2 = k; while (k >= 0 && this.isDigit(b[k])) k--;
      if (k === e2) continue;
      if (!this.isWs(b[k])) continue;
      while (k >= 0 && this.isWs(b[k])) k--;
      const e1 = k; while (k >= 0 && this.isDigit(b[k])) k--;
      if (k === e1) continue;
      const num = Number(this.text(k + 1, e1 - k));
      let r;
      try { r = this.parseAt(j + 3); } catch { continue; }
      const v = r.v;
      if (v && typeof v === 'object' && this.text(r.end, 6) === 'stream') {
        let start = r.end + 6;
        if (b[start] === 13) start++;
        if (b[start] === 10) start++;
        let end = -1;
        if (typeof v.Length === 'number') {
          let q = start + v.Length; while (q < b.length && this.isWs(b[q])) q++;
          if (this.text(q, 9) === 'endstream') end = start + v.Length;
        }
        if (end < 0) {
          const q = this.findBytes('endstream', start); if (q < 0) break;
          end = q; while (end > start && (b[end - 1] === 10 || b[end - 1] === 13)) end--;
        }
        this.objs.set(num, { dict: v, start, end });
        if (v.Type?.n === 'ObjStm') objstms.push(num);
        i = end;
      } else {
        this.objs.set(num, { v });
        i = r.end;
      }
    }
    this.objstms = objstms;
  }

  async loadObjStms() {
    for (const num of this.objstms) {
      const o = this.objs.get(num);
      const data = await this.streamData(o);
      if (!data) continue;
      const t = LAT.decode(data);
      const n = Number(o.dict.N), first = Number(o.dict.First);
      const lx = new Lexer(t);
      const pairs = [];
      for (let i = 0; i < n; i++) pairs.push([lx.value(), lx.value()]);
      for (const [onum, off] of pairs) {
        if (this.objs.has(onum) && !this.objs.get(onum).fromStm) continue; // doğrudan tanım öncelikli
        try { this.objs.set(onum, { v: new Lexer(t, first + off).value(), fromStm: true }); } catch { /* yok */ }
      }
    }
  }

  get(x, depth = 0) {
    if (x && typeof x === 'object' && 'r' in x) {
      if (depth > 20) return null;
      const o = this.objs.get(x.r);
      if (!o) return null;
      return 'v' in o ? this.get(o.v, depth + 1) : o;
    }
    return x;
  }
  // Akış nesnesinin sözlüğü (doğrudan ya da başvurudan)
  dictOf(x) { const o = this.get(x); return o && o.dict ? o.dict : o; }

  async streamData(o) {
    if (!o || !o.dict) return null;
    let len = o.end - o.start;
    const L = this.get(o.dict.Length);
    if (typeof L === 'number' && L > 0 && L <= len + 2) len = Math.min(L, this.b.length - o.start);
    let data = this.b.subarray(o.start, o.start + len);
    const f = this.get(o.dict.Filter);
    const filters = Array.isArray(f) ? f.map(x => this.get(x)?.n) : f ? [f.n] : [];
    const parms = this.get(o.dict.DecodeParms);
    for (const fl of filters) {
      if (fl !== 'FlateDecode' && fl !== 'Fl') return null;
      if (parms && (Array.isArray(parms) ? parms.some(p => p && this.get(p)?.Predictor > 1) : this.get(parms)?.Predictor > 1)) return null;
      try { data = await inflate(data); } catch { return null; }
    }
    return data;
  }

  findRoot() {
    let root = null;
    // Klasik trailer: dosyanın sonundaki en son trailer geçerli
    const tailStart = Math.max(0, this.b.length - 65536);
    const tail = this.text(tailStart, 65536);
    const t = tail.lastIndexOf('trailer');
    if (t >= 0) { try { root = this.parseAt(tailStart + t + 7).v?.Root || null; } catch { /* yok */ } }
    if (!root) for (const o of this.objs.values()) if (o.dict?.Type?.n === 'XRef' && o.dict.Root) root = o.dict.Root;
    if (!root) for (const [num, o] of this.objs) if (o.v?.Type?.n === 'Catalog') root = { r: num };
    return root;
  }

  async init() {
    this.scan();
    await this.loadObjStms();
    const cat = this.get(this.findRoot());
    const pagesRoot = cat && this.get(cat.Pages);
    if (!pagesRoot) throw new Error('pages');
    const out = [];
    const walk = (node, inh, depth, seen) => {
      if (!node || depth > 40 || out.length > 20000) return;
      const kids = this.get(node.Kids);
      const next = { res: node.Resources ?? inh.res };
      if (node.Type?.n === 'Pages' || (Array.isArray(kids) && node.Type?.n !== 'Page')) {
        for (const k of kids || []) {
          if (k?.r != null) { if (seen.has(k.r)) continue; seen.add(k.r); }
          walk(this.get(k), next, depth + 1, seen);
        }
      } else out.push({ node, res: next.res });
    };
    walk(pagesRoot, { res: null }, 0, new Set());
    this.pages = out;
    return this;
  }

  // Sayfa basit bir JPEG tarama mı? { start, end, ctm, w, h } ya da null
  analyze(n) {
    if (!this.cache.has(n)) this.cache.set(n, this.#analyze(n).catch(() => null).then(r => {
      if (r?.img) this.stats.fast++; else { this.stats.slow++; const w = r?.why || 'hata'; this.stats.why[w] = (this.stats.why[w] || 0) + 1; }
      return r?.img ? r : null;
    }));
    return this.cache.get(n);
  }

  async #analyze(n) {
    const pg = this.pages[n - 1];
    if (!pg) return { why: 'sayfa yok' };
    const contents = this.get(pg.node.Contents);
    const parts = Array.isArray(contents) ? contents.map(c => this.get(c)) : [contents];
    let text = '';
    for (const p of parts) {
      if (!p) continue;
      const d = await this.streamData(p);
      if (!d) return { why: 'içerik sıkıştırması' };
      text += `${LAT.decode(d)}\n`;
    }
    const st = { img: null };
    const why = await this.#run(text, this.get(pg.res) || {}, [1, 0, 0, 1, 0, 0], st, 0);
    if (why) return { why };
    if (!st.img) return { why: 'resim yok' };
    // JPEG başlığı: CMYK (4 bileşen) tarayıcıda yanlış renk verebilir
    const comps = jpegComponents(this.b.subarray(st.img.start, Math.min(st.img.end, st.img.start + 65536)));
    if (comps !== 1 && comps !== 3) return { why: 'JPEG bileşenleri' };
    return { img: st.img };
  }

  // İçerik akışını yorumla; sorun varsa sebebi döndürür. Form nesnelerinin (XObject Form) içine girer.
  async #run(text, res, baseCtm, st, depth) {
    if (depth > 4) return 'iç içe form';
    const xobjs = this.get(res.XObject) || {};
    const lx = new Lexer(text);
    let ctm = baseCtm.slice(), tr = 0;
    const stack = [];
    let ops = [];
    for (let guard = 0; guard < 200000; guard++) {
      let v;
      try { v = lx.value(true); } catch { return 'içerik okunamadı'; }
      if (v === undefined) break;
      if (!(v && typeof v === 'object' && 'op' in v)) { ops.push(v); continue; }
      const op = v.op;
      switch (op) {
        case 'q': stack.push([ctm, tr]); break;
        case 'Q': if (stack.length) [ctm, tr] = stack.pop(); break;
        case 'cm': if (ops.length >= 6) ctm = mul(ops.slice(-6).map(Number), ctm); break;
        case 'Tr': tr = Number(ops[ops.length - 1]); break;
        case 'Tj': case 'TJ': case "'": case '"': if (tr !== 3 && tr !== 7) return 'metin'; break;
        case 'Do': {
          const name = ops[ops.length - 1]?.n;
          const o = this.get(xobjs[name]);
          if (!o?.dict) return 'resim bulunamadı';
          const d = o.dict;
          if (d.Subtype?.n === 'Form') {
            const fd = await this.streamData(o);
            if (!fd) return 'form sıkıştırması';
            const m = this.get(d.Matrix);
            const fm = Array.isArray(m) && m.length === 6 ? mul(m.map(x => Number(this.get(x))), ctm) : ctm;
            const why = await this.#run(LAT.decode(fd), this.get(d.Resources) || res, fm, st, depth + 1);
            if (why) return why;
            break;
          }
          if (d.Subtype?.n !== 'Image') return 'bilinmeyen nesne';
          if (st.img) return 'birden çok resim';
          const f = this.get(d.Filter);
          const fl = Array.isArray(f) ? (f.length === 1 ? this.get(f[0])?.n : 'çok') : f?.n;
          if (fl !== 'DCTDecode' && fl !== 'DCT') return fl ? `resim biçimi ${fl === 'JBIG2Decode' ? 'JBIG2' : fl === 'CCITTFaxDecode' ? 'CCITT' : fl === 'JPXDecode' ? 'JPEG 2000' : fl === 'FlateDecode' ? 'sıkıştırılmış ham' : fl}` : 'ham resim';
          if (d.SMask || d.Mask || d.ImageMask === true || d.Decode) return 'maskeli resim';
          const cs = this.get(d.ColorSpace);
          let ok = cs?.n === 'DeviceRGB' || cs?.n === 'DeviceGray' || cs?.n === 'RGB' || cs?.n === 'G';
          if (!ok && Array.isArray(cs) && this.get(cs[0])?.n === 'ICCBased') { const icc = this.dictOf(cs[1]); ok = icc && (icc.N === 1 || icc.N === 3); }
          if (!ok) return 'renk uzayı';
          st.img = { start: o.start, end: o.end, ctm: ctm.slice(), w: d.Width, h: d.Height };
          break;
        }
        case 'BI': return 'satır içi resim';
        case 'f': case 'F': case 'f*': if (st.img) return 'çizim'; break; // resimden önceki zemin dolgusu resmin altında kalır
        case 'S': case 's': case 'B': case 'B*': case 'b': case 'b*': case 'sh': return 'çizim';
        default: break;
      }
      ops = [];
    }
    return null;
  }
}

function mul(a, b) {
  return [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
}

function jpegComponents(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return 0;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return b[i + 9];
    i += 2 + len;
  }
  return 0;
}

// Dosyayı aç: blob (resimler buradan parça parça okunur) ve tüm baytlar (yapı için)
export async function openFast(blob, bytes) {
  if (typeof DecompressionStream === 'undefined' || typeof createImageBitmap === 'undefined') return null;
  const f = await new FastPdf(bytes).init();
  f.blob = blob;
  f.b = bytes;
  return f;
}

// Sayfayı canvas'a çiz. vpTransform: pdf.js viewport.transform (PDF → canvas pikselleri).
// Başarılıysa true; değilse false (pdf.js ile çizilmeli).
export async function drawFast(f, n, canvas, vpTransform) {
  const info = await f.analyze(n);
  if (!info) return false;
  const { img } = info;
  const bmp = await createImageBitmap(f.blob.slice(img.start, img.end, 'image/jpeg'));
  try {
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(...vpTransform);
    ctx.transform(...img.ctm);
    ctx.transform(1, 0, 0, -1, 0, 1); // resim uzayı (y yukarı) → çizim
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, 1, 1);
    ctx.restore();
  } finally { bmp.close?.(); }
  return true;
}
