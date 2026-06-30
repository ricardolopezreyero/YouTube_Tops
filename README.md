# YouTube Tops 🎯

> Los mejores videos de YouTube según tu perfil. Sin el algoritmo de retención.

**Stack**: Firebase Auth · Firestore · Cloudflare Pages · Cloudflare D1 · Cloudflare KV · Workers AI · GitHub Actions

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│  Usuario (browser)                                          │
│  HTML/CSS/JS vanilla · Firebase Auth SDK (CDN)             │
└────────────┬───────────────────────────────────────────────┘
             │ Firebase ID Token (JWT) en Authorization: Bearer
             ▼
┌─────────────────────────────────────────────────────────────┐
│  Cloudflare Pages + Pages Functions                         │
│                                                             │
│  POST /api/onboard  → Workers AI (deriva seeds/keywords)   │
│  GET  /api/videos   → D1 corpus → re-rankea con perfil     │
└────────────┬───────────────────────────────────────────────┘
             │
     ┌───────┴───────┐
     ▼               ▼
  D1 (corpus)    Firebase
  Corpus         Firestore
  compartido     (perfil por usuario)
```

**Modelo multiusuario**:
- El corpus de videos en D1 es **compartido** entre todos los usuarios.
- Cada usuario **re-rankea** el corpus con sus propios keywords y pesos.
- La cuota de YouTube no crece con el número de usuarios.

---

## Setup completo (paso a paso)

### Prerrequisitos

```bash
node --version  # ≥ 20
npm install
npx wrangler --version  # ≥ 3
npx wrangler login      # autentícate con Cloudflare
```

---

### Paso 1 — Firebase

1. Ve a [console.firebase.google.com](https://console.firebase.google.com) y abre el proyecto **YouTube-Tops** (ID: `tops-b68a3`).

2. **Authentication → Método de acceso → Google** → Habilitar.

3. **Configuración del proyecto → Tus apps → Web** → Copia el objeto `firebaseConfig`:
   ```
   Firebase Console → ⚙ → Configuración del proyecto → Tus apps → </> (Web)
   ```
   Abre `public/firebase-config.js` y reemplaza:
   - `REPLACE_WITH_FIREBASE_WEB_API_KEY` → tu `apiKey`
   - `REPLACE_WITH_FIREBASE_APP_ID`      → tu `appId`

4. **Authentication → Configuración → Dominios autorizados** → agrega tu dominio de Cloudflare Pages:
   ```
   youtube-tops.pages.dev
   ```
   (O el dominio personalizado que uses.)

5. **Firestore → Crear base de datos** (modo producción si no existe).

6. Publicar las reglas de seguridad:
   ```bash
   npm install -g firebase-tools   # si no está instalado
   firebase login
   firebase use tops-b68a3
   firebase deploy --only firestore:rules
   ```

---

### Paso 2 — Cloudflare D1 y KV

Crea los recursos y copia los IDs en `wrangler.toml`:

```bash
# D1 database
npx wrangler d1 create youtube_tops
# → Copia el "database_id" en wrangler.toml > [[d1_databases]] > database_id

# KV namespace
npx wrangler kv namespace create CACHE
# → Copia el "id" en wrangler.toml > [[kv_namespaces]] > id
```

Edita `wrangler.toml`:
```toml
[[d1_databases]]
  database_id = "PEGA_EL_ID_AQUI"

[[kv_namespaces]]
  id = "PEGA_EL_ID_AQUI"
```

---

### Paso 3 — Aplicar migración D1

```bash
# Base de datos remota (producción)
npx wrangler d1 migrations apply youtube_tops --remote

