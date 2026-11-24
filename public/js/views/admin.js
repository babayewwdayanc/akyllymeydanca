// Meýdança paneli: oýun döretmek, wideo ýüklemek, derňewi işletmek (demo ýa-da hakyky AI).
import { h, fill, toast, fmtDate } from '../ui.js';
import { api, upload, session } from '../api.js';

const STATUS = {
  scheduled: 'wideo garaşylýar', uploaded: 'wideo ýüklendi', queued: 'AI nobatynda', processing: 'AI derňeýär', ready: 'taýýar', failed: 'ýalňyşlyk',
};

function keyForm(root, msg) {
  const input = h('input', { type: 'password', placeholder: 'Administratoryň açary', 'aria-label': 'Administratoryň açary' });
  fill(root, h('div', { style: { maxWidth: '440px' } },
    h('h1', { style: { marginBottom: '10px' } }, 'Meýdança paneli'),
    h('p', { class: 'lead' }, 'Meýdança eýeleri we administratorlary üçin: oýunlar, wideo we AI derňewi.'),
    msg ? h('div', { class: 'error-box' }, msg) : null,
    h('form', {
      onsubmit: (e) => { e.preventDefault(); session.adminKey = input.value.trim(); adminView(root); },
    }, h('div', { class: 'field' }, input), h('button', { class: 'btn', type: 'submit' }, 'Gir')),
    h('p', { class: 'small muted', style: { marginTop: '12px' } }, 'Açar serwer işledilende ADMIN_KEY bilen berilýär. Demo üçin: admin123.')));
}

