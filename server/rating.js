// Рейтинги: оценка игрока за матч (0–10), MVP, «лучшие в матче» и карточка игрока (6 параметров + общий рейтинг).

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * clamp(t, 0, 1);
/** Линейно перевести значение v из диапазона [a,b] в диапазон [lo,hi]. */
const scale = (v, a, b, lo, hi) => lerp(lo, hi, (v - a) / (b - a));

export const POSITIONS = {
  GK: 'Derwezeçi',
  DEF: 'Goragçy',
  MID: 'Ýarym goragçy',
  FWD: 'Hüjümçi',
};

export const ATTRS = [
  { key: 'pac', short: 'TIZ', name: 'Tizlik' },
  { key: 'sho', short: 'URG', name: 'Urgy' },
  { key: 'pas', short: 'PAS', name: 'Pas' },
  { key: 'dri', short: 'DRB', name: 'Dribling' },
  { key: 'def', short: 'GOR', name: 'Gorag' },
  { key: 'phy', short: 'FIZ', name: 'Fiziki' },
];

const OVR_WEIGHTS = {
  GK: { pac: 0.05, sho: 0.0, pas: 0.2, dri: 0.05, def: 0.45, phy: 0.25 },
  DEF: { pac: 0.15, sho: 0.05, pas: 0.2, dri: 0.05, def: 0.35, phy: 0.2 },
  MID: { pac: 0.1, sho: 0.15, pas: 0.3, dri: 0.2, def: 0.15, phy: 0.1 },
  FWD: { pac: 0.2, sho: 0.3, pas: 0.15, dri: 0.2, def: 0.05, phy: 0.1 },
};

/**
 * Оценка за матч по шкале 3–10 (как в популярных статистических сервисах).
 * Старт 6.0, плюсы за голы/передачи/отборы, минусы за потери.
 */
export function matchRating(s, { won = false, draw = false, minutes = 60 } = {}) {
  const passAcc = s.passes > 0 ? s.passes_completed / s.passes : 0.75;
  const per60 = 60 / Math.max(minutes, 20);
  const cap = (v, m) => Math.min(v, m);
  let r = 6.0;
  r += cap(s.goals * 0.6, 1.8);
  r += cap(s.assists * 0.4, 1.2);
  r += cap(s.shots_on_target * 0.05, 0.3);
  r += cap(s.passes_completed * 0.01 * per60, 0.5);
  r += clamp((passAcc - 0.78) * 2.5, -0.6, 0.3);
  r += cap((s.tackles + s.interceptions) * 0.04 * per60, 0.5);
  r += cap(s.saves * 0.1, 0.9);
  r -= cap(s.turnovers * 0.05, 0.6);
  r += clamp((s.distance_m * per60 - 4000) / 5000, -0.3, 0.3);
  if (won) r += 0.3;
  else if (draw) r += 0.1;
  return Math.round(clamp(r, 3, 10) * 10) / 10;
}

/** Номинации «Лучшие в матче» — показываем только если есть хоть какое-то значение. */
export function matchAwards(tracks) {
  const def = [
    { key: 'goals', title: 'Bombardir', unit: 'gol', fmt: (v) => v },
    { key: 'assists', title: 'Pas ussady', unit: 'gol pasy', fmt: (v) => v },
    { key: 'passes_completed', title: 'Oýun guramaçy', unit: 'takyk pas', fmt: (v) => v },
    { key: 'top_speed_kmh', title: 'Iň çalt', unit: 'km/sag', fmt: (v) => v.toFixed(1) },
    { key: 'distance_m', title: 'Toparyň motory', unit: 'km', fmt: (v) => (v / 1000).toFixed(2) },
    { key: 'max_shot_kmh', title: 'Güýçli aýak', unit: 'km/sag urgy', fmt: (v) => Math.round(v) },
    { key: 'def_actions', title: 'Diwar', unit: 'top alyş', fmt: (v) => v },
    { key: 'saves', title: 'Halasçy derwezeçi', unit: 'halas ediş', fmt: (v) => v },
  ];
  const rows = tracks.map((t) => ({ ...t, def_actions: t.tackles + t.interceptions }));
  const out = [];
  for (const d of def) {
    const best = rows.reduce((a, b) => (b[d.key] > (a?.[d.key] ?? -1) ? b : a), null);
    if (best && best[d.key] > 0) {
      out.push({ key: d.key, title: d.title, track_no: best.track_no, value: d.fmt(best[d.key]), unit: d.unit });
    }
  }
  return out;
}

