import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { db, DIRS } from './db.js';
import {
  hashPin, verifyPin, createSession, randomId, attachUser, requireUser, requireAdmin, requireWorker, isAdmin, ADMIN_KEY,
} from './auth.js';
import { playerPublic, playerMini } from './players.js';
import { matchSummary, matchDetail } from './matchView.js';
import { ingestAnalysis, loadReplay } from './ingest.js';
import { simulateMatch } from './demoAnalysis.js';
import { seedDemo, DEMO_MODE } from './seed.js';
import { summaryAvailable, generateMatchSummary } from './summary.js';
import { cutoutPerson, cutoutAvailable } from './cutout.js';
import { buildCard, EMPTY_AGG } from './rating.js';

const PORT = Number(process.env.PORT || 3000);
const HAS_FFMPEG = spawnSync('ffmpeg', ['-version']).status === 0;

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '60mb' })); // результат анализа с координатами может быть большим
app.use(attachUser);

// ---------- Файлы ----------
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (_req, f, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(f.mimetype)),
});
const videoUpload = multer({
  storage: multer.diskStorage({
    destination: DIRS.videos,
    filename: (_req, f, cb) => cb(null, `${randomId(16)}${path.extname(f.originalname).toLowerCase() || '.mp4'}`),
  }),
  limits: { fileSize: 30 * 1024 ** 3 },
  fileFilter: (_req, f, cb) => cb(null, f.mimetype.startsWith('video/')),
});
const thumbUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 64 } });

function savePhoto(file) {
  const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype];
  const name = `${randomId(16)}${ext}`;
  fs.writeFileSync(path.join(DIRS.photos, name), file.buffer);
  return name;
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

// ---------- Регистрация и вход ----------
function validateProfile(b, { partial = false } = {}) {
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
  if (need('position')) {
    out.position = ['GK', 'DEF', 'MID', 'FWD'].includes(b.position) ? b.position : 'MID';
  }
  if (need('foot')) {
    out.foot = ['R', 'L', 'B'].includes(b.foot) ? b.foot : 'R';
  }
  return { value: out };
}

const normPhone = (p) => String(p || '').replace(/[^\d+]/g, '');

