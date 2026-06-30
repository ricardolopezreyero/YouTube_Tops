/**
 * auth.js – Verificación de Firebase ID tokens (JWT RS256) en Workers runtime.
 * Usa Web Crypto API (disponible en Cloudflare Workers).
 * No depende de ningún SDK externo.
 */

const GOOGLE_JWK_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

function base64UrlToBytes(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded  = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary  = atob(padded);
  const bytes   = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function parseJWT(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('JWT malformado: se esperaban 3 partes');
  const dec = new TextDecoder();
  return {
    header:         JSON.parse(dec.decode(base64UrlToBytes(parts[0]))),
    payload:        JSON.parse(dec.decode(base64UrlToBytes(parts[1]))),
    signingInput:   `${parts[0]}.${parts[1]}`,
    signatureBytes: base64UrlToBytes(parts[2]),
  };
}

export async function verifyFirebaseToken(token, projectId) {
  const { header, payload, signingInput, signatureBytes } = parseJWT(token);

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now)         throw new Error('Token expirado');
  if (!payload.iat || payload.iat > now + 300)   throw new Error('Token emitido en el futuro');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`)
                                                  throw new Error('Issuer inválido');
  if (payload.aud !== projectId)                  throw new Error('Audience inválido');
  if (!payload.sub)                               throw new Error('Subject (uid) ausente');

  const keysRes = await fetch(GOOGLE_JWK_URL, {
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  if (!keysRes.ok) throw new Error('No se pudieron obtener las claves públicas de Google');
  const { keys } = await keysRes.json();

  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error(`kid "${header.kid}" no encontrado en las claves públicas`);

  const cryptoKey = await crypto.subtle.importKey(
    'jwk', jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } },
    false, ['verify'],
  );

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', cryptoKey, signatureBytes,
    new TextEncoder().encode(signingInput),
  );
  if (!valid) throw new Error('Firma JWT inválida');

  return payload;
}

export async function requireAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer '))
    throw new Error('Authorization header ausente o mal formado');
  const token     = authHeader.slice(7).trim();
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID no configurado en el Worker');
  return verifyFirebaseToken(token, projectId);
}
