# 🎯 YouTube Tops

> **Los mejores videos de YouTube según tu perfil. Sin el algoritmo de retención.**

YouTube Tops es una web app multiusuario que re-rankea el corpus de YouTube usando tu perfil real — lo que aprendes, a qué te dedicas, cuánto tiempo tienes — en lugar del algoritmo que maximiza cuánto tiempo pasas viendo.

**→ [youtube-tops.pages.dev](https://youtube-tops.pages.dev)**

---

## ¿Qué hace diferente a esta app?

| YouTube normal | YouTube Tops |
|---|---|
| Te recomienda lo que te engancha | Te recomienda lo que te hace crecer |
| Optimiza retención de atención | Optimiza profundidad de aprendizaje |
| El mismo feed para todos | Perfil propio con tus keywords y pesos |
| No puedes ajustar nada | Sliders en tiempo real para cada factor |
| Nunca sabes por qué te muestra algo | Score transparente con desglose |

---

## ¿Cómo funciona?

```
1. Login con Google
2. Describes tu perfil (a qué te dedicas, qué quieres aprender)
3. Workers AI deriva tus keywords y crea 3 listas personalizadas
4. El corpus compartido se re-rankea según TU perfil
5. Cada clic mejora las recomendaciones. Cada ✕ las afina.
```

El corpus de videos es **compartido** — no se re-busca por usuario. Cada usuario **re-rankea** el mismo corpus con sus propios pesos. La cuota de YouTube no crece con el número de usuarios.

---

## Funcionalidades

### Para el usuario
- **Login con Google** — un clic, sin contraseña
- **Perfil generado por IA** — describes con tus palabras, Workers AI extrae las semillas y keywords
- **Grid personalizado** — 4 columnas desktop, 2 tablet, 1 móvil. Joya #1 destacada arriba
- **Panel de pesos** — 6 sliders ajustables en tiempo real: Engagement · Relevancia · Profundidad · Duración · Subtítulos · Autoridad
- **Contador de clics** — cada video que abres sube en el ranking automáticamente
- **Botón ✕ Descartar** — oculta videos que no te interesan, para siempre
- **Listas** — guarda, organiza y reordena videos. La IA crea 3 listas según tu perfil al registrarte
- **Agregar video por URL** — pega cualquier URL de YouTube, lo busca, te muestra preview y lo guarda en una lista
- **Score transparente** — cada tarjeta muestra su puntuación y tiene desglose de componentes
- **Persistencia total** — perfil, feedback y listas se guardan en Firestore entre sesiones

### Para el algoritmo de score
Cada video recibe un score [0–1] ponderado por los pesos del usuario:

| Factor | Peso por defecto | Lógica |
|---|---|---|
| **Engagement** | 35% | Ratio like/view + comment/view. Penaliza ultra-virales con bajo engagement |
| **Relevancia** | 25% | Overlap de las keywords del usuario con título y descripción |
| **Profundidad** | 15% | Palabras como "masterclass", "framework", "deep dive" + capítulos en descripción |
| **Duración** | 10% | Sweet spot 8–60 min. Decae suavemente fuera del rango |
| **Subtítulos** | 5% | `contentDetails.caption == true` |
| **Autoridad** | 10% | `log10(suscriptores)` capeado en 10M — no dominante |

---

## Stack técnico

```
Frontend    Cloudflare Pages   HTML/CSS/JS vanilla, mobile-first, sin bundler
Auth        Firebase Auth      Solo proveedor Google
Perfil      Firestore          Reglas: solo el dueño lee/escribe su users/{uid}
Corpus      Cloudflare D1      SQLite compartido entre todos los usuarios
Caché       Cloudflare KV      Deduplicación de búsquedas
Backend     CF Pages Functions POST /api/onboard · GET /api/videos · POST /api/add-video
IA          Workers AI         llama-3.1-8b-instruct (fallback: mistral-7b)
CI/CD       GitHub Actions     Push a main → wrangler pages deploy
```

---

## Setup (si quieres tu propia instancia)

### Prerrequisitos
```bash
node --version  # ≥ 20
npm install
npx wrangler login
```

### 1 — Firebase
1. Crea un proyecto en [console.firebase.google.com](https://console.firebase.google.com)
2. Activa **Authentication → Google**
3. Crea una base de datos **Firestore** (modo producción)
4. En **Configuración del proyecto → Tus apps → Web** → copia `apiKey` y `appId`
5. Edita `public/firebase-config.js` con tus valores
6. Despliega las reglas:
   ```bash
   firebase deploy --only firestore:rules --project TU_PROJECT_ID
   ```
7. Agrega tu dominio de Pages a **Authentication → Dominios autorizados**

### 2 — Cloudflare D1 y KV
```bash
npx wrangler d1 create youtube_tops
npx wrangler kv namespace create CACHE
# Pega los IDs resultantes en wrangler.toml
```

### 3 — Migración y secret
```bash
npx wrangler d1 migrations apply youtube_tops --remote
npx wrangler secret put YOUTUBE_API_KEY   # tu clave de YouTube Data API v3
```

### 4 — Deploy y seed
```bash
npx wrangler pages deploy public --project-name=youtube-tops
npm run seed   # puebla D1 con la primera ronda de videos (~1000 unidades de cuota)
```

### 5 — GitHub Actions (CI/CD automático)
Agrega `CLOUDFLARE_API_TOKEN` en **GitHub → Settings → Secrets → Actions**.

---

## Estructura del proyecto

```
/
├── wrangler.toml                   Cloudflare Pages config (D1, KV, AI)
├── config.js                       Seeds, pesos y presupuesto por defecto
├── firestore.rules                 Solo el dueño lee/escribe users/{uid}
├── migrations/0001_init.sql        Esquema D1: 6 tablas
│
├── functions/api/
│   ├── onboard.js                  POST /api/onboard  → Workers AI → perfil
│   ├── videos.js                   GET  /api/videos   → D1 corpus → re-rankeo
│   └── add-video.js                POST /api/add-video → URL → D1 / YouTube API
│
├── src/lib/
│   ├── auth.js                     JWT Firebase RS256 con Web Crypto (sin SDK)
│   ├── youtube.js                  Cliente YouTube Data API v3
│   ├── scoring.js                  Algoritmo de re-ranking
│   ├── ai.js                       Workers AI: perfil + listas sugeridas
│   └── quota.js                    Cuota YouTube por día en D1
│
├── scripts/seed.js                 npm run seed
│
└── public/
    ├── firebase-config.js          SDK Firebase CDN
    ├── index.html                  SPA: login / onboarding / app / listas
    ├── app.js                      Toda la lógica frontend
    └── styles.css                  Mobile-first dark theme
```

---

## Roadmap / TODO

Marcados como `// TODO` en el código:

- [ ] **Crawler 3 capas** — `search_queue` + `/api/crawl` para explorar videos relacionados
- [ ] **Cron cada 6h** — crecer el corpus automáticamente en background
- [ ] **Densidad por subtítulos** — Workers AI analiza el transcript y da un `density score`
- [ ] **MMR** — diversidad en el ranking (Maximal Marginal Relevance)
- [ ] **Perfil leído desde el Worker** — en vez de recibir pesos del cliente (más robusto)
- [ ] **Estados avanzados** — historial de reproducción, notas en videos

---

## Licencia

MIT — úsalo, forkéalo, mejóralo.
