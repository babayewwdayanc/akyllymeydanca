// API панели администратора: вход по логину/паролю, роли (owner / manager), управление
// полями, матчами, игроками, клипами, администраторами и журнал всех действий.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { q, one, run, tx, DIRS } from './db.js';
import { hashPin, verifyPin, createAdminSession, requireAdmin, requireOwner, randomId, limiter } from './auth.js';
import { aggregatesFor, playerPublic, playerFull, playerMini, getPlayer, photoUrl } from './players.js';
import { matchSummary, matchTracks, getMatch, MATCH_SELECT } from './matchView.js';
import { ingestAnalysis } from './ingest.js';
import { simulateMatch } from './demoAnalysis.js';
import {
  wrap, bad, videoUpload, savePhoto, removeFile, normPhone, validateProfile, buildUpdate, cutoutOr422, MATCH_CODE_ALPHABET,
} from './common.js';

export const adminRouter = express.Router();
const PAGE = 30;
const pageOf = (req) => Math.max(1, Number(req.query.page) || 1);

/** Запись в журнал действий. */
async function log(req, action, target = null, details = null) {
  await run('INSERT INTO admin_log (admin_id, admin_name, action, target, details) VALUES ($1,$2,$3,$4,$5)',
    [req.admin.id, req.admin.username, action, target, details ? JSON.stringify(details) : null]);
}

// ---------- Вход ----------
const loginLimit = limiter({ windowMs: 15 * 60 * 1000, max: 10, message: 'Gaty köp synanyşyk. 15 minutdan gaýtalaň.' });

adminRouter.post('/login', loginLimit, wrap(async (req, res) => {
  const a = await one('SELECT * FROM admins WHERE username = $1', [String(req.body.username || '').trim().toLowerCase()]);
  if (!a || !a.active || !verifyPin(req.body.password || '', a.pass_hash)) return bad(res, 'Login ýa-da parol nädogry', 401);
  const token = await createAdminSession(a.id);
  req.admin = a;
  await log(req, 'login');
  res.json({ token, admin: { id: a.id, username: a.username, role: a.role } });
}));

adminRouter.use(requireAdmin);

adminRouter.post('/logout', wrap(async (req, res) => {
  await run('DELETE FROM admin_sessions WHERE token = $1', [req.get('x-admin-token')]);
  res.json({ ok: true });
}));

adminRouter.get('/me', (req, res) => res.json(req.admin));

adminRouter.post('/me/password', wrap(async (req, res) => {
  const a = await one('SELECT * FROM admins WHERE id = $1', [req.admin.id]);
  if (!verifyPin(req.body.current || '', a.pass_hash)) return bad(res, 'Häzirki parol nädogry');
  if (String(req.body.next || '').length < 8) return bad(res, 'Täze parol azyndan 8 nyşan bolmaly');
  await run('UPDATE admins SET pass_hash = $1 WHERE id = $2', [hashPin(req.body.next), a.id]);
  await run('DELETE FROM admin_sessions WHERE admin_id = $1 AND token <> $2', [a.id, req.get('x-admin-token')]);
  await log(req, 'admin.password', a.username);
  res.json({ ok: true });
}));

// ---------- Сводка ----------
function dirSize(dir) {
  let total = 0;
  let files = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const s = dirSize(p); total += s.total; files += s.files; } else { total += fs.statSync(p).size; files++; }
  }
  return { total, files };
}

