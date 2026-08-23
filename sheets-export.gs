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

function doPost(e) {
  var body = JSON.parse(e.postData.contents);
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

  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return ContentService.createTextOutput('Iron Ledger sync endpoint is running.');
}
