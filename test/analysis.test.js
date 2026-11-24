// Проверка расчёта статистики: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'akylly-test-'));
const { simulateMatch } = await import('../server/demoAnalysis.js');
const { computeTrackStats, validateAnalysis } = await import('../server/ingest.js');
const { matchRating, buildCard, EMPTY_AGG } = await import('../server/rating.js');

test('демо-анализ проходит проверку формата', () => {
  const a = simulateMatch({ durationS: 600, perSide: 6, seed: 3 });
  assert.deepEqual(validateAnalysis(a), []);
  assert.equal(a.tracks.length, 12);
});

test('статистика игроков согласована с событиями', () => {
  const a = simulateMatch({ durationS: 1800, perSide: 5, seed: 7 });
  const s = Object.values(computeTrackStats(a));
  const goals = { A: 0, B: 0 };
  for (const t of s) {
    assert.ok(t.passes_completed <= t.passes);
    assert.ok(t.shots_on_target <= t.shots);
    assert.ok(t.top_speed_kmh < 40, 'скорость человека');
    goals[t.team] += t.goals;
  }
  assert.deepEqual(goals, a.score);
});

test('оценка за матч в пределах 3–10', () => {
  const zero = { goals: 0, assists: 0, shots_on_target: 0, passes: 0, passes_completed: 0, tackles: 0, interceptions: 0, saves: 0, turnovers: 30, distance_m: 0 };
  assert.ok(matchRating(zero) >= 3);
  const hero = { ...zero, goals: 10, assists: 10, passes: 80, passes_completed: 78, turnovers: 0, distance_m: 9000 };
  assert.ok(matchRating(hero, { won: true }) <= 10);
});

test('стартовая карточка без матчей', () => {
  const c = buildCard({ height_cm: 180, weight_kg: 75, position: 'FWD' }, EMPTY_AGG, 0);
  assert.equal(c.provisional, true);
  assert.ok(c.ovr >= 40 && c.ovr <= 75);
  assert.ok(c.attrs.sho > c.attrs.def, 'у нападающего удар выше защиты');
});
