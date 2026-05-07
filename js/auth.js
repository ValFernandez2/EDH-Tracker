import {
  registerUser, loginUser, logoutUser, onAuthChange,
  getUserProfile, getUserPlaygroups,
  createPlaygroup, joinPlaygroup,
  loadPlaygroupData, savePlaygroupData,
  loadUserDecks, saveUserDeck, deleteUserDeck,
  loadLegacyData
} from "./firebase.js";

// ── Estado global de sesión ───────────────────────────────────────────────────
window.AUTH = {
  user:       null,   // Firebase user object
  profile:    null,   // Firestore user doc
  playgroups: [],     // todos los playgroups del usuario
  pgId:       null,   // playgroup activo (puede ser null = vista personal)
};

// ── Boot ──────────────────────────────────────────────────────────────────────
onAuthChange(async (user) => {
  if (user) {
    await bootAuthenticated(user);
  } else {
    showAuthScreen();
  }
});

async function bootAuthenticated(user) {
  window.AUTH.user     = user;
  window.AUTH.profile  = await getUserProfile(user.uid);
  window.AUTH.playgroups = await getUserPlaygroups(user.uid);

  // Restore last used playgroup from localStorage
  const savedPg = localStorage.getItem('lastPgId');

  let validPg = AUTH.playgroups.find(pg => pg.id === savedPg);

  // 👉 si no existe, agarrar uno válido
  if (!validPg && AUTH.playgroups.length) {
    validPg = AUTH.playgroups[0];
  }

window.AUTH.pgId = validPg ? validPg.id : null;

  hideAuthScreen();
  updateHeader();

  // Notify app.js to load data
  if (window.__appBoot) await window.__appBoot();
}

// ── Header ────────────────────────────────────────────────────────────────────
function updateHeader() {
  const el = document.getElementById('header-user');
  if (!el) return;
  const name = AUTH.user?.displayName || AUTH.user?.email || '';
  el.innerHTML = `
    <span style="font-size:12px;color:var(--text-sub);letter-spacing:0.04em;">${name}</span>
    <button class="btn btn-sm" onclick="window.__logout()">Salir</button>
  `;
}

window.__logout = async () => {
  if (!confirm('¿Cerrar sesión?')) return;
  localStorage.removeItem('lastPgId');
  await logoutUser();
};

// ── Auth screen ───────────────────────────────────────────────────────────────
function showAuthScreen() {
  document.getElementById('app-shell').style.display = 'none';
  let el = document.getElementById('auth-screen');
  if (!el) {
    el = document.createElement('div');
    el.id = 'auth-screen';
    document.body.appendChild(el);
  }
  el.style.display = 'flex';
  renderAuthScreen(el, 'login');
}

function hideAuthScreen() {
  const el = document.getElementById('auth-screen');
  if (el) el.style.display = 'none';
  document.getElementById('app-shell').style.display = '';
}

function renderAuthScreen(el, mode) {
  const isLogin = mode === 'login';
  el.innerHTML = `
    <div class="auth-card">
      <div class="auth-logo">
        <div class="auth-title">Commander Tracker</div>
        <div class="auth-sub">Tu historial de EDH</div>
      </div>

      <div class="auth-tabs">
        <button class="auth-tab${isLogin ? ' active' : ''}" onclick="window.__authMode('login')">Iniciar sesión</button>
        <button class="auth-tab${!isLogin ? ' active' : ''}" onclick="window.__authMode('register')">Registrarse</button>
      </div>

      ${!isLogin ? `
        <div class="form-group">
          <label>Nombre</label>
          <input type="text" id="auth-name" placeholder="Tu nombre de jugador">
        </div>
      ` : ''}

      <div class="form-group">
        <label>Email</label>
        <input type="email" id="auth-email" placeholder="tu@email.com" autocomplete="email">
      </div>
      <div class="form-group">
        <label>Contraseña</label>
        <input type="password" id="auth-pass" placeholder="••••••••" autocomplete="${isLogin ? 'current-password' : 'new-password'}">
      </div>

      <div id="auth-error" class="auth-error" style="display:none;"></div>

      <button class="btn btn-gold" style="width:100%;margin-top:4px;" onclick="window.__authSubmit('${mode}')">
        ${isLogin ? 'Entrar' : 'Crear cuenta'}
      </button>
    </div>
  `;

  // Enter key support
  setTimeout(() => {
    el.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') window.__authSubmit(mode); });
    });
  }, 0);
}

