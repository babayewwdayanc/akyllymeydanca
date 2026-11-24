// Baş sahypa: gysga kart, oýun kody we meniň oýunlarym.
import { h, fill, fmtDate } from '../ui.js';
import { api, session } from '../api.js';
import { renderCard } from '../card.js';
import { go } from '../app.js';

const STATUS = {
  scheduled: ['Ýazga garaşylýar', ''],
  uploaded: ['Wideo ýüklendi', ''],
  queued: ['Derňew nobatynda', 'gold'],
  processing: ['AI derňeýär…', 'gold'],
  ready: ['Taýýar', 'green'],
  failed: ['Derňewde ýalňyşlyk', 'red'],
};

export function matchRow(m) {
  const [st, cls] = STATUS[m.status] || ['', ''];
  const hasScore = m.teams.A.score !== null && m.teams.A.score !== undefined;
  return h('a', { class: 'match-row', href: `#/match/${m.id}` },
    h('div', { class: 'teams' },
      h('span', { class: 'dot', style: { background: m.teams.A.color } }), m.teams.A.name, ' — ',
      h('span', { class: 'dot', style: { background: m.teams.B.color, marginLeft: '2px' } }), m.teams.B.name),
    h('div', { class: 'score' }, hasScore ? `${m.teams.A.score}:${m.teams.B.score}` : '—'),
    h('div', { class: 'meta' }, `${fmtDate(m.starts_at)} · ${m.pitch?.name || ''} `,
      m.status !== 'ready' ? h('span', { class: `pill ${cls}` }, st) : null,
      m.my ? h('span', { class: 'pill green' }, `bahaňyz ${m.my.rating}`) : null),
  );
}

export async function homeView(root) {
  const me = session.me;
  const matches = await api('/api/matches/mine');

  const err = h('div', { class: 'error-box', hidden: true, style: { marginTop: '10px' } });
  const code = h('input', { placeholder: 'KOD', maxlength: 8, 'aria-label': 'Oýun kody', autocapitalize: 'characters' });
  const join = h('form', {
    class: 'joinbox',
    onsubmit: async (e) => {
      e.preventDefault();
      err.hidden = true;
      try {
        const r = await api('/api/matches/join', { method: 'POST', body: { code: code.value } });
        go(`/match/${r.id}`);
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    },
  }, code, h('button', { class: 'btn', type: 'submit' }, 'Oýny aç'));

  const t = me.totals;
  const f = (v, k) => h('div', { class: 'fact' }, h('div', { class: 'v' }, v), h('div', { class: 'k' }, k));
  fill(root,
    h('div', { class: 'me-strip' },
      h('a', { href: '#/card', 'aria-label': 'Kartymy aç' }, renderCard(me, { size: 'small' })),
      h('div', {},
        h('h1', { style: { fontSize: '34px', marginBottom: '14px' } }, `Salam, ${me.first_name}`),
        h('div', { class: 'facts' },
          f(t.matches, 'oýun'),
          f(t.goals, 'gol'),
          f(t.mvp, 'gezek MVP'),
          f(t.pass_accuracy !== null ? `${t.pass_accuracy}%` : '—', 'pas takyklygy'),
          f(t.top_speed_kmh || '—', 'km/sag iň ýokary'),
          f(t.avg_rating ?? '—', 'orta baha'),
        ))),
    h('h2', {}, 'Oýnuňy tap'),
    h('p', { class: 'small muted', style: { marginBottom: '4px' } }, 'Oýun kody meýdançadaky tagtada ýazylan ýa-da ony oýundan soň administrator aýdar.'),
    join, err,
    h('h2', {}, 'Meniň oýunlarym'),
    matches.length
      ? h('div', { class: 'match-list' }, matches.map(matchRow))
      : h('div', { class: 'empty' }, 'Kod bilen açan oýunlaryňyz şu ýerde peýda bolar.'),
  );
}
