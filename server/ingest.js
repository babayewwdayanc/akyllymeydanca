// Приём результата анализа (от AI или демо-симулятора) и расчёт статистики игроков.
// AI отдаёт только «сырые» данные: треки, события (пасы, удары…) и координаты по времени.
// Всё остальное — проценты, оценки, MVP, награды — считает сервер, одинаково для любого источника.
import fs from 'node:fs';
import path from 'node:path';
import { db, tx, DIRS } from './db.js';
import { matchRating } from './rating.js';

const SPRINT_MS = 5.5; // ≈ 19.8 км/ч — порог спринта
const MAX_HUMAN_MS = 10; // всё быстрее — ошибка трекинга
const HEAT_W = 16;
const HEAT_H = 8;

export function validateAnalysis(a) {
  const errors = [];
  if (!a || typeof a !== 'object') return ['boş netije'];
  if (a.schema !== 'akylly-analysis/v1') errors.push('schema "akylly-analysis/v1" bolmaly');
  if (!Array.isArray(a.tracks) || a.tracks.length === 0) errors.push('tracks ýok');
  if (!Array.isArray(a.events)) errors.push('events ýok');
  if (!a.pitch?.length_m || !a.pitch?.width_m) errors.push('pitch.length_m / pitch.width_m ýok');
  for (const tr of a.tracks || []) {
    if (!Number.isInteger(tr.track_no) || !['A', 'B'].includes(tr.team)) {
      errors.push(`nädogry trek: ${JSON.stringify(tr)}`);
      break;
    }
  }
  return errors;
}

/** Физика по координатам: дистанция, макс. скорость, спринты, тепловая карта. */
function physicalFromFrames(a) {
  const out = {};
  const hz = a.frames_hz || 1;
  const dt = 1 / hz;
  const order = a.frame_tracks || a.tracks.map((t) => t.track_no);
  const L = a.pitch.length_m;
  const W = a.pitch.width_m;
  order.forEach((trackNo, i) => {
    let distance = 0;
    let top = 0;
    let sprints = 0;
    let inSprint = false;
    let prev = null;
    let prevV = 0;
    const heat = Array.from({ length: HEAT_H }, () => Array(HEAT_W).fill(0));
    for (const f of a.frames || []) {
      const p = f.p?.[i];
      if (!p) { prev = null; continue; }
      const gx = Math.min(HEAT_W - 1, Math.max(0, Math.floor((p[0] / L) * HEAT_W)));
      const gy = Math.min(HEAT_H - 1, Math.max(0, Math.floor((p[1] / W) * HEAT_H)));
      heat[gy][gx]++;
      if (prev) {
        const d = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
        const v = d / dt;
        if (v <= MAX_HUMAN_MS) {
          distance += d;
          const smooth = (v + prevV) / 2; // сглаживание шума трекинга
          top = Math.max(top, smooth);
          if (v >= SPRINT_MS && !inSprint) { sprints++; inSprint = true; }
          if (v < SPRINT_MS * 0.8) inSprint = false;
          prevV = v;
        }
      }
      prev = p;
    }
    const max = Math.max(1, ...heat.flat());
    out[trackNo] = {
      distance_m: Math.round(distance),
      top_speed_kmh: Math.round(top * 3.6 * 10) / 10,
      sprints,
      heatmap: heat.map((row) => row.map((v) => Math.round((v / max) * 100) / 100)),
    };
  });
  return out;
}

export function computeTrackStats(a) {
  const stats = {};
  for (const tr of a.tracks) {
    stats[tr.track_no] = {
      track_no: tr.track_no, team: tr.team, jersey: tr.jersey ?? null, role: tr.role ?? null, thumbnail: tr.thumbnail ?? null,
      goals: 0, assists: 0, shots: 0, shots_on_target: 0, passes: 0, passes_completed: 0, turnovers: 0,
      tackles: 0, interceptions: 0, saves: 0, touches: 0, distance_m: 0, top_speed_kmh: 0, sprints: 0, max_shot_kmh: 0,
      heatmap: null,
    };
  }
  const S = (n) => stats[n];
  for (const e of a.events) {
    const s = S(e.track_no);
    if (!s) continue;
    switch (e.type) {
      case 'pass':
        s.passes++; s.touches++;
        if (e.success) { s.passes_completed++; if (S(e.target_track_no)) S(e.target_track_no).touches++; }
        break;
      case 'shot':
        s.shots++; s.touches++;
        if (e.success) s.shots_on_target++;
        if (e.speed_kmh) s.max_shot_kmh = Math.max(s.max_shot_kmh, e.speed_kmh);
        break;
      case 'goal':
        s.goals++;
        if (e.speed_kmh) s.max_shot_kmh = Math.max(s.max_shot_kmh, e.speed_kmh);
        if (S(e.target_track_no)) S(e.target_track_no).assists++;
        break;
      case 'save': s.saves++; s.touches++; break;
      case 'tackle': s.tackles++; s.touches++; break;
      case 'interception': s.interceptions++; s.touches++; break;
      case 'turnover': s.turnovers++; break;
    }
  }
  const phys = a.player_physical || physicalFromFrames(a);
  for (const [k, p] of Object.entries(phys)) {
    if (!stats[k]) continue;
    Object.assign(stats[k], {
      distance_m: p.distance_m ?? 0,
      top_speed_kmh: p.top_speed_kmh ?? 0,
      sprints: p.sprints ?? 0,
      heatmap: p.heatmap ?? null,
    });
  }
  return stats;
}

