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
const ALLOWED_EMAILS = ['chavezheras@gmail.com', 'aramayo.pilar@gmail.com'];
const SAVE_LIMIT = { count: 3, windowMs: 10 * 60 * 1000 };
// ============================================================

const EXERCISES = [
  { id:'squat', name:'Goblet Squat', group:1, cue:'Chest tall, knees track toes', sets:{pelagio:3,wanix:3}, repRange:[8,12], perSide:false },
  { id:'row', name:'Single-Arm Row', group:1, cue:'Flat back, pull to hip', sets:{pelagio:3,wanix:3}, repRange:[8,12], perSide:true },
  { id:'deadlift', name:'KB Deadlift / RDL', group:2, cue:'Hinge — KB stays close to shins', sets:{pelagio:3,wanix:3}, repRange:[8,12], perSide:false },
  { id:'press', name:'Single-Arm OH Press', group:2, cue:'Ribs down, press over ear', sets:{pelagio:3,wanix:3}, repRange:[6,10], perSide:true },
  { id:'lunge', name:'Reverse Lunge', group:3, cue:'Back knee light tap, front heel down', sets:{pelagio:2,wanix:4}, repRange:[8,12], perSide:true, swap:true, swapTextPelagio:'Lighter — maintenance only', swapTextWanix:'Extra volume — your focus' },
  { id:'pushup', name:'Push-Up', group:3, cue:'Straight line, elbows ~45°', sets:{pelagio:4,wanix:2}, repRange:[8,15], perSide:false, swap:true, swapTextPelagio:'Extra volume — your focus', swapTextWanix:'Lighter — maintenance only' },
  { id:'swing', name:'1 min: Swings + Halos', group:4, cue:'Alternate swings with halos (around the world) for one minute', sets:{pelagio:1,wanix:1}, repRange:[0,0], perSide:false, finisher:true, segmentLabels:['SWINGS + HALOS'] }
];
const GROUP_LABELS = { 1:'Squat + Row', 2:'Hinge + Press', 3:'Your emphasis slot', 4:'Conditioning finisher' };
const PROFILES = {
  pelagio: { name:'Pelagio', color:'var(--accent-pelagio)', hex:'#393D7E' },
  wanix:   { name:'Wanix',   color:'var(--accent-wanix)',  hex:'#F05A7E' }
};

let ui = { profile:'pelagio', tab:'session', workingDate: todayISO(), historyEx: null, _saving:false };
let sessionsCache = { pelagio: [], wanix: [] };
let firestoreReady = false;
let db = null;
let auth = null;
let authReady = false;
let currentUser = null;
let restTimerId = null;

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
  auth = firebase.auth();
  auth.onAuthStateChanged((user)=>{
    currentUser = user;
    authReady = true;
    if(user && !isAllowedUser(user)){
      setStatus('This Google account is not authorised for Iron Ledger.', 'warn');
      render();
      return;
    }
    if(user) startSessionListener();
    render();
  });
  render();
}

function startSessionListener(){
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
    if(!ui._sessionDirty) render();
  }, (err)=>{
    console.error(err);
    setStatus('Sync error — check your Firebase config', 'warn');
  });
}

function isAllowedUser(user){
  return !ALLOWED_EMAILS.length || ALLOWED_EMAILS.map(email=>email.toLowerCase()).includes((user.email||'').toLowerCase());
}

function signIn(){
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithRedirect(provider).catch((err)=>{
    setStatus(`Sign-in failed: ${err.message}`, 'warn');
    render();
  });
}

function signOut(){ auth.signOut(); }

function escapeHTML(value){
  return String(value ?? '').replace(/[&<>"']/g, char=>({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
}

function isValidDate(value){ return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)); }

function validNumber(value, min, max){
  return Number.isFinite(value) && value >= min && value <= max;
}