export async function adminView(root) {
  if (!session.adminKey) return keyForm(root);
  let ov;
  try { ov = await api('/api/admin/overview', { admin: true }); } catch (e) {
    session.adminKey = null;
    return keyForm(root, e.message);
  }

  const reload = () => adminView(root);
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  const mErr = h('div', { class: 'error-box', hidden: true });
  const matchForm = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(matchForm));
      fd.starts_at = new Date(fd.starts_at).toISOString();
      try {
        const m = await api('/api/admin/matches', { method: 'POST', body: fd, admin: true });
        toast(`Oýun döredildi. Oýunçylar üçin kod: ${m.code}`);
        reload();
      } catch (ex) { mErr.textContent = ex.message; mErr.hidden = false; }
    },
  },
  h('div', { class: 'field' }, h('label', {}, 'Meýdança'), h('select', { name: 'pitch_id' }, ov.pitches.map((p) => h('option', { value: p.id }, `${p.name}, ${p.city}`)))),
  h('div', { class: 'field' }, h('label', {}, 'Başlanýan wagty'), h('input', { type: 'datetime-local', name: 'starts_at', value: local })),
  h('div', { class: 'grid2' },
    h('div', { class: 'field' }, h('label', {}, 'Dowamlylygy, min'), h('input', { type: 'number', name: 'duration_min', value: 60 })),
    h('div', { class: 'field' }, h('label', {}, 'Toparda oýunçy'), h('input', { type: 'number', name: 'players_per_side', value: 6, min: 4, max: 11 })),
    h('div', { class: 'field' }, h('label', {}, 'A topar'), h('input', { name: 'team_a_name', value: 'Aklar' })),
    h('div', { class: 'field' }, h('label', {}, 'A reňki'), h('input', { type: 'color', name: 'team_a_color', value: '#E9ECF5' })),
    h('div', { class: 'field' }, h('label', {}, 'B topar'), h('input', { name: 'team_b_name', value: 'Gyzyllar' })),
    h('div', { class: 'field' }, h('label', {}, 'B reňki'), h('input', { type: 'color', name: 'team_b_color', value: '#C8232C' }))),
  mErr,
  h('button', { class: 'btn block', type: 'submit' }, 'Oýun döret'));

  const pForm = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        await api('/api/admin/pitches', { method: 'POST', body: Object.fromEntries(new FormData(pForm)), admin: true });
        toast('Meýdança goşuldy');
        reload();
      } catch (ex) { toast(ex.message); }
    },
  },
  h('div', { class: 'field' }, h('label', {}, 'Ady'), h('input', { name: 'name', required: true })),
  h('div', { class: 'grid2' },
    h('div', { class: 'field' }, h('label', {}, 'Şäher'), h('input', { name: 'city' })),
    h('div', { class: 'field' }, h('label', {}, 'Salgysy'), h('input', { name: 'address' })),
    h('div', { class: 'field' }, h('label', {}, 'Uzynlygy, m'), h('input', { type: 'number', name: 'length_m', value: 40 })),
    h('div', { class: 'field' }, h('label', {}, 'Ini, m'), h('input', { type: 'number', name: 'width_m', value: 20 }))),
  h('div', { class: 'field' }, h('label', {}, 'Kamerany kalibrlemek (ai/calibrate.py-dan JSON)'), h('textarea', { name: 'calibration', rows: 3, placeholder: '{"image_points": [[x,y],…4 burç], "pitch_points": [[0,0],[40,0],[40,20],[0,20]]}' })),
  h('button', { class: 'btn quiet block', type: 'submit' }, 'Meýdança goş'));

  const matchItem = (m) => {
    const prog = h('span', { class: 'small muted' });
    const fileIn = h('input', {
      type: 'file', accept: 'video/*', hidden: true,
      onchange: async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        const fd = new FormData();
        fd.append('video', f);
        try {
          await upload(`/api/admin/matches/${m.id}/video`, fd, { admin: true, onProgress: (p) => { prog.textContent = `Ýüklenýär ${Math.round(p * 100)}%`; } });
          toast('Wideo ýüklendi');
          reload();
        } catch (ex) { toast(ex.message); prog.textContent = ''; }
      },
    });
    const run = (mode) => async (e) => {
      e.currentTarget.disabled = true;
      try {
        const r = await api(`/api/admin/matches/${m.id}/analyze`, { method: 'POST', body: { mode }, admin: true });
        toast(r.message || `Taýýar: ${r.events} waka, hasap ${r.score.join(':')}`);
        reload();
      } catch (ex) { toast(ex.message); e.currentTarget.disabled = false; }
    };
    const scoreA = h('input', { type: 'number', min: 0, value: m.teams.A.score ?? '', 'aria-label': 'A goly' });
    const scoreB = h('input', { type: 'number', min: 0, value: m.teams.B.score ?? '', 'aria-label': 'B goly' });
    return h('div', { class: 'admin-match' },
      h('div', { class: 'row1' },
        h('div', {}, h('b', {}, `${m.teams.A.name} — ${m.teams.B.name}`), h('div', { class: 'small muted' }, `${fmtDate(m.starts_at)} · ${m.pitch?.name} · ${m.members} oýunçy açdy · ${m.video_url ? 'wideo bar' : 'wideo ýok'}`)),
        h('div', { style: { textAlign: 'right' } }, h('div', { class: 'code' }, m.code), h('div', { class: 'small muted' }, STATUS[m.status], m.analysis_source ? ` · ${m.analysis_source}` : ''))),
      m.error ? h('div', { class: 'error-box', style: { marginTop: '8px' } }, m.error) : null,
      h('div', { class: 'btn-row' },
        h('label', { class: 'btn quiet small' }, fileIn, m.video_url ? 'Wideony çalyş' : 'Wideo ýükle'),
        h('button', { class: 'btn small', onclick: run('ai'), disabled: !m.video_url, title: m.video_url ? '' : 'Ilki wideo ýükläň' }, 'AI derňewi'),
        h('button', { class: 'btn ghost small', onclick: run('demo') }, 'Demo derňew'),
        h('a', { class: 'btn ghost small', href: `#/match/${m.id}` }, 'Aç'),
        prog),
      h('div', { class: 'btn-row' },
        h('span', { class: 'small muted' }, 'Hasaby düzet:'), scoreA, h('span', {}, ':'), scoreB,
        h('button', {
          class: 'btn ghost small',
          onclick: async () => {
            try { await api(`/api/admin/matches/${m.id}/score`, { method: 'POST', body: { score_a: Number(scoreA.value), score_b: Number(scoreB.value) }, admin: true }); toast('Hasap ýatda saklandy'); reload(); } catch (ex) { toast(ex.message); }
          },
        }, 'Sakla'),
        h('button', {
          class: 'btn danger small', style: { marginLeft: 'auto' },
          onclick: async () => {
            if (!confirm(`${m.code} oýny wideosy we statistikasy bilen bilelikde pozulsynmy? Muny yzyna gaýtaryp bolmaýar.`)) return;
            await api(`/api/admin/matches/${m.id}`, { method: 'DELETE', admin: true });
            reload();
          },
        }, 'Poz')));
  };

  fill(root,
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap', marginBottom: '18px' } },
      h('h1', {}, 'Meýdança paneli'),
      h('div', { class: 'small muted' }, `ffmpeg: ${ov.ffmpeg ? 'bar' : 'ýok'} · AI syny: ${ov.summary ? 'açyk' : 'öçük'} · `,
        h('a', { href: '#', onclick: (e) => { e.preventDefault(); session.adminKey = null; reload(); } }, 'çyk'))),
    h('div', { class: 'admin-grid' },
      h('div', {},
        h('div', { class: 'panel' }, h('h3', {}, 'Täze oýun'), matchForm),
        h('div', { class: 'panel', style: { marginTop: '16px' } }, h('h3', {}, 'Täze meýdança'), pForm)),
      h('div', {},
        h('h3', {}, 'Oýunlar'),
        h('p', { class: 'small muted' }, '«AI derňewi» oýny nobata goýýar — ony wideokartly kompýuterdäki AI-işçi (ai/worker.py) alar. «Demo derňew» — wideosyz derrew synag maglumatlary.'),
        ov.matches.length ? h('div', { class: 'panel', style: { padding: 0 } }, ov.matches.map(matchItem)) : h('div', { class: 'empty' }, 'Çepde ilkinji oýny dörediň.'))),
  );
}
