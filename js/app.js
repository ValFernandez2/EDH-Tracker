import { loadAppData, saveAppData, deleteAppDeck } from "./auth.js";

window.DB = { players: [], decks: [], matches: [], tournaments: [], sessions: [] };

function save() {
  saveAppData(window.DB).catch(e => console.error('Save error:', e));
}

function normalizeDB() {
  DB.players     = DB.players     || [];
  DB.decks       = DB.decks       || [];
  DB.matches     = DB.matches     || [];
  DB.tournaments = DB.tournaments || [];
  DB.sessions    = DB.sessions    || [];
}

function formatDate(dateStr) {
  if (!dateStr) return '';

  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year.slice(2)}`;
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

let matchType = 'ffa';
let editingDeckId = null;
let tournamentSortKey = 'wr';
let currentSessionId = null;
let activeTournamentId = null;
let editingMatchId = null;
let matchPlaygroupId = null;

if (!window.ffaSlots || typeof window.ffaSlots === "number") {
  window.ffaSlots = Array.from({ length: 4 }, () => ({
    playerId: "",
    deckId: ""
  }));
}

// Deck sort/filter state
let deckSort = 'name';       // 'name','commander','owner','recent','played','wr'
let deckSearch = '';
let deckFilters = { owner: '', minPlayed: '', maxPlayed: '', minWR: '', maxWR: '', fromDate: '', toDate: '' };

// Cache for loaded playgroup data (pgId -> {matches, decks, players, tournaments, sessions})
window._pgCache = {};

let historyFilters = {
  playerId: "",
  fromDate: "",
  toDate: "",
  sessionId: "",
  tournamentId: "",
  playgroupId: ""
};

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
  if (!id) return '—';
  const p = DB.players.find(p => p.id === id);
  return p ? p.name : (id.startsWith('guest_') ? id.replace('guest_','') : id);
}

function slotPlayerDisplay(slot) {
  if (slot.playerId) return playerName(slot.playerId);
  if (slot.playerName) return slot.playerName;
  return '—';
}

function slotDeckDisplay(slot) {
  if (slot.deckId) return deckName(slot.deckId);
  if (slot.deckLabel) return slot.deckLabel;
  return '—';
}
function deckName(id) {
  const d = DB.decks.find(d=>d.id===id);
  return d ? d.name : 'Mazo eliminado';
}
function deckOf(id) { return DB.decks.find(d=>d.id===id); }

function playerOptions(selected, excludeIds = []) {
  if(!DB.players.length) return '<option value="">— agregá jugadores primero —</option>';

  const available = DB.players.filter(p => !excludeIds.includes(p.id) || p.id === selected);

  return '<option value="">Seleccionar jugador</option>' +
    available.map(p=>`
      <option value="${p.id}" ${p.id===selected?'selected':''}>
        ${p.name}
      </option>
    `).join('');
}

function deckOptions(pid, selected, filter = "") {
  if(!pid) return '<option value="">— elegí jugador primero —</option>';

  let decks = DB.decks.filter(d => 
  (!excludeDeckIds.includes(d.id) || d.id === selected)
  );

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

function getDeckStats(d) {
  const matches = DB.matches.filter(m => m.slots && m.slots.some(s => s.deckId === d.id));
  const played = matches.length;
  const wins = matches.filter(m => m.slots.some(s => s.deckId === d.id && s.won)).length;
  const wr = played ? Math.round(wins / played * 100) : 0;
  const lastMatch = matches.sort((a,b) => (b.date||'').localeCompare(a.date||''))[0];
  return { played, wins, wr, lastDate: lastMatch ? lastMatch.date : null };
}

function renderDecks() {
  const el = document.getElementById('tab-decks');
  let html = '';

  // ── Sort & Filter bar ──────────────────────────────────────
  const hasFilters = Object.values(deckFilters).some(v=>v!=='') || deckSearch !== '';
  html += `<div class="card-box deck-toolbar">
    <div class="deck-toolbar-row">
      <div class="deck-toolbar-group">
        <span class="toolbar-label">Ordenar</span>
        ${[
          ['name','Nombre'],['commander','Comandante'],['owner','Dueño'],
          ['recent','Recientes'],['played','Partidas'],['wr','Win Rate']
        ].map(([k,l]) =>
          `<button class="sort-btn${deckSort===k?' active':''}" onclick="setDeckSort('${k}')">${l}</button>`
        ).join('')}
      </div>
      <div class="deck-toolbar-sep"></div>
      <div class="deck-toolbar-group">
        <span class="toolbar-label">Filtrar</span>
        <input type="text" placeholder="Buscar mazo..." value="${deckSearch}" oninput="setDeckSearch(this.value)" style="width:140px;">

        <div class="toolbar-range-group">
          <span class="toolbar-label" style="white-space:nowrap;">Partidas</span>
          <input type="number" placeholder="mín" min="0" value="${deckFilters.minPlayed}" onchange="setDeckFilter('minPlayed',this.value)" style="width:54px;">
          <span class="toolbar-sep-dash">–</span>
          <input type="number" placeholder="máx" min="0" value="${deckFilters.maxPlayed}" onchange="setDeckFilter('maxPlayed',this.value)" style="width:54px;">
        </div>
        <div class="toolbar-range-group">
          <span class="toolbar-label" style="white-space:nowrap;">WR %</span>
          <input type="number" placeholder="mín" min="0" max="100" value="${deckFilters.minWR}" onchange="setDeckFilter('minWR',this.value)" style="width:54px;">
          <span class="toolbar-sep-dash">–</span>
          <input type="number" placeholder="máx" min="0" max="100" value="${deckFilters.maxWR}" onchange="setDeckFilter('maxWR',this.value)" style="width:54px;">
        </div>
        <div class="toolbar-range-group">
          <span class="toolbar-label" style="white-space:nowrap;">Último uso</span>
          <input type="date" value="${deckFilters.fromDate}" onchange="setDeckFilter('fromDate',this.value)" style="width:120px;">
          <span class="toolbar-sep-dash">–</span>
          <input type="date" value="${deckFilters.toDate}" onchange="setDeckFilter('toDate',this.value)" style="width:120px;">
        </div>
        ${hasFilters ? `<button class="btn btn-sm" onclick="clearDeckFilters()">Limpiar</button>` : ''}
      </div>
    </div>
  </div>`;

  // ── Build filtered + sorted list ───────────────────────────
  const myUid = window.AUTH?.user?.uid;
  const totalDecks = DB.decks.filter(d => d.playerId === myUid).length;
  let decks = DB.decks.filter(d => d.playerId === myUid).map(d => ({ d, ...getDeckStats(d) }));

  // Filter
  if (deckSearch) {
    const q = deckSearch.toLowerCase();
    decks = decks.filter(x => x.d.name.toLowerCase().includes(q));
  }
  if (deckFilters.minPlayed !== '') decks = decks.filter(x => x.played >= parseInt(deckFilters.minPlayed));
  if (deckFilters.maxPlayed !== '') decks = decks.filter(x => x.played <= parseInt(deckFilters.maxPlayed));
  if (deckFilters.minWR !== '') decks = decks.filter(x => x.wr >= parseInt(deckFilters.minWR));
  if (deckFilters.maxWR !== '') decks = decks.filter(x => x.wr <= parseInt(deckFilters.maxWR));
  if (deckFilters.fromDate) decks = decks.filter(x => x.lastDate && x.lastDate >= deckFilters.fromDate);
  if (deckFilters.toDate) decks = decks.filter(x => x.lastDate && x.lastDate <= deckFilters.toDate);

  // Sort
  decks.sort((a, b) => {
    switch(deckSort) {
      case 'commander': return (a.d.commander||'').localeCompare(b.d.commander||'');
      case 'owner':     return playerName(a.d.playerId).localeCompare(playerName(b.d.playerId));
      case 'recent':    return (b.lastDate||'').localeCompare(a.lastDate||'');
      case 'played':    return b.played - a.played;
      case 'wr':        return b.wr - a.wr;
      default:          return a.d.name.localeCompare(b.d.name);
    }
  });

  // Counter
  const isFiltered = decks.length !== totalDecks;
  html += `<div class="deck-counter">${isFiltered ? `Mostrando <strong>${decks.length}</strong> de <strong>${totalDecks}</strong> mazos` : `<strong>${totalDecks}</strong> mazo${totalDecks !== 1 ? 's' : ''}`}</div>`;

  if(decks.length) {
    html += '<div class="cards-grid">';
    decks.forEach(({ d, played, wr, lastDate }) => {
      const pname = playerName(d.playerId);
      const imgStyle = d.scryfallImg
        ? `background-image:url('${d.scryfallImg}');background-size:cover;background-position:center top;`
        : 'background:var(--bg-raised);';
      const lastUsed = lastDate ? `<span class="deck-last-date">Última: ${formatDate(lastDate)}</span>` : '';
      html += `<div class="deck-card" style="${imgStyle}">
        <div class="deck-card-overlay">
          <div class="deck-pip-row">${(d.colors||[]).map(c=>`<div class="pip pip-${c}">${c}</div>`).join('')}</div>
          <div class="deck-card-body">
            <div class="deck-name">${d.name}</div>
            <div class="deck-commander">${d.commander||'—'}</div>
            <div class="deck-owner">${pname}</div>
            <div class="deck-card-footer">
              <div style="display:flex;flex-direction:column;gap:1px;">
                <span class="deck-stat">${played} partida${played !== 1 ? 's' : ''}</span>
                ${lastUsed}
              </div>
              ${played?`<span class="win-badge">${wr}% WR</span>`:''}
            </div>
            <div class="deck-card-btns">
              <button class="btn btn-sm" onclick="startEditDeck('${d.id}')">editar</button>
              <button class="btn btn-sm btn-danger" onclick="deleteDeck('${d.id}')">eliminar</button>
            </div>
          </div>
        </div>
      </div>`;
    });
    html += '</div>';
  } else {
    html += '<div class="empty-state">No hay mazos que coincidan con los filtros.</div>';
  }
  const ed = editingDeckId ? DB.decks.find(d => d.id === editingDeckId) : null;
  html += `<div class="section-title" style="display:flex;align-items:center;justify-content:space-between;">${ed ? 'Editar mazo' : 'Agregar mazo'}${ed ? `<button class="btn btn-sm" onclick="cancelEditDeck()">Cancelar</button>` : ''}</div><div class="card-box">`;
  html += `<div class="form-row">
    <div class="form-group" style="margin-bottom:0;"><label>Nombre del mazo</label><input type="text" id="d-name" placeholder="Ej: Control Azul" value="${ed ? ed.name : ''}"></div>
    <div class="form-group" style="margin-bottom:0;"><label>Compartir con</label>
      <div id="deck-share-pgs" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;">
        ${(window.AUTH?.playgroups || []).map(pg => {
          const checked = ed ? (ed.sharedWith || []).includes(pg.id) : false;
          return `<label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;font-weight:500;">
            <input type="checkbox" value="${pg.id}" ${checked ? 'checked' : ''} style="accent-color:var(--gold);">
            ${pg.name}
          </label>`;
        }).join('')}
        ${!(window.AUTH?.playgroups || []).length ? '<span style="font-size:12px;color:var(--text-sub);">Sin playgroups todavía</span>' : ''}
      </div>
    </div>
  </div>
  <div class="form-group" style="margin-top:10px;position:relative;">
    <label>Comandante <span style="font-size:11px;color:var(--color-text-secondary);">(buscá por nombre)</span></label>
    <input type="text" id="d-commander" placeholder="Ej: Atraxa, Praetors' Voice" autocomplete="off" oninput="onCommanderInput()" value="${ed ? (ed.commanderFull || ed.commander || '').split(' + ')[0] : ''}">
    <div id="commander-suggestions" style="display:none;position:absolute;z-index:9999;background:var(--color-background-primary, #fff);border:1px solid var(--color-border-secondary);border-radius:var(--border-radius-md);width:100%;max-height:220px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,0.18);top:calc(100% + 2px);left:0;backdrop-filter:none;opacity:1;"></div>
  </div>
  <div id="partner-slot" style="display:${ed && ed.commanderFull && ed.commanderFull.includes(' + ') ? 'block' : 'none'};">
    <div class="form-group" style="margin-top:6px;position:relative;">
      <label id="partner-label">Partner <span style="font-size:11px;color:var(--color-text-secondary);">(segundo comandante)</span></label>
      <input type="text" id="d-commander2" placeholder="Buscá el partner..." autocomplete="off" oninput="onCommander2Input()" value="${ed && ed.commanderFull && ed.commanderFull.includes(' + ') ? ed.commanderFull.split(' + ')[1] : ''}">
      <div id="commander2-suggestions" style="display:none;position:absolute;z-index:9999;background:var(--color-background-primary, #fff);border:1px solid var(--color-border-secondary);border-radius:var(--border-radius-md);width:100%;max-height:220px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,0.18);top:calc(100% + 2px);left:0;"></div>
      <div id="partner-error" style="font-size:11px;color:var(--danger);margin-top:4px;display:none;"></div>
    </div>
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

  // Trigger Scryfall image fetches for any deck without art yet
  DB.decks.forEach(d => { if (d.commander && !d.scryfallImg) fetchCommanderImage(d); });
}

