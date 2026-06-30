/**
 * firebase-config.js
 * Configuración pública del SDK de Firebase para el frontend.
 *
 * IMPORTANTE: Reemplaza los valores marcados con REPLACE_WITH_...
 * Los puedes encontrar en:
 *   Firebase Console → Configuración del proyecto → Tus apps → App web → Configuración
 *
 * La apiKey de Firebase Web es PÚBLICA por diseño: sólo identifica tu proyecto,
 * no otorga permisos. La seguridad la garantizan Firestore Rules y el JWT del Worker.
 */

import { initializeApp }          from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut }
                                   from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp }
                                   from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ─── Configuración de la app web de Firebase ─────────────────────────────────
// TODO (usuario): Reemplaza apiKey y appId con los valores reales.
//
// Cómo obtenerlos (30 segundos):
//   1. Ve a https://console.firebase.google.com/project/tops-b68a3/settings/general
//   2. Baja a "Tus apps" → sección Web (icono </>)
//      Si no hay ninguna app web, haz clic en "Agregar app" → Web → registra.
//   3. Copia el objeto firebaseConfig que aparece ahí.
//   4. Reemplaza los dos valores de abajo y haz deploy:
//        npx wrangler pages deploy public --project-name=youtube-tops
//
// Los demás valores (projectId, messagingSenderId, etc.) ya están correctos.
const firebaseConfig = {
  apiKey:            'REPLACE_WITH_FIREBASE_WEB_API_KEY',   // ← único paso manual
  authDomain:        'tops-b68a3.firebaseapp.com',
  projectId:         'tops-b68a3',
  storageBucket:     'tops-b68a3.appspot.com',
  messagingSenderId: '673811580836',
  appId:             'REPLACE_WITH_FIREBASE_APP_ID',        // ← único paso manual
};

// Muestra pantalla de configuración si los placeholders no se han reemplazado
if (firebaseConfig.apiKey.startsWith('REPLACE_') || firebaseConfig.appId.startsWith('REPLACE_')) {
  document.addEventListener('DOMContentLoaded', () => {
    document.body.innerHTML = `
      <div style="font-family:system-ui;max-width:600px;margin:60px auto;padding:2rem;background:#1a1a1a;color:#f0f0f0;border-radius:12px;border:1px solid rgba(255,65,54,.4)">
        <h2 style="color:#FF4136;margin:0 0 1rem">⚙️ Configuración pendiente: Firebase</h2>
        <p>La app está <strong>desplegada y con 77 videos en D1</strong>. Solo falta configurar Firebase Auth.</p>
        <hr style="border-color:rgba(255,255,255,.1);margin:1rem 0">
        <ol style="line-height:2">
          <li>Ve a <a href="https://console.firebase.google.com/project/tops-b68a3/settings/general" target="_blank" style="color:#FF4136">Firebase Console → tops-b68a3 → Configuración</a></li>
          <li>Baja a <strong>"Tus apps"</strong> → sección Web (<code>&lt;/&gt;</code>)<br>
              Si no hay app web: <strong>Agregar app → Web</strong> → registra con cualquier nombre</li>
          <li>Copia <code>apiKey</code> y <code>appId</code> del <code>firebaseConfig</code></li>
          <li>Edita <code>public/firebase-config.js</code> y pega los valores</li>
          <li>Re-despliega:<br>
              <code style="background:#111;padding:.4rem .8rem;border-radius:4px;display:inline-block;margin-top:.4rem">
                npx wrangler pages deploy public --project-name=youtube-tops
              </code>
          </li>
        </ol>
        <p style="color:#a0a0a0;font-size:.875rem;margin-top:1rem">
          También agrega <strong>https://youtube-tops.pages.dev</strong> a los dominios autorizados en 
          <a href="https://console.firebase.google.com/project/tops-b68a3/authentication/settings" target="_blank" style="color:#FF4136">Firebase Auth → Configuración → Dominios autorizados</a>
        </p>
      </div>`;
  });
  throw new Error('Firebase config pendiente — reemplaza apiKey y appId en public/firebase-config.js');
}

const app = initializeApp(firebaseConfig);

export const auth           = getAuth(app);
export const db             = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

// Re-exporta helpers para que app.js los use directamente
export {
  signInWithPopup,
  onAuthStateChanged,
  signOut,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
};
