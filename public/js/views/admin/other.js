// Meýdançalar, klipler, administratorlar, žurnal we öz hasabyň.
import {
  h, fill, A, table, pager, searchBox, select, field, modal, actionBtn, section, dt,
} from './kit.js';
import { session } from '../../api.js';
import { toast, fmtTime } from '../../ui.js';

export const ACTIONS = {
  login: 'Panele girdi',
  'admin.password': 'Parolyny çalyşdy',
  'admin.create': 'Administrator döretdi',
  'admin.update': 'Administratory üýtgetdi',
  'admin.delete': 'Administratory pozdy',
  'pitch.create': 'Meýdança goşdy',
  'pitch.update': 'Meýdançany üýtgetdi',
  'pitch.delete': 'Meýdançany pozdy',
  'match.create': 'Oýun döretdi',
  'match.update': 'Oýny üýtgetdi',
  'match.video': 'Wideo ýükledi',
  'match.video.delete': 'Wideony pozdy',
  'match.analyze.ai': 'AI derňewine goýdy',
  'match.analyze.demo': 'Demo derňew etdi',
  'match.result': 'Derňew JSON ýükledi',
  'match.track': 'Oýunçyny trege baglady',
  'match.member.add': 'Oýna oýunçy goşdy',
  'match.member.remove': 'Oýundan oýunçy aýyrdy',
  'match.delete': 'Oýny pozdy',
  'player.update': 'Oýunçyny üýtgetdi',
  'player.pin': 'PIN-kody täzeledi',
  'player.block': 'Oýunçyny petikledi',
  'player.unblock': 'Petigi açdy',
  'player.photo.cutout': 'Suratyň fonuny aýyrdy',
  'player.photo.delete': 'Suraty pozdy',
  'player.delete': 'Oýunçyny pozdy',
  'clip.delete': 'Klipi pozdy',
};

// ---------- Meýdançalar ----------
function pitchForm(p = null) {
  return h('div', {},
    field('Ady', h('input', { name: 'name', value: p?.name ?? '', required: true })),
    h('div', { class: 'grid2' },
      field('Şäher', h('input', { name: 'city', value: p?.city ?? '' })),
      field('Salgysy', h('input', { name: 'address', value: p?.address ?? '' })),
      field('Uzynlygy, m', h('input', { type: 'number', name: 'length_m', value: p?.length_m ?? 40, step: '0.5' })),
      field('Ini, m', h('input', { type: 'number', name: 'width_m', value: p?.width_m ?? 20, step: '0.5' }))),
    field('Kamerany kalibrlemek (JSON)', h('textarea', { name: 'calibration', rows: 4, placeholder: 'ai/calibrate.py netijesi: {"image_points": [[x,y],…], …}' }, p?.calibration ? JSON.stringify(p.calibration) : ''),
      'AI derňewi üçin gerek. Kamerany goýandan soň bir gezek edilýär.'));
}

export async function pitchesSection(root) {
  const load = async () => {
    const rows = await A('/pitches');
    fill(root,
      h('div', { class: 'atoolbar' }, h('span', { class: 'grow' }),
        h('button', {
          class: 'btn',
          onclick: () => modal('Täze meýdança', pitchForm(), {
            okLabel: 'Goş',
            onOk: async (form) => { await A('/pitches', { method: 'POST', body: Object.fromEntries(new FormData(form)) }); toast('Meýdança goşuldy'); load(); },
          }),
        }, '+ Täze meýdança')),
      table([
        { label: 'ID', num: true, render: (p) => p.id },
        { label: 'Ady', render: (p) => h('b', {}, p.name) },
        { label: 'Şäher', render: (p) => p.city || '—' },
        { label: 'Salgysy', render: (p) => p.address || '—' },
        { label: 'Ölçegi', render: (p) => `${p.length_m}×${p.width_m} m` },
        { label: 'Kalibrlemek', render: (p) => (p.calibration ? h('span', { class: 'pill green' }, 'bar') : h('span', { class: 'pill' }, 'ýok')) },
        { label: 'Oýun', num: true, render: (p) => h('a', { href: `#/admin/matches` }, p.matches) },
        {
          label: '',
          render: (p) => h('div', { class: 'btn-row' },
            h('button', {
              class: 'btn ghost small',
              onclick: () => modal(`Meýdança: ${p.name}`, pitchForm(p), {
                onOk: async (form) => { await A(`/pitches/${p.id}`, { method: 'PUT', body: Object.fromEntries(new FormData(form)) }); toast('Ýatda saklandy'); load(); },
              }),
            }, 'Üýtget'),
            actionBtn('Poz', async () => { await A(`/pitches/${p.id}`, { method: 'DELETE' }); toast('Meýdança pozuldy'); load(); }, { confirmText: `${p.name} pozulsynmy?` })),
        },
      ], rows, { empty: 'Entek meýdança ýok — birinjisini goşuň.' }));
  };
  await load();
}

