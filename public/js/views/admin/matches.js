// Oýunlar: sanaw, döretmek, üýtgetmek, wideo, derňew, oýunçylary baglamak, pozmak.
import {
  h, fill, A, table, pager, searchBox, select, field, modal, actionBtn, section, statusPill, dt, toLocalInput, STATUS,
} from './kit.js';
import { upload } from '../../api.js';
import { toast, avatar, trackName, ratingColor } from '../../ui.js';
import { go, routeQuery } from '../../app.js';

async function pitchOptions() {
  return (await A('/pitches')).map((p) => [p.id, `${p.name}${p.city ? `, ${p.city}` : ''}`]);
}

function matchForm(pitches, m = null) {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  return h('div', {},
    field('Meýdança', select(pitches, m?.pitch?.id, null, { name: 'pitch_id' })),
    h('div', { class: 'grid2' },
      field('Başlanýan wagty', h('input', { type: 'datetime-local', name: 'starts_at', value: toLocalInput(m?.starts_at || now), required: true })),
      field('Dowamlylygy, min', h('input', { type: 'number', name: 'duration_min', value: m?.duration_min ?? 60, min: 10, max: 180 })),
      field('A topar', h('input', { name: 'team_a_name', value: m?.teams.A.name ?? 'Aklar' })),
      field('A reňki', h('input', { type: 'color', name: 'team_a_color', value: m?.teams.A.color ?? '#E9ECF5' })),
      field('B topar', h('input', { name: 'team_b_name', value: m?.teams.B.name ?? 'Gyzyllar' })),
      field('B reňki', h('input', { type: 'color', name: 'team_b_color', value: m?.teams.B.color ?? '#C8232C' })),
      field('Toparda oýunçy', h('input', { type: 'number', name: 'players_per_side', value: m?.players_per_side ?? 6, min: 4, max: 11 }))));
}

const formBody = (form) => {
  const b = Object.fromEntries(new FormData(form));
  if (b.starts_at) b.starts_at = new Date(b.starts_at).toISOString();
  return b;
};

export async function matchesSection(root) {
  const qp = routeQuery();
  const state = { status: qp.get('status') || '', pitch: '', q: '', page: 1 };
  const pitches = await pitchOptions();
  const list = h('div');

  const load = async () => {
    const params = new URLSearchParams({ page: state.page });
    if (state.status) params.set('status', state.status);
    if (state.pitch) params.set('pitch', state.pitch);
    if (state.q) params.set('q', state.q);
    const d = await A(`/matches?${params}`);
    fill(list,
      table([
        { label: 'Kod', render: (m) => h('a', { href: `#/admin/match/${m.id}`, class: 'code' }, m.code) },
        { label: 'Oýun', render: (m) => h('span', {}, h('span', { class: 'dot', style: { background: m.teams.A.color } }), `${m.teams.A.name} — `, h('span', { class: 'dot', style: { background: m.teams.B.color } }), m.teams.B.name) },
        { label: 'Hasap', num: true, render: (m) => (m.teams.A.score ?? null) !== null ? `${m.teams.A.score}:${m.teams.B.score}` : '—' },
        { label: 'Wagty', render: (m) => dt(m.starts_at) },
        { label: 'Meýdança', render: (m) => m.pitch.name },
        { label: 'Ýagdaýy', render: (m) => statusPill(m.status) },
        { label: 'Wideo', render: (m) => (m.video_url ? 'bar' : '—') },
        { label: 'Açanlar', num: true, render: (m) => m.members },
        { label: 'Bellenen', num: true, render: (m) => `${m.claimed}/${m.tracks}` },
      ], d.rows, { empty: 'Oýun tapylmady', onRow: (m) => go(`/admin/match/${m.id}`) }),
      pager(d, (p) => { state.page = p; load(); }));
  };

  const createBtn = h('button', {
    class: 'btn',
    onclick: () => {
      if (!pitches.length) { toast('Ilki «Meýdançalar» bölüminde meýdança goşuň'); return; }
      modal('Täze oýun', matchForm(pitches), {
        okLabel: 'Oýun döret',
        onOk: async (form) => {
          const m = await A('/matches', { method: 'POST', body: formBody(form) });
          toast(`Oýun döredildi. Oýunçylar üçin kod: ${m.code}`);
          go(`/admin/match/${m.id}`);
        },
      });
    },
  }, '+ Täze oýun');

  fill(root,
    h('div', { class: 'atoolbar' },
      searchBox('', 'Kod ýa-da topar ady', (v) => { state.q = v; state.page = 1; load(); }),
      select([['', 'Ähli ýagdaýlar'], ...Object.entries(STATUS).map(([k, [l]]) => [k, l])], state.status, (v) => { state.status = v; state.page = 1; load(); }),
      select([['', 'Ähli meýdançalar'], ...pitches], '', (v) => { state.pitch = v; state.page = 1; load(); }),
      h('span', { class: 'grow' }),
      createBtn),
    list);
  await load();
}

