"""
AI-воркер: компьютер с видеокартой (у поля или в облаке) забирает матчи из очереди сервера,
анализирует видео и отправляет результат обратно.

  python worker.py --server https://ваш-сервер --key WORKER_KEY --model yolo11m.pt --device 0

Работает бесконечно: каждые 30 секунд спрашивает сервер, есть ли новый матч («Анализ AI» в панели поля).
"""
import argparse
import json
import os
import shutil
import tempfile
import time
import traceback

import requests

from analyze import run


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--server", required=True)
    ap.add_argument("--key", default=os.environ.get("WORKER_KEY"), help="WORKER_KEY сервера")
    ap.add_argument("--model", default="yolo11m.pt")
    ap.add_argument("--device", default=None)
    ap.add_argument("--stride", type=int, default=2)
    ap.add_argument("--imgsz", type=int, default=1280)
    ap.add_argument("--poll", type=int, default=30)
    ap.add_argument("--once", action="store_true", help="обработать один матч и выйти")
    a = ap.parse_args()
    if not a.key:
        raise SystemExit("Укажите --key или переменную WORKER_KEY")
    s = requests.Session()
    s.headers["x-worker-key"] = a.key
    base = a.server.rstrip("/")

    while True:
        r = s.post(f"{base}/api/worker/next", timeout=30)
        if r.status_code == 204:
            if a.once:
                print("Очередь пуста")
                return
            time.sleep(a.poll)
            continue
        r.raise_for_status()
        job = r.json()
        mid = job["match_id"]
        print(f"Матч {mid}: скачиваем видео…")
        tmp = tempfile.mkdtemp(prefix=f"akylly-{mid}-")
        try:
            if not job["pitch"].get("calibration"):
                raise RuntimeError("Поле не откалибровано: запустите calibrate.py и вставьте JSON в панели поля")
            video = os.path.join(tmp, "match.mp4")
            with s.get(f"{base}{job['video_path']}", stream=True, timeout=600) as v:
                v.raise_for_status()
                with open(video, "wb") as fh:
                    for chunk in v.iter_content(1 << 20):
                        fh.write(chunk)
            print(f"Матч {mid}: анализ…")
            out = os.path.join(tmp, "out")
            result = run(video, job["pitch"]["calibration"], length=job["pitch"]["length_m"], width=job["pitch"]["width_m"],
                         per_side=job["players_per_side"], team_colors=[job["team_colors"]["A"], job["team_colors"]["B"]],
                         model_path=a.model, stride=a.stride, device=a.device, imgsz=a.imgsz, out_dir=out,
                         progress=lambda m: print(f"  {m}"))
            rr = s.post(f"{base}/api/worker/matches/{mid}/result", data=json.dumps(result),
                        headers={"Content-Type": "application/json"}, timeout=300)
            rr.raise_for_status()
            files = {}
            thumbs = os.path.join(out, "thumbs")
            for name in os.listdir(thumbs):
                files[name.replace(".jpg", "")] = (name, open(os.path.join(thumbs, name), "rb"), "image/jpeg")
            if files:
                s.post(f"{base}/api/worker/matches/{mid}/thumbs", files=files, timeout=120).raise_for_status()
            print(f"Матч {mid}: готово — {rr.json()}")
        except Exception as e:  # noqa: BLE001 — любую ошибку сообщаем серверу, чтобы матч не завис
            traceback.print_exc()
            s.post(f"{base}/api/worker/matches/{mid}/fail", json={"error": str(e)[:400]}, timeout=30)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        if a.once:
            return


if __name__ == "__main__":
    main()
