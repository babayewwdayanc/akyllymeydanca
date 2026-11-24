// Oýun pleýeri: hakyky wideo (ýüklenen bolsa) ýa-da AI maglumatlary boýunça 2D gaýtalama.
// Hem-de «gaýçy» — öz pursadyňy kesip al we salgysyny paýlaş.
import { h, fill, fmtTime, toast, copyText } from './ui.js';
import { Replay } from './pitch.js';
import { api } from './api.js';

const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z" fill="currentColor"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor"/></svg>';

/**
 * opts: { videoUrl, replay: {data, colors, tracks, meTrack}, segment: {start, end} }
 * Gaýtarýar: { el, time, duration, seek(t), play(), pause(), playSegment(a,b), onTime(cb), setMe(n), destroy() }
 */
export function createPlayer(opts) {
  const listeners = new Set();
  const emit = (t) => listeners.forEach((cb) => cb(t));
  let segEnd = null;

  if (opts.videoUrl) {
    const v = h('video', { src: opts.videoUrl, controls: true, playsinline: true, preload: 'metadata' });
    const box = h('div', { class: 'player-box' }, v);
    v.addEventListener('timeupdate', () => {
      if (segEnd !== null && v.currentTime >= segEnd) {
        if (opts.segment) v.currentTime = opts.segment.start; // klip — aýlawly
        else { v.pause(); segEnd = null; }
      }
      emit(v.currentTime);
    });
    if (opts.segment) {
      v.addEventListener('loadedmetadata', () => { v.currentTime = opts.segment.start; }, { once: true });
      segEnd = opts.segment.end;
    }
    return {
      el: box,
      get time() { return v.currentTime; },
      get duration() { return v.duration || 0; },
      seek(t) { v.currentTime = t; emit(t); },
      play() { v.play(); },
      pause() { v.pause(); },
      playSegment(a, b) { segEnd = b; v.currentTime = a; v.play(); },
      onTime(cb) { listeners.add(cb); },
      setMe() {},
      destroy() { v.pause(); },
    };
  }

  // ---- 2D gaýtalama ----
  const cv = h('canvas', { 'aria-label': 'Oýnuň shemasy: tegelekler — oýunçylar, ak — top' });
  const rp = new Replay(cv, opts.replay.data, opts.replay);
  const start = opts.segment ? opts.segment.start : 0;
  const end = opts.segment ? opts.segment.end : rp.duration;
  let t = start;
  let playing = false;
  let speed = opts.segment ? 1 : 4;
  let last = 0;
  let raf = 0;

  const btn = h('button', { 'aria-label': 'Oýnat', html: ICON_PLAY });
  const range = h('input', { type: 'range', min: start, max: end, step: 0.1, value: start, 'aria-label': 'Wagt' });
  const label = h('span', { class: 'time' });
  const sp = h('select', { 'aria-label': 'Tizlik' },
    [1, 2, 4, 10].map((s) => h('option', { value: s, selected: s === speed }, `${s}×`)));
  const ctrl = h('div', { class: 'ctrl' }, btn, range, label, sp);
  const box = h('div', { class: 'player-box' }, cv, ctrl);

  const render = () => {
    rp.draw(t);
    range.value = t;
    label.textContent = `${fmtTime(t)} / ${fmtTime(end)}`;
  };
  const loop = (now) => {
    if (!playing) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    t += dt * speed;
    if (segEnd !== null && t >= segEnd) {
      if (opts.segment) t = start;
      else { t = segEnd; segEnd = null; setPlaying(false); }
    }
    if (t >= end) { t = end; setPlaying(false); }
    render();
    emit(t);
    raf = requestAnimationFrame(loop);
  };
  const setPlaying = (p) => {
    playing = p;
    btn.innerHTML = p ? ICON_PAUSE : ICON_PLAY;
    btn.setAttribute('aria-label', p ? 'Sakla' : 'Oýnat');
    if (p) { last = performance.now(); raf = requestAnimationFrame(loop); } else cancelAnimationFrame(raf);
  };
  btn.onclick = () => setPlaying(!playing);
  range.oninput = () => { t = Number(range.value); render(); emit(t); };
  sp.onchange = () => { speed = Number(sp.value); };
  if (opts.segment) segEnd = opts.segment.end;
  const ro = new ResizeObserver(() => render());
  ro.observe(cv);
  requestAnimationFrame(render);

  return {
    el: box,
    get time() { return t; },
    get duration() { return end; },
    seek(x) { t = Math.max(start, Math.min(end, x)); render(); emit(t); },
    play() { setPlaying(true); },
    pause() { setPlaying(false); },
    playSegment(a, b) { t = a; segEnd = b; speed = 1; sp.value = '1'; setPlaying(true); },
    onTime(cb) { listeners.add(cb); },
    setMe(n) { rp.meTrack = n; render(); },
    destroy() { setPlaying(false); ro.disconnect(); },
  };
}

