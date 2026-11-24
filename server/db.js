// База данных: PostgreSQL (драйвер pg). Схема создаётся и обновляется миграциями при запуске.
// Подключение — переменная DATABASE_URL, например postgres://akylly:пароль@127.0.0.1:5432/akylly
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
export const DIRS = {
  photos: path.join(DATA_DIR, 'photos'),
  videos: path.join(DATA_DIR, 'videos'),
  analysis: path.join(DATA_DIR, 'analysis'),
  thumbs: path.join(DATA_DIR, 'thumbs'),
  clips: path.join(DATA_DIR, 'clips'),
  tmp: path.join(DATA_DIR, 'tmp'),
};
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

// COUNT/SUM (bigint) и numeric приходят строками — переводим в числа
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export const DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost:5432/akylly';
export const pool = new pg.Pool({ connectionString: DATABASE_URL, max: Number(process.env.PG_POOL_SIZE || 10) });
pool.on('error', (e) => console.error('PostgreSQL:', e.message));

/** Все строки результата. */
export const q = async (sql, params = []) => (await pool.query(sql, params)).rows;
/** Первая строка или null. */
export const one = async (sql, params = []) => (await pool.query(sql, params)).rows[0] ?? null;
/** Выполнить запрос; вернёт { rows, rowCount }. */
export const run = (sql, params = []) => pool.query(sql, params);