# Para desarrollo local
npx wrangler d1 migrations apply youtube_tops --local
```

---

### Paso 4 — Cloudflare Secret: YOUTUBE_API_KEY

La clave de YouTube **nunca** va al repositorio. Se almacena como Cloudflare Secret:

```bash
npx wrangler secret put YOUTUBE_API_KEY
# → Pega tu clave cuando la solicite (AIzaSyAD...)
```

Para desarrollo local, crea `.dev.vars` (excluido en `.gitignore`):
```
YOUTUBE_API_KEY=AIzaSyAD...
```

---

### Paso 5 — Crear proyecto en Cloudflare Pages

```bash
# Crea el proyecto Pages por primera vez
npx wrangler pages project create youtube-tops
```

Después de crear el proyecto, vincula los bindings D1, KV y AI desde el dashboard:
- [dash.cloudflare.com](https://dash.cloudflare.com) → Pages → youtube-tops → **Settings → Functions**
  - D1 database bindings: `DB` → `youtube_tops`
  - KV namespace bindings: `CACHE` → el KV que creaste
  - Workers AI: `AI` (habilitar en la misma sección)
- Variables de entorno: `FIREBASE_PROJECT_ID` = `tops-b68a3`

---

### Paso 6 — Primer deploy

**Opción A — GitHub Actions (recomendado)**

Agrega el secreto `CLOUDFLARE_API_TOKEN` en tu repositorio:
- GitHub → Settings → Secrets and variables → Actions → New repository secret
- Nombre: `CLOUDFLARE_API_TOKEN`
- Valor: *(el token que creaste en dash.cloudflare.com → My Profile → API Tokens)*

Luego haz push a `main` y GitHub Actions desplegará automáticamente.

**Opción B — Manual**

```bash
npx wrangler pages deploy public --project-name=youtube-tops
```

---

### Paso 7 — Seed del corpus (ejecutar UNA vez)

Tras el primer deploy, puebla D1 con la primera ronda de videos:

```bash
# Asegúrate de tener YOUTUBE_API_KEY en .dev.vars o en el entorno
npm run seed
```

El script:
- Llama a YouTube API con las 10 primeras semillas (`SEEDS_DEFAULT` en `config.js`)
- Enriquece con stats, duración y datos de canal
- Calcula `score_base` con los pesos por defecto
- Inserta ~80-120 videos en D1 (deduplicados)
- Cuota estimada: ~1003 unidades de YouTube Data API

---

### Paso 8 — Verificar

Abre tu URL de Cloudflare Pages:
```
https://youtube-tops.pages.dev
```

Flujo esperado:
1. Pantalla de login → **Continuar con Google**
2. Si es primer ingreso: escribe tu perfil → **Generar mi perfil** (llama a Workers AI)
3. Grid de videos rankeados según tu perfil
4. ⚙️ → ajusta pesos con sliders → **Aplicar y re-rankear**

---

## Estructura del proyecto

```
/
├── wrangler.toml                  Configuración Cloudflare Pages
├── package.json                   Scripts: dev, deploy, seed, db:migrate
├── config.js                      Seeds, keywords, pesos y presupuestos por defecto
├── firestore.rules                Reglas de seguridad Firestore
│
├── migrations/
│   └── 0001_init.sql              Esquema D1: videos, channels, search_queue…
│
├── functions/api/                 Cloudflare Pages Functions
│   ├── onboard.js                 POST /api/onboard  (Workers AI → perfil)
│   └── videos.js                  GET  /api/videos   (D1 → re-rankear)
│
├── src/lib/                       Librerías compartidas
│   ├── auth.js                    Verificación JWT Firebase (Web Crypto)
│   ├── youtube.js                 Cliente YouTube Data API v3
│   ├── scoring.js                 Algoritmo de re-ranking
│   ├── ai.js                      Workers AI: derivar perfil
│   └── quota.js                   Seguimiento de cuota en D1
│
├── scripts/
│   └── seed.js                    npm run seed
│
├── public/                        Archivos estáticos (Cloudflare Pages)
│   ├── firebase-config.js         Config SDK Firebase (⚠ reemplazar apiKey y appId)
│   ├── index.html                 SPA: login / onboarding / app
│   ├── app.js                     Lógica frontend (vanilla JS, ES modules)
│   └── styles.css                 Estilos mobile-first, dark theme
│
└── .github/workflows/
    └── deploy.yml                 CI/CD: push a main → deploy a CF Pages
```

---

## Algoritmo de scoring

Cada video recibe un score compuesto [0–1]:

| Componente   | Peso default | Descripción |
|---|---|---|
| **Engagement** | 35% | Ratio like/view + comment/view. Penaliza ultra-virales con bajo engagement |
| **Relevancia** | 25% | Overlap de `interest_keywords` del usuario con título y descripción |
| **Profundidad** | 15% | `DEPTH_KEYWORDS` presentes + capítulos/timestamps en descripción |
| **Duración** | 10% | Sweet spot 8–60 min. Decae suavemente fuera del rango |
| **Subtítulos** | 5% | `contentDetails.caption == true` |
| **Autoridad** | 10% | `log10(suscriptores)` capeado en 10M. No dominante |

Los pesos son ajustables por usuario vía los sliders del panel.

---

## Pendientes / Roadmap (TODO)

Los siguientes features están marcados como `// TODO` en el código y NO están construidos en el MVP:

1. **Crawler de 3 capas** — `search_queue` + `/api/crawl` "Buscar joyas". Explora videos relacionados en profundidad.
2. **Cron Trigger cada 6h** — `[triggers] crons = ["0 */6 * * *"]` en `wrangler.toml`. Crece el corpus en background automáticamente.
3. **Densidad por subtítulos** — Post-carga, baja transcript (`timedtext` o librería), lo muestrea, Workers AI devuelve `{density 0–100, verdict}`, badge en tarjeta, cache en `subtitle_ratings`.
4. **MMR (diversidad)** — Maximal Marginal Relevance para evitar clusters repetitivos en el ranking.
5. **Perfil desde Firestore en el Worker** — El Worker lee directamente el perfil del usuario desde Firestore (en lugar de recibirlo del cliente) para mayor robustez anti-tamper.
6. **Estado por usuario** — Videos vistos / guardados / ocultos.
7. **Modo local con wrangler** — `npm run dev` con D1 local y Workers AI simulado.

---

## Seguridad

- **YOUTUBE_API_KEY**: Cloudflare Secret. Nunca en el repo.
- **Firebase API key** (`public/firebase-config.js`): pública por diseño (identifica el proyecto, no otorga acceso).
- **Firestore Rules**: cada usuario sólo puede leer/escribir `users/{uid}` donde `uid == auth.uid`.
- **Workers JWT Verification**: cada endpoint verifica el Firebase ID token contra las claves públicas de Google (RS256, Web Crypto API). Sin SDK de Firebase en el Worker.

---

## Variables de entorno

| Variable | Dónde | Descripción |
|---|---|---|
| `YOUTUBE_API_KEY` | Cloudflare Secret | YouTube Data API v3 |
| `FIREBASE_PROJECT_ID` | `wrangler.toml [vars]` | ID del proyecto Firebase (`tops-b68a3`) |
| `CLOUDFLARE_API_TOKEN` | GitHub Secret | Para CI/CD con wrangler-action |

Para desarrollo local, usa `.dev.vars` (ver `.env.example`).