function rerenderDeckForm() {}

// ── Scryfall Commander Autocomplete ──────────────────────────────────────────
let _scryfallTimer = null;
// ── Scryfall Commander Autocomplete ──────────────────────────────────────────
let _commanderCards  = [];
let _commander2Cards = [];
let _selectedCard1   = null; // full Scryfall card object for commander 1
let _selectedCard2   = null; // full Scryfall card object for commander 2

// Helper: detect partner type from a Scryfall card
function getPartnerType(card) {
  const oracle = (card.oracle_text || '') + (card.card_faces?.[0]?.oracle_text || '');
  const kw     = (card.keywords || []).map(k => k.toLowerCase());
  if (kw.includes('choose a background') || oracle.includes('Choose a Background'))
    return 'background_chooser';
  if (/background/i.test(card.type_line) && oracle.includes('Background'))
    return 'background';
  const pwMatch = oracle.match(/Partner with ([^()]+)/);
  if (pwMatch) return { type: 'partner_with', name: pwMatch[1].trim() };
  if (kw.includes('friends forever')) return 'friends_forever';
  if (kw.includes('partner'))        return 'partner';
  if (kw.includes("doctor's companion")) return 'doctors_companion';
  return null;
}

// Helper: check if two cards are a legal partner pair
function areLegalPartners(card1, card2) {
  const p1 = getPartnerType(card1);
  const p2 = getPartnerType(card2);
  if (!p1 || !p2) return { ok: false, msg: `${card2.name} no tiene Partner.` };

  // "Partner with" — must name each other
  if (p1?.type === 'partner_with') {
    if (p1.name.toLowerCase() !== card2.name.toLowerCase())
      return { ok: false, msg: `${card1.name} solo puede ir con ${p1.name}.` };
    return { ok: true };
  }
  if (p2?.type === 'partner_with') {
    if (p2.name.toLowerCase() !== card1.name.toLowerCase())
      return { ok: false, msg: `${card2.name} solo puede ir con ${p2.name}.` };
    return { ok: true };
  }

  // Background — one must be "Choose a Background", other must be a Background
  if (p1 === 'background_chooser' && p2 === 'background') return { ok: true };
  if (p1 === 'background'         && p2 === 'background_chooser') return { ok: true };
  if (p1 === 'background_chooser' || p2 === 'background_chooser' ||
      p1 === 'background'         || p2 === 'background')
    return { ok: false, msg: 'Combinación de Background inválida.' };

  // Friends forever — both must have it
  if (p1 === 'friends_forever' && p2 === 'friends_forever') return { ok: true };
  if (p1 === 'friends_forever' || p2 === 'friends_forever')
    return { ok: false, msg: 'Friends Forever solo puede ir con otro Friends Forever.' };

  // Doctor's companion — both must have it
  if (p1 === 'doctors_companion' && p2 === 'doctors_companion') return { ok: true };
  if (p1 === 'doctors_companion' || p2 === 'doctors_companion')
  return { ok: false, msg: "Doctor's companion solo puede ir con otro Doctor's companion." };

  // Generic Partner — both must have it
  if (p1 === 'partner' && p2 === 'partner') return { ok: true };
  return { ok: false, msg: 'Combinación de Partner inválida.' };
}

// Close dropdowns when clicking outside
document.addEventListener('mousedown', e => {
  ['commander-suggestions','commander2-suggestions'].forEach(id => {
    const sug = document.getElementById(id);
    const inp = document.getElementById(id === 'commander-suggestions' ? 'd-commander' : 'd-commander2');
    if (sug && inp && !sug.contains(e.target) && e.target !== inp)
      sug.style.display = 'none';
  });
  document.querySelectorAll('[id^="deck-suggestions-"]').forEach(el => {
    if (!el.contains(e.target)) el.style.display = 'none';
  });
});

// ── Commander 1 ──
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
  _scryfallTimer = setTimeout(() => fetchCommanderSuggestions(q, 1), 300);
}

// ── Commander 2 ──
let _scryfallTimer2 = null;
function onCommander2Input() {
  const input = document.getElementById('d-commander2');
  if (!input) return;
  const q = input.value.trim();
  clearTimeout(_scryfallTimer2);
  if (q.length < 2) {
    const sug = document.getElementById('commander2-suggestions');
    if (sug) sug.style.display = 'none';
    return;
  }
  // For "partner with", filter to just the specific partner
  const p1 = _selectedCard1 ? getPartnerType(_selectedCard1) : null;
  let extraFilter = '';
  if (p1?.type === 'partner_with') extraFilter = `+!"${p1.name}"`;
  else if (p1 === 'background_chooser') extraFilter = '+t:background+-is:commander';
  else if (p1 === 'background')         extraFilter = '+o:"Choose a Background"';
  else if (p1 === 'friends_forever')    extraFilter = '+o:"Friends forever"';
  else if (p1 === 'partner')            extraFilter = '+o:"Partner"';
  else if (p1 === 'doctors_companion')  extraFilter = `+o:"Doctor's companion"`;
  _scryfallTimer2 = setTimeout(() => fetchCommanderSuggestions(q, 2, extraFilter), 300);
}

async function fetchCommanderSuggestions(q, slot = 1, extraFilter = '') {
  const sugId = slot === 1 ? 'commander-suggestions' : 'commander2-suggestions';
  const sugEl = document.getElementById(sugId);
  if (!sugEl) return;
  sugEl.style.display = 'block';
  sugEl.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--color-text-secondary);">Buscando...</div>';
  try {
    const base = slot === 1
      ? `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}+is:commander&order=name&unique=cards`
      : `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}+is:commander${extraFilter}&order=name&unique=cards`;
    const res  = await fetch(base);
    if (!res.ok) { sugEl.style.display = 'none'; return; }
    const data = await res.json();
    if (!data.data?.length) {
      sugEl.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--color-text-secondary);">Sin resultados</div>';
      return;
    }
    const cards = data.data.slice(0, 8);
    if (slot === 1) _commanderCards  = cards;
    else            _commander2Cards = cards;

    sugEl.innerHTML = cards.map((card, idx) => {
      const colors = card.color_identity || [];
      const pips   = colors.length
        ? colors.map(c => `<span class="pip pip-${c}" style="width:12px;height:12px;font-size:7px;">${c}</span>`).join('')
        : `<span class="pip pip-C" style="width:12px;height:12px;font-size:7px;">C</span>`;
      const pt = getPartnerType(card);
      const partnerLabels = {
        partner:            'Partner',
        partner_with:       `Partner with`,
        background_chooser: 'Choose a Background',
        background:         'Background',
        friends_forever:    'Friends Forever',
        doctors_companion:  "Doctor's Companion",
      };
      const ptLabel = pt ? (partnerLabels[pt] || partnerLabels[pt?.type] || 'Partner') : null;
      const partnerBadge = ptLabel
      ? `<span style="font-size:9px;color:var(--gold);border:1px solid var(--gold-border);border-radius:10px;padding:1px 5px;margin-left:4px;">${ptLabel}</span>`
      : '';
      return `<div
        onmousedown="${slot === 1 ? 'selectCommander' : 'selectCommander2'}(${idx})"
        style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;border-bottom:0.5px solid var(--color-border-tertiary);font-size:13px;"
        onmouseover="this.style.background='var(--color-background-secondary)'"
        onmouseout="this.style.background=''">
        <div style="display:flex;gap:2px;">${pips}</div>
        <span style="flex:1;">${card.name}</span>
        ${partnerBadge}
      </div>`;
    }).join('');
  } catch(e) {
    sugEl.style.display = 'none';
  }
}

