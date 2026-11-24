// Oýun sahypasy: ýazgy + klipler, toparlaryň we oýunçylaryň statistikasy, MVP, «özüňi tap».
import { h, fill, toast, fmtTime, fmtDate, avatar, trackName, ratingColor, shirtSvg } from '../ui.js';
import { api } from '../api.js';
import { createPlayer, createClipper } from '../player.js';
import { drawHeatmap } from '../pitch.js';
import { refreshMe } from '../app.js';

const STATUS_TEXT = {
  scheduled: 'Oýun entek ýazga alynmady. Meýdança wideony ýükläninden soň ýazgy şu ýerde peýda bolar.',
  uploaded: 'Wideo ýüklendi we derňewe garaşýar.',
  queued: 'Oýun AI derňewiniň nobatynda. Adatça 10–30 minut alýar.',
  processing: 'AI oýny derňeýär: oýunçylary, topy, paslary we urgulary gözleýär. Birnäçe minutdan sahypany täzeläň.',
  failed: 'Derňew başa barmady. Meýdançanyň administratory ýalňyşlygy görýär we täzeden işleder.',
};

const HL_ICON = { goal: ['G', '#1E9E5A'], save: ['H', '#2F6FD6'], shot: ['U', '#D99A00'] };

export async function matchView(root, id) {
  let d = await api(`/api/matches/${id}`);
  const ready = d.status === 'ready';
  const pitchL = d.pitch?.length_m || 40;
  const pitchW = d.pitch?.width_m || 20;

  // ---------- Sözbaşy ----------
  const header = h('div', {},
    h('div', { class: 'scoreboard' },
      h('div', { class: 't' }, h('span', { class: 'dot', style: { background: d.teams.A.color } }), d.teams.A.name),
      h('div', { class: 's' }, d.teams.A.score ?? '–', h('span', {}, ':'), d.teams.B.score ?? '–'),
      h('div', { class: 't' }, h('span', { class: 'dot', style: { background: d.teams.B.color } }), d.teams.B.name)),
    h('div', { class: 'match-meta' }, `${d.pitch?.name || ''} · ${fmtDate(d.starts_at)} · kod ${d.code}`),
  );

  if (!ready) {
    fill(root, header, h('div', { class: 'empty' }, STATUS_TEXT[d.status] || ''));
    return;
  }

  // ---------- Pleýer (wideo ýa-da 2D gaýtalama) ----------
  let replayData = null;
  if (!d.video_url) replayData = await api(`/api/matches/${id}/replay`).catch(() => null);
  let player = null;
  const playerWrap = h('div');
  if (d.video_url || replayData) {
    player = createPlayer({
      videoUrl: d.video_url,
      replay: replayData && { data: replayData, colors: { A: d.teams.A.color, B: d.teams.B.color }, tracks: d.tracks, meTrack: d.my_track },
    });
    playerWrap.append(player.el);
    if (!d.video_url) {
      playerWrap.append(h('p', { class: 'replay-note' },
        'Bu oýnuň wideosy ýüklenmedik — AI maglumatlary boýunça shemany görkezýäris: tegelekler — belgili oýunçylar, ak nokat — top. ',
        d.my_track ? 'Siz altyn tegelekde.' : ''));
    }
  } else {
    playerWrap.append(h('div', { class: 'empty' }, 'Ýazgy elýeterli däl.'));
  }

  // ---------- Bölümler ----------
  const panels = { video: h('div'), stats: h('div'), players: h('div'), mvp: h('div'), me: h('div') };
  const tabDefs = [
    ['video', 'Ýazgy'],
    ['stats', 'Statistika'],
    ['players', 'Oýunçylar'],
    ['mvp', 'MVP'],
    ['me', d.my_track ? 'Bu men' : 'Özüňi tap'],
  ];
  const tabBtns = tabDefs.map(([k, label]) => h('button', { role: 'tab', 'aria-selected': 'false', onclick: () => select(k) }, label));
  const tabs = h('div', { class: 'tabs', role: 'tablist' }, tabBtns);
  const select = (k) => {
    tabDefs.forEach(([key], i) => {
      tabBtns[i].setAttribute('aria-selected', String(key === k));
      panels[key].hidden = key !== k;
    });
    if (k === 'stats') requestAnimationFrame(drawHeats);
    if (k !== 'video') player?.pause();
  };

  const byNo = () => new Map(d.tracks.map((t) => [t.track_no, t]));
  const color = (team) => d.teams[team].color;

  // ---------- Ýazgy: pleýer, klipler, iň gowy pursatlar ----------
  function renderVideo() {
    const chipsState = { type: 'all' };
    const list = h('div', { class: 'hl-list' });
    const drawList = () => {
      const items = d.highlights.filter((x) => chipsState.type === 'all' || x.type === chipsState.type);
      fill(list, items.length ? items.map((x) => {
        const [ic, bg] = HL_ICON[x.type];
        return h('button', {
          class: 'hl',
          onclick: () => { player?.playSegment(x.start, x.end); playerWrap.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
        },
        h('span', { class: 'tm' }, fmtTime(x.t)),
        h('span', {}, x.label),
        h('span', { class: 'ic', style: { background: bg } }, ic));
      }) : h('p', { class: 'muted small', style: { padding: '12px 14px', margin: 0 } }, 'Beýle pursat ýok.'));
    };
    const chipBtns = [['all', 'Hemmesi'], ['goal', 'Gollar'], ['save', 'Halas edişler'], ['shot', 'Güýçli urgular']].map(([k, l]) => h('button', {
      'aria-pressed': String(k === 'all'),
      onclick: (e) => { chipsState.type = k; chipBtns.forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); drawList(); },
    }, l));
    drawList();
    fill(panels.video,
      playerWrap,
      player ? createClipper(player, d.id) : null,
      h('h2', {}, 'Iň gowy pursatlar'),
      h('p', { class: 'small muted' }, 'AI gollary, halas edişleri we iň güýçli urgulary özi tapdy. Basyň — pleýer şol pursaty görkezer.'),
      h('div', { class: 'chips' }, chipBtns),
      list,
    );
  }

  // ---------- Statistika ----------
  const heatJobs = [];
  function drawHeats() { heatJobs.forEach((fn) => fn()); }

  function statLine(label, a, b, fmt = (x) => x) {
    const total = a + b || 1;
    return h('div', { class: 'statbar' },
      h('div', { class: 'lbl' }, h('b', {}, fmt(a)), h('span', {}, label), h('b', {}, fmt(b))),
      h('div', { class: 'bar' },
        h('i', { style: { width: `${(a / total) * 100}%`, background: d.teams.A.color } }),
        h('i', { style: { width: `${(b / total) * 100}%`, background: d.teams.B.color } })));
  }

  function myBlock() {
    const t = byNo().get(d.my_track);
    if (!t) {
      return h('div', { class: 'empty', style: { marginBottom: '8px' } },
        'Oýunda özüňizi belläň — şu ýerde şahsy statistikaňyz peýda bolar.',
        h('br'), h('button', { class: 'btn small', style: { marginTop: '12px' }, onclick: () => select('me') }, 'Özüňi tap'));
    }
    const cv = h('canvas', { 'aria-label': 'Siziň ýylylyk kartaňyz' });
    heatJobs.push(() => drawHeatmap(cv, t.heatmap, pitchL, pitchW));
    const f = (v, k) => h('div', { class: 'fact' }, h('div', { class: 'v' }, v), h('div', { class: 'k' }, k));
    return h('div', {},
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' } },
        h('span', { class: 'rating-chip', style: { background: ratingColor(t.rating), fontSize: '26px', padding: '4px 10px' } }, t.rating.toFixed(1)),
        h('div', {}, h('b', {}, 'Oýun üçin bahaňyz'), h('div', { class: 'small muted' }, d.mvp?.track_no === t.track_no ? 'Siz oýnuň MVP-si!' : '3–10 şkala, uly ligalardaky ýaly'))),
      h('div', { class: 'totals' },
        f(t.goals, 'gol'), f(t.assists, 'gol pasy'),
        f(`${t.passes_completed}/${t.passes}`, `takyk pas (${t.pass_accuracy ?? 0}%)`),
        f(t.errors, 'ýalňyşlyk: takyk däl pas we ýitirilen top'),
        f(`${t.shots_on_target}/${t.shots}`, 'derwezä urgy'),
        f(t.max_shot_kmh ? Math.round(t.max_shot_kmh) : '—', 'km/sag — iň güýçli urgy'),
        f((t.distance_m / 1000).toFixed(2), 'km ylgady'),
        f(t.top_speed_kmh, 'km/sag — iň ýokary tizlik'),
        f(t.sprints, 'sprint'),
        f(t.tackles + t.interceptions, 'top alyş we kesip alyş'),
        t.saves ? f(t.saves, 'halas ediş') : null),
      h('h3', { style: { marginTop: '20px' } }, 'Nirede oýnadyňyz'),
      h('div', { class: 'heat-wrap' }, cv),
      h('p', { class: 'small muted', style: { marginTop: '6px' } }, `${d.teams.A.name} saga hüjüm edýär →`));
  }

  function renderStats() {
    heatJobs.length = 0;
    const A = d.team_stats.A;
    const B = d.team_stats.B;
    const pct = (x) => `${Math.round(x * 100)}%`;
    const awards = d.awards.map((a) => {
      const t = byNo().get(a.track_no);
      return h('div', { class: 'award' },
        h('div', { class: 't' }, a.title),
        h('div', { class: 'v' }, a.value, h('small', {}, a.unit)),
        h('div', { class: 'w' }, h('span', { class: 'dot', style: { background: color(t.team) } }), trackName(t)));
    });
    fill(panels.stats,
      h('h2', { style: { marginTop: '0' } }, 'Siziň oýnuňyz'),
      myBlock(),
      h('h2', {}, 'Toparlar'),
      h('div', { class: 'statbars box' },
        statLine('Topa eýelik', A.possession, B.possession, pct),
        statLine('Paslar', A.passes, B.passes),
        statLine('Pas takyklygy, %', A.pass_accuracy, B.pass_accuracy),
        statLine('Urgular', A.shots, B.shots),
        statLine('Derwezä', A.shots_on_target, B.shots_on_target),
        statLine('Ýalňyşlyklar', A.errors, B.errors),
        statLine('Top alyşlar', A.tackles, B.tackles),
        statLine('Ylgan aralyk, km', A.distance_km, B.distance_km)),
      h('p', { class: 'small muted', style: { marginTop: '12px' } }, `Oýnuň iň çalt topy: ${d.max_ball_kmh} km/sag`),
      h('h2', {}, 'Oýnuň iň gowulary'),
      h('div', { class: 'awards' }, awards),
    );
    if (!panels.stats.hidden) requestAnimationFrame(drawHeats);
  }

  // ---------- Oýunçylar tablisasy ----------
  let sortKey = 'rating';
  function renderPlayers() {
    const cols = [
      ['rating', 'Baha'], ['goals', 'Gol'], ['assists', 'Gol pasy'], ['passes_completed', 'Paslar'], ['pass_accuracy', 'Takyk.'],
      ['errors', 'Ýalňyş.'], ['shots', 'Urgy'], ['tackles', 'Top alyş'], ['distance_m', 'Km'], ['top_speed_kmh', 'Tizlik'], ['max_shot_kmh', 'Urgy km/sag'],
    ];
    const rows = [...d.tracks].sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0));
    const table = h('table', { class: 'ptable' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Oýunçy'), cols.map(([k, l]) => h('th', {
        scope: 'col', 'aria-sort': k === sortKey ? 'descending' : 'none', onclick: () => { sortKey = k; renderPlayers(); },
      }, l + (k === sortKey ? ' ↓' : ''))))),
      h('tbody', {}, rows.map((t) => h('tr', { class: t.track_no === d.my_track ? 'me' : '' },
        h('td', {}, h('div', { class: 'who' }, avatar(t.player, { team: color(t.team), jersey: t.jersey }), h('span', {}, trackName(t)), d.mvp?.track_no === t.track_no ? h('span', { class: 'pill gold' }, 'MVP') : null)),
        h('td', {}, h('span', { class: 'rating-chip', style: { background: ratingColor(t.rating) } }, t.rating.toFixed(1))),
        h('td', {}, t.goals), h('td', {}, t.assists), h('td', {}, `${t.passes_completed}/${t.passes}`), h('td', {}, t.pass_accuracy !== null ? `${t.pass_accuracy}%` : '—'),
        h('td', {}, t.errors), h('td', {}, `${t.shots_on_target}/${t.shots}`), h('td', {}, t.tackles + t.interceptions),
        h('td', {}, (t.distance_m / 1000).toFixed(2)), h('td', {}, t.top_speed_kmh), h('td', {}, t.max_shot_kmh ? Math.round(t.max_shot_kmh) : '—')))));
    fill(panels.players,
      h('p', { class: 'small muted' }, 'Tertiplemek üçin sütüniň adyna basyň. «Ýalňyş.» — takyk däl paslar we ýitirilen toplar.'),
      h('div', { class: 'ptable-wrap' }, table));
  }

  // ---------- MVP ----------
  function renderMvp() {
    const m = byNo();
    const mvp = d.mvp && m.get(d.mvp.track_no);
    const fan = d.fan_mvp && m.get(d.fan_mvp.track_no);
    const summaryBox = h('div');
    const voteList = h('div', { class: 'vote-list' }, d.tracks.filter((t) => t.track_no !== d.my_track).sort((a, b) => b.rating - a.rating).map((t) => h('button', {
      class: 'vote-item', 'aria-pressed': String(d.my_vote === t.track_no),
      onclick: async () => {
        try { d = await api(`/api/matches/${id}/vote`, { method: 'POST', body: { track_no: t.track_no } }); toast('Sesiňiz kabul edildi'); renderMvp(); } catch (e) { toast(e.message); }
      },
    }, avatar(t.player, { team: color(t.team), jersey: t.jersey }), h('span', {}, trackName(t)), h('span', { class: 'muted small' }, `${d.votes[t.track_no] || 0} ses`))));

    fill(panels.mvp,
      mvp ? h('div', { class: 'mvp-hero' },
        avatar(mvp.player, { team: color(mvp.team), jersey: mvp.jersey, size: 80 }),
        h('div', {},
          h('div', { class: 'small muted' }, 'AI boýunça oýnuň MVP-si'),
          h('div', { class: 'who' }, trackName(mvp)),
          h('div', { style: { display: 'flex', gap: '12px', alignItems: 'baseline', flexWrap: 'wrap' } },
            h('span', { class: 'r' }, mvp.rating.toFixed(1)),
            h('span', { class: 'small muted' }, `${mvp.goals} gol · ${mvp.assists} gol pasy · ${mvp.passes_completed}/${mvp.passes} pas · ${(mvp.distance_m / 1000).toFixed(1)} km`)))) : null,
      h('p', { class: 'small muted' }, 'AI her kime 3-den 10-a çenli baha goýýar: gollar, gol paslary, takyk paslar, top alyşlar, halas edişler we ylgan aralyk — goşmaça; ýitirilen toplar — kemçilik. Bahasy iň ýokary bolan — MVP.'),
      h('h2', {}, 'Oýunçylaryň saýlawy'),
      fan ? h('p', {}, 'Häzir öňde: ', h('b', {}, trackName(fan)), ` (${d.fan_mvp.votes} ses)`) : h('p', { class: 'muted' }, 'Entek hiç kim ses bermedi. Birinji boluň.'),
      voteList,
      d.summary_available ? h('div', {},
        h('h2', {}, 'AI-dan oýun syny'),
        summaryBox,
        h('button', {
          class: 'btn ghost',
          onclick: async (e) => {
            const b = e.currentTarget;
            b.disabled = true;
            fill(summaryBox, h('p', { class: 'busy' }, 'Syn ýazylýar…'));
            try {
              const r = await api(`/api/matches/${id}/summary`, { method: 'POST' });
              fill(summaryBox, h('div', { class: 'summary-text' }, r.text));
            } catch (ex) { fill(summaryBox, h('div', { class: 'error-box' }, ex.message)); }
            b.disabled = false;
          },
        }, 'Syn ýaz')) : null,
    );
  }

  // ---------- Özüňi tap ----------
  function renderClaim() {
    const tile = (t) => {
      const mine = t.track_no === d.my_track;
      const taken = t.player && !mine;
      return h('button', {
        class: `claim-tile${mine ? ' mine' : ''}`, disabled: taken,
        onclick: async () => {
          if (mine) return;
          try {
            d = await api(`/api/matches/${id}/claim`, { method: 'POST', body: { track_no: t.track_no } });
            toast('Taýýar! Oýnuň statistikasy profiliňize goşuldy');
            await refreshMe();
            player?.setMe(d.my_track);
            tabBtns[4].textContent = 'Bu men';
            renderAll();
          } catch (e) { toast(e.message); }
        },
      },
      t.thumbnail_url ? h('span', { class: 'shirt-img', style: { backgroundImage: `url("${t.thumbnail_url}")` } }) : shirtSvg(color(t.team), t.jersey),
      h('span', {}, `Oýunçy ${t.track_no}`),
      h('span', { class: 'small muted' }, taken ? t.player.name : mine ? 'bu siz' : d.teams[t.team].name));
    };
    fill(panels.me,
      h('p', {}, 'Kamera ýüzleri tanamaýar — tapylan oýunçylaryň haýsysynyň siz bolandygyny özüňiz saýlaýarsyňyz. Manişkanyň reňkine we belgisine serediň.',
        d.tracks.some((t) => t.thumbnail_url) ? ' Suratlarda — oýnuňyzdan kadrlar.' : ''),
      h('h3', { style: { marginTop: '18px' } }, h('span', { class: 'dot', style: { background: d.teams.A.color } }), d.teams.A.name),
      h('div', { class: 'claim-grid' }, d.tracks.filter((t) => t.team === 'A').map(tile)),
      h('h3', { style: { marginTop: '18px' } }, h('span', { class: 'dot', style: { background: d.teams.B.color } }), d.teams.B.name),
      h('div', { class: 'claim-grid' }, d.tracks.filter((t) => t.team === 'B').map(tile)),
      d.my_track ? h('button', {
        class: 'btn ghost', style: { marginTop: '18px' },
        onclick: async () => {
          d = await api(`/api/matches/${id}/claim`, { method: 'DELETE' });
          await refreshMe();
          player?.setMe(null);
          tabBtns[4].textContent = 'Özüňi tap';
          toast('Bellik aýryldy');
          renderAll();
        },
      }, 'Bu men däl — belligi aýyr') : null,
    );
  }

  function renderAll() {
    renderStats();
    renderPlayers();
    renderMvp();
    renderClaim();
  }

  renderVideo();
  renderAll();
  fill(root, header, tabs, ...Object.values(panels));
  select(d.my_track ? 'video' : 'me');
  return () => player?.destroy();
}