adminRouter.get('/dashboard', wrap(async (_req, res) => {
  const [counts] = await q(`SELECT
      (SELECT COUNT(*) FROM players WHERE NOT is_demo)::int AS players,
      (SELECT COUNT(*) FROM players WHERE NOT is_demo AND created_at > now() - interval '7 days')::int AS players_week,
      (SELECT COUNT(*) FROM players WHERE blocked)::int AS players_blocked,
      (SELECT COUNT(*) FROM matches)::int AS matches,
      (SELECT COUNT(*) FROM matches WHERE starts_at > now() - interval '7 days')::int AS matches_week,
      (SELECT COUNT(*) FROM clips)::int AS clips,
      (SELECT COALESCE(SUM(views), 0) FROM clips)::int AS clip_views,
      (SELECT COUNT(*) FROM pitches)::int AS pitches,
      (SELECT COUNT(*) FROM tracks WHERE player_id IS NOT NULL)::int AS claimed`);
  const byStatus = Object.fromEntries((await q('SELECT status, COUNT(*)::int AS n FROM matches GROUP BY status')).map((r) => [r.status, r.n]));
  const queue = (await q(`${MATCH_SELECT} WHERE m.status IN ('queued','processing','failed') ORDER BY m.created_at`)).map(matchSummary);
  const recentPlayers = (await q('SELECT * FROM players WHERE NOT is_demo ORDER BY created_at DESC LIMIT 6'))
    .map((p) => ({ ...playerMini(p), created_at: p.created_at }));
  const recentLog = await q('SELECT * FROM admin_log ORDER BY created_at DESC LIMIT 8');
  res.json({
    counts, by_status: byStatus, queue, recent_players: recentPlayers, recent_log: recentLog,
    storage: { videos: dirSize(DIRS.videos), photos: dirSize(DIRS.photos), analysis: dirSize(DIRS.analysis) },
  });
}));

// ---------- Поля ----------
function pitchFields(b) {
  const name = String(b.name || '').trim();
  if (!name) return { error: 'Meýdançanyň adyny ýazyň' };
  let calibration = null;
  if (b.calibration) {
    try {
      calibration = typeof b.calibration === 'string' ? JSON.parse(b.calibration) : b.calibration;
      if (!Array.isArray(calibration.image_points) || calibration.image_points.length < 4) return { error: 'Kalibrlemekde 4 nokat (image_points) bolmaly' };
    } catch { return { error: 'Kalibrlemek: JSON nädogry' }; }
  }
  const length = Number(b.length_m) || 40;
  const width = Number(b.width_m) || 20;
  if (length < 10 || length > 120 || width < 5 || width > 90) return { error: 'Meýdançanyň ölçegleri nädogry' };
  return { value: { name, city: String(b.city || '').trim(), address: String(b.address || '').trim(), length_m: length, width_m: width, calibration: calibration ? JSON.stringify(calibration) : null } };
}

adminRouter.get('/pitches', wrap(async (_req, res) => {
  res.json(await q(`SELECT p.*, (SELECT COUNT(*) FROM matches m WHERE m.pitch_id = p.id)::int AS matches FROM pitches p ORDER BY p.id`));
}));