function applyColors(colors1, colors2 = []) {
  const merged = [...new Set([...colors1, ...colors2])];
  // If both incoloress, stay colorless; otherwise remove C if any color present
  const final = merged.length === 0 || (merged.length === 1 && merged[0] === 'C')
    ? ['C']
    : merged.filter(c => c !== 'C').length > 0 ? merged.filter(c => c !== 'C') : merged;
  const picker = document.getElementById('color-picker');
  if (picker) { picker.style.pointerEvents = 'none'; picker.style.opacity = '1'; }
  document.querySelectorAll('#color-picker input').forEach(cb => {
    cb.disabled = false;
    cb.checked  = final.includes(cb.value);
    cb.disabled = true;
  });
  const hint = document.getElementById('colors-auto-hint');
  if (hint) hint.style.display = 'inline';
  const manualHint = document.getElementById('colors-manual-hint');
  if (manualHint) manualHint.style.display = 'none';
}

function selectCommander(idx) {
  const card = _commanderCards[idx];
  if (!card) return;
  _selectedCard1 = card;
  _selectedCard2 = null; // reset partner if commander changes

  const input = document.getElementById('d-commander');
  if (input) input.value = card.name;

  // Close dropdown
  const sugEl = document.getElementById('commander-suggestions');
  if (sugEl) sugEl.style.display = 'none';

  // Show/hide partner slot
  const pt = getPartnerType(card);
  const partnerSlot = document.getElementById('partner-slot');
  if (partnerSlot) {
    if (pt) {
      partnerSlot.style.display = 'block';
      // Update partner label to be more specific
      const lbl = document.getElementById('partner-label');
      if (lbl) {
        if (pt?.type === 'partner_with') lbl.innerHTML = `Partner — debe ser <strong>${pt.name}</strong>`;
        else if (pt === 'background_chooser') lbl.innerHTML = 'Background <span style="font-size:11px;color:var(--color-text-secondary);">(elegí un Background)</span>';
        else if (pt === 'background') lbl.innerHTML = 'Commander <span style="font-size:11px;color:var(--color-text-secondary);">(elegí uno con Choose a Background)</span>';
        else if (pt === 'friends_forever') lbl.innerHTML = 'Friends Forever <span style="font-size:11px;color:var(--color-text-secondary);">(elegí otro Friends Forever)</span>';
        else lbl.innerHTML = 'Partner <span style="font-size:11px;color:var(--color-text-secondary);">(segundo comandante)</span>';
      }
      // Clear partner input and error
      const inp2 = document.getElementById('d-commander2');
      if (inp2) inp2.value = '';
      const err = document.getElementById('partner-error');
      if (err) err.style.display = 'none';
    } else {
      partnerSlot.style.display = 'none';
    }
  }

  // Apply colors from card 1 only (card 2 not selected yet)
  applyColors(card.color_identity || []);
}

function selectCommander2(idx) {
  const card = _commander2Cards[idx];
  if (!card) return;

  // Validate against commander 1
  if (_selectedCard1) {
    // Check not the same card
    if (card.name.toLowerCase() === _selectedCard1.name.toLowerCase()) {
      const err = document.getElementById('partner-error');
      if (err) { err.textContent = 'No podés usar el mismo comandante dos veces.'; err.style.display = 'block'; }
      return;
    }
    const check = areLegalPartners(_selectedCard1, card);
    if (!check.ok) {
      const err = document.getElementById('partner-error');
      if (err) { err.textContent = check.msg; err.style.display = 'block'; }
      return;
    }
  }

  _selectedCard2 = card;
  const input = document.getElementById('d-commander2');
  if (input) input.value = card.name;
  const sugEl = document.getElementById('commander2-suggestions');
  if (sugEl) sugEl.style.display = 'none';
  const err = document.getElementById('partner-error');
  if (err) err.style.display = 'none';

  // Merge colors from both commanders
  const c1 = _selectedCard1?.color_identity || [];
  const c2 = card.color_identity || [];
  applyColors(c1, c2);
}
// ─────────────────────────────────────────────────────────────────────────────

function addDeck() {
  const pid = window.AUTH?.user?.uid;
  if (!pid) { alert('No estás logueado.'); return; }
  const name = document.getElementById('d-name').value.trim();
  const commander1 = document.getElementById('d-commander')?.value.trim() || '';
  const commander2 = document.getElementById('d-commander2')?.value.trim() || '';
  const commanderFull = commander2 ? `${commander1} + ${commander2}` : commander1;
  if (!name) { alert('Ingresá un nombre para el mazo.'); return; }
  if (!commander1) { alert('Buscá y seleccioná un comandante.'); return; }
  // Validate partner if slot is visible and has text
  if (commander2 && _selectedCard1 && _selectedCard2) {
    const check = areLegalPartners(_selectedCard1, _selectedCard2);
    if (!check.ok) { alert(check.msg); return; }
  }
  const colors = [...document.querySelectorAll('#color-picker input:checked')].map(c => c.value);
  if (colors.length === 0) { alert('Seleccioná al menos un color para el mazo.'); return; }
  const sharedWith = [...document.querySelectorAll('#deck-share-pgs input:checked')].map(cb => cb.value);
  DB.decks.push({ id: uid(), playerId: pid, name, commander: commanderFull, commanderFull, colors, sharedWith, createdAt: Date.now() });
  save(); renderAll();
}

function deleteDeck(id) {
  if(!confirm('¿Eliminar este mazo?')) return;
  DB.decks = DB.decks.filter(d=>d.id!==id);
  deleteAppDeck(id).catch(e => console.error('Delete deck error:', e));
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
  const name = document.getElementById('d-name').value.trim();
  const commander1 = document.getElementById('d-commander')?.value.trim() || '';
  const commander2 = document.getElementById('d-commander2')?.value.trim() || '';
  const commanderFull = commander2 ? `${commander1} + ${commander2}` : commander1;
  if (!name) { alert('Ingresá un nombre para el mazo.'); return; }
  if (commander2 && _selectedCard1 && _selectedCard2) {
    const check = areLegalPartners(_selectedCard1, _selectedCard2);
    if (!check.ok) { alert(check.msg); return; }
  }
  const colors = [...document.querySelectorAll('#color-picker input:checked')].map(c => c.value);
  if (!colors.length) { alert('Seleccioná al menos un color (buscá el comandante para autodetectarlos).'); return; }
  const deck = DB.decks.find(d => d.id === editingDeckId);
  if (!deck) return;
  // Clear cached image if commander changed
  if (deck.commander !== commanderFull) {
    deck.scryfallImg = null;
    const cacheKey = (deck.commander || '').toLowerCase();
    if (_imgCache[cacheKey] !== undefined) delete _imgCache[cacheKey];
  }
  deck.name = name;
  deck.commander = commanderFull;
  deck.commanderFull = commanderFull;
  deck.colors = colors;
  deck.sharedWith = [...document.querySelectorAll('#deck-share-pgs input:checked')].map(cb => cb.value);
  editingDeckId = null;
  save(); renderAll();
}

// ── Deck sort/filter helpers ───────────────────────────────────────────────
function setDeckSort(key) { deckSort = key; renderDecks(); }
function setDeckSearch(val) { deckSearch = val; renderDecks(); }
function setDeckFilter(key, val) { deckFilters[key] = val; renderDecks(); }
function clearDeckFilters() {
  deckSearch = '';
  deckFilters = { owner:'', minPlayed:'', maxPlayed:'', minWR:'', maxWR:'', fromDate:'', toDate:'' };
  renderDecks();
}

