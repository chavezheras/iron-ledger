// ============================================================
// Iron Ledger — Sheets mirror
// Paste this into: your Google Sheet > Extensions > Apps Script
// Then: Deploy > New deployment > type "Web app" >
//   Execute as: Me
//   Who has access: Anyone
// Deploy, authorize, and copy the resulting web app URL into
// SHEETS_WEBHOOK_URL in app.js.
// ============================================================

var COLUMNS = [
  'Key', 'Updated At', 'Profile', 'Date',
  'Goblet Squat kg', 'Goblet Squat reps',
  'Row kg', 'Row reps',
  'Deadlift kg', 'Deadlift reps',
  'Press kg', 'Press reps',
  'Lunge kg', 'Lunge reps',
  'Push-up kg', 'Push-up reps',
  'Swing kg', 'Swing reps'
];

var EXERCISE_ORDER = ['squat', 'row', 'deadlift', 'press', 'lunge', 'pushup', 'swing'];
var MAX_REQUESTS_PER_MINUTE = 30;

function jsonResponse(body) {
  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

function validPayload(body) {
  if (!body || ['pelagio', 'wanix'].indexOf(body.profile) === -1
      || !/^\d{4}-\d{2}-\d{2}$/.test(body.date || '')
      || !body.entries || typeof body.entries !== 'object') return false;
  var ids = Object.keys(body.entries);
  if (ids.length > EXERCISE_ORDER.length) return false;
  for (var i = 0; i < ids.length; i++) {
    if (EXERCISE_ORDER.indexOf(ids[i]) === -1) return false;
    var entry = body.entries[ids[i]];
    if (!entry || typeof entry.weight !== 'number' || entry.weight < 0 || entry.weight > 200
        || !Array.isArray(entry.reps) || entry.reps.length > 10) return false;
    for (var j = 0; j < entry.reps.length; j++) {
      if (typeof entry.reps[j] !== 'number' || entry.reps[j] < 0 || entry.reps[j] > 500) return false;
    }
  }
  return true;
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (error) {
    return jsonResponse({ ok: false, error: 'Invalid JSON' });
  }
  if (!validPayload(body)) return jsonResponse({ ok: false, error: 'Invalid workout payload' });

  var cache = CacheService.getScriptCache();
  var rateKey = 'iron-ledger-rate-window';
  var rate = JSON.parse(cache.get(rateKey) || '{"count":0}');
  if (rate.count >= MAX_REQUESTS_PER_MINUTE) return jsonResponse({ ok: false, error: 'Rate limit exceeded' });
  cache.put(rateKey, JSON.stringify({ count: rate.count + 1 }), 60);

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Log')
    || SpreadsheetApp.getActiveSpreadsheet().insertSheet('Log');

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS);
  }

  var entries = body.entries || {};
  function exCols(id) {
    var entry = entries[id];
    return entry ? [entry.weight, (entry.reps || []).join(', ')] : ['', ''];
  }

  var key = body.profile + '|' + body.date;
  var row = [key, new Date(), body.profile, body.date];
  EXERCISE_ORDER.forEach(function (id) { row = row.concat(exCols(id)); });

  var data = sheet.getDataRange().getValues();
  var rowIndex = -1;
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) { rowIndex = i + 1; break; }
  }
  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }

  return jsonResponse({ ok: true });
}

function doGet(e) {
  return ContentService.createTextOutput('Iron Ledger sync endpoint is running.');
}
