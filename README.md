# Treino do Dia — academia orientada pelo histórico do Strava

A standalone web application (its own server) that reads your activities on Strava every day and defines what to do at the gym on that day.

## 1. What the application does

| Function | How it works |
|---|---|
| Reading Strava | OAuth connection, read-only (`activity:read_all`). Initial load of the last 120 days. |
| Daily update | Automatic sync at the configured time (default 05:00, America/Sao_Paulo). It also syncs when the page opens if the data is more than 12 hours old, and on the "Sincronizar agora" button. |
| Treino do dia | Workout focus, intensity, exercises, sets × reps, rest and RIR, with a checklist for use at the gym. |
| Rationale | Lists the reasons for the recommendation and the options ruled out. |
| Next days | Projection for the 3 following days. |
| Focus correction | Each weight-training session can be tagged by hand (Empurrar, Puxar, Pernas etc.). |

### Decision rules

| # | Rule | Effect |
|---|---|---|
| 1 | Consecutive days of activity ≥ configured limit (default 6) | Rest |
| 2 | Acute:chronic ratio (7 vs. 28 days) > 1.50 | Active recovery |
| 3 | Weekly gym target already met in the last 7 days | Active recovery |
| 4 | Main muscle group trained less than 48 h ago | Focus ruled out |
| 5 | High leg fatigue (running, cycling, leg day) | Lower-body focus ruled out |
| 6 | Moderate leg fatigue, or a long run/ride usually done the next day | Legs in a light version (substitutions and less volume) |
| 7 | Among the eligible focuses, the one longest without stimulus is chosen | Rotation of the split |
| 8 | Ratio 1.30–1.50, ≥ 4 consecutive days or very high load yesterday | Intensity lowered |
| 9 | More than 10 days without the gym, or no history | Moderate intensity (readaptation) |

**Load per activity**: Relative Effort from Strava (when available) → TRIMP from heart rate (when maximum HR is set) → estimate by duration × type.

**Identifying the focus of gym sessions** (in order of priority): manual tag in the app → activity name on Strava (e.g. "Peito e tríceps", "Leg day", "Costas") → inferred from the split rotation.

## 2. Prerequisites

1. A server with Node.js 20+ **or** Docker.
2. A domain/subdomain with HTTPS (e.g. `treino.seudominio.com.br`).
3. An application registered on Strava:
   - Go to <https://www.strava.com/settings/api>.
   - **Authorization Callback Domain**: just the domain, with no `https://` (e.g. `treino.seudominio.com.br`).
   - Write down the **Client ID** and **Client Secret**.

## 3. Configuration

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `BASE_URL` | Yes | Public address, with no trailing slash. The callback will be `BASE_URL/auth/strava/callback`. |
| `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` | Yes | Strava app credentials. |
| `APP_PASSWORD` | Yes | Password for accessing the page. Without it the server does not start. |
| `TRUST_PROXY` | Recommended | `1` when running behind Nginx, Caddy, Render or Railway. |
| `DATA_DIR` | Recommended | Persistent directory for tokens, activities and settings. |
| `SESSION_SECRET` | Optional | Session signing key (generated automatically if missing). |
| `CRON_SECRET` | Optional | Enables `/cron/sync` for external schedulers. |

## 4. Publishing

### Option A — VPS with Docker (recommended)

```bash
cd treino-strava
cp .env.example .env    # fill in the variables
docker compose up -d --build
```

The container listens on `127.0.0.1:3000`. Publish it with a reverse proxy using HTTPS. Example with Caddy (automatic certificate):

```
treino.seudominio.com.br {
    reverse_proxy 127.0.0.1:3000
}
```

The data lives in the `treino-dados` volume and survives restarts and updates.

### Option B — VPS without Docker (Node + systemd)

```bash
cd /opt/treino-strava && cp .env.example .env   # fill in the variables
node server.js                                  # test
```

`/etc/systemd/system/treino-strava.service`:

```ini
[Unit]
Description=Treino do Dia (Strava)
After=network.target

[Service]
WorkingDirectory=/opt/treino-strava
ExecStart=/usr/bin/node server.js
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now treino-strava
```

### Option C — Managed platforms (Railway, Render, Fly.io)

- Create the service from the `treino-strava` directory (the Dockerfile is detected automatically).
- **Attach a persistent volume** mounted at `/data` and set `DATA_DIR=/data`. Without a persistent volume the Strava connection is lost on every deploy.
- Set the variables from section 3 in the platform's dashboard.
- On plans that put the service to sleep, set `CRON_SECRET` and schedule a daily call (e.g. cron-job.org):
  `POST https://treino.seudominio.com.br/cron/sync` with the header `Authorization: Bearer <CRON_SECRET>`.

## 5. First use

1. Open `BASE_URL`, enter the password.
2. Click **Conectar com Strava** and authorize access to activities.
3. Under **Configurações**, adjust: gym sessions per week, split, goal, target duration, usual training time and maximum HR.
4. Recommended practice: name your gym sessions on Strava with the focus ("Empurrar", "Puxar", "Pernas", "Superiores", "Inferiores"). If that is not possible, correct the focus in the activities table.

## 6. Local evaluation (no Strava account)

```bash
npm run demo          # http://localhost:3000, fictitious history, no password
npm test              # automated tests of the recommendation engine
```

## 7. Security and data

| Item | Handling |
|---|---|
| Access to the page | Mandatory password, session in a signed cookie (HttpOnly, SameSite, Secure over HTTPS), limit of 5 attempts per 15 min. |
| Strava | Read-only. Tokens renewed automatically and stored in `DATA_DIR` with restricted permission (600). |
| OAuth | `state` parameter validated against CSRF; insufficient scope is refused. |
| Retention | Activities from the last 180 days. "Desconectar Strava" revokes access and deletes the activities stored on the server. |
| Headers | Restrictive CSP, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`. |
| Dependencies | None (standard Node.js only). |

## 8. Limits and maintenance

- Strava API: 100 requests / 15 min and 1,000 / day. A daily sync uses 1 to 2 requests.
- The recommendation is a training aid and does not replace guidance from a physical-education professional.
- Updating: `git pull && docker compose up -d --build` (the data is kept in the volume).
