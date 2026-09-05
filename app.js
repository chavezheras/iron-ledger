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
const SAVE_LIMIT = { count: 5, windowMs: 10 * 60 * 1000 };
const REST_SECONDS = 60;
const FINISHER_SECONDS = 60;
// ============================================================

const EXERCISES = [
  { id:'squat', name:'Goblet Squat', group:1, cue:'Chest tall, knees track toes', sets:{pelagio:3,wanix:3}, repRange:[8,12], perSide:false },
  { id:'row', name:'Single-Arm Row', group:1, cue:'Flat back, pull to hip', sets:{pelagio:3,wanix:3}, repRange:[8,12], perSide:true },
  { id:'deadlift', name:'KB Deadlift / RDL', group:2, cue:'Hinge — KB stays close to shins', sets:{pelagio:3,wanix:3}, repRange:[8,12], perSide:false },
  { id:'press', name:'Single-Arm OH Press', group:2, cue:'Ribs down, press over ear', sets:{pelagio:3,wanix:3}, repRange:[6,10], perSide:true },
  { id:'lunge', name:'Reverse Lunge', group:3, cue:'Back knee light tap, front heel down', sets:{pelagio:2,wanix:4}, repRange:[8,12], perSide:true, swap:true, swapTextPelagio:'Lighter — maintenance only', swapTextWanix:'Extra volume — your focus' },
  { id:'pushup', name:'Push-Up', group:3, cue:'Straight line, elbows ~45°', sets:{pelagio:4,wanix:2}, repRange:[8,15], perSide:false, swap:true, swapTextPelagio:'Extra volume — your focus', swapTextWanix:'Lighter — maintenance only' },
  { id:'swing', name:'Swings & Halos', group:4, cue:'One minute of swings, then one minute of halos (around the world).', sets:{pelagio:1,wanix:1}, repRange:[0,0], perSide:false, finisher:true, segmentLabels:['SWINGS','HALOS'] }
];
const GROUP_LABELS = { 1:'Squat + Row', 2:'Hinge + Press', 3:'Your emphasis slot', 4:'Conditioning finisher' };
const LAST_PAGE = 4;
const PROFILES = {
  pelagio: { name:'Pelagio', color:'var(--accent-pelagio)', hex:'#393D7E', ink:'#ffffff' },
  wanix:   { name:'Wanix',   color:'var(--accent-wanix)',  hex:'#F05A7E', ink:'#171827' }
};

// ui.page: 0 = welcome, 1-3 = supersets, 4 = finisher
let ui = { profile:'pelagio', page:0, workingDate: todayISO(), _saving:false, _saveResult:null, _status:'', _statusCls:'' };
let draft = {}; // { [exId]: { weight:'', reps:['',''] } } — raw string values entered this workout
let sessionsCache = { pelagio: [], wanix: [] };
let firestoreReady = false;
let db = null;
let auth = null;
let authReady = false;
let currentUser = null;

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
  // Keep the session (and its refresh token) in IndexedDB — the default, but
  // being explicit avoids Safari standalone-PWA quirks after popup sign-in.
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((err)=>{
    console.warn('Could not set local auth persistence:', err.code || err.message);
  });
  // Complete any pending redirect sign-in (used as a popup fallback) and
  // surface errors instead of silently bouncing back to the sign-in screen.
  auth.getRedirectResult().catch((err)=>{
    setStatus(`Sign-in failed: ${err.message}`, 'warn');
    render();
  });
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
    if(!ui._saving) render();
  }, (err)=>{
    console.error(err);
    setStatus('Sync error — check your Firebase config', 'warn');
  });
}

function isAllowedUser(user){
  return !ALLOWED_EMAILS.length || ALLOWED_EMAILS.map(email=>email.toLowerCase()).includes((user.email||'').toLowerCase());
}

async function signIn(){
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  // Popup keeps the OAuth hand-off on Firebase's own authDomain, so it works
  // when the app is hosted on a different domain (GitHub Pages). signInWithRedirect
  // breaks there because modern browsers partition cross-domain storage.
  try{
    await auth.signInWithPopup(provider);
  }catch(err){
    if(err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request'){
      return;
    }
    if(err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment'){
      // Rare environments with no popup support — fall back to redirect.
      auth.signInWithRedirect(provider).catch((e)=>{
        setStatus(`Sign-in failed: ${e.message}`, 'warn');
        render();
      });
      return;
    }
    setStatus(`Sign-in failed: ${err.message}`, 'warn');
    render();
  }
}

