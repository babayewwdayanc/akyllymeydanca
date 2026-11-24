// PM2: держит сервер запущенным, перезапускает при сбое и после перезагрузки сервера.
// Запуск: pm2 start ecosystem.config.cjs && pm2 save
// Настройки (база, ключи) берутся из файла .env в папке проекта.
module.exports = {
  apps: [
    {
      name: 'akylly',
      script: 'server/index.js',
      cwd: __dirname,
      // Один процесс: очередь удаления фона и лимиты запросов хранятся в памяти
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '1500M',
      kill_timeout: 10000, // время на завершение текущих запросов при перезапуске
      restart_delay: 3000,
      time: true, // время в логах
    },
  ],
};