// ── Scryfall image fetcher ─────────────────────────────────────────────────
const _imgCache = {};
async function fetchCommanderImage(deck) {
  if (!deck.commander || deck.scryfallImg) return;
  // Use only first commander name for art (e.g. "Sidar + Tana" -> "Sidar")
  const primaryName = deck.commander.split(' + ')[0].trim();
  const key = primaryName.toLowerCase();
  if (_imgCache[key] === null) return; // known miss
  if (_imgCache[key]) { deck.scryfallImg = _imgCache[key]; renderDecks(); return; }
  try {
    const url = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(primaryName)}&format=json`;
    const res = await fetch(url);
    if (!res.ok) { _imgCache[key] = null; return; }
    const card = await res.json();
    // Prefer art_crop, fall back to large face or small
    let img = null;
    if (card.image_uris) {
      img = card.image_uris.art_crop || card.image_uris.large;
    } else if (card.card_faces && card.card_faces[0].image_uris) {
      img = card.card_faces[0].image_uris.art_crop || card.card_faces[0].image_uris.large;
    }
    _imgCache[key] = img || null;
    if (img) { deck.scryfallImg = img; renderDecks(); }
  } catch(e) { _imgCache[key] = null; }
}
// ─────────────────────────────────────────────────────────────────────────────

function addFFASlot() {
  if(window.ffaSlots.length >= 8) return;

  window.ffaSlots.push({
    playerId: "",
    deckId: ""
  });

  renderMatch();
}

function onDeckInput(slotKey, value) {
  const el = document.getElementById(`deck-suggestions-${slotKey}`);
  if (!el) return;
  const q = value.toLowerCase();
  if (q.length < 2) { el.style.display = 'none'; return; }

  const myUid  = window.AUTH?.user?.uid;
  const hasPg  = !!matchPlaygroupId;

  // Determine which player owns this slot (to detect "is me")
  let slotPlayerId = null;
  if (typeof slotKey === 'number') {
    slotPlayerId = window.ffaSlots[slotKey]?.playerId;
  } else {
    const [t, i] = slotKey.replace('t','').split('_').map(Number);
    slotPlayerId = window.teamSlots?.[t]?.[i]?.playerId;
  }
  const isMe = slotPlayerId === myUid;

  if (hasPg || isMe) {
    // ── Playgroup or "I am this player" → search existing decks ──
    let availableDecks = DB.decks.filter(d =>
      d.playerId?.startsWith('guest_') ||
      (d.sharedWith || []).includes(matchPlaygroupId) ||
      d.playerId === myUid
    );
    if (!hasPg) availableDecks = DB.decks.filter(d => d.playerId === myUid);

    const matches = availableDecks.filter(d =>
      d.name.toLowerCase().includes(q) ||
      (d.commander || '').toLowerCase().includes(q) ||
      playerName(d.playerId).toLowerCase().includes(q)
    ).slice(0, 6);

    if (!matches.length) {
      el.innerHTML = `<div style="padding:8px;font-size:12px;color:var(--text-sub);">Sin resultados</div>`;
      el.style.display = 'block';
      return;
    }
    el.innerHTML = matches.map(d => {
      const owner = playerName(d.playerId);
      return `<div onmousedown="selectDeck('${slotKey}', '${d.id}')"
        style="padding:8px 12px;cursor:pointer;font-size:13px;"
        onmouseover="this.style.background='var(--color-background-secondary)'"
        onmouseout="this.style.background=''">
        ${d.name} <span style="font-size:11px;color:var(--gold);">${d.commander || ''}</span>
        <span style="font-size:11px;color:var(--text-sub);">(${owner})</span>
      </div>`;
    }).join('');
    el.style.display = 'block';

  } else {
    // ── Personal mode, not me → search Scryfall for commander name ──
    clearTimeout(window._deckScryfallTimer);
    el.innerHTML = `<div style="padding:8px;font-size:12px;color:var(--text-sub);">Buscando...</div>`;
    el.style.display = 'block';
    window._deckScryfallTimer = setTimeout(async () => {
      try {
        const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}+is:commander&order=name&unique=cards`;
        const res  = await fetch(url);
        if (!res.ok) { el.style.display = 'none'; return; }
        const data = await res.json();
        if (!data.data?.length) {
          el.innerHTML = `<div style="padding:8px;font-size:12px;color:var(--text-sub);">Sin resultados</div>`;
          return;
        }
        const cards = data.data.slice(0, 6);
        el.innerHTML = cards.map(card => {
          const colors = (card.color_identity || []);
          const pips = colors.length
            ? colors.map(c => `<span class="pip pip-${c}" style="width:11px;height:11px;font-size:7px;">${c}</span>`).join('')
            : `<span class="pip pip-C" style="width:11px;height:11px;font-size:7px;">C</span>`;
          return `<div
            onmousedown="selectScryfallDeck('${slotKey}', '${card.name.replace(/'/g,"\\'")}', '${JSON.stringify(colors).replace(/'/g,'').replace(/"/g,'')}' )"
            style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;"
            onmouseover="this.style.background='var(--color-background-secondary)'"
            onmouseout="this.style.background=''">
            <div style="display:flex;gap:2px;">${pips}</div>
            <span>${card.name}</span>
          </div>`;
        }).join('');
        el.style.display = 'block';
        // Store cards for selection
        el._scryfallCards = cards;
      } catch(e) { el.style.display = 'none'; }
    }, 300);
  }
}

function selectScryfallDeck(slotKey, cardName, colorsStr) {
  // For personal mode: store commander name as label, no real deckId
  const label = cardName;
  _setSlotDeckLabel(slotKey, null, label);
  const input = document.getElementById(`deck-input-${slotKey}`);
  if (input) input.value = label;
  const el = document.getElementById(`deck-suggestions-${slotKey}`);
  if (el) el.style.display = 'none';
}

function selectDeck(slotKey, deckId) {
  const d = deckOf(deckId);
  if (!d) return;
  const label = `${d.name} - ${d.commander || '—'}`;
  _setSlotDeckLabel(slotKey, deckId, label);
  const input = document.getElementById(`deck-input-${slotKey}`);
  if (input) input.value = label;
  const el = document.getElementById(`deck-suggestions-${slotKey}`);
  if (el) el.style.display = 'none';
}

function _setSlotDeckLabel(slotKey, deckId, label) {
  if (typeof slotKey === 'number' || /^\d+$/.test(String(slotKey))) {
    const i = parseInt(slotKey);
    window.ffaSlots[i].deckId    = deckId || '';
    window.ffaSlots[i].deckLabel = deckId ? '' : label; // label only for non-deck (Scryfall)
  } else {
    const [t, i] = slotKey.replace('t','').split('_').map(Number);
    if (!window.teamSlots[t]) window.teamSlots[t] = [];
    if (!window.teamSlots[t][i]) window.teamSlots[t][i] = {};
    window.teamSlots[t][i].deckId    = deckId || '';
    window.teamSlots[t][i].deckLabel = deckId ? '' : label;
  }
}

function removeFFASlot(index) {
  if(window.ffaSlots.length <= 1) return;

  window.ffaSlots.splice(index, 1);
  renderMatch();
}

function updateFFASlotPlayer(i, playerId) {
  window.ffaSlots[i].playerId   = playerId;
  window.ffaSlots[i].playerName = '';
  window.ffaSlots[i].deckId     = '';
  window.ffaSlots[i].deckLabel  = '';
  renderMatch();
}

function updateFFASlotPlayerName(i, name) {
  window.ffaSlots[i].playerId   = '';
  window.ffaSlots[i].playerName = name;
  window.ffaSlots[i].deckId     = '';
  window.ffaSlots[i].deckLabel  = '';
  // Check if name matches current user
  const myName = window.AUTH?.user?.displayName || '';
  if (name && myName && name.toLowerCase() === myName.toLowerCase()) {
    window.ffaSlots[i].playerId = window.AUTH.user.uid;
    renderMatch(); // re-render to switch to deck picker
  }
}

function updateTeamSlotPlayerName(t, i, name) {
  if (!window.teamSlots[t]) window.teamSlots[t] = [];
  if (!window.teamSlots[t][i]) window.teamSlots[t][i] = {};
  window.teamSlots[t][i].playerId   = '';
  window.teamSlots[t][i].playerName = name;
  window.teamSlots[t][i].deckId     = '';
  window.teamSlots[t][i].deckLabel  = '';
  const myName = window.AUTH?.user?.displayName || '';
  if (name && myName && name.toLowerCase() === myName.toLowerCase()) {
    window.teamSlots[t][i].playerId = window.AUTH.user.uid;
    renderMatch();
  }
}

function updateFFASlotDeck(i, value) {
  const deck = DB.decks.find(d => {
    const owner = playerName(d.playerId);
    const label = `${d.name} - ${d.commander || '—'} (${owner})`;
    return label === value;
  });

  window.ffaSlots[i].deckId = deck ? deck.id : "";
}

function startSession() {
  if (DB.sessions.some(s => !s.endedAt)) {
    alert("Ya hay una sesión activa");
    return;
  }

  const name = prompt("Nombre de la sesión (ej: Viernes EDH)");
  if (!name) return;

  const session = {
    id: uid(),
    name,
    startedAt: Date.now(),
    endedAt: null
  };

  DB.sessions.push(session);
  currentSessionId = session.id;
  
  save();
  renderMatch();
}

function endSession() {
  if (!currentSessionId) return;

  const s = DB.sessions.find(s => s.id === currentSessionId);
  if (s) s.endedAt = Date.now();

  currentSessionId = null;

  save();
  renderMatch();
}

function renderMatch() {
  const el = document.getElementById('tab-match');

  let html = `<div class="card-box">`;

  html += renderSessionBar();
  html += renderMatchPlaygroupSelector(); // playgroup FIRST — drives player/deck context
  html += renderMatchType();
  html += renderMatchSlotsWrapper();
  html += renderMatchFooter();

  html += `</div>`;

  el.innerHTML = html;
}

function renderSessionBar() {
  if (currentSessionId) {
    const s = DB.sessions.find(s => s.id === currentSessionId);

    return `
      <div style="margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;">
        <div style="font-size:12px;color:var(--color-text-success);">
          🟢 Sesión activa: ${s ? s.name : 'Sesión'}
        </div>
        <button class="btn btn-sm" onclick="endSession()">Cerrar sesión</button>
      </div>
    `;
  }

  return `
    <div style="margin-bottom:10px;">
      <button class="btn btn-sm" onclick="startSession()">Nueva sesión</button>
    </div>
  `;
}

function renderMatchPlaygroupSelector() {
  const pgs = window.AUTH?.playgroups || [];
  if (!pgs.length) return '';

  const options = pgs.map(pg =>
    `<option value="${pg.id}" ${matchPlaygroupId === pg.id ? 'selected' : ''}>${pg.name}</option>`
  ).join('');

  return `<div style="margin-bottom:14px;">
    <div class="section-title" style="margin-bottom:8px;">Playgroup</div>
    <select id="m-playgroup" onchange="setMatchPlaygroup(this.value)" style="max-width:260px;">
      <option value="">— partida personal —</option>
      ${options}
    </select>
    ${matchPlaygroupId
      ? `<div style="font-size:11px;color:var(--text-sub);margin-top:5px;">Jugadores y mazos limitados al playgroup.</div>`
      : `<div style="font-size:11px;color:var(--text-sub);margin-top:5px;">Sin playgroup: ingresá jugadores y mazos manualmente.</div>`
    }
  </div>`;
}

function renderMatchType() {
  return `
    <div class="section-title">Tipo de partida</div>
    <div class="type-toggle">
      <button class="type-btn${matchType==='ffa'?' active':''}" onclick="setMatchType('ffa')">Todos contra Todos</button>
      <button class="type-btn${matchType==='2v2'?' active':''}" onclick="setMatchType('2v2')">Por Equipos</button>
    </div>
  `;
}