function signOut(){ auth.signOut(); }

function escapeHTML(value){
  return String(value ?? '').replace(/[&<>"']/g, char=>({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
}

function isValidDate(value){ return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)); }

function validNumber(value, min, max){
  return Number.isFinite(value) && value >= min && value <= max;
}

// ---------- Save throttle (only completed saves count) ----------
function recentSaveTimes(){
  const now = Date.now();
  let attempts = [];
  try { attempts = JSON.parse(localStorage.getItem('saveAttempts')||'[]'); } catch (error) { attempts = []; }
  return (Array.isArray(attempts) ? attempts : []).filter(time=>now-time<SAVE_LIMIT.windowMs);
}
function canSave(){ return recentSaveTimes().length < SAVE_LIMIT.count; }
function recordSave(){
  const recent = recentSaveTimes();
  recent.push(Date.now());
  localStorage.setItem('saveAttempts', JSON.stringify(recent));
}

function setStatus(msg, cls){ ui._status = msg; ui._statusCls = cls || ''; }

window.addEventListener('online', ()=>{ setStatus('', ''); flushSheetsQueue(); render(); });
window.addEventListener('offline', ()=>{ setStatus('Offline — your workout is stored on this phone and will sync later', 'warn'); render(); });

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

function daysAgoText(dateStr){
  if(!dateStr) return '';
  const then = Date.parse(`${dateStr}T00:00:00`);
  if(Number.isNaN(then)) return '';
  const diff = Math.round((Date.now() - then) / 86400000);
  if(diff <= 0) return 'today';
  if(diff === 1) return 'yesterday';
  return `${diff} days ago`;
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

// ---------- Draft (entered values survive navigation, reload, failed saves) ----------
function slotCount(ex){ return ex.finisher ? ex.segmentLabels.length : ex.sets[ui.profile]; }

function fallbackEntry(exId){
  const ex = EXERCISES.find(e=>e.id===exId);
  const todaySession = getSessions(ui.profile).find(s=>s.date===ui.workingDate);
  const existing = todaySession && todaySession.entries ? todaySession.entries[exId] : null;
  const last = getLastEntry(ui.profile, exId);
  const n = slotCount(ex);
  const weight = existing ? String(existing.weight ?? '')
    : (last && !ex.finisher && last.weight ? String(last.weight) : '');
  const reps = Array.from({length:n}, (_,i)=>{
    if(existing && existing.reps && existing.reps[i] != null) return String(existing.reps[i]);
    return '';
  });
  return { weight, reps };
}

function seedDraft(){
  draft = {};
  EXERCISES.forEach(ex=>{ draft[ex.id] = fallbackEntry(ex.id); });
  persistWizard();
}

function draftActive(){ return Object.keys(draft).length > 0; }

function cellValue(exId, field, i){
  const d = draft[exId] || fallbackEntry(exId);
  if(field === 'weight') return d.weight ?? '';
  return (d.reps && d.reps[i] != null) ? d.reps[i] : '';
}

function syncDraftFromDOM(){
  document.querySelectorAll('input[data-ex]').forEach(inp=>{
    const exId = inp.dataset.ex;
    if(!draft[exId]) draft[exId] = fallbackEntry(exId);
    if(inp.classList.contains('weight-input')){
      draft[exId].weight = inp.value;
    }else if(inp.classList.contains('reps-input')){
      draft[exId].reps[Number(inp.dataset.set)] = inp.value;
    }
  });
  persistWizard();
}

function persistWizard(){
  try{
    localStorage.setItem('iron-wizard', JSON.stringify({
      profile: ui.profile, date: ui.workingDate, page: ui.page, draft, savedAt: Date.now()
    }));
  }catch(e){ /* storage full / disabled — non-fatal */ }
}

function restoreWizard(){
  try{
    const w = JSON.parse(localStorage.getItem('iron-wizard') || 'null');
    if(!w) return;
    if(Date.now() - (w.savedAt || 0) > 18 * 3600 * 1000){ localStorage.removeItem('iron-wizard'); return; }
    if(w.profile === 'pelagio' || w.profile === 'wanix') ui.profile = w.profile;
    if(typeof w.date === 'string' && isValidDate(w.date)) ui.workingDate = w.date;
    if(typeof w.page === 'number' && w.page >= 0 && w.page <= LAST_PAGE) ui.page = w.page;
    if(w.draft && typeof w.draft === 'object') draft = w.draft;
  }catch(e){ /* ignore corrupt draft */ }
}

function clearWizard(){
  draft = {};
  try{ localStorage.removeItem('iron-wizard'); }catch(e){}
}

// ---------- Render ----------
function render(){
  const app = document.getElementById('app');
  if(!authReady){
    app.innerHTML = '<main class="auth-panel"><h1>Iron Ledger</h1><p>Connecting securely…</p></main>';
    return;
  }
  if(!currentUser || !isAllowedUser(currentUser)){
    app.innerHTML = `<main class="auth-panel"><h1>Iron Ledger</h1><p>Sign in with Google to access your workouts.</p><button class="auth-btn" id="signInBtn">Sign in with Google</button>${ui._status?`<div class="status-line warn">${escapeHTML(ui._status)}</div>`:''}</main>`;
    attachEvents();
    return;
  }
  app.style.setProperty('--current-accent', PROFILES[ui.profile].color);

  let body;
  if(ui.page === 0) body = renderWelcome();
  else if(ui.page >= 1 && ui.page <= 3) body = renderSupersetPage(ui.page);
  else body = renderFinisherPage();

  const pending = loadQueue().length;
  let statusHtml = '';
  if(ui._status) statusHtml = `<div class="status-line ${ui._statusCls}">${escapeHTML(ui._status)}</div>`;
  else if(ui.page === 0 && pending) statusHtml = `<div class="status-line warn">${pending} sheet ${pending===1?'entry':'entries'} waiting to sync</div>`;

  app.innerHTML = renderBanner() + statusHtml + body;
  attachEvents();
}

function kbIconSVG(){
  return `<svg viewBox="0 0 40 40" fill="none">
    <path d="M15 13c0-3 2.2-5.5 5-5.5s5 2.5 5 5.5" stroke="#948f86" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="15" cy="25" r="9" fill="${PROFILES.pelagio.hex}" opacity="0.92"/>
    <circle cx="24" cy="25" r="9" fill="${PROFILES.wanix.hex}" opacity="0.92"/>
  </svg>`;
}

function renderBanner(){
  const p = PROFILES[ui.profile];
  const back = ui.page > 0
    ? `<button class="banner-back" data-action="back" aria-label="Go back">←</button>`
    : '';
  const profileChip = ui.page > 0
    ? `<span class="banner-profile" style="background:${p.color};color:${p.ink}">${p.name}</span>`
    : '';
  return `
  <header>
    <div class="brand ${ui.page > 0 ? 'compact' : ''}">
      ${kbIconSVG()}
      <div><h1>Iron Ledger</h1><small>PELAGIO &amp; WANIX</small></div>
    </div>
    <div class="banner-right">
      ${back}
      ${profileChip}
      <button class="sign-out-btn" id="signOutBtn" title="Sign out">Sign out</button>
    </div>
  </header>`;
}

function renderWelcome(){
  const profile = ui.profile;
  const p = PROFILES[profile];
  const sessions = getSessions(profile);
  const latest = getLatestWorkoutDate(profile);
  const workingDate = ui.workingDate || todayISO();
  const hasToday = sessions.some(s=>s.date===workingDate);

  const stats = !firestoreReady
    ? `<p class="welcome-stat muted">Loading ${p.name}'s history…</p>`
    : `<p class="welcome-stat"><b>${sessions.length}</b> session${sessions.length===1?'':'s'} logged</p>
       <p class="welcome-stat">Last workout: <b>${latest ? `${escapeHTML(latest)}</b> <span class="muted">(${daysAgoText(latest)})</span>` : 'none yet</b>'}</p>`;

  return `
  <main class="welcome">
    <h2 class="welcome-title">New workout</h2>
    <label class="welcome-field">
      <span>Date</span>
      <input type="date" id="dateField" class="date-field" value="${escapeHTML(workingDate)}">
    </label>

    <div class="big-switch" role="group" aria-label="Choose profile">
      <button data-action="profile" data-profile="pelagio" class="${profile==='pelagio'?'on pelagio':''}">Pelagio</button>
      <button data-action="profile" data-profile="wanix" class="${profile==='wanix'?'on wanix':''}">Wanix</button>
    </div>

    <div class="welcome-card" style="border-color:${p.color}">
      <h3 style="color:${p.color}">${p.name}</h3>
      ${stats}
    </div>

    <button class="wizard-btn" id="startBtn" style="background:${p.color};color:${p.ink}">
      ${hasToday ? "Continue today's workout" : 'Start a new workout'}
    </button>

    <button class="clear-link" id="clearDataBtn">Clear ${p.name}'s logged sessions</button>
  </main>`;
}

function renderSupersetPage(group){
  const profile = ui.profile;
  const exs = EXERCISES.filter(e=>e.group===group);
  const cards = exs.map(ex=>exerciseCard(ex, profile)).join('');
  return `
  <main class="wizard-page">
    <div class="page-progress">Block ${group} of 3</div>
    <div class="group-label"><span>${group}. ${GROUP_LABELS[group]}</span></div>
    ${cards}
    <div class="wizard-foot">
      <button class="wizard-btn next" data-action="next" style="background:var(--current-accent)">
        Next<small>1:00 rest, then next block</small>
      </button>
    </div>
  </main>`;
}

function renderFinisherPage(){
  const profile = ui.profile;
  const ex = EXERCISES.find(e=>e.finisher);
  return `
  <main class="wizard-page">
    <div class="page-progress">Finisher</div>
    <div class="group-label"><span>4. ${GROUP_LABELS[4]}</span></div>
    ${exerciseCard(ex, profile)}
    <div class="finisher-timer">
      <button class="wizard-btn ghost" data-action="finisher">Start finisher · 2:00</button>
      <p class="muted small">One minute of swings, then one minute of halos. The rep boxes above are optional.</p>
    </div>
    <div class="wizard-foot">
      <button class="save-btn ${ui._saving?'saving':''}" data-action="save" ${ui._saving?'disabled':''} style="background:var(--current-accent)">
        ${ui._saving ? 'SAVING…' : 'Save workout'}
      </button>
      ${renderSaveResult()}
    </div>
  </main>`;
}

function renderSaveResult(){
  const r = ui._saveResult;
  if(!r) return '';
  if(r.state === 'saved'){
    return `<div class="save-result saved">WORKOUT SAVED ✓
      <small>Confirmed on the server. You're done — nice work.</small>
      <button class="result-btn" data-action="finish">Back to start</button></div>`;
  }
  if(r.state === 'local'){
    return `<div class="save-result local">SAVED ON THIS PHONE ⟳
      <small>Not confirmed with the server yet — you're offline or on a weak connection. Keep Iron Ledger installed and open it again on Wi-Fi to finish syncing. Your entries are kept here.</small>
      <button class="result-btn" data-action="save">Try to sync now</button></div>`;
  }
  return `<div class="save-result failed">NOT SAVED ✗
    <small>${escapeHTML(r.message || 'Something went wrong.')} Your entries are kept — press Save workout to try again.</small>
    <button class="result-btn" data-action="save">Try again</button></div>`;
}

function exerciseCard(ex, profile){
  const lastEntry = getLastEntry(profile, ex.id);
  const badge = progressionBadge(ex, lastEntry);
  const swapTag = ex.swap
    ? `<span class="swap-tag" style="background:${profile==='pelagio'?'var(--accent-pelagio-dim)':'var(--accent-wanix-dim)'};color:${PROFILES[profile].color}">${profile==='pelagio'?ex.swapTextPelagio:ex.swapTextWanix}</span>`
    : '';
  const setsCount = slotCount(ex);
  const targetText = ex.finisher
    ? 'Target: 1 min swings, then 1 min halos'
    : `Target: ${ex.repRange[0]}–${ex.repRange[1]} reps${ex.perSide?'/side':''} × ${setsCount} sets`;
  const lastReps = Array.isArray(lastEntry && lastEntry.reps) ? lastEntry.reps : [];
  const lastTimeText = lastEntry
    ? `Last time: ${escapeHTML(lastReps.map(rep=>Number(rep)||0).join(', '))}${ex.finisher ? '' : ` @ ${escapeHTML(Number(lastEntry.weight)||0)}kg`}`
    : 'No previous log yet';

  let repsHtml = '';
  if(ex.finisher){
    repsHtml = ex.segmentLabels.map((label, i)=>{
      const val = cellValue(ex.id, 'reps', i);
      return `<div class="set-col"><label>${escapeHTML(label)}<br>reps</label><input type="number" inputmode="numeric" min="0" data-ex="${ex.id}" data-set="${i}" class="reps-input" value="${escapeHTML(val)}" style="width:64px"></div>`;
    }).join('');
  }else{
    for(let i=0;i<setsCount;i++){
      const val = cellValue(ex.id, 'reps', i);
      repsHtml += `<div class="set-col"><label>SET ${i+1}</label><input type="number" inputmode="numeric" min="0" data-ex="${ex.id}" data-set="${i}" class="reps-input" value="${escapeHTML(val)}"></div>`;
    }
  }

  const w = Number(cellValue(ex.id, 'weight')) || 0;
  const weightBlock = ex.finisher ? '' : `
    <div class="weight-wrap">
      <div class="weight-badge" id="wbadge-${ex.id}" style="background:${weightColor(w)}">${w||'–'}</div>
      <input type="number" inputmode="decimal" min="0" step="0.5" class="weight-input" data-ex="${ex.id}" id="weight-${ex.id}" value="${escapeHTML(cellValue(ex.id,'weight'))}" placeholder="kg">
    </div>`;

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
      ${weightBlock}
      <div class="reps-group">${repsHtml}</div>
    </div>
  </div>`;
}

// ---------- Fullscreen countdown + screen wake lock ----------
let cd = { raf:0, active:false, wakeLock:null, skip:null };
let audioCtx = null;

function primeAudio(){
  try{
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if(audioCtx.state === 'suspended') audioCtx.resume();
  }catch(e){ audioCtx = null; }
}

async function acquireWakeLock(){
  try{
    if('wakeLock' in navigator){
      cd.wakeLock = await navigator.wakeLock.request('screen');
      cd.wakeLock.addEventListener('release', ()=>{ cd.wakeLock = null; });
    }
  }catch(e){ cd.wakeLock = null; }
}
function releaseWakeLock(){
  try{ if(cd.wakeLock) cd.wakeLock.release(); }catch(e){}
  cd.wakeLock = null;
}
document.addEventListener('visibilitychange', ()=>{
  if(cd.active && document.visibilityState === 'visible' && !cd.wakeLock) acquireWakeLock();
});

function endCue(){
  try{ if(navigator.vibrate) navigator.vibrate([250, 90, 250]); }catch(e){}
  try{
    if(!audioCtx) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.4);
    o.start();
    o.stop(audioCtx.currentTime + 0.4);
  }catch(e){}
}

// segments: [{ label, seconds, sub }]
function runCountdown(segments, onDone){
  const el = document.getElementById('countdown');
  const labelEl = document.getElementById('cdLabel');
  const timeEl = document.getElementById('cdTime');
  const subEl = document.getElementById('cdSub');
  cd.active = true;
  el.hidden = false;
  document.body.classList.add('cd-open');
  acquireWakeLock();

  let idx = 0;
  let endsAt = 0;

  function paint(){
    const remaining = Math.max(0, endsAt - Date.now());
    const s = Math.ceil(remaining / 1000);
    timeEl.textContent = `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
    el.classList.toggle('warn', s <= 10 && remaining > 0);
    if(remaining <= 0){
      endCue();
      idx++;
      startSegment();
      return;
    }
    cd.raf = requestAnimationFrame(paint);
  }

  function startSegment(){
    cancelAnimationFrame(cd.raf);
    if(idx >= segments.length){ finish(); return; }
    const seg = segments[idx];
    labelEl.textContent = seg.label;
    subEl.textContent = seg.sub || (segments.length > 1 ? `${idx+1} of ${segments.length}` : '');
    endsAt = Date.now() + seg.seconds * 1000;
    el.classList.remove('warn');
    paint();
  }

  function finish(){
    cancelAnimationFrame(cd.raf);
    cd.active = false;
    cd.skip = null;
    releaseWakeLock();
    el.hidden = true;
    el.classList.remove('warn');
    document.body.classList.remove('cd-open');
    if(typeof onDone === 'function') onDone();
  }

  cd.skip = ()=>{ idx++; startSegment(); };
  startSegment();
}

