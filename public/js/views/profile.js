// Kart, profil, oýunçynyň köpçülik sahypasy, reýting we klip sahypasy.
import { h, fill, toast, fmtDate, fmtTime, POS, FOOT, avatar, ratingColor } from '../ui.js';
import { api, session } from '../api.js';
import { renderCard, shareCard } from '../card.js';
import { createPlayer, sharePanel } from '../player.js';
import { preparePhoto, removeBackground } from '../photo.js';
import { refreshMe, go } from '../app.js';

function totalsBlock(t) {
  const f = (v, k) => h('div', { class: 'fact' }, h('div', { class: 'v' }, v ?? '—'), h('div', { class: 'k' }, k));
  return h('div', { class: 'totals' },
    f(t.matches, 'oýun'), f(t.goals, 'gol'), f(t.assists, 'gol pasy'), f(t.mvp, 'gezek MVP'),
    f(t.avg_rating, 'orta baha'),
    f(t.pass_accuracy !== null ? `${t.pass_accuracy}%` : null, `pas takyklygy (${t.passes_completed}/${t.passes})`),
    f(t.errors, 'jemi ýalňyşlyk'),
    f(t.top_speed_kmh || null, 'km/sag — iň ýokary tizlik'),
    f(t.max_shot_kmh ? Math.round(t.max_shot_kmh) : null, 'km/sag — iň güýçli urgy'),
    f(t.distance_km, 'km ylgady'),
    f(t.tackles + t.interceptions, 'top alyş'),
    t.saves ? f(t.saves, 'halas ediş') : null);
}

const RES = { W: 'Ý', L: 'U', D: 'D' }; // ýeňiş, utulyşyk, deňme-deň

function historyBlock(list, { link = true } = {}) {
  if (!list.length) return h('div', { class: 'empty' }, 'Entek oýnalan oýun ýok. Oýny kod bilen açyň we özüňizi belläň.');
  return h('div', { class: 'match-list history' }, list.map((m) => h(link ? 'a' : 'div', { class: 'match-row', href: link ? `#/match/${m.match_id}` : undefined },
    h('div', { class: 'teams' }, h('span', { class: `res ${m.result}` }, RES[m.result]), `${m.my_team} — ${m.opponent}`),
    h('div', { class: 'score' }, m.score),
    h('div', { class: 'meta' }, fmtDate(m.starts_at), ' ',
      h('span', { class: 'rating-chip', style: { background: ratingColor(m.rating), padding: '0 6px', fontSize: '13px' } }, m.rating.toFixed(1)),
      m.goals ? ` · ${m.goals} gol` : '', m.assists ? ` · ${m.assists} gol pasy` : '',
      m.mvp ? h('span', { class: 'pill gold', style: { marginLeft: '6px' } }, 'MVP') : null))));
}

export async function cardView(root) {
  const me = await refreshMe();
  const c = me.card;
  const left = c.provisional ? Math.max(0, 3 - c.matches) : 0;
  fill(root, h('div', { class: 'card-stage' },
    renderCard(me, { size: 'big', mvp: me.totals.mvp > 0 }),
    h('p', { class: 'lead', style: { textAlign: 'center' } },
      c.provisional
        ? `Başlangyç kart. Kameraly meýdançada ýene ${left} oýun — we sanlar siziň hakyky sanlaryňyz bolar.`
        : `Sanlar ${c.matches} oýun boýunça hasaplandy we her oýundan soň täzelenýär.`),
    h('div', { class: 'btn-row', style: { justifyContent: 'center' } },
      h('button', { class: 'btn', onclick: () => shareCard(me) }, 'Ýatda sakla we ugrat'),
      h('a', { class: 'btn ghost', href: `#/player/${me.id}` }, 'Beýlekiler nähili görýär'),
      me.photo_url && !me.photo_cutout ? h('a', { class: 'btn quiet', href: '#/me' }, 'Suratyň fonuny aýyr') : null)),
  h('h2', {}, 'Sanlar nämeden düzülýär'),
  h('div', { class: 'box small' },
    h('p', {}, h('b', {}, 'TIZ'), ' — oýunlardaky iň ýokary tizligiňiziň ortaçasy. ', h('b', {}, 'URG'), ' — gollar, urgularyň takyklygy we güýji. ', h('b', {}, 'PAS'), ' — paslaryň takyklygy we sany.'),
    h('p', {}, h('b', {}, 'DRB'), ' — topy näçe seýrek ýitirýärsiňiz we ol näçe wagt sizde. ', h('b', {}, 'GOR'), ' — top alyşlar, kesip alyşlar we halas edişler. ', h('b', {}, 'FIZ'), ' — ylgan aralyk, sprintler we boý.'),
    h('p', { style: { margin: 0 } }, `Umumy reýting pozisiýa görä hasaplanýar (${POS[me.position].toLowerCase()}): hüjümçi üçin urgy, goragçy üçin gorag has möhüm.`)),
  h('h2', {}, 'Ähli wagt üçin statistika'), totalsBlock(me.totals));
}

