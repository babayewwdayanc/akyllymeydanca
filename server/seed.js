// Демо-данные при первом запуске: поле, 3 матча с демо-анализом и несколько вымышленных игроков,
// чтобы рейтинг и страница матча не были пустыми. Отключить: DEMO_MODE=0.
import { db } from './db.js';
import { hashPin } from './auth.js';
import { simulateMatch } from './demoAnalysis.js';
import { ingestAnalysis } from './ingest.js';

export const DEMO_MODE = process.env.DEMO_MODE !== '0';

const DEMO_PLAYERS = [
  ['Merdan', 'Annaýew', 178, 72, 'MID'],
  ['Serdar', 'Orazow', 183, 80, 'DEF'],
  ['Döwlet', 'Berdiýew', 175, 68, 'FWD'],
  ['Batyr', 'Hojaýew', 186, 84, 'GK'],
  ['Myrat', 'Gurbanow', 172, 65, 'FWD'],
  ['Kerim', 'Ataýew', 180, 76, 'MID'],
  ['Arslan', 'Saparow', 188, 86, 'DEF'],
  ['Rustam', 'Nurmuhammedow', 176, 70, 'MID'],
];

export function seedDemo() {
  if (!DEMO_MODE) return;
  if (db.prepare('SELECT COUNT(*) AS n FROM pitches').get().n > 0) return;

  const pitchId = Number(db.prepare('INSERT INTO pitches (name, city, address, length_m, width_m) VALUES (?,?,?,?,?)')
    .run('Gündogar Arena', 'Aşgabat', 'demo meýdança', 40, 20).lastInsertRowid);

  const pin = hashPin('0000');
  const ids = DEMO_PLAYERS.map(([f, l, h, w, pos], i) =>
    Number(db.prepare('INSERT INTO players (first_name, last_name, height_cm, weight_kg, position, foot, phone, pin_hash) VALUES (?,?,?,?,?,?,?,?)')
      .run(f, l, h, w, pos, i % 3 === 0 ? 'L' : 'R', `demo-${i + 1}`, pin).lastInsertRowid));

  const now = Date.now();
  const games = [
    { days: 9, a: 'Ýyldyz', b: 'Gaýrat' },
    { days: 5, a: 'Ýyldyz', b: 'Bürgüt' },
    { days: 1, a: 'Ýyldyz', b: 'Gaýrat' },
  ];
  games.forEach((g, gi) => {
    const starts = new Date(now - g.days * 86400000);
    starts.setHours(21, 0, 0, 0);
    const mid = Number(db.prepare(`INSERT INTO matches (pitch_id, code, starts_at, duration_min, players_per_side, team_a_name, team_a_color, team_b_name, team_b_color)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(pitchId, `DEMO0${gi + 1}`, starts.toISOString(), 60, 6, g.a, '#E9ECF5', g.b, '#C8232C').lastInsertRowid);
    ingestAnalysis(mid, simulateMatch({ durationS: 3600, perSide: 6, length: 40, width: 20, seed: mid }));
    // Демо-игроки «отметили себя»: роли совпадают с позициями (вратарь — трек 1 или 7 и т.д.)
    const tracks = db.prepare('SELECT track_no, team, role FROM tracks WHERE match_id = ? ORDER BY track_no').all(mid);
    const free = [...tracks];
    ids.forEach((pid, i) => {
      const pos = DEMO_PLAYERS[i][4];
      const team = i < 5 ? 'A' : 'B';
      const idx = free.findIndex((t) => t.team === team && t.role === pos) >= 0
        ? free.findIndex((t) => t.team === team && t.role === pos)
        : free.findIndex((t) => t.team === team);
      if (idx < 0) return;
      const [t] = free.splice(idx, 1);
      db.prepare('UPDATE tracks SET player_id = ? WHERE match_id = ? AND track_no = ?').run(pid, mid, t.track_no);
      db.prepare('INSERT OR IGNORE INTO match_members (match_id, player_id) VALUES (?, ?)').run(mid, pid);
    });
  });
  console.log('  Демо-данные созданы: поле, 3 матча (коды DEMO01–DEMO03), 8 игроков.');
}
