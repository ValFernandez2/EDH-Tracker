import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDLVNJech2-zMA1GFTZUyxMJkT_kroTGkw",
  authDomain: "edh-tracker-e1f40.firebaseapp.com",
  projectId: "edh-tracker-e1f40",
  storageBucket: "edh-tracker-e1f40.firebasestorage.app",
  messagingSenderId: "218739798665",
  appId: "1:218739798665:web:084ed4de5ecf3d949acc58"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

window._db = db;

export async function loadFromCloud() {
  try {
    const ref = doc(db, "edh", "main");
    const snap = await getDoc(ref);

    if (snap.exists()) {
      return snap.data();
    }

    return null;
  } catch (e) {
    console.error("Error cargando:", e);
    return null;
  }
}

export async function saveToCloud(DB) {
  try {
    await setDoc(doc(db, "edh", "main"), DB);
  } catch (e) {
    console.error("Error guardando:", e);
  }
  }