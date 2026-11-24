// Загружает настройки из файла .env (если он есть) до того, как остальные модули прочитают process.env.
// Импортируйте этот файл ПЕРВЫМ. Переменные, уже заданные в окружении, не перезаписываются.
import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve(process.env.ENV_FILE || '.env');
if (fs.existsSync(file)) process.loadEnvFile(file);