app.post('/api/register', photoUpload.single('photo'), wrap(async (req, res) => {
  const { value, error } = validateProfile(req.body);
  if (error) return bad(res, error);
  const phone = normPhone(req.body.phone);
  if (phone.length < 6) return bad(res, 'Telefon belgiňizi ýazyň');
  const pin = String(req.body.pin || '');
  if (!/^\d{4,6}$/.test(pin)) return bad(res, 'PIN-kod 4–6 sanly bolmaly');
  if (!req.file) return bad(res, 'Surat ýükläň (JPG, PNG ýa-da WEBP, 6 MB-a çenli)');
  if (db.prepare('SELECT 1 FROM players WHERE phone = ?').get(phone)) return bad(res, 'Bu belgi eýýäm hasaba alnan — PIN-kod bilen giriň', 409);

  const photo = savePhoto(req.file);
  const r = db.prepare(`INSERT INTO players (first_name, last_name, height_cm, weight_kg, position, foot, phone, pin_hash, photo)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(value.first_name, value.last_name, value.height_cm, value.weight_kg, value.position, value.foot, phone, hashPin(pin), photo);
  const id = Number(r.lastInsertRowid);
  if (DEMO_MODE) {
    // В демо-режиме новый игрок сразу видит демо-матчи, чтобы было что посмотреть.
    for (const m of db.prepare("SELECT id FROM matches WHERE code LIKE 'DEMO%'").all()) {
      db.prepare('INSERT OR IGNORE INTO match_members (match_id, player_id) VALUES (?, ?)').run(m.id, id);
    }
  }
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(id);
  res.status(201).json({ token: createSession(id), player: playerPublic(player, { withHistory: true }) });
}));

app.post('/api/login', wrap(async (req, res) => {
  const phone = normPhone(req.body.phone);
  const p = db.prepare('SELECT * FROM players WHERE phone = ?').get(phone);
  if (!p || !verifyPin(req.body.pin || '', p.pin_hash)) return bad(res, 'Telefon belgisi ýa-da PIN-kod nädogry', 401);
  res.json({ token: createSession(p.id), player: playerPublic(p, { withHistory: true }) });
}));

app.post('/api/logout', requireUser, (req, res) => {
  const token = (req.get('authorization') || '').slice(7);
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.json({ ok: true });
});

app.get('/api/me', requireUser, (req, res) => res.json(playerPublic(req.user, { withHistory: true })));

// ---------- Удаление фона с фото (для FC-карты) ----------
const cutoutHits = new Map(); // простой лимит: 20 фото за 10 минут с одного IP
function cutoutLimit(req, res, next) {
  const now = Date.now();
  const list = (cutoutHits.get(req.ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (list.length >= 20) return bad(res, 'Gaty köp synanyşyk — birazdan gaýtalaň', 429);
  list.push(now);
  cutoutHits.set(req.ip, list);
  next();
}

async function cutoutOr422(res, buffer) {
  if (!cutoutAvailable()) { bad(res, 'Fony aýyrmak häzir elýeterli däl', 501); return null; }
  const png = await cutoutPerson(buffer);
  if (!png) { bad(res, 'Suratda adam tapylmady. Ýüzüňiz we egniňiz görünýän surat saýlaň.', 422); return null; }
  return png;
}

app.post('/api/photo/cutout', cutoutLimit, photoUpload.single('photo'), wrap(async (req, res) => {
  if (!req.file) return bad(res, 'Surat ýükläň (JPG, PNG ýa-da WEBP, 6 MB-a çenli)');
  const png = await cutoutOr422(res, req.file.buffer);
  if (png) res.type('image/png').send(png);
}));

// Уже загруженное фото: убрать фон и сохранить
app.post('/api/me/photo/cutout', requireUser, cutoutLimit, wrap(async (req, res) => {
  if (!req.user.photo) return bad(res, 'Ilki surat ýükläň');
  const png = await cutoutOr422(res, fs.readFileSync(path.join(DIRS.photos, req.user.photo)));
  if (!png) return;
  const name = savePhoto({ mimetype: 'image/png', buffer: png });
  db.prepare('UPDATE players SET photo = ? WHERE id = ?').run(name, req.user.id);
  res.json(playerPublic(db.prepare('SELECT * FROM players WHERE id = ?').get(req.user.id), { withHistory: true }));
}));

app.put('/api/me', requireUser, photoUpload.single('photo'), (req, res) => {
  const { value, error } = validateProfile(req.body, { partial: true });
  if (error) return bad(res, error);
  if (req.file) value.photo = savePhoto(req.file);
  const keys = Object.keys(value);
  if (keys.length) {
    db.prepare(`UPDATE players SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => value[k]), req.user.id);
  }
  res.json(playerPublic(db.prepare('SELECT * FROM players WHERE id = ?').get(req.user.id), { withHistory: true }));
});

// Предпросмотр стартовой карточки во время регистрации (формула одна — на сервере).
app.get('/api/card-preview', (req, res) => {
  const { value } = validateProfile({ first_name: 'xx', last_name: 'xx', height_cm: req.query.h || 175, weight_kg: req.query.w || 70, position: req.query.pos, foot: 'R' });
  res.json(buildCard(value || { height_cm: 175, weight_kg: 70, position: 'MID' }, EMPTY_AGG, 0));
});

// ---------- Игроки и рейтинг ----------
app.get('/api/players/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM players WHERE id = ?').get(Number(req.params.id));
  if (!p) return bad(res, 'Oýunçy tapylmady', 404);
  res.json(playerPublic(p, { withHistory: true }));
});

