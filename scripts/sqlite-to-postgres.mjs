// Перенос данных из старой базы SQLite (data/app.db) в PostgreSQL.
// npm run db:import-sqlite  — база PostgreSQL должна быть пустой (без игроков и полей).
import fs from 'node:fs';
import '../server/env.js';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const file = path.resolve(process.argv[2] || path.join(process.env.DATA_DIR || 'data', 'app.db'));
if (!fs.existsSync(file)) {
  console.error(`Нет файла ${file}`);
  process.exit(1);
}
const lite = new DatabaseSync(file, { readOnly: true });
const { migrate, tx, insertMany, one, pool } = await import('../server/db.js');
await migrate();

if ((await one('SELECT (SELECT COUNT(*) FROM players) + (SELECT COUNT(*) FROM pitches) AS n')).n > 0) {
  console.error('В PostgreSQL уже есть данные — перенос отменён (чтобы ничего не перезаписать).');
  await pool.end();
  process.exit(1);
}

const all = (sql) => lite.prepare(sql).all();
const ts = (v) => (v ? new Date(/Z|[+-]\d\d:?\d\d$/.test(v) ? v : `${v.replace(' ', 'T')}Z`) : null);
const has = (table) => !!lite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);

const counts = {};
await tx(async (db) => {
  const copy = async (table, cols, rows) => {
    await insertMany(db, table, cols, rows);
    counts[table] = rows.length;
  };
  await copy('pitches', ['id', 'name', 'city', 'address', 'length_m', 'width_m', 'calibration'],
    all('SELECT * FROM pitches').map((r) => [r.id, r.name, r.city, r.address, r.length_m, r.width_m, r.calibration || null]));
  await copy('players', ['id', 'first_name', 'last_name', 'height_cm', 'weight_kg', 'position', 'foot', 'phone', 'pin_hash', 'photo', 'is_demo', 'created_at'],
    all('SELECT * FROM players').map((r) => [r.id, r.first_name, r.last_name, r.height_cm, r.weight_kg, r.position, r.foot, r.phone, r.pin_hash, r.photo, r.phone.startsWith('demo-'), ts(r.created_at)]));
  await copy('sessions', ['token', 'player_id', 'created_at'], all('SELECT * FROM sessions').map((r) => [r.token, r.player_id, ts(r.created_at)]));
  await copy('matches', ['id', 'pitch_id', 'code', 'starts_at', 'duration_min', 'players_per_side', 'team_a_name', 'team_a_color', 'team_b_name', 'team_b_color',
    'score_a', 'score_b', 'possession_a', 'video_file', 'status', 'analysis_source', 'error', 'created_at'],
  all('SELECT * FROM matches').map((r) => [r.id, r.pitch_id, r.code, ts(r.starts_at), r.duration_min, r.players_per_side, r.team_a_name, r.team_a_color, r.team_b_name, r.team_b_color,
    r.score_a, r.score_b, r.possession_a, r.video_file, r.status, r.analysis_source, r.error, ts(r.created_at)]));
  await copy('match_members', ['match_id', 'player_id'], all('SELECT * FROM match_members').map((r) => [r.match_id, r.player_id]));
  const tcols = ['match_id', 'track_no', 'team', 'jersey', 'role', 'thumbnail', 'player_id', 'goals', 'assists', 'shots', 'shots_on_target', 'passes', 'passes_completed',
    'turnovers', 'tackles', 'interceptions', 'saves', 'touches', 'distance_m', 'top_speed_kmh', 'sprints', 'max_shot_kmh', 'rating', 'heatmap'];
  await copy('tracks', tcols, all('SELECT * FROM tracks').map((r) => tcols.map((c) => r[c] ?? null)));
  const ecols = ['match_id', 't', 'type', 'team', 'track_no', 'target_track_no', 'success', 'x', 'y', 'speed_kmh'];
  await copy('events', ecols, all('SELECT * FROM events ORDER BY id').map((r) => ecols.map((c) => r[c] ?? null)));
  if (has('clips')) await copy('clips', ['id', 'match_id', 'player_id', 'title', 'start_s', 'end_s', 'views', 'created_at'],
    all('SELECT * FROM clips').map((r) => [r.id, r.match_id, r.player_id, r.title, r.start_s, r.end_s, r.views, ts(r.created_at)]));
  if (has('votes')) await copy('votes', ['match_id', 'voter_id', 'track_no'], all('SELECT * FROM votes').map((r) => [r.match_id, r.voter_id, r.track_no]));
  // Счётчики id продолжаются после перенесённых записей
  for (const t of ['players', 'pitches', 'matches']) {
    await db.run(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${t}), 1))`);
  }
});

console.log('Перенесено:', Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', '));
await pool.end();
