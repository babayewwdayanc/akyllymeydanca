// Hasaba alyş: ady, familiýasy, boýy, agramy, surat → derrew FC kart (fony aýrylan surat bilen).
import { h, fill, toast, POS } from '../ui.js';
import { api, session } from '../api.js';
import { renderCard, shareCard } from '../card.js';
import { preparePhoto, removeBackground } from '../photo.js';
import { refreshMe, go } from '../app.js';

function seg(name, options, value, onChange) {
  const wrap = h('div', { class: 'seg', role: 'group', 'aria-label': name });
  const btns = options.map(([v, label]) => h('button', {
    type: 'button', 'aria-pressed': String(v === value),
    onclick: (e) => { btns.forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); onChange(v); },
  }, label));
  wrap.append(...btns);
  return wrap;
}

export async function onboardView(root) {
  if (session.token && (await refreshMe())) { go('/'); return; }

  const state = {
    first_name: '', last_name: '', height_cm: 178, weight_kg: 74, position: 'MID', foot: 'R',
    files: null, cutoutBlob: null, removeBg: true, busy: false, previewUrl: null,
  };
  let card = await api('/api/card-preview?h=178&w=74&pos=MID');

  const usedBlob = () => (state.removeBg && state.cutoutBlob ? state.cutoutBlob : state.files?.square || null);
  const setPreview = () => {
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    const b = usedBlob();
    state.previewUrl = b ? URL.createObjectURL(b) : null;
  };

  const stage = h('div', { class: 'card-stage' });
  const paint = () => fill(stage,
    renderCard({ ...state, photo_url: state.previewUrl, photo_cutout: !!(state.removeBg && state.cutoutBlob), card }, { size: 'big' }),
    h('p', { class: 'stage-note' }, 'Başlangyç sanlar boýuňyza, agramyňyza we pozisiýaňyza bagly. Her oýundan soň AI olary hakyky oýnuňyza görä täzeleýär.'),
  );
  let t;
  const refreshCard = () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      card = await api(`/api/card-preview?h=${state.height_cm || 175}&w=${state.weight_kg || 70}&pos=${state.position}`).catch(() => card);
      paint();
    }, 200);
  };
  paint();

  const err = h('div', { class: 'error-box', hidden: true });
  const input = (key, attrs) => h('input', {
    ...attrs, value: state[key] ?? '',
    oninput: (e) => { state[key] = attrs.type === 'number' ? Number(e.target.value) : e.target.value; key.endsWith('_name') ? paint() : refreshCard(); },
  });

  // --- Surat ---
  const phPreview = h('span', { class: 'ph', html: '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 7h3l2-3h6l2 3h3v13H4z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="13" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>' });
  const phTitle = h('b', {}, 'Surat ýükle');
  const phText = h('span', {}, phTitle, h('br'), h('span', { class: 'small muted' }, 'Ýüzüňiz we egniňiz görünsin. Fony özümiz aýyrarys.'));
  const status = h('span', { class: 'small muted' });
  const bgToggle = h('input', { type: 'checkbox', checked: true, 'aria-label': 'Fony aýyr' });

  async function runCutout() {
    if (!state.files || state.cutoutBlob || state.busy) return;
    state.busy = true;
    status.className = 'busy';
    status.textContent = 'Fon aýrylýar…';
    try {
      state.cutoutBlob = await removeBackground(state.files.original);
      status.className = 'small muted';
      status.textContent = 'Fon aýryldy';
    } catch (ex) {
      state.removeBg = false;
      bgToggle.checked = false;
      status.className = 'small muted';
      status.textContent = '';
      toast(ex.message);
    } finally {
      state.busy = false;
      setPreview();
      paint();
    }
  }

  bgToggle.onchange = () => {
    state.removeBg = bgToggle.checked;
    setPreview();
    paint();
    if (state.removeBg) runCutout();
  };

  const fileInput = h('input', {
    type: 'file', accept: 'image/jpeg,image/png,image/webp',
    onchange: async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        state.files = await preparePhoto(f);
        state.cutoutBlob = null;
        phPreview.style.backgroundImage = `url("${URL.createObjectURL(state.files.square)}")`;
        phPreview.innerHTML = '';
        phTitle.textContent = 'Surat saýlandy — çalyşmak';
        setPreview();
        paint();
        if (state.removeBg) runCutout();
      } catch (ex) { toast(ex.message); }
    },
  });

  const submit = h('button', { class: 'btn block', type: 'submit' }, 'Kart döret');
  const form = h('form', {
    class: 'ob-form',
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      err.hidden = true;
      if (state.busy) { toast('Fon aýrylýança garaşyň…'); return; }
      const fd = new FormData(form);
      const problems = [];
      if (state.first_name.trim().length < 2) problems.push('adyňyzy');
      if (state.last_name.trim().length < 2) problems.push('familiýaňyzy');
      if (!(state.height_cm >= 120 && state.height_cm <= 230)) problems.push('boýuňyzy (120–230 sm)');
      if (!(state.weight_kg >= 30 && state.weight_kg <= 200)) problems.push('agramyňyzy (30–200 kg)');
      if (!usedBlob()) problems.push('suratyňyzy');
      if (String(fd.get('phone')).replace(/\D/g, '').length < 6) problems.push('telefon belgiňizi');
      if (!/^\d{4,6}$/.test(String(fd.get('pin')))) problems.push('4–6 sanly PIN-kody');
      if (problems.length) {
        err.textContent = `Doldurmaly: ${problems.join(', ')}.`;
        err.hidden = false;
        err.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      const body = new FormData();
      for (const k of ['first_name', 'last_name', 'height_cm', 'weight_kg', 'position', 'foot']) body.append(k, state[k]);
      body.append('phone', fd.get('phone'));
      body.append('pin', fd.get('pin'));
      const blob = usedBlob();
      body.append('photo', blob, blob.type === 'image/png' ? 'photo.png' : 'photo.jpg');
      submit.disabled = true;
      submit.textContent = 'Döredilýär…';
      try {
        const r = await api('/api/register', { method: 'POST', form: body });
        session.token = r.token;
        session.me = r.player;
        revealView(root, r.player);
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
      } finally {
        submit.disabled = false;
        submit.textContent = 'Kart döret';
      }
    },
  },
  h('label', { class: 'photo-pick' }, phPreview, phText, fileInput),
  h('div', { class: 'photo-opts' }, h('label', { class: 'switch' }, bgToggle, 'Fony aýyr'), status),
  h('div', { class: 'grid2' },
    h('div', { class: 'field' }, h('label', { for: 'fn' }, 'Ady'), input('first_name', { id: 'fn', autocomplete: 'given-name', maxlength: 40 })),
    h('div', { class: 'field' }, h('label', { for: 'ln' }, 'Familiýasy'), input('last_name', { id: 'ln', autocomplete: 'family-name', maxlength: 40 })),
    h('div', { class: 'field' }, h('label', { for: 'hc' }, 'Boýy, sm'), input('height_cm', { id: 'hc', type: 'number', inputmode: 'numeric', min: 120, max: 230 })),
    h('div', { class: 'field' }, h('label', { for: 'wk' }, 'Agramy, kg'), input('weight_kg', { id: 'wk', type: 'number', inputmode: 'numeric', min: 30, max: 200 })),
  ),
  h('div', { class: 'field' }, h('label', {}, 'Pozisiýa'),
    seg('Pozisiýa', Object.entries(POS).map(([k, v]) => [k, v === 'Ýarym goragçy' ? 'Ýarym gor.' : v]), state.position, (v) => { state.position = v; refreshCard(); })),
  h('div', { class: 'field' }, h('label', {}, 'Esasy aýak'),
    seg('Esasy aýak', [['R', 'Sag'], ['L', 'Çep'], ['B', 'Ikisi hem']], state.foot, (v) => { state.foot = v; paint(); })),
  h('div', { class: 'grid2' },
    h('div', { class: 'field' }, h('label', { for: 'ph' }, 'Telefon belgisi'), h('input', { id: 'ph', name: 'phone', type: 'tel', autocomplete: 'tel', placeholder: '+993 6X XX XX XX' })),
    h('div', { class: 'field' }, h('label', { for: 'pin' }, 'Giriş üçin PIN-kod'), h('input', { id: 'pin', name: 'pin', type: 'password', inputmode: 'numeric', maxlength: 6, placeholder: '4–6 san', autocomplete: 'new-password' })),
  ),
  err,
  submit,
  h('p', { class: 'small muted', style: { marginTop: '14px' } }, 'Kartyňyz barmy? ', h('a', { href: '#/login' }, 'Telefon bilen giriň')),
  );

  fill(root, h('div', { class: 'onboard' },
    h('div', { class: 'ob-head' },
      h('h1', {}, 'Oýunçy kartyňyzy dörediň'),
      h('p', { class: 'lead', style: { marginTop: '10px' } },
        'Meýdançanyň üstündäki kamera oýny ýazga alýar. AI paslaryňyzy, ýalňyşlyklaryňyzy, tizligiňizi we urgularyňyzy sanaýar, MVP-ni saýlaýar.')),
    stage,
    form));
}