function canSave(){
  const now = Date.now();
  let attempts = [];
  try { attempts = JSON.parse(localStorage.getItem('saveAttempts')||'[]'); } catch (error) { attempts = []; }
  const recent = Array.isArray(attempts) ? attempts.filter(time=>now-time<SAVE_LIMIT.windowMs) : [];
  if(recent.length >= SAVE_LIMIT.count){
    setStatus('Save limit reached — please wait a few minutes before saving again.', 'warn');
    return false;
  }
  recent.push(now);
  localStorage.setItem('saveAttempts', JSON.stringify(recent));
  return true;
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
  if(!SHEETS_WEBHOOK_URL || SHEETS_WEBHOOK_URL.includes('REPLACE_ME')) return true;
  try{
    await fetch(SHEETS_WEBHOOK_URL, {
      method:'POST', mode:'no-cors',
      headers:{ 'Content-Type':'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    return true;
  }catch(e){
    const q = loadQueue(); q.push(payload); saveQueue(q);
    return false;
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

function getLatestWorkoutDate(profile){
  const sessions = getSessions(profile);
  return sessions.reduce((latest, session)=> session.date > latest ? session.date : latest, '');
}

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
  if(!authReady){
    app.innerHTML = '<main class="auth-panel"><h1>Iron Ledger</h1><p>Connecting securely...</p></main>';
    return;
  }
  if(!currentUser || !isAllowedUser(currentUser)){
    app.innerHTML = `<main class="auth-panel"><h1>Iron Ledger</h1><p>Sign in with Google to access your workouts.</p><button class="auth-btn" id="signInBtn">Sign in with Google</button>${ui._status?`<div class="status-line warn">${escapeHTML(ui._status)}</div>`:''}</main>`;
    attachEvents();
    return;
  }
  const profile = ui.profile;
  app.style.setProperty('--current-accent', PROFILES[profile].color);

  const pendingCount = loadQueue().length;
  let statusHtml = '';
  if(ui._status) statusHtml = escapeHTML(ui._status);
  else if(pendingCount) statusHtml = `${pendingCount} sheet ${pendingCount===1?'entry':'entries'} waiting to sync`;
  else statusHtml = 'New workout is being logged — enter your completed sets, then save once.';

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
    <button class="sign-out-btn" id="signOutBtn" title="Sign out">Sign out</button>
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
  const latestWorkoutDate = getLatestWorkoutDate(profile);
  const workingDate = ui.workingDate || todayISO();
  const todaySession = sessions.find(s=>s.date===workingDate);

  let html = `
    <div class="day-header">
      <input type="date" class="date-field" id="dateField" value="${workingDate}">
        <input type="date" class="date-field" id="dateField" value="${escapeHTML(workingDate)}">
      <span class="session-count">${sessions.length} session${sessions.length===1?'':'s'} logged<br>Latest workout: ${escapeHTML(latestWorkoutDate || 'none yet')}</span>
    </div>`;
  [1,2,3,4].forEach(g=>{
    const restButton = g < 4 ? `<button type="button" class="rest-btn" data-action="rest">Start 1:00 rest</button>` : '';
    html += `<div class="group-label"><span>${romanish(g)} ${GROUP_LABELS[g]}</span>${restButton}</div>`;
    EXERCISES.filter(e=>e.group===g).forEach(ex=> html += exerciseCard(ex, profile, todaySession));
  });
  html += `
    <div class="save-bar">
      <button class="save-btn" id="saveSessionBtn" ${ui._saving?'disabled':''} style="background:${PROFILES[profile].color}">${ui._saving?'Saving workout...':'Save workout'}</button>
    </div>
    <button class="clear-link" id="clearDataBtn">Clear ${PROFILES[profile].name}'s logged sessions</button>`;
  return html;
}

function exerciseCard(ex, profile, todaySession){
  const setsCount = ex.sets[profile];
  const lastEntry = getLastEntry(profile, ex.id);
  const existing = todaySession && todaySession.entries ? todaySession.entries[ex.id] : null;
  const prefWeight = existing ? Number(existing.weight)||0 : (lastEntry ? Number(lastEntry.weight)||0 : '');
  const badge = progressionBadge(ex, lastEntry);
  const swapTag = ex.swap ? `<span class="swap-tag" style="background:${profile==='pelagio'?'var(--accent-pelagio-dim)':'var(--accent-wanix-dim)'};color:${PROFILES[profile].color}">${profile==='pelagio'?ex.swapTextPelagio:ex.swapTextWanix}</span>` : '';
  const targetText = ex.finisher ? 'Target: 1 min total, alternating swings and halos' : `Target: ${ex.repRange[0]}–${ex.repRange[1]} reps${ex.perSide?'/side':''} × ${setsCount} sets`;
  const lastReps = Array.isArray(lastEntry && lastEntry.reps) ? lastEntry.reps : [];
  const lastTimeText = lastEntry ? `Last time: ${escapeHTML(lastReps.map(rep=>Number(rep)||0).join(', '))} @ ${escapeHTML(Number(lastEntry.weight)||0)}kg` : 'No previous log yet';

  let repsHtml = '';
  if(ex.finisher){
    repsHtml = ex.segmentLabels.map((label, i)=>{
      const val = existing ? Number(existing.reps[i])||0 : '';
      return `<div class="set-col"><label>${escapeHTML(label)}<br>1 MIN</label><input type="number" min="0" data-ex="${ex.id}" data-set="${i}" class="reps-input" value="${escapeHTML(val||'')}" style="width:64px"></div>`;
    }).join('');
  } else {
    for(let i=0;i<setsCount;i++){
      const val = existing ? Number(existing.reps[i])||0 : '';
      repsHtml += `<div class="set-col"><label>SET ${i+1}</label><input type="number" min="0" data-ex="${ex.id}" data-set="${i}" class="reps-input" value="${escapeHTML(val||'')}"></div>`;
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
        <input type="number" min="0" step="0.5" class="weight-input" data-ex="${ex.id}" id="weight-${ex.id}" value="${escapeHTML(prefWeight||'')}" placeholder="kg">
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
    const weight = Number(entry && entry.weight);
    if(Number.isFinite(weight) && weight > 0) points.push({ date:s.date, weight, reps:entry.reps });
  });
  const chartHtml = points.length < 2
    ? `<div class="chart-empty">Log at least 2 sessions with weight for this exercise to see a trend line.</div>`
    : svgChart(points, profile);

  const progressHtml = EXERCISES.filter(ex=>!ex.finisher).map(ex=>progressCard(ex, getLastEntry(profile, ex.id))).join('');

  let logRows = '';
  sessions.slice().reverse().slice(0,10).forEach(s=>{
    const entry = s.entries && s.entries[chartEx];
    if(!entry) return;
    const reps = (Array.isArray(entry.reps) ? entry.reps : []).map(rep=>Number(rep)||0).join(', ');
    logRows += `<div class="log-row"><span class="log-date">${escapeHTML(s.date)}</span><span class="log-reps">${escapeHTML(Number(entry.weight)||0)}kg — ${escapeHTML(reps)}</span></div>`;
  });
  if(!logRows) logRows = `<div class="chart-empty">No entries yet for this exercise.</div>`;

  return `
    <div class="hist-controls"><select id="historyExSelect">${options}</select></div>
    <div class="progress-grid">${progressHtml}</div>
    <div class="chart-card">${chartHtml}</div>
    <div class="chart-card">${logRows}</div>`;
}

function progressCard(ex, lastEntry){
  if(!lastEntry || !Array.isArray(lastEntry.reps) || !lastEntry.reps.length){
    return `<div class="progress-card"><strong>${escapeHTML(ex.name)}</strong><span>No log yet</span></div>`;
  }
  const top = ex.repRange[1];
  const minReps = Math.min(...lastEntry.reps.map(rep=>Number(rep)||0));
  const percent = Math.min(100, Math.round((minReps/top)*100));
  const ready = minReps >= top;
  const label = ready ? 'Ready to increase weight' : `${top-minReps} reps to ceiling`;
  return `<div class="progress-card"><div class="progress-top"><strong>${escapeHTML(ex.name)}</strong><span>${escapeHTML(Number(lastEntry.weight)||0)} kg</span></div><div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div><span class="progress-label">${escapeHTML(label)}</span></div>`;
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
      ui._sessionDirty = true;
      const badge = document.getElementById('wbadge-'+inp.dataset.ex);
      if(badge){ badge.style.background = weightColor(Number(inp.value)); badge.textContent = inp.value || '–'; }
    };
  });

  document.querySelectorAll('.reps-input').forEach(inp=>{
    inp.oninput = ()=>{ ui._sessionDirty = true; };
  });

  document.querySelectorAll('[data-action="rest"]').forEach(btn=>{
    btn.textContent = restButtonText();
    btn.disabled = Boolean(ui._restEndsAt);
    btn.onclick = ()=>startRestTimer();
  });

  const saveBtn = document.getElementById('saveSessionBtn');
  if(saveBtn){
    saveBtn.onclick = async ()=>{
      if(ui._saving) return;
      if(!db || !currentUser){ setStatus('Sign in before saving a workout.', 'warn'); render(); return; }
      if(!canSave()) { render(); return; }
      const profile = ui.profile;
      const date = (document.getElementById('dateField')||{}).value || todayISO();
      if(!isValidDate(date)){ setStatus('Choose a valid workout date.', 'warn'); render(); return; }
      const entries = {};
      let invalidEntry = false;
      EXERCISES.forEach(ex=>{
        const weightEl = document.getElementById('weight-'+ex.id);
        const weight = weightEl ? Number(weightEl.value)||0 : 0;
        const repsEls = document.querySelectorAll(`.reps-input[data-ex="${ex.id}"]`);
        const reps = Array.from(repsEls).map(el=>Number(el.value)||0);
        if(!validNumber(weight, 0, 200) || reps.length > 10 || reps.some(rep=>!validNumber(rep, 0, 500))){
          invalidEntry = true;
          return;
        }
        if(weight || reps.some(r=>r>0)) entries[ex.id] = { weight, reps };
      });
      if(invalidEntry){
        setStatus('Use weights from 0–200 kg and reps from 0–500.', 'warn');
        render();
        return;
      }
      if(!Object.keys(entries).length){
        setStatus('Nothing to save yet — enter at least one weight or rep count.', 'warn');
        showToast('Enter a workout before saving', 'warn');
        render();
        return;
      }
      const docId = `${profile}_${date}`;
      const existingSession = getSessions(profile).find(session=>session.date===date);
      const mergedEntries = { ...(existingSession && existingSession.entries || {}), ...entries };
      const payload = { profile, date, entries:mergedEntries, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
      ui._saving = true;
      setStatus('Saving workout...', '');
      render();
      let sheetsSynced = false;
      try{
        const sessionRef = db.collection('sessions').doc(docId);
        const mergedPayload = { profile, date, updatedAt: payload.updatedAt };
        Object.keys(entries).forEach(exId=>{ mergedPayload[`entries.${exId}`] = entries[exId]; });
        await sessionRef.set(mergedPayload, { merge:true });
        sheetsSynced = await pushToSheets({ profile, date, entries:mergedEntries });
        if(navigator.onLine && sheetsSynced){
          setStatus('Saved and synced!', 'good');
          showToast('Saved and synced!', 'good');
        }else{
          setStatus('Saved offline — workout will sync when internet is available.', 'warn');
          showToast('Saved offline — will sync later', 'warn');
        }
      }catch(e){
        setStatus('Saved offline — workout will sync when internet is available.', 'warn');
        showToast('Saved offline — will sync later', 'warn');
      }
      ui._saving = false;
      ui._sessionDirty = false;
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

  const signInBtn = document.getElementById('signInBtn');
  if(signInBtn) signInBtn.onclick = signIn;
  const signOutBtn = document.getElementById('signOutBtn');
  if(signOutBtn) signOutBtn.onclick = signOut;

  const historySelect = document.getElementById('historyExSelect');
  if(historySelect){
    historySelect.value = ui.historyEx || historySelect.value;
    historySelect.onchange = ()=>{ ui.historyEx = historySelect.value; render(); };
  }
}

function restButtonText(){
  if(!ui._restEndsAt) return 'Start 1:00 rest';
  const remaining = Math.max(0, Math.ceil((ui._restEndsAt-Date.now())/1000));
  return `Rest ${String(Math.floor(remaining/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}`;
}

function updateRestButtons(){
  document.querySelectorAll('[data-action="rest"]').forEach(btn=>{
    btn.textContent = restButtonText();
    btn.disabled = Boolean(ui._restEndsAt);
  });
}

function startRestTimer(){
  if(ui._restEndsAt) return;
  ui._restEndsAt = Date.now() + 60 * 1000;
  updateRestButtons();
  clearInterval(restTimerId);
  restTimerId = setInterval(()=>{
    if(Date.now() >= ui._restEndsAt){
      ui._restEndsAt = 0;
      clearInterval(restTimerId);
      restTimerId = null;
      updateRestButtons();
      showToast('Rest complete', 'good');
      return;
    }
    updateRestButtons();
  }, 250);
}

function showToast(msg, cls){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${cls||''}`;
  t.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(()=>t.classList.remove('show'), 2200);
}

render();
initFirebase();
flushSheetsQueue();