window.__authMode = (mode) => {
  const el = document.getElementById('auth-screen');
  renderAuthScreen(el, mode);
};

window.__authSubmit = async (mode) => {
  const email = document.getElementById('auth-email')?.value.trim();
  const pass  = document.getElementById('auth-pass')?.value;
  const name  = document.getElementById('auth-name')?.value.trim();
  const errEl = document.getElementById('auth-error');

  const showErr = (msg) => { errEl.textContent = msg; errEl.style.display = 'block'; };
  errEl.style.display = 'none';

  if (!email || !pass) return showErr('Completá todos los campos.');
  if (mode === 'register' && !name) return showErr('Ingresá tu nombre.');

  try {
    if (mode === 'register') {
      await registerUser(email, pass, name);
    } else {
      await loginUser(email, pass);
    }
    // onAuthChange fires and handles the rest
  } catch(e) {
    const msgs = {
      'auth/email-already-in-use': 'Ese email ya está registrado.',
      'auth/invalid-email': 'Email inválido.',
      'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
      'auth/user-not-found': 'No existe una cuenta con ese email.',
      'auth/wrong-password': 'Contraseña incorrecta.',
      'auth/invalid-credential': 'Email o contraseña incorrectos.',
    };
    showErr(msgs[e.code] || e.message);
  }
};

// ── Playgroup screen ──────────────────────────────────────────────────────────
export function showPlaygroupScreen() {
  const pgs = AUTH.playgroups;
  let el = document.getElementById('pg-screen');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pg-screen';
    document.body.appendChild(el);
  }
  el.style.display = 'flex';
  el.innerHTML = `
    <div class="auth-card" style="max-width:480px;">
      <div class="auth-title" style="margin-bottom:4px;">Tus Playgroups</div>
      <div style="font-size:12px;color:var(--text-sub);margin-bottom:16px;">Elegí un grupo para ver su historial, o creá uno nuevo.</div>

      ${pgs.length ? `
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">
          ${pgs.map(pg => `
            <div class="pg-card${AUTH.pgId === pg.id ? ' active' : ''}" onclick="window.__selectPg('${pg.id}')">
              <div style="font-size:14px;font-weight:600;">${pg.name}</div>
              <div style="font-size:11px;color:var(--text-sub);">
                ${Object.keys(pg.members || {}).length} miembro${Object.keys(pg.members || {}).length !== 1 ? 's' : ''}
                · Código: <span style="color:var(--gold);letter-spacing:0.08em;">${pg.code}</span>
              </div>
            </div>
          `).join('')}
        </div>
      ` : `<div class="empty-state" style="margin-bottom:16px;">Todavía no pertenecés a ningún playgroup.</div>`}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div class="card-box" style="padding:12px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-sub);margin-bottom:8px;">Crear nuevo</div>
          <input type="text" id="pg-create-name" placeholder="Nombre del grupo" style="margin-bottom:8px;">
          <button class="btn btn-gold" style="width:100%;" onclick="window.__createPg()">Crear</button>
        </div>
        <div class="card-box" style="padding:12px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-sub);margin-bottom:8px;">Unirse con código</div>
          <input type="text" id="pg-join-code" placeholder="Ej: A1B2C3" maxlength="6" style="margin-bottom:8px;text-transform:uppercase;letter-spacing:0.1em;">
          <button class="btn btn-gold" style="width:100%;" onclick="window.__joinPg()">Unirse</button>
        </div>
      </div>

      <div id="pg-error" class="auth-error" style="display:none;margin-top:10px;"></div>

      ${pgs.length ? `<button class="btn" style="width:100%;margin-top:12px;" onclick="window.__closePgScreen()">Cerrar</button>` : ''}
    </div>
  `;
}

window.__selectPg = (pgId) => {
  window.AUTH.pgId = pgId;
  localStorage.setItem('lastPgId', pgId);
  hidePgScreen();
  if (window.__appLoadPlaygroup) window.__appLoadPlaygroup(pgId);
};

window.__closePgScreen = () => hidePgScreen();

function hidePgScreen() {
  const el = document.getElementById('pg-screen');
  if (el) el.style.display = 'none';
}

