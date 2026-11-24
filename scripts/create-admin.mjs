// Создать администратора панели или сменить ему пароль.
// npm run admin:create -- <логин> [owner|manager]
// Пароль спрашивается в терминале (не виден при вводе) или берётся из ADMIN_PASSWORD.
import readline from 'node:readline';
import '../server/env.js';

const [username, roleArg] = process.argv.slice(2);
if (!username) {
  console.log('Использование: npm run admin:create -- <логин> [owner|manager]');
  process.exit(1);
}
const role = roleArg === 'manager' ? 'manager' : 'owner';

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

const password = process.env.ADMIN_PASSWORD || await askHidden('Пароль (мин. 8 символов): ');
if (password.length < 8) {
  console.error('Пароль слишком короткий');
  process.exit(1);
}
if (!process.env.ADMIN_PASSWORD && (await askHidden('Повторите пароль: ')) !== password) {
  console.error('Пароли не совпали');
  process.exit(1);
}

const { migrate, one, pool } = await import('../server/db.js');
const { hashPin } = await import('../server/auth.js');
await migrate();
const login = username.trim().toLowerCase();
const r = await one(`INSERT INTO admins (username, pass_hash, role) VALUES ($1, $2, $3)
  ON CONFLICT (username) DO UPDATE SET pass_hash = EXCLUDED.pass_hash, role = EXCLUDED.role, active = TRUE
  RETURNING (xmax = 0) AS created`, [login, hashPin(password), role]);
console.log(r.created ? `Администратор «${login}» (${role}) создан.` : `Пароль и роль «${login}» обновлены (${role}).`);
await pool.end();