export async function playerView(root, id) {
  const p = await api(`/api/players/${id}`);
  fill(root,
    h('div', { class: 'card-stage' }, renderCard(p, { size: 'big', mvp: p.totals.mvp > 0 })),
    h('h1', { style: { textAlign: 'center', marginTop: '16px' } }, `${p.first_name} ${p.last_name}`),
    h('p', { class: 'muted', style: { textAlign: 'center' } }, `${POS[p.position]} · ${p.height_cm} sm · ${p.weight_kg} kg · ${FOOT[p.foot].toLowerCase()}`),
    h('h2', {}, 'Statistika'), totalsBlock(p.totals),
    h('h2', {}, 'Soňky oýunlar'), historyBlock(p.history, { link: session.me?.id === p.id }));
}

export async function topView(root) {
  let by = 'ovr';
  const list = h('div');
  const chips = h('div', { class: 'chips' });
  const load = async () => {
    const r = await api(`/api/leaderboard?by=${by}`);
    fill(chips, Object.entries(r.boards).map(([k, title]) => h('button', {
      'aria-pressed': String(k === by), onclick: () => { by = k; load(); },
    }, title)));
    fill(list, r.rows.length ? h('div', { class: 'lb' }, r.rows.map((row, i) => h('a', { class: 'lb-row', href: `#/player/${row.id}` },
      h('span', { class: 'pl' }, i + 1),
      avatar(row),
      h('div', {}, h('div', { class: 'nm' }, row.name, row.id === session.me?.id ? h('span', { class: 'pill green', style: { marginLeft: '6px' } }, 'siz') : null),
        h('div', { class: 'sub' }, `${POS[row.position]} · ${row.matches} oýun · reýting ${row.ovr}`)),
      h('span', { class: 'val' }, row.value, r.unit ? h('small', { class: 'muted', style: { fontSize: '13px', marginLeft: '3px' } }, r.unit) : null))))
      : h('div', { class: 'empty' }, 'Entek boş — kameraly meýdançada bir oýun oýnaň.'));
  };
  fill(root, h('h1', { style: { marginBottom: '16px' } }, 'Oýunçylaryň reýtingi'), chips, list);
  await load();
}