window.__createPg = async () => {
  const name = document.getElementById('pg-create-name')?.value.trim();
  const errEl = document.getElementById('pg-error');
  errEl.style.display = 'none';
  if (!name) { errEl.textContent = 'Ingresá un nombre.'; errEl.style.display = 'block'; return; }
  try {
    const pg = await createPlaygroup(name, AUTH.user.uid, AUTH.user.displayName || AUTH.user.email);
    AUTH.playgroups.push(pg);
    window.__selectPg(pg.id);
  } catch(e) {
    errEl.textContent = e.message; errEl.style.display = 'block';
  }
};

window.__joinPg = async () => {
  const code  = document.getElementById('pg-join-code')?.value.trim();
  const errEl = document.getElementById('pg-error');
  errEl.style.display = 'none';
  if (!code) { errEl.textContent = 'Ingresá el código.'; errEl.style.display = 'block'; return; }
  try {
    const pg = await joinPlaygroup(code, AUTH.user.uid, AUTH.user.displayName || AUTH.user.email);
    AUTH.playgroups.push(pg);
    window.__selectPg(pg.id);
  } catch(e) {
    errEl.textContent = e.message; errEl.style.display = 'block';
  }
};

// ── Data helpers (used by app.js) ─────────────────────────────────────────────

export async function loadAppData() {
  const myUid = AUTH.user?.uid;
  const pgId  = AUTH.pgId;

  // Load playgroup data if one is selected
  let pgData = { matches: [], tournaments: [], sessions: [], decks: [] };
  if (pgId) pgData = await loadPlaygroupData(pgId);

  // Build players list from playgroup members
  const pg = AUTH.playgroups.find(p => p.id === pgId);
  const players = pg
    ? Object.entries(pg.members || {}).map(([memberId, m]) => ({ id: memberId, name: m.displayName }))
    : [{ id: myUid, name: AUTH.user?.displayName || 'Yo' }];

  // Load decks: start with any decks stored in the playgroup data (migrated/shared)
  let decks = pgData.decks ? [...pgData.decks] : [];

  // Load current user's own decks from their subcollection
  const myDecks = myUid ? await loadUserDecks(myUid) : [];

  // Merge: user's own decks take priority (overwrite by id if already in pg decks)
  // Also load decks from other real members that are shared with this pg
  const deckMap = new Map(decks.map(d => [d.id, d]));
  myDecks
  .filter(d => (d.sharedWith || []).includes(pgId) || !pgId)
  .forEach(d => deckMap.set(d.id, d));

  // For each real (non-guest) member, load their decks shared with this pg
  if (pg) {
    const realMembers = Object.entries(pg.members || {})
      .filter(([memberId, m]) => !m.isGuest && memberId !== myUid);
    for (const [memberId] of realMembers) {
      try {
        const memberDecks = await loadUserDecks(memberId);
        memberDecks
          .filter(d => (d.sharedWith || []).includes(pgId))
          .forEach(d => deckMap.set(d.id, d));
      } catch(e) { /* member may have restricted access */ }
    }
  }

  decks = Array.from(deckMap.values());

  return {
    players,
    decks,
    matches:     pgData.matches     || [],
    tournaments: pgData.tournaments || [],
    sessions:    pgData.sessions    || [],
  };
}

export async function saveAppData(DB) {
  const uid  = AUTH.user?.uid;
  const pgId = AUTH.pgId;

  // Save current user's own decks to their subcollection
  if (uid) {
    for (const deck of DB.decks) {
      if (deck.playerId === uid) await saveUserDeck(uid, deck);
    }
  }

  // Save playgroup data
  if (pgId) {
  // Guests van siempre al pg (no tienen subcollection propia)
  const decksForPg = (DB.decks || []).filter(d =>
    d.playerId?.startsWith('guest_') ||
    (d.playerId === uid && (d.sharedWith || []).includes(pgId))
  );

    await savePlaygroupData(pgId, {
      matches:     DB.matches     || [],
      tournaments: DB.tournaments || [],
      sessions:    DB.sessions    || [],
      decks:       decksForPg,
    });
  }
}


export async function deleteAppDeck(deckId) {
  const uid = AUTH.user?.uid;
  if (uid) await deleteUserDeck(uid, deckId);
}

export { loadUserDecks, saveUserDeck };