function renderMatchSlotsWrapper() {
  let html = '<div id="match-slots">';

  if (matchType === 'ffa') {
    html += renderFFA();
  } else {
    html += renderTeams();
  }

  html += '</div>';

  return html;
}

function renderFFA() {
  let html = '';
  const slots      = window.ffaSlots;
  const myUid      = window.AUTH?.user?.uid;
  const hasPg      = !!matchPlaygroupId;
  const pg         = hasPg ? (window.AUTH?.playgroups || []).find(p => p.id === matchPlaygroupId) : null;
  const pgMembers  = pg ? Object.entries(pg.members || {}).map(([id, m]) => ({ id, name: m.displayName })) : [];

  const usedPlayers = slots.map(s => s.playerId).filter(Boolean);

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const isMe = slot.playerId === myUid;

    // Deck label for existing selection
    const deckLabel = slot.deckId
      ? (() => {
          const d = deckOf(slot.deckId);
          return d ? `${d.name} - ${d.commander || '—'}` : (slot.deckLabel || '');
        })()
      : (slot.deckLabel || '');

    // Player selector: dropdown if playgroup, text input if personal
    const playerControl = hasPg
      ? `<select style="flex:0 0 160px;" onchange="updateFFASlotPlayer(${i}, this.value)">
          <option value="">Seleccionar jugador</option>
          ${pgMembers
            .filter(m => !usedPlayers.includes(m.id) || m.id === slot.playerId)
            .map(m => `<option value="${m.id}" ${m.id === slot.playerId ? 'selected' : ''}>${m.name}</option>`)
            .join('')}
        </select>`
      : `<input type="text" style="flex:0 0 160px;"
          placeholder="Nombre del jugador"
          value="${slot.playerName || ''}"
          oninput="updateFFASlotPlayerName(${i}, this.value)"
          autocomplete="off">`;

    html += `
    <div class="player-slot" style="display:flex;align-items:center;gap:6px;">
      ${slots.length > 1 ? `<button class="btn btn-sm btn-danger" onclick="removeFFASlot(${i})">×</button>` : ''}

      ${playerControl}

      <div style="position:relative; flex:1;">
        <input
          type="text"
          style="width:100%;"
          id="deck-input-${i}"
          placeholder="${hasPg || isMe ? 'Buscar mazo' : 'Comandante del mazo'}"
          value="${deckLabel}"
          oninput="onDeckInput(${i}, this.value)"
          onclick="this.select()"
          onfocus="this.select()"
          autocomplete="off"
        >
        <div id="deck-suggestions-${i}" class="deck-suggestions"></div>
      </div>

      <label class="won-toggle">
        <input type="radio" name="ffa-result" value="win-${i}"> ganó
      </label>
    </div>`;
  }

  if (slots.length < 8) {
    html += `<button class="btn btn-sm" style="margin-top:6px;" onclick="addFFASlot()">+ Agregar jugador</button>`;
  }

  html += `
  <div style="margin-top:10px;">
    <label class="won-toggle">
      <input type="radio" name="ffa-result" value="draw"> Empate
    </label>
  </div>`;

  return html;
}

function renderTeams() {
  let html = '';
  const { numTeams, playersPerTeam } = window.teamConfig;
  const slots      = window.teamSlots;
  const myUid      = window.AUTH?.user?.uid;
  const hasPg      = !!matchPlaygroupId;
  const pg         = hasPg ? (window.AUTH?.playgroups || []).find(p => p.id === matchPlaygroupId) : null;
  const pgMembers  = pg ? Object.entries(pg.members || {}).map(([id, m]) => ({ id, name: m.displayName })) : [];
  const usedPlayers = window.teamSlots.flat().map(s => s.playerId).filter(Boolean);

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
  const teamNames  = ['Equipo 1','Equipo 2','Equipo 3','Equipo 4'];

  for (let t = 0; t < numTeams; t++) {
    const tSlots = slots[t] || [];
    html += `<div style="border-left:3px solid ${teamColors[t]};padding-left:10px;margin-bottom:12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <div style="font-size:13px;font-weight:500;color:var(--color-text-primary);">${teamNames[t]}</div>
        <label class="won-toggle"><input type="radio" name="team-result" value="${t}"> ganó</label>
      </div>`;

    for (let i = 0; i < playersPerTeam; i++) {
      const slot  = tSlots[i] || { playerId: '', deckId: '' };
      const isMe  = slot.playerId === myUid;
      const deckLabel = slot.deckId
        ? (() => { const d = deckOf(slot.deckId); return d ? `${d.name} - ${d.commander || '—'}` : (slot.deckLabel || ''); })()
        : (slot.deckLabel || '');
      const slotKey = `t${t}_${i}`;

      const playerControl = hasPg
        ? `<select onchange="updateTeamSlotPlayer(${t},${i},this.value)">
            <option value="">Seleccionar jugador</option>
            ${pgMembers
              .filter(m => !usedPlayers.includes(m.id) || m.id === slot.playerId)
              .map(m => `<option value="${m.id}" ${m.id === slot.playerId ? 'selected' : ''}>${m.name}</option>`)
              .join('')}
          </select>`
        : `<input type="text" placeholder="Nombre del jugador"
            value="${slot.playerName || ''}"
            oninput="updateTeamSlotPlayerName(${t},${i},this.value)"
            autocomplete="off">`;

      html += `<div class="player-slot" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:6px;">
        ${playerControl}
        <div style="position:relative;">
          <input type="text" id="deck-input-${slotKey}"
            placeholder="${hasPg || isMe ? 'Buscar mazo' : 'Comandante del mazo'}"
            value="${deckLabel}"
            oninput="onDeckInput('${slotKey}', this.value)"
            onclick="this.select()"
            autocomplete="off">
          <div id="deck-suggestions-${slotKey}" class="deck-suggestions"></div>
        </div>
      </div>`;
    }
    html += '</div>';
  }

  html += `<div style="margin:4px 0 6px;">
    <label class="won-toggle"><input type="radio" name="team-result" value="draw"> Empate</label>
  </div>`;
  return html;
}

function renderMatchFooter() {
  const pgs = window.AUTH?.playgroups || [];
  const pgOptions = pgs.map(pg =>
    `<option value="${pg.id}" ${matchPlaygroupId === pg.id ? 'selected' : ''}>${pg.name}</option>`
  ).join('');

  return `
  <div style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
    <div class="form-group" style="margin-bottom:0;">
      <label>Fecha</label>
      <input type="date" id="m-date" style="max-width:160px;" value="${new Date().toISOString().slice(0,10)}">
    </div>
  </div>
  <div style="margin-top:12px;display:flex;gap:8px;align-items:center;">
    <button class="btn btn-gold" onclick="saveMatch()">${editingMatchId ? 'Guardar cambios' : 'Guardar partida'}</button>
    ${editingMatchId ? `<button class="btn" onclick="cancelEditMatch()">Cancelar</button>` : ''}
  </div>
  `;
}

function setMatchType(t) { matchType = t; renderMatch(); }

function setMatchPlaygroup(pgId) {
  matchPlaygroupId = pgId || null;
  renderMatch(); // re-renderiza para filtrar los mazos disponibles
}

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
        if(!slot.playerId && !slot.deckId && !slot.playerName && !slot.deckLabel) continue;
        const won = value === "draw" ? false : String(t) === value;
        slots.push({
          playerId:   slot.playerId   || null,
          playerName: slot.playerName || null,
          deckId:     slot.deckId     || null,
          deckLabel:  slot.deckLabel  || null,
          team: t, won, draw: value === "draw"
        });
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
    createdAt: Date.now(),
    playgroupId: matchPlaygroupId || null,    
    sessionId: currentSessionId,   
    tournamentId,
    slots
  };

  if (editingMatchId) {
    DB.matches = DB.matches.map(m => m.id === editingMatchId ? newMatch : m);
    editingMatchId = null;
  } else {
    DB.matches.push(newMatch);
  }

  if (matchPlaygroupId) {
  // Guardar directamente en el playgroup seleccionado
  const prevPgId = window.AUTH.pgId;
  window.AUTH.pgId = matchPlaygroupId;
  saveAppData(window.DB).catch(e => console.error('Save error:', e));
  window.AUTH.pgId = prevPgId;
  } else {
  save();
  }
  matchPlaygroupId = null; // reset
  renderAll();
  showTab('history');
}


