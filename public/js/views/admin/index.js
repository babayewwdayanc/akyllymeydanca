// Dolandyryş paneli: giriş, menýu we bölümler.
import { h, fill, A } from './kit.js';
import { session } from '../../api.js';
import { toast } from '../../ui.js';
import { go } from '../../app.js';
import { dashboardSection } from './dashboard.js';
import { matchesSection, matchSection } from './matches.js';
import { playersSection, playerSection } from './players.js';
import { pitchesSection, clipsSection, adminsSection, logSection, accountSection } from './other.js';

const NAV = [
  ['', 'Umumy', dashboardSection],
  ['matches', 'Oýunlar', matchesSection],
  ['players', 'Oýunçylar', playersSection],
  ['pitches', 'Meýdançalar', pitchesSection],
  ['clips', 'Klipler', clipsSection],
  ['admins', 'Administratorlar', adminsSection, 'owner'],
  ['log', 'Žurnal', logSection],
  ['account', 'Hasabym', accountSection],
];
const DETAIL = { match: matchSection, player: playerSection };

function loginView(root, msg) {
  const err = h('div', { class: 'error-box', hidden: !msg }, msg || '');
  const btn = h('button', { class: 'btn block', type: 'submit' }, 'Gir');
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      btn.disabled = true;
      try {
        const r = await A('/login', { method: 'POST', body: { username: fd.get('username'), password: fd.get('password') } });
        session.adminToken = r.token;
        session.admin = r.admin;
        adminView(root);
      } catch (ex) { err.textContent = ex.message; err.hidden = false; } finally { btn.disabled = false; }
    },
  },
  h('div', { class: 'field' }, h('label', { for: 'au' }, 'Login'), h('input', { id: 'au', name: 'username', autocomplete: 'username', required: true, autocapitalize: 'none' })),
  h('div', { class: 'field' }, h('label', { for: 'ap' }, 'Parol'), h('input', { id: 'ap', name: 'password', type: 'password', autocomplete: 'current-password', required: true })),
  err, btn);
  fill(root, h('div', { class: 'admin-login' },
    h('h1', {}, 'Dolandyryş paneli'),
    h('p', { class: 'lead' }, 'Meýdança eýeleri we administratorlary üçin.'),
    form));
}

export async function adminView(root, sectionKey = '', id = null) {
  if (!session.adminToken) return loginView(root);
  try {
    session.admin = await A('/me');
  } catch (e) {
    return loginView(root, e.status === 401 ? 'Sessiýa gutardy — täzeden giriň.' : e.message);
  }
  const me = session.admin;
  const key = sectionKey || '';
  const content = h('div', { class: 'acontent' });
  const nav = h('nav', { class: 'anav', 'aria-label': 'Panel bölümleri' },
    NAV.filter(([, , , role]) => !role || me.role === role).map(([k, label]) => h('a', {
      href: `#/admin${k ? `/${k}` : ''}`,
      class: k === key || (DETAIL[key] && ((key === 'match' && k === 'matches') || (key === 'player' && k === 'players'))) ? 'active' : '',
    }, label)));

  fill(root, h('div', { class: 'ashell' },
    h('div', { class: 'ahead' },
      h('h1', {}, 'Dolandyryş paneli'),
      h('div', { class: 'auser' },
        h('span', {}, h('b', {}, me.username), ` · ${me.role === 'owner' ? 'eýesi' : 'menejer'}`),
        h('button', {
          class: 'btn ghost small',
          onclick: async () => {
            await A('/logout', { method: 'POST' }).catch(() => {});
            session.adminToken = null;
            toast('Panelden çykdyňyz');
            go('/admin');
          },
        }, 'Çyk'))),
    nav, content));

  const render = DETAIL[key] || NAV.find(([k]) => k === key)?.[2];
  if (!render) return go('/admin');
  try {
    await render(content, id ? Number(id) : null);
  } catch (e) {
    fill(content, h('div', { class: 'error-box' }, e.message));
  }
}
