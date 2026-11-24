# Как настроить сервер (Ubuntu 24.04 + PostgreSQL + PM2 + Nginx)

После этих шагов приложение открывается по адресу `http://IP_СЕРВЕРА`, само перезапускается
при сбоях и после перезагрузки, а каждую ночь делает бэкап базы.
Домен и HTTPS можно добавить позже (раздел в конце). Время: ~30–40 минут.

> Пока нет HTTPS, PIN-коды и фото идут по сети незашифрованными. Для проверки это нормально,
> но перед тем как звать игроков, подключите домен и SSL.

## Что понадобится

- VPS с Ubuntu 24.04: 2 ядра, 4 ГБ памяти, 80+ ГБ диска (час видео в 1080p ≈ 1,8 ГБ).
- Доступ по SSH (IP и пароль или ключ от хостинга).

## 1. Подключиться к серверу

С Mac — в Терминале (пароль от хостинга вводите сами):

```bash
ssh root@IP_СЕРВЕРА
```

Все команды ниже выполняются на сервере.

## 2. Установить программы

```bash
apt update && apt upgrade -y
```

```bash
apt install -y git ffmpeg nginx postgresql ufw curl
```

Node.js 24 (версия из Ubuntu слишком старая):

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
```

```bash
apt install -y nodejs && npm install -g pm2
```

Проверка — должно быть `v24.…`:

```bash
node -v
```

## 3. База данных PostgreSQL

Создать пароль базы и сохранить его — он понадобится в шаге 5:

```bash
DB_PASS=$(openssl rand -hex 16) && echo "Пароль базы: $DB_PASS"
```

```bash
sudo -u postgres psql -c "CREATE USER akylly WITH PASSWORD '$DB_PASS';" -c "CREATE DATABASE akylly OWNER akylly;"
```

## 4. Скачать приложение

```bash
git clone https://github.com/babayewwdayanc/akyllymeydanca.git /opt/akylly
```

Отдельный пользователь без прав администратора — так безопаснее:

```bash
useradd --system --home-dir /opt/akylly --shell /usr/sbin/nologin akylly && chown -R akylly:akylly /opt/akylly
```

Установить библиотеки (заодно скачается нейросеть для удаления фона, ~26 МБ):

```bash
cd /opt/akylly && sudo -u akylly -H npm ci --omit=dev
```

## 5. Настройки (.env)

Шаги 3–5 выполняйте в одном окне терминала: команда ниже использует пароль базы из шага 3.

```bash
sudo -u akylly cp .env.example .env
```

Подставить пароль базы, пароль первого администратора и ключ AI-воркера:

```bash
ADMIN_PASS=$(openssl rand -hex 8) && sudo -u akylly sed -i "s/ПАРОЛЬ_БАЗЫ/$DB_PASS/; s/^ADMIN_PASSWORD=$/ADMIN_PASSWORD=$ADMIN_PASS/; s/^WORKER_KEY=$/WORKER_KEY=$(openssl rand -hex 24)/" .env && chmod 600 .env && echo "Вход в панель: admin / $ADMIN_PASS"
```

**Запишите логин и пароль панели** — они выведены на экран. Позже их можно сменить в панели
(«Hasabym»), а строки `ADMIN_USERNAME` / `ADMIN_PASSWORD` из `.env` удалить.

## 6. Запуск через PM2

```bash
sudo -u akylly -H pm2 start ecosystem.config.cjs && sudo -u akylly -H pm2 save
```

Автозапуск PM2 после перезагрузки сервера:

```bash
pm2 startup systemd -u akylly --hp /opt/akylly
```

Проверка — статус `online`, в логе «Akylly Meýdança запущен»:

```bash
sudo -u akylly -H pm2 status && sudo -u akylly -H pm2 logs akylly --lines 20 --nostream
```

## 7. Nginx

```bash
cp deploy/nginx.conf /etc/nginx/sites-available/akylly && ln -sf /etc/nginx/sites-available/akylly /etc/nginx/sites-enabled/akylly && rm -f /etc/nginx/sites-enabled/default
```

```bash
nginx -t && systemctl reload nginx
```

## 8. Фаервол

```bash
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable
```

Готово: откройте `http://IP_СЕРВЕРА` — регистрация игроков, `http://IP_СЕРВЕРА/#/admin` — панель.

## 9. Бэкапы

Каждую ночь: дамп базы + фото игроков (видео не копируются — они слишком большие):

```bash
chmod +x /opt/akylly/deploy/backup.sh && (crontab -l 2>/dev/null; echo "0 4 * * * /opt/akylly/deploy/backup.sh >> /var/log/akylly-backup.log 2>&1") | crontab -
```

Копии лежат в `/opt/akylly/backups`. Иногда скачивайте их к себе (с Mac):

```bash
scp -r root@IP_СЕРВЕРА:/opt/akylly/backups ./akylly-backups
```

## Обновление после изменений в коде

```bash
cd /opt/akylly && sudo -u akylly -H git pull && sudo -u akylly -H npm ci --omit=dev && sudo -u akylly -H pm2 reload akylly
```

Изменения структуры базы применяются сами при запуске (миграции).

## Управление

| Что | Команда |
|---|---|
| Статус | `sudo -u akylly -H pm2 status` |
| Логи в реальном времени | `sudo -u akylly -H pm2 logs akylly` |
| Перезапуск | `sudo -u akylly -H pm2 reload akylly` |
| Новый администратор / сброс пароля | `cd /opt/akylly && sudo -u akylly -H npm run admin:create -- логин` |
| Зайти в базу | `sudo -u postgres psql akylly` |

## Если что-то не работает

| Проблема | Что сделать |
|---|---|
| Сайт не открывается | `sudo -u akylly -H pm2 status` и `systemctl status nginx` |
| 502 Bad Gateway | приложение не запущено — смотрите `pm2 logs akylly` |
| «Не удалось подключиться к PostgreSQL» | проверьте `DATABASE_URL` в `/opt/akylly/.env` и `systemctl status postgresql` |
| «задайте WORKER_KEY» | заполните `WORKER_KEY` в `.env` (минимум 16 символов), затем `pm2 reload akylly` |
| Не загружается большое видео | в `deploy/nginx.conf` есть `client_max_body_size 30G` — проверьте, что конфиг скопирован |
| Фон с фото не удаляется | `cd /opt/akylly && sudo -u akylly -H npm run models`, затем `pm2 reload akylly` |

## Когда появится домен: HTTPS

1. У регистратора создайте A-запись: домен → IP сервера.
2. В `/etc/nginx/sites-available/akylly` замените `server_name _;` на `server_name ваш-домен;`.
3. Выполните:

```bash
apt install -y certbot python3-certbot-nginx && certbot --nginx -d ваш-домен
```

Certbot сам получит бесплатный сертификат, включит HTTPS и будет продлевать его.

## Перенос данных со старой версии (SQLite)

Если раньше приложение работало на SQLite (`data/app.db`), перенесите данные в пустую базу:

```bash
cd /opt/akylly && sudo -u akylly -H npm run db:import-sqlite
```

## AI-воркер (когда будут камеры)

На компьютере с видеокартой NVIDIA:

```bash
git clone https://github.com/babayewwdayanc/akyllymeydanca.git && cd akyllymeydanca/ai && pip install -r requirements.txt
```

```bash
python worker.py --server http://IP_СЕРВЕРА --key WORKER_KEY_ИЗ_ENV --device 0
```

Подробнее — `docs/AI-i-stoimost.md`.