// ---------- Klipler ----------
export async function clipsSection(root) {
  const state = { q: '', page: 1 };
  const list = h('div');
  const load = async () => {
    const params = new URLSearchParams({ page: state.page });
    if (state.q) params.set('q', state.q);
    const d = await A(`/clips?${params}`);
    fill(list,
      table([
        { label: 'Ady', render: (c) => h('a', { href: `#/clip/${c.id}`, target: '_blank' }, c.title) },
        { label: 'Awtory', render: (c) => (c.author ? h('a', { href: `#/admin/player/${c.author.id}` }, c.author.name) : '—') },
        { label: 'Oýun', render: (c) => h('a', { href: `#/admin/match/${c.match.id}` }, `${c.match.code} · ${c.match.teams}`) },
        { label: 'Bölek', render: (c) => `${fmtTime(c.start_s)}–${fmtTime(c.end_s)}` },
        { label: 'Görüldi', num: true, render: (c) => c.views },
        { label: 'Döredildi', render: (c) => dt(c.created_at) },
        { label: '', render: (c) => actionBtn('Poz', async () => { await A(`/clips/${c.id}`, { method: 'DELETE' }); toast('Klip pozuldy'); load(); }, { confirmText: `«${c.title}» klipi pozulsynmy?` }) },
      ], d.rows, { empty: 'Klip ýok' }),
      pager(d, (p) => { state.page = p; load(); }));
  };
  fill(root, h('div', { class: 'atoolbar' }, searchBox('', 'Klipiň ady ýa-da oýun kody', (v) => { state.q = v; state.page = 1; load(); })), list);
  await load();
}

// ---------- Administratorlar ----------
export async function adminsSection(root) {
  const load = async () => {
    const rows = await A('/admins');
    fill(root,
      h('div', { class: 'atoolbar' },
        h('p', { class: 'small muted', style: { margin: 0 } }, 'Eýesi (owner) — hemme zat, şol sanda administratorlar. Menejer — meýdançalar, oýunlar, oýunçylar we klipler.'),
        h('span', { class: 'grow' }),
        h('button', {
          class: 'btn',
          onclick: () => modal('Täze administrator', h('div', {},
            field('Login', h('input', { name: 'username', required: true, autocapitalize: 'none', placeholder: 'mysal: merdan' })),
            field('Parol', h('input', { name: 'password', type: 'password', required: true, minlength: 8, autocomplete: 'new-password' }), 'Azyndan 8 nyşan'),
            field('Roly', select([['manager', 'Menejer'], ['owner', 'Eýesi (owner)']], 'manager', null, { name: 'role' }))), {
            okLabel: 'Döret',
            onOk: async (form) => { await A('/admins', { method: 'POST', body: Object.fromEntries(new FormData(form)) }); toast('Administrator döredildi'); load(); },
          }),
        }, '+ Täze administrator')),
      table([
        { label: 'Login', render: (a) => h('b', {}, a.username, a.id === session.admin?.id ? ' (siz)' : '') },
        { label: 'Roly', render: (a) => select([['manager', 'Menejer'], ['owner', 'Eýesi']], a.role, async (v) => { try { await A(`/admins/${a.id}`, { method: 'PUT', body: { role: v } }); toast('Roly üýtgedildi'); } catch (ex) { toast(ex.message); } load(); }) },
        { label: 'Ýagdaýy', render: (a) => (a.active ? h('span', { class: 'pill green' }, 'işjeň') : h('span', { class: 'pill red' }, 'öçürilen')) },
        { label: 'Soňky giriş', render: (a) => dt(a.last_login_at) },
        {
          label: '',
          render: (a) => h('div', { class: 'btn-row' },
            actionBtn(a.active ? 'Öçür' : 'Işjeňleşdir', async () => { await A(`/admins/${a.id}`, { method: 'PUT', body: { active: !a.active } }); load(); }),
            actionBtn('Parol', async () => {
              const pw = prompt(`${a.username} üçin täze parol (azyndan 8 nyşan):`);
              if (!pw) return;
              await A(`/admins/${a.id}`, { method: 'PUT', body: { password: pw } });
              toast('Parol çalşyldy');
            }),
            a.id !== session.admin?.id ? actionBtn('Poz', async () => { await A(`/admins/${a.id}`, { method: 'DELETE' }); load(); }, { cls: 'btn danger small', confirmText: `${a.username} pozulsynmy?` }) : null),
        },
      ], rows));
  };
  await load();
}

// ---------- Žurnal ----------
export async function logSection(root) {
  const state = { page: 1 };
  const load = async () => {
    const d = await A(`/log?page=${state.page}`);
    fill(root,
      table([
        { label: 'Wagty', render: (r) => dt(r.created_at) },
        { label: 'Kim', render: (r) => h('b', {}, r.admin_name) },
        { label: 'Näme etdi', render: (r) => ACTIONS[r.action] || r.action },
        { label: 'Nämäni', render: (r) => r.target || '—' },
        { label: 'Jikme-jiklik', render: (r) => (r.details ? h('code', { class: 'small' }, JSON.stringify(r.details).slice(0, 120)) : '') },
      ], d.rows, { empty: 'Žurnal boş' }),
      pager(d, (p) => { state.page = p; load(); }));
  };
  await load();
}

// ---------- Öz hasabyň ----------
export async function accountSection(root) {
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      if (fd.get('next') !== fd.get('repeat')) { toast('Täze parollar gabat gelmeýär'); return; }
      try {
        await A('/me/password', { method: 'POST', body: { current: fd.get('current'), next: fd.get('next') } });
        toast('Parol çalşyldy');
        form.reset();
      } catch (ex) { toast(ex.message); }
    },
  },
  field('Häzirki parol', h('input', { type: 'password', name: 'current', required: true, autocomplete: 'current-password' })),
  field('Täze parol', h('input', { type: 'password', name: 'next', required: true, minlength: 8, autocomplete: 'new-password' }), 'Azyndan 8 nyşan'),
  field('Täze paroly gaýtala', h('input', { type: 'password', name: 'repeat', required: true, minlength: 8, autocomplete: 'new-password' })),
  h('button', { class: 'btn', type: 'submit' }, 'Paroly çalyş'));
  fill(root, h('div', { style: { maxWidth: '440px' } },
    section(`Hasap: ${session.admin.username}`, h('p', { class: 'small muted' }, `Roly: ${session.admin.role === 'owner' ? 'eýesi (owner)' : 'menejer'}`), form)));
}
