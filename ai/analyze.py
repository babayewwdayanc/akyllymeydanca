"""
AI-анализ видео матча → JSON «akylly-analysis/v1» (см. SCHEMA.md).

Конвейер:
  1. YOLO находит людей и мяч на каждом N-м кадре.
  2. ByteTrack связывает людей между кадрами (треки).
  3. Гомография (калибровка 4 углов поля) переводит пиксели в метры на поле.
  4. Цвет манишки → команда A/B, судья и зрители отбрасываются.
  5. Обрывки треков склеиваются, остаются N игроков на команду.
  6. events.py: владение мячом → пасы, потери, отборы, удары, голы, сейвы; физика игроков.

Запуск (нужна видеокарта NVIDIA или Apple Silicon; на CPU тоже работает, но медленно):
  python analyze.py --video match.mp4 --calib calib.json --players-per-side 6 \
      --team-colors "#E9ECF5,#C8232C" --out out/match1

Модель: по умолчанию yolo11m.pt (COCO: person + sports ball). Для точности лучше дообучить
модель на футбольных кадрах с вашей камеры (классы player, goalkeeper, referee, ball) — см. README.md.
"""
from __future__ import annotations

import argparse
import bisect
import json
import math
import os
import sys
import time
from collections import defaultdict

import cv2
import numpy as np
import supervision as sv
from ultralytics import YOLO

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from events import Sample, detect_events, physical  # noqa: E402


# ---------------------------------------------------------------- геометрия поля
def load_homography(calib: dict, length: float, width: float) -> np.ndarray:
    img = np.array(calib["image_points"], dtype=np.float32)
    pitch = np.array(calib.get("pitch_points") or [[0, 0], [length, 0], [length, width], [0, width]], dtype=np.float32)
    if len(img) < 4 or len(img) != len(pitch):
        raise ValueError("Калибровка: нужно минимум 4 точки кадра и столько же точек поля")
    H, _ = cv2.findHomography(img, pitch)
    if H is None:
        raise ValueError("Калибровка: точки не образуют корректную плоскость")
    return H


def to_pitch(H: np.ndarray, pts: np.ndarray) -> np.ndarray:
    if len(pts) == 0:
        return np.zeros((0, 2), dtype=np.float32)
    return cv2.perspectiveTransform(pts.reshape(-1, 1, 2).astype(np.float32), H).reshape(-1, 2)


# ---------------------------------------------------------------- цвета команд
def hex_to_lab(hx: str) -> np.ndarray:
    hx = hx.lstrip("#")
    bgr = np.uint8([[[int(hx[4:6], 16), int(hx[2:4], 16), int(hx[0:2], 16)]]])
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)[0, 0].astype(np.float32)


def torso_color(frame: np.ndarray, box) -> np.ndarray | None:
    x1, y1, x2, y2 = [int(v) for v in box]
    w, h = x2 - x1, y2 - y1
    if w < 6 or h < 12:
        return None
    crop = frame[max(0, y1 + int(h * 0.15)): y1 + int(h * 0.5), max(0, x1 + int(w * 0.25)): x2 - int(w * 0.25)]
    if crop.size == 0:
        return None
    lab = cv2.cvtColor(crop, cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32)
    return np.median(lab, axis=0)


def kmeans2(x: np.ndarray, w: np.ndarray, iters: int = 20) -> np.ndarray:
    """Простой взвешенный k-means на 2 кластера (без sklearn)."""
    c = np.stack([x[np.argmax(w)], x[np.argmax(np.linalg.norm(x - x[np.argmax(w)], axis=1))]])
    for _ in range(iters):
        lab = np.argmin(np.linalg.norm(x[:, None] - c[None], axis=2), axis=1)
        for k in range(2):
            if (lab == k).any():
                c[k] = np.average(x[lab == k], axis=0, weights=w[lab == k])
    return lab


# ---------------------------------------------------------------- склейка треков
def stitch(frags: dict, per_side: int, max_gap: float = 4.0, max_speed: float = 7.0) -> dict[int, list[int]]:
    """Обрывки одного игрока (после перекрытий) склеиваем в цепочки. Возвращает {chain_no: [frag_ids]}."""
    chains: list[dict] = []
    for fid in sorted(frags, key=lambda f: frags[f]["obs"][0][0]):
        f = frags[fid]
        t0, x0, y0 = f["obs"][0]
        best, best_d = None, 1e9
        for ch in chains:
            if ch["team"] != f["team"]:
                continue
            t1, x1, y1 = ch["last"]
            gap = t0 - t1
            if gap < 0 or gap > max_gap:
                continue
            d = math.hypot(x0 - x1, y0 - y1)
            if d <= max_speed * gap + 2.0 and d < best_d:
                best, best_d = ch, d
        if best:
            best["frags"].append(fid)
            best["last"] = f["obs"][-1]
            best["dur"] += f["obs"][-1][0] - t0
        else:
            chains.append({"team": f["team"], "frags": [fid], "last": f["obs"][-1], "dur": f["obs"][-1][0] - t0})
    out: dict[int, list[int]] = {}
    n = 1
    for team in ("A", "B"):
        team_chains = sorted((c for c in chains if c["team"] == team), key=lambda c: -c["dur"])[:per_side]
        for c in team_chains:
            out[n] = c["frags"]
            n += 1
    return out


