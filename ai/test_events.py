"""Проверка логики событий на искусственном матче (без видео и видеокарты): python3 -I test_events.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from events import Sample, detect_events, physical  # noqa: E402

HZ = 10
L, W = 40.0, 20.0
TEAM = {1: "A", 2: "A", 3: "A", 7: "B", 8: "B"}


def lerp(a, b, k):
    return (a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k)


def build():
    out = []
    for i in range(int(6 * HZ)):
        t = i / HZ
        pl = {1: (1, 10), 2: (10, 10), 3: (16, 12), 7: (39, 10), 8: (25, 8)}
        if t < 1.0:
            ball = (10.3, 10)                                   # мяч у 2
        elif t < 1.5:
            ball = lerp((10.3, 10), (16, 12), (t - 1.0) / 0.5)  # пас 2 → 3
        elif t < 2.5:
            ball = (16.2, 12)                                   # у 3
        elif t < 3.0:
            ball = lerp((16.2, 12), (25, 8), (t - 2.5) / 0.5)   # неточный пас → перехват 8
        elif t < 4.0:
            ball = (25.2, 8)
            pl[3] = lerp((16, 12), (25.6, 8.4), (t - 2.5) / 1.5)
        elif t < 5.0:
            pl[8] = (24, 7)                                     # 3 отобрал и ведёт
            ball = lerp((25.8, 8.3), (30, 10), (t - 4.0))
            pl[3] = (ball[0] + 0.2, ball[1])
        else:
            pl[8] = (24, 7)
            pl[3] = (30.2, 10)
            ball = lerp((30, 10), (40.5, 10.2), min(1, (t - 5.0) / 0.4))  # удар ≈ 95 км/ч в ворота
        out.append(Sample(t, ball, pl))
    return out


def test_events():
    events, poss = detect_events(build(), TEAM, L, W)
    kinds = [(e["type"], e["track_no"], e.get("success")) for e in events]
    print(kinds)
    assert kinds[0] == ("pass", 2, 1), kinds
    assert ("pass", 3, 0) in kinds and ("interception", 8, None) in kinds
    assert ("tackle", 3, None) in kinds and ("turnover", 8, None) in kinds
    shot = next(e for e in events if e["type"] == "shot")
    assert shot["track_no"] == 3 and shot["success"] == 1 and 80 < shot["speed_kmh"] < 110, shot
    assert any(e["type"] == "goal" and e["track_no"] == 3 for e in events)
    assert poss["A"] > poss["B"]


def test_physical():
    s = []
    for i in range(50):
        t = i / HZ
        x = min(t, 2.0) * 6.0       # 6 м/с две секунды, потом стоит
        s.append((t, x, 10.0))
    p = physical(s, L, W)
    print(p["distance_m"], p["top_speed_kmh"], p["sprints"])
    assert 10 <= p["distance_m"] <= 13
    assert 19 <= p["top_speed_kmh"] <= 23
    assert p["sprints"] == 1


if __name__ == "__main__":
    test_events()
    test_physical()
    print("OK: логика событий и физики работает")
