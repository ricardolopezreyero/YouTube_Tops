# 🎯 YouTube Tops

### **[→ Abrir la app: youtube-tops.pages.dev](https://youtube-tops.pages.dev)**

> *Los mejores videos de YouTube según tu perfil. Sin el algoritmo de retención.*

---

## El problema con YouTube normal

YouTube está diseñado para **maximizar el tiempo que pasas en la app**, no lo que aprendes. Su algoritmo premia:

- Videos cortos que generan ansiedad y te hacen seguir scrolleando
- Clickbait que sube el CTR aunque el contenido no valga nada
- Tendencias virales que no tienen nada que ver con lo que tú necesitas
- El mismo feed para todos — no importa si eres developer, consultor o emprendedor

El resultado: acabas viendo cosas que no pediste, sin recordar por qué empezaste.

---

## Qué hace YouTube Tops diferente

**Un algoritmo propio, transparente y personalizado para ti.**

En lugar de optimizar tu tiempo de pantalla, YouTube Tops rankea cada video con 6 factores que miden calidad real:

| Factor | Qué mide | Por qué importa |
|---|---|---|
| **Engagement real** | Ratio likes/vistas + comentarios, penalizando viralidad vacía | Un video con 50K vistas y 5% de likes supera a uno viral con 0.5% |
| **Relevancia personal** | Qué tanto coincide el video con tus temas de interés | Solo ves contenido alineado con lo que tú declaras, no lo que el algoritmo supone |
| **Profundidad** | Presencia de capítulos, terminología técnica, estructura | Favorece masterclasses y tutoriales densos sobre videos superficiales |
| **Duración** | Sweet spot de 8–60 min | Filtra clips de 90 segundos y maratones de 4 horas sin estructura |
| **Subtítulos** | Tiene CC disponible | Señal de producción profesional y accesibilidad |
| **Autoridad del canal** | Tamaño del canal (log₁₀, cap en 10M subs) | Da crédito a canales establecidos sin ignorar canales pequeños de calidad |

**Tú controlas los pesos.** Si hoy quieres profundidad, sube ese slider. Si tienes 15 minutos libres, activa el modo Quick wins. El algoritmo no cambia solo — cambia cuando tú decides.

---

## Funcionalidades principales

**🏆 Feed personalizado**
Cada video tiene un score visible. Al hacer hover ves exactamente por qué rankeó donde rankeó — sin cajas negras.

**⏱ Mi Sesión**
"Tengo 30 minutos." La app arma automáticamente una playlist que cabe exactamente en tu ventana de tiempo, eligiendo los mejores videos del corpus en ese rango.

**📋 Listas inteligentes**
Guarda videos para después, agrupa por tema, reordena. La IA crea 3 listas personalizadas desde el día uno según tu perfil.

**🔍 Feedback que aprende**
Cada video que abres sube en tu ranking personal. Lo que descartas con ✕ desaparece para siempre. Con el tiempo, tu feed se afina solo.

**🎯 Filtros de duración**
Un clic filtra el feed por duración: <15 min / 15–30 / 30–60 / >60 min. Decide según tu energía del momento.

**➕ Agregar por URL**
¿Encontraste un video en otro lado? Pégalo y queda en tu sistema, rankeado con el mismo algoritmo.

---

## Cómo funciona (sin tecnicismos)

1. **Describes quién eres** en una caja de texto — a qué te dedicas, qué quieres aprender, qué odias ver
2. **La IA procesa eso** y genera tus keywords de interés y 3 listas personalizadas
3. **El sistema busca** los mejores videos del corpus que coincidan con tu perfil
4. **Ves tu feed personalizado** — rankeado por calidad real, no por retención
5. **Con cada interacción** el feed se afina: clics suben el score, descartes lo limpian

---

## Setup rápido (para correrlo tú mismo)

### Prerrequisitos
- Node.js ≥ 18
- Cuenta Cloudflare (gratis)
- Proyecto Firebase (gratis)
- YouTube Data API v3 key (gratis, 10K unidades/día)

### Variables necesarias

Archivo `.dev.vars` en la raíz:
```
YOUTUBE_API_KEY=tu_clave_aqui
```

Secret en Cloudflare (una vez):
```bash
npx wrangler secret put YOUTUBE_API_KEY
```

Secret en GitHub → Settings → Secrets:
```
CLOUDFLARE_API_TOKEN = tu_token_cloudflare
```

### Inicializar la base de datos

```bash
# Crear schema
npx wrangler d1 migrations apply youtube_tops --remote

# Poblar con videos iniciales (~1000 unidades de cuota YouTube)
npm run seed
```

### Deploy

```bash
# Manual (primera vez)
npm run deploy

# Automático: cada push a main dispara GitHub Actions
git push origin main
```

---

## Stack (para los curiosos)

Cloudflare Pages + D1 + KV + Workers AI · Firebase Auth + Firestore · YouTube Data API v3 · Vanilla JS sin bundler

---

### **[→ Abrir la app: youtube-tops.pages.dev](https://youtube-tops.pages.dev)**

*Hecho por RLR · 2026*