/** Транзакция: fn получает { q, one, run } на одном соединении. */
export async function tx(fn) {
  const c = await pool.connect();
  const api = {
    q: async (s, p = []) => (await c.query(s, p)).rows,
    one: async (s, p = []) => (await c.query(s, p)).rows[0] ?? null,
    run: (s, p = []) => c.query(s, p),
  };
  try {
    await c.query('BEGIN');
    const r = await fn(api);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Вставка многих строк одним запросом (пачками). */
export async function insertMany(db, table, cols, rows, chunk = 300) {
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const params = [];
    const values = part.map((r) => `(${r.map((v) => { params.push(v); return `$${params.length}`; }).join(',')})`);
    await db.run(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${values.join(',')}`, params);
  }
}

// ---------- Миграции: новые изменения схемы добавляйте в конец списка ----------
const MIGRATIONS = [
  {
    id: 1,
    name: 'initial',
    sql: `
CREATE TABLE players (
  id SERIAL PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  height_cm INTEGER NOT NULL,
  weight_kg INTEGER NOT NULL,
  position TEXT NOT NULL DEFAULT 'MID' CHECK (position IN ('GK','DEF','MID','FWD')),
  foot TEXT NOT NULL DEFAULT 'R' CHECK (foot IN ('R','L','B')),
  phone TEXT NOT NULL UNIQUE,
  pin_hash TEXT NOT NULL,
  photo TEXT,
  blocked BOOLEAN NOT NULL DEFAULT FALSE,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_player ON sessions(player_id);

CREATE TABLE pitches (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  length_m DOUBLE PRECISION NOT NULL DEFAULT 40,
  width_m DOUBLE PRECISION NOT NULL DEFAULT 20,
  calibration JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE matches (
  id SERIAL PRIMARY KEY,
  pitch_id INTEGER NOT NULL REFERENCES pitches(id) ON DELETE RESTRICT,
  code TEXT NOT NULL UNIQUE,
  starts_at TIMESTAMPTZ NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 60,
  players_per_side INTEGER NOT NULL DEFAULT 6,
  team_a_name TEXT NOT NULL DEFAULT 'A topar',
  team_a_color TEXT NOT NULL DEFAULT '#E9ECF5',
  team_b_name TEXT NOT NULL DEFAULT 'B topar',
  team_b_color TEXT NOT NULL DEFAULT '#C8232C',
  score_a INTEGER,
  score_b INTEGER,
  possession_a DOUBLE PRECISION,
  video_file TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','uploaded','queued','processing','ready','failed')),
  analysis_source TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX matches_status ON matches(status);
CREATE INDEX matches_starts ON matches(starts_at DESC);

CREATE TABLE match_members (
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, player_id)
);
CREATE INDEX match_members_player ON match_members(player_id);

CREATE TABLE tracks (
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  track_no INTEGER NOT NULL,
  team TEXT NOT NULL CHECK (team IN ('A','B')),
  jersey INTEGER,
  role TEXT,
  thumbnail TEXT,
  player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  goals INTEGER NOT NULL DEFAULT 0,
  assists INTEGER NOT NULL DEFAULT 0,
  shots INTEGER NOT NULL DEFAULT 0,
  shots_on_target INTEGER NOT NULL DEFAULT 0,
  passes INTEGER NOT NULL DEFAULT 0,
  passes_completed INTEGER NOT NULL DEFAULT 0,
  turnovers INTEGER NOT NULL DEFAULT 0,
  tackles INTEGER NOT NULL DEFAULT 0,
  interceptions INTEGER NOT NULL DEFAULT 0,
  saves INTEGER NOT NULL DEFAULT 0,
  touches INTEGER NOT NULL DEFAULT 0,
  distance_m DOUBLE PRECISION NOT NULL DEFAULT 0,
  top_speed_kmh DOUBLE PRECISION NOT NULL DEFAULT 0,
  sprints INTEGER NOT NULL DEFAULT 0,
  max_shot_kmh DOUBLE PRECISION NOT NULL DEFAULT 0,
  rating DOUBLE PRECISION NOT NULL DEFAULT 6,
  heatmap JSONB,
  PRIMARY KEY (match_id, track_no)
);
CREATE UNIQUE INDEX tracks_player_once ON tracks(match_id, player_id) WHERE player_id IS NOT NULL;
CREATE INDEX tracks_player ON tracks(player_id) WHERE player_id IS NOT NULL;

CREATE TABLE events (
  id BIGSERIAL PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  t DOUBLE PRECISION NOT NULL,
  type TEXT NOT NULL,
  team TEXT,
  track_no INTEGER,
  target_track_no INTEGER,
  success SMALLINT,
  x DOUBLE PRECISION,
  y DOUBLE PRECISION,
  speed_kmh DOUBLE PRECISION
);
CREATE INDEX events_match ON events(match_id, t);

CREATE TABLE clips (
  id TEXT PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  start_s DOUBLE PRECISION NOT NULL,
  end_s DOUBLE PRECISION NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX clips_player ON clips(player_id);

CREATE TABLE votes (
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  voter_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  track_no INTEGER NOT NULL,
  PRIMARY KEY (match_id, voter_id)
);

-- Администраторы панели: owner — всё, включая других админов; manager — поля, матчи, игроки, клипы
CREATE TABLE admins (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'manager' CHECK (role IN ('owner','manager')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE admin_sessions (
  token TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Журнал действий в панели: кто, что и когда изменил
CREATE TABLE admin_log (
  id BIGSERIAL PRIMARY KEY,
  admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  admin_name TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX admin_log_created ON admin_log(created_at DESC);
`,
  },
];

export async function migrate() {
  const c = await pool.connect();
  try {
    // Блокировка: если запущено несколько копий сервера, миграцию выполнит одна
    await c.query('SELECT pg_advisory_lock(727001)');
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const done = new Set((await c.query('SELECT id FROM schema_migrations')).rows.map((r) => r.id));
    for (const m of MIGRATIONS) {
      if (done.has(m.id)) continue;
      await c.query('BEGIN');
      try {
        await c.query(m.sql);
        await c.query('INSERT INTO schema_migrations (id, name) VALUES ($1, $2)', [m.id, m.name]);
        await c.query('COMMIT');
        console.log(`  Миграция БД ${m.id} (${m.name}) применена`);
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    await c.query('SELECT pg_advisory_unlock(727001)').catch(() => {});
    c.release();
  }
}
