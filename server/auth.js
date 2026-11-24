import crypto from 'node:crypto';
import { db } from './db.js';

export function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pin), salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPin(pin, stored) {
  const [saltHex, hashHex] = String(stored).split(':');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(String(pin), Buffer.from(saltHex, 'hex'), 32);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

export function createSession(playerId) {
  const token = crypto.randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO sessions (token, player_id) VALUES (?, ?)').run(token, playerId);
  return token;
}

export function randomId(len = 8, alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789') {
  const bytes = crypto.randomBytes(len);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** Достаёт игрока по токену из заголовка Authorization: Bearer <token>. */
export function attachUser(req, _res, next) {
  const h = req.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  req.user = token
    ? db.prepare('SELECT p.* FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token = ?').get(token) || null
    : null;
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Hasabyňyza giriň' });
  next();
}

export const ADMIN_KEY = process.env.ADMIN_KEY || 'admin123';
export const WORKER_KEY = process.env.WORKER_KEY || ADMIN_KEY;

export function isAdmin(req) {
  const k = req.get('x-admin-key');
  return !!k && k.length === ADMIN_KEY.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(ADMIN_KEY));
}

export function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Administratoryň açary gerek' });
  next();
}

export function requireWorker(req, res, next) {
  const k = req.get('x-worker-key') || '';
  if (k.length !== WORKER_KEY.length || !crypto.timingSafeEqual(Buffer.from(k), Buffer.from(WORKER_KEY))) {
    return res.status(403).json({ error: 'AI-işçiniň açary nädogry' });
  }
  next();
}