function renderHistory() {
  const el = document.getElementById('tab-history');
  const myUid = window.AUTH?.user?.uid;

  // Only show MY matches
  const myMatches = DB.matches.filter(m => m.slots?.some(s => s.playerId === myUid));

  if (!myMatches.length) {
    el.innerHTML = '<div class="empty-state">No hay partidas tuyas registradas todavía.</div>';
    return;
  }

  let html = `<div class="card-box deck-toolbar" style="margin-bottom:10px;">
    <div class="deck-toolbar-row">
      <span class="toolbar-row-label">Filtrar</span>
      <div class="deck-toolbar-group">
        <div class="toolbar-range-group">
          <span class="toolbar-range-label">Desde</span>
          <input type="date" value="${historyFilters.fromDate}" onchange="setHistoryFilter('fromDate', this.value)" class="toolbar-date">
        </div>
        <div class="toolbar-range-group">
          <span class="toolbar-range-label">Hasta</span>
          <input type="date" value="${historyFilters.toDate}" onchange="setHistoryFilter('toDate', this.value)" class="toolbar-date">
        </div>
        <select onchange="setHistoryFilter('sessionId', this.value)" class="toolbar-select">
          <option value="">Todas las sesiones</option>
          ${DB.sessions.map(s=>`<option value="${s.id}" ${s.id === historyFilters.sessionId ? 'selected' : ''}>${s.name}</option>`).join('')}
        </select>
        <select onchange="setHistoryFilter('tournamentId', this.value)" class="toolbar-select">
          <option value="">Todos los torneos</option>
          ${DB.tournaments.map(t=>`<option value="${t.id}" ${t.id === historyFilters.tournamentId ? 'selected' : ''}>${t.name}</option>`).join('')}
          <option value="none" ${historyFilters.tournamentId === 'none' ? 'selected' : ''}>Sin torneo</option>
        </select>
        ${(historyFilters.fromDate||historyFilters.toDate||historyFilters.sessionId||historyFilters.tournamentId)
          ? `<button class="btn btn-sm" onclick="clearHistoryFilters()">Limpiar</button>` : ''}
      </div>
    </div>
  </div>`;

  const filtered = applyHistoryFilters(myMatches);
  const sorted = [...filtered].sort((a,b) => (b.date||'').localeCompare(a.date||''));

  // Build a pg lookup map for the badge
  const pgMap = {};
  (window.AUTH?.playgroups || []).forEach(pg => { pgMap[pg.id] = pg.name; });

  sorted.forEach(m => {
    const t       = m.tournamentId ? DB.tournaments.find(t => t.id === m.tournamentId) : null;
    const session = m.sessionId    ? DB.sessions.find(s => s.id === m.sessionId)       : null;
    const pgName  = m.playgroupId  ? pgMap[m.playgroupId] : null;
    html += `<div class="history-item">
      <div class="history-date">${formatDate(m.date)}</div>
      <div class="history-type">${m.type==='ffa'?'Free':'Team'}</div>
      ${pgName ? `<span class="tag-playgroup">${pgName}</span>` : ''}
      ${t ? `<span class="tag-tournament">${t.name}</span>` : ''}
      <div style="flex:1;min-width:0;">
        ${m.slots.map(s=>`<span style="font-size:12px;margin-right:8px;${s.won?'color:var(--color-text-success);font-weight:500;':'color:var(--color-text-secondary);'}">${slotPlayerDisplay(s)}: ${slotDeckDisplay(s)}${s.won?' ✓':''}</span>`).join('')}
      </div>
      ${session ? `<span class="tag-session">${session.name}</span>` : ''}
      <button class="btn btn-sm" onclick="editMatch('${m.id}')">editar</button>
      <button class="btn btn-sm btn-danger" onclick="deleteMatch('${m.id}')">×</button>
    </div>`;
  });
  el.innerHTML = html;
}

function applyHistoryFilters(matches) {
  return matches.filter(m => {

    // 📅 Fecha
    if (historyFilters.fromDate && m.date < historyFilters.fromDate) return false;
    if (historyFilters.toDate && m.date > historyFilters.toDate) return false;

    // 👤 Jugador
    if (historyFilters.playerId) {
      const played = m.slots?.some(s => s.playerId === historyFilters.playerId);
      if (!played) return false;
    }

    // 🧾 Sesión
    if (historyFilters.sessionId) {
      if (m.sessionId !== historyFilters.sessionId) return false;
    }

    // 🏆 Torneo (nuevo sistema)
    if (historyFilters.tournamentId) {
      if (historyFilters.tournamentId === "none") {
        if (m.tournamentId) return false;
      } else {
        if (m.tournamentId !== historyFilters.tournamentId) return false;
      }
    }

    return true;
  });
}

function setHistoryFilter(key, value) {
  historyFilters[key] = value;
  renderHistory();
}

