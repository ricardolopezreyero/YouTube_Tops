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
// Reemplaza apiKey y appId con los valores reales de tu proyecto Firebase.
// Los demás valores se derivan del projectId "tops-b68a3".
const firebaseConfig = {
  apiKey:            'REPLACE_WITH_FIREBASE_WEB_API_KEY',   // ← reemplazar
  authDomain:        'tops-b68a3.firebaseapp.com',
  projectId:         'tops-b68a3',
  storageBucket:     'tops-b68a3.appspot.com',
  messagingSenderId: '673811580836',
  appId:             'REPLACE_WITH_FIREBASE_APP_ID',        // ← reemplazar
};

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
