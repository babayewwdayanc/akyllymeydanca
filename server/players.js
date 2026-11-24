// Профиль игрока: суммарная статистика по всем матчам + карточка.
// Статистика считается одним запросом сразу для многих игроков (рейтинг, админка).
import { q, one } from './db.js';
import { buildCard, EMPTY_AGG, POSITIONS } from './rating.js';

export const photoUrl = (file) => (file ? `/media/photos/${file}` : null);

/** Номер трека MVP матча: лучшая оценка, при равенстве — больше голов и передач. */
export const MVP_ORDER = 'rating DESC, goals DESC, assists DESC, track_no';
export const mvpTrackOf = (matchId) =>
  one(`SELECT track_no, rating FROM tracks WHERE match_id = $1 ORDER BY ${MVP_ORDER} LIMIT 1`, [matchId]);

const SUM_KEYS = ['goals', 'assists', 'shots', 'shots_on_target', 'passes', 'passes_completed', 'turnovers', 'tackles', 'interceptions', 'saves', 'touches', 'distance_m', 'sprints'];

function summarize(rows) {
  const agg = { ...EMPTY_AGG };
  const history = [];
  for (const r of rows) {
    for (const k of SUM_KEYS) agg[k] += r[k];
    agg.max_shot_kmh = Math.max(agg.max_shot_kmh, r.max_shot_kmh);
    agg.top_speed = Math.max(agg.top_speed, r.top_speed_kmh);
    agg.top_speed_sum += r.top_speed_kmh;
    agg.rating_sum += r.rating;
    if (r.is_mvp) agg.mvp++;
    const mine = r.team === 'A' ? r.score_a : r.score_b;
    const theirs = r.team === 'A' ? r.score_b : r.score_a;
    history.push({
      match_id: r.match_id,
      starts_at: r.starts_at,
      team: r.team,
      opponent: r.team === 'A' ? r.team_b_name : r.team_a_name,
      my_team: r.team === 'A' ? r.team_a_name : r.team_b_name,
      score: `${mine ?? '–'}:${theirs ?? '–'}`,
      result: mine > theirs ? 'W' : mine < theirs ? 'L' : 'D',
      rating: r.rating,
      goals: r.goals,
      assists: r.assists,
      mvp: !!r.is_mvp,
    });
  }
  return { agg, n: rows.length, history };
}

/** Map(id игрока → { agg, n, history }) для списка игроков. */
export async function aggregatesFor(ids) {
  const out = new Map(ids.map((id) => [id, summarize([])]));
  if (!ids.length) return out;
  const rows = await q(`
    SELECT t.*, m.starts_at, m.team_a_name, m.team_b_name, m.score_a, m.score_b,
      t.track_no = (SELECT t2.track_no FROM tracks t2 WHERE t2.match_id = t.match_id
                    ORDER BY t2.rating DESC, t2.goals DESC, t2.assists DESC, t2.track_no LIMIT 1) AS is_mvp
    FROM tracks t JOIN matches m ON m.id = t.match_id
    WHERE m.status = 'ready' AND t.player_id = ANY($1::int[])
    ORDER BY m.starts_at DESC`, [ids]);
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.player_id)) by.set(r.player_id, []);
    by.get(r.player_id).push(r);
  }
  for (const [id, list] of by) out.set(id, summarize(list));
  return out;
}

/** Публичный профиль: карточка + итоги. entry — из aggregatesFor. */
export function playerPublic(p, entry, { withHistory = false } = {}) {
  const { agg, n, history } = entry || summarize([]);
  const card = buildCard(p, agg, n);
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
      errors: agg.passes - agg.passes_completed + agg.turnovers,
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

/** Профиль одного игрока (с историей матчей). */
export async function playerFull(p) {
  const m = await aggregatesFor([p.id]);
  return playerPublic(p, m.get(p.id), { withHistory: true });
}

export const getPlayer = (id) => one('SELECT * FROM players WHERE id = $1', [id]);

export function playerMini(p) {
  if (!p) return null;
  return { id: p.id, name: `${p.first_name} ${p.last_name}`, first_name: p.first_name, last_name: p.last_name, photo_url: photoUrl(p.photo), photo_cutout: !!p.photo?.endsWith('.png') };
}
