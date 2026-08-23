// ============================================================
// SETUP REQUIRED — replace these two values before this works:
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyCjgfFAkCAmfTHitIb9FSSZpwtp1x_IlEo",
  authDomain: "iron-ledger-fb61a.firebaseapp.com",
  projectId: "iron-ledger-fb61a",
  storageBucket: "iron-ledger-fb61a.firebasestorage.app",
  messagingSenderId: "142520706804",
  appId: "1:142520706804:web:74d077f4dc0e8c442e60a1"
};
// Paste the Apps Script Web App URL here once deployed (see sheets-export.gs):
const SHEETS_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbxlrlRSo06VNDyBSTNmMMJUQGIv0gvycIBZrrw6LHyKCDAtW_HZ9E6DxyH5SaqpywGZdg/exec";
// ============================================================

const EXERCISES = [
  { id:'squat', name:'Goblet Squat', group:1, cue:'Chest tall, knees track toes', sets:{pelagio:3,wanix:3}, repRange:[8,12], perSide:false },
  { id:'row', name:'Single-Arm Row', group:1, cue:'Flat back, pull to hip', sets:{pelagio:3,wanix:3}, repRange:[8,12], perSide:true },
  { id:'deadlift', name:'KB Deadlift / RDL', group:2, cue:'Hinge — KB stays close to shins', sets:{pelagio:3,wanix:3}, repRange:[8,12], perSide:false },
  { id:'press', name:'Single-Arm OH Press', group:2, cue:'Ribs down, press over ear', sets:{pelagio:3,wanix:3}, repRange:[6,10], perSide:true },
  { id:'lunge', name:'Reverse Lunge', group:3, cue:'Back knee light tap, front heel down', sets:{pelagio:2,wanix:4}, repRange:[8,12], perSide:true, swap:true, swapTextPelagio:'Lighter — maintenance only', swapTextWanix:'Extra volume — your focus' },
  { id:'pushup', name:'Push-Up', group:3, cue:'Straight line, elbows ~45°', sets:{pelagio:4,wanix:2}, repRange:[8,15], perSide:false, swap:true, swapTextPelagio:'Extra volume — your focus', swapTextWanix:'Lighter — maintenance only' },
  { id:'swing', name:'KB Swing (finisher)', group:4, cue:'Hips snap, arms are hooks — not a squat', sets:{pelagio:1,wanix:1}, repRange:[0,0], perSide:false, finisher:true }
];
const GROUP_LABELS = { 1:'Squat + Row', 2:'Hinge + Press', 3:'Your emphasis slot', 4:'Conditioning finisher' };
const PROFILES = {
  pelagio: { name:'Pelagio', color:'var(--accent-pelagio)', hex:'#c1613a' },
  wanix:   { name:'Wanix',   color:'var(--accent-wanix)',  hex:'#4a7a96' }
};

let ui = { profile:'pelagio', tab:'session', workingDate: todayISO(), historyEx: null };
let sessionsCache = { pelagio: [], wanix: [] };
let firestoreReady = false;
let db = null;

function todayISO(){ return new Date().toISOString().slice(0,10); }

// ---------- Firebase init ----------
function initFirebase(){
  if(firebaseConfig.apiKey === "REPLACE_ME"){
    setStatus('Not connected — add your Firebase config in app.js', 'warn');
    render();
    return;
  }
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
  db.enablePersistence({ synchronizeTabs: true }).catch((err)=>{
    console.warn('Offline persistence not enabled:', err.code);
  });
  db.collection('sessions').orderBy('date').onSnapshot((snap)=>{
    const next = { pelagio: [], wanix: [] };
    snap.forEach((doc)=>{
      const data = doc.data();
      if(next[data.profile]) next[data.profile].push(data);
    });
    sessionsCache = next;
    firestoreReady = true;
    setStatus(navigator.onLine ? '' : 'Offline — logging locally, will sync when back online', navigator.onLine ? '' : 'warn');
    render();
  }, (err)=>{
    console.error(err);
    setStatus('Sync error — check your Firebase config', 'warn');
  });
}

function setStatus(msg, cls){
  ui._status = msg; ui._statusCls = cls || '';
}

window.addEventListener('online', ()=>{ setStatus('', ''); flushSheetsQueue(); render(); });
window.addEventListener('offline', ()=>{ setStatus('Offline — logging locally, will sync when back online', 'warn'); render(); });

