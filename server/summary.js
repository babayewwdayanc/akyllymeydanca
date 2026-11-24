// Необязательно: текстовый обзор матча от языковой модели Claude.
// ВАЖНО: модель НЕ смотрит видео и не считает пасы — она получает уже посчитанные цифры
// (от компьютерного зрения) и пишет по ним короткий репортаж на русском.
// Включается, если на сервере задан ANTHROPIC_API_KEY.

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';

export const summaryAvailable = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

function compactMatch(d) {
  const name = (t) => (t.player ? t.player.name : `Oýunçy ${t.track_no}${t.jersey ? ` №${t.jersey}` : ''}`);
  const byNo = new Map(d.tracks.map((t) => [t.track_no, t]));
  return {
    pitch: d.pitch?.name,
    teams: { A: d.teams.A.name, B: d.teams.B.name },
    score: `${d.teams.A.score}:${d.teams.B.score}`,
    team_stats: d.team_stats,
    max_ball_kmh: d.max_ball_kmh,
    goals: d.events.filter((e) => e.type === 'goal').map((e) => ({
      minute: Math.floor(e.t / 60) + 1,
      team: d.teams[e.team]?.name,
      scorer: byNo.get(e.track_no) ? name(byNo.get(e.track_no)) : null,
      assist: byNo.get(e.target_track_no) ? name(byNo.get(e.target_track_no)) : null,
    })),
    mvp: d.mvp ? { name: name(byNo.get(d.mvp.track_no)), rating: d.mvp.rating } : null,
    players: d.tracks.map((t) => ({
      name: name(t), team: d.teams[t.team].name, rating: t.rating, goals: t.goals, assists: t.assists,
      passes: `${t.passes_completed}/${t.passes}`, errors: t.errors, km: Math.round(t.distance_m / 100) / 10, top_kmh: t.top_speed_kmh,
    })),
  };
}

export async function generateMatchSummary(detail) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 2000,
    output_config: { effort: 'low' },
    // Если модель откажется отвечать, сервер API сам повторит запрос на запасной модели.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system:
      'Ты спортивный журналист любительской футбольной лиги. Пиши на туркменском языке (латиница, современная орфография), живо и по-доброму, без оскорблений игроков. ' +
      'Используй только факты из переданных данных, ничего не выдумывай. Объём — 120–180 слов, 2–3 абзаца, без заголовков и списков.',
    messages: [
      { role: 'user', content: `Türkmen dilinde gysga oýun synyny ýaz. Maglumatlar:\n${JSON.stringify(compactMatch(detail))}` },
    ],
  });
  if (response.stop_reason === 'refusal') throw Object.assign(new Error('Model syny ýazmakdan ýüz öwürdi'), { status: 502 });
  return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}
