// Сборка страницы матча: счёт, командная статистика, игроки, MVP, награды, хайлайты.
import { db } from './db.js';
import { matchAwards } from './rating.js';
import { mvpTrackOf, playerMini } from './players.js';

export const videoUrl = (m) => (m.video_file ? `/media/videos/${m.video_file}` : null);
export const thumbUrl = (matchId, t) => (t ? `/media/thumbs/${matchId}/${t}` : null);

export function matchSummary(m) {
  const pitch = db.prepare('SELECT * FROM pitches WHERE id = ?').get(m.pitch_id);
  return {
    id: m.id,
    code: m.code,
    starts_at: m.starts_at,
    duration_min: m.duration_min,
    players_per_side: m.players_per_side,
    status: m.status,
    error: m.error,
    analysis_source: m.analysis_source,
    pitch: pitch ? { id: pitch.id, name: pitch.name, city: pitch.city, length_m: pitch.length_m, width_m: pitch.width_m } : null,
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
    possession: possession,
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

export function matchDetail(m, viewerId) {
  const summary = matchSummary(m);
  const rows = db.prepare('SELECT * FROM tracks WHERE match_id = ? ORDER BY team, track_no').all(m.id);
  const players = new Map(
    db.prepare('SELECT p.* FROM players p JOIN tracks t ON t.player_id = p.id WHERE t.match_id = ?').all(m.id).map((p) => [p.id, p]),
  );
  const tracks = rows.map((t) => ({
    track_no: t.track_no,
    team: t.team,
    jersey: t.jersey,
    role: t.role,
    thumbnail_url: thumbUrl(m.id, t.thumbnail),
    player: playerMini(players.get(t.player_id)),
    goals: t.goals, assists: t.assists, shots: t.shots, shots_on_target: t.shots_on_target,
    passes: t.passes, passes_completed: t.passes_completed,
    pass_accuracy: t.passes ? Math.round((t.passes_completed / t.passes) * 100) : null,
    turnovers: t.turnovers,
    errors: t.passes - t.passes_completed + t.turnovers,
    tackles: t.tackles, interceptions: t.interceptions, saves: t.saves, touches: t.touches,
    distance_m: t.distance_m, top_speed_kmh: t.top_speed_kmh, sprints: t.sprints, max_shot_kmh: t.max_shot_kmh,
    rating: t.rating,
    heatmap: t.heatmap ? JSON.parse(t.heatmap) : null,
  }));
  const trackMap = new Map(tracks.map((t) => [t.track_no, t]));
  const events = db.prepare('SELECT t, type, team, track_no, target_track_no, success, x, y, speed_kmh FROM events WHERE match_id = ? ORDER BY t').all(m.id);
  const mvp = mvpTrackOf(m.id);
  const votes = {};
  for (const v of db.prepare('SELECT track_no, COUNT(*) AS n FROM votes WHERE match_id = ? GROUP BY track_no').all(m.id)) votes[v.track_no] = v.n;
  const myVote = viewerId ? db.prepare('SELECT track_no FROM votes WHERE match_id = ? AND voter_id = ?').get(m.id, viewerId)?.track_no ?? null : null;
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
