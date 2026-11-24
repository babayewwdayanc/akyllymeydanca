"""
Из координат игроков и мяча → футбольные события (пасы, потери, отборы, удары, голы, сейвы)
и физика (дистанция, скорость, спринты, тепловая карта).

Чистый Python без зависимостей — чтобы логику можно было проверить без видеокарты
(см. test_events.py). Координаты — в метрах на поле, (0,0) — левый верхний угол.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

SPRINT_MS = 5.5        # ≈ 19.8 км/ч
MAX_HUMAN_MS = 10.0    # быстрее — ошибка трекинга
HEAT_W, HEAT_H = 16, 8


@dataclass
class Sample:
    t: float
    ball: tuple[float, float] | None
    players: dict[int, tuple[float, float]] = field(default_factory=dict)


@dataclass
class Segment:
    """Отрезок времени, когда мяч у одного игрока."""
    track: int
    i0: int
    i1: int


def _dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def possession_holders(samples: list[Sample], radius: float, length: float, width: float) -> list[int | None]:
    out: list[int | None] = []
    for s in samples:
        # мяч за пределами поля (в сетке ворот, в ауте) — ни у кого
        out_of_play = s.ball is not None and not (0 <= s.ball[0] <= length and 0 <= s.ball[1] <= width)
        if s.ball is None or not s.players or out_of_play:
            out.append(None)
            continue
        tid, d = min(((k, _dist(p, s.ball)) for k, p in s.players.items()), key=lambda kv: kv[1])
        out.append(tid if d <= radius else None)
    return out


def possession_segments(samples: list[Sample], holders: list[int | None], min_hold: float, max_gap: float) -> list[Segment]:
    segs: list[Segment] = []
    for i, h in enumerate(holders):
        if h is None:
            continue
        if segs and segs[-1].track == h and samples[i].t - samples[segs[-1].i1].t <= max_gap:
            segs[-1].i1 = i
        else:
            segs.append(Segment(h, i, i))
    # одиночный кадр «мяч рядом с игроком» — чаще шум детекции, чем касание
    return [s for s in segs if s.i1 > s.i0 and samples[s.i1].t - samples[s.i0].t >= min_hold]


def attack_goal_x(team: str, track_team: dict[int, str], samples: list[Sample], length: float) -> float:
    """Куда атакует команда: по средней позиции самого «крайнего» игрока (вратаря)."""
    sums: dict[int, list[float]] = {}
    for s in samples:
        for k, p in s.players.items():
            if track_team.get(k) == team:
                sums.setdefault(k, []).append(p[0])
    if not sums:
        return length
    means = {k: sum(v) / len(v) for k, v in sums.items()}
    gk_x = min(means.values(), key=lambda x: min(x, length - x))
    return length if gk_x < length / 2 else 0.0


def detect_events(
    samples: list[Sample],
    track_team: dict[int, str],
    length: float,
    width: float,
    *,
    possess_radius: float = 1.6,
    min_hold: float = 0.06,
    max_gap: float = 0.4,
    shot_speed_kmh: float = 45.0,
    goal_width: float = 3.0,
    interception_travel_m: float = 3.0,
) -> tuple[list[dict], dict[str, float]]:
    holders = possession_holders(samples, possess_radius, length, width)
    segs = possession_segments(samples, holders, min_hold, max_gap)
    goal_of = {t: attack_goal_x(t, track_team, samples, length) for t in ("A", "B")}
    gk_of = _goalkeepers(samples, track_team, goal_of, length)

    events: list[dict] = []
    last_pass: dict | None = None
    poss_time = {"A": 0.0, "B": 0.0}

    def ev(i, typ, track, **kw):
        s = samples[i]
        pos = s.ball or s.players.get(track) or (None, None)
        e = {"t": round(s.t, 2), "type": typ, "team": track_team.get(track), "track_no": track,
             "x": None if pos[0] is None else round(pos[0], 1), "y": None if pos[1] is None else round(pos[1], 1)}
        e.update({k: v for k, v in kw.items() if v is not None})
        events.append(e)

    for n, a in enumerate(segs):
        team_a = track_team.get(a.track)
        if team_a in poss_time:
            poss_time[team_a] += samples[a.i1].t - samples[a.i0].t
        b = segs[n + 1] if n + 1 < len(segs) else None
        if b is not None and b.track == a.track:
            continue
        gap_end = b.i0 if b else len(samples) - 1

        # --- Удар? Скорость мяча после отрыва и направление к чужим воротам ---
        shot = _find_shot(samples, a.i1, gap_end, goal_of.get(team_a, length), length, width, shot_speed_kmh, goal_width)
        if shot:
            on_target, speed, goal_i = shot
            assist = None
            if last_pass and last_pass["to"] == a.track and samples[a.i1].t - last_pass["t"] <= 12:
                assist = last_pass["from"]
            ev(a.i1, "shot", a.track, success=1 if on_target else 0, speed_kmh=round(speed, 1))
            if goal_i is not None:
                ev(goal_i, "goal", a.track, target_track_no=assist, speed_kmh=round(speed, 1))
            elif on_target and b is not None and b.track == gk_of.get(_other(team_a)):
                ev(b.i0, "save", b.track, target_track_no=a.track)
            last_pass = None
            continue
        if b is None:
            continue

        team_b = track_team.get(b.track)
        ball_a = samples[a.i1].ball
        ball_b = samples[b.i0].ball
        travel = _dist(ball_a, ball_b) if ball_a and ball_b else 0.0
        dt = max(1e-3, samples[b.i0].t - samples[a.i1].t)
        speed_kmh = round(travel / dt * 3.6, 1)
        if team_a == team_b:
            ev(a.i1, "pass", a.track, target_track_no=b.track, success=1, speed_kmh=speed_kmh)
            last_pass = {"from": a.track, "to": b.track, "t": samples[b.i0].t}
        elif travel >= interception_travel_m:
            target = _nearest_teammate(samples[b.i0], a.track, track_team)
            ev(a.i1, "pass", a.track, target_track_no=target, success=0, speed_kmh=speed_kmh)
            ev(b.i0, "interception", b.track)
            last_pass = None
        else:
            ev(b.i0, "tackle", b.track, target_track_no=a.track)
            ev(b.i0, "turnover", a.track)
            last_pass = None

    total = poss_time["A"] + poss_time["B"] or 1.0
    possession = {"A": round(poss_time["A"] / total, 3), "B": round(poss_time["B"] / total, 3)}
    return events, possession


def _other(team):
    return "B" if team == "A" else "A"


def _nearest_teammate(sample: Sample, passer: int, track_team: dict[int, str]) -> int | None:
    team = track_team.get(passer)
    if not sample.ball:
        return None
    mates = [(k, _dist(p, sample.ball)) for k, p in sample.players.items() if k != passer and track_team.get(k) == team]
    return min(mates, key=lambda kv: kv[1])[0] if mates else None


def _goalkeepers(samples, track_team, goal_of, length):
    """Вратарь команды — её игрок, который в среднем ближе всех к своим воротам."""
    sums: dict[int, list[float]] = {}
    for s in samples:
        for k, p in s.players.items():
            sums.setdefault(k, []).append(p[0])
    out = {}
    for team in ("A", "B"):
        own_goal = length - goal_of[team]
        cands = [(k, abs(sum(v) / len(v) - own_goal)) for k, v in sums.items() if track_team.get(k) == team]
        if cands:
            out[team] = min(cands, key=lambda kv: kv[1])[0]
    return out


def _find_shot(samples, i_from, i_to, goal_x, length, width, shot_speed_kmh, goal_width):
    """Ищем быстрый полёт мяча к воротам между i_from и i_to. Возвращает (в створ?, скорость км/ч, индекс гола|None)."""
    pts = [(samples[i].t, samples[i].ball, i) for i in range(i_from, min(i_to, len(samples) - 1) + 1) if samples[i].ball]
    if len(pts) < 2:
        return None
    best = 0.0
    for (t0, p0, _), (t1, p1, _) in zip(pts, pts[1:]):
        if t1 > t0:
            best = max(best, _dist(p0, p1) / (t1 - t0) * 3.6)
    if best < shot_speed_kmh:
        return None
    (t0, p0, _), (t1, p1, _) = pts[0], pts[-1]
    dx = p1[0] - p0[0]
    toward = (goal_x - p0[0]) * dx > 0 and abs(dx) > 1.0
    if not toward:
        return None
    # Точка пересечения линии ворот по прямой
    k = (goal_x - p0[0]) / dx if dx else 0
    y_at_goal = p0[1] + (p1[1] - p0[1]) * k
    mouth = abs(y_at_goal - width / 2) <= goal_width / 2 + 0.3
    near_goal = abs(p1[0] - goal_x) <= 4.0 or (p1[0] - goal_x) * (goal_x - p0[0]) > 0
    if not near_goal:
        return None
    goal_i = None
    for _, p, i in pts:
        crossed = p[0] >= length if goal_x >= length else p[0] <= 0
        if crossed and abs(p[1] - width / 2) <= goal_width / 2 + 0.3:
            goal_i = i
            break
    return (mouth or goal_i is not None, best, goal_i)


def physical(series: list[tuple[float, float, float]], length: float, width: float) -> dict:
    """series: [(t, x, y)] одного игрока, отсортировано по t."""
    if len(series) < 2:
        return {"distance_m": 0, "top_speed_kmh": 0, "sprints": 0, "heatmap": None}
    # Сглаживание скользящим средним ~0.5 с — трекинг «дрожит»
    sm = []
    for i in range(len(series)):
        t = series[i][0]
        win = [p for p in series[max(0, i - 6): i + 7] if abs(p[0] - t) <= 0.25]
        sm.append((t, sum(p[1] for p in win) / len(win), sum(p[2] for p in win) / len(win)))
    dist = 0.0
    for (t0, x0, y0), (t1, x1, y1) in zip(sm, sm[1:]):
        d = math.hypot(x1 - x0, y1 - y0)
        if t1 > t0 and d / (t1 - t0) <= MAX_HUMAN_MS:
            dist += d
    # Скорость по окну 1 с
    top, sprints, j = 0.0, 0, 0
    for i in range(len(sm)):
        while j < len(sm) and sm[j][0] - sm[i][0] < 1.0:
            j += 1
        if j >= len(sm):
            break
        dt = sm[j][0] - sm[i][0]
        v = math.hypot(sm[j][1] - sm[i][1], sm[j][2] - sm[i][2]) / dt
        if v > MAX_HUMAN_MS:
            continue
        top = max(top, v)
    # Спринты: ≥ 1 с подряд быстрее порога
    run, in_sprint = 0.0, False
    for (t0, x0, y0), (t1, x1, y1) in zip(sm, sm[1:]):
        v = math.hypot(x1 - x0, y1 - y0) / max(1e-3, t1 - t0)
        if v >= SPRINT_MS:
            run += t1 - t0
            if run >= 1.0 and not in_sprint:
                sprints += 1
                in_sprint = True
        else:
            run = 0.0
            in_sprint = False
    heat = [[0] * HEAT_W for _ in range(HEAT_H)]
    for _, x, y in series:
        gx = min(HEAT_W - 1, max(0, int(x / length * HEAT_W)))
        gy = min(HEAT_H - 1, max(0, int(y / width * HEAT_H)))
        heat[gy][gx] += 1
    mx = max(1, max(max(r) for r in heat))
    return {
        "distance_m": round(dist),
        "top_speed_kmh": round(top * 3.6, 1),
        "sprints": sprints,
        "heatmap": [[round(v / mx, 2) for v in row] for row in heat],
    }