const BOARDS = {
  ovr: { title: 'Umumy reýting', get: (p) => p.card.ovr },
  goals: { title: 'Gollar', get: (p) => p.totals.goals },
  assists: { title: 'Gol paslary', get: (p) => p.totals.assists },
  mvp: { title: 'MVP sany', get: (p) => p.totals.mvp },
  speed: { title: 'Iň ýokary tizlik', get: (p) => p.totals.top_speed_kmh, unit: 'km/sag' },
  shot: { title: 'Iň güýçli urgy', get: (p) => p.totals.max_shot_kmh, unit: 'km/sag' },
  distance: { title: 'Ylgan aralyk', get: (p) => p.totals.distance_km, unit: 'km' },
};

app.get('/api/leaderboard', (req, res) => {
  const by = BOARDS[req.query.by] ? req.query.by : 'ovr';
  const all = db.prepare('SELECT * FROM players').all().map((p) => playerPublic(p));
  const rows = all
    .filter((p) => by === 'ovr' || p.totals.matches > 0)
    .map((p) => ({ id: p.id, name: `${p.first_name} ${p.last_name}`, photo_url: p.photo_url, photo_cutout: p.photo_cutout, value: BOARDS[by].get(p), ovr: p.card.ovr, tier: p.card.tier, matches: p.totals.matches, position: p.position }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 50);
  res.json({ by, title: BOARDS[by].title, unit: BOARDS[by].unit || '', boards: Object.fromEntries(Object.entries(BOARDS).map(([k, v]) => [k, v.title])), rows });
});

// ---------- Матчи ----------
function canSeeMatch(req, matchId) {
  if (isAdmin(req)) return true;
  if (!req.user) return false;
  return !!db.prepare('SELECT 1 FROM match_members WHERE match_id = ? AND player_id = ?').get(matchId, req.user.id);
}

function getMatchOr404(req, res) {
  const m = db.prepare('SELECT * FROM matches WHERE id = ?').get(Number(req.params.id));
  if (!m) { bad(res, 'Oýun tapylmady', 404); return null; }
  if (!canSeeMatch(req, m.id)) { bad(res, 'Oýny açmak üçin onuň koduny ýazyň', 403); return null; }
  return m;
}

app.get('/api/matches/mine', requireUser, (req, res) => {
  const rows = db.prepare(`SELECT m.* FROM matches m JOIN match_members mm ON mm.match_id = m.id WHERE mm.player_id = ? ORDER BY m.starts_at DESC`).all(req.user.id);
  res.json(rows.map((m) => {
    const s = matchSummary(m);
    const t = db.prepare('SELECT track_no, rating, goals FROM tracks WHERE match_id = ? AND player_id = ?').get(m.id, req.user.id);
    return { ...s, my: t || null };
  }));
});

app.post('/api/matches/join', requireUser, (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const m = db.prepare('SELECT * FROM matches WHERE code = ?').get(code);
  if (!m) return bad(res, 'Bu kod bilen oýun tapylmady. Kod meýdançadaky tagtada ýa-da administratorda bar.', 404);
  db.prepare('INSERT OR IGNORE INTO match_members (match_id, player_id) VALUES (?, ?)').run(m.id, req.user.id);
  res.json({ id: m.id });
});

app.get('/api/matches/:id', (req, res) => {
  const m = getMatchOr404(req, res);
  if (!m) return;
  res.json({ ...matchDetail(m, req.user?.id), summary_available: summaryAvailable() });
});

app.get('/api/matches/:id/replay', (req, res) => {
  const m = getMatchOr404(req, res);
  if (!m) return;
  const r = loadReplay(m.id);
  if (!r) return bad(res, 'Gaýtalama entek taýýar däl', 404);
  res.json(r);
});

app.post('/api/matches/:id/claim', requireUser, (req, res) => {
  const m = getMatchOr404(req, res);
  if (!m) return;
  const trackNo = Number(req.body.track_no);
  const t = db.prepare('SELECT * FROM tracks WHERE match_id = ? AND track_no = ?').get(m.id, trackNo);
  if (!t) return bad(res, 'Bu oýunda beýle oýunçy ýok', 404);
  if (t.player_id && t.player_id !== req.user.id) return bad(res, 'Bu oýunçyny eýýäm başga biri saýlady. Ýalňyşlyk bolsa, meýdança administratoryna ýazyň.', 409);
  db.prepare('UPDATE tracks SET player_id = NULL WHERE match_id = ? AND player_id = ?').run(m.id, req.user.id);
  db.prepare('UPDATE tracks SET player_id = ? WHERE match_id = ? AND track_no = ?').run(req.user.id, m.id, trackNo);
  res.json(matchDetail(m, req.user.id));
});

app.delete('/api/matches/:id/claim', requireUser, (req, res) => {
  const m = getMatchOr404(req, res);
  if (!m) return;
  db.prepare('UPDATE tracks SET player_id = NULL WHERE match_id = ? AND player_id = ?').run(m.id, req.user.id);
  res.json(matchDetail(m, req.user.id));
});

app.post('/api/matches/:id/vote', requireUser, (req, res) => {
  const m = getMatchOr404(req, res);
  if (!m) return;
  const trackNo = Number(req.body.track_no);
  const t = db.prepare('SELECT * FROM tracks WHERE match_id = ? AND track_no = ?').get(m.id, trackNo);
  if (!t) return bad(res, 'Bu oýunda beýle oýunçy ýok', 404);
  if (t.player_id === req.user.id) return bad(res, 'Özüňe ses berip bolmaýar');
  db.prepare('INSERT INTO votes (match_id, voter_id, track_no) VALUES (?,?,?) ON CONFLICT(match_id, voter_id) DO UPDATE SET track_no = excluded.track_no').run(m.id, req.user.id, trackNo);
  res.json(matchDetail(m, req.user.id));
});

app.post('/api/matches/:id/summary', requireUser, wrap(async (req, res) => {
  const m = getMatchOr404(req, res);
  if (!m) return;
  if (!summaryAvailable()) return bad(res, 'AI syny sazlanmadyk: serwerde ANTHROPIC_API_KEY goýuň', 501);
  const text = await generateMatchSummary(matchDetail(m, null));
  res.json({ text });
}));

// ---------- Клипы ----------
function clipPayload(c) {
  const m = db.prepare('SELECT * FROM matches WHERE id = ?').get(c.match_id);
  const author = c.player_id ? db.prepare('SELECT * FROM players WHERE id = ?').get(c.player_id) : null;
  return {
    id: c.id, title: c.title, start_s: c.start_s, end_s: c.end_s, views: c.views, created_at: c.created_at,
    author: playerMini(author),
    match: matchSummary(m),
    has_replay: fs.existsSync(path.join(DIRS.analysis, `${m.id}.json`)),
    can_download: HAS_FFMPEG && !!m.video_file,
  };
}

app.post('/api/clips', requireUser, (req, res) => {
  const matchId = Number(req.body.match_id);
  const m = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!m || !canSeeMatch(req, matchId)) return bad(res, 'Oýun tapylmady', 404);
  const start = Math.max(0, Number(req.body.start_s));
  const end = Number(req.body.end_s);
  if (!(end > start)) return bad(res, 'Klipiň soňy başyndan soň bolmaly');
  if (end - start > 120) return bad(res, 'Klip 2 minutdan uzyn bolmaly däl');
  const title = String(req.body.title || '').trim().slice(0, 80) || 'Meniň pursadym';
  const id = randomId(8);
  db.prepare('INSERT INTO clips (id, match_id, player_id, title, start_s, end_s) VALUES (?,?,?,?,?,?)').run(id, matchId, req.user.id, title, start, end);
  res.status(201).json(clipPayload(db.prepare('SELECT * FROM clips WHERE id = ?').get(id)));
});