/** Стартовые параметры карточки — по телу и позиции (пока нет сыгранных матчей). */
export function baseAttributes(player) {
  const h = player.height_cm;
  const w = player.weight_kg;
  const bmi = w / (h / 100) ** 2;
  const base = { pac: 55, sho: 52, pas: 54, dri: 53, def: 52, phy: 55 };
  // Лёгкие — быстрее, тяжёлые и высокие — сильнее физически.
  base.pac += Math.round(clamp((24 - bmi) * 1.5, -6, 6));
  base.phy += Math.round(clamp((h - 175) * 0.25 + (bmi - 22) * 0.8, -6, 8));
  base.dri += Math.round(clamp((178 - h) * 0.15, -3, 4));
  const posBoost = {
    GK: { def: 8, phy: 4, sho: -6 },
    DEF: { def: 7, phy: 3, sho: -3 },
    MID: { pas: 6, dri: 3 },
    FWD: { sho: 7, pac: 3, def: -4 },
  }[player.position] || {};
  for (const [k, v] of Object.entries(posBoost)) base[k] += v;
  for (const k of Object.keys(base)) base[k] = clamp(base[k], 40, 70);
  return base;
}

/**
 * Параметры по статистике сыгранных матчей.
 * agg — суммы по всем матчам игрока, n — количество матчей.
 */
function statAttributes(agg, n, player) {
  const per = (k) => agg[k] / n;
  const passAcc = agg.passes > 0 ? agg.passes_completed / agg.passes : 0.7;
  const shotAcc = agg.shots > 0 ? agg.shots_on_target / agg.shots : 0.3;
  const avgTop = agg.top_speed_sum / n;
  const turnoverRate = agg.touches > 0 ? agg.turnovers / agg.touches : 0.2;
  return {
    pac: scale(avgTop, 17, 32, 40, 96),
    sho: 0.45 * scale(per('goals'), 0, 2.5, 40, 97) + 0.3 * scale(shotAcc, 0.15, 0.75, 40, 95) + 0.25 * scale(agg.max_shot_kmh, 50, 115, 40, 97),
    pas: 0.6 * scale(passAcc, 0.55, 0.93, 40, 96) + 0.4 * scale(per('passes_completed'), 3, 30, 40, 94),
    dri: 0.6 * scale(1 - turnoverRate, 0.7, 0.95, 40, 95) + 0.4 * scale(per('touches'), 10, 60, 40, 92),
    def: scale(per('tackles') + per('interceptions') + per('saves') * 0.8, 0, 9, 40, 95),
    phy: 0.65 * scale(per('distance_m'), 2500, 7500, 40, 95) + 0.35 * scale(per('sprints'), 2, 22, 40, 94) + (player.height_cm > 185 ? 2 : 0),
  };
}

/** Карточка игрока: 6 параметров, общий рейтинг, уровень (бронза/серебро/золото). */
export function buildCard(player, agg, matchesCount) {
  const base = baseAttributes(player);
  let attrs = { ...base };
  if (matchesCount > 0) {
    const st = statAttributes(agg, matchesCount, player);
    // Чем больше матчей, тем больше карточка опирается на реальную статистику.
    const w = Math.min(matchesCount, 10) / 10 * 0.85 + 0.1;
    for (const k of Object.keys(attrs)) attrs[k] = Math.round(lerp(base[k], st[k], w));
  }
  for (const k of Object.keys(attrs)) attrs[k] = clamp(Math.round(attrs[k]), 30, 99);
  const wts = OVR_WEIGHTS[player.position] || OVR_WEIGHTS.MID;
  const ovr = Math.round(Object.entries(wts).reduce((s, [k, v]) => s + attrs[k] * v, 0));
  const tier = ovr >= 80 ? 'gold' : ovr >= 65 ? 'silver' : 'bronze';
  return {
    ovr,
    tier,
    attrs,
    position: player.position,
    provisional: matchesCount < 3, // как у оригинала: «настоящая» карточка после 3 матчей
    matches: matchesCount,
  };
}

export const EMPTY_AGG = {
  goals: 0, assists: 0, shots: 0, shots_on_target: 0, passes: 0, passes_completed: 0,
  turnovers: 0, tackles: 0, interceptions: 0, saves: 0, touches: 0, distance_m: 0,
  sprints: 0, max_shot_kmh: 0, top_speed: 0, top_speed_sum: 0, rating_sum: 0, mvp: 0,
};