export async function matchSection(root, id) {
  const pitches = await pitchOptions();
  let m = await A(`/matches/${id}`);

  const render = () => {
    // --- Esasy maglumatlar ---
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const b = formBody(form);
        b.score_a = form.score_a.value;
        b.score_b = form.score_b.value;
        try { m = await A(`/matches/${id}`, { method: 'PUT', body: b }); toast('Ýatda saklandy'); render(); } catch (ex) { toast(ex.message); }
      },
    },
    matchForm(pitches, m),
    h('div', { class: 'grid2' },
      field(`Hasap: ${m.teams.A.name}`, h('input', { type: 'number', name: 'score_a', min: 0, value: m.teams.A.score ?? '' })),
      field(`Hasap: ${m.teams.B.name}`, h('input', { type: 'number', name: 'score_b', min: 0, value: m.teams.B.score ?? '' }))),
    h('button', { class: 'btn', type: 'submit' }, 'Üýtgetmeleri ýatda sakla'));

    // --- Wideo ---
    const prog = h('span', { class: 'small muted' });
    const videoIn = h('input', {
      type: 'file', accept: 'video/*', hidden: true,
      onchange: async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        const fd = new FormData();
        fd.append('video', f);
        try {
          m = await upload(`/api/admin/matches/${id}/video`, fd, { admin: true, onProgress: (p) => { prog.textContent = `Ýüklenýär ${Math.round(p * 100)}%`; } });
          toast('Wideo ýüklendi');
          render();
        } catch (ex) { toast(ex.message); prog.textContent = ''; }
      },
    });
    const jsonIn = h('input', {
      type: 'file', accept: 'application/json,.json', hidden: true,
      onchange: async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          const body = JSON.parse(await f.text());
          const r = await A(`/matches/${id}/result`, { method: 'POST', body });
          toast(`Derňew ýüklendi: ${r.events} waka`);
          m = await A(`/matches/${id}`);
          render();
        } catch (ex) { toast(ex instanceof SyntaxError ? 'JSON faýly nädogry' : ex.message); }
      },
    });
    const analyze = (mode) => actionBtn(mode === 'ai' ? 'AI derňewi' : 'Demo derňew', async () => {
      const r = await A(`/matches/${id}/analyze`, { method: 'POST', body: { mode } });
      toast(r.message || `Taýýar: ${r.events} waka, hasap ${r.score.join(':')}`);
      m = await A(`/matches/${id}`);
      render();
    }, { cls: mode === 'ai' ? 'btn small' : 'btn ghost small' });

    // --- Trekler (AI tapan oýunçylar) ---
    const playerChoice = (t) => {
      const opts = [['', '— boş —'], ...m.members.map((p) => [p.id, p.name])];
      if (t.player && !m.members.some((p) => p.id === t.player.id)) opts.push([t.player.id, t.player.name]);
      opts.push(['other', 'ID boýunça…']);
      return select(opts, t.player?.id ?? '', async (v) => {
        let pid = v;
        if (v === 'other') {
          pid = prompt('Oýunçynyň ID-si («Oýunçylar» bölüminde görkezilýär):');
          if (!pid) { render(); return; }
        }
        try { m = await A(`/matches/${id}/tracks/${t.track_no}`, { method: 'PUT', body: { player_id: pid || null } }); toast('Baglanyşyk üýtgedildi'); render(); } catch (ex) { toast(ex.message); render(); }
      });
    };
    const tracks = table([
      { label: '№', num: true, render: (t) => t.track_no },
      { label: 'Topar', render: (t) => h('span', {}, h('span', { class: 'dot', style: { background: m.teams[t.team].color } }), m.teams[t.team].name) },
      { label: 'Belgi', num: true, render: (t) => t.jersey ?? '—' },
      { label: 'Baha', num: true, render: (t) => h('span', { class: 'rating-chip', style: { background: ratingColor(t.rating) } }, t.rating.toFixed(1)) },
      { label: 'Gol', num: true, render: (t) => t.goals },
      { label: 'Pas', num: true, render: (t) => `${t.passes_completed}/${t.passes}` },
      { label: 'Oýunçy', render: playerChoice },
    ], m.tracks, { empty: 'Trekler entek ýok — oýny derňäň (AI ýa-da demo).' });

    // --- Açan oýunçylar ---
    const members = table([
      { label: '', render: (p) => avatar(p, { size: 30 }) },
      { label: 'Ady', render: (p) => h('a', { href: `#/admin/player/${p.id}` }, p.name) },
      { label: 'Telefon', render: (p) => p.phone },
      { label: 'Açdy', render: (p) => dt(p.joined_at) },
      { label: '', render: (p) => actionBtn('Aýyr', async () => { m = await A(`/matches/${id}/members/${p.id}`, { method: 'DELETE' }); render(); }, { confirmText: `${p.name} bu oýundan aýrylsynmy?` }) },
    ], m.members, { empty: 'Entek hiç kim bu oýny kod bilen açmady.' });

    fill(root,
      h('div', { class: 'adetail-head' },
        h('div', {},
          h('a', { href: '#/admin/matches', class: 'small' }, '← Oýunlar'),
          h('h2', {}, h('span', { class: 'code big' }, m.code), ' ', statusPill(m.status)),
          h('div', { class: 'muted' }, `${m.teams.A.name} ${m.teams.A.score ?? ''}:${m.teams.B.score ?? ''} ${m.teams.B.name} · ${m.pitch.name} · ${dt(m.starts_at)}`)),
        h('div', { class: 'btn-row' },
          h('a', { class: 'btn ghost small', href: `#/match/${m.id}`, target: '_blank' }, 'Oýunçy görnüşi'),
          actionBtn('Oýny poz', async () => { await A(`/matches/${id}`, { method: 'DELETE' }); toast('Oýun pozuldy'); go('/admin/matches'); },
            { cls: 'btn danger small', confirmText: `${m.code} oýny wideosy, statistikasy we klipleri bilen pozulsynmy? Yzyna gaýtaryp bolmaýar.` }))),
      m.error ? h('div', { class: 'error-box' }, `AI ýalňyşlygy: ${m.error}`) : null,
      h('div', { class: 'agrid2' },
        section('Maglumatlar', form),
        h('div', {},
          section('Wideo',
            h('p', { class: 'small muted' }, m.has_video ? 'Wideo ýüklenen.' : 'Wideo entek ýok.'),
            m.video_url ? h('video', { src: m.video_url, controls: true, preload: 'metadata', class: 'avideo' }) : null,
            h('div', { class: 'btn-row' },
              h('label', { class: 'btn quiet small' }, videoIn, m.has_video ? 'Wideony çalyş' : 'Wideo ýükle'),
              m.has_video ? actionBtn('Wideony poz', async () => { m = await A(`/matches/${id}/video`, { method: 'DELETE' }); render(); }, { confirmText: 'Wideo pozulsynmy? Statistika galar.' }) : null,
              prog)),
          section('Derňew',
            h('p', { class: 'small muted' }, '«AI derňewi» oýny nobata goýýar — ony wideokartly kompýuterdäki AI-işçi alar. «Demo derňew» — wideosyz synag maglumatlary. JSON — ai/analyze.py netijesini el bilen ýüklemek.'),
            h('div', { class: 'btn-row' },
              m.has_video ? analyze('ai') : null,
              analyze('demo'),
              h('label', { class: 'btn ghost small' }, jsonIn, 'JSON ýükle')),
            m.analysis_source ? h('p', { class: 'small muted', style: { marginTop: '8px' } }, `Çeşme: ${m.analysis_source}`) : null))),
      section(`AI tapan oýunçylar (${m.tracks.length})`, h('p', { class: 'small muted' }, 'Oýunçy özüni saýlap bilmese, şu ýerde el bilen baglaň.'), tracks),
      section(`Oýny açan oýunçylar (${m.members.length})`,
        members,
        h('div', { class: 'btn-row', style: { marginTop: '10px' } },
          actionBtn('Oýunçy goş (ID)', async () => {
            const pid = prompt('Oýunçynyň ID-si:');
            if (!pid) return;
            m = await A(`/matches/${id}/members`, { method: 'POST', body: { player_id: Number(pid) } });
            render();
          }))),
    );
  };
  render();
}
