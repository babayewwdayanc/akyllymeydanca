// Oýunçylar: gözleg, maglumatlary üýtgetmek, PIN, petiklemek, surat, pozmak.
import {
  h, fill, A, table, pager, searchBox, select, field, actionBtn, section, statusPill, dt,
} from './kit.js';
import { toast, avatar, POS, FOOT, fmtTime, ratingColor } from '../../ui.js';
import { renderCard } from '../../card.js';
import { go } from '../../app.js';

export async function playersSection(root) {
  const state = { q: '', filter: 'real', sort: 'new', page: 1 };
  const list = h('div');
  const load = async () => {
    const params = new URLSearchParams({ page: state.page, sort: state.sort });
    if (state.q) params.set('q', state.q);
    if (state.filter) params.set('filter', state.filter);
    const d = await A(`/players?${params}`);
    fill(list,
      table([
        { label: 'ID', num: true, render: (p) => p.id },
        { label: '', render: (p) => avatar(p, { size: 34 }) },
        { label: 'Ady', render: (p) => h('a', { href: `#/admin/player/${p.id}` }, p.name) },
        { label: 'Telefon', render: (p) => p.phone },
        { label: 'Pozisiýa', render: (p) => POS[p.position] },
        { label: 'Reýting', num: true, render: (p) => p.ovr },
        { label: 'Oýun', num: true, render: (p) => p.matches },
        { label: 'Gol', num: true, render: (p) => p.goals },
        { label: 'Hasaba alyndy', render: (p) => dt(p.created_at) },
        { label: 'Soňky giriş', render: (p) => dt(p.last_login_at) },
        { label: '', render: (p) => (p.blocked ? h('span', { class: 'pill red' }, 'petiklenen') : p.is_demo ? h('span', { class: 'pill' }, 'demo') : '') },
      ], d.rows, { empty: 'Oýunçy tapylmady', onRow: (p) => go(`/admin/player/${p.id}`) }),
      pager(d, (p) => { state.page = p; load(); }));
  };
  fill(root,
    h('div', { class: 'atoolbar' },
      searchBox('', 'Ady, familiýasy ýa-da telefon', (v) => { state.q = v; state.page = 1; load(); }),
      select([['real', 'Hakyky oýunçylar'], ['', 'Hemmesi'], ['blocked', 'Petiklenenler'], ['demo', 'Demo']], state.filter, (v) => { state.filter = v; state.page = 1; load(); }),
      select([['new', 'Täzeler öňde'], ['name', 'Ady boýunça'], ['login', 'Soňky giriş']], state.sort, (v) => { state.sort = v; load(); })),
    list);
  await load();
}

