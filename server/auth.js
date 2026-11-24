// Вход игроков (телефон + PIN), администраторов панели (логин + пароль), AI-воркера (ключ).
import crypto from 'node:crypto';
import { one, run } from './db.js';

const PROD = process.env.NODE_ENV === 'production';

// В продакшене ключ воркера обязателен — иначе любой мог бы прислать «результат анализа».
if (PROD && (process.env.WORKER_KEY || '').length < 16) {
  console.error('\n  ОШИБКА: задайте WORKER_KEY длиной от 16 символов в файле .env (сгенерировать: openssl rand -hex 24)\n');
  process.exit(1);
}
export const WORKER_KEY = process.env.WORKER_KEY || 'dev-worker-key-change-me';

/** Хэш пароля или PIN-кода (scrypt с солью). */
export function hashPin(secret) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(secret), salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPin(secret, stored) {
  const [saltHex, hashHex] = String(stored).split(':');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(String(secret), Buffer.from(saltHex, 'hex'), 32);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

export function randomId(len = 8, alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789') {
  const bytes = crypto.randomBytes(len);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

const newToken = () => crypto.randomBytes(24).toString('base64url');
const safeEqual = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// ---------- Игроки ----------
export async function createSession(playerId) {
  const token = newToken();
  await run('INSERT INTO sessions (token, player_id) VALUES ($1, $2)', [token, playerId]);
  await run('UPDATE players SET last_login_at = now() WHERE id = $1', [playerId]);
  return token;
}

const bearer = (req) => {
  const h = req.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
};

/** Достаёт игрока по токену из заголовка Authorization: Bearer <token>. Заблокированные — как не вошедшие. */
export async function attachUser(req, _res, next) {
  try {
    const token = bearer(req);
    req.user = token
      ? await one('SELECT p.* FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token = $1 AND NOT p.blocked', [token])
      : null;
    next();
  } catch (e) { next(e); }
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Hasabyňyza giriň' });
  next();
}

// ---------- Администраторы ----------
const ADMIN_SESSION_DAYS = 7;

export async function createAdminSession(adminId) {
  const token = newToken();
  await run(`INSERT INTO admin_sessions (token, admin_id, expires_at) VALUES ($1, $2, now() + interval '${ADMIN_SESSION_DAYS} days')`, [token, adminId]);
  await run('UPDATE admins SET last_login_at = now() WHERE id = $1', [adminId]);
  await run('DELETE FROM admin_sessions WHERE expires_at < now()');
  return token;
}

export async function attachAdmin(req, _res, next) {
  try {
    const token = req.get('x-admin-token');
    req.admin = token
      ? await one(`SELECT a.id, a.username, a.role FROM admin_sessions s JOIN admins a ON a.id = s.admin_id
                   WHERE s.token = $1 AND s.expires_at > now() AND a.active`, [token])
      : null;
    next();
  } catch (e) { next(e); }
}

export function requireAdmin(req, res, next) {
  if (!req.admin) return res.status(401).json({ error: 'Panele giriň' });
  next();
}

export function requireOwner(req, res, next) {
  if (req.admin?.role !== 'owner') return res.status(403).json({ error: 'Bu diňe eýesi (owner) üçin' });
  next();
}

// ---------- AI-воркер ----------
export function requireWorker(req, res, next) {
  if (!safeEqual(req.get('x-worker-key') || '', WORKER_KEY)) {
    return res.status(403).json({ error: 'AI-işçiniň açary nädogry' });
  }
  next();
}

// ---------- Ограничение частоты (подбор PIN/пароля, тяжёлые операции) ----------
export function limiter({ windowMs, max, message, key = (req) => req.ip }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, list] of hits) if (!list.some((t) => now - t < windowMs)) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now();
    const k = key(req);
    const list = (hits.get(k) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) return res.status(429).json({ error: message });
    list.push(now);
    hits.set(k, list);
    next();
  };
}
