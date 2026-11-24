// Профиль игрока: суммарная статистика по всем матчам + карточка.
import { db } from './db.js';
import { buildCard, EMPTY_AGG, POSITIONS } from './rating.js';

export const photoUrl = (file) => (file ? `/media/photos/${file}` : null);

/** Номер трека MVP матча: лучшая оценка, при равенстве — больше голов. */
export function mvpTrackOf(matchId) {
  const row = db.prepare(`SELECT track_no, rating FROM tracks WHERE match_id = ? ORDER BY rating DESC, goals DESC, assists DESC LIMIT 1`).get(matchId);
  return row || null;
}

export function aggregateFor(playerId) {
  const rows = db.prepare(`
    SELECT t.*, m.starts_at, m.team_a_name, m.team_b_name, m.score_a, m.score_b, m.id AS mid
    FROM tracks t JOIN matches m ON m.id = t.match_id
    WHERE t.player_id = ? AND m.status = 'ready'
    ORDER BY m.starts_at DESC`).all(playerId);
  const agg = { ...EMPTY_AGG };
  const history = [];
  for (const r of rows) {
    for (const k of ['goals', 'assists', 'shots', 'shots_on_target', 'passes', 'passes_completed', 'turnovers', 'tackles', 'interceptions', 'saves', 'touches', 'distance_m', 'sprints']) {
      agg[k] += r[k];
    }
    agg.max_shot_kmh = Math.max(agg.max_shot_kmh, r.max_shot_kmh);
    agg.top_speed = Math.max(agg.top_speed, r.top_speed_kmh);
    agg.top_speed_sum += r.top_speed_kmh;
    agg.rating_sum += r.rating;
    const mvp = mvpTrackOf(r.match_id);
    const isMvp = mvp && mvp.track_no === r.track_no;
    if (isMvp) agg.mvp++;
    const mine = r.team === 'A' ? r.score_a : r.score_b;
    const theirs = r.team === 'A' ? r.score_b : r.score_a;
    history.push({
      match_id: r.match_id,
      starts_at: r.starts_at,
      team: r.team,
      opponent: r.team === 'A' ? r.team_b_name : r.team_a_name,
      my_team: r.team === 'A' ? r.team_a_name : r.team_b_name,
      score: `${mine}:${theirs}`,
      result: mine > theirs ? 'W' : mine < theirs ? 'L' : 'D',
      rating: r.rating,
      goals: r.goals,
      assists: r.assists,
      mvp: !!isMvp,
    });
  }
  const n = rows.length;
  return { agg, n, history };
}

export function playerPublic(p, { withHistory = false } = {}) {
  const { agg, n, history } = aggregateFor(p.id);
  const card = buildCard(p, agg, n);
  const errors = agg.passes - agg.passes_completed + agg.turnovers;
  const out = {
    id: p.id,
    first_name: p.first_name,
    last_name: p.last_name,
    height_cm: p.height_cm,
    weight_kg: p.weight_kg,
    position: p.position,
    position_name: POSITIONS[p.position],
    foot: p.foot,
    photo_url: photoUrl(p.photo),
    photo_cutout: !!p.photo && p.photo.endsWith('.png'), // PNG = фото с убранным фоном
    card,
    totals: {
      matches: n,
      goals: agg.goals,
      assists: agg.assists,
      mvp: agg.mvp,
      passes: agg.passes,
      passes_completed: agg.passes_completed,
      pass_accuracy: agg.passes ? Math.round((agg.passes_completed / agg.passes) * 100) : null,
      errors,
      shots: agg.shots,
      shots_on_target: agg.shots_on_target,
      tackles: agg.tackles,
      interceptions: agg.interceptions,
      saves: agg.saves,
      distance_km: Math.round(agg.distance_m / 10) / 100,
      top_speed_kmh: agg.top_speed,
      max_shot_kmh: agg.max_shot_kmh,
      avg_rating: n ? Math.round((agg.rating_sum / n) * 10) / 10 : null,
    },
  };
  if (withHistory) out.history = history;
  return out;
}

export function playerMini(p) {
  if (!p) return null;
  return { id: p.id, name: `${p.first_name} ${p.last_name}`, first_name: p.first_name, last_name: p.last_name, photo_url: photoUrl(p.photo), photo_cutout: !!p.photo?.endsWith('.png') };
}