// ---------- Save ----------
function collectEntries(){
  // Returns { entries, error }. entries: only exercises with data. error: reason string.
  const entries = {};
  for(const ex of EXERCISES){
    const d = draft[ex.id];
    if(!d) continue;
    const weight = ex.finisher ? 0 : (Number(d.weight) || 0);
    const reps = (d.reps || []).map(r=>Number(r) || 0);
    if(!validNumber(weight, 0, 200)) return { error: 'check-values' };
    if(reps.length > 10 || reps.some(r=>!validNumber(r, 0, 500))) return { error: 'check-values' };
    // Only log an exercise the user actually did — a pre-filled weight with no
    // reps is just the suggested starting load for a block they skipped.
    if(reps.some(r=>r > 0)) entries[ex.id] = { weight, reps };
  }
  if(!Object.keys(entries).length) return { error: 'empty' };
  return { entries };
}

const SAVE_MESSAGES = {
  'permission-denied': "This Google account isn't authorised, or your sign-in expired. Tap Sign out, sign in again, and retry.",
  'unauthenticated': "You're signed out. Sign in again and retry.",
  'check-values': 'Some numbers are out of range — weight 0–200 kg, reps 0–500.',
  'empty': 'Nothing entered yet — add at least one weight or rep count.',
  'bad-date': 'The workout date looks invalid — go back to the start and pick it again.',
  'rate-limit': "You've saved several times in a row. Wait a couple of minutes, then try again.",
  'unavailable': "Couldn't reach the server."
};

