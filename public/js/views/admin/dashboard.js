// Umumy: esasy sanlar, AI nobaty, täze oýunçylar, soňky hereketler.
import { h, fill, A, kpi, section, table, statusPill, dt, fmtSize, STATUS } from './kit.js';
import { avatar } from '../../ui.js';
import { ACTIONS } from './other.js';

export async function dashboardSection(root) {
  const d = await A('/dashboard');
  const c = d.counts;
  fill(root,
    h('div', { class: 'kpis' },
      kpi('Oýunçylar', c.players, `+${c.players_week} şu hepde`),
      kpi('Oýunlar', c.matches, `${c.matches_week} şu hepde`),
      kpi('Klipler', c.clips, `${c.clip_views} gezek görüldi`),
      kpi('Meýdançalar', c.pitches),
      kpi('Özüni bellänler', c.claimed, 'oýunçy–oýun baglanyşygy'),
      kpi('Petiklenen', c.players_blocked, 'oýunçy')),
    section('Oýunlaryň ýagdaýy',
      h('div', { class: 'chips' }, Object.entries(STATUS).map(([k]) => h('a', { class: 'stat-chip', href: `#/admin/matches?status=${k}` }, statusPill(k), h('b', {}, d.by_status[k] || 0))))),
    h('div', { class: 'agrid2' },
      section('AI nobaty we ýalňyşlyklar',
        table([
          { label: 'Kod', render: (m) => h('a', { href: `#/admin/match/${m.id}` }, m.code) },
          { label: 'Oýun', render: (m) => `${m.teams.A.name} — ${m.teams.B.name}` },
          { label: 'Ýagdaýy', render: (m) => statusPill(m.status) },
          { label: 'Wagty', render: (m) => dt(m.starts_at) },
        ], d.queue, { empty: 'Nobat boş — ähli oýunlar derňeldi.' })),
      section('Täze oýunçylar',
        table([
          { label: '', render: (p) => avatar(p, { size: 32 }) },
          { label: 'Ady', render: (p) => h('a', { href: `#/admin/player/${p.id}` }, p.name) },
          { label: 'Hasaba alyndy', render: (p) => dt(p.created_at) },
        ], d.recent_players, { empty: 'Entek hakyky oýunçy ýok.' }))),
    h('div', { class: 'agrid2' },
      section('Disk',
        h('div', { class: 'kpis small' },
          kpi('Wideolar', fmtSize(d.storage.videos.total), `${d.storage.videos.files} faýl`),
          kpi('Suratlar', fmtSize(d.storage.photos.total), `${d.storage.photos.files} faýl`),
          kpi('Derňew maglumatlary', fmtSize(d.storage.analysis.total), `${d.storage.analysis.files} faýl`))),
      section('Soňky hereketler',
        table([
          { label: 'Wagty', render: (r) => dt(r.created_at) },
          { label: 'Kim', render: (r) => r.admin_name },
          { label: 'Näme etdi', render: (r) => `${ACTIONS[r.action] || r.action}${r.target ? ` · ${r.target}` : ''}` },
        ], d.recent_log, { empty: 'Entek hereket ýok.' }),
        h('a', { class: 'small', href: '#/admin/log' }, 'Doly žurnal'))),
  );
}
