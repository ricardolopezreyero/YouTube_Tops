/**
 * firebase-config.js
 * Configuración pública del SDK de Firebase para el frontend.
 * La apiKey es pública por diseño — la seguridad la dan Firestore Rules + JWT en el Worker.
 */

import { initializeApp }          from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithRedirect,
         getRedirectResult, onAuthStateChanged, signOut }
                                   from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp }
                                   from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey:            'AIzaSyB2Y2b4oHG45B3BTkm8xrcqX50ZuFWammk',
  authDomain:        'tops-b68a3.firebaseapp.com',
  projectId:         'tops-b68a3',
  storageBucket:     'tops-b68a3.firebasestorage.app',
  messagingSenderId: '673811580036',
  appId:             '1:673811580036:web:c3cf20e41b01ea465e2ed1',
  measurementId:     'G-W79XM63E33',
};

const app = initializeApp(firebaseConfig);

export const auth           = getAuth(app);
export const db             = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

export {
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
};
