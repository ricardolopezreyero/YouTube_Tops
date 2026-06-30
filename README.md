# YouTube Tops

Recomendador personal de videos de YouTube sin algoritmo de retención. Descubre contenido largo y profundo basado en tu perfil de intereses, no en lo que maximiza el tiempo de pantalla.

---

## Qué hace

- **Corpus compartido en Cloudflare D1** — videos indexados por un score base de 6 factores
- **Re-ranking personal** — cada usuario ajusta pesos y palabras clave desde su perfil en Firestore
- **Filter bar** — filtra por duración: corto (<15 min), medio (15–30), largo (30–60), profundo (>60)
- **Mi Sesión** — genera una playlist que llena exactamente el tiempo que tienes disponible (knapsack greedy)
- **Score breakdown** — hover sobre cualquier badge de score para ver el detalle por componente
- **Listas** — guarda, reordena y gestiona listas de videos; importa por URL
- **Feedback loop** — clics suben el score (+0.03 por clic, máx +0.30); "No me interesa" oculta permanentemente

### Algoritmo de score (6 componentes)

| Componente   | Peso default | Qué mide |
|---|---|---|
| Engagement   | 35 | Ratio likes/vistas + comentarios/vistas, penaliza viralidad sin fondo |
| Relevancia   | 25 | Overlap de keywords del perfil con título y descripción |
| Profundidad  | 15 | Keywords de contenido denso + presencia de capítulos |
| Duración     | 10 | Sweet spot 8–60 min; penaliza clips cortos y maratones |
| Subtítulos   | 5  | Tiene CC (binario) |
| Autoridad    | 10 | log₁₀(suscriptores)/7, capped en 10M |

---

## Stack

| Capa | Tecnología |
|---|---|
| Hosting + backend | Cloudflare Pages + Pages Functions |
| Base de datos | Cloudflare D1 (SQLite en el edge) |
| Cache / dedup | Cloudflare KV |
| AI (onboard) | Workers AI — `@cf/meta/llama-3.1-8b-instruct` |
| Auth | Firebase Authentication (Google, popup) |
| Perfil de usuario | Firestore (reglas: solo el dueño lee/escribe) |
| Frontend | Vanilla JS ES modules, sin bundler |
| CI/CD | GitHub Actions → `wrangler pages deploy` |
| Videos | YouTube Data API v3 |

---

## Estructura del proyecto

```
YouTube_Tops/
├── public/                  # Frontend estático
│   ├── index.html
│   ├── app.js               # Toda la lógica del cliente
│   ├── styles.css
│   ├── firebase-config.js
│   └── logger.js
├── functions/api/           # Cloudflare Pages Functions (edge)
│   ├── videos.js            # GET /api/videos
│   ├── add-video.js         # POST /api/add-video
│   ├── onboard.js           # POST /api/onboard
│   └── suggest.js           # POST /api/suggest
├── src/lib/                 # Librerías compartidas backend
│   ├── auth.js              # Verificación JWT Firebase (RS256, Web Crypto)
│   ├── scoring.js           # scoreVideo() + scoreBase()
│   ├── youtube.js           # YouTube Data API v3 helpers
│   ├── ai.js                # Workers AI (perfil + sugerencias)
│   └── quota.js             # Control de cuota diaria YouTube
├── migrations/
│   └── 0001_init.sql        # Schema D1
├── scripts/
│   └── seed.js              # Carga inicial del corpus desde YouTube
├── config.js                # Seeds, pesos default, constantes
└── wrangler.toml            # Bindings D1, KV, AI, vars
```

---

## Setup inicial (una sola vez)

### 1. Prerrequisitos

- Node.js ≥ 18
- Cuenta Cloudflare con Workers y Pages habilitados
- Proyecto Firebase (`tops-b68a3` o el tuyo)
- YouTube Data API v3 key

### 2. Variables de entorno

Crea `.dev.vars` en la raíz (no se sube al repo):

```
YOUTUBE_API_KEY=tu_clave_de_youtube
```

Crea `.env` para referencias locales:

```
CF_ACCOUNT_ID=tu_account_id
CF_D1_DATABASE_ID=c53c86e9-7482-4cdc-8679-f50a015efb09
```

Agrega los secrets en GitHub (Settings → Secrets → Actions):

- `CLOUDFLARE_API_TOKEN` — token con permisos de Pages y D1

### 3. Base de datos D1

```bash
# Aplicar schema
npx wrangler d1 migrations apply youtube_tops --remote

# Cargar corpus inicial (~1000 unidades de cuota YouTube)
npm run seed
```

### 4. Firestore

```bash
# Desplegar reglas de seguridad
npm run firebase:rules
```

### 5. Deploy manual (primera vez)

```bash
npm run deploy
```

Después de eso, cada push a `main` despliega automáticamente vía GitHub Actions.

---

## Desarrollo local

```bash
npm run dev
# Abre http://localhost:8788
```

Cloudflare Pages local usa D1 y KV locales automáticamente con las configuraciones de `wrangler.toml`.

---

## Endpoints API

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/onboard` | Deriva semillas y keywords desde una descripción con Workers AI |
| `GET` | `/api/videos` | Top videos del corpus re-rankeados con pesos del usuario |
| `POST` | `/api/add-video` | Agrega un video por URL (cache D1 primero, luego YouTube API) |
| `POST` | `/api/suggest` | Sugiere keywords adicionales con Workers AI |

Todos los endpoints requieren `Authorization: Bearer <Firebase ID Token>`.

---

## Cuota YouTube API

La API de YouTube tiene un límite de **10,000 unidades/día**.

| Operación | Costo |
|---|---|
| `search.list` (1 búsqueda) | 100 u |
| `videos.list` (batch 50) | 1 u |
| `channels.list` (batch 50) | 1 u |
| Seed completo (10 seeds) | ~1,003 u |

El archivo `quota.js` trackea el uso en D1. El seed script está configurado para no exceder el budget en `config.js`.

---

## Notas técnicas

**Por qué no Firebase Admin SDK en Workers:**
Workers no puede ejecutar Node.js nativamente. La verificación de JWT de Firebase se hace con Web Crypto API (RS256) obteniendo las claves públicas de Google JWK con caché en Cloudflare.

**REGLA CRÍTICA JS:**
Todos los `const` se declaran antes de cualquier `addEventListener`. `onAuthStateChanged` va al final del módulo. Esto previene crashes por Temporal Dead Zone (TDZ) en ES modules.

**Modelo de datos multiusuario:**
D1 es un corpus compartido (todos los usuarios ven el mismo pool). Firestore guarda el perfil de cada usuario (pesos, keywords, feedback, listas). El re-ranking sucede en el edge al momento de `GET /api/videos`.