function clearHistoryFilters() {
  historyFilters = {
    playerId: "",
    fromDate: "",
    toDate: "",
    sessionId: "",
    tournament: "all",
    playgroupId: ""
  };
  renderHistory();
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
  const myUid    = window.AUTH?.user?.uid;
  const myDecks  = DB.decks.filter(d => d.playerId === myUid);
  const myMatches = DB.matches.filter(m => m.slots?.some(s => s.playerId === myUid));
  const myWins   = myMatches.filter(m => m.slots?.some(s => s.playerId === myUid && s.won));
  const wr       = myMatches.length ? Math.round(myWins.length / myMatches.length * 100) : 0;
  const ffa      = myMatches.filter(m => m.type === 'ffa').length;
  const v2       = myMatches.filter(m => m.type === '2v2').length;

  let html = `<div class="stats-grid">
    <div class="stat-card"><div class="stat-label">Mis partidas</div><div class="stat-value">${myMatches.length}</div><div class="stat-sub">FFA: ${ffa} · 2v2: ${v2}</div></div>
    <div class="stat-card"><div class="stat-label">Mi Win Rate</div><div class="stat-value">${wr}%</div><div class="stat-sub">${myWins.length} victorias</div></div>
    <div class="stat-card"><div class="stat-label">Mis Mazos</div><div class="stat-value">${myDecks.length}</div><div class="stat-sub">${myDecks.filter(d => d.sharedWith?.length).length} compartidos</div></div>
  </div>`;

  // My decks WR
  if (myDecks.length) {
    html += '<div class="section-title">Win rate por mazo</div>';
    const deckStats = myDecks.map(d => {
      const ms   = myMatches.filter(m => m.slots?.some(s => s.deckId === d.id));
      const wins = ms.filter(m => m.slots.some(s => s.deckId === d.id && s.won)).length;
      const dwr  = ms.length ? Math.round(wins / ms.length * 100) : 0;
      return { name: d.name, played: ms.length, wins, wr: dwr };
    }).sort((a,b) => b.wr - a.wr || b.played - a.played);
    if (deckStats.some(d => d.played > 0)) {
      html += deckStats.filter(d => d.played > 0).map(d => `<div class="bar-row">
        <div class="bar-label">${d.name}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${d.wr}%"></div></div>
        <div class="bar-pct">${d.wr}%</div>
        <div style="font-size:11px;color:var(--text-sub);min-width:40px;text-align:right;">${d.wins}/${d.played}</div>
      </div>`).join('');
    } else {
      html += '<div class="empty-state">Jugá partidas para ver estadísticas.</div>';
    }
  }

  // Position in each playgroup
  const pgs = window.AUTH?.playgroups || [];
  if (pgs.length) {
    html += '<div class="section-title" style="margin-top:1.25rem;">Mi posición por playgroup</div>';
    pgs.forEach(pg => {
      const pgData = window._pgCache?.[pg.id];
      if (!pgData) {
        html += `<div class="card-box" style="margin-bottom:8px;padding:10px 14px;">
          <div style="font-size:13px;font-weight:600;margin-bottom:6px;">${pg.name}</div>
          <div style="font-size:12px;color:var(--text-sub);">Cargando datos... <button class="btn btn-sm" onclick="loadPgStats('${pg.id}')">Cargar</button></div>
        </div>`;
        return;
      }
      const members = Object.entries(pg.members || {}).map(([uid, m]) => ({ id: uid, name: m.displayName }));
      const pgMatches = pgData.matches || [];
      const rows = members.map(p => {
        const ms   = pgMatches.filter(m => m.slots?.some(s => s.playerId === p.id));
        const wins = ms.filter(m => m.slots.some(s => s.playerId === p.id && s.won)).length;
        const pwr  = ms.length ? Math.round(wins / ms.length * 100) : 0;
        return { ...p, played: ms.length, wins, wr: pwr };
      }).filter(r => r.played > 0).sort((a,b) => b.wr - a.wr || b.wins - a.wins);
      const myPos = rows.findIndex(r => r.id === myUid);
      html += `<div class="card-box" style="margin-bottom:8px;padding:10px 14px;">
        <div style="font-size:13px;font-weight:600;margin-bottom:8px;">${pg.name}
          ${myPos >= 0 ? `<span style="font-size:11px;font-weight:400;color:var(--gold);margin-left:8px;">Posición #${myPos+1} de ${rows.length}</span>` : ''}
        </div>
        ${rows.length ? `<table style="width:100%;">
          <thead><tr>
            <th style="width:24px;">#</th>
            <th>Jugador</th>
            <th>Partidas</th>
            <th>Victorias</th>
            <th>WR</th>
          </tr></thead>
          <tbody>${rows.map((r,i) => `<tr class="${r.id === myUid ? 'my-row' : ''}${i===0?' rank-1':''}">
            <td style="color:var(--text-sub);font-size:12px;">${['🥇','🥈','🥉'][i]||i+1}</td>
            <td style="font-weight:${r.id===myUid?'700':'400'};color:${r.id===myUid?'var(--gold)':'inherit'};">${r.name}</td>
            <td style="color:var(--text-sub);">${r.played}</td>
            <td>${r.wins}</td>
            <td><span style="font-weight:600;color:${r.wr>=50?'var(--success)':'var(--text-sub)'};">${r.wr}%</span></td>
          </tr>`).join('')}</tbody>
        </table>` : `<div style="font-size:12px;color:var(--text-sub);">Sin partidas registradas.</div>`}
      </div>`;
    });
  }

  el.innerHTML = html;
}

async function loadPgStats(pgId) {
  const { loadPlaygroupData } = await import('./firebase.js');
  const data = await loadPlaygroupData(pgId);
  if (!window._pgCache) window._pgCache = {};
  window._pgCache[pgId] = data;
  renderStats();
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

function renderPlayers() {
  const el = document.getElementById('tab-players');

  let html = `<div class="card-box">
    <div class="section-title">Jugadores</div>`;

  if(DB.players.length) {
    html += DB.players.map(p=>`
      <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:0.5px solid var(--color-border-tertiary);">
        <span style="font-size:14px;">${p.name}</span>
        <button class="btn btn-sm btn-danger" onclick="deletePlayer('${p.id}')">eliminar</button>
      </div>
    `).join('');
  } else {
    html += '<div class="empty-state">No hay jugadores todavía.</div>';
  }

  html += `
    <div style="margin-top:12px;display:flex;gap:8px;">
      <input type="text" id="new-player-name" placeholder="Nombre del jugador" style="flex:1;">
      <button class="btn btn-gold" onclick="addPlayer()">Agregar</button>
    </div>
  </div>`;

  el.innerHTML = html;
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

function addPlayer() {
  const name = document.getElementById('new-player-name').value.trim();
  if(!name) return;
  DB.players.push({ id: uid(), name });
  save(); renderAll();
}
function deletePlayer(id) {
  if(!confirm('¿Eliminar jugador? Sus mazos y partidas también se eliminarán.')) return;
  DB.players = DB.players.filter(p=>p.id!==id);
  DB.decks = DB.decks.filter(d=>d.playerId!==id);
  DB.matches = DB.matches.map(m=>({ ...m, slots: (m.slots||[]).filter(s=>s.playerId!==id) })).filter(m=>m.slots.length>0);
  DB.tournaments = DB.tournaments.map(t=>({ ...t, playerIds: t.playerIds.filter(p=>p!==id) }));
  save(); renderAll();
}

function showTab(t) {
  if (t === 'players') { showPlayersModal(); return; }
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  const el = document.getElementById('tab-'+t);
  if (el) el.classList.add('active');
  const tabs = ['match','tournament','playgroups','history','stats','decks','profile'];
  const idx = tabs.indexOf(t);
  const btns = document.querySelectorAll('.nav-btn');
  if (idx >= 0 && btns[idx]) btns[idx].classList.add('active');
}

function renderAll() {
  renderDecks();
  renderMatch();
  renderHistory();
  renderStats();
  renderTournament();
  renderPlaygroups();
  renderProfile();
}


// ── Playgroups tab ───────────────────────────────────────────────────────────
let activePgDetailId = null; // which pg is being viewed in detail

function renderPlaygroups() {
  const el = document.getElementById('tab-playgroups');
  if (!el) return;
  if (activePgDetailId) { renderPgDetail(el, activePgDetailId); return; }

  const pgs = window.AUTH?.playgroups || [];
  let html = '';

  if (!pgs.length) {
    html += `<div class="empty-state">No pertenecés a ningún playgroup todavía.</div>`;
  } else {
    html += `<div class="cards-grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr));">`;
    pgs.forEach(pg => {
      const memberCount = Object.keys(pg.members || {}).length;
      const pgMatches   = window._pgCache?.[pg.id]?.matches || [];
      html += `<div class="pg-list-card" onclick="window.__openPgDetail('${pg.id}')">
        <div style="font-size:16px;font-weight:700;font-family:'Cinzel',serif;color:var(--gold);margin-bottom:4px;">${pg.name}</div>
        <div style="font-size:11px;color:var(--text-sub);margin-bottom:10px;">${memberCount} miembro${memberCount!==1?'s':''} · ${pgMatches.length} partidas</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;">
          ${Object.values(pg.members||{}).map(m=>`<span style="font-size:11px;background:var(--bg-raised);border:1px solid var(--border);border-radius:12px;padding:2px 8px;">${m.displayName}</span>`).join('')}
        </div>
        <div style="font-size:10px;color:var(--text-sub);">Código: <span style="color:var(--gold);font-weight:700;letter-spacing:0.1em;">${pg.code}</span></div>
      </div>`;
    });
    html += `</div>`;
  }

  html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px;">
    <div class="card-box">
      <div class="section-title" style="margin-bottom:10px;">Crear playgroup</div>
      <div class="form-group"><label>Nombre</label><input type="text" id="pg-create-name" placeholder="Ej: Morfi y Ñemita"></div>
      <button class="btn btn-gold" onclick="window.__createPg()">Crear</button>
    </div>
    <div class="card-box">
      <div class="section-title" style="margin-bottom:10px;">Unirse con código</div>
      <div class="form-group"><label>Código</label><input type="text" id="pg-join-code" placeholder="Ej: A1B2C3" maxlength="6" style="text-transform:uppercase;letter-spacing:0.1em;"></div>
      <button class="btn btn-gold" onclick="window.__joinPg()">Unirse</button>
    </div>
  </div>
  <div id="pg-error" class="auth-error" style="display:none;margin-top:10px;"></div>`;

  el.innerHTML = html;
}

function renderPgDetail(el, pgId) {
  const pg = (window.AUTH?.playgroups || []).find(p => p.id === pgId);
  if (!pg) { activePgDetailId = null; renderPlaygroups(); return; }
  const pgData  = window._pgCache?.[pgId] || { matches:[], tournaments:[], decks:[] };
  const matches = pgData.matches || [];
  const decks   = pgData.decks   || [];
  const members = Object.entries(pg.members || {}).map(([uid,m]) => ({ id: uid, ...m }));
  const myUid   = window.AUTH?.user?.uid;

  // Build player/deck name helpers scoped to this pg
  const pgPlayerName = id => {
    const m = members.find(m => m.id === id);
    if (m) return m.displayName;
    // guest fallback
    const guestKey = id.replace('guest_','');
    return members.find(m => m.legacyId === guestKey)?.displayName || id;
  };
  const pgDeckName = id => {
    const d = decks.find(d => d.id === id);
    return d ? d.name : (DB.decks.find(d => d.id === id)?.name || '—');
  };

  // Stats per member
  const memberStats = members.map(m => {
    const ms   = matches.filter(match => match.slots?.some(s => s.playerId === m.id));
    const wins = ms.filter(match => match.slots.some(s => s.playerId === m.id && s.won)).length;
    const wr   = ms.length ? Math.round(wins/ms.length*100) : 0;
    return { ...m, played: ms.length, wins, wr };
  }).filter(r => r.played > 0).sort((a,b) => b.wr - a.wr || b.wins - a.wins);

  // All decks seen in matches
  const deckIds = [...new Set(matches.flatMap(m => m.slots?.map(s => s.deckId)||[]))];
  const pgDeckStats = deckIds.map(did => {
    const d      = decks.find(d => d.id === did) || DB.decks.find(d => d.id === did);
    if (!d) return null;
    const ms     = matches.filter(m => m.slots?.some(s => s.deckId === did));
    const wins   = ms.filter(m => m.slots.some(s => s.deckId === did && s.won)).length;
    const dwr    = ms.length ? Math.round(wins/ms.length*100) : 0;
    return { name: d.name, owner: pgPlayerName(d.playerId), played: ms.length, wins, wr: dwr };
  }).filter(Boolean).sort((a,b) => b.wr - a.wr);

  const recentMatches = [...matches].sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0,10);

  let html = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:1.25rem;">
      <button class="btn btn-sm" onclick="window.__closePgDetail()">← Volver</button>
      <div>
        <div style="font-family:'Cinzel',serif;font-size:18px;font-weight:600;color:var(--gold);">${pg.name}</div>
        <div style="font-size:11px;color:var(--text-sub);">${members.length} miembros · Código: <span style="color:var(--gold);font-weight:700;">${pg.code}</span></div>
      </div>
      <button class="btn btn-sm btn-danger" style="margin-left:auto;" onclick="window.__leavePg('${pg.id}','${pg.name.replace(/'/g,"\\'")}')">Abandonar</button>
    </div>

    <div class="stats-grid" style="margin-bottom:1.25rem;">
      <div class="stat-card"><div class="stat-label">Partidas</div><div class="stat-value">${matches.length}</div></div>
      <div class="stat-card"><div class="stat-label">Miembros</div><div class="stat-value">${members.length}</div></div>
      <div class="stat-card"><div class="stat-label">Mazos usados</div><div class="stat-value">${deckIds.length}</div></div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:1.25rem;">
      <div class="card-box">
        <div class="section-title">Ranking</div>
        ${memberStats.length ? `<table style="width:100%;">
          <thead><tr><th>#</th><th>Jugador</th><th>Partidas</th><th>WR</th></tr></thead>
          <tbody>${memberStats.map((r,i) => `<tr class="${r.id===myUid?'my-row':''}${i===0?' rank-1':''}">
            <td style="color:var(--text-sub);font-size:12px;">${['🥇','🥈','🥉'][i]||i+1}</td>
            <td style="font-weight:${r.id===myUid?'700':'400'};color:${r.id===myUid?'var(--gold)':'inherit'};">${r.displayName}${r.isGuest?'<span style="font-size:9px;color:var(--text-sub);margin-left:4px;">guest</span>':''}</td>
            <td style="color:var(--text-sub);">${r.played}</td>
            <td><span style="font-weight:600;color:${r.wr>=50?'var(--success)':'var(--text-sub)'};">${r.wr}%</span></td>
          </tr>`).join('')}</tbody>
        </table>` : '<div class="empty-state">Sin partidas todavía.</div>'}
      </div>
      <div class="card-box">
        <div class="section-title">Mazos más usados</div>
        ${pgDeckStats.slice(0,8).map(d => `<div class="bar-row">
          <div class="bar-label" title="${d.name} (${d.owner})">${d.name}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${d.wr}%"></div></div>
          <div class="bar-pct">${d.wr}%</div>
          <div style="font-size:10px;color:var(--text-sub);min-width:32px;text-align:right;">${d.wins}/${d.played}</div>
        </div>`).join('') || '<div class="empty-state">Sin datos.</div>'}
      </div>
    </div>

    <div class="card-box">
      <div class="section-title">Historial reciente</div>
      ${recentMatches.length ? recentMatches.map(m => {
        const t = m.tournamentId ? (pgData.tournaments||[]).find(t=>t.id===m.tournamentId) : null;
        return `<div class="history-item">
          <div class="history-date">${formatDate(m.date)}</div>
          <div class="history-type">${m.type==='ffa'?'Free':'Team'}</div>
          ${t?`<span class="tag-tournament">${t.name}</span>`:''}
          <div style="flex:1;min-width:0;">
            ${(m.slots||[]).map(s=>{
  const pn = s.playerId ? pgPlayerName(s.playerId) : (s.playerName||'—');
  const dn = s.deckId   ? pgDeckName(s.deckId)     : (s.deckLabel||'—');
  const style = s.won ? 'color:var(--success);font-weight:500;' : 'color:var(--text-sub);';
  return `<span style="font-size:12px;margin-right:8px;${style}">${pn}: ${dn}${s.won?' ✓':''}</span>`;
}).join('')}
          </div>
        </div>`;
      }).join('') : '<div class="empty-state">Sin partidas registradas.</div>'}
    </div>
  `;

  el.innerHTML = html;
}

window.__openPgDetail = async (pgId) => {
  const { loadPlaygroupData, loadUserDecks } = await import('./firebase.js');
  if (!window._pgCache) window._pgCache = {};
  const pgData = await loadPlaygroupData(pgId);

  // Merge in decks from real (non-guest) members shared with this pg
  const pg = (window.AUTH?.playgroups || []).find(p => p.id === pgId);
  const deckMap = new Map((pgData.decks || []).map(d => [d.id, d]));

  if (pg) {
    const realMembers = Object.entries(pg.members || {})
      .filter(([uid, m]) => !m.isGuest);
    for (const [memberUid] of realMembers) {
      try {
        const memberDecks = await loadUserDecks(memberUid);
        memberDecks
          .filter(d => (d.sharedWith || []).includes(pgId))
          .forEach(d => deckMap.set(d.id, d));
      } catch(e) { /* skip */ }
    }
  }

  pgData.decks = Array.from(deckMap.values());
  window._pgCache[pgId] = pgData;
  activePgDetailId = pgId;
  renderPlaygroups();
};

window.__closePgDetail = () => {
  activePgDetailId = null;
  renderPlaygroups();
};

window.__createPg = async () => {
  const name  = document.getElementById('pg-create-name')?.value.trim();
  const errEl = document.getElementById('pg-error');
  if (errEl) errEl.style.display = 'none';
  if (!name) { if(errEl){errEl.textContent='Ingresá un nombre.';errEl.style.display='block';} return; }
  try {
    const { createPlaygroup } = await import('./firebase.js');
    const pg = await createPlaygroup(name, window.AUTH.user.uid, window.AUTH.user.displayName||window.AUTH.user.email);
    window.AUTH.playgroups.push(pg);
    renderPlaygroups();
  } catch(e) { if(errEl){errEl.textContent=e.message;errEl.style.display='block';} }
};

window.__joinPg = async () => {
  const code  = document.getElementById('pg-join-code')?.value.trim();
  const errEl = document.getElementById('pg-error');
  if (errEl) errEl.style.display = 'none';
  if (!code) { if(errEl){errEl.textContent='Ingresá el código.';errEl.style.display='block';} return; }
  try {
    const { joinPlaygroup } = await import('./firebase.js');
    const pg = await joinPlaygroup(code, window.AUTH.user.uid, window.AUTH.user.displayName||window.AUTH.user.email);
    window.AUTH.playgroups.push(pg);
    renderPlaygroups();
  } catch(e) { if(errEl){errEl.textContent=e.message;errEl.style.display='block';} }
};

window.__leavePg = async (pgId, pgName) => {
  if (!confirm(`¿Salir del playgroup "${pgName}"?`)) return;
  try {
    const { leavePlaygroup } = await import('./firebase.js');
    await leavePlaygroup(pgId, window.AUTH.user.uid);
    window.AUTH.playgroups = window.AUTH.playgroups.filter(p => p.id !== pgId);
    if (window.AUTH.pgId === pgId) {
      window.AUTH.pgId = window.AUTH.playgroups[0]?.id || null;
      localStorage.setItem('lastPgId', window.AUTH.pgId || '');
    }
    activePgDetailId = null;
    await loadAndRender();
  } catch(e) { alert('Error: ' + e.message); }
};


// ── Profile tab ───────────────────────────────────────────────────────────────
function renderProfile() {
  const el = document.getElementById('tab-profile');
  if (!el) return;
  const myUid  = window.AUTH?.user?.uid;
  const pgs    = window.AUTH?.playgroups || [];
  const myDecks   = DB.decks.filter(d => d.playerId === myUid);
  const myMatches = DB.matches.filter(m => m.slots?.some(s => s.playerId === myUid));
  const myWins    = myMatches.filter(m => m.slots?.some(s => s.playerId === myUid && s.won));
  const wr        = myMatches.length ? Math.round(myWins.length / myMatches.length * 100) : 0;
  const deckStats = myDecks.map(d => {
    const played = DB.matches.filter(m => m.slots?.some(s => s.deckId === d.id)).length;
    const wins   = DB.matches.filter(m => m.slots?.some(s => s.deckId === d.id && s.won)).length;
    return { d, played, wr: played ? Math.round(wins/played*100) : 0 };
  }).filter(x => x.played >= 1).sort((a,b) => b.wr - a.wr || b.played - a.played);
  const bestDeck = deckStats[0];

  el.innerHTML = `
    <div class="stats-grid" style="margin-bottom:1.25rem;">
      <div class="stat-card"><div class="stat-label">Partidas</div><div class="stat-value">${myMatches.length}</div><div class="stat-sub">totales</div></div>
      <div class="stat-card"><div class="stat-label">Win Rate</div><div class="stat-value">${wr}%</div><div class="stat-sub">${myWins.length} victorias</div></div>
      <div class="stat-card"><div class="stat-label">Mazos</div><div class="stat-value">${myDecks.length}</div><div class="stat-sub">${myDecks.filter(d=>(d.sharedWith||[]).length>0).length} compartidos</div></div>
    </div>
    ${bestDeck ? `
    <div class="card-box" style="margin-bottom:1rem;">
      <div class="section-title">Mejor mazo</div>
      <div style="font-size:15px;font-weight:600;">${bestDeck.d.name}</div>
      <div style="font-size:12px;color:var(--gold);">${bestDeck.d.commander || '—'}</div>
      <div style="font-size:12px;color:var(--text-sub);margin-top:2px;">${bestDeck.played} partidas · ${bestDeck.wr}% WR</div>
    </div>` : ''}
    <div class="card-box">
      <div class="section-title">Mis playgroups</div>
      ${pgs.length ? pgs.map(pg => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-subtle);">
          <div>
            <div style="font-size:14px;font-weight:500;">${pg.name}</div>
            <div style="font-size:11px;color:var(--text-sub);">${Object.keys(pg.members||{}).length} miembros · Código: <span style="color:var(--gold);">${pg.code}</span></div>
          </div>
        </div>
      `).join('') : '<div class="empty-state">Sin playgroups todavía.</div>'}
    </div>
  `;
}

// Called by auth.js after login
window.__appBoot = async function() {
  await loadAndRender();
};

// Called when user selects/changes playgroup
window.__appLoadPlaygroup = async function(pgId) {
  await loadAndRender();
  updatePlaygroupBadge();
};

async function loadAndRender() {
  try {
    const data = await loadAppData();
    window.DB.players     = data.players;
    window.DB.decks       = data.decks;
    window.DB.matches     = data.matches;
    window.DB.tournaments = data.tournaments;
    window.DB.sessions    = data.sessions;
    normalizeDB();
    const activeSession = DB.sessions.find(s => !s.endedAt);
    if (activeSession) currentSessionId = activeSession.id;
  } catch(e) {
    console.error('Load error:', e);
  }
  // Preload pg data for stats
  await preloadPgStats();
  renderAll();
}

async function preloadPgStats() {
  const { loadPlaygroupData, loadUserDecks } = await import('./firebase.js');
  if (!window._pgCache) window._pgCache = {};
  const pgs = window.AUTH?.playgroups || [];
  await Promise.all(pgs.map(async pg => {
    try {
      const pgData = await loadPlaygroupData(pg.id);
      // Merge real member decks shared with this pg
      const deckMap = new Map((pgData.decks || []).map(d => [d.id, d]));
      const realMembers = Object.entries(pg.members || {}).filter(([,m]) => !m.isGuest);
      for (const [memberUid] of realMembers) {
        try {
          const memberDecks = await loadUserDecks(memberUid);
          memberDecks.filter(d => (d.sharedWith||[]).includes(pg.id))
                     .forEach(d => deckMap.set(d.id, d));
        } catch(e) { /* skip */ }
      }
      pgData.decks = Array.from(deckMap.values());
      window._pgCache[pg.id] = pgData;
    } catch(e) { /* silent */ }
  }));
}

function updatePlaygroupBadge() {
  // No longer shows active playgroup in header - handled in Playgroups tab
}

async function init() {
  // auth.js handles boot via onAuthChange → __appBoot
  // Nothing to do here — renderAll will be called once auth resolves
}

init();

// Exponer funciones al HTML
window.addPlayer = addPlayer;
window.deletePlayer = deletePlayer;

window.showTab = showTab;
window.renderPlaygroups = renderPlaygroups;
window.renderProfile = renderProfile;

window.addFFASlot = addFFASlot;
window.removeFFASlot = removeFFASlot;
window.updateFFASlotPlayer     = updateFFASlotPlayer;
window.updateFFASlotPlayerName = updateFFASlotPlayerName;
window.updateTeamSlotPlayerName = updateTeamSlotPlayerName;
window.selectScryfallDeck      = selectScryfallDeck;
window.renderMatchPlaygroupSelector = renderMatchPlaygroupSelector;
window.updateFFASlotDeck = updateFFASlotDeck;

window.addDeck = addDeck;
window.setDeckSort = setDeckSort;
window.setDeckSearch = setDeckSearch;
window.setDeckFilter = setDeckFilter;
window.clearDeckFilters = clearDeckFilters;
window.startEditDeck = startEditDeck;
window.cancelEditDeck = cancelEditDeck;
window.saveEditDeck = saveEditDeck;
window.deleteDeck = deleteDeck;
window.onDeckInput = onDeckInput;
window.selectDeck  = selectDeck;
window.selectScryfallDeck = selectScryfallDeck;
window.updateFFASlotPlayerName  = updateFFASlotPlayerName;
window.updateTeamSlotPlayerName = updateTeamSlotPlayerName;
window.renderMatchPlaygroupSelector = renderMatchPlaygroupSelector;
window.selectDeck = selectDeck;
window.rerenderDeckForm = rerenderDeckForm;
window.onCommanderInput  = onCommanderInput;
window.onCommander2Input = onCommander2Input;
window.selectCommander   = selectCommander;
window.selectCommander2  = selectCommander2;

window.startSession = startSession;
window.endSession = endSession;

window.setHistoryFilter = setHistoryFilter;
window.clearHistoryFilters = clearHistoryFilters;

window.setMatchType = setMatchType;
window.setMatchPlaygroup = setMatchPlaygroup;
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