export async function playerSection(root, id) {
  let p = await A(`/players/${id}`);
  const render = () => {
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        try { p = await A(`/players/${id}`, { method: 'PUT', body: Object.fromEntries(new FormData(form)) }); toast('Ýatda saklandy'); render(); } catch (ex) { toast(ex.message); }
      },
    },
    h('div', { class: 'grid2' },
      field('Ady', h('input', { name: 'first_name', value: p.first_name, required: true })),
      field('Familiýasy', h('input', { name: 'last_name', value: p.last_name, required: true })),
      field('Telefon', h('input', { name: 'phone', value: p.phone, required: true })),
      field('Pozisiýa', select(Object.entries(POS), p.position, null, { name: 'position' })),
      field('Boýy, sm', h('input', { type: 'number', name: 'height_cm', value: p.height_cm })),
      field('Agramy, kg', h('input', { type: 'number', name: 'weight_kg', value: p.weight_kg })),
      field('Esasy aýak', select(Object.entries(FOOT), p.foot, null, { name: 'foot' }))),
    h('button', { class: 'btn', type: 'submit' }, 'Üýtgetmeleri ýatda sakla'));

    const pinIn = h('input', { type: 'text', inputmode: 'numeric', maxlength: 6, placeholder: 'Täze PIN (4–6 san)' });
    const t = p.totals;
    fill(root,
      h('div', { class: 'adetail-head' },
        h('div', {},
          h('a', { href: '#/admin/players', class: 'small' }, '← Oýunçylar'),
          h('h2', {}, `${p.first_name} ${p.last_name} `, p.blocked ? h('span', { class: 'pill red' }, 'petiklenen') : null, p.is_demo ? h('span', { class: 'pill' }, 'demo') : null),
          h('div', { class: 'muted' }, `ID ${p.id} · ${p.phone} · hasaba alyndy ${dt(p.created_at)} · soňky giriş ${dt(p.last_login_at)} · açyk sessiýa: ${p.sessions}`)),
        h('div', { class: 'btn-row' },
          h('a', { class: 'btn ghost small', href: `#/player/${p.id}`, target: '_blank' }, 'Köpçülik sahypasy'),
          actionBtn(p.blocked ? 'Petigi aç' : 'Petikle', async () => { p = await A(`/players/${id}/block`, { method: 'POST', body: { blocked: !p.blocked } }); toast(p.blocked ? 'Oýunçy petiklendi' : 'Petik açyldy'); render(); },
            { cls: p.blocked ? 'btn quiet small' : 'btn danger small', confirmText: p.blocked ? null : 'Oýunçy petiklensinmi? Ol hasabyna girip bilmez we reýtingde görünmez.' }),
          actionBtn('Oýunçyny poz', async () => { await A(`/players/${id}`, { method: 'DELETE' }); toast('Oýunçy pozuldy'); go('/admin/players'); },
            { cls: 'btn danger small', confirmText: `${p.first_name} ${p.last_name} doly pozulsynmy? Suraty, klipleri we sesleri pozular, oýunlardaky statistikasy hiç kime degişli bolmaz. Yzyna gaýtaryp bolmaýar.` }))),
      h('div', { class: 'agrid-card' },
        h('div', { class: 'card-col' },
          renderCard(p, { size: '' }),
          h('div', { class: 'btn-row', style: { justifyContent: 'center' } },
            p.photo_url && !p.photo_cutout ? actionBtn('Fony aýyr', async () => { p = await A(`/players/${id}/photo/cutout`, { method: 'POST' }); toast('Fon aýryldy'); render(); }, { cls: 'btn quiet small' }) : null,
            p.photo_url ? actionBtn('Suraty poz', async () => { p = await A(`/players/${id}/photo`, { method: 'DELETE' }); render(); }, { confirmText: 'Surat pozulsynmy? (Mysal üçin, ýerliksiz surat bolsa.)' }) : null)),
        h('div', {},
          section('Maglumatlar', form),
          section('PIN-kody täzele',
            h('p', { class: 'small muted' }, 'Oýunçy PIN-kody ýatdan çykaran bolsa. Täze PIN-i oýunça aýdyň — onuň ähli açyk sessiýalary ýapylar.'),
            h('div', { class: 'inline-form' }, pinIn,
              actionBtn('PIN goý', async () => { p = await A(`/players/${id}/pin`, { method: 'POST', body: { pin: pinIn.value } }); toast('PIN täzelendi'); render(); }, { cls: 'btn small' }))))),
      section('Statistika',
        h('div', { class: 'kpis small' },
          ...[['Oýun', t.matches], ['Gol', t.goals], ['Gol pasy', t.assists], ['MVP', t.mvp], ['Orta baha', t.avg_rating ?? '—'], ['Pas takyklygy', t.pass_accuracy !== null ? `${t.pass_accuracy}%` : '—'], ['Iň ýokary tizlik', t.top_speed_kmh || '—'], ['Ylgan, km', t.distance_km]]
            .map(([k, v]) => h('div', { class: 'kpi' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v))))),
      section('Oýunlar',
        table([
          { label: 'Wagty', render: (r) => dt(r.starts_at) },
          { label: 'Oýun', render: (r) => h('a', { href: `#/admin/match/${r.match_id}` }, `${r.my_team} — ${r.opponent}`) },
          { label: 'Hasap', num: true, render: (r) => r.score },
          { label: 'Baha', num: true, render: (r) => h('span', { class: 'rating-chip', style: { background: ratingColor(r.rating) } }, r.rating.toFixed(1)) },
          { label: 'Gol', num: true, render: (r) => r.goals },
          { label: '', render: (r) => (r.mvp ? h('span', { class: 'pill gold' }, 'MVP') : '') },
        ], p.history, { empty: 'Entek özüni bellän oýny ýok.' }),
        p.memberships.length > p.history.length ? h('p', { class: 'small muted', style: { marginTop: '8px' } }, `Kod bilen açan oýunlary: ${p.memberships.map((m) => m.code).join(', ')}`) : null),
      section(`Klipler (${p.clips.length})`,
        table([
          { label: 'Ady', render: (c) => h('a', { href: `#/clip/${c.id}`, target: '_blank' }, c.title) },
          { label: 'Oýun', render: (c) => c.code },
          { label: 'Bölek', render: (c) => `${fmtTime(c.start_s)}–${fmtTime(c.end_s)}` },
          { label: 'Görüldi', num: true, render: (c) => c.views },
          { label: '', render: (c) => actionBtn('Poz', async () => { await A(`/clips/${c.id}`, { method: 'DELETE' }); p = await A(`/players/${id}`); render(); }, { confirmText: 'Klip pozulsynmy?' }) },
        ], p.clips, { empty: 'Klip ýok.' })),
    );
  };
  render();
  void statusPill;
}