async function saveWorkout(){
  if(ui._saving) return;
  syncDraftFromDOM();

  ui._saving = true;
  ui._saveResult = null;
  render();

  const startedAt = Date.now();
  const MIN_VISIBLE_MS = 1600;
  const finishUp = async (result)=>{
    const elapsed = Date.now() - startedAt;
    if(elapsed < MIN_VISIBLE_MS) await new Promise(r=>setTimeout(r, MIN_VISIBLE_MS - elapsed));
    if(result.state === 'failed' || result.state === 'local') result.message = SAVE_MESSAGES[result.detail] || `Error: ${result.detail}`;
    ui._saving = false;
    ui._saveResult = result;
    if(result.state === 'saved') clearWizard();
    render();
  };

  const profile = ui.profile;
  const date = ui.workingDate;

  if(!db || !currentUser) return finishUp({ state:'failed', detail:'unauthenticated' });
  if(!isValidDate(date)) return finishUp({ state:'failed', detail:'bad-date' });
  if(!canSave()) return finishUp({ state:'failed', detail:'rate-limit' });

  const { entries, error } = collectEntries();
  if(error) return finishUp({ state:'failed', detail:error });

  const docId = `${profile}_${date}`;
  const ref = db.collection('sessions').doc(docId);
  const payload = { profile, date, entries, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };

  try{
    try{
      await ref.set(payload, { merge:true });
    }catch(err){
      if((err.code === 'permission-denied' || err.code === 'unauthenticated') && currentUser && currentUser.getIdToken){
        // Stale ID token — common right after popup sign-in. Refresh and retry once.
        try{
          await currentUser.getIdToken(true);
          await ref.set(payload, { merge:true });
        }catch(retryErr){
          throw (retryErr && retryErr.code) ? retryErr : err;
        }
      }else{
        throw err;
      }
    }
  }catch(err){
    console.error('Firestore write failed:', err);
    return finishUp({ state:'failed', detail: err.code || err.message || 'unknown' });
  }

  // Confirm the write actually reached the server — the only "absolutely saved".
  let confirmed = false;
  try{
    const snap = await ref.get({ source: 'server' });
    const saved = snap.exists ? (snap.data().entries || {}) : {};
    confirmed = Object.keys(entries).every(id=>saved[id]);
  }catch(err){
    confirmed = false; // offline: the write is queued locally, not on the server
  }

  if(!confirmed) return finishUp({ state:'local', detail:'unavailable' });

  recordSave();
  const existingSession = getSessions(profile).find(s=>s.date===date);
  const mergedEntries = { ...(existingSession && existingSession.entries || {}), ...entries };
  pushToSheets({ profile, date, entries: mergedEntries });
  return finishUp({ state:'saved' });
}

