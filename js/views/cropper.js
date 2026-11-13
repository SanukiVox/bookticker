// Görsel kırpma ekranı: kapak oranında (2:3) ya da serbest kırpma.
import { sheet, $, $$ } from '../ui.js';

export function cropImage(blob, { title = 'Kapağı kırp' } = {}) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(blob);
    let done = false;
    sheet({
      title,
      body: `<div class="crop-area"><div class="crop-wrap" id="cw"><img id="ci" src="${url}" alt="" draggable="false">
          <div class="crop-box" id="cb"><i data-h="nw"></i><i data-h="ne"></i><i data-h="sw"></i><i data-h="se"></i></div></div></div>
        <div class="chip-wrap" style="justify-content:center;margin-top:12px">
          <button class="chip on" data-ratio="1.5">📖 Kitap oranı</button><button class="chip" data-ratio="0">Serbest</button>
          <button class="chip" id="c-all">Tamamı</button></div>
        <p class="muted small" style="text-align:center">Çerçeveyi sürükleyerek taşı, köşelerinden boyutlandır.</p>`,
      foot: '<button class="btn" data-close>Vazgeç</button><button class="btn primary" id="c-ok">Kullan</button>',
      onClose: () => { URL.revokeObjectURL(url); if (!done) resolve(null); },
      onMount: (el, close) => {
        const img = $('#ci', el), box = $('#cb', el);
        let ratio = 1.5; // yükseklik / genişlik
        let r = { x: 0, y: 0, w: 0, h: 0 }, W = 0, H = 0;

        const draw = () => { Object.assign(box.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }); };
        function reset(full = false) {
          W = img.clientWidth; H = img.clientHeight;
          if (full || !ratio) r = { x: 0, y: 0, w: W, h: H };
          else {
            let w = W, h = w * ratio;
            if (h > H) { h = H; w = h / ratio; }
            r = { x: (W - w) / 2, y: (H - h) / 2, w, h };
          }
          draw();
        }
        img.complete ? requestAnimationFrame(() => reset()) : img.addEventListener('load', () => reset(), { once: true });

        let drag = null;
        box.addEventListener('pointerdown', e => {
          e.preventDefault();
          drag = { mode: e.target.dataset.h || 'move', sx: e.clientX, sy: e.clientY, r0: { ...r } };
          box.setPointerCapture(e.pointerId);
        });
        box.addEventListener('pointermove', e => {
          if (!drag) return;
          const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy, o = drag.r0, min = 40;
          if (drag.mode === 'move') {
            r.x = Math.max(0, Math.min(W - o.w, o.x + dx));
            r.y = Math.max(0, Math.min(H - o.h, o.y + dy));
          } else {
            const left = drag.mode.includes('w'), top = drag.mode.includes('n');
            // Sabit kalan köşe
            const ax = left ? o.x + o.w : o.x, ay = top ? o.y + o.h : o.y;
            let w = Math.max(min, left ? o.w - dx : o.w + dx);
            let h = Math.max(min, top ? o.h - dy : o.h + dy);
            if (ratio) h = w * ratio;
            // Görselin dışına taşmasın
            const maxW = left ? ax : W - ax, maxH = top ? ay : H - ay;
            if (w > maxW) { w = maxW; if (ratio) h = w * ratio; }
            if (h > maxH) { h = maxH; if (ratio) w = h / ratio; }
            r = { x: left ? ax - w : ax, y: top ? ay - h : ay, w, h };
          }
          draw();
        });
        const end = () => { drag = null; };
        box.addEventListener('pointerup', end);
        box.addEventListener('pointercancel', end);

        $$('[data-ratio]', el).forEach(c => c.addEventListener('click', () => {
          ratio = Number(c.dataset.ratio);
          $$('[data-ratio]', el).forEach(x => x.classList.toggle('on', x === c));
          reset();
        }));
        $('#c-all', el).addEventListener('click', () => reset(true));

        $('#c-ok', el).addEventListener('click', () => {
          const sx = img.naturalWidth / W, sy = img.naturalHeight / H;
          const cw = r.w * sx, ch = r.h * sy;
          const scale = Math.min(1, 900 / ch);
          const c = document.createElement('canvas');
          c.width = Math.round(cw * scale); c.height = Math.round(ch * scale);
          c.getContext('2d').drawImage(img, r.x * sx, r.y * sy, cw, ch, 0, 0, c.width, c.height);
          c.toBlob(out => { done = true; resolve(out); close(); }, 'image/jpeg', 0.88);
        });
      },
    });
  });
}