export async function meView(root) {
  const me = await refreshMe();
  const clips = await api('/api/me/clips');
  const err = h('div', { class: 'error-box', hidden: true });

  // --- Surat çalyşmak (fony aýyrmak bilen) ---
  const photoState = { blob: null };
  const photoStatus = h('span', { class: 'small muted' });
  const bgToggle = h('input', { type: 'checkbox', checked: true });
  const photoInput = h('input', {
    id: 'mph', type: 'file', accept: 'image/jpeg,image/png,image/webp',
    onchange: async (e) => {
      const f = e.target.files[0];
      photoState.blob = null;
      if (!f) return;
      try {
        const files = await preparePhoto(f);
        photoState.blob = files.square;
        if (bgToggle.checked) {
          photoStatus.className = 'busy';
          photoStatus.textContent = 'Fon aýrylýar…';
          try {
            photoState.blob = await removeBackground(files.original);
            photoStatus.className = 'small muted';
            photoStatus.textContent = 'Fon aýryldy — «Üýtgetmeleri ýatda sakla» basyň';
          } catch (ex) {
            photoStatus.className = 'small muted';
            photoStatus.textContent = `${ex.message} Surat fon bilen saklanar.`;
          }
        } else {
          photoStatus.textContent = 'Surat saýlandy';
        }
      } catch (ex) { toast(ex.message); }
    },
  });

  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      if (photoState.blob) fd.set('photo', photoState.blob, photoState.blob.type === 'image/png' ? 'photo.png' : 'photo.jpg');
      try {
        session.me = await api('/api/me', { method: 'PUT', form: fd });
        toast('Profil täzelendi');
        meView(root);
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    },
  },
  h('div', { class: 'grid2' },
    h('div', { class: 'field' }, h('label', { for: 'mh' }, 'Boýy, sm'), h('input', { id: 'mh', name: 'height_cm', type: 'number', value: me.height_cm, inputmode: 'numeric' })),
    h('div', { class: 'field' }, h('label', { for: 'mw' }, 'Agramy, kg'), h('input', { id: 'mw', name: 'weight_kg', type: 'number', value: me.weight_kg, inputmode: 'numeric' })),
    h('div', { class: 'field' }, h('label', { for: 'mp' }, 'Pozisiýa'), h('select', { id: 'mp', name: 'position' }, Object.entries(POS).map(([k, v]) => h('option', { value: k, selected: k === me.position }, v)))),
    h('div', { class: 'field' }, h('label', { for: 'mf' }, 'Esasy aýak'), h('select', { id: 'mf', name: 'foot' }, Object.entries(FOOT).map(([k, v]) => h('option', { value: k, selected: k === me.foot }, v))))),
  h('div', { class: 'field' }, h('label', { for: 'mph' }, 'Täze surat'), photoInput),
  h('div', { class: 'photo-opts' }, h('label', { class: 'switch' }, bgToggle, 'Fony aýyr'), photoStatus),
  err,
  h('button', { class: 'btn', type: 'submit' }, 'Üýtgetmeleri ýatda sakla'));

  const cutBtn = me.photo_url && !me.photo_cutout ? h('button', {
    class: 'btn quiet small',
    onclick: async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      b.textContent = 'Fon aýrylýar…';
      try {
        session.me = await api('/api/me/photo/cutout', { method: 'POST' });
        toast('Fon aýryldy — kartyňyza serediň');
        go('/card');
      } catch (ex) { toast(ex.message); b.disabled = false; b.textContent = 'Häzirki suratyň fonuny aýyr'; }
    },
  }, 'Häzirki suratyň fonuny aýyr') : null;

  fill(root,
    h('div', { style: { display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' } },
      avatar(me, { size: 68 }),
      h('div', { style: { flex: 1 } }, h('h1', { style: { fontSize: '30px' } }, `${me.first_name} ${me.last_name}`), h('div', { class: 'muted small' }, `${POS[me.position]} · reýting ${me.card.ovr}`)),
      cutBtn),
    h('h2', {}, 'Meniň kliplerim'),
    clips.length ? h('div', { class: 'match-list' }, clips.map((c) => h('a', { class: 'match-row', href: `#/clip/${c.id}` },
      h('div', { class: 'teams' }, c.title),
      h('div', { class: 'score', style: { fontSize: '16px' } }, `${c.views} gezek görüldi`),
      h('div', { class: 'meta' }, `${c.match.teams.A.name} — ${c.match.teams.B.name} · ${fmtTime(c.start_s)}–${fmtTime(c.end_s)}`))))
      : h('div', { class: 'empty' }, 'Oýun sahypasynda öz pursadyňyzy kesiň — ol şu ýerde peýda bolar.'),
    h('h2', {}, 'Meniň oýunlarym'), historyBlock(me.history),
    h('h2', {}, 'Profil maglumatlary'), h('div', { class: 'box' }, form),
    h('button', {
      class: 'btn ghost', style: { marginTop: '28px' },
      onclick: async () => { await api('/api/logout', { method: 'POST' }).catch(() => {}); session.token = null; session.me = null; go('/welcome'); },
    }, 'Hasapdan çyk'),
  );
}

export async function clipView(root, id) {
  const c = await api(`/api/clips/${id}`);
  let replay = null;
  if (!c.match.video_url && c.has_replay) {
    const r = await api(`/api/clips/${id}/replay`);
    replay = {
      data: { ...r, offset: Math.floor(c.start_s * r.frames_hz) / r.frames_hz },
      colors: { A: c.match.teams.A.color, B: c.match.teams.B.color },
      tracks: r.tracks,
    };
  }
  const player = c.match.video_url || replay
    ? createPlayer({ videoUrl: c.match.video_url, replay, segment: { start: c.start_s, end: c.end_s } })
    : null;
  fill(root,
    h('h1', { style: { marginBottom: '6px' } }, c.title),
    h('p', { class: 'muted small' },
      c.author ? `${c.author.name} · ` : '', `${c.match.teams.A.name} ${c.match.teams.A.score ?? ''}:${c.match.teams.B.score ?? ''} ${c.match.teams.B.name} · `,
      `${c.match.pitch?.name || ''} · ${fmtDate(c.match.starts_at)} · ${c.views} gezek görüldi`),
    player ? player.el : h('div', { class: 'empty' }, 'Ýazgy elýeterli däl.'),
    !c.match.video_url ? h('p', { class: 'replay-note' }, 'Pursadyň AI maglumatlary boýunça shemasy. Oýnuň wideosy ýüklenmedik.') : null,
    sharePanel(c),
    !session.token ? h('div', { class: 'empty section-gap' },
      'Kameraly meýdançada oýnaýarsyňyzmy? Oýunçy kartyňyzy dörediň — oýunlaryňyz ýazgyda we sanlarda bolar.',
      h('br'), h('a', { class: 'btn', href: '#/welcome' }, 'Kart döret')) : null,
  );
  player?.play();
  return () => player?.destroy();
}
