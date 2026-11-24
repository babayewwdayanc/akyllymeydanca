// Общие помощники для маршрутов игроков и админки.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import multer from 'multer';
import { DIRS } from './db.js';
import { randomId } from './auth.js';
import { cutoutPerson, cutoutAvailable } from './cutout.js';

export const HAS_FFMPEG = spawnSync('ffmpeg', ['-version']).status === 0;

/** Express 4 не ловит ошибки async-функций — оборачиваем. */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
export const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
export const httpError = (msg, status = 400) => Object.assign(new Error(msg), { status });

export const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (_req, f, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(f.mimetype)),
});
export const videoUpload = multer({
  storage: multer.diskStorage({
    destination: DIRS.videos,
    filename: (_req, f, cb) => cb(null, `${randomId(16)}${path.extname(f.originalname).toLowerCase() || '.mp4'}`),
  }),
  limits: { fileSize: 30 * 1024 ** 3 },
  fileFilter: (_req, f, cb) => cb(null, f.mimetype.startsWith('video/')),
});
export const thumbUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 64 } });

export function savePhoto(file) {
  const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype];
  const name = `${randomId(16)}${ext}`;
  fs.writeFileSync(path.join(DIRS.photos, name), file.buffer);
  return name;
}

export function removeFile(dir, name) {
  if (name) fs.rmSync(path.join(dir, path.basename(name)), { force: true });
}

export const normPhone = (p) => String(p || '').replace(/[^\d+]/g, '');

/** Проверка полей профиля игрока. partial — только присланные поля. */
export function validateProfile(b, { partial = false } = {}) {
  const out = {};
  const need = (k) => !partial || b[k] !== undefined;
  if (need('first_name')) {
    out.first_name = String(b.first_name || '').trim();
    if (out.first_name.length < 2 || out.first_name.length > 40) return { error: 'Ady: 2–40 harp' };
  }
  if (need('last_name')) {
    out.last_name = String(b.last_name || '').trim();
    if (out.last_name.length < 2 || out.last_name.length > 40) return { error: 'Familiýasy: 2–40 harp' };
  }
  if (need('height_cm')) {
    out.height_cm = Math.round(Number(b.height_cm));
    if (!(out.height_cm >= 120 && out.height_cm <= 230)) return { error: 'Boýy 120–230 sm aralygynda bolmaly' };
  }
  if (need('weight_kg')) {
    out.weight_kg = Math.round(Number(b.weight_kg));
    if (!(out.weight_kg >= 30 && out.weight_kg <= 200)) return { error: 'Agramy 30–200 kg aralygynda bolmaly' };
  }
  if (need('position')) out.position = ['GK', 'DEF', 'MID', 'FWD'].includes(b.position) ? b.position : 'MID';
  if (need('foot')) out.foot = ['R', 'L', 'B'].includes(b.foot) ? b.foot : 'R';
  return { value: out };
}

/** UPDATE по объекту полей: buildUpdate({a:1,b:2}) → { set: 'a = $1, b = $2', params: [1, 2] } */
export function buildUpdate(fields, start = 1) {
  const keys = Object.keys(fields);
  return { set: keys.map((k, i) => `${k} = $${start + i}`).join(', '), params: keys.map((k) => fields[k]), next: start + keys.length };
}

/** Убрать фон; null + ответ клиенту, если не получилось. */
export async function cutoutOr422(res, buffer) {
  if (!cutoutAvailable()) { bad(res, 'Fony aýyrmak häzir elýeterli däl', 501); return null; }
  const png = await cutoutPerson(buffer);
  if (!png) { bad(res, 'Suratda adam tapylmady. Ýüzüňiz we egniňiz görünýän surat saýlaň.', 422); return null; }
  return png;
}

export const MATCH_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
