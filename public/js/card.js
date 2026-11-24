// FC kart: ekran üçin HTML we PNG surat (ýatda saklamak we dostlara ugratmak üçin).
// Fony aýrylan surat (PNG) kartda oýunçy ýaly «durýar», adaty surat bolsa arka şekilli çarçuwada görkezilýär.
import { h, POS_SHORT, FOOT } from './ui.js';

const ATTRS = [
  ['pac', 'TIZ'], ['sho', 'URG'], ['pas', 'PAS'],
  ['dri', 'DRB'], ['def', 'GOR'], ['phy', 'FIZ'],
];

// Türkmen halysynyň göli — kartyň arka fonundaky nagyş
const GUL_SVG = `<svg viewBox="0 0 200 150" class="gul" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="4"><path d="M62 4H138L196 52V98L138 146H62L4 98V52Z"/><path d="M100 20L176 75L100 130L24 75Z"/><path d="M100 20V130M24 75H176"/></g><g fill="currentColor"><path d="M75 48l9 9-9 9-9-9z"/><path d="M125 48l9 9-9 9-9-9z"/><path d="M75 84l9 9-9 9-9-9z"/><path d="M125 84l9 9-9 9-9-9z"/><path d="M100 66l9 9-9 9-9-9z"/></g></svg>`;
const MARK_SVG = '<svg viewBox="0 0 32 32" class="mark" aria-hidden="true"><path d="M16 1.5l5.2 3.4 6.2.4.4 6.2 3.4 5.2-3.4 5.2-.4 6.2-6.2.4L16 30.5l-5.2-3.4-6.2-.4-.4-6.2L.8 16l3.4-5.2.4-6.2 6.2-.4z" fill="currentColor"/><path d="M16 8l8 8-8 8-8-8z" fill="rgba(255,255,255,.75)"/></svg>';
const SILHOUETTE = '<svg viewBox="0 0 100 110"><circle cx="50" cy="34" r="22" fill="currentColor"/><path d="M8 110c4-28 20-42 42-42s38 14 42 42z" fill="currentColor"/></svg>';

/** p: { first_name, last_name, photo_url, photo_cutout, position, foot, card: {ovr, tier, attrs, provisional} } */
export function renderCard(p, { size = '', mvp = false, reveal = false } = {}) {
  const c = p.card;
  const photo = h('div', { class: `photo${p.photo_url ? (p.photo_cutout ? '' : ' framed') : ' empty'}` });
  if (p.photo_url) photo.style.backgroundImage = `url("${p.photo_url}")`;
  else photo.innerHTML = SILHOUETTE;
  const first = (p.first_name || '').trim() || 'Ady';
  const last = (p.last_name || '').trim() || 'Familiýasy';
  const gul = h('div', { html: GUL_SVG }).firstChild;
  return h('div', {
    class: `pcard ${c.tier} ${size} ${mvp ? 'mvp' : ''} ${reveal ? 'card-reveal' : ''}`,
    role: 'img',
    'aria-label': `${first} ${last} oýunçy karty: reýting ${c.ovr}, ${ATTRS.map(([k, s]) => `${s} ${c.attrs[k]}`).join(', ')}`,
  },
  h('div', { class: 'glow' }),
  gul,
  h('div', { class: 'sheen' }),
  photo,
  h('div', { class: 'frame' }),
  h('div', { class: 'side' },
    h('div', { class: 'ovr' }, c.ovr),
    h('div', { class: 'pos' }, POS_SHORT[p.position] || 'ÝG'),
    h('div', { class: 'rule' }),
    h('div', { class: 'foot' }, FOOT[p.foot] || ''),
    h('div', { html: MARK_SVG })),
  c.provisional ? h('div', { class: 'ribbon' }, 'başlangyç') : null,
  h('div', { class: 'plate' },
    h('div', { class: 'name' }, h('span', { class: 'first' }, first), last),
    h('div', { class: 'attrs' }, ATTRS.map(([k, s]) => h('div', { class: 'attr' }, h('b', {}, c.attrs[k]), h('small', {}, s))))),
  );
}