adminRouter.post('/pitches', wrap(async (req, res) => {
  const { value, error } = pitchFields(req.body);
  if (error) return bad(res, error);
  const p = await one('INSERT INTO pitches (name, city, address, length_m, width_m, calibration) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [value.name, value.city, value.address, value.length_m, value.width_m, value.calibration]);
  await log(req, 'pitch.create', p.name);
  res.status(201).json(p);
}));

adminRouter.put('/pitches/:id', wrap(async (req, res) => {
  const { value, error } = pitchFields(req.body);
  if (error) return bad(res, error);
  const u = buildUpdate(value);
  const p = await one(`UPDATE pitches SET ${u.set} WHERE id = $${u.next} RETURNING *`, [...u.params, Number(req.params.id)]);
  if (!p) return bad(res, 'Meýdança tapylmady', 404);
  await log(req, 'pitch.update', p.name);
  res.json(p);
}));

adminRouter.delete('/pitches/:id', wrap(async (req, res) => {
  const p = await one('SELECT * FROM pitches WHERE id = $1', [Number(req.params.id)]);
  if (!p) return bad(res, 'Meýdança tapylmady', 404);
  if ((await one('SELECT COUNT(*)::int AS n FROM matches WHERE pitch_id = $1', [p.id])).n) return bad(res, 'Bu meýdançada oýunlar bar — ilki olary pozuň', 409);
  await run('DELETE FROM pitches WHERE id = $1', [p.id]);
  await log(req, 'pitch.delete', p.name);
  res.json({ ok: true });
}));

// ---------- Матчи ----------
function matchFields(b, { partial = false } = {}) {
  const out = {};
  const has = (k) => !partial || b[k] !== undefined;
  if (has('pitch_id')) out.pitch_id = Number(b.pitch_id);
  if (has('starts_at')) {
    const d = new Date(b.starts_at || Date.now());
    if (Number.isNaN(d.getTime())) return { error: 'Başlanýan wagty nädogry' };
    out.starts_at = d;
  }
  if (has('duration_min')) out.duration_min = Math.min(180, Math.max(10, Number(b.duration_min) || 60));
  if (has('players_per_side')) out.players_per_side = Math.min(11, Math.max(4, Number(b.players_per_side) || 6));
  for (const k of ['team_a_name', 'team_b_name']) if (has(k)) out[k] = String(b[k] || '').trim().slice(0, 40) || (k === 'team_a_name' ? 'A topar' : 'B topar');
  for (const k of ['team_a_color', 'team_b_color']) if (has(k)) {
    if (!/^#[0-9a-fA-F]{6}$/.test(b[k] || '')) return { error: 'Reňk #RRGGBB görnüşinde bolmaly' };
    out[k] = b[k];
  }
  for (const k of ['score_a', 'score_b']) if (b[k] !== undefined) {
    if (b[k] === null || b[k] === '') out[k] = null;
    else if (!Number.isInteger(Number(b[k])) || Number(b[k]) < 0) return { error: 'Hasap 0-dan uly bitin san bolmaly' };
    else out[k] = Number(b[k]);
  }
  return { value: out };
}

adminRouter.get('/matches', wrap(async (req, res) => {
  const where = [];
  const params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (req.query.status) add('m.status = ?', req.query.status);
  if (req.query.pitch) add('m.pitch_id = ?', Number(req.query.pitch));
  if (req.query.q) {
    params.push(`%${req.query.q}%`);
    const n = params.length;
    where.push(`(m.code ILIKE $${n} OR m.team_a_name ILIKE $${n} OR m.team_b_name ILIKE $${n})`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await one(`SELECT COUNT(*)::int AS n FROM matches m ${w}`, params)).n;
  params.push(PAGE, (pageOf(req) - 1) * PAGE);
  const rows = await q(`SELECT x.*, (SELECT COUNT(*) FROM match_members mm WHERE mm.match_id = x.id)::int AS members,
      (SELECT COUNT(*) FROM tracks t WHERE t.match_id = x.id AND t.player_id IS NOT NULL)::int AS claimed,
      (SELECT COUNT(*) FROM tracks t WHERE t.match_id = x.id)::int AS tracks
    FROM (${MATCH_SELECT} ${w} ORDER BY m.starts_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}) x`, params);
  res.json({ total, page: pageOf(req), pages: Math.max(1, Math.ceil(total / PAGE)), rows: rows.map((m) => ({ ...matchSummary(m), members: m.members, claimed: m.claimed, tracks: m.tracks })) });
}));

adminRouter.post('/matches', wrap(async (req, res) => {
  const { value, error } = matchFields(req.body);
  if (error) return bad(res, error);
  if (!(await one('SELECT 1 FROM pitches WHERE id = $1', [value.pitch_id]))) return bad(res, 'Meýdança saýlaň');
  let code;
  do code = randomId(6, MATCH_CODE_ALPHABET); while (await one('SELECT 1 FROM matches WHERE code = $1', [code]));
  const m = await one(`INSERT INTO matches (pitch_id, code, starts_at, duration_min, players_per_side, team_a_name, team_a_color, team_b_name, team_b_color)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
  [value.pitch_id, code, value.starts_at, value.duration_min, value.players_per_side, value.team_a_name, value.team_a_color, value.team_b_name, value.team_b_color]);
  await log(req, 'match.create', code);
  res.status(201).json(matchSummary(await getMatch(m.id)));
}));

async function adminMatch(id) {
  const m = await getMatch(id);
  if (!m) return null;
  const { tracks } = await matchTracks(m.id);
  const members = (await q(`SELECT p.*, mm.joined_at FROM match_members mm JOIN players p ON p.id = mm.player_id
    WHERE mm.match_id = $1 ORDER BY mm.joined_at`, [m.id])).map((p) => ({ ...playerMini(p), phone: p.phone, joined_at: p.joined_at }));
  const clips = (await one('SELECT COUNT(*)::int AS n FROM clips WHERE match_id = $1', [m.id])).n;
  return { ...matchSummary(m), tracks, members, clips, has_video: !!m.video_file, created_at: m.created_at };
}

adminRouter.get('/matches/:id', wrap(async (req, res) => {
  const d = await adminMatch(Number(req.params.id) || 0);
  if (!d) return bad(res, 'Oýun tapylmady', 404);
  res.json(d);
}));

adminRouter.put('/matches/:id', wrap(async (req, res) => {
  const { value, error } = matchFields(req.body, { partial: true });
  if (error) return bad(res, error);
  if (!Object.keys(value).length) return bad(res, 'Üýtgetmek üçin hiç zat ýok');
  const u = buildUpdate(value);
  const r = await run(`UPDATE matches SET ${u.set} WHERE id = $${u.next}`, [...u.params, Number(req.params.id)]);
  if (!r.rowCount) return bad(res, 'Oýun tapylmady', 404);
  const d = await adminMatch(Number(req.params.id));
  await log(req, 'match.update', d.code, value);
  res.json(d);
}));

adminRouter.post('/matches/:id/video', videoUpload.single('video'), wrap(async (req, res) => {
  const m = await one('SELECT * FROM matches WHERE id = $1', [Number(req.params.id)]);
  if (!m) { removeFile(DIRS.videos, req.file?.filename); return bad(res, 'Oýun tapylmady', 404); }
  if (!req.file) return bad(res, 'Wideo faýl ýükläň (mp4)');
  removeFile(DIRS.videos, m.video_file);
  await run(`UPDATE matches SET video_file = $1, status = CASE WHEN status = 'scheduled' THEN 'uploaded' ELSE status END WHERE id = $2`, [req.file.filename, m.id]);
  await log(req, 'match.video', m.code, { size_mb: Math.round(req.file.size / 1e6) });
  res.json(await adminMatch(m.id));
}));

adminRouter.delete('/matches/:id/video', wrap(async (req, res) => {
  const m = await one('SELECT * FROM matches WHERE id = $1', [Number(req.params.id)]);
  if (!m) return bad(res, 'Oýun tapylmady', 404);
  removeFile(DIRS.videos, m.video_file);
  await run('UPDATE matches SET video_file = NULL WHERE id = $1', [m.id]);
  await log(req, 'match.video.delete', m.code);
  res.json(await adminMatch(m.id));
}));

adminRouter.post('/matches/:id/analyze', wrap(async (req, res) => {
  const m = await one('SELECT * FROM matches WHERE id = $1', [Number(req.params.id)]);
  if (!m) return bad(res, 'Oýun tapylmady', 404);
  if (req.body.mode === 'ai') {
    if (!m.video_file) return bad(res, 'Ilki oýnuň wideosyny ýükläň');
    await run("UPDATE matches SET status = 'queued', error = NULL WHERE id = $1", [m.id]);
    await log(req, 'match.analyze.ai', m.code);
    return res.json({ queued: true, message: 'Oýun nobata goýuldy. Ony AI-işçi (ai/worker.py) alar.' });
  }
  const pitch = await one('SELECT * FROM pitches WHERE id = $1', [m.pitch_id]);
  const r = await ingestAnalysis(m.id, simulateMatch({ durationS: m.duration_min * 60, perSide: m.players_per_side, length: pitch.length_m, width: pitch.width_m, seed: m.id }));
  await log(req, 'match.analyze.demo', m.code);
  res.json(r);
}));

// Загрузить готовый JSON анализа (например, после ai/analyze.py на своём компьютере)
adminRouter.post('/matches/:id/result', wrap(async (req, res) => {
  const r = await ingestAnalysis(Number(req.params.id), req.body);
  await log(req, 'match.result', String(req.params.id), { events: r.events });
  res.json(r);
}));

// Ручная привязка трека к игроку (если игрок ошибся или не может отметиться сам)
adminRouter.put('/matches/:id/tracks/:no', wrap(async (req, res) => {
  const matchId = Number(req.params.id);
  const trackNo = Number(req.params.no);
  const playerId = req.body.player_id ? Number(req.body.player_id) : null;
  if (!(await one('SELECT 1 FROM tracks WHERE match_id = $1 AND track_no = $2', [matchId, trackNo]))) return bad(res, 'Bu oýunda beýle oýunçy ýok', 404);
  if (playerId && !(await getPlayer(playerId))) return bad(res, 'Oýunçy tapylmady', 404);
  await tx(async (db) => {
    if (playerId) {
      await db.run('UPDATE tracks SET player_id = NULL WHERE match_id = $1 AND player_id = $2', [matchId, playerId]);
      await db.run('INSERT INTO match_members (match_id, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [matchId, playerId]);
    }
    await db.run('UPDATE tracks SET player_id = $1 WHERE match_id = $2 AND track_no = $3', [playerId, matchId, trackNo]);
  });
  await log(req, 'match.track', `${matchId}#${trackNo}`, { player_id: playerId });
  res.json(await adminMatch(matchId));
}));

adminRouter.post('/matches/:id/members', wrap(async (req, res) => {
  const matchId = Number(req.params.id);
  const p = await getPlayer(Number(req.body.player_id) || 0);
  if (!p) return bad(res, 'Oýunçy tapylmady', 404);
  await run('INSERT INTO match_members (match_id, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [matchId, p.id]);
  await log(req, 'match.member.add', String(matchId), { player_id: p.id });
  res.json(await adminMatch(matchId));
}));

adminRouter.delete('/matches/:id/members/:pid', wrap(async (req, res) => {
  const matchId = Number(req.params.id);
  const pid = Number(req.params.pid);
  await tx(async (db) => {
    await db.run('DELETE FROM match_members WHERE match_id = $1 AND player_id = $2', [matchId, pid]);
    await db.run('UPDATE tracks SET player_id = NULL WHERE match_id = $1 AND player_id = $2', [matchId, pid]);
  });
  await log(req, 'match.member.remove', String(matchId), { player_id: pid });
  res.json(await adminMatch(matchId));
}));

adminRouter.delete('/matches/:id', wrap(async (req, res) => {
  const m = await one('SELECT * FROM matches WHERE id = $1', [Number(req.params.id)]);
  if (!m) return bad(res, 'Oýun tapylmady', 404);
  await run('DELETE FROM matches WHERE id = $1', [m.id]);
  removeFile(DIRS.videos, m.video_file);
  fs.rmSync(path.join(DIRS.analysis, `${m.id}.json`), { force: true });
  fs.rmSync(path.join(DIRS.thumbs, String(m.id)), { recursive: true, force: true });
  await log(req, 'match.delete', m.code);
  res.json({ ok: true });
}));

// ---------- Игроки ----------
adminRouter.get('/players', wrap(async (req, res) => {
  const where = [];
  const params = [];
  if (req.query.q) {
    params.push(`%${req.query.q}%`);
    where.push(`(first_name ILIKE $1 OR last_name ILIKE $1 OR phone ILIKE $1 OR (first_name || ' ' || last_name) ILIKE $1)`);
  }
  if (req.query.filter === 'blocked') where.push('blocked');
  if (req.query.filter === 'demo') where.push('is_demo');
  if (req.query.filter === 'real') where.push('NOT is_demo');
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order = { new: 'created_at DESC', name: 'last_name, first_name', login: 'last_login_at DESC NULLS LAST' }[req.query.sort] || 'created_at DESC';
  const total = (await one(`SELECT COUNT(*)::int AS n FROM players ${w}`, params)).n;
  params.push(PAGE, (pageOf(req) - 1) * PAGE);
  const list = await q(`SELECT * FROM players ${w} ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  const aggs = await aggregatesFor(list.map((p) => p.id));
  res.json({
    total, page: pageOf(req), pages: Math.max(1, Math.ceil(total / PAGE)),
    rows: list.map((p) => {
      const pub = playerPublic(p, aggs.get(p.id));
      return { ...playerMini(p), phone: p.phone, position: p.position, blocked: p.blocked, is_demo: p.is_demo, created_at: p.created_at, last_login_at: p.last_login_at, ovr: pub.card.ovr, tier: pub.card.tier, matches: pub.totals.matches, goals: pub.totals.goals };
    }),
  });
}));

async function adminPlayer(id) {
  const p = await getPlayer(id);
  if (!p) return null;
  const full = await playerFull(p);
  const clips = await q(`SELECT c.*, m.code FROM clips c JOIN matches m ON m.id = c.match_id WHERE c.player_id = $1 ORDER BY c.created_at DESC`, [p.id]);
  const sessions = (await one('SELECT COUNT(*)::int AS n FROM sessions WHERE player_id = $1', [p.id])).n;
  const memberships = (await q(`${MATCH_SELECT} JOIN match_members mm ON mm.match_id = m.id WHERE mm.player_id = $1 ORDER BY m.starts_at DESC`, [p.id])).map(matchSummary);
  return { ...full, phone: p.phone, blocked: p.blocked, is_demo: p.is_demo, created_at: p.created_at, last_login_at: p.last_login_at, sessions, clips, memberships };
}

adminRouter.get('/players/:id', wrap(async (req, res) => {
  const d = await adminPlayer(Number(req.params.id) || 0);
  if (!d) return bad(res, 'Oýunçy tapylmady', 404);
  res.json(d);
}));

adminRouter.put('/players/:id', wrap(async (req, res) => {
  const { value, error } = validateProfile(req.body, { partial: true });
  if (error) return bad(res, error);
  if (req.body.phone !== undefined) {
    value.phone = normPhone(req.body.phone);
    if (value.phone.length < 6) return bad(res, 'Telefon belgisi nädogry');
  }
  if (!Object.keys(value).length) return bad(res, 'Üýtgetmek üçin hiç zat ýok');
  const u = buildUpdate(value);
  const r = await run(`UPDATE players SET ${u.set} WHERE id = $${u.next}`, [...u.params, Number(req.params.id)]);
  if (!r.rowCount) return bad(res, 'Oýunçy tapylmady', 404);
  await log(req, 'player.update', String(req.params.id), value);
  res.json(await adminPlayer(Number(req.params.id)));
}));

adminRouter.post('/players/:id/pin', wrap(async (req, res) => {
  const pin = String(req.body.pin || '');
  if (!/^\d{4,6}$/.test(pin)) return bad(res, 'PIN-kod 4–6 sanly bolmaly');
  const r = await run('UPDATE players SET pin_hash = $1 WHERE id = $2', [hashPin(pin), Number(req.params.id)]);
  if (!r.rowCount) return bad(res, 'Oýunçy tapylmady', 404);
  await run('DELETE FROM sessions WHERE player_id = $1', [Number(req.params.id)]);
  await log(req, 'player.pin', String(req.params.id));
  res.json(await adminPlayer(Number(req.params.id)));
}));

adminRouter.post('/players/:id/block', wrap(async (req, res) => {
  const blocked = !!req.body.blocked;
  const r = await run('UPDATE players SET blocked = $1 WHERE id = $2', [blocked, Number(req.params.id)]);
  if (!r.rowCount) return bad(res, 'Oýunçy tapylmady', 404);
  if (blocked) await run('DELETE FROM sessions WHERE player_id = $1', [Number(req.params.id)]);
  await log(req, blocked ? 'player.block' : 'player.unblock', String(req.params.id));
  res.json(await adminPlayer(Number(req.params.id)));
}));

adminRouter.post('/players/:id/photo/cutout', wrap(async (req, res) => {
  const p = await getPlayer(Number(req.params.id) || 0);
  if (!p?.photo) return bad(res, 'Oýunçynyň suraty ýok', 404);
  const png = await cutoutOr422(res, fs.readFileSync(path.join(DIRS.photos, p.photo)));
  if (!png) return;
  await run('UPDATE players SET photo = $1 WHERE id = $2', [savePhoto({ mimetype: 'image/png', buffer: png }), p.id]);
  await log(req, 'player.photo.cutout', String(p.id));
  res.json(await adminPlayer(p.id));
}));

adminRouter.delete('/players/:id/photo', wrap(async (req, res) => {
  const p = await getPlayer(Number(req.params.id) || 0);
  if (!p) return bad(res, 'Oýunçy tapylmady', 404);
  removeFile(DIRS.photos, p.photo);
  await run('UPDATE players SET photo = NULL WHERE id = $1', [p.id]);
  await log(req, 'player.photo.delete', String(p.id));
  res.json(await adminPlayer(p.id));
}));

adminRouter.delete('/players/:id', wrap(async (req, res) => {
  const p = await getPlayer(Number(req.params.id) || 0);
  if (!p) return bad(res, 'Oýunçy tapylmady', 404);
  await run('DELETE FROM players WHERE id = $1', [p.id]);
  removeFile(DIRS.photos, p.photo);
  await log(req, 'player.delete', `${p.first_name} ${p.last_name}`, { phone: p.phone });
  res.json({ ok: true });
}));

// ---------- Клипы ----------
adminRouter.get('/clips', wrap(async (req, res) => {
  const params = [];
  let w = '';
  if (req.query.q) { params.push(`%${req.query.q}%`); w = 'WHERE c.title ILIKE $1 OR m.code ILIKE $1'; }
  const total = (await one(`SELECT COUNT(*)::int AS n FROM clips c JOIN matches m ON m.id = c.match_id ${w}`, params)).n;
  params.push(PAGE, (pageOf(req) - 1) * PAGE);
  const rows = await q(`SELECT c.*, m.code, m.team_a_name, m.team_b_name, p.first_name, p.last_name, p.photo
    FROM clips c JOIN matches m ON m.id = c.match_id LEFT JOIN players p ON p.id = c.player_id
    ${w} ORDER BY c.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  res.json({
    total, page: pageOf(req), pages: Math.max(1, Math.ceil(total / PAGE)),
    rows: rows.map((c) => ({ id: c.id, title: c.title, start_s: c.start_s, end_s: c.end_s, views: c.views, created_at: c.created_at, match: { id: c.match_id, code: c.code, teams: `${c.team_a_name} — ${c.team_b_name}` }, author: c.first_name ? { id: c.player_id, name: `${c.first_name} ${c.last_name}`, photo_url: photoUrl(c.photo) } : null })),
  });
}));

adminRouter.delete('/clips/:id', wrap(async (req, res) => {
  const c = await one('DELETE FROM clips WHERE id = $1 RETURNING *', [req.params.id]);
  if (!c) return bad(res, 'Klip tapylmady', 404);
  removeFile(DIRS.clips, `${c.id}.mp4`);
  await log(req, 'clip.delete', c.title);
  res.json({ ok: true });
}));

// ---------- Администраторы (только owner) ----------
adminRouter.get('/admins', requireOwner, wrap(async (_req, res) => {
  res.json(await q('SELECT id, username, role, active, created_at, last_login_at FROM admins ORDER BY id'));
}));

adminRouter.post('/admins', requireOwner, wrap(async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) return bad(res, 'Login: 3–32 nyşan (a-z, 0-9, . _ -)');
  if (String(req.body.password || '').length < 8) return bad(res, 'Parol azyndan 8 nyşan bolmaly');
  const role = req.body.role === 'owner' ? 'owner' : 'manager';
  const a = await one('INSERT INTO admins (username, pass_hash, role) VALUES ($1,$2,$3) RETURNING id, username, role, active, created_at',
    [username, hashPin(req.body.password), role]);
  await log(req, 'admin.create', username, { role });
  res.status(201).json(a);
}));

async function ownersLeft(exceptId) {
  return (await one(`SELECT COUNT(*)::int AS n FROM admins WHERE role = 'owner' AND active AND id <> $1`, [exceptId])).n;
}

adminRouter.put('/admins/:id', requireOwner, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const a = await one('SELECT * FROM admins WHERE id = $1', [id]);
  if (!a) return bad(res, 'Administrator tapylmady', 404);
  const fields = {};
  if (req.body.role !== undefined) fields.role = req.body.role === 'owner' ? 'owner' : 'manager';
  if (req.body.active !== undefined) fields.active = !!req.body.active;
  if (req.body.password) {
    if (String(req.body.password).length < 8) return bad(res, 'Parol azyndan 8 nyşan bolmaly');
    fields.pass_hash = hashPin(req.body.password);
  }
  const losesOwner = a.role === 'owner' && a.active && (fields.role === 'manager' || fields.active === false);
  if (losesOwner && !(await ownersLeft(id))) return bad(res, 'Iň bolmanda bir işjeň eýe (owner) galmaly');
  if (!Object.keys(fields).length) return bad(res, 'Üýtgetmek üçin hiç zat ýok');
  const u = buildUpdate(fields);
  await run(`UPDATE admins SET ${u.set} WHERE id = $${u.next}`, [...u.params, id]);
  if (fields.active === false || fields.pass_hash) await run('DELETE FROM admin_sessions WHERE admin_id = $1', [id]);
  await log(req, 'admin.update', a.username, { role: fields.role, active: fields.active, password: !!fields.pass_hash });
  res.json(await one('SELECT id, username, role, active, created_at, last_login_at FROM admins WHERE id = $1', [id]));
}));

adminRouter.delete('/admins/:id', requireOwner, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.admin.id) return bad(res, 'Özüňi pozup bolmaýar');
  const a = await one('SELECT * FROM admins WHERE id = $1', [id]);
  if (!a) return bad(res, 'Administrator tapylmady', 404);
  if (a.role === 'owner' && !(await ownersLeft(id))) return bad(res, 'Iň bolmanda bir işjeň eýe (owner) galmaly');
  await run('DELETE FROM admins WHERE id = $1', [id]);
  await log(req, 'admin.delete', a.username);
  res.json({ ok: true });
}));

// ---------- Журнал ----------
adminRouter.get('/log', wrap(async (req, res) => {
  const total = (await one('SELECT COUNT(*)::int AS n FROM admin_log')).n;
  const rows = await q('SELECT * FROM admin_log ORDER BY created_at DESC LIMIT $1 OFFSET $2', [PAGE, (pageOf(req) - 1) * PAGE]);
  res.json({ total, page: pageOf(req), pages: Math.max(1, Math.ceil(total / PAGE)), rows });
}));
