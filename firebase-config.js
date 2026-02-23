// Firebase configuration — reuses fran-farbs-food project
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyA_IojcmA6PK39zA7V0TORkXcwXmrKsYn8",
  authDomain: "fran-farbs-food.firebaseapp.com",
  projectId: "fran-farbs-food",
  storageBucket: "fran-farbs-food.firebasestorage.app",
  messagingSenderId: "235791975194",
  appId: "1:235791975194:web:5ddf3a904406622f05a2a3"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

let currentUser = null;
let unsubscribeSnapshot = null;
let onUserChanged = null;

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    startDataSync(user.uid);
  } else {
    if (unsubscribeSnapshot) {
      unsubscribeSnapshot();
      unsubscribeSnapshot = null;
    }
  }
  if (onUserChanged) onUserChanged(user);
});

export async function signInWithGoogle() {
  try {
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (error) {
    console.error('Sign in error:', error);
    throw error;
  }
}

export async function signOutUser() {
  try {
    await signOut(auth);
  } catch (error) {
    console.error('Sign out error:', error);
    throw error;
  }
}

export function getCurrentUser() {
  return currentUser;
}

export function setAuthStateCallback(callback) {
  onUserChanged = callback;
  if (currentUser) callback(currentUser);
}

function startDataSync(uid) {
  // Store planner data under a separate namespace in Firestore
  const docRef = doc(db, 'substackPlanner', uid);
  unsubscribeSnapshot = onSnapshot(docRef, (snap) => {
    if (snap.exists() && window.onCloudDataReceived) {
      window.onCloudDataReceived(snap.data());
    }
  }, (error) => {
    console.error('Firestore sync error:', error);
  });
}

export async function saveToCloud(data) {
  if (!currentUser) return false;
  try {
    const docRef = doc(db, 'substackPlanner', currentUser.uid);
    await setDoc(docRef, {
      ...data,
      updatedAt: new Date().toISOString(),
      email: currentUser.email
    }, { merge: true });
    return true;
  } catch (error) {
    console.error('Error saving to cloud:', error);
    return false;
  }
}

export async function loadFromCloud() {
  if (!currentUser) return null;
  try {
    const docRef = doc(db, 'substackPlanner', currentUser.uid);
    const snap = await getDoc(docRef);
    return snap.exists() ? snap.data() : null;
  } catch (error) {
    console.error('Error loading from cloud:', error);
    return null;
  }
}

export { auth, db };
