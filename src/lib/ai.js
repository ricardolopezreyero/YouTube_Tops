// src/lib/ai.js
// TODO (fase posterior - NO en el MVP): densidad de contenido por subtitulos.
//
// Plan:
//   1. Tras cargar un video, bajar su transcript (timedtext / libreria) con
//      fallback si las IPs de Workers estan bloqueadas para timedtext.
//   2. Muestrear el transcript (no enviarlo entero) para ahorrar tokens.
//   3. Pedir a Workers AI ("@cf/meta/llama-3.1-8b-instruct") un veredicto:
//        { density: 0-100, verdict: "una linea" }
//   4. Guardar permanentemente en la tabla subtitle_ratings (cache).
//   5. Mostrar un badge de densidad en la tarjeta + un modo "Densidad" que
//      reordena por esa nota.
//
// Firma prevista (todavia sin implementar):
//
// export async function rateDensity(AI, transcriptSample) {
//   const prompt = `Evalua la densidad de contenido (0-100) de esta transcripcion...`;
//   const res = await AI.run("@cf/meta/llama-3.1-8b-instruct", {
//     messages: [{ role: "user", content: prompt }],
//   });
//   return parseDensityResponse(res);
// }

export const DENSITY_MODEL = "@cf/meta/llama-3.1-8b-instruct";

export async function rateDensity(/* AI, transcriptSample */) {
  // TODO: implementar en la fase de densidad.
  throw new Error("rateDensity() es parte del Roadmap (fase de densidad por subtitulos).");
}
