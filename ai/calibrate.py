"""
Калибровка камеры поля — делается ОДИН раз после установки камеры.

Открывает кадр из видео, вы кликаете 4 угла поля по порядку:
  1) левый верхний  2) правый верхний  3) правый нижний  4) левый нижний
(«верх» — дальняя от камеры сторона). Enter — сохранить, Backspace — отменить последнюю точку.

  python calibrate.py --video match.mp4 --length 40 --width 20 --out calib.json

Полученный JSON вставьте в панели поля («Калибровка камеры») — воркер возьмёт его оттуда.
Если камера сдвинулась (ветер, ремонт) — откалибруйте заново.
"""
import argparse
import json

import cv2

NAMES = ["левый верхний", "правый верхний", "правый нижний", "левый нижний"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--at", type=float, default=5.0, help="секунда видео для кадра")
    ap.add_argument("--length", type=float, default=40)
    ap.add_argument("--width", type=float, default=20)
    ap.add_argument("--out", default="calib.json")
    a = ap.parse_args()

    cap = cv2.VideoCapture(a.video)
    cap.set(cv2.CAP_PROP_POS_MSEC, a.at * 1000)
    ok, frame = cap.read()
    if not ok:
        raise SystemExit("Не удалось прочитать кадр из видео")
    scale = min(1.0, 1600 / frame.shape[1])
    view = cv2.resize(frame, None, fx=scale, fy=scale)
    pts = []

    def on_click(event, x, y, *_):
        if event == cv2.EVENT_LBUTTONDOWN and len(pts) < 4:
            pts.append([x / scale, y / scale])

    win = "Kliknite 4 ugla polya (Enter - sohranit)"
    cv2.namedWindow(win)
    cv2.setMouseCallback(win, on_click)
    while True:
        img = view.copy()
        for i, (x, y) in enumerate(pts):
            cv2.circle(img, (int(x * scale), int(y * scale)), 7, (0, 215, 255), -1)
            cv2.putText(img, str(i + 1), (int(x * scale) + 10, int(y * scale) - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 215, 255), 2)
        if len(pts) == 4:
            poly = [(int(x * scale), int(y * scale)) for x, y in pts]
            for i in range(4):
                cv2.line(img, poly[i], poly[(i + 1) % 4], (0, 255, 0), 2)
        else:
            print(f"\rКликните: {NAMES[len(pts)]} угол поля   ", end="", flush=True)
        cv2.imshow(win, img)
        k = cv2.waitKey(30) & 0xFF
        if k in (13, 10) and len(pts) == 4:
            break
        if k == 8 and pts:
            pts.pop()
        if k == 27:
            raise SystemExit("\nОтменено")
    cv2.destroyAllWindows()
    calib = {
        "image_points": [[round(x, 1), round(y, 1)] for x, y in pts],
        "pitch_points": [[0, 0], [a.length, 0], [a.length, a.width], [0, a.width]],
        "frame_size": [frame.shape[1], frame.shape[0]],
    }
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(calib, fh)
    print(f"\nСохранено в {a.out}:\n{json.dumps(calib)}")


if __name__ == "__main__":
    main()
