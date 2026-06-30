# AGENTS.md — YouTube_Tops

App **personal** (un solo usuario) sobre **Cloudflare** (Pages + Functions + D1 +
KV; Workers AI es Roadmap). Descubre "joyas" de YouTube saltándose el algoritmo de
retención, con un **algoritmo de scoring editable en vivo** desde la UI.

## Arquitectura (resumen)

- **Frontend** estático en `public/` (HTML/CSS/JS vanilla, mobile-first).
- **Backend**: Pages Functions con ruteo por archivos en `functions/api/*` (→ `/api/*`).
- **Librerías** sin ruteo en `src/lib/*` (scoring, mmr, youtube, crawler, quota, settings, http, ai).
- **DB**: D1 (`migrations/0001_init.sql`). **Caché/dedupe**: KV (binding `CACHE`).
- Endpoints: `videos`, `settings`, `saved` (+ `saved/order`), `crawl`, `auth`, `rate` (TODO 501).

Comandos estándar y pasos de deploy están en `README.md` (no se duplican aquí).

## Cursor Cloud specific instructions

- **Las Pages Functions van en `/functions/api`, NO en `/src/functions`.** Cloudflare
  Pages solo descubre funciones (ruteo por archivos) en `/functions` en la raíz del
  proyecto; un `/src/functions` no se rutearía. Las librerías sí viven en `/src/lib`.
- **Workers AI rompe el dev local.** El binding `[ai]` no tiene emulación local: fuerza
  una conexión remota que exige credenciales de Cloudflare y hace crashear
  `wrangler pages dev`. Por eso `[ai]` está **comentado** en `wrangler.toml`. El MVP no
  usa AI (es Roadmap: densidad por subtítulos). Para esa fase, descoméntalo y configura
  credenciales (`CLOUDFLARE_API_TOKEN`) o el binding "AI" en el dashboard.
- **`wrangler pages dev` no acepta `--config`/`-c`** ni un `wrangler.dev.toml`; lee solo
  el `wrangler.toml` (o `wrangler.jsonc`) de la raíz. No intentes pasar una config alterna.
- **Orden local obligatorio:** `npm run migrate:local` **antes** de `npm run seed:local`,
  y ambos antes de `npm run dev`. El estado local (D1/KV) vive en `.wrangler/state` y lo
  comparten `d1 execute`, `seed` y `pages dev` (mismo `--persist-to` por defecto).
- **Seed sin API key:** si no hay `YOUTUBE_API_KEY` (env o `.dev.vars`), `seed` usa
  `scripts/fixtures.js` para poblar D1 y poder demostrar la app end-to-end sin cuota.
  Con la key, hace una ronda real dentro del BUDGET. `seed` escribe a D1 generando SQL y
  aplicándolo con `wrangler d1 execute` (no usa el binding directo).
- **`/api/crawl` necesita `YOUTUBE_API_KEY`**; sin ella devuelve 400 con un hint (no rompe
  la app, que sigue sirviendo el corpus existente). Para probar crawl en local, pon la key
  en `.dev.vars`.
- **El score se calcula EN VIVO** en `/api/videos` desde `settings` (no se confía solo en
  `videos.score_base`); por eso editar el algoritmo re-rankea sin re-fetch.
- **Auth opcional (`APP_PASSWORD`)**: si el secret existe, todos los `/api/*` exigen el
  header `x-app-password` (excepto `/api/auth`, que es público para que el front sepa si
  debe pedir contraseña). Sin el secret, la app queda abierta.
