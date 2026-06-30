/**
 * auth.js – Verificación de Firebase ID tokens (JWT RS256) en Workers runtime.
 * Usa Web Crypto API (disponible en Cloudflare Workers).
 * No depende de ningún SDK externo.
 */

const GOOGLE_JWK_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

/** Decodifica base64url → Uint8Array */
function base64UrlToBytes(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Parsea las tres partes del JWT */
function parseJWT(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('JWT malformado: se esperaban 3 partes');

  const headerBytes  = base64UrlToBytes(parts[0]);
  const payloadBytes = base64UrlToBytes(parts[1]);
  const dec = new TextDecoder();

  return {
    header:       JSON.parse(dec.decode(headerBytes)),
    payload:      JSON.parse(dec.decode(payloadBytes)),
    signingInput: `${parts[0]}.${parts[1]}`,
    signatureBytes: base64UrlToBytes(parts[2]),
  };
}

/**
 * Verifica un Firebase ID token y devuelve el payload si es válido.
 * Lanza un Error descriptivo en caso contrario.
 */
export async function verifyFirebaseToken(token, projectId) {
  const { header, payload, signingInput, signatureBytes } = parseJWT(token);

  // ── Validaciones de claims ──────────────────────────────────────────────────
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now)           throw new Error('Token expirado');
  if (!payload.iat || payload.iat > now + 300)     throw new Error('Token emitido en el futuro');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`)
                                                    throw new Error('Issuer inválido');
  if (payload.aud !== projectId)                    throw new Error('Audience inválido');
  if (!payload.sub)                                 throw new Error('Subject (uid) ausente');

  // ── Obtener claves públicas de Google (cacheadas por CF) ───────────────────
  const keysRes = await fetch(GOOGLE_JWK_URL, {
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  if (!keysRes.ok) throw new Error('No se pudieron obtener las claves públicas de Google');
  const { keys } = await keysRes.json();

  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error(`kid "${header.kid}" no encontrado en las claves públicas`);

  // ── Importar clave y verificar firma ───────────────────────────────────────
  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } },
    false,
    ['verify'],
  );

  const encoder  = new TextEncoder();
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    signatureBytes,
    encoder.encode(signingInput),
  );

  if (!valid) throw new Error('Firma JWT inválida');

  return payload;
}

/**
 * Helper para endpoints protegidos.
 * Lee el header Authorization: Bearer <token>, verifica y devuelve el payload.
 * Lanza Error si falta o es inválido.
 */
export async function requireAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    throw new Error('Authorization header ausente o mal formado');
  }
  const token = authHeader.slice(7).trim();
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID no configurado en el Worker');
  return verifyFirebaseToken(token, projectId);
}
