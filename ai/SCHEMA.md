# Формат результата анализа `akylly-analysis/v1`

Это «контракт» между AI (компьютерное зрение) и сервером приложения. Любой источник —
наш `analyze.py`, демо-симулятор, сторонний сервис (Veo, Pixellot, Roboflow и т.д.) —
должен отдать JSON в этом формате. Всё остальное (точность пасов, ошибки, оценка 3–10,
MVP, награды, карточка игрока) сервер считает сам.

```jsonc
{
  "schema": "akylly-analysis/v1",
  "source": "yolo-bytetrack",          // кто сделал анализ — для отладки
  "duration_s": 3600,
  "pitch": { "length_m": 40, "width_m": 20 },
  "score": { "A": 7, "B": 4 },          // необязательно; иначе считается по событиям goal
  "possession": { "A": 0.52, "B": 0.48 },

  // Найденные игроки («треки»). Игрок сам отмечает в приложении, какой трек — он.
  "tracks": [
    { "track_no": 1, "team": "A", "jersey": 7, "role": "GK", "thumbnail": "track_1.jpg" }
  ],

  // События. Координаты x,y — метры от левого верхнего угла поля.
  "events": [
    { "t": 12.4, "type": "pass", "team": "A", "track_no": 3, "target_track_no": 5, "success": 1, "x": 14.2, "y": 8.0, "speed_kmh": 41 },
    { "t": 15.0, "type": "pass", "team": "A", "track_no": 5, "target_track_no": 2, "success": 0 },   // неточный пас = ошибка
    { "t": 15.6, "type": "interception", "team": "B", "track_no": 9 },
    { "t": 20.1, "type": "tackle", "team": "A", "track_no": 2, "target_track_no": 9 },             // отбор у игрока 9
    { "t": 20.1, "type": "turnover", "team": "B", "track_no": 9 },                                 // потеря = ошибка
    { "t": 31.7, "type": "shot", "team": "A", "track_no": 5, "success": 1, "speed_kmh": 96.5 },   // success = в створ
    { "t": 31.9, "type": "goal", "team": "A", "track_no": 5, "target_track_no": 3, "speed_kmh": 96.5 }, // target = автор передачи
    { "t": 44.0, "type": "save", "team": "B", "track_no": 7, "target_track_no": 5 }
  ],

  // Координаты для 2D-повтора и тепловых карт: frames_hz кадров в секунду (обычно 1).
  "frames_hz": 1,
  "frame_tracks": [1, 2, 3],            // порядок игроков в массиве p
  "frames": [
    { "t": 0, "ball": [20.0, 10.0], "p": [[2.1, 10.0], [10.5, 5.2], null] }   // null — игрок не виден
  ],

  // Необязательно: физика, посчитанная по точным координатам (25 кадров/с).
  // Если нет — сервер посчитает сам по frames (грубее).
  "player_physical": {
    "1": { "distance_m": 2450, "top_speed_kmh": 21.3, "sprints": 4, "heatmap": [[0.0, 0.1, "... 16 значений"], "... 8 строк"] }
  }
}
```

Проверка формата — `validateAnalysis()` в [server/ingest.js](../server/ingest.js).
Готовый JSON можно загрузить вручную: `POST /api/admin/matches/:id/result` с заголовком `x-admin-key`.
