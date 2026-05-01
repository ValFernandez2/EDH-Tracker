import { loadFromCloud, saveToCloud } from "./firebase.js";

window.DB = { players: [], decks: [], matches: [], tournaments: [] };
if(!DB.players) DB.players = [];
if(!DB.decks) DB.decks = [];
if(!DB.matches) DB.matches = [];
if(!DB.tournaments) DB.tournaments = [];

function save() {
  console.log("Guardando DB:", DB);

  localStorage.setItem('edhDB', JSON.stringify(DB)); 
  saveToCloud(DB);
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

let matchType = 'ffa';
let editingDeckId = null;
let tournamentSortKey = 'wr';
let activeTournamentId = null;
let editingMatchId = null;
if (!window.ffaSlots || typeof window.ffaSlots === "number") {
  window.ffaSlots = Array.from({ length: 4 }, () => ({
    playerId: "",
    deckId: ""
  }));
}

// Team match config
window.teamConfig = window.teamConfig || { numTeams: 2, playersPerTeam: 2 };
function initTeamSlots() {
  const { numTeams, playersPerTeam } = window.teamConfig;
  window.teamSlots = Array.from({ length: numTeams }, () =>
    Array.from({ length: playersPerTeam }, () => ({ playerId: '', deckId: '' }))
  );
}
if (!window.teamSlots) initTeamSlots();

function playerName(id) {
  const p = DB.players.find(p=>p.id===id);
  return p ? p.name : '—';
}
function deckName(id) {
  const d = DB.decks.find(d=>d.id===id);
  return d ? d.name : 'Mazo eliminado';
}
function deckOf(id) { return DB.decks.find(d=>d.id===id); }

function playerOptions(selected) {
  if(!DB.players.length) return '<option value="">— agregá jugadores primero —</option>';
  return '<option value="">Seleccionar jugador</option>' +
    DB.players.map(p=>`<option value="${p.id}"${p.id===selected?' selected':''}>${p.name}</option>`).join('');
}

function deckOptions(pid, selected, filter = "") {
  if(!pid) return '<option value="">— elegí jugador primero —</option>';

  let decks = DB.decks;

  if(filter) {
    const f = filter.toLowerCase();
    decks = decks.filter(d =>
      d.name.toLowerCase().includes(f) ||
      (d.commander || "").toLowerCase().includes(f) ||
      playerName(d.playerId).toLowerCase().includes(f)
    );
  }

  if(!decks.length) return '<option value="">— sin resultados —</option>';

  return '<option value="">Seleccionar mazo</option>' +
    decks.map(d=>{
      const owner = playerName(d.playerId);
      const commander = d.commander || '—';
      return `<option value="${d.id}" ${d.id===selected?'selected':''}>
        ${d.name} - ${commander} (${owner})
      </option>`;
    }).join('');
}

function renderDecks() {
  const el = document.getElementById('tab-decks');
  let html = '';
  if(DB.decks.length) {
    html += '<div class="cards-grid">';
    DB.decks.forEach(d => {
      const pname = playerName(d.playerId);
      const played = DB.matches.filter(m=>m.slots&&m.slots.some(s=>s.deckId===d.id)).length;
      const wins = DB.matches.filter(m=>m.slots&&m.slots.some(s=>s.deckId===d.id&&s.won)).length;
      const wr = played ? Math.round(wins/played*100) : 0;
      html += `<div class="deck-card">
        <div class="deck-name">${d.name}</div>
        <div class="deck-commander" style="margin-bottom:2px;">${d.commander||'—'}</div>
        <div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:6px;">${pname}</div>
        <div class="pip-row">${(d.colors||[]).map(c=>`<div class="pip pip-${c}">${c}</div>`).join('')}</div>
        <div class="stat-mini">${played} partidas ${played?`<span class="win-badge">${wr}% WR</span>`:''}</div>
        <div style="margin-top:8px;display:flex;gap:6px;"><button class="btn btn-sm" onclick="startEditDeck('${d.id}')">editar</button><button class="btn btn-sm btn-danger" onclick="deleteDeck('${d.id}')">eliminar</button></div>
      </div>`;
    });
    html += '</div>';
  } else {
    html += '<div class="empty-state">No hay mazos todavía.</div>';
  }
  const ed = editingDeckId ? DB.decks.find(d => d.id === editingDeckId) : null;
  html += `<div class="section-title" style="display:flex;align-items:center;justify-content:space-between;">${ed ? 'Editar mazo' : 'Agregar mazo'}${ed ? `<button class="btn btn-sm" onclick="cancelEditDeck()">Cancelar</button>` : ''}</div><div class="card-box">`;
  html += `<div class="form-row">
    <div class="form-group" style="margin-bottom:0;"><label>Dueño</label><select id="d-player" onchange="rerenderDeckForm()">${playerOptions(ed ? ed.playerId : '')}</select></div>
    <div class="form-group" style="margin-bottom:0;"><label>Nombre del mazo</label><input type="text" id="d-name" placeholder="Ej: Control Azul" value="${ed ? ed.name : ''}"></div>
  </div>
  <div class="form-group" style="margin-top:10px;position:relative;">
    <label>Comandante <span style="font-size:11px;color:var(--color-text-secondary);">(buscá por nombre)</span></label>
    <input type="text" id="d-commander" placeholder="Ej: Atraxa, Praetors' Voice" autocomplete="off" oninput="onCommanderInput()" value="${ed ? ed.commander || '' : ''}">
    <div id="commander-suggestions" style="display:none;position:absolute;z-index:9999;background:var(--color-background-primary, #fff);border:1px solid var(--color-border-secondary);border-radius:var(--border-radius-md);width:100%;max-height:220px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,0.18);top:calc(100% + 2px);left:0;backdrop-filter:none;opacity:1;"></div>
  </div>
  <div class="form-group" style="margin-bottom:0;"><label>Colores <span id="colors-auto-hint" style="font-size:11px;color:var(--color-text-success);display:none;">✓ detectados automáticamente</span><span id="colors-manual-hint" style="font-size:11px;color:var(--color-text-secondary);">${ed ? '' : ' · seleccioná un comandante primero'}</span></label>
    <div class="colors-row" id="color-picker" style="pointer-events:none;opacity:${ed ? '1' : '0.45'};">
      ${['W','U','B','R','G','C'].map(c => `<label class="color-toggle"><input type="checkbox" value="${c}"${ed && (ed.colors||[]).includes(c) ? ' checked' : ''} disabled><div class="color-dot ${c}">${c}</div></label>`).join('')}
    </div>
  </div>
  <div style="margin-top:12px;display:flex;gap:8px;">
    <button class="btn btn-gold" onclick="${ed ? 'saveEditDeck()' : 'addDeck()'}">${ed ? 'Guardar cambios' : 'Agregar mazo'}</button>
  </div>`;
  html += '</div>';
  el.innerHTML = html;
}

function rerenderDeckForm() {}

// ── Scryfall Commander Autocomplete ──────────────────────────────────────────
let _scryfallTimer = null;
let _commanderCards = [];

// Close dropdown when clicking outside
document.addEventListener('mousedown', e => {
  const sug = document.getElementById('commander-suggestions');
  const inp = document.getElementById('d-commander');
  if (sug && inp && !sug.contains(e.target) && e.target !== inp) {
    sug.style.display = 'none';
  }
});

function onCommanderInput() {
  const input = document.getElementById('d-commander');
  if (!input) return;
  const q = input.value.trim();
  clearTimeout(_scryfallTimer);
  if (q.length < 2) {
    const sug = document.getElementById('commander-suggestions');
    if (sug) sug.style.display = 'none';
    return;
  }
  _scryfallTimer = setTimeout(() => fetchCommanderSuggestions(q), 300);
}

async function fetchCommanderSuggestions(q) {
  const sugEl = document.getElementById('commander-suggestions');
  if (!sugEl) return;
  sugEl.style.display = 'block';
  sugEl.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--color-text-secondary);">Buscando...</div>';
  try {
    const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}+is:commander&order=name&unique=cards`;
    const res = await fetch(url);
    if (!res.ok) { sugEl.style.display = 'none'; return; }
    const data = await res.json();
    if (!data.data || !data.data.length) {
      sugEl.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--color-text-secondary);">Sin resultados</div>';
      return;
    }
    _commanderCards = data.data.slice(0, 8);
    sugEl.innerHTML = _commanderCards.map((card, idx) => {
      const colors = card.color_identity || [];
      const pips = colors.length
        ? colors.map(c => `<span class="pip pip-${c}" style="width:12px;height:12px;font-size:7px;">${c}</span>`).join('')
        : `<span class="pip pip-C" style="width:12px;height:12px;font-size:7px;">C</span>`;
      return `<div
        data-idx="${idx}"
        onmousedown="selectCommander(${idx})"
        style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;border-bottom:0.5px solid var(--color-border-tertiary);font-size:13px;"
        onmouseover="this.style.background='var(--color-background-secondary)'"
        onmouseout="this.style.background=''">
        <div style="display:flex;gap:2px;">${pips}</div>
        <span style="flex:1;">${card.name}</span>
      </div>`;
    }).join('');
  } catch(e) {
    sugEl.style.display = 'none';
  }
}

function selectCommander(idx) {
  const card = _commanderCards[idx];
  if (!card) return;
  const input = document.getElementById('d-commander');
  if (input) input.value = card.name;
  const colors = card.color_identity || [];
  const picker = document.getElementById('color-picker');
  if (picker) { picker.style.pointerEvents = 'none'; picker.style.opacity = '1'; }
  document.querySelectorAll('#color-picker input').forEach(cb => {
    cb.disabled = false;
    cb.checked = colors.length === 0 ? cb.value === 'C' : colors.includes(cb.value);
    cb.disabled = true;
  });
  const hint = document.getElementById('colors-auto-hint');
  if (hint) hint.style.display = 'inline';
  const manualHint = document.getElementById('colors-manual-hint');
  if (manualHint) manualHint.style.display = 'none';
  const sugEl = document.getElementById('commander-suggestions');
  if (sugEl) sugEl.style.display = 'none';
}
// ─────────────────────────────────────────────────────────────────────────────

function addDeck() {
  const pid = document.getElementById('d-player').value;
  const name = document.getElementById('d-name').value.trim();
  const commander = document.getElementById('d-commander').value.trim();

  if(!pid) { alert('Seleccioná un jugador.'); return; }
  if(!name) { alert('Ingresá un nombre para el mazo.'); return; }

  const colors = [...document.querySelectorAll('#color-picker input:checked')].map(c=>c.value);

  if(colors.length === 0) {
    alert('Seleccioná al menos un color para el mazo.');
    return;
  }

  DB.decks.push({ id: uid(), playerId: pid, name, commander, colors });
  save(); renderAll();
}

function deleteDeck(id) {
  if(!confirm('¿Eliminar este mazo?')) return;
  DB.decks = DB.decks.filter(d=>d.id!==id);
  DB.matches = DB.matches.filter(m=>!m.slots||!m.slots.every(s=>s.deckId===id));
  save(); renderAll();
}

function startEditDeck(id) {
  editingDeckId = id;
  renderDecks();
  // Scroll to form
  setTimeout(() => {
    const el = document.querySelector('#tab-decks .card-box:last-child');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 50);
}

function cancelEditDeck() {
  editingDeckId = null;
  renderDecks();
}

function saveEditDeck() {
  const pid = document.getElementById('d-player').value;
  const name = document.getElementById('d-name').value.trim();
  const commander = document.getElementById('d-commander').value.trim();
  if (!pid) { alert('Seleccioná un jugador.'); return; }
  if (!name) { alert('Ingresá un nombre para el mazo.'); return; }
  const colors = [...document.querySelectorAll('#color-picker input:checked')].map(c => c.value);
  if (!colors.length) { alert('Seleccioná al menos un color (buscá el comandante para autodetectarlos).'); return; }
  const deck = DB.decks.find(d => d.id === editingDeckId);
  if (!deck) return;
  deck.playerId = pid;
  deck.name = name;
  deck.commander = commander;
  deck.colors = colors;
  editingDeckId = null;
  save(); renderAll();
}

function addFFASlot() {
  if(window.ffaSlots.length >= 8) return;

  window.ffaSlots.push({
    playerId: "",
    deckId: ""
  });

  renderMatch();
}

function removeFFASlot(index) {
  if(window.ffaSlots.length <= 1) return;

  window.ffaSlots.splice(index, 1);
  renderMatch();
}

function updateFFASlotPlayer(i, playerId) {
  window.ffaSlots[i].playerId = playerId;
  window.ffaSlots[i].deckId = ""; // reset deck
  renderMatch();
}

function updateFFASlotDeck(i, value) {
  const deck = DB.decks.find(d => {
    const owner = playerName(d.playerId);
    const label = `${d.name} - ${d.commander || '—'} (${owner})`;
    return label === value;
  });

  window.ffaSlots[i].deckId = deck ? deck.id : "";
}

function renderMatch() {
  const el = document.getElementById('tab-match');

  let html = `<div class="card-box">
    <div class="section-title">Tipo de partida</div>
    <div class="type-toggle">
      <button class="type-btn${matchType==='ffa'?' active':''}" onclick="setMatchType('ffa')">Todos contra Todos</button>
      <button class="type-btn${matchType==='2v2'?' active':''}" onclick="setMatchType('2v2')">Por Equipos</button>
    </div>`;

  html += '<div id="match-slots">';

  if(matchType==='ffa') {

    const slots = window.ffaSlots;

    for(let i=0;i<slots.length;i++) {
      const slot = slots[i];

      const deckLabel = slot.deckId
        ? (() => {
            const d = deckOf(slot.deckId);
            return d ? `${d.name} - ${d.commander || '—'} (${playerName(d.playerId)})` : '';
          })()
        : '';

      html += `
      <div class="player-slot" style="display:flex;align-items:center;gap:6px;">

        ${slots.length > 1 ? `
          <button class="btn btn-sm btn-danger" onclick="removeFFASlot(${i})">×</button>
        ` : ''}

        <select onchange="updateFFASlotPlayer(${i}, this.value)">
          ${playerOptions(slot.playerId)}
        </select>

        <input 
          list="decks-${i}" 
          id="deck-input-${i}" 
          placeholder="Seleccionar mazo"
          value="${deckLabel}"
          onchange="updateFFASlotDeck(${i}, this.value)"
        >

        <datalist id="decks-${i}">
          ${DB.decks.map(d=>{
            const owner = playerName(d.playerId);
            const commander = d.commander || '—';
            return `<option value="${d.name} - ${commander} (${owner})"></option>`;
          }).join('')}
        </datalist>

        <label class="won-toggle">
          <input type="radio" name="ffa-result" value="win-${i}"> ganó
        </label>

      </div>`;
    }

    if(slots.length < 8) {
      html += `<button class="btn btn-sm" onclick="addFFASlot()">+ Agregar jugador</button>`;
    }

    html += `
    <div style="margin-top:10px;">
      <label class="won-toggle">
        <input type="radio" name="ffa-result" value="draw"> Empate
      </label>
    </div>`;
  }

  else {
    const { numTeams, playersPerTeam } = window.teamConfig;
    const slots = window.teamSlots;

    // Config selectors
    html += `<div style="display:flex;gap:12px;align-items:center;margin-bottom:14px;flex-wrap:wrap;">
      <div style="display:flex;align-items:center;gap:6px;">
        <label style="font-size:12px;color:var(--color-text-secondary);">Equipos:</label>
        <select onchange="updateTeamConfig('numTeams', this.value)" style="width:auto;">
          ${[2,3,4].map(n=>`<option value="${n}"${n===numTeams?' selected':''}>${n}</option>`).join('')}
        </select>
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <label style="font-size:12px;color:var(--color-text-secondary);">Jugadores por equipo:</label>
        <select onchange="updateTeamConfig('playersPerTeam', this.value)" style="width:auto;">
          ${[1,2,3,4].map(n=>`<option value="${n}"${n===playersPerTeam?' selected':''}>${n}</option>`).join('')}
        </select>
      </div>
    </div>`;

    const teamColors = ['var(--gold)','#6a9fc8','#60a860','#c87060'];
    const teamNames = ['Equipo 1','Equipo 2','Equipo 3','Equipo 4'];

    for(let t=0; t<numTeams; t++) {
      const tSlots = slots[t] || [];
      html += `<div style="border-left:3px solid ${teamColors[t]};padding-left:10px;margin-bottom:12px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <div style="font-size:13px;font-weight:500;color:var(--color-text-primary);">${teamNames[t]}</div>
          <label class="won-toggle">
            <input type="radio" name="team-result" value="${t}"> ganó
          </label>
        </div>`;
      for(let i=0; i<playersPerTeam; i++) {
        const slot = tSlots[i] || { playerId: '', deckId: '' };
        const deckLabel = slot.deckId ? (() => {
          const d = deckOf(slot.deckId);
          return d ? `${d.name} - ${d.commander || '—'} (${playerName(d.playerId)})` : '';
        })() : '';
        html += `<div class="player-slot" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:6px;">
          <select onchange="updateTeamSlotPlayer(${t},${i},this.value)">
            ${playerOptions(slot.playerId)}
          </select>
          <input list="team-decks-${t}-${i}" id="team-deck-input-${t}-${i}"
            placeholder="Seleccionar mazo" value="${deckLabel}"
            onchange="updateTeamSlotDeck(${t},${i},this.value)">
          <datalist id="team-decks-${t}-${i}">
            ${DB.decks.map(d=>{
              const owner = playerName(d.playerId);
              return `<option value="${d.name} - ${d.commander||'—'} (${owner})"></option>`;
            }).join('')}
          </datalist>
        </div>`;
      }
      html += '</div>';
    }

    html += `<div style="margin:4px 0 6px;">
      <label class="won-toggle">
        <input type="radio" name="team-result" value="draw"> Empate
      </label>
    </div>`;
  }

  html += '</div>';

  html += `
  <div style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
    <div class="form-group" style="margin-bottom:0;">
      <label>Fecha</label>
      <input type="date" id="m-date" style="max-width:160px;" value="${new Date().toISOString().slice(0,10)}">
    </div>

    <div class="form-group" style="margin-bottom:0;">
      <label>Torneo (opcional)</label>
      <select id="m-tournament">
        <option value="">— sin torneo —</option>
        ${DB.tournaments.filter(t=>t.active).map(t=>`<option value="${t.id}">${t.name}</option>`).join('')}
      </select>
    </div>
  </div>

  <div style="margin-top:12px;display:flex;gap:8px;align-items:center;">
    <button class="btn btn-gold" onclick="saveMatch()">${editingMatchId ? 'Guardar cambios' : 'Guardar partida'}</button>
    ${editingMatchId ? `<button class="btn" onclick="cancelEditMatch()">Cancelar</button>` : ''}
  </div>

  </div>`;

  el.innerHTML = html;
}

function setMatchType(t) { matchType = t; renderMatch(); }

function updateTeamConfig(key, val) {
  window.teamConfig[key] = parseInt(val);
  initTeamSlots();
  renderMatch();
}

function updateTeamSlotPlayer(teamIdx, playerIdx, playerId) {
  if (!window.teamSlots[teamIdx]) window.teamSlots[teamIdx] = [];
  if (!window.teamSlots[teamIdx][playerIdx]) window.teamSlots[teamIdx][playerIdx] = {};
  window.teamSlots[teamIdx][playerIdx].playerId = playerId;
  window.teamSlots[teamIdx][playerIdx].deckId = '';
  renderMatch();
}

function updateTeamSlotDeck(teamIdx, playerIdx, value) {
  if (!window.teamSlots[teamIdx]) return;
  if (!window.teamSlots[teamIdx][playerIdx]) window.teamSlots[teamIdx][playerIdx] = {};
  const deck = DB.decks.find(d => {
    const owner = playerName(d.playerId);
    const label = `${d.name} - ${d.commander || '—'} (${owner})`;
    return label === value;
  });
  window.teamSlots[teamIdx][playerIdx].deckId = deck ? deck.id : '';
}

function updateMatchDeck(i) {
  const pid = document.getElementById(`ms-p${i}`).value;
  document.getElementById(`ms-d${i}`).innerHTML = deckOptions(pid);
}
function updateMatchDeck2(t, i) {
  const pid = document.getElementById(`ms-${t}p${i}`).value;
  document.getElementById(`ms-${t}d${i}`).innerHTML = deckOptions(pid);
}

function saveMatch() {
  const date = document.getElementById('m-date').value || new Date().toISOString().slice(0,10);
  const tournamentId = document.getElementById('m-tournament').value || null;
  let slots = [];

  if(matchType === 'ffa') {

    const result = document.querySelector('input[name="ffa-result"]:checked');
    if(!result) { alert('Seleccioná resultado.'); return; }

    const value = result.value;

    for(let i=0;i<window.ffaSlots.length;i++) {
      const slot = window.ffaSlots[i];
      const pid = slot.playerId;
      const deckId = slot.deckId;
      if(!pid || !deckId) continue;

      if(value === "draw") {
        slots.push({ playerId: pid, deckId, won: false, draw: true });
      } else {
        const winIndex = parseInt(value.split("-")[1]);
        slots.push({ playerId: pid, deckId, won: i === winIndex, draw: false });
      }
    }

  } else {

    const result = document.querySelector('input[name="team-result"]:checked');
    if(!result) { alert('Seleccioná resultado.'); return; }

    const value = result.value; // team index (0,1,2...) or "draw"
    const { numTeams, playersPerTeam } = window.teamConfig;
    const tSlots = window.teamSlots;

    for(let t=0; t<numTeams; t++) {
      for(let i=0; i<playersPerTeam; i++){
        const slot = (tSlots[t] || [])[i] || {};
        const pid = slot.playerId;
        const deckId = slot.deckId;
        if(!pid || !deckId) continue;
        if(value === "draw") {
          slots.push({ playerId: pid, deckId, team: t, won: false, draw: true });
        } else {
          slots.push({ playerId: pid, deckId, team: t, won: String(t) === value, draw: false });
        }
      }
    }
  }

  console.log("Saving match:", { matchType, slots });
  
  if(!slots.length) {
    alert('Registrá al menos un jugador con mazo.');
    return;
  }

  const newMatch = {
    id: editingMatchId || uid(),
    type: matchType,
    date,
    tournamentId,
    slots
  };

  if (editingMatchId) {
    DB.matches = DB.matches.map(m => m.id === editingMatchId ? newMatch : m);
    editingMatchId = null;
  } else {
    DB.matches.push(newMatch);
  }

  save();
  renderAll();
  showTab('history');
}


function renderHistory() {
  const el = document.getElementById('tab-history');
  if(!DB.matches.length) { el.innerHTML = '<div class="empty-state">No hay partidas registradas todavía.</div>'; return; }
  const sorted = [...DB.matches].sort((a,b)=>b.date.localeCompare(a.date));
  let html = '';
  sorted.forEach(m => {
    const t = m.tournamentId ? DB.tournaments.find(t=>t.id===m.tournamentId) : null;
    html += `<div class="history-item">
      <div class="history-date">${m.date.slice(5).replace('-','/')}</div>
      <div class="history-type">${m.type==='ffa'?'FFA':'2v2'}</div>
      ${t?`<span class="tag-tournament">${t.name}</span>`:''}
      <div style="flex:1;min-width:0;">
        ${m.slots.map(s=>`<span style="font-size:12px;margin-right:8px;${s.won?'color:var(--color-text-success);font-weight:500;':'color:var(--color-text-secondary);'}">${playerName(s.playerId)}: ${deckName(s.deckId)}${s.won?' ✓':''}</span>`).join('')}
      </div>
      <button class="btn btn-sm" onclick="editMatch('${m.id}')">editar</button>
      <button class="btn btn-sm btn-danger" onclick="deleteMatch('${m.id}')">×</button>
    </div>`;
  });
  el.innerHTML = html;
}

function editMatch(id) {
  const m = DB.matches.find(m => m.id === id);
  if (!m) return;

  editingMatchId = id;
  matchType = m.type;

  if (m.type === 'ffa') {
    // Load slots state from match data
    window.ffaSlots = m.slots.map(s => ({ playerId: s.playerId, deckId: s.deckId, won: s.won, draw: s.draw }));
    // Store winning index / draw so renderMatch can pre-check the radio
    window._editFfaWin = m.slots.findIndex(s => s.won);
    window._editFfaDraw = m.slots.some(s => s.draw);
  } else {
    // Rebuild teamConfig from match slots
    const teams = [...new Set(m.slots.map(s => s.team))].sort((a,b)=>a-b);
    const playersPerTeam = Math.max(...teams.map(t => m.slots.filter(s => s.team === t).length));
    window.teamConfig = { numTeams: teams.length, playersPerTeam };
    window.teamSlots = teams.map(t => {
      const tSlots = m.slots.filter(s => s.team === t);
      return Array.from({ length: playersPerTeam }, (_, i) =>
        tSlots[i] ? { playerId: tSlots[i].playerId, deckId: tSlots[i].deckId } : { playerId: '', deckId: '' }
      );
    });
    window._editTeamWin = m.slots.find(s => s.won)?.team ?? null;
    window._editTeamDraw = m.slots.some(s => s.draw);
  }

  // Store date and tournament for after render
  window._editMatchDate = m.date;
  window._editMatchTournament = m.tournamentId || '';

  renderMatch();
  showTab('match');

  // Set date, tournament and radios after DOM is ready
  setTimeout(() => {
    const dateEl = document.getElementById('m-date');
    if (dateEl) dateEl.value = window._editMatchDate;
    const tEl = document.getElementById('m-tournament');
    if (tEl && window._editMatchTournament) tEl.value = window._editMatchTournament;

    if (m.type === 'ffa') {
      if (window._editFfaDraw) {
        const r = document.querySelector('input[name="ffa-result"][value="draw"]');
        if (r) r.checked = true;
      } else if (window._editFfaWin >= 0) {
        const r = document.querySelector(`input[name="ffa-result"][value="win-${window._editFfaWin}"]`);
        if (r) r.checked = true;
      }
    } else {
      if (window._editTeamDraw) {
        const r = document.querySelector('input[name="team-result"][value="draw"]');
        if (r) r.checked = true;
      } else if (window._editTeamWin !== null) {
        const r = document.querySelector(`input[name="team-result"][value="${window._editTeamWin}"]`);
        if (r) r.checked = true;
      }
    }
  }, 0);
}

function cancelEditMatch() {
  editingMatchId = null;
  window.ffaSlots = Array.from({ length: 4 }, () => ({ playerId: '', deckId: '' }));
  window.teamConfig = { numTeams: 2, playersPerTeam: 2 };
  initTeamSlots();
  renderMatch();
}

function deleteMatch(id) {
  if(!confirm('¿Eliminar esta partida?')) return;
  DB.matches = DB.matches.filter(m=>m.id!==id);
  save(); renderAll();
}

function renderStats() {
  const el = document.getElementById('tab-stats');
  const freeMatches = DB.matches.filter(m=>!m.tournamentId);
  const total = DB.matches.length;
  const ffa = DB.matches.filter(m=>m.type==='ffa').length;
  const v2 = DB.matches.filter(m=>m.type==='2v2').length;

  let html = `<div class="stats-grid">
    <div class="stat-card"><div class="stat-label">Partidas totales</div><div class="stat-value">${total}</div><div class="stat-sub">FFA: ${ffa} · 2v2: ${v2}</div></div>
    <div class="stat-card"><div class="stat-label">En torneos</div><div class="stat-value">${total-freeMatches.length}</div><div class="stat-sub">${freeMatches.length} partidas libres</div></div>
    <div class="stat-card"><div class="stat-label">Jugadores</div><div class="stat-value">${DB.players.length}</div><div class="stat-sub">${DB.decks.length} mazos</div></div>
  </div>`;

  if(DB.decks.length) {
    html += '<div class="section-title">Win rate por mazo</div>';
    const deckStats = DB.decks.map(d=>{
      const ms = DB.matches.filter(m=>m.slots&&m.slots.some(s=>s.deckId===d.id));
      const wins = ms.filter(m=>m.slots.some(s=>s.deckId===d.id&&s.won)).length;
      const wr = ms.length ? Math.round(wins/ms.length*100) : 0;
      return { name: d.name, player: playerName(d.playerId), played: ms.length, wins, wr };
    }).filter(d=>d.played>0).sort((a,b)=>b.wr-a.wr);
    if(deckStats.length) {
      html += deckStats.map(d=>`<div class="bar-row">
        <div class="bar-label" title="${d.name} (${d.player})">${d.name}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${d.wr}%"></div></div>
        <div class="bar-pct">${d.wr}%</div>
        <div style="font-size:11px;color:var(--color-text-secondary);min-width:55px;text-align:right;">${d.wins}/${d.played}</div>
      </div>`).join('');
    } else { html += '<div class="empty-state">Jugá partidas para ver estadísticas.</div>'; }
  }

  if(DB.players.length) {
    html += '<div class="section-title" style="margin-top:1.25rem;">Ranking de jugadores</div>';
    html += renderLeaderboardTable(DB.matches, DB.players, 'wr', false);
  }
  el.innerHTML = html;
}

function renderLeaderboardTable(matches, players, sortKey, showMedals) {
  const rows = players.map(p => {
    const ms = matches.filter(m=>m.slots&&m.slots.some(s=>s.playerId===p.id));
    const wins = ms.filter(m=>m.slots.some(s=>s.playerId===p.id&&s.won)).length;
    const wr = ms.length ? Math.round(wins/ms.length*100) : 0;
    return { name: p.name, played: ms.length, wins, wr };
  }).filter(r=>r.played>0);

  if(!rows.length) return '<div class="empty-state">Registrá partidas para ver el ranking.</div>';

  rows.sort((a,b) => sortKey==='wr' ? b.wr-a.wr || b.wins-a.wins : b.wins-a.wins || b.wr-a.wr);
  const medals = ['🥇','🥈','🥉'];
  return `<table>
    <thead><tr>
      <th>#</th>
      <th>Jugador</th>
      <th onclick="sortLeaderboard('played')" class="${sortKey==='played'?'sorted':''}">Partidas</th>
      <th onclick="sortLeaderboard('wins')" class="${sortKey==='wins'?'sorted':''}">Victorias</th>
      <th onclick="sortLeaderboard('wr')" class="${sortKey==='wr'?'sorted':''}">Win rate ${sortKey==='wr'?'↓':''}</th>
    </tr></thead>
    <tbody>${rows.map((r,i)=>`<tr class="${i===0?'rank-1':''}">
      <td style="color:var(--color-text-secondary);font-size:12px;">${showMedals&&i<3?medals[i]:i+1}</td>
      <td style="font-weight:${i===0?'500':'400'}">${r.name}</td>
      <td style="color:var(--color-text-secondary);">${r.played}</td>
      <td>${r.wins}</td>
      <td><span style="font-weight:500;color:${r.wr>=50?'var(--color-text-success)':'var(--color-text-primary)'};">${r.wr}%</span></td>
    </tr>`).join('')}</tbody>
  </table>`;
}

let globalSortKey = 'wr';
function sortLeaderboard(key) { globalSortKey = key; renderStats(); }

function renderTournament() {
  const el = document.getElementById('tab-tournament');
  let html = '';

  if(activeTournamentId) {
    const t = DB.tournaments.find(t=>t.id===activeTournamentId);
    if(t) {
      const tMatches = DB.matches.filter(m=>m.tournamentId===t.id);
      const tPlayers = DB.players.filter(p=>t.playerIds.includes(p.id));
      html += `<div style="display:flex;align-items:center;gap:10px;margin-bottom:1rem;">
        <button class="btn btn-sm" onclick="activeTournamentId=null;renderTournament()">← Volver</button>
        <div>
          <div style="font-size:16px;font-weight:500;">${t.name}</div>
          <div style="font-size:12px;color:var(--color-text-secondary);">${t.date} · ${tMatches.length} partidas · ${tPlayers.length} jugadores · ${t.active?'<span style="color:var(--color-text-success);">Activo</span>':'Finalizado'}</div>
        </div>
        ${t.active?`<button class="btn btn-sm" style="margin-left:auto;" onclick="closeTournament('${t.id}')">Finalizar torneo</button>`:''}
      </div>`;

      html += '<div class="sort-btns">';
      html += `<button class="sort-btn${tournamentSortKey==='wr'?' active':''}" onclick="tournamentSortKey='wr';renderTournament()">Por win rate</button>`;
      html += `<button class="sort-btn${tournamentSortKey==='wins'?' active':''}" onclick="tournamentSortKey='wins';renderTournament()">Por victorias</button>`;
      html += `<button class="sort-btn${tournamentSortKey==='played'?' active':''}" onclick="tournamentSortKey='played';renderTournament()">Por partidas</button>`;
      html += '</div>';

      html += '<div class="card-box" style="margin-bottom:1rem;">';
      html += '<div class="section-title" style="margin-bottom:8px;">Tabla de posiciones</div>';
      html += renderLeaderboardTable(tMatches, tPlayers, tournamentSortKey, true);
      html += '</div>';

      const deckStats = DB.decks.filter(d=>t.playerIds.includes(d.playerId)).map(d=>{
        const ms = tMatches.filter(m=>m.slots&&m.slots.some(s=>s.deckId===d.id));
        const wins = ms.filter(m=>m.slots.some(s=>s.deckId===d.id&&s.won)).length;
        const wr = ms.length ? Math.round(wins/ms.length*100) : 0;
        return { name: d.name, player: playerName(d.playerId), played: ms.length, wins, wr };
      }).filter(d=>d.played>0).sort((a,b)=>b.wr-a.wr);

      if(deckStats.length) {
        html += '<div class="section-title">Mazos del torneo</div>';
        html += deckStats.map(d=>`<div class="bar-row">
          <div class="bar-label" title="${d.name}">${d.name} <span style="font-size:10px;color:var(--color-text-secondary);">(${d.player})</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${d.wr}%"></div></div>
          <div class="bar-pct">${d.wr}%</div>
          <div style="font-size:11px;color:var(--color-text-secondary);min-width:55px;text-align:right;">${d.wins}/${d.played}</div>
        </div>`).join('');
      }

      if(tMatches.length) {
        html += '<div class="section-title" style="margin-top:1.25rem;">Partidas del torneo</div>';
        [...tMatches].sort((a,b)=>b.date.localeCompare(a.date)).forEach(m=>{
          html += `<div class="history-item">
            <div class="history-date">${m.date.slice(5).replace('-','/')}</div>
            <div class="history-type">${m.type==='ffa'?'FFA':'2v2'}</div>
            <div style="flex:1;font-size:12px;">
              ${m.slots.map(s=>`<span style="margin-right:8px;${s.won?'color:var(--color-text-success);font-weight:500;':'color:var(--color-text-secondary);'}">${playerName(s.playerId)}: ${deckName(s.deckId)}${s.won?' ✓':''}</span>`).join('')}
            </div>
          </div>`;
        });
      } else {
        html += '<div class="empty-state">No hay partidas en este torneo todavía.<br>Registrá una partida y seleccioná este torneo.</div>';
      }
      el.innerHTML = html;
      return;
    }
  }

  if(DB.tournaments.length) {
    DB.tournaments.forEach(t => {
      const tMatches = DB.matches.filter(m=>m.tournamentId===t.id);
      const tPlayers = DB.players.filter(p=>t.playerIds.includes(p.id));
      html += `<div class="tournament-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <div class="tournament-name">${t.name}</div>
            <div class="tournament-meta">${t.date} · ${tMatches.length} partidas · ${tPlayers.length} jugadores</div>
          </div>
          <div style="display:flex;gap:6px;align-items:center;">
            ${t.active?'<span style="font-size:11px;color:var(--color-text-success);font-weight:500;">En curso</span>':'<span style="font-size:11px;color:var(--color-text-secondary);">Finalizado</span>'}
            <button class="btn btn-sm" onclick="activeTournamentId='${t.id}';renderTournament()">Ver →</button>
            <button class="btn btn-sm btn-danger" onclick="deleteTournament('${t.id}')">×</button>
          </div>
        </div>
      </div>`;
    });
  } else {
    html += '<div class="empty-state">No hay torneos creados todavía.</div>';
  }

  html += '<div class="section-title" style="margin-top:1rem;">Crear torneo</div><div class="card-box">';
  html += `<div class="form-row">
    <div class="form-group" style="margin-bottom:0;"><label>Nombre del torneo</label><input type="text" id="t-name" placeholder="Ej: Liga Mensual #1"></div>
    <div class="form-group" style="margin-bottom:0;"><label>Fecha</label><input type="date" id="t-date" value="${new Date().toISOString().slice(0,10)}"></div>
  </div>
  <div class="form-group" style="margin-top:10px;"><label>Jugadores participantes</label>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:4px;">
      <select id="t-addplayer">${playerOptions()}</select>
      <button class="btn btn-sm" onclick="addTournamentPlayer()">+ Agregar</button>
    </div>
    <div id="t-players-list" style="margin-top:8px;"></div>
  </div>
  <button class="btn btn-gold" onclick="createTournament()">Crear torneo</button>`;
  html += '</div>';
  el.innerHTML = html;
  window._tPlayers = window._tPlayers || [];
  renderTournamentPlayersList();
}

window._tPlayers = [];
function addTournamentPlayer() {
  const sel = document.getElementById('t-addplayer');
  const pid = sel.value;
  if(!pid) return;
  if(window._tPlayers.includes(pid)) return;
  window._tPlayers.push(pid);
  renderTournamentPlayersList();
}
function removeTournamentPlayer(pid) {
  window._tPlayers = window._tPlayers.filter(p=>p!==pid);
  renderTournamentPlayersList();
}
function renderTournamentPlayersList() {
  const el = document.getElementById('t-players-list');
  if(!el) return;
  if(!window._tPlayers.length) { el.innerHTML = '<span style="font-size:12px;color:var(--color-text-secondary);">Ningún jugador agregado</span>'; return; }
  el.innerHTML = window._tPlayers.map(pid=>`<span class="player-pill">${playerName(pid)}<button class="rm" onclick="removeTournamentPlayer('${pid}')">×</button></span>`).join('');
}
function createTournament() {
  const name = document.getElementById('t-name').value.trim();
  const date = document.getElementById('t-date').value;
  if(!name) { alert('Ingresá un nombre para el torneo.'); return; }
  if(!window._tPlayers.length) { alert('Agregá al menos un jugador.'); return; }
  DB.tournaments.push({ id: uid(), name, date, playerIds: [...window._tPlayers], active: true });
  window._tPlayers = [];
  save(); renderAll();
}
function closeTournament(id) {
  const t = DB.tournaments.find(t=>t.id===id);
  if(t) { t.active = false; save(); renderAll(); }
}
function deleteTournament(id) {
  if(!confirm('¿Eliminar este torneo? Las partidas no se borran.')) return;
  DB.tournaments = DB.tournaments.filter(t=>t.id!==id);
  save(); renderAll();
}

function showPlayersModal() {
  const ov = document.getElementById('modal-overlay');
  const box = document.getElementById('modal-box');
  ov.style.display = 'flex';
  let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
    <div style="font-size:15px;font-weight:500;">Jugadores</div>
    <button class="btn btn-sm" onclick="hideModal()">Cerrar</button>
  </div>`;
  if(DB.players.length) {
    html += DB.players.map(p=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:0.5px solid var(--color-border-tertiary);">
      <span style="font-size:14px;">${p.name}</span>
      <button class="btn btn-sm btn-danger" onclick="deletePlayer('${p.id}')">eliminar</button>
    </div>`).join('');
  } else {
    html += '<div style="font-size:13px;color:var(--color-text-secondary);margin-bottom:12px;">No hay jugadores todavía.</div>';
  }
  html += `<div style="margin-top:12px;display:flex;gap:8px;">
    <input type="text" id="new-player-name" placeholder="Nombre del jugador" style="flex:1;">
    <button class="btn btn-gold" onclick="addPlayer()">Agregar</button>
  </div>`;
  box.innerHTML = html;
}
function hideModal() {
  document.getElementById('modal-overlay').style.display = 'none';
}
function addPlayer() {
  const name = document.getElementById('new-player-name').value.trim();
  if(!name) return;
  DB.players.push({ id: uid(), name });
  save(); showPlayersModal(); renderAll();
}
function deletePlayer(id) {
  if(!confirm('¿Eliminar jugador? Sus mazos y partidas también se eliminarán.')) return;
  DB.players = DB.players.filter(p=>p.id!==id);
  DB.decks = DB.decks.filter(d=>d.playerId!==id);
  DB.matches = DB.matches.map(m=>({ ...m, slots: (m.slots||[]).filter(s=>s.playerId!==id) })).filter(m=>m.slots.length>0);
  DB.tournaments = DB.tournaments.map(t=>({ ...t, playerIds: t.playerIds.filter(p=>p!==id) }));
  save(); showPlayersModal(); renderAll();
}

function showTab(t) {
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('tab-'+t).classList.add('active');
  const tabs = ['decks','match','history','stats','tournament'];
  document.querySelectorAll('.nav-btn')[tabs.indexOf(t)].classList.add('active');
}

function renderAll() {
  renderDecks();
  renderMatch();
  renderHistory();
  renderStats();
  renderTournament();
}


async function init() {
  const local = localStorage.getItem('edhDB');
  if (local) {
    window.DB = JSON.parse(local);
  }

  const cloud = await loadFromCloud();

  if (cloud) {
    window.DB = cloud;
  }

  renderAll();
}

init(); 

// Exponer funciones al HTML
window.showPlayersModal = showPlayersModal;
window.hideModal = hideModal;
window.addPlayer = addPlayer;
window.deletePlayer = deletePlayer;

window.showTab = showTab;

window.addFFASlot = addFFASlot;
window.removeFFASlot = removeFFASlot;
window.updateFFASlotPlayer = updateFFASlotPlayer;
window.updateFFASlotDeck = updateFFASlotDeck;

window.addDeck = addDeck;
window.startEditDeck = startEditDeck;
window.cancelEditDeck = cancelEditDeck;
window.saveEditDeck = saveEditDeck;
window.deleteDeck = deleteDeck;
window.rerenderDeckForm = rerenderDeckForm;
window.onCommanderInput = onCommanderInput;
window.selectCommander = selectCommander;

window.setMatchType = setMatchType;
window.updateTeamConfig = updateTeamConfig;
window.updateTeamSlotPlayer = updateTeamSlotPlayer;
window.updateTeamSlotDeck = updateTeamSlotDeck;
window.updateMatchDeck = updateMatchDeck;
window.updateMatchDeck2 = updateMatchDeck2;
window.saveMatch = saveMatch;
window.editMatch = editMatch;
window.cancelEditMatch = cancelEditMatch;
window.deleteMatch = deleteMatch;

window.sortLeaderboard = sortLeaderboard;

window.addTournamentPlayer = addTournamentPlayer;
window.removeTournamentPlayer = removeTournamentPlayer;
window.createTournament = createTournament;
window.closeTournament = closeTournament;
window.deleteTournament = deleteTournament;

