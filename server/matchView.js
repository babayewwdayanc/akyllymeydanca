// Сборка страницы матча: счёт, командная статистика, игроки, MVP, награды, хайлайты.
import { q, one } from './db.js';
import { matchAwards } from './rating.js';
import { mvpTrackOf, playerMini } from './players.js';

export const videoUrl = (m) => (m.video_file ? `/media/videos/${m.video_file}` : null);
export const thumbUrl = (matchId, t) => (t ? `/media/thumbs/${matchId}/${t}` : null);

/** Матч вместе с данными поля — используйте во всех запросах, после которых нужен matchSummary(). */
export const MATCH_SELECT = `
  SELECT m.*, p.name AS pitch_name, p.city AS pitch_city, p.length_m AS pitch_length, p.width_m AS pitch_width
  FROM matches m JOIN pitches p ON p.id = m.pitch_id`;

export const getMatch = (id) => one(`${MATCH_SELECT} WHERE m.id = $1`, [id]);
export const getMatchByCode = (code) => one(`${MATCH_SELECT} WHERE m.code = $1`, [code]);

export function matchSummary(m) {
  return {
    id: m.id,
    code: m.code,
    starts_at: m.starts_at,
    duration_min: m.duration_min,
    players_per_side: m.players_per_side,
    status: m.status,
    error: m.error,
    analysis_source: m.analysis_source,
    pitch: { id: m.pitch_id, name: m.pitch_name, city: m.pitch_city, length_m: m.pitch_length, width_m: m.pitch_width },
    teams: {
      A: { name: m.team_a_name, color: m.team_a_color, score: m.score_a },
      B: { name: m.team_b_name, color: m.team_b_color, score: m.score_b },
    },
    possession_a: m.possession_a,
    video_url: videoUrl(m),
  };
}

const EVENT_LABEL = { goal: 'Gol', save: 'Halas ediş', shot: 'Urgy' };

export function buildHighlights(events, trackMap) {
  const out = [];
  for (const e of events) {
    let pick = false;
    if (e.type === 'goal') pick = true;
    else if (e.type === 'save') pick = true;
    else if (e.type === 'shot' && e.success && (e.speed_kmh || 0) >= 95) pick = true;
    if (!pick) continue;
    const tr = trackMap.get(e.track_no);
    const who = tr?.player ? tr.player.name : tr ? `Oýunçy ${tr.track_no}${tr.jersey ? ` (№${tr.jersey})` : ''}` : '';
    out.push({
      t: e.t,
      type: e.type,
      team: e.team,
      track_no: e.track_no,
      label: `${EVENT_LABEL[e.type]}${e.type === 'shot' ? ` ${Math.round(e.speed_kmh)} km/sag` : ''} — ${who}`,
      start: Math.max(0, e.t - (e.type === 'goal' ? 8 : 5)),
      end: e.t + (e.type === 'goal' ? 4 : 3),
    });
  }
  return out;
}

function teamStats(tracks, team, possession) {
  const list = tracks.filter((t) => t.team === team);
  const sum = (k) => list.reduce((s, t) => s + t[k], 0);
  const passes = sum('passes');
  const completed = sum('passes_completed');
  return {
    possession,
    passes,
    passes_completed: completed,
    pass_accuracy: passes ? Math.round((completed / passes) * 100) : 0,
    shots: sum('shots'),
    shots_on_target: sum('shots_on_target'),
    errors: passes - completed + sum('turnovers'),
    tackles: sum('tackles') + sum('interceptions'),
    saves: sum('saves'),
    distance_km: Math.round(sum('distance_m') / 100) / 10,
  };
}

/** Треки матча с привязанными игроками (для страницы матча и админки). */
export async function matchTracks(matchId) {
  const rows = await q('SELECT * FROM tracks WHERE match_id = $1 ORDER BY team, track_no', [matchId]);
  const ids = rows.map((r) => r.player_id).filter(Boolean);
  const players = new Map((ids.length ? await q('SELECT * FROM players WHERE id = ANY($1::int[])', [ids]) : []).map((p) => [p.id, p]));
  const tracks = rows.map((t) => ({
    track_no: t.track_no,
    team: t.team,
    jersey: t.jersey,
    role: t.role,
    thumbnail_url: thumbUrl(matchId, t.thumbnail),
    player: playerMini(players.get(t.player_id)),
    goals: t.goals, assists: t.assists, shots: t.shots, shots_on_target: t.shots_on_target,
    passes: t.passes, passes_completed: t.passes_completed,
    pass_accuracy: t.passes ? Math.round((t.passes_completed / t.passes) * 100) : null,
    turnovers: t.turnovers,
    errors: t.passes - t.passes_completed + t.turnovers,
    tackles: t.tackles, interceptions: t.interceptions, saves: t.saves, touches: t.touches,
    distance_m: t.distance_m, top_speed_kmh: t.top_speed_kmh, sprints: t.sprints, max_shot_kmh: t.max_shot_kmh,
    rating: t.rating,
    heatmap: t.heatmap ?? null,
  }));
  return { rows, tracks };
}

export async function matchDetail(m, viewerId) {
  const summary = matchSummary(m);
  const { rows, tracks } = await matchTracks(m.id);
  const trackMap = new Map(tracks.map((t) => [t.track_no, t]));
  const events = await q('SELECT t, type, team, track_no, target_track_no, success, x, y, speed_kmh FROM events WHERE match_id = $1 ORDER BY t, id', [m.id]);
  const mvp = await mvpTrackOf(m.id);
  const votes = {};
  for (const v of await q('SELECT track_no, COUNT(*)::int AS n FROM votes WHERE match_id = $1 GROUP BY track_no', [m.id])) votes[v.track_no] = v.n;
  const myVote = viewerId ? (await one('SELECT track_no FROM votes WHERE match_id = $1 AND voter_id = $2', [m.id, viewerId]))?.track_no ?? null : null;
  const myTrack = viewerId ? rows.find((r) => r.player_id === viewerId)?.track_no ?? null : null;
  const pa = m.possession_a ?? 0.5;
  const maxBall = events.reduce((mx, e) => (e.type === 'shot' || e.type === 'goal' ? Math.max(mx, e.speed_kmh || 0) : mx), 0);
  const fanMvp = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];

  return {
    ...summary,
    tracks,
    mvp: mvp ? { track_no: mvp.track_no, rating: mvp.rating } : null,
    fan_mvp: fanMvp ? { track_no: Number(fanMvp[0]), votes: fanMvp[1] } : null,
    votes,
    my_vote: myVote,
    my_track: myTrack,
    awards: matchAwards(rows),
    highlights: buildHighlights(events, trackMap),
    team_stats: { A: teamStats(rows, 'A', pa), B: teamStats(rows, 'B', 1 - pa) },
    max_ball_kmh: Math.round(maxBall),
    events,
  };
}
