# YouTube_Tops

Web app **personal** (un solo usuario) para descubrir las **mejores joyas** de
YouTube para tu perfil, **saltándote el algoritmo de retención**. Premia densidad
y engagement *relativo* (no vistas absolutas), con un **algoritmo editable** desde
la UI que re-rankea en vivo.

Stack: **solo GitHub + Cloudflare** (sin Firebase).

- **Frontend:** Cloudflare Pages (HTML/CSS/JS vanilla, mobile-first).
- **Backend:** Pages Functions (`/functions/api/*`).
- **DB:** Cloudflare D1 (SQLite). **Caché/dedupe:** Cloudflare KV.
- **IA (fase posterior):** Cloudflare Workers AI.
- **CI/CD:** GitHub Actions + Wrangler en push a `main`.

> **Nota de estructura:** las Pages Functions viven en `/functions/api` (ruteo por
> archivos de Cloudflare Pages, necesario para que la app corra). Las librerías sin
> ruteo están en `/src/lib` tal cual el diseño original.

## Estructura

```
/
  wrangler.toml
  package.json
  .gitignore
  .env.example                 (YOUTUBE_API_KEY=, APP_PASSWORD=)
  config.js                    (DEFAULTS de semillas, keywords, pesos, presupuesto)
  /migrations/0001_init.sql
  /scripts/seed.js  /scripts/fixtures.js
  /functions/api               (videos.js, settings.js, saved.js, saved/order.js, crawl.js, rate.js, auth.js, _middleware.js)
  /src/lib                     (youtube.js, scoring.js, crawler.js, quota.js, mmr.js, ai.js, settings.js, http.js)
  /public                      (index.html, app.js, styles.css)
  /.github/workflows/deploy.yml
```

## Desarrollo local (lo que ya corre end-to-end)

```bash
npm install
npm run migrate:local        # aplica migrations/0001_init.sql a la D1 local
npm run seed:local           # siembra el corpus (usa fixtures si no hay YOUTUBE_API_KEY)
npm run dev                  # wrangler pages dev -> http://localhost:8788
```

- Sin `YOUTUBE_API_KEY`, `seed` usa **fixtures** (`scripts/fixtures.js`) para que la
  demo corra sin gastar cuota.
- Con `YOUTUBE_API_KEY` (en `.dev.vars`), `seed` hace una ronda **real** dentro del BUDGET.

`.dev.vars` (local, NO se commitea):

```
YOUTUBE_API_KEY=tu_api_key
APP_PASSWORD=opcional
```

## Despliegue en producción — pasos EXACTOS en orden

```bash
# 1) Crear recursos y pegar los IDs en wrangler.toml (binding DB y CACHE)
wrangler d1 create youtube_tops
wrangler kv namespace create CACHE

# 2) Aplicar migraciones
wrangler d1 migrations apply youtube_tops --remote

# 3) Configurar secrets (NUNCA en el repo)
wrangler secret put YOUTUBE_API_KEY
wrangler secret put APP_PASSWORD        # opcional; si se omite, la app queda abierta

# 4) Desplegar y sembrar UNA vez
#    (push a main dispara GitHub Actions, o manual:)
npx wrangler pages deploy public --project-name=youtube-tops
npm run seed                            # una sola vez tras el primer deploy
```

GitHub Actions (`.github/workflows/deploy.yml`) hace 2 y 3-deploy en cada push a
`main`. Requiere los repo secrets `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`.

## El algoritmo editable

Pesos (engagement, relevancia, profundidad, duración, subtítulos, autoridad),
SEEDS, INTEREST_KEYWORDS, HATE_KEYWORDS y rango de duración se editan en el panel
**"Algoritmo"** y se guardan en la tabla `settings`. Cambiar cualquier valor
**re-rankea en vivo**. Botón **"Restaurar defaults"**.

## Modos

- **Joyas** (default): score + diversidad MMR; la joya #1 va destacada arriba.
- **Profundidad:** prioriza densidad (DEPTH_KEYWORDS + capítulos).
- **Frescura:** prioriza lo reciente (la frescura **no** castiga el score).
- **Autoridad:** prioriza canales con más autoridad.

## Cuota

`search.list` = 100u, `videos.list`/`channels.list` = 1u (lotes de 50). Cada ronda
de crawl respeta `BUDGET.max_search_per_round`. Se registra el consumo diario en
`quota_log`. Nunca se re-busca/re-enriquece lo ya existente; el crudo se cachea en KV.

## Acceso (APP_PASSWORD opcional)

Si defines `APP_PASSWORD` como secret, el front lo pide una vez y lo guarda en
`localStorage`; el Worker lo exige (header `X-App-Password`) en todos los `/api/*`.
Si no lo defines, la app queda abierta. (Implementado y desactivable.)

## Roadmap (TODO — no en el MVP)

- **Cron Trigger cada 6h** para crecer el corpus en segundo plano
  (ver `wrangler.toml`, sección `[triggers]` comentada).
- **Densidad por subtítulos:** bajar transcript (timedtext/librería) con fallback
  si las IPs de Workers están bloqueadas, muestrearlo, y que Workers AI
  (`@cf/meta/llama-3.1-8b-instruct`) devuelva `{density 0-100, verdict}`; badge en
  la tarjeta, caché permanente en `subtitle_ratings`, y un **modo "Densidad"** que
  reordena por esa nota. Endpoint reservado: `POST /api/rate` (`functions/api/rate.js`),
  lógica en `src/lib/ai.js`.
- **Marcar vistos / ocultar** videos.
```
