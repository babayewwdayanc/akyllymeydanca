// Первый запуск: администратор панели и (для разработки) демо-данные.
import { one, q, run } from './db.js';
import { hashPin } from './auth.js';
import { simulateMatch } from './demoAnalysis.js';
import { ingestAnalysis } from './ingest.js';

const PROD = process.env.NODE_ENV === 'production';
// Демо-данные: по умолчанию включены на компьютере разработчика и выключены на сервере
export const DEMO_MODE = process.env.DEMO_MODE ? process.env.DEMO_MODE !== '0' : !PROD;

/** Если в базе нет ни одного администратора — создаём первого (owner). */
export async function ensureAdmin() {
  if ((await one('SELECT COUNT(*)::int AS n FROM admins')).n > 0) return;
  const user = process.env.ADMIN_USERNAME;
  const pass = process.env.ADMIN_PASSWORD;
  if (user && pass) {
    if (pass.length < 8) throw new Error('ADMIN_PASSWORD должен быть не короче 8 символов');
    await run(`INSERT INTO admins (username, pass_hash, role) VALUES ($1, $2, 'owner')`, [user.trim().toLowerCase(), hashPin(pass)]);
    console.log(`  Создан администратор «${user}» (owner) из ADMIN_USERNAME / ADMIN_PASSWORD`);
  } else if (!PROD) {
    await run(`INSERT INTO admins (username, pass_hash, role) VALUES ('admin', $1, 'owner')`, [hashPin('admin123')]);
    console.log('  Создан администратор для разработки: admin / admin123');
  } else {
    console.log('  Администраторов нет. Создайте: npm run admin:create -- <логин>');
  }
}

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

/** Демо: поле, 3 матча с демо-анализом и 8 вымышленных игроков, чтобы экраны не были пустыми. */
export async function seedDemo() {
  if (!DEMO_MODE) return;
  if ((await one('SELECT COUNT(*)::int AS n FROM pitches')).n > 0) return;

  const { id: pitchId } = await one(`INSERT INTO pitches (name, city, address, length_m, width_m) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    ['Gündogar Arena', 'Aşgabat', 'demo meýdança', 40, 20]);

  const pin = hashPin('0000');
  const ids = [];
  for (const [i, [f, l, h, w, pos]] of DEMO_PLAYERS.entries()) {
    const r = await one(`INSERT INTO players (first_name, last_name, height_cm, weight_kg, position, foot, phone, pin_hash, is_demo)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE) RETURNING id`, [f, l, h, w, pos, i % 3 === 0 ? 'L' : 'R', `demo-${i + 1}`, pin]);
    ids.push(r.id);
  }

  const now = Date.now();
  const games = [
    { days: 9, a: 'Ýyldyz', b: 'Gaýrat' },
    { days: 5, a: 'Ýyldyz', b: 'Bürgüt' },
    { days: 1, a: 'Ýyldyz', b: 'Gaýrat' },
  ];
  for (const [gi, g] of games.entries()) {
    const starts = new Date(now - g.days * 86400000);
    starts.setHours(21, 0, 0, 0);
    const { id: mid } = await one(`INSERT INTO matches (pitch_id, code, starts_at, duration_min, players_per_side, team_a_name, team_a_color, team_b_name, team_b_color)
      VALUES ($1,$2,$3,60,6,$4,'#E9ECF5',$5,'#C8232C') RETURNING id`, [pitchId, `DEMO0${gi + 1}`, starts, g.a, g.b]);
    await ingestAnalysis(mid, simulateMatch({ durationS: 3600, perSide: 6, length: 40, width: 20, seed: mid }));
    // Демо-игроки «отметили себя»: по возможности на треке своей позиции
    const free = await q('SELECT track_no, team, role FROM tracks WHERE match_id = $1 ORDER BY track_no', [mid]);
    for (const [i, pid] of ids.entries()) {
      const pos = DEMO_PLAYERS[i][4];
      const team = i < 5 ? 'A' : 'B';
      let idx = free.findIndex((t) => t.team === team && t.role === pos);
      if (idx < 0) idx = free.findIndex((t) => t.team === team);
      if (idx < 0) continue;
      const [t] = free.splice(idx, 1);
      await run('UPDATE tracks SET player_id = $1 WHERE match_id = $2 AND track_no = $3', [pid, mid, t.track_no]);
      await run('INSERT INTO match_members (match_id, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [mid, pid]);
    }
  }
  console.log('  Демо-данные созданы: поле, 3 матча (коды DEMO01–DEMO03), 8 игроков.');
}
