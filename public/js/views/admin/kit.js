// Panel üçin umumy bölekler: tablisa, sahypalama, gözleg, penjire (modal), status.
import { h, fill, fmtDate, toast } from '../../ui.js';
import { api } from '../../api.js';

/** /api/admin/... soragy administratoryň tokeni bilen. */
export const A = (path, opts = {}) => api(`/api/admin${path}`, { ...opts, admin: true });

export const STATUS = {
  scheduled: ['Wideo garaşylýar', ''],
  uploaded: ['Wideo ýüklendi', 'blue'],
  queued: ['AI nobatynda', 'gold'],
  processing: ['AI derňeýär', 'gold'],
  ready: ['Taýýar', 'green'],
  failed: ['Ýalňyşlyk', 'red'],
};
export const statusPill = (s) => h('span', { class: `pill ${STATUS[s]?.[1] || ''}` }, STATUS[s]?.[0] || s);

export const dt = (v) => (v ? fmtDate(v) : '—');

/** cols: [{ label, render(row) → Node|string, num? }] */
export function table(cols, rows, { empty = 'Hiç zat tapylmady', onRow } = {}) {
  if (!rows.length) return h('div', { class: 'empty' }, empty);
  return h('div', { class: 'atable-wrap' }, h('table', { class: 'atable' },
    h('thead', {}, h('tr', {}, cols.map((c) => h('th', { class: c.num ? 'num' : '' }, c.label)))),
    h('tbody', {}, rows.map((r) => h('tr', { class: onRow ? 'click' : '', onclick: onRow ? (e) => { if (!e.target.closest('a,button,select,input')) onRow(r); } : null },
      cols.map((c) => h('td', { class: c.num ? 'num' : '' }, c.render(r))))))));
}

export function pager(data, onPage) {
  if (data.pages <= 1) return h('p', { class: 'small muted', style: { marginTop: '10px' } }, `Jemi: ${data.total}`);
  return h('div', { class: 'pager' },
    h('button', { class: 'btn ghost small', disabled: data.page <= 1, onclick: () => onPage(data.page - 1) }, '← Öňki'),
    h('span', { class: 'small muted' }, `${data.page} / ${data.pages} sahypa · jemi ${data.total}`),
    h('button', { class: 'btn ghost small', disabled: data.page >= data.pages, onclick: () => onPage(data.page + 1) }, 'Indiki →'));
}

export function searchBox(value, placeholder, onSearch) {
  let t;
  return h('input', {
    class: 'search', type: 'search', value: value || '', placeholder, 'aria-label': placeholder,
    oninput: (e) => { clearTimeout(t); t = setTimeout(() => onSearch(e.target.value.trim()), 300); },
  });
}

export function select(options, value, onChange, attrs = {}) {
  return h('select', { ...attrs, onchange: onChange ? (e) => onChange(e.target.value) : null },
    options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value ?? '') }, l)));
}

export const field = (label, input, hint) => h('div', { class: 'field' }, h('label', {}, label), input, hint ? h('span', { class: 'small muted' }, hint) : null);

export function kpi(label, value, sub) {
  return h('div', { class: 'kpi' }, h('div', { class: 'k' }, label), h('div', { class: 'v' }, value), sub ? h('div', { class: 'sub' }, sub) : null);
}

/** Penjire: body — form ýa-da islendik element. onOk(form) → true bolsa ýapylýar. */
export function modal(title, body, { okLabel = 'Ýatda sakla', onOk, danger = false } = {}) {
  const err = h('div', { class: 'error-box', hidden: true });
  const ok = h('button', { class: `btn${danger ? ' danger-solid' : ''}`, type: 'submit' }, okLabel);
  const dlg = h('dialog', { class: 'amodal' });
  const form = h('form', {
    method: 'dialog',
    onsubmit: async (e) => {
      e.preventDefault();
      if (!onOk) { dlg.close(); return; }
      ok.disabled = true;
      err.hidden = true;
      try {
        const r = await onOk(form);
        if (r !== false) dlg.close();
      } catch (ex) { err.textContent = ex.message; err.hidden = false; } finally { ok.disabled = false; }
    },
  },
  h('div', { class: 'amodal-head' }, h('h3', {}, title), h('button', { type: 'button', class: 'x', 'aria-label': 'Ýap', onclick: () => dlg.close() }, '×')),
  h('div', { class: 'amodal-body' }, body, err),
  h('div', { class: 'amodal-foot' }, h('button', { type: 'button', class: 'btn ghost', onclick: () => dlg.close() }, 'Ýatyr'), onOk ? ok : null));
  dlg.append(form);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

/** Düwme: basylanda async iş, ýalňyşlyk bolsa toast. */
export function actionBtn(label, fn, { cls = 'btn ghost small', confirmText } = {}) {
  return h('button', {
    class: cls, type: 'button',
    onclick: async (e) => {
      if (confirmText && !confirm(confirmText)) return;
      const b = e.currentTarget;
      b.disabled = true;
      try { await fn(); } catch (ex) { toast(ex.message); } finally { b.disabled = false; }
    },
  }, label);
}

export function section(title, ...children) {
  return h('section', { class: 'asec' }, title ? h('h3', {}, title) : null, ...children);
}

export const toLocalInput = (iso) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export const fmtSize = (bytes) => (bytes > 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`);

export { h, fill };