# ---------------------------------------------------------------- основной анализ
def run(video: str, calib: dict, *, length: float, width: float, per_side: int, team_colors: list[str] | None,
        model_path: str, stride: int, device: str | None, imgsz: int, out_dir: str, max_minutes: float | None = None,
        progress=print) -> dict:
    os.makedirs(os.path.join(out_dir, "thumbs"), exist_ok=True)
    H = load_homography(calib, length, width)
    model = YOLO(model_path)
    names = {i: n.lower() for i, n in model.names.items()}
    person_ids = [i for i, n in names.items() if n in ("person", "player", "goalkeeper")]
    ref_ids = [i for i, n in names.items() if n == "referee"]
    ball_ids = [i for i, n in names.items() if n in ("sports ball", "ball", "football")]
    if not person_ids or not ball_ids:
        raise RuntimeError(f"Модель не знает классы людей/мяча: {model.names}")

    cap = cv2.VideoCapture(video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    if max_minutes:
        total = min(total, int(max_minutes * 60 * fps))
    tracker = sv.ByteTrack(frame_rate=max(1, int(round(fps / stride))))

    frags: dict[int, dict] = defaultdict(lambda: {"obs": [], "colors": [], "best": (0, None)})
    per_frame: list[tuple[float, list[tuple[int, float, float]], tuple[float, float] | None]] = []
    margin = 1.5
    fi = 0
    t_start = time.time()
    while True:
        ok = cap.grab()
        if not ok or (total and fi >= total):
            break
        if fi % stride:
            fi += 1
            continue
        ok, frame = cap.retrieve()
        if not ok:
            break
        t = fi / fps
        res = model.predict(frame, imgsz=imgsz, conf=0.12, device=device, verbose=False)[0]
        det = sv.Detections.from_ultralytics(res)

        # --- мяч: самая уверенная детекция внутри поля
        ball_xy = None
        balls = det[np.isin(det.class_id, ball_ids)]
        if len(balls):
            b = balls.xyxy[np.argmax(balls.confidence)]
            p = to_pitch(H, np.array([[(b[0] + b[2]) / 2, b[3]]]))[0]
            if -margin <= p[0] <= length + margin and -margin <= p[1] <= width + margin:
                ball_xy = (float(p[0]), float(p[1]))

        # --- люди: трекинг, перевод в метры, отсев зрителей за полем
        people = det[np.isin(det.class_id, person_ids) & (det.confidence >= 0.3)]
        people = tracker.update_with_detections(people)
        frame_pl = []
        if len(people):
            feet = np.stack([(people.xyxy[:, 0] + people.xyxy[:, 2]) / 2, people.xyxy[:, 3]], axis=1)
            pp = to_pitch(H, feet)
            for k in range(len(people)):
                x, y = float(pp[k, 0]), float(pp[k, 1])
                if not (-margin <= x <= length + margin and -margin <= y <= width + margin):
                    continue
                if ref_ids and people.class_id[k] in ref_ids:
                    continue
                tid = int(people.tracker_id[k])
                f = frags[tid]
                f["obs"].append((t, x, y))
                frame_pl.append((tid, x, y))
                if len(f["obs"]) % 5 == 1:
                    c = torso_color(frame, people.xyxy[k])
                    if c is not None:
                        f["colors"].append(c)
                box = people.xyxy[k]
                area = (box[2] - box[0]) * (box[3] - box[1])
                if area > f["best"][0]:
                    x1, y1, x2, y2 = [int(v) for v in box]
                    crop = frame[max(0, y1):y2, max(0, x1):x2]
                    if crop.size:
                        f["best"] = (area, cv2.imencode(".jpg", cv2.resize(crop, (96, int(96 * crop.shape[0] / max(1, crop.shape[1])))))[1].tobytes())
        per_frame.append((t, frame_pl, ball_xy))
        fi += 1
        if len(per_frame) % 500 == 0:
            el = time.time() - t_start
            progress(f"кадр {fi}/{total or '?'} · {fi / fps / 60:.1f} мин видео · {el:.0f} с работы")
    cap.release()
    duration = fi / fps

    # --- команды по цвету манишек
    ids = [i for i, f in frags.items() if f["colors"] and len(f["obs"]) >= 10]
    if not ids:
        raise RuntimeError("Не нашли игроков: проверьте калибровку и видео")
    X = np.stack([np.median(np.stack(frags[i]["colors"]), axis=0) for i in ids])
    Wt = np.array([len(frags[i]["obs"]) for i in ids], dtype=np.float32)
    if team_colors and len(team_colors) == 2:
        refs = np.stack([hex_to_lab(c) for c in team_colors])
        d = np.linalg.norm(X[:, None] - refs[None], axis=2)
        labels = np.argmin(d, axis=1)
        keep = d.min(axis=1) < 60  # слишком непохож на обе команды — судья / зритель
    else:
        labels = kmeans2(X, Wt)
        keep = np.ones(len(ids), dtype=bool)
    team_frags = {}
    for i, lab, k in zip(ids, labels, keep):
        if k:
            frags[i]["team"] = "A" if lab == 0 else "B"
            team_frags[i] = frags[i]

    # --- склейка обрывков → итоговые игроки
    chains = stitch(team_frags, per_side)
    frag_to_chain = {f: c for c, fl in chains.items() for f in fl}
    track_team = {c: team_frags[fl[0]]["team"] for c, fl in chains.items()}

    # --- мяч: убираем выбросы и заполняем короткие пропуски
    ball_t = [(t, b) for t, _, b in per_frame if b]
    clean = []
    for t, b in ball_t:
        if clean and t > clean[-1][0] and math.dist(b, clean[-1][1]) / (t - clean[-1][0]) > 45:
            continue
        clean.append((t, b))
    ball_at = dict(clean)
    times = [t for t, _ in clean]

    def ball_interp(t):
        if t in ball_at:
            return ball_at[t]
        j = bisect.bisect_left(times, t)
        if 0 < j < len(times) and times[j] - times[j - 1] <= 0.8:
            (t0, b0), (t1, b1) = clean[j - 1], clean[j]
            k = (t - t0) / (t1 - t0)
            return (b0[0] + (b1[0] - b0[0]) * k, b0[1] + (b1[1] - b0[1]) * k)
        return None

    samples: list[Sample] = []
    series: dict[int, list[tuple[float, float, float]]] = defaultdict(list)
    for t, pl, _ in per_frame:
        players = {}
        for fid, x, y in pl:
            c = frag_to_chain.get(fid)
            if c is not None and c not in players:
                players[c] = (x, y)
                series[c].append((t, x, y))
        samples.append(Sample(t, ball_interp(t), players))

    events, possession = detect_events(samples, track_team, length, width)
    phys = {str(c): physical(s, length, width) for c, s in series.items()}

    # --- кадры 1 раз в секунду для 2D-повтора
    order = sorted(chains)
    frames = []
    sec = defaultdict(lambda: {"ball": [], "p": defaultdict(list)})
    for s in samples:
        b = sec[int(s.t)]
        if s.ball:
            b["ball"].append(s.ball)
        for c, p in s.players.items():
            b["p"][c].append(p)
    avg = lambda pts: [round(sum(p[0] for p in pts) / len(pts), 1), round(sum(p[1] for p in pts) / len(pts), 1)] if pts else None  # noqa: E731
    for t in range(int(duration)):
        b = sec.get(t)
        frames.append({"t": t, "ball": avg(b["ball"]) if b else None, "p": [avg(b["p"].get(c, [])) if b else None for c in order]})

    # --- миниатюры для «найди себя»
    tracks = []
    for c in order:
        best = max((team_frags[f]["best"] for f in chains[c]), key=lambda b: b[0])
        thumb = None
        if best[1]:
            thumb = f"track_{c}.jpg"
            with open(os.path.join(out_dir, "thumbs", thumb), "wb") as fh:
                fh.write(best[1])
        tracks.append({"track_no": c, "team": track_team[c], "jersey": None, "role": None, "thumbnail": thumb})

    result = {
        "schema": "akylly-analysis/v1",
        "source": f"yolo-bytetrack:{os.path.basename(model_path)}",
        "duration_s": round(duration),
        "pitch": {"length_m": length, "width_m": width},
        "possession": possession,
        "tracks": tracks,
        "events": events,
        "frames_hz": 1,
        "frame_tracks": order,
        "frames": frames,
        "player_physical": phys,
    }
    with open(os.path.join(out_dir, "analysis.json"), "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False)
    progress(f"готово: {len(tracks)} игроков, {len(events)} событий, {time.time() - t_start:.0f} с")
    return result


def main():
    ap = argparse.ArgumentParser(description="AI-анализ видео футбольного матча")
    ap.add_argument("--video", required=True)
    ap.add_argument("--calib", required=True, help="JSON из calibrate.py")
    ap.add_argument("--length", type=float, default=40)
    ap.add_argument("--width", type=float, default=20)
    ap.add_argument("--players-per-side", type=int, default=6)
    ap.add_argument("--team-colors", help='"#RRGGBB,#RRGGBB" — цвета манишек A и B')
    ap.add_argument("--model", default="yolo11m.pt")
    ap.add_argument("--stride", type=int, default=2, help="анализировать каждый N-й кадр")
    ap.add_argument("--imgsz", type=int, default=1280)
    ap.add_argument("--device", default=None, help="0 — первая видеокарта, mps — Mac, cpu")
    ap.add_argument("--max-minutes", type=float, default=None, help="для теста: только первые N минут")
    ap.add_argument("--out", default="out")
    a = ap.parse_args()
    with open(a.calib, encoding="utf-8") as fh:
        calib = json.load(fh)
    run(a.video, calib, length=a.length, width=a.width, per_side=a.players_per_side,
        team_colors=a.team_colors.split(",") if a.team_colors else None, model_path=a.model,
        stride=a.stride, device=a.device, imgsz=a.imgsz, out_dir=a.out, max_minutes=a.max_minutes)


if __name__ == "__main__":
    main()