function revealView(root, player) {
  root.className = '';
  fill(root, h('div', { class: 'card-stage', style: { paddingTop: '8px' } },
    h('h1', { style: { textAlign: 'center' } }, `${player.first_name}, kartyňyz taýýar`),
    renderCard(player, { size: 'big', reveal: true }),
    h('p', { class: 'lead', style: { textAlign: 'center' } },
      'Bu başlangyç kart. Kameraly meýdançada 3 oýun oýnaň — sanlar siziň hakyky oýnuňyza görä täzelener.'),
    h('div', { class: 'btn-row', style: { justifyContent: 'center' } },
      h('a', { class: 'btn', href: '#/' }, 'Oýunlara geç'),
      h('button', { class: 'btn ghost', onclick: () => shareCard(player) }, 'Karty ýatda sakla'))));
  document.querySelector('#tabbar').hidden = false;
}

export async function loginView(root) {
  const err = h('div', { class: 'error-box', hidden: true });
  const btn = h('button', { class: 'btn block', type: 'submit' }, 'Gir');
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      btn.disabled = true;
      try {
        const r = await api('/api/login', { method: 'POST', body: { phone: fd.get('phone'), pin: fd.get('pin') } });
        session.token = r.token;
        session.me = r.player;
        go('/');
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
      } finally { btn.disabled = false; }
    },
  },
  h('div', { class: 'field' }, h('label', { for: 'lp' }, 'Telefon belgisi'), h('input', { id: 'lp', name: 'phone', type: 'tel', autocomplete: 'tel', required: true })),
  h('div', { class: 'field' }, h('label', { for: 'lpin' }, 'PIN-kod'), h('input', { id: 'lpin', name: 'pin', type: 'password', inputmode: 'numeric', maxlength: 6, autocomplete: 'current-password', required: true })),
  err, btn,
  h('p', { class: 'small muted', style: { marginTop: '14px' } }, 'Kartyňyz ýokmy? ', h('a', { href: '#/welcome' }, 'Dörediň')));
  fill(root, h('div', { style: { maxWidth: '420px', margin: '0 auto' } }, h('h1', { style: { marginBottom: '18px' } }, 'Giriş'), form));
}