// ---------- Events ----------
function attachEvents(){
  const signInBtn = document.getElementById('signInBtn');
  if(signInBtn){ signInBtn.onclick = signIn; return; }

  const signOutBtn = document.getElementById('signOutBtn');
  if(signOutBtn) signOutBtn.onclick = signOut;

  document.querySelectorAll('[data-action="back"]').forEach(btn=>{
    btn.onclick = ()=>{
      syncDraftFromDOM();
      ui.page = Math.max(0, ui.page - 1);
      ui._saveResult = null;
      persistWizard();
      render();
    };
  });

  document.querySelectorAll('[data-action="profile"]').forEach(btn=>{
    btn.onclick = ()=>{ ui.profile = btn.dataset.profile; persistWizard(); render(); };
  });

  const dateField = document.getElementById('dateField');
  if(dateField) dateField.onchange = ()=>{ ui.workingDate = dateField.value || todayISO(); persistWizard(); render(); };

  const startBtn = document.getElementById('startBtn');
  if(startBtn){
    startBtn.onclick = ()=>{
      if(!draftActive()) seedDraft();
      ui.page = 1;
      ui._saveResult = null;
      persistWizard();
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

  document.querySelectorAll('.weight-input').forEach(inp=>{
    inp.oninput = ()=>{
      syncDraftFromDOM();
      const badge = document.getElementById('wbadge-'+inp.dataset.ex);
      if(badge){ badge.style.background = weightColor(Number(inp.value)); badge.textContent = inp.value || '–'; }
    };
  });
  document.querySelectorAll('.reps-input').forEach(inp=>{
    inp.oninput = ()=>{ syncDraftFromDOM(); };
  });

  document.querySelectorAll('[data-action="next"]').forEach(btn=>{
    btn.onclick = ()=>{
      primeAudio();
      syncDraftFromDOM();
      const goTo = Math.min(LAST_PAGE, ui.page + 1);
      runCountdown([{ label:'REST', seconds:REST_SECONDS }], ()=>{
        ui.page = goTo;
        ui._saveResult = null;
        persistWizard();
        render();
      });
    };
  });

  document.querySelectorAll('[data-action="finisher"]').forEach(btn=>{
    btn.onclick = ()=>{
      primeAudio();
      syncDraftFromDOM();
      runCountdown([
        { label:'SWINGS', seconds:FINISHER_SECONDS, sub:'1 of 2' },
        { label:'HALOS', seconds:FINISHER_SECONDS, sub:'2 of 2' }
      ], ()=>{ showToast('Finisher done', 'good'); });
    };
  });

  document.querySelectorAll('[data-action="save"]').forEach(btn=>{ btn.onclick = saveWorkout; });

  document.querySelectorAll('[data-action="finish"]').forEach(btn=>{
    btn.onclick = ()=>{
      ui.page = 0;
      ui._saveResult = null;
      ui._status = '';
      persistWizard();
      render();
    };
  });
}

function showToast(msg, cls){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${cls||''}`;
  t.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(()=>t.classList.remove('show'), 2200);
}

// ---------- Boot ----------
const cdSkipBtn = document.getElementById('cdSkip');
if(cdSkipBtn) cdSkipBtn.onclick = ()=>{ if(cd.skip) cd.skip(); };

restoreWizard();
render();
initFirebase();
flushSheetsQueue();