// ---------- Sheets mirror (best-effort, queued) ----------
function loadQueue(){ try{ return JSON.parse(localStorage.getItem('sheetsRetryQueue')||'[]'); }catch(e){ return []; } }
function saveQueue(q){ localStorage.setItem('sheetsRetryQueue', JSON.stringify(q)); }

async function pushToSheets(payload){
  if(!SHEETS_WEBHOOK_URL || SHEETS_WEBHOOK_URL.includes('REPLACE_ME')) return;
  try{
    await fetch(SHEETS_WEBHOOK_URL, {
      method:'POST', mode:'no-cors',
      headers:{ 'Content-Type':'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
  }catch(e){
    const q = loadQueue(); q.push(payload); saveQueue(q);
  }
}

async function flushSheetsQueue(){
  const q = loadQueue();
  if(!q.length) return;
  saveQueue([]);
  for(const payload of q){ await pushToSheets(payload); }
  render();
}

// ---------- Data helpers ----------
function getSessions(profile){ return sessionsCache[profile] || []; }

function getLastEntry(profile, exId){
  const sessions = getSessions(profile);
  for(let i=sessions.length-1;i>=0;i--){
    if(sessions[i].entries && sessions[i].entries[exId]) return sessions[i].entries[exId];
  }
  return null;
}

function progressionBadge(ex, lastEntry){
  if(ex.finisher) return '';
  if(!lastEntry || !lastEntry.reps || !lastEntry.reps.length) return '<span class="badge neutral">first log</span>';
  const top = ex.repRange[1], bottom = ex.repRange[0];
  const minReps = Math.min(...lastEntry.reps.map(r=>Number(r)||0));
  if(minReps >= top) return '<span class="badge good">↑ add weight</span>';
  if(minReps < bottom-2) return '<span class="badge warn">ease off</span>';
  return '<span class="badge neutral">on track</span>';
}

function weightColor(w){
  const min=4, max=32;
  const clamped = Math.max(min, Math.min(max, w||min));
  const t = (clamped-min)/(max-min);
  const hue = 205 - t*195;
  return `hsl(${hue}, 55%, 55%)`;
}

// ---------- Render ----------
function render(){
  const app = document.getElementById('app');
  const profile = ui.profile;
  app.style.setProperty('--current-accent', PROFILES[profile].color);

  const pendingCount = loadQueue().length;
  let statusHtml = '';
  if(ui._status) statusHtml = ui._status;
  else if(pendingCount) statusHtml = `${pendingCount} sheet ${pendingCount===1?'entry':'entries'} waiting to sync`;

  app.innerHTML = `
    ${renderHeader()}
    <div class="status-line ${ui._statusCls||(pendingCount?'warn':'')}">${statusHtml}</div>
    ${renderTabs()}
    ${ui.tab === 'session' ? renderSession() : renderHistory()}
  `;
  attachEvents();
}

function kbIconSVG(){
  return `<svg viewBox="0 0 40 40" fill="none">
    <path d="M15 13c0-3 2.2-5.5 5-5.5s5 2.5 5 5.5" stroke="#948f86" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="15" cy="25" r="9" fill="${PROFILES.pelagio.hex}" opacity="0.92"/>
    <circle cx="24" cy="25" r="9" fill="${PROFILES.wanix.hex}" opacity="0.92"/>
  </svg>`;
}

function renderHeader(){
  return `
  <header>
    <div class="brand">
      ${kbIconSVG()}
      <div><h1>Iron Ledger</h1><small>PELAGIO &amp; WANIX</small></div>
    </div>
    <div class="profile-toggle">
      <button data-action="profile" data-profile="pelagio" class="${ui.profile==='pelagio'?'active-pelagio':''}">Pelagio</button>
      <button data-action="profile" data-profile="wanix" class="${ui.profile==='wanix'?'active-wanix':''}">Wanix</button>
    </div>
  </header>`;
}

function renderTabs(){
  return `
  <div class="tabs">
    <button data-action="tab" data-tab="session" class="${ui.tab==='session'?'active':''}">Today</button>
    <button data-action="tab" data-tab="history" class="${ui.tab==='history'?'active':''}">History</button>
  </div>`;
}

function romanish(n){ return ['①','②','③','④'][n-1] || n; }

function renderSession(){
  const profile = ui.profile;
  const sessions = getSessions(profile);
  const workingDate = ui.workingDate || todayISO();
  const todaySession = sessions.find(s=>s.date===workingDate);

  let html = `
    <div class="day-header">
      <input type="date" class="date-field" id="dateField" value="${workingDate}">
      <span class="session-count">${sessions.length} session${sessions.length===1?'':'s'} logged</span>
    </div>`;
  [1,2,3,4].forEach(g=>{
    html += `<div class="group-label">${romanish(g)} ${GROUP_LABELS[g]}</div>`;
    EXERCISES.filter(e=>e.group===g).forEach(ex=> html += exerciseCard(ex, profile, todaySession));
  });
  html += `
    <div class="save-bar">
      <button class="save-btn" id="saveSessionBtn" style="background:${PROFILES[profile].color}">Save session</button>
    </div>
    <button class="clear-link" id="clearDataBtn">Clear ${PROFILES[profile].name}'s logged sessions</button>`;
  return html;
}

function exerciseCard(ex, profile, todaySession){
  const setsCount = ex.sets[profile];
  const lastEntry = getLastEntry(profile, ex.id);
  const existing = todaySession && todaySession.entries ? todaySession.entries[ex.id] : null;
  const prefWeight = existing ? existing.weight : (lastEntry ? lastEntry.weight : '');
  const badge = progressionBadge(ex, lastEntry);
  const swapTag = ex.swap ? `<span class="swap-tag" style="background:${profile==='pelagio'?'var(--accent-pelagio-dim)':'var(--accent-wanix-dim)'};color:${PROFILES[profile].color}">${profile==='pelagio'?ex.swapTextPelagio:ex.swapTextWanix}</span>` : '';
  const targetText = ex.finisher ? 'Target: ~5 min continuous' : `Target: ${ex.repRange[0]}–${ex.repRange[1]} reps${ex.perSide?'/side':''} × ${setsCount} sets`;
  const lastTimeText = lastEntry ? `Last time: ${lastEntry.reps.join(', ')} @ ${lastEntry.weight}kg` : 'No previous log yet';

  let repsHtml = '';
  if(ex.finisher){
    const val = existing ? existing.reps[0] : '';
    repsHtml = `<div class="set-col"><label>TOTAL REPS</label><input type="number" min="0" data-ex="${ex.id}" data-set="0" class="reps-input" value="${val||''}" style="width:64px"></div>`;
  } else {
    for(let i=0;i<setsCount;i++){
      const val = existing ? existing.reps[i] : '';
      repsHtml += `<div class="set-col"><label>SET ${i+1}</label><input type="number" min="0" data-ex="${ex.id}" data-set="${i}" class="reps-input" value="${val!==undefined&&val!==null?val:''}"></div>`;
    }
  }
  const w = prefWeight || 0;
  return `
  <div class="card">
    <div class="card-top">
      <div>
        <div class="ex-name">${ex.name} ${badge}</div>
        <div class="ex-cue">${ex.cue}</div>
        <div class="ex-target">${targetText}</div>
      </div>
      ${swapTag}
    </div>
    <div class="last-time">${lastTimeText}</div>
    <div class="input-row">
      <div class="weight-wrap">
        <div class="weight-badge" id="wbadge-${ex.id}" style="background:${weightColor(Number(w))}">${w||'–'}</div>
        <input type="number" min="0" step="0.5" class="weight-input" data-ex="${ex.id}" id="weight-${ex.id}" value="${prefWeight||''}" placeholder="kg">
      </div>
      <div class="reps-group">${repsHtml}</div>
    </div>
  </div>`;
}

function renderHistory(){
  const profile = ui.profile;
  const sessions = getSessions(profile);
  const options = EXERCISES.filter(e=>!e.finisher).map(e=>`<option value="${e.id}">${e.name}</option>`).join('');
  const chartEx = ui.historyEx || (EXERCISES.find(e=>!e.finisher)||{}).id;
  const points = [];
  sessions.forEach(s=>{
    const entry = s.entries && s.entries[chartEx];
    if(entry && entry.weight) points.push({ date:s.date, weight:Number(entry.weight), reps:entry.reps });
  });
  const chartHtml = points.length < 2
    ? `<div class="chart-empty">Log at least 2 sessions with weight for this exercise to see a trend line.</div>`
    : svgChart(points, profile);

  let logRows = '';
  sessions.slice().reverse().slice(0,10).forEach(s=>{
    const entry = s.entries && s.entries[chartEx];
    if(!entry) return;
    logRows += `<div class="log-row"><span class="log-date">${s.date}</span><span class="log-reps">${entry.weight}kg — ${entry.reps.join(', ')}</span></div>`;
  });
  if(!logRows) logRows = `<div class="chart-empty">No entries yet for this exercise.</div>`;

  return `
    <div class="hist-controls"><select id="historyExSelect">${options}</select></div>
    <div class="chart-card">${chartHtml}</div>
    <div class="chart-card">${logRows}</div>`;
}

function svgChart(points, profile){
  const w=460, h=140, pad=24;
  const weights = points.map(p=>p.weight);
  const minW=Math.min(...weights), maxW=Math.max(...weights);
  const range=(maxW-minW)||1;
  const stepX=(w-pad*2)/(points.length-1);
  const color = PROFILES[profile].hex;
  const coords = points.map((p,i)=>{
    const x = pad+i*stepX;
    const y = h-pad-((p.weight-minW)/range)*(h-pad*2);
    return {x,y,val:p.weight};
  });
  const path = coords.map((c,i)=>(i===0?'M':'L')+c.x.toFixed(1)+','+c.y.toFixed(1)).join(' ');
  const dots = coords.map(c=>`<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3.5" fill="${color}"/><text x="${c.x.toFixed(1)}" y="${(c.y-8).toFixed(1)}" font-size="9" fill="var(--text-dim)" text-anchor="middle" font-family="IBM Plex Mono, monospace">${c.val}</text>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}"><path d="${path}" fill="none" stroke="${color}" stroke-width="2"/>${dots}</svg>`;
}

// ---------- Events ----------
function attachEvents(){
  document.querySelectorAll('[data-action="profile"]').forEach(btn=>{
    btn.onclick = ()=>{ ui.profile = btn.dataset.profile; render(); };
  });
  document.querySelectorAll('[data-action="tab"]').forEach(btn=>{
    btn.onclick = ()=>{ ui.tab = btn.dataset.tab; render(); };
  });
  const dateField = document.getElementById('dateField');
  if(dateField) dateField.onchange = ()=>{ ui.workingDate = dateField.value; render(); };

  document.querySelectorAll('.weight-input').forEach(inp=>{
    inp.oninput = ()=>{
      const badge = document.getElementById('wbadge-'+inp.dataset.ex);
      if(badge){ badge.style.background = weightColor(Number(inp.value)); badge.textContent = inp.value || '–'; }
    };
  });

  const saveBtn = document.getElementById('saveSessionBtn');
  if(saveBtn){
    saveBtn.onclick = async ()=>{
      if(!db){ setStatus('Add your Firebase config in app.js first', 'warn'); render(); return; }
      const profile = ui.profile;
      const date = (document.getElementById('dateField')||{}).value || todayISO();
      const entries = {};
      EXERCISES.forEach(ex=>{
        const weightEl = document.getElementById('weight-'+ex.id);
        const weight = weightEl ? Number(weightEl.value)||0 : 0;
        const repsEls = document.querySelectorAll(`.reps-input[data-ex="${ex.id}"]`);
        const reps = Array.from(repsEls).map(el=>Number(el.value)||0);
        if(weight || reps.some(r=>r>0)) entries[ex.id] = { weight, reps };
      });
      const docId = `${profile}_${date}`;
      const payload = { profile, date, entries, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
      try{
        await db.collection('sessions').doc(docId).set(payload);
        showToast('Session saved');
      }catch(e){
        showToast('Saved locally — will sync when online');
      }
      pushToSheets({ profile, date, entries });
      render();
    };
  }

  const clearBtn = document.getElementById('clearDataBtn');
  if(clearBtn){
    clearBtn.onclick = async ()=>{
      if(!db) return;
      if(!confirm(`Clear all logged sessions for ${PROFILES[ui.profile].name}? This can't be undone.`)) return;
      const sessions = getSessions(ui.profile);
      const batch = db.batch();
      sessions.forEach(s=> batch.delete(db.collection('sessions').doc(`${s.profile}_${s.date}`)) );
      await batch.commit();
      showToast('Cleared');
    };
  }

  const historySelect = document.getElementById('historyExSelect');
  if(historySelect){
    historySelect.value = ui.historyEx || historySelect.value;
    historySelect.onchange = ()=>{ ui.historyEx = historySelect.value; render(); };
  }
}

function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(()=>t.classList.remove('show'), 2200);
}

render();
initFirebase();
flushSheetsQueue();
