import './env.js';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import multer from 'multer';
import { q, one, run, DIRS, migrate, pool } from './db.js';
import {
  hashPin, verifyPin, createSession, randomId, attachUser, requireUser, attachAdmin, requireWorker, limiter,
} from './auth.js';
import { playerPublic, playerFull, aggregatesFor, playerMini, getPlayer } from './players.js';
import { matchSummary, matchDetail, getMatch, getMatchByCode, MATCH_SELECT } from './matchView.js';
import { ingestAnalysis, loadReplay } from './ingest.js';
import { ensureAdmin, seedDemo, DEMO_MODE } from './seed.js';
import { summaryAvailable, generateMatchSummary } from './summary.js';
import { cutoutAvailable } from './cutout.js';
import { buildCard, EMPTY_AGG } from './rating.js';
import {
  wrap, bad, photoUpload, thumbUpload, savePhoto, normPhone, validateProfile, buildUpdate, cutoutOr422, HAS_FFMPEG,
} from './common.js';
import { adminRouter } from './admin.js';

const PORT = Number(process.env.PORT || 3000);
// За Nginx слушаем только 127.0.0.1, чтобы сервер не был виден из интернета напрямую.
const HOST = process.env.HOST || undefined;

const app = express();
app.disable('x-powered-by');
// TRUST_PROXY=1 — сервер стоит за Nginx: настоящий IP игрока берётся из X-Forwarded-For
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
app.use(express.json({ limit: '60mb' })); // результат анализа с координатами может быть большим
app.use(attachUser);
app.use(attachAdmin);

const loginLimit = limiter({ windowMs: 15 * 60 * 1000, max: 10, message: 'Gaty köp synanyşyk. 15 minutdan gaýtalaň.' });
const registerLimit = limiter({ windowMs: 60 * 60 * 1000, max: 10, message: 'Gaty köp hasaba alyş. Birazdan gaýtalaň.' });
const cutoutLimit = limiter({ windowMs: 10 * 60 * 1000, max: 20, message: 'Gaty köp synanyşyk — birazdan gaýtalaň' });

// Проверка, что сервер и база живы (для мониторинга)
app.get('/api/health', wrap(async (_req, res) => {
  await one('SELECT 1');
  res.json({ ok: true });
}));

// Предпросмотр стартовой карточки во время регистрации (формула одна — на сервере)
app.get('/api/card-preview', (req, res) => {
  const { value } = validateProfile({ first_name: 'xx', last_name: 'xx', height_cm: req.query.h || 175, weight_kg: req.query.w || 70, position: req.query.pos, foot: 'R' });
  res.json(buildCard(value || { height_cm: 175, weight_kg: 70, position: 'MID' }, EMPTY_AGG, 0));
});

