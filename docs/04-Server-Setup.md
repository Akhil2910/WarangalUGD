# Putting the Warangal UGD Tracker on a server

For an Ubuntu 22.04 / 24.04 server. Replace the words in `<angle brackets>`.
Run the commands as a user with `sudo`.

## What goes to the server

| What | From | Size | How |
|---|---|---|---|
| The code | GitHub (this repository) | small | `git clone` |
| Map data (satellite image, network, boundaries) | `WGL_V2\app-data` on the office PC | about 500 MB | copy (step 3) |
| The database | `npm run export-sql -w server` on the office PC | about 90 MB | copy (step 3) |
| Photos | `WGL_V2\app-state\files` on the office PC | small | copy (step 3) |

The map data, database and photos are **not** on GitHub (they hold purchased imagery and personal data).

## 1. Install Node 24, PostgreSQL 16, nginx

```bash
sudo apt update && sudo apt install -y curl git nginx postgresql postgresql-contrib
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node -v && psql --version
```
(If the Ubuntu package is older than PostgreSQL 16, install 16 from apt.postgresql.org.)

## 2. Get the code and build it

```bash
sudo mkdir -p /opt/wgl && sudo chown $USER /opt/wgl
cd /opt/wgl
git clone https://github.com/Akhil2910/WarangalUGD.git .
cd app
npm ci
npm run build
```

## 3. Copy the data from the office PC

On the office PC: stop the app, then make a fresh database file:
```bash
cd C:\Users\jaipa\Desktop\WGL_V2\app
npm run export-sql -w server
```
Then copy to the server (from the office PC, in PowerShell; `scp` is built into Windows):
```bash
scp -r C:\Users\jaipa\Desktop\WGL_V2\app-data <user>@<server>:/opt/wgl/
scp -r C:\Users\jaipa\Desktop\WGL_V2\app-state\files <user>@<server>:/opt/wgl/app-state/
scp C:\Users\jaipa\Desktop\WGL_V2\app-state\backups\wgl-<date>.sql <user>@<server>:/opt/wgl/
```
Do **not** copy `app-state\pglite`, `session-secret.txt` or the password sheets.

## 4. Create the database and load the data

```bash
sudo -u postgres psql -c "CREATE USER wgl WITH PASSWORD '<a strong password>';"
sudo -u postgres psql -c "CREATE DATABASE wgl OWNER wgl;"
sudo -u postgres psql -d wgl -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
PGPASSWORD='<a strong password>' psql -h 127.0.0.1 -U wgl -d wgl -v ON_ERROR_STOP=1 -f /opt/wgl/wgl-<date>.sql
```
The last lines of the .sql file list the expected number of rows in each table.

## 5. Settings

Create `/opt/wgl/wgl.env` (keep it private: `chmod 600`):
```
DATABASE_URL=postgres://wgl:<a strong password>@127.0.0.1:5432/wgl
HOST=127.0.0.1
PORT=8787
DATA_DIR=/opt/wgl/app-data
STATE_DIR=/opt/wgl/app-state
COOKIE_SECURE=true
PUBLIC_BASE_URL=https://<your web address>
SESSION_SECRET=<a long random text: openssl rand -hex 48>
```
`PUBLIC_BASE_URL` is the address printed in the QR codes on the work-stretch boards.

## 6. Run it as a service (starts on boot, restarts on failure)

`/etc/systemd/system/wgl.service`:
```
[Unit]
Description=Warangal UGD Tracker
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/wgl/app
EnvironmentFile=/opt/wgl/wgl.env
ExecStart=/usr/bin/npm start
Restart=always
User=<your user>

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now wgl
curl http://127.0.0.1:8787/api/health      # {"ok":true,"db":"postgres"}
```

## 7. Web address with HTTPS (nginx)

`/etc/nginx/sites-available/wgl`:
```
server {
  server_name <your web address>;
  client_max_body_size 40m;
  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/wgl /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d <your web address>
```

## 8. Before real use

- Disable the trial accounts and give each officer their own account and password.
- Daily database backup (keeps 14 days):
  ```bash
  sudo mkdir -p /opt/wgl/backups && sudo chown postgres /opt/wgl/backups
  echo "0 2 * * * postgres pg_dump wgl | gzip > /opt/wgl/backups/wgl-\$(date +\%F).sql.gz && find /opt/wgl/backups -name '*.gz' -mtime +14 -delete" | sudo tee /etc/cron.d/wgl-backup
  ```
  Also copy `/opt/wgl/app-state/files` (photos) to the backup place.
- From then on, work only on the server; stop using the copy on the office PC.

## Updating to a new version later

```bash
cd /opt/wgl && git pull && cd app && npm ci && npm run build && sudo systemctl restart wgl
```
Database changes are applied automatically at start-up; they only ever add, never delete.