/** «Pursady kes» paneli: başy/soňy häzirki wagtdan, ady, ýatda saklamak, paýlaşmak. */
export function createClipper(player, matchId) {
  let a = null;
  let b = null;
  const vA = h('div', { class: 'v' }, '—');
  const vB = h('div', { class: 'v' }, '—');
  const sel = h('div', { class: 'sel' });
  const head = h('div', { class: 'head' });
  const track = h('div', { class: 'clip-track' }, sel, head);
  const title = h('input', { type: 'text', maxlength: 80, placeholder: 'Mysal üçin: meniň jerime urgusyndan golum' });
  const err = h('div', { class: 'error-box', hidden: true });
  const shareBox = h('div');
  const saveBtn = h('button', { class: 'btn', disabled: true }, 'Klipi ýatda sakla');

  const nudge = (which, d) => {
    if (which === 'a' && a !== null) a = Math.max(0, a + d);
    if (which === 'b' && b !== null) b = Math.max(0, b + d);
    update();
  };
  const update = () => {
    vA.textContent = a === null ? '—' : fmtTime(a);
    vB.textContent = b === null ? '—' : fmtTime(b);
    const dur = player.duration || 1;
    if (a !== null && b !== null && b > a) {
      sel.style.left = `${(a / dur) * 100}%`;
      sel.style.width = `${((b - a) / dur) * 100}%`;
    } else sel.style.width = '0';
    const ok = a !== null && b !== null && b > a && b - a <= 120;
    saveBtn.disabled = !ok;
    err.hidden = !(a !== null && b !== null && (b <= a || b - a > 120));
    err.textContent = b !== null && a !== null && b <= a ? 'Soňy başyndan soň bolmaly.' : 'Klip 2 minutdan uzyn bolmaly däl. Başyny ýa-da soňuny süýşüriň.';
  };
  player.onTime((t) => { head.style.left = `${(t / (player.duration || 1)) * 100}%`; });

  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    try {
      const clip = await api('/api/clips', { method: 'POST', body: { match_id: matchId, start_s: a, end_s: b, title: title.value } });
      fill(shareBox, sharePanel(clip));
      toast('Klip ýatda saklandy');
    } catch (e) {
      err.hidden = false;
      err.textContent = e.message;
    } finally { saveBtn.disabled = false; }
  };

  return h('section', { class: 'clipper box', 'aria-label': 'Pursady kes' },
    h('h3', {}, 'Pursady kes'),
    h('p', { class: 'small muted' }, 'Ýazgyda pursady tapyň we başyny hem soňuny belläň. Klip hasaba alynmadyklarda-da salgy arkaly açylýar.'),
    track,
    h('div', { class: 'marks' },
      h('div', { class: 'mark' }, h('div', { class: 'k' }, 'Başy'), vA,
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn quiet small', onclick: () => { a = player.time; if (b === null || b <= a) b = Math.min(player.duration, a + 10); update(); } }, 'Şu ýerden'),
          h('button', { class: 'btn ghost small', 'aria-label': 'Başy bir sekunt öň', onclick: () => nudge('a', -1) }, '−1s'),
          h('button', { class: 'btn ghost small', 'aria-label': 'Başy bir sekunt soň', onclick: () => nudge('a', 1) }, '+1s'))),
      h('div', { class: 'mark' }, h('div', { class: 'k' }, 'Soňy'), vB,
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn quiet small', onclick: () => { b = player.time; if (a === null) a = Math.max(0, b - 10); update(); } }, 'Şu ýere çenli'),
          h('button', { class: 'btn ghost small', 'aria-label': 'Soňy bir sekunt öň', onclick: () => nudge('b', -1) }, '−1s'),
          h('button', { class: 'btn ghost small', 'aria-label': 'Soňy bir sekunt soň', onclick: () => nudge('b', 1) }, '+1s')))),
    err,
    h('div', { class: 'field' }, h('label', {}, 'Klipiň ady'), title),
    h('div', { class: 'btn-row' },
      saveBtn,
      h('button', { class: 'btn ghost', onclick: () => (a !== null && b > a ? player.playSegment(a, b) : toast('Ilki başyny we soňuny belläň')) }, 'Bölegi gör')),
    shareBox,
  );
}

export function sharePanel(clip) {
  const url = `${location.origin}/#/clip/${clip.id}`;
  const text = `${clip.title} — Akylly Meýdança`;
  const links = [
    ['WhatsApp', `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`],
    ['Telegram', `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`],
  ];
  return h('div', { class: 'share' },
    h('h3', {}, 'Klipi paýlaş'),
    h('div', { class: 'link' }, h('input', { value: url, readonly: true, 'aria-label': 'Klipiň salgysy', onclick: (e) => e.target.select() }),
      h('button', { class: 'btn quiet small', onclick: () => copyText(url) }, 'Göçür')),
    h('div', { class: 'btn-row' },
      navigator.share ? h('button', { class: 'btn small', onclick: () => navigator.share({ title: clip.title, text, url }).catch(() => {}) }, 'Ugrat…') : null,
      links.map(([n, href]) => h('a', { class: 'btn ghost small', href, target: '_blank', rel: 'noopener' }, n)),
      clip.can_download ? h('a', { class: 'btn ghost small', href: `/api/clips/${clip.id}/download` }, 'Ýükläp al (mp4)') : null,
    ));
}