// ---------- PNG ----------
const TIERS = {
  gold: { stops: ['#FFF3C4', '#F4CF5A', '#DBA521', '#96670A'], ink: '#3A2900', acc: '#8A5E00' },
  silver: { stops: ['#FFFFFF', '#DDE3E8', '#AEB8C2', '#7D8893'], ink: '#1D252D', acc: '#55606B' },
  bronze: { stops: ['#FCE3CD', '#E3A779', '#B86E3C', '#6F3A19'], ink: '#2E1607', acc: '#7A3E17' },
};

function loadImage(src) {
  return new Promise((res) => {
    if (!src) return res(null);
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}

function font(x, weight, px, stretch = 'condensed') {
  x.font = `${weight} ${px}px Archivo, sans-serif`;
  if ('fontStretch' in x) x.fontStretch = stretch;
}

function polyPath(x, pts, W, H, inset = 0) {
  x.beginPath();
  pts.forEach(([px, py], i) => {
    const X = inset + px * (W - 2 * inset);
    const Y = inset + py * (H - 2 * inset);
    if (i) x.lineTo(X, Y); else x.moveTo(X, Y);
  });
  x.closePath();
}

/** Karty 700×980 canvas-a çekýär we PNG Blob gaýtarýar. */
export async function cardToPng(p) {
  await document.fonts?.ready;
  const W = 700;
  const H = 980;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const x = cv.getContext('2d');
  const T = TIERS[p.card.tier] || TIERS.silver;
  const shape = [[.13, 0], [.87, 0], [1, .09], [1, .91], [.87, 1], [.13, 1], [0, .91], [0, .09]];

  polyPath(x, shape, W, H);
  x.clip();
  const g = x.createLinearGradient(0, 0, W * .55, H);
  T.stops.forEach((c, i) => g.addColorStop([0, .3, .64, 1][i], c));
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);

  const gl = x.createRadialGradient(W * .6, H * .36, 0, W * .6, H * .36, H * .38);
  gl.addColorStop(0, 'rgba(255,255,255,.75)');
  gl.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gl;
  x.fillRect(0, 0, W, H);

  // Göl nagyşy
  x.save();
  x.translate(W * .22, H * .12);
  const s = (W * .76) / 200;
  x.scale(s, s);
  x.globalAlpha = .22;
  x.strokeStyle = T.acc;
  x.fillStyle = T.acc;
  x.lineWidth = 4;
  for (const d of ['M62 4H138L196 52V98L138 146H62L4 98V52Z', 'M100 20L176 75L100 130L24 75Z', 'M100 20V130M24 75H176']) x.stroke(new Path2D(d));
  for (const [cx, cy] of [[75, 57], [125, 57], [75, 93], [125, 93], [100, 75]]) {
    x.beginPath(); x.moveTo(cx, cy - 9); x.lineTo(cx + 9, cy); x.lineTo(cx, cy + 9); x.lineTo(cx - 9, cy); x.closePath(); x.fill();
  }
  x.restore();

  // Surat
  const img = await loadImage(p.photo_url);
  if (img) {
    const off = document.createElement('canvas');
    let bx; let by; let bw; let bh;
    if (p.photo_cutout) {
      bx = W * .2; by = H * .05; bw = W * .78; bh = H * .59;
    } else {
      bx = W * .32; by = H * .12; bw = W * .59; bh = H * .47;
    }
    off.width = bw;
    off.height = bh;
    const o = off.getContext('2d');
    if (p.photo_cutout) {
      const k = Math.min(bw / img.width, bh / img.height);
      const dw = img.width * k;
      const dh = img.height * k;
      o.drawImage(img, (bw - dw) / 2, bh - dh, dw, dh);
    } else {
      const k = Math.max(bw / img.width, bh / img.height);
      const dw = img.width * k;
      const dh = img.height * k;
      o.save();
      o.beginPath();
      o.moveTo(0, bh); o.lineTo(0, bw / 2); o.arc(bw / 2, bw / 2, bw / 2, Math.PI, 0); o.lineTo(bw, bh); o.closePath();
      o.clip();
      o.drawImage(img, (bw - dw) / 2, (bh - dh) * .25, dw, dh);
      o.restore();
    }
    o.globalCompositeOperation = 'destination-in';
    const m = o.createLinearGradient(0, 0, 0, bh);
    m.addColorStop(.8, '#000');
    m.addColorStop(1, 'rgba(0,0,0,0)');
    o.fillStyle = m;
    o.fillRect(0, 0, bw, bh);
    if (p.photo_cutout) {
      // gapdallar hem ýuwaşlyk bilen ýitýär (egniň kesilen gyrasy görünmesin)
      const sideFade = o.createLinearGradient(0, 0, bw, 0);
      sideFade.addColorStop(0, 'rgba(0,0,0,0)');
      sideFade.addColorStop(0.08, '#000');
      sideFade.addColorStop(0.92, '#000');
      sideFade.addColorStop(1, 'rgba(0,0,0,0)');
      o.fillStyle = sideFade;
      o.fillRect(0, 0, bw, bh);
    }
    x.save();
    if (p.photo_cutout) {
      x.shadowColor = 'rgba(0,0,0,.28)';
      x.shadowBlur = 24;
      x.shadowOffsetY = 16;
    }
    x.drawImage(off, bx, by);
    x.restore();
  }

  // Içki çarçuwa
  x.save();
  polyPath(x, shape, W, H, 18);
  x.strokeStyle = 'rgba(255,255,255,.4)';
  x.lineWidth = 6;
  x.stroke();
  x.restore();

  // Çep sütün: OVR, pozisiýa, aýak
  x.fillStyle = T.ink;
  x.textAlign = 'center';
  x.textBaseline = 'alphabetic';
  const cx = W * .19;
  font(x, 900, 150, 'extra-condensed');
  x.fillText(String(p.card.ovr), cx, H * .08 + 120);
  font(x, 800, 50);
  x.fillText(POS_SHORT[p.position] || 'ÝG', cx, H * .08 + 182);
  x.fillStyle = T.acc;
  x.globalAlpha = .55;
  x.fillRect(cx - 45, H * .08 + 204, 90, 5);
  x.globalAlpha = .8;
  x.fillStyle = T.ink;
  font(x, 600, 26, 'normal');
  (FOOT[p.foot] || '').split(' ').forEach((w, i) => x.fillText(w, cx, H * .08 + 246 + i * 30));
  x.globalAlpha = 1;

  // At we görkezijiler
  const plateTop = H * .6;
  font(x, 600, 30, 'normal');
  x.globalAlpha = .75;
  x.fillText(p.first_name || '', W / 2, plateTop + 30);
  x.globalAlpha = 1;
  const last = (p.last_name || '').toUpperCase();
  let size = 70;
  do { font(x, 800, size); size -= 2; } while (x.measureText(last).width > W * .82 && size > 26);
  x.fillText(last, W / 2, plateTop + 92);
  x.fillStyle = T.acc;
  x.fillRect(W * .09, plateTop + 108, W * .82, 5);
  x.fillStyle = T.ink;
  ATTRS.forEach(([k, lbl], i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const ax = W * (.25 + col * .25);
    const ay = plateTop + 172 + row * 84;
    font(x, 900, 60);
    x.fillText(String(p.card.attrs[k]), ax, ay);
    font(x, 700, 25, 'normal');
    x.globalAlpha = .7;
    x.fillText(lbl, ax, ay + 30);
    x.globalAlpha = 1;
  });

  font(x, 800, 17, 'normal');
  x.globalAlpha = .5;
  x.fillText('AKYLLY MEÝDANÇA', W / 2, H - 30);
  return new Promise((res) => cv.toBlob(res, 'image/png'));
}

export async function shareCard(p) {
  const blob = await cardToPng(p);
  const file = new File([blob], `fc-kart-${(p.last_name || 'oyunchy').toLowerCase()}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Meniň FC kartym', text: `Meniň reýtingim — ${p.card.ovr}. Akylly Meýdança` });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