app.get('/api/me/clips', requireUser, (req, res) => {
  res.json(db.prepare('SELECT * FROM clips WHERE player_id = ? ORDER BY created_at DESC').all(req.user.id).map(clipPayload));
});

app.delete('/api/clips/:id', requireUser, (req, res) => {
  const r = db.prepare('DELETE FROM clips WHERE id = ? AND player_id = ?').run(req.params.id, req.user.id);
  if (!r.changes) return bad(res, 'Klip tapylmady', 404);
  res.json({ ok: true });
});

// Клип открывается по ссылке без входа — им делятся в мессенджерах.
app.get('/api/clips/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM clips WHERE id = ?').get(req.params.id);
  if (!c) return bad(res, 'Klip tapylmady', 404);
  db.prepare('UPDATE clips SET views = views + 1 WHERE id = ?').run(c.id);
  res.json(clipPayload({ ...c, views: c.views + 1 }));
});

app.get('/api/clips/:id/replay', (req, res) => {
  const c = db.prepare('SELECT * FROM clips WHERE id = ?').get(req.params.id);
  if (!c) return bad(res, 'Klip tapylmady', 404);
  const r = loadReplay(c.match_id);
  if (!r) return bad(res, 'Gaýtalama elýeterli däl', 404);
  const from = Math.floor(c.start_s * r.frames_hz);
  const to = Math.ceil(c.end_s * r.frames_hz) + 1;
  const tracks = db.prepare('SELECT track_no, team, jersey FROM tracks WHERE match_id = ?').all(c.match_id);
  res.json({ ...r, frames: r.frames.slice(from, to), tracks });
});

