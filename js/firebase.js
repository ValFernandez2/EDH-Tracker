import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc, setDoc, getDoc, updateDoc,
  collection, getDocs, query, where, serverTimestamp, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDLVNJech2-zMA1GFTZUyxMJkT_kroTGkw",
  authDomain: "edh-tracker-e1f40.firebaseapp.com",
  projectId: "edh-tracker-e1f40",
  storageBucket: "edh-tracker-e1f40.firebasestorage.app",
  messagingSenderId: "218739798665",
  appId: "1:218739798665:web:084ed4de5ecf3d949acc58"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function registerUser(email, password, displayName) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName });
  await setDoc(doc(db, "users", cred.user.uid), {
    displayName,
    email,
    createdAt: serverTimestamp(),
    playgroupIds: []
  });
  return cred.user;
}

export async function loginUser(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function logoutUser() {
  await signOut(auth);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

export function currentUser() {
  return auth.currentUser;
}

// ── User profile ──────────────────────────────────────────────────────────────

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? { uid, ...snap.data() } : null;
}

async function getUserPlaygroupIds(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? (snap.data().playgroupIds || []) : [];
}

// ── Playgroups ────────────────────────────────────────────────────────────────

export async function createPlaygroup(name, uid, displayName) {
  const ref  = doc(collection(db, "playgroups"));
  const code = ref.id.slice(0, 6).toUpperCase();
  await setDoc(ref, {
    name,
    code,
    createdBy: uid,
    createdAt: serverTimestamp(),
    members: {
      [uid]: { displayName, role: "admin", joinedAt: serverTimestamp() }
    }
  });
  const ids = await getUserPlaygroupIds(uid);
  await updateDoc(doc(db, "users", uid), { playgroupIds: [...ids, ref.id] });
  return { id: ref.id, name, code };
}

export async function joinPlaygroup(code, uid, displayName) {
  const q    = query(collection(db, "playgroups"), where("code", "==", code.toUpperCase()));
  const snap = await getDocs(q);
  if (snap.empty) throw new Error("Código inválido — no se encontró ningún playgroup.");
  const pgDoc = snap.docs[0];
  const pgId  = pgDoc.id;
  const pg    = pgDoc.data();
  if (pg.members && pg.members[uid]) throw new Error("Ya sos miembro de este playgroup.");
  await updateDoc(doc(db, "playgroups", pgId), {
    [`members.${uid}`]: { displayName, role: "member", joinedAt: serverTimestamp() }
  });
  const ids = await getUserPlaygroupIds(uid);
  await updateDoc(doc(db, "users", uid), { playgroupIds: [...ids, pgId] });
  return { id: pgId, name: pg.name, code: pg.code };
}

export async function getPlaygroup(pgId) {
  const snap = await getDoc(doc(db, "playgroups", pgId));
  return snap.exists() ? { id: pgId, ...snap.data() } : null;
}

export async function getUserPlaygroups(uid) {
  const db = getFirestore();

  // 1. Traer el user
  const userSnap = await getDoc(doc(db, "users", uid));
  if (!userSnap.exists()) return [];

  const data = userSnap.data();
  const ids = data.playgroupIds || [];

  if (!ids.length) return [];

  // 2. Traer cada playgroup
  const snaps = await Promise.all(
    ids.map(id => getDoc(doc(db, "playgroups", id)))
  );

  // 3. Filtrar los que existen
  const playgroups = snaps
    .filter(s => s.exists())
    .map(s => ({
      id: s.id,
      ...s.data()
    }));

  return playgroups;
}

export async function leavePlaygroup(pgId, uid) {
  // Remove member from playgroup
  const pgRef = doc(db, "playgroups", pgId);
  const pgSnap = await getDoc(pgRef);
  if (!pgSnap.exists()) throw new Error("Playgroup no encontrado.");
  const pg = pgSnap.data();
  if (!pg.members?.[uid]) throw new Error("No sos miembro de este playgroup.");
  if (pg.createdBy === uid && Object.keys(pg.members).length > 1)
    throw new Error("Sos el admin — transferí el rol antes de salir.");
  // Remove from members map
  const updatedMembers = { ...pg.members };
  delete updatedMembers[uid];
  await updateDoc(pgRef, { members: updatedMembers });
  // Remove from user's list
  const ids = await getUserPlaygroupIds(uid);
  await updateDoc(doc(db, "users", uid), { playgroupIds: ids.filter(id => id !== pgId) });
}

// ── Per-playgroup match/tournament data ───────────────────────────────────────
// playgroups/{pgId}/data/main  →  { matches, tournaments, sessions }

function pgDataRef(pgId) {
  return doc(db, "playgroups", pgId, "data", "main");
}

export async function loadPlaygroupData(pgId) {
  if (!pgId) {
    return { matches: [], tournaments: [], sessions: [] };
  }

  try {
    const snap = await getDoc(pgDataRef(pgId));
    return snap.exists()
      ? snap.data()
      : { matches: [], tournaments: [], sessions: [] };
  } catch (e) {
    console.warn("⚠️ Error loading playgroup:", pgId, e);

    // 🔥 resetear estado roto
    localStorage.removeItem('lastPgId');
    if (window.AUTH) window.AUTH.pgId = null;

    return { matches: [], tournaments: [], sessions: [] };
  }
}

export async function savePlaygroupData(pgId, data) {
  await setDoc(pgDataRef(pgId), data);
}

// ── User decks (owned by user, shared to playgroups) ─────────────────────────
// users/{uid}/decks/{deckId}

export async function loadUserDecks(uid) {
  const snap = await getDocs(collection(db, "users", uid, "decks"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function saveUserDeck(uid, deck) {
  await setDoc(doc(db, "users", uid, "decks", deck.id), deck);
}

export async function deleteUserDeck(uid, deckId) {
  await deleteDoc(doc(db, "users", uid, "decks", deckId));
}

// ── Legacy migration ──────────────────────────────────────────────────────────

export async function loadLegacyData() {
  try {
    const snap = await getDoc(doc(db, "edh", "main"));
    return snap.exists() ? snap.data() : null;
  } catch(e) { return null; }
}