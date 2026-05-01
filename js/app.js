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
let tournamentSortKey = 'wr';
let activeTournamentId = null;
let editingMatchId = null;
if (!window.ffaSlots || typeof window.ffaSlots === "number") {
  window.ffaSlots = Array.from({ length: 4 }, () => ({
    playerId: "",
    deckId: ""
  }));
}

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
        <div style="margin-top:8px;"><button class="btn btn-sm btn-danger" onclick="deleteDeck('${d.id}')">eliminar</button></div>
      </div>`;
    });
    html += '</div>';
  } else {
    html += '<div class="empty-state">No hay mazos todavía.</div>';
  }
  html += '<div class="section-title">Agregar mazo</div><div class="card-box">';
  html += `<div class="form-row">
    <div class="form-group" style="margin-bottom:0;"><label>Dueño</label><select id="d-player" onchange="rerenderDeckForm()">${playerOptions()}</select></div>
    <div class="form-group" style="margin-bottom:0;"><label>Nombre</label><input type="text" id="d-name" placeholder="Ej: Control Azul"></div>
  </div>
  <div class="form-row" style="margin-top:10px;">
    <div class="form-group" style="margin-bottom:0;"><label>Comandante</label><input type="text" id="d-commander" placeholder="Ej: Atraxa"></div>
    <div class="form-group" style="margin-bottom:0;"><label>Colores</label>
      <div class="colors-row" id="color-picker">
        <label class="color-toggle"><input type="checkbox" value="W"><div class="color-dot W">W</div></label>
        <label class="color-toggle"><input type="checkbox" value="U"><div class="color-dot U">U</div></label>
        <label class="color-toggle"><input type="checkbox" value="B"><div class="color-dot B">B</div></label>
        <label class="color-toggle"><input type="checkbox" value="R"><div class="color-dot R">R</div></label>
        <label class="color-toggle"><input type="checkbox" value="G"><div class="color-dot G">G</div></label>
        <label class="color-toggle"><input type="checkbox" value="C"><div class="color-dot C">C</div></label>
      </div>
    </div>
  </div>
  <div style="margin-top:12px;"><button class="btn btn-gold" onclick="addDeck()">Agregar mazo</button></div>`;
  html += '</div>';
  el.innerHTML = html;
}

function rerenderDeckForm() {}

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
      <button class="type-btn${matchType==='2v2'?' active':''}" onclick="setMatchType('2v2')">Equipos</button>
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
    for(const [t,label] of [['t1','Equipo 1'],['t2','Equipo 2']]) {

      html += `
      <div style="display:flex;align-items:center;justify-content:space-between;margin:${t==='t1'?'0':'12px'} 0 6px;">
        <div style="font-size:13px;font-weight:500;color:var(--color-text-primary);">${label}</div>
        <label class="won-toggle">
          <input type="radio" name="team-result" value="${t}"> ganó
        </label>
      </div>`;

      for(let i=0;i<2;i++) {
        html += `
        <div class="player-slot">
          <select id="ms-${t}p${i}" onchange="updateMatchDeck2('${t}',${i})">
            ${playerOptions()}
          </select>
          <select id="ms-${t}d${i}">
            ${deckOptions('')}
          </select>
        </div>`;
      }
    }

    html += `
    <div style="margin:12px 0 6px;">
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

  <div style="margin-top:12px;">
    <button class="btn btn-gold" onclick="saveMatch()">Guardar partida</button>
  </div>

  </div>`;

  el.innerHTML = html;
}

function setMatchType(t) { matchType = t; renderMatch(); }

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

    const value = result.value;

    for(const t of ['t1','t2']) {
      for(let i=0;i<2;i++){
        const pid = document.getElementById(`ms-${t}p${i}`).value;
        const deckId = document.getElementById(`ms-${t}d${i}`).value;
        if(!pid || !deckId) continue;

        if(value === "draw") {
          slots.push({ playerId: pid, deckId, team: t, won: false, draw: true });
        } else {
          slots.push({ playerId: pid, deckId, team: t, won: t === value, draw: false });
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

  renderMatch();

  // cargar datos después de render
  setTimeout(() => {
    document.getElementById('m-date').value = m.date;

    if (m.type === 'ffa') {
      m.slots.forEach((s, i) => {
        document.getElementById(`ms-p${i}`).value = s.playerId;
        updateMatchDeck(i);
        document.getElementById(`ms-d${i}`).value = s.deckId;

        if (s.won) {
          document.querySelector(`input[name="ffa-win"][value="${i}"]`).checked = true;
        }
      });
    } else {
      const winTeam = m.slots.find(s => s.won)?.team;

      if (winTeam) {
        document.querySelector(`input[name="team-win"][value="${winTeam}"]`).checked = true;
      }

      const grouped = { t1: [], t2: [] };
      m.slots.forEach(s => grouped[s.team].push(s));

      ['t1','t2'].forEach(t => {
        grouped[t].forEach((s, i) => {
          document.getElementById(`ms-${t}p${i}`).value = s.playerId;
          updateMatchDeck2(t, i);
          document.getElementById(`ms-${t}d${i}`).value = s.deckId;
        });
      });
    }

    showTab('match');
  }, 0);
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
window.deleteDeck = deleteDeck;
window.rerenderDeckForm = rerenderDeckForm;

window.setMatchType = setMatchType;
window.updateMatchDeck = updateMatchDeck;
window.updateMatchDeck2 = updateMatchDeck2;
window.saveMatch = saveMatch;
window.editMatch = editMatch;
window.deleteMatch = deleteMatch;

window.sortLeaderboard = sortLeaderboard;

window.addTournamentPlayer = addTournamentPlayer;
window.removeTournamentPlayer = removeTournamentPlayer;
window.createTournament = createTournament;
window.closeTournament = closeTournament;
window.deleteTournament = deleteTournament;