// Настоящая нарезка mp4 — через ffmpeg (если установлен на сервере).
app.get('/api/clips/:id/download', (req, res) => {
  const c = db.prepare('SELECT * FROM clips WHERE id = ?').get(req.params.id);
  if (!c) return bad(res, 'Klip tapylmady', 404);
  const m = db.prepare('SELECT * FROM matches WHERE id = ?').get(c.match_id);
  if (!HAS_FFMPEG || !m.video_file) return bad(res, 'Ýükläp almak elýeterli däl: serwerde ffmpeg ýa-da oýnuň wideosy ýok', 501);
  const out = path.join(DIRS.clips, `${c.id}.mp4`);
  const send = () => res.download(out, `akylly-${c.id}.mp4`);
  if (fs.existsSync(out)) return send();
  const p = spawn('ffmpeg', ['-y', '-ss', String(c.start_s), '-i', path.join(DIRS.videos, m.video_file), '-t', String(c.end_s - c.start_s),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-movflags', '+faststart', out]);
  p.on('close', (code) => (code === 0 ? send() : bad(res, 'Wideony kesip bolmady', 500)));
});

// ---------- Админ-панель поля ----------
app.get('/api/admin/overview', requireAdmin, (_req, res) => {
  res.json({
    pitches: db.prepare('SELECT * FROM pitches ORDER BY id').all(),
    matches: db.prepare('SELECT * FROM matches ORDER BY starts_at DESC').all().map((m) => ({
      ...matchSummary(m),
      members: db.prepare('SELECT COUNT(*) AS n FROM match_members WHERE match_id = ?').get(m.id).n,
    })),
    ffmpeg: HAS_FFMPEG,
    summary: summaryAvailable(),
  });
});

app.post('/api/admin/pitches', requireAdmin, (req, res) => {
  const b = req.body;
  if (!String(b.name || '').trim()) return bad(res, 'Meýdançanyň adyny ýazyň');
  let calibration = null;
  if (b.calibration) {
    try { calibration = JSON.stringify(typeof b.calibration === 'string' ? JSON.parse(b.calibration) : b.calibration); } catch { return bad(res, 'Kalibrlemek: JSON nädogry'); }
  }
  const r = db.prepare('INSERT INTO pitches (name, city, address, length_m, width_m, calibration) VALUES (?,?,?,?,?,?)')
    .run(String(b.name).trim(), String(b.city || ''), String(b.address || ''), Number(b.length_m) || 40, Number(b.width_m) || 20, calibration);
  res.status(201).json(db.prepare('SELECT * FROM pitches WHERE id = ?').get(Number(r.lastInsertRowid)));
});

app.post('/api/admin/matches', requireAdmin, (req, res) => {
  const b = req.body;
  const pitch = db.prepare('SELECT * FROM pitches WHERE id = ?').get(Number(b.pitch_id));
  if (!pitch) return bad(res, 'Meýdança saýlaň');
  const starts = new Date(b.starts_at || Date.now());
  if (Number.isNaN(starts.getTime())) return bad(res, 'Başlanýan wagty nädogry');
  let code;
  do code = randomId(6, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'); while (db.prepare('SELECT 1 FROM matches WHERE code = ?').get(code));
  const r = db.prepare(`INSERT INTO matches (pitch_id, code, starts_at, duration_min, players_per_side, team_a_name, team_a_color, team_b_name, team_b_color)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(pitch.id, code, starts.toISOString(), Number(b.duration_min) || 60, Math.min(11, Math.max(4, Number(b.players_per_side) || 6)),
    String(b.team_a_name || 'A topar'), String(b.team_a_color || '#E4E7F0'), String(b.team_b_name || 'B topar'), String(b.team_b_color || '#C8232C'));
  res.status(201).json(matchSummary(db.prepare('SELECT * FROM matches WHERE id = ?').get(Number(r.lastInsertRowid))));
});

app.post('/api/admin/matches/:id/video', requireAdmin, videoUpload.single('video'), (req, res) => {
  const m = db.prepare('SELECT * FROM matches WHERE id = ?').get(Number(req.params.id));
  if (!m) return bad(res, 'Oýun tapylmady', 404);
  if (!req.file) return bad(res, 'Wideo faýl ýükläň (mp4)');
  if (m.video_file) fs.rmSync(path.join(DIRS.videos, m.video_file), { force: true });
  db.prepare("UPDATE matches SET video_file = ?, status = CASE WHEN status = 'scheduled' THEN 'uploaded' ELSE status END WHERE id = ?").run(req.file.filename, m.id);
  res.json(matchSummary(db.prepare('SELECT * FROM matches WHERE id = ?').get(m.id)));
});

app.post('/api/admin/matches/:id/analyze', requireAdmin, (req, res) => {
  const m = db.prepare('SELECT * FROM matches WHERE id = ?').get(Number(req.params.id));
  if (!m) return bad(res, 'Oýun tapylmady', 404);
  const pitch = db.prepare('SELECT * FROM pitches WHERE id = ?').get(m.pitch_id);
  if (req.body.mode === 'ai') {
    if (!m.video_file) return bad(res, 'Ilki oýnuň wideosyny ýükläň');
    db.prepare("UPDATE matches SET status = 'queued', error = NULL WHERE id = ?").run(m.id);
    return res.json({ queued: true, message: 'Oýun nobata goýuldy. Ony AI-işçi (ai/worker.py) alar.' });
  }
  const a = simulateMatch({ durationS: m.duration_min * 60, perSide: m.players_per_side, length: pitch.length_m, width: pitch.width_m, seed: m.id });
  res.json(ingestAnalysis(m.id, a));
});

// Загрузить готовый JSON анализа вручную (например, после запуска ai/analyze.py на своём компьютере)
app.post('/api/admin/matches/:id/result', requireAdmin, (req, res) => {
  res.json(ingestAnalysis(Number(req.params.id), req.body));
});

app.post('/api/admin/matches/:id/score', requireAdmin, (req, res) => {
  const a = Number(req.body.score_a);
  const b = Number(req.body.score_b);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return bad(res, 'Hasap 0-dan uly bitin san bolmaly');
  db.prepare('UPDATE matches SET score_a = ?, score_b = ? WHERE id = ?').run(a, b, Number(req.params.id));
  res.json({ ok: true });
});

app.delete('/api/admin/matches/:id', requireAdmin, (req, res) => {
  const m = db.prepare('SELECT * FROM matches WHERE id = ?').get(Number(req.params.id));
  if (!m) return bad(res, 'Oýun tapylmady', 404);
  if (m.video_file) fs.rmSync(path.join(DIRS.videos, m.video_file), { force: true });
  fs.rmSync(path.join(DIRS.analysis, `${m.id}.json`), { force: true });
  fs.rmSync(path.join(DIRS.thumbs, String(m.id)), { recursive: true, force: true });
  db.prepare('DELETE FROM matches WHERE id = ?').run(m.id);
  res.json({ ok: true });
});

// ---------- API для AI-воркера (GPU-компьютер у поля или в облаке) ----------
app.post('/api/worker/next', requireWorker, (_req, res) => {
  const m = db.prepare("SELECT * FROM matches WHERE status = 'queued' ORDER BY created_at LIMIT 1").get();
  if (!m) return res.status(204).end();
  db.prepare("UPDATE matches SET status = 'processing' WHERE id = ?").run(m.id);
  const pitch = db.prepare('SELECT * FROM pitches WHERE id = ?').get(m.pitch_id);
  res.json({
    match_id: m.id,
    duration_min: m.duration_min,
    players_per_side: m.players_per_side,
    team_colors: { A: m.team_a_color, B: m.team_b_color },
    pitch: { length_m: pitch.length_m, width_m: pitch.width_m, calibration: pitch.calibration ? JSON.parse(pitch.calibration) : null },
    video_path: `/api/worker/matches/${m.id}/video`,
  });
});

app.get('/api/worker/matches/:id/video', requireWorker, (req, res) => {
  const m = db.prepare('SELECT * FROM matches WHERE id = ?').get(Number(req.params.id));
  if (!m?.video_file) return bad(res, 'Wideo ýok', 404);
  res.sendFile(path.join(DIRS.videos, m.video_file));
});

app.post('/api/worker/matches/:id/result', requireWorker, (req, res) => {
  res.json(ingestAnalysis(Number(req.params.id), req.body));
});

app.post('/api/worker/matches/:id/thumbs', requireWorker, thumbUpload.any(), (req, res) => {
  const id = Number(req.params.id);
  const dir = path.join(DIRS.thumbs, String(id));
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const f of req.files || []) {
    const mt = /^track_(\d+)$/.exec(f.fieldname);
    if (!mt || !/^image\/jpe?g$/.test(f.mimetype)) continue;
    const name = `track_${mt[1]}.jpg`;
    fs.writeFileSync(path.join(dir, name), f.buffer);
    db.prepare('UPDATE tracks SET thumbnail = ? WHERE match_id = ? AND track_no = ?').run(name, id, Number(mt[1]));
    n++;
  }
  res.json({ saved: n });
});

app.post('/api/worker/matches/:id/fail', requireWorker, (req, res) => {
  db.prepare("UPDATE matches SET status = 'failed', error = ? WHERE id = ?").run(String(req.body.error || 'Derňewde ýalňyşlyk').slice(0, 500), Number(req.params.id));
  res.json({ ok: true });
});

// ---------- Статика ----------
app.use('/media/photos', express.static(DIRS.photos, { maxAge: '30d', immutable: true }));
app.use('/media/videos', express.static(DIRS.videos)); // поддерживает перемотку (HTTP Range)
app.use('/media/thumbs', express.static(DIRS.thumbs));
app.use(express.static(path.resolve('public')));
app.get(/^\/(?!api\/|media\/).*/, (_req, res) => res.sendFile(path.resolve('public/index.html')));

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) return bad(res, err.code === 'LIMIT_FILE_SIZE' ? 'Faýl gaty uly' : err.message);
  console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Serwerde ýalňyşlyk' });
});

seedDemo();
app.listen(PORT, () => {
  console.log(`\n  Akylly Meýdança запущен: http://localhost:${PORT}`);
  console.log(`  Админ-панель:            http://localhost:${PORT}/#/admin  (ключ: ${process.env.ADMIN_KEY ? 'из ADMIN_KEY' : ADMIN_KEY})`);
  console.log(`  ffmpeg: ${HAS_FFMPEG ? 'есть — клипы можно скачивать mp4' : 'нет — клипы работают как отрезки видео'}`);
  console.log(`  AI-обзор матча (Claude): ${summaryAvailable() ? 'включён' : 'выключен (нет ANTHROPIC_API_KEY)'}`);
  console.log(`  Удаление фона с фото: ${cutoutAvailable() ? 'включено' : 'выключено — запустите npm run models'}\n`);
});
