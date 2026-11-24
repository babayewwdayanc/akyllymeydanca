// Interfeýs üçin kömekçiler (frameworksyz).

/** h('div', {class: 'x', onclick}, child1, 'text', [children]) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** replaceChildren, ýöne null/false bölekleri goýbolsun edýär. */
export function fill(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

let toastTimer;
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

export const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

const MONTHS = ['ýanwar', 'fewral', 'mart', 'aprel', 'maý', 'iýun', 'iýul', 'awgust', 'sentýabr', 'oktýabr', 'noýabr', 'dekabr'];
export function fmtDate(iso) {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${hh}:${mm}`;
}

export const POS = { GK: 'Derwezeçi', DEF: 'Goragçy', MID: 'Ýarym goragçy', FWD: 'Hüjümçi' };
export const POS_SHORT = { GK: 'DW', DEF: 'GR', MID: 'ÝG', FWD: 'HJ' };
export const FOOT = { R: 'Sag aýak', L: 'Çep aýak', B: 'Iki aýak' };

/** Oýun üçin bahanyň reňki (3–10). */
export function ratingColor(r) {
  if (r >= 8) return '#5CCB8A';
  if (r >= 7) return '#A9DB6A';
  if (r >= 6.5) return '#F2D45C';
  if (r >= 6) return '#F3AE55';
  return '#F08A7E';
}

export function avatar(person, { team, jersey, size } = {}) {
  const el = h('span', { class: `av${person?.photo_cutout ? ' cut' : ''}` });
  if (size) Object.assign(el.style, { width: `${size}px`, height: `${size}px` });
  if (person?.photo_url) {
    el.style.backgroundImage = `url("${person.photo_url}")`;
  } else if (person?.name || person?.first_name) {
    const n = person.name || `${person.first_name} ${person.last_name}`;
    el.textContent = n.split(' ').map((p) => p[0]).slice(0, 2).join('');
  } else {
    el.append(h('span', { class: 'jn' }, jersey ? `№${jersey}` : '?'));
  }
  if (team) el.style.boxShadow = `inset 0 0 0 3px ${team}`;
  return el;
}

/** Trekiň ady: özüni saýlan oýunçynyň ady ýa-da «Oýunçy 5 · №7». */
export function trackName(t) {
  if (t?.player) return t.player.name;
  return `Oýunçy ${t.track_no}${t.jersey ? ` · №${t.jersey}` : ''}`;
}

export function shirtSvg(color, num) {
  const light = isLight(color);
  return h('span', {
    class: 'shirt',
    html: `<svg viewBox="0 0 54 54" width="54" height="54"><path d="M17 6l-11 7 5 10 5-3v28h22V20l5 3 5-10-11-7c-2 4-5 6-10 6s-8-2-10-6z" fill="${color}" stroke="rgba(0,0,0,.25)"/><text x="27" y="38" text-anchor="middle" font-family="Archivo, sans-serif" font-stretch="75%" font-weight="800" font-size="15" fill="${light ? '#0E1B14' : '#fff'}">${num ?? ''}</text></svg>`,
  });
}

export function isLight(hex) {
  const c = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16));
  return r * 0.299 + g * 0.587 + b * 0.114 > 150;
}

export function loading(text = 'Ýüklenýär…') {
  return h('div', { class: 'loading' }, text);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Salgy göçürildi');
  } catch {
    prompt('Salgyny göçüriň:', text);
  }
}