// ---------- Регистрация и вход ----------
app.post('/api/register', registerLimit, photoUpload.single('photo'), wrap(async (req, res) => {
  const { value, error } = validateProfile(req.body);
  if (error) return bad(res, error);
  const phone = normPhone(req.body.phone);
  if (phone.length < 6) return bad(res, 'Telefon belgiňizi ýazyň');
  const pin = String(req.body.pin || '');
  if (!/^\d{4,6}$/.test(pin)) return bad(res, 'PIN-kod 4–6 sanly bolmaly');
  if (!req.file) return bad(res, 'Surat ýükläň (JPG, PNG ýa-da WEBP, 6 MB-a çenli)');
  if (await one('SELECT 1 FROM players WHERE phone = $1', [phone])) return bad(res, 'Bu belgi eýýäm hasaba alnan — PIN-kod bilen giriň', 409);

  const photo = savePhoto(req.file);
  const p = await one(`INSERT INTO players (first_name, last_name, height_cm, weight_kg, position, foot, phone, pin_hash, photo)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
  [value.first_name, value.last_name, value.height_cm, value.weight_kg, value.position, value.foot, phone, hashPin(pin), photo]);
  if (DEMO_MODE) {
    // В демо-режиме новый игрок сразу видит демо-матчи
    await run(`INSERT INTO match_members (match_id, player_id) SELECT id, $1 FROM matches WHERE code LIKE 'DEMO%' ON CONFLICT DO NOTHING`, [p.id]);
  }
  res.status(201).json({ token: await createSession(p.id), player: await playerFull(p) });
}));

app.post('/api/login', loginLimit, wrap(async (req, res) => {
  const p = await one('SELECT * FROM players WHERE phone = $1', [normPhone(req.body.phone)]);
  if (!p || !verifyPin(req.body.pin || '', p.pin_hash)) return bad(res, 'Telefon belgisi ýa-da PIN-kod nädogry', 401);
  if (p.blocked) return bad(res, 'Hasabyňyz petiklendi. Meýdança administratoryna ýüz tutuň.', 403);
  res.json({ token: await createSession(p.id), player: await playerFull(p) });
}));

app.post('/api/logout', requireUser, wrap(async (req, res) => {
  await run('DELETE FROM sessions WHERE token = $1', [(req.get('authorization') || '').slice(7)]);
  res.json({ ok: true });
}));

app.get('/api/me', requireUser, wrap(async (req, res) => res.json(await playerFull(req.user))));

app.put('/api/me', requireUser, photoUpload.single('photo'), wrap(async (req, res) => {
  const { value, error } = validateProfile(req.body, { partial: true });
  if (error) return bad(res, error);
  delete value.first_name; // имя и фамилию меняет только администратор (чтобы не подменяли чужие карточки)
  delete value.last_name;
  if (req.file) value.photo = savePhoto(req.file);
  if (Object.keys(value).length) {
    const u = buildUpdate(value);
    await run(`UPDATE players SET ${u.set} WHERE id = $${u.next}`, [...u.params, req.user.id]);
  }
  res.json(await playerFull(await getPlayer(req.user.id)));
}));

// ---------- Удаление фона с фото (для FC-карты) ----------
app.post('/api/photo/cutout', cutoutLimit, photoUpload.single('photo'), wrap(async (req, res) => {
  if (!req.file) return bad(res, 'Surat ýükläň (JPG, PNG ýa-da WEBP, 6 MB-a çenli)');
  const png = await cutoutOr422(res, req.file.buffer);
  if (png) res.type('image/png').send(png);
}));

app.post('/api/me/photo/cutout', requireUser, cutoutLimit, wrap(async (req, res) => {
  if (!req.user.photo) return bad(res, 'Ilki surat ýükläň');
  const png = await cutoutOr422(res, fs.readFileSync(path.join(DIRS.photos, req.user.photo)));
  if (!png) return;
  await run('UPDATE players SET photo = $1 WHERE id = $2', [savePhoto({ mimetype: 'image/png', buffer: png }), req.user.id]);
  res.json(await playerFull(await getPlayer(req.user.id)));
}));

// ---------- Игроки и рейтинг ----------
app.get('/api/players/:id', wrap(async (req, res) => {
  const p = await one('SELECT * FROM players WHERE id = $1 AND NOT blocked', [Number(req.params.id) || 0]);
  if (!p) return bad(res, 'Oýunçy tapylmady', 404);
  res.json(await playerFull(p));
}));

const BOARDS = {
  ovr: { title: 'Umumy reýting', get: (p) => p.card.ovr },
  goals: { title: 'Gollar', get: (p) => p.totals.goals },
  assists: { title: 'Gol paslary', get: (p) => p.totals.assists },
  mvp: { title: 'MVP sany', get: (p) => p.totals.mvp },
  speed: { title: 'Iň ýokary tizlik', get: (p) => p.totals.top_speed_kmh, unit: 'km/sag' },
  shot: { title: 'Iň güýçli urgy', get: (p) => p.totals.max_shot_kmh, unit: 'km/sag' },
  distance: { title: 'Ylgan aralyk', get: (p) => p.totals.distance_km, unit: 'km' },
};

app.get('/api/leaderboard', wrap(async (req, res) => {
  const by = BOARDS[req.query.by] ? req.query.by : 'ovr';
  const players = await q('SELECT * FROM players WHERE NOT blocked');
  const aggs = await aggregatesFor(players.map((p) => p.id));
  const rows = players.map((p) => playerPublic(p, aggs.get(p.id)))
    .filter((p) => by === 'ovr' || p.totals.matches > 0)
    .map((p) => ({ id: p.id, name: `${p.first_name} ${p.last_name}`, photo_url: p.photo_url, photo_cutout: p.photo_cutout, value: BOARDS[by].get(p), ovr: p.card.ovr, tier: p.card.tier, matches: p.totals.matches, position: p.position }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 50);
  res.json({ by, title: BOARDS[by].title, unit: BOARDS[by].unit || '', boards: Object.fromEntries(Object.entries(BOARDS).map(([k, v]) => [k, v.title])), rows });
}));

// ---------- Матчи ----------
async function canSeeMatch(req, matchId) {
  if (req.admin) return true;
  if (!req.user) return false;
  return !!(await one('SELECT 1 FROM match_members WHERE match_id = $1 AND player_id = $2', [matchId, req.user.id]));
}

async function getVisibleMatch(req, res) {
  const m = await getMatch(Number(req.params.id) || 0);
  if (!m) { bad(res, 'Oýun tapylmady', 404); return null; }
  if (!(await canSeeMatch(req, m.id))) { bad(res, 'Oýny açmak üçin onuň koduny ýazyň', 403); return null; }
  return m;
}

app.get('/api/matches/mine', requireUser, wrap(async (req, res) => {
  const rows = await q(`${MATCH_SELECT} JOIN match_members mm ON mm.match_id = m.id WHERE mm.player_id = $1 ORDER BY m.starts_at DESC`, [req.user.id]);
  const mine = new Map((await q('SELECT match_id, track_no, rating, goals FROM tracks WHERE player_id = $1', [req.user.id])).map((t) => [t.match_id, t]));
  res.json(rows.map((m) => ({ ...matchSummary(m), my: mine.get(m.id) || null })));
}));

app.post('/api/matches/join', requireUser, wrap(async (req, res) => {
  const m = await getMatchByCode(String(req.body.code || '').trim().toUpperCase());
  if (!m) return bad(res, 'Bu kod bilen oýun tapylmady. Kod meýdançadaky tagtada ýa-da administratorda bar.', 404);
  await run('INSERT INTO match_members (match_id, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [m.id, req.user.id]);
  res.json({ id: m.id });
}));

app.get('/api/matches/:id', wrap(async (req, res) => {
  const m = await getVisibleMatch(req, res);
  if (!m) return;
  res.json({ ...(await matchDetail(m, req.user?.id)), summary_available: summaryAvailable() });
}));

app.get('/api/matches/:id/replay', wrap(async (req, res) => {
  const m = await getVisibleMatch(req, res);
  if (!m) return;
  const r = loadReplay(m.id);
  if (!r) return bad(res, 'Gaýtalama entek taýýar däl', 404);
  res.json(r);
}));

app.post('/api/matches/:id/claim', requireUser, wrap(async (req, res) => {
  const m = await getVisibleMatch(req, res);
  if (!m) return;
  const trackNo = Number(req.body.track_no);
  const t = await one('SELECT * FROM tracks WHERE match_id = $1 AND track_no = $2', [m.id, trackNo]);
  if (!t) return bad(res, 'Bu oýunda beýle oýunçy ýok', 404);
  if (t.player_id && t.player_id !== req.user.id) return bad(res, 'Bu oýunçyny eýýäm başga biri saýlady. Ýalňyşlyk bolsa, meýdança administratoryna ýazyň.', 409);
  await run('UPDATE tracks SET player_id = NULL WHERE match_id = $1 AND player_id = $2', [m.id, req.user.id]);
  await run('UPDATE tracks SET player_id = $1 WHERE match_id = $2 AND track_no = $3', [req.user.id, m.id, trackNo]);
  res.json(await matchDetail(m, req.user.id));
}));

app.delete('/api/matches/:id/claim', requireUser, wrap(async (req, res) => {
  const m = await getVisibleMatch(req, res);
  if (!m) return;
  await run('UPDATE tracks SET player_id = NULL WHERE match_id = $1 AND player_id = $2', [m.id, req.user.id]);
  res.json(await matchDetail(m, req.user.id));
}));

app.post('/api/matches/:id/vote', requireUser, wrap(async (req, res) => {
  const m = await getVisibleMatch(req, res);
  if (!m) return;
  const trackNo = Number(req.body.track_no);
  const t = await one('SELECT * FROM tracks WHERE match_id = $1 AND track_no = $2', [m.id, trackNo]);
  if (!t) return bad(res, 'Bu oýunda beýle oýunçy ýok', 404);
  if (t.player_id === req.user.id) return bad(res, 'Özüňe ses berip bolmaýar');
  await run(`INSERT INTO votes (match_id, voter_id, track_no) VALUES ($1,$2,$3)
    ON CONFLICT (match_id, voter_id) DO UPDATE SET track_no = EXCLUDED.track_no`, [m.id, req.user.id, trackNo]);
  res.json(await matchDetail(m, req.user.id));
}));

app.post('/api/matches/:id/summary', requireUser, wrap(async (req, res) => {
  const m = await getVisibleMatch(req, res);
  if (!m) return;
  if (!summaryAvailable()) return bad(res, 'AI syny sazlanmadyk: serwerde ANTHROPIC_API_KEY goýuň', 501);
  res.json({ text: await generateMatchSummary(await matchDetail(m, null)) });
}));

// ---------- Клипы ----------
async function clipPayload(c) {
  const m = await getMatch(c.match_id);
  const author = c.player_id ? await getPlayer(c.player_id) : null;
  return {
    id: c.id, title: c.title, start_s: c.start_s, end_s: c.end_s, views: c.views, created_at: c.created_at,
    author: playerMini(author),
    match: matchSummary(m),
    has_replay: fs.existsSync(path.join(DIRS.analysis, `${m.id}.json`)),
    can_download: HAS_FFMPEG && !!m.video_file,
  };
}

app.post('/api/clips', requireUser, wrap(async (req, res) => {
  const matchId = Number(req.body.match_id) || 0;
  if (!(await one('SELECT 1 FROM matches WHERE id = $1', [matchId])) || !(await canSeeMatch(req, matchId))) return bad(res, 'Oýun tapylmady', 404);
  const start = Math.max(0, Number(req.body.start_s));
  const end = Number(req.body.end_s);
  if (!(end > start)) return bad(res, 'Klipiň soňy başyndan soň bolmaly');
  if (end - start > 120) return bad(res, 'Klip 2 minutdan uzyn bolmaly däl');
  const title = String(req.body.title || '').trim().slice(0, 80) || 'Meniň pursadym';
  const c = await one('INSERT INTO clips (id, match_id, player_id, title, start_s, end_s) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [randomId(8), matchId, req.user.id, title, start, end]);
  res.status(201).json(await clipPayload(c));
}));

app.get('/api/me/clips', requireUser, wrap(async (req, res) => {
  const list = await q('SELECT * FROM clips WHERE player_id = $1 ORDER BY created_at DESC', [req.user.id]);
  res.json(await Promise.all(list.map(clipPayload)));
}));

app.delete('/api/clips/:id', requireUser, wrap(async (req, res) => {
  const r = await run('DELETE FROM clips WHERE id = $1 AND player_id = $2', [req.params.id, req.user.id]);
  if (!r.rowCount) return bad(res, 'Klip tapylmady', 404);
  res.json({ ok: true });
}));

// Клип открывается по ссылке без входа — им делятся в мессенджерах
app.get('/api/clips/:id', wrap(async (req, res) => {
  const c = await one('UPDATE clips SET views = views + 1 WHERE id = $1 RETURNING *', [req.params.id]);
  if (!c) return bad(res, 'Klip tapylmady', 404);
  res.json(await clipPayload(c));
}));

app.get('/api/clips/:id/replay', wrap(async (req, res) => {
  const c = await one('SELECT * FROM clips WHERE id = $1', [req.params.id]);
  if (!c) return bad(res, 'Klip tapylmady', 404);
  const r = loadReplay(c.match_id);
  if (!r) return bad(res, 'Gaýtalama elýeterli däl', 404);
  const from = Math.floor(c.start_s * r.frames_hz);
  const to = Math.ceil(c.end_s * r.frames_hz) + 1;
  const tracks = await q('SELECT track_no, team, jersey FROM tracks WHERE match_id = $1', [c.match_id]);
  res.json({ ...r, frames: r.frames.slice(from, to), tracks });
}));

// Настоящая нарезка mp4 — через ffmpeg (если установлен на сервере)
app.get('/api/clips/:id/download', wrap(async (req, res) => {
  const c = await one('SELECT * FROM clips WHERE id = $1', [req.params.id]);
  if (!c) return bad(res, 'Klip tapylmady', 404);
  const m = await one('SELECT * FROM matches WHERE id = $1', [c.match_id]);
  if (!HAS_FFMPEG || !m.video_file) return bad(res, 'Ýükläp almak elýeterli däl: serwerde ffmpeg ýa-da oýnuň wideosy ýok', 501);
  const out = path.join(DIRS.clips, `${c.id}.mp4`);
  const send = () => res.download(out, `akylly-${c.id}.mp4`);
  if (fs.existsSync(out)) return send();
  const p = spawn('ffmpeg', ['-y', '-ss', String(c.start_s), '-i', path.join(DIRS.videos, m.video_file), '-t', String(c.end_s - c.start_s),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-movflags', '+faststart', out]);
  p.on('close', (code) => (code === 0 ? send() : bad(res, 'Wideony kesip bolmady', 500)));
}));

// ---------- Панель администратора ----------
app.use('/api/admin', adminRouter);

// ---------- API для AI-воркера (GPU-компьютер у поля или в облаке) ----------
app.post('/api/worker/next', requireWorker, wrap(async (_req, res) => {
  // Берём матч из очереди атомарно — два воркера не получат один матч
  const m = await one(`UPDATE matches SET status = 'processing' WHERE id = (
      SELECT id FROM matches WHERE status = 'queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
    ) RETURNING *`);
  if (!m) return res.status(204).end();
  const pitch = await one('SELECT * FROM pitches WHERE id = $1', [m.pitch_id]);
  res.json({
    match_id: m.id,
    duration_min: m.duration_min,
    players_per_side: m.players_per_side,
    team_colors: { A: m.team_a_color, B: m.team_b_color },
    pitch: { length_m: pitch.length_m, width_m: pitch.width_m, calibration: pitch.calibration },
    video_path: `/api/worker/matches/${m.id}/video`,
  });
}));

app.get('/api/worker/matches/:id/video', requireWorker, wrap(async (req, res) => {
  const m = await one('SELECT video_file FROM matches WHERE id = $1', [Number(req.params.id) || 0]);
  if (!m?.video_file) return bad(res, 'Wideo ýok', 404);
  res.sendFile(path.join(DIRS.videos, m.video_file));
}));

app.post('/api/worker/matches/:id/result', requireWorker, wrap(async (req, res) => {
  res.json(await ingestAnalysis(Number(req.params.id), req.body));
}));

app.post('/api/worker/matches/:id/thumbs', requireWorker, thumbUpload.any(), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const dir = path.join(DIRS.thumbs, String(id));
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const f of req.files || []) {
    const mt = /^track_(\d+)$/.exec(f.fieldname);
    if (!mt || !/^image\/jpe?g$/.test(f.mimetype)) continue;
    const name = `track_${mt[1]}.jpg`;
    fs.writeFileSync(path.join(dir, name), f.buffer);
    await run('UPDATE tracks SET thumbnail = $1 WHERE match_id = $2 AND track_no = $3', [name, id, Number(mt[1])]);
    n++;
  }
  res.json({ saved: n });
}));

app.post('/api/worker/matches/:id/fail', requireWorker, wrap(async (req, res) => {
  await run("UPDATE matches SET status = 'failed', error = $1 WHERE id = $2", [String(req.body.error || 'Derňewde ýalňyşlyk').slice(0, 500), Number(req.params.id)]);
  res.json({ ok: true });
}));

// ---------- Статика ----------
app.use('/media/photos', express.static(DIRS.photos, { maxAge: '30d', immutable: true }));
app.use('/media/videos', express.static(DIRS.videos)); // поддерживает перемотку (HTTP Range)
app.use('/media/thumbs', express.static(DIRS.thumbs));
app.use(express.static(path.resolve('public')));
app.get(/^\/(?!api\/|media\/).*/, (_req, res) => res.sendFile(path.resolve('public/index.html')));

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) return bad(res, err.code === 'LIMIT_FILE_SIZE' ? 'Faýl gaty uly' : err.message);
  if (err.code === '23505') return bad(res, 'Beýle ýazgy eýýäm bar', 409); // нарушение уникальности в PostgreSQL
  if (err.code === '23503') return bad(res, 'Baglanyşykly ýazgylar bar — ilki olary pozuň', 409);
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Serwerde ýalňyşlyk' });
});

async function start() {
  try {
    await migrate();
  } catch (e) {
    console.error(`\n  Не удалось подключиться к PostgreSQL (${e.code || e.message}). Проверьте DATABASE_URL в .env\n`);
    process.exit(1);
  }
  await ensureAdmin();
  await seedDemo();
  const server = app.listen(PORT, HOST, () => {
    console.log(`\n  Akylly Meýdança запущен: http://${HOST || 'localhost'}:${PORT}`);
    console.log(`  Панель администратора:   http://${HOST || 'localhost'}:${PORT}/#/admin`);
    console.log(`  ffmpeg: ${HAS_FFMPEG ? 'есть — клипы можно скачивать mp4' : 'нет — клипы работают как отрезки видео'}`);
    console.log(`  AI-обзор матча (Claude): ${summaryAvailable() ? 'включён' : 'выключен (нет ANTHROPIC_API_KEY)'}`);
    console.log(`  Удаление фона с фото: ${cutoutAvailable() ? 'включено' : 'выключено — запустите npm run models'}\n`);
  });
  // PM2 при перезапуске шлёт SIGINT: дожидаемся текущих запросов и закрываем базу
  const stop = () => server.close(() => pool.end().finally(() => process.exit(0)));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

start();