export function ingestAnalysis(matchId, a) {
  const errs = validateAnalysis(a);
  if (errs.length) throw Object.assign(new Error('Derňewiň formaty nädogry: ' + errs.join('; ')), { status: 400 });

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) throw Object.assign(new Error('Oýun tapylmady'), { status: 404 });

  // Сырые данные (координаты для 2D-повтора) — в файл, в базе только итоговая статистика.
  fs.writeFileSync(path.join(DIRS.analysis, `${matchId}.json`), JSON.stringify(a));

  const stats = computeTrackStats(a);
  const goalsBy = { A: 0, B: 0 };
  for (const e of a.events) if (e.type === 'goal' && goalsBy[e.team] !== undefined) goalsBy[e.team]++;
  const scoreA = a.score?.A ?? goalsBy.A;
  const scoreB = a.score?.B ?? goalsBy.B;
  const minutes = (a.duration_s || match.duration_min * 60) / 60;

  for (const s of Object.values(stats)) {
    const mine = s.team === 'A' ? scoreA : scoreB;
    const theirs = s.team === 'A' ? scoreB : scoreA;
    s.rating = matchRating(s, { won: mine > theirs, draw: mine === theirs, minutes });
  }

  tx(() => {
    // Повторный анализ: сохраняем, кто какой трек отметил как «это я».
    const claims = new Map(db.prepare('SELECT track_no, player_id FROM tracks WHERE match_id = ? AND player_id IS NOT NULL').all(matchId).map((r) => [r.track_no, r.player_id]));
    db.prepare('DELETE FROM tracks WHERE match_id = ?').run(matchId);
    db.prepare('DELETE FROM events WHERE match_id = ?').run(matchId);
    const insT = db.prepare(`INSERT INTO tracks (match_id, track_no, team, jersey, role, thumbnail, player_id, goals, assists, shots, shots_on_target,
      passes, passes_completed, turnovers, tackles, interceptions, saves, touches, distance_m, top_speed_kmh, sprints, max_shot_kmh, rating, heatmap)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const s of Object.values(stats)) {
      insT.run(matchId, s.track_no, s.team, s.jersey, s.role, s.thumbnail, claims.get(s.track_no) ?? null, s.goals, s.assists, s.shots,
        s.shots_on_target, s.passes, s.passes_completed, s.turnovers, s.tackles, s.interceptions, s.saves, s.touches,
        s.distance_m, s.top_speed_kmh, s.sprints, s.max_shot_kmh, s.rating, s.heatmap ? JSON.stringify(s.heatmap) : null);
    }
    const insE = db.prepare('INSERT INTO events (match_id, t, type, team, track_no, target_track_no, success, x, y, speed_kmh) VALUES (?,?,?,?,?,?,?,?,?,?)');
    for (const e of a.events) {
      insE.run(matchId, e.t, e.type, e.team ?? null, e.track_no ?? null, e.target_track_no ?? null,
        e.success === undefined || e.success === null ? null : e.success ? 1 : 0, e.x ?? null, e.y ?? null, e.speed_kmh ?? null);
    }
    db.prepare(`UPDATE matches SET score_a = ?, score_b = ?, possession_a = ?, status = 'ready', analysis_source = ?, error = NULL WHERE id = ?`)
      .run(scoreA, scoreB, a.possession?.A ?? null, a.source || 'unknown', matchId);
  });
  return { tracks: Object.keys(stats).length, events: a.events.length, score: [scoreA, scoreB] };
}

export function loadReplay(matchId) {
  const f = path.join(DIRS.analysis, `${matchId}.json`);
  if (!fs.existsSync(f)) return null;
  const a = JSON.parse(fs.readFileSync(f, 'utf8'));
  return { pitch: a.pitch, frames_hz: a.frames_hz || 1, frame_tracks: a.frame_tracks || a.tracks.map((t) => t.track_no), frames: a.frames || [], duration_s: a.duration_s };
}
