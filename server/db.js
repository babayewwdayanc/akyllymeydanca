// База данных: встроенный в Node.js SQLite (node:sqlite), без внешних зависимостей.
// В продакшене можно заменить на PostgreSQL — схема простая и переносится 1:1.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

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

export const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  height_cm INTEGER NOT NULL,
  weight_kg INTEGER NOT NULL,
  position TEXT NOT NULL DEFAULT 'MID',      -- GK | DEF | MID | FWD
  foot TEXT NOT NULL DEFAULT 'R',            -- R | L | B
  phone TEXT NOT NULL UNIQUE,
  pin_hash TEXT NOT NULL,
  photo TEXT,                                -- имя файла в data/photos
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pitches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  length_m REAL NOT NULL DEFAULT 40,
  width_m REAL NOT NULL DEFAULT 20,
  calibration TEXT                           -- JSON: 4 точки кадра → углы поля (делает ai/calibrate.py)
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pitch_id INTEGER NOT NULL REFERENCES pitches(id),
  code TEXT NOT NULL UNIQUE,                 -- код матча, по которому игроки находят своё видео
  starts_at TEXT NOT NULL,                   -- ISO-время начала
  duration_min INTEGER NOT NULL DEFAULT 60,
  players_per_side INTEGER NOT NULL DEFAULT 6,
  team_a_name TEXT NOT NULL DEFAULT 'A topar',
  team_a_color TEXT NOT NULL DEFAULT '#E4E7F0',
  team_b_name TEXT NOT NULL DEFAULT 'B topar',
  team_b_color TEXT NOT NULL DEFAULT '#C8232C',
  score_a INTEGER,
  score_b INTEGER,
  possession_a REAL,
  video_file TEXT,                           -- имя файла в data/videos
  status TEXT NOT NULL DEFAULT 'scheduled',  -- scheduled | uploaded | queued | processing | ready | failed
  analysis_source TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS match_members (
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  PRIMARY KEY (match_id, player_id)
);

-- Треки: «Игрок 1, Игрок 2…», которых нашёл AI. Игрок сам отмечает, какой трек — он.
CREATE TABLE IF NOT EXISTS tracks (
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  track_no INTEGER NOT NULL,
  team TEXT NOT NULL,                        -- A | B
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
  distance_m REAL NOT NULL DEFAULT 0,
  top_speed_kmh REAL NOT NULL DEFAULT 0,
  sprints INTEGER NOT NULL DEFAULT 0,
  max_shot_kmh REAL NOT NULL DEFAULT 0,
  rating REAL NOT NULL DEFAULT 6,
  heatmap TEXT,                              -- JSON-сетка 16x8
  PRIMARY KEY (match_id, track_no)
);
CREATE UNIQUE INDEX IF NOT EXISTS tracks_player_once ON tracks(match_id, player_id) WHERE player_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  t REAL NOT NULL,
  type TEXT NOT NULL,                        -- pass | shot | goal | save | tackle | interception | turnover
  team TEXT,
  track_no INTEGER,
  target_track_no INTEGER,
  success INTEGER,
  x REAL, y REAL,
  speed_kmh REAL
);
CREATE INDEX IF NOT EXISTS events_match ON events(match_id, t);

CREATE TABLE IF NOT EXISTS clips (
  id TEXT PRIMARY KEY,                       -- короткий публичный id для ссылки
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  start_s REAL NOT NULL,
  end_s REAL NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS votes (
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  voter_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  track_no INTEGER NOT NULL,
  PRIMARY KEY (match_id, voter_id)
);
`);

/** Выполнить функцию в транзакции. */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
