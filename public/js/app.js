// Маршрутизатор: #/путь → экран. Без фреймворков, чтобы проект было легко понять и доработать.
import { $, h, loading } from './ui.js';
import { api, session } from './api.js';
import { onboardView, loginView } from './views/onboard.js';
import { homeView } from './views/home.js';
import { matchView } from './views/match.js';
import { cardView, meView, playerView, topView, clipView } from './views/profile.js';
import { adminView } from './views/admin/index.js';

const routes = [
  [/^\/welcome$/, onboardView, { public: true, wide: 'onboard-wide' }],
  [/^\/login$/, loginView, { public: true }],
  [/^\/clip\/(\w+)$/, clipView, { public: true }],
  [/^\/admin(?:\/([a-z]+))?(?:\/(\d+))?$/, adminView, { public: true, wide: 'wide', admin: true }],
  [/^\/$/, homeView, { tab: 'home' }],
  [/^\/match\/(\d+)$/, matchView, { tab: 'home' }],
  [/^\/card$/, cardView, { tab: 'card' }],
  [/^\/top$/, topView, { tab: 'top' }],
  [/^\/me$/, meView, { tab: 'me' }],
  [/^\/player\/(\d+)$/, playerView, { tab: 'top' }],
];

let cleanup = null;

export async function refreshMe() {
  session.me = session.token ? await api('/api/me').catch(() => null) : null;
  return session.me;
}

/** #/admin/matches?status=ready → URLSearchParams({status: 'ready'}) */
export function routeQuery() {
  return new URLSearchParams(location.hash.split('?')[1] || '');
}

export function go(path) {
  if (location.hash === `#${path}`) render();
  else location.hash = path;
}

async function render() {
  const path = location.hash.replace(/^#/, '').split('?')[0] || '/';
  const app = $('#app');
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }

  let match = null;
  let route = null;
  for (const r of routes) {
    match = path.match(r[0]);
    if (match) { route = r; break; }
  }
  if (!route) { go('/'); return; }
  const [, view, opts] = route;

  if (!opts.public && !session.token) { go('/welcome'); return; }
  if (!opts.public && !session.me) {
    app.replaceChildren(loading());
    if (!(await refreshMe())) { go('/welcome'); return; }
  }

  app.className = opts.wide || '';
  $('#tabbar').hidden = !session.token || path === '/welcome' || path === '/login' || !!opts.admin;
  document.querySelectorAll('#tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === opts.tab));
  $('#adminLink').hidden = path.startsWith('/admin');

  app.replaceChildren(loading());
  try {
    const result = await view(app, ...match.slice(1));
    if (typeof result === 'function') cleanup = result;
  } catch (e) {
    app.replaceChildren(h('div', { class: 'empty' },
      h('p', {}, e.message || 'Bir zat ýalňyş boldy.'),
      h('a', { class: 'btn ghost', href: '#/' }, 'Baş sahypa')));
  }
  window.scrollTo(0, 0);
  app.focus({ preventScroll: true });
}

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.addEventListener('hashchange', render);
render();
