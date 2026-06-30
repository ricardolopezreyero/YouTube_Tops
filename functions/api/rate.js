// functions/api/rate.js
// POST /api/rate -> densidad por subtitulos.
// TODO (Roadmap, fase de densidad): bajar transcript, muestrear, Workers AI
// (@cf/meta/llama-3.1-8b-instruct) devuelve {density 0-100, verdict}, cachear en
// subtitle_ratings y exponer un modo "Densidad". NO implementado en el MVP.

import { json } from "../../src/lib/http.js";

export async function onRequestPost() {
  return json(
    {
      error: "no implementado",
      roadmap: "La densidad por subtitulos es parte del Roadmap (fase posterior).",
    },
    501
  );
}
