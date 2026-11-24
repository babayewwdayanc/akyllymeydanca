// Рисование поля: тепловая карта игрока и 2D-повтор матча по координатам от AI.
import { isLight } from './ui.js';

function fitCanvas(cv) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = cv.getBoundingClientRect();
  const w = Math.max(200, Math.round(r.width * dpr));
  const hgt = Math.max(100, Math.round(r.height * dpr));
  if (cv.width !== w || cv.height !== hgt) { cv.width = w; cv.height = hgt; }
  return { w, h: hgt, dpr };
}

/** Возвращает функцию перевода метров поля в пиксели canvas. */
function layout(w, h, L, Wd, margin) {
  const s = Math.min((w - 2 * margin) / L, (h - 2 * margin) / Wd);
  const ox = (w - L * s) / 2;
  const oy = (h - Wd * s) / 2;
  return { s, ox, oy, P: (x, y) => [ox + x * s, oy + y * s] };
}

export function drawPitch(ctx, w, h, L, Wd, dpr = 1) {
  const m = 14 * dpr;
  const g = layout(w, h, L, Wd, m);
  // Искусственный газон полосами
  ctx.fillStyle = '#297C4C';
  ctx.fillRect(0, 0, w, h);
  const stripes = 10;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 ? '#2E8A55' : '#2A8150';
    const [x0] = g.P((L / stripes) * i, 0);
    ctx.fillRect(x0, g.oy, (L / stripes) * g.s, Wd * g.s);
  }
  ctx.strokeStyle = 'rgba(255,255,255,.85)';
  ctx.lineWidth = Math.max(1.5, 2 * dpr);
  const [x0, y0] = g.P(0, 0);
  ctx.strokeRect(x0, y0, L * g.s, Wd * g.s);
  ctx.beginPath();
  ctx.moveTo(...g.P(L / 2, 0));
  ctx.lineTo(...g.P(L / 2, Wd));
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(...g.P(L / 2, Wd / 2), 3 * g.s, 0, Math.PI * 2);
  ctx.stroke();
  // Штрафные (для мини-футбола — полукруг ~6 м) и ворота 3 м
  for (const side of [0, L]) {
    const dir = side === 0 ? 1 : -1;
    ctx.beginPath();
    ctx.arc(...g.P(side, Wd / 2), 6 * g.s, dir > 0 ? -Math.PI / 2 : Math.PI / 2, dir > 0 ? Math.PI / 2 : Math.PI * 1.5);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    const [gx, gy] = g.P(side, Wd / 2 - 1.5);
    ctx.fillRect(gx - (dir > 0 ? 4 * dpr : 0), gy, 4 * dpr, 3 * g.s);
  }
  return g;
}

/** Тепловая карта: сетка 16×8 значений 0..1. */
export function drawHeatmap(cv, heat, L = 40, Wd = 20) {
  const { w, h, dpr } = fitCanvas(cv);
  const ctx = cv.getContext('2d');
  const g = drawPitch(ctx, w, h, L, Wd, dpr);
  if (!heat) return;
  const rows = heat.length;
  const cols = heat[0].length;
  const cw = L / cols;
  const ch = Wd / rows;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = heat[r][c];
      if (v < 0.03) continue;
      const [cx, cy] = g.P((c + 0.5) * cw, (r + 0.5) * ch);
      const rad = Math.max(cw, ch) * g.s * 1.25;
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      const hue = 55 - v * 55; // жёлтый → красный
      grd.addColorStop(0, `hsla(${hue}, 95%, 55%, ${0.25 + v * 0.55})`);
      grd.addColorStop(1, `hsla(${hue}, 95%, 55%, 0)`);
      ctx.fillStyle = grd;
      ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    }
  }
  ctx.restore();
}

/** 2D-повтор матча. Работает и без видео — по координатам из анализа. */
export class Replay {
  constructor(cv, data, { colors, tracks, meTrack = null, labels = new Map() }) {
    this.cv = cv;
    this.data = data;
    this.colors = colors; // {A: '#...', B: '#...'}
    this.tracks = new Map(tracks.map((t) => [t.track_no, t]));
    this.meTrack = meTrack;
    this.labels = labels;
    this.offset = data.offset || 0; // для клипа: время первого кадра
  }

  get duration() { return this.offset + (this.data.frames.length - 1) / this.data.frames_hz; }

  frameAt(t) {
    const f = this.data.frames;
    const idx = (t - this.offset) * this.data.frames_hz;
    const i = Math.max(0, Math.min(f.length - 1, Math.floor(idx)));
    const j = Math.min(f.length - 1, i + 1);
    return { a: f[i], b: f[j], k: Math.min(1, Math.max(0, idx - i)) };
  }

  draw(t) {
    const { w, h, dpr } = fitCanvas(this.cv);
    const ctx = this.cv.getContext('2d');
    const L = this.data.pitch.length_m;
    const Wd = this.data.pitch.width_m;
    const g = drawPitch(ctx, w, h, L, Wd, dpr);
    const { a, b, k } = this.frameAt(t);
    if (!a) return;
    const lerp = (p, q) => (p && q ? [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k] : p || q);
    const r = Math.max(7, 0.65 * g.s);
    this.data.frame_tracks.forEach((no, i) => {
      const pos = lerp(a.p[i], b.p[i]);
      if (!pos) return;
      const tr = this.tracks.get(no);
      const col = this.colors[tr?.team] || '#fff';
      const [x, y] = g.P(pos[0], pos[1]);
      if (no === this.meTrack) {
        ctx.beginPath();
        ctx.arc(x, y, r * 1.9, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(232,185,49,.28)';
        ctx.fill();
        ctx.strokeStyle = '#E8B931';
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeStyle = 'rgba(0,0,0,.45)';
      ctx.stroke();
      ctx.fillStyle = isLight(col) ? '#141826' : '#fff';
      ctx.font = `700 ${Math.round(r * 0.95)}px Archivo, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(tr?.jersey ?? no), x, y + 0.5);
    });
    const ball = lerp(a.ball, b.ball);
    if (ball) {
      const [bx, by] = g.P(ball[0], ball[1]);
      ctx.beginPath();
      ctx.arc(bx + 1.5 * dpr, by + 2 * dpr, r * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(bx, by, r * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 1 * dpr;
      ctx.stroke();
    }
  }
}
