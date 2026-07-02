const SPREADSHEET_ID = '1pO5pqKabpkbU6osHeJjXFyJGjNxLThqedOLnBQsAJ_4';
const SHEET_NAMES = {
  users: 'Users',
  matches: 'Matches',
  predictions: 'Predictions',
  specialQuestions: 'SpecialQuestions',
  specialQuestionResponses: 'SpecialQuestionResponses',
  leaderboard: 'Leaderboard'
};

function getSpreadsheet() {
  if (!SPREADSHEET_ID || SPREADSHEET_ID.trim() === '') {
    throw new Error('Set SPREADSHEET_ID in Code.gs before deploying.');
  }
  return SpreadsheetApp.openById(SPREADSHEET_ID.trim());
}

function getOrCreateSheet(spreadsheet, name) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }
  return sheet;
}

function ensureHeaders(sheet, headers) {
  const existing = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  if (existing.join('') !== headers.join('')) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
}

function ensureDefaultAdmin(spreadsheet) {
  const usersSheet = getOrCreateSheet(spreadsheet, SHEET_NAMES.users);
  ensureHeaders(usersSheet, ['username', 'password', 'role']);
  const values = usersSheet.getDataRange().getValues();
  const rows = values.slice(1);
  const hasAnyUsers = rows.some((row) => String(row[0] || '').trim() !== '');
  const hasDefaultAdmin = rows.some((row) => String(row[0] || '').trim().toLowerCase() === 'dread');
  if (!hasAnyUsers && !hasDefaultAdmin) {
    usersSheet.appendRow(['dread', 'Test1234', 'admin']);
  }
}

function findRowIndex(sheet, columnName, value, headers) {
  const values = sheet.getDataRange().getValues();
  if (!values.length) return -1;
  const index = headers.indexOf(columnName);
  if (index === -1) return -1;
  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    if (values[rowIndex][index] == value) {
      return rowIndex + 1;
    }
  }
  return -1;
}

function findPredictionRow(sheet, username, matchNumber, headers) {
  const values = sheet.getDataRange().getValues();
  if (!values.length) return -1;
  const usernameIndex = headers.indexOf('username');
  const matchNumberIndex = headers.indexOf('matchNumber');
  if (usernameIndex === -1 || matchNumberIndex === -1) return -1;
  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    if (values[rowIndex][usernameIndex] == username && values[rowIndex][matchNumberIndex] == matchNumber) {
      return rowIndex + 1;
    }
  }
  return -1;
}

function findResponseRow(sheet, username, questionID, headers) {
  const values = sheet.getDataRange().getValues();
  if (!values.length) return -1;
  const usernameIndex = headers.indexOf('username');
  const questionIndex = headers.indexOf('questionID');
  if (usernameIndex === -1 || questionIndex === -1) return -1;
  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    if (values[rowIndex][usernameIndex] == username && values[rowIndex][questionIndex] == questionID) {
      return rowIndex + 1;
    }
  }
  return -1;
}

function sheetToObjects(sheet, headers) {
  const values = sheet.getDataRange().getValues();
  if (!values.length) return [];
  const rows = values.slice(1);
  return rows
    .filter((row) => row.some((cell) => cell !== ''))
    .map((row) => {
      const item = {};
      headers.forEach((header, index) => {
        item[header] = row[index] || '';
      });
      return item;
    });
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function doOptions(e) {
  return jsonResponse({ status: 'ok' });
}

function doGet(e) {
  try {
    const spreadsheet = getSpreadsheet();
    ensureDefaultAdmin(spreadsheet);
    const usersSheet = getOrCreateSheet(spreadsheet, SHEET_NAMES.users);
    const matchesSheet = getOrCreateSheet(spreadsheet, SHEET_NAMES.matches);
    const predictionsSheet = getOrCreateSheet(spreadsheet, SHEET_NAMES.predictions);
    const questionsSheet = getOrCreateSheet(spreadsheet, SHEET_NAMES.specialQuestions);
    const responsesSheet = getOrCreateSheet(spreadsheet, SHEET_NAMES.specialQuestionResponses);

    ensureHeaders(usersSheet, ['username', 'password', 'role']);
    ensureHeaders(matchesSheet, ['id', 'matchNumber', 'tournament', 'teamA', 'teamB', 'kickoffDateTime', 'finalScoreA', 'finalScoreB', 'status']);
    ensureHeaders(predictionsSheet, ['username', 'matchNumber', 'predictionA', 'predictionB', 'timestamp', 'participationPoints', 'correctResultPoints', 'exactScorePoints', 'totalPoints']);
    ensureHeaders(questionsSheet, ['id', 'question', 'correctAnswer', 'deadline', 'status', 'points']);
    ensureHeaders(responsesSheet, ['username', 'questionID', 'userAnswer', 'awardedPoints', 'timestamp']);

    return jsonResponse({
      status: 'ok',
      users: sheetToObjects(usersSheet, ['username', 'password', 'role']),
      matches: sheetToObjects(matchesSheet, ['id', 'matchNumber', 'tournament', 'teamA', 'teamB', 'kickoffDateTime', 'finalScoreA', 'finalScoreB', 'status']),
      predictions: sheetToObjects(predictionsSheet, ['username', 'matchNumber', 'predictionA', 'predictionB', 'timestamp', 'participationPoints', 'correctResultPoints', 'exactScorePoints', 'totalPoints']),
      specialQuestions: sheetToObjects(questionsSheet, ['id', 'question', 'correctAnswer', 'deadline', 'status', 'points']),
      specialQuestionResponses: sheetToObjects(responsesSheet, ['username', 'questionID', 'userAnswer', 'awardedPoints', 'timestamp'])
    });
  } catch (error) {
    return jsonResponse({ status: 'error', message: error.message });
  }
}

function doPost(e) {
  try {
    const postData = JSON.parse(e.postData.contents || '{}');
    const action = postData.action;
    const payload = postData.payload || {};
    const spreadsheet = getSpreadsheet();

    if (action === 'saveUser') {
      const sheet = getOrCreateSheet(spreadsheet, SHEET_NAMES.users);
      const headers = ['username', 'password', 'role'];
      ensureHeaders(sheet, headers);
      const rowIndex = findRowIndex(sheet, 'username', payload.username, headers);
      const row = [payload.username, payload.password, payload.role || 'user'];
      if (rowIndex > 0) {
        sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
      } else {
        sheet.appendRow(row);
      }
      return jsonResponse({ status: 'ok', action: 'saveUser' });
    }

    if (action === 'saveSpecialResponse') {
      const sheet = getOrCreateSheet(spreadsheet, SHEET_NAMES.specialQuestionResponses);
      const headers = ['username', 'questionID', 'userAnswer', 'awardedPoints', 'timestamp'];
      ensureHeaders(sheet, headers);
      const rowIndex = findResponseRow(sheet, payload.username, payload.questionID, headers);
      const row = [payload.username, payload.questionID, payload.userAnswer, payload.awardedPoints, payload.timestamp];
      if (rowIndex > 0) {
        sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
      } else {
        sheet.appendRow(row);
      }
      return jsonResponse({ status: 'ok', action: 'saveSpecialResponse' });
    }

    if (action === 'savePrediction') {
      const sheet = getOrCreateSheet(spreadsheet, SHEET_NAMES.predictions);
      const headers = ['username', 'matchNumber', 'predictionA', 'predictionB', 'timestamp', 'participationPoints', 'correctResultPoints', 'exactScorePoints', 'totalPoints'];
      ensureHeaders(sheet, headers);
      const rowIndex = findPredictionRow(sheet, payload.username, payload.matchNumber, headers);
      const row = [
        payload.username,
        payload.matchNumber,
        payload.predictionA,
        payload.predictionB,
        payload.timestamp,
        payload.participationPoints,
        payload.correctResultPoints,
        payload.exactScorePoints,
        payload.totalPoints
      ];
      if (rowIndex > 0) {
        sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
      } else {
        sheet.appendRow(row);
      }
      return jsonResponse({ status: 'ok', action: 'savePrediction' });
    }

    if (action === 'saveMatch') {
      const sheet = getOrCreateSheet(spreadsheet, SHEET_NAMES.matches);
      const headers = ['id', 'matchNumber', 'tournament', 'teamA', 'teamB', 'kickoffDateTime', 'finalScoreA', 'finalScoreB', 'status'];
      ensureHeaders(sheet, headers);
      const rowIndex = findRowIndex(sheet, 'id', payload.id, headers);
      const row = [
        payload.id,
        payload.matchNumber,
        payload.tournament,
        payload.teamA,
        payload.teamB,
        payload.kickoffDateTime,
        payload.finalScoreA,
        payload.finalScoreB,
        payload.status
      ];
      if (rowIndex > 0) {
        sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
      } else {
        sheet.appendRow(row);
      }
      return jsonResponse({ status: 'ok', action: 'saveMatch' });
    }

    if (action === 'deleteMatch') {
      const sheet = getOrCreateSheet(spreadsheet, SHEET_NAMES.matches);
      const headers = ['id', 'matchNumber', 'tournament', 'teamA', 'teamB', 'kickoffDateTime', 'finalScoreA', 'finalScoreB', 'status'];
      ensureHeaders(sheet, headers);
      const rowIndex = findRowIndex(sheet, 'id', payload.id, headers);
      if (rowIndex > 0) {
        sheet.deleteRow(rowIndex);
      }
      return jsonResponse({ status: 'ok', action: 'deleteMatch' });
    }

    if (action === 'saveQuestion') {
      const sheet = getOrCreateSheet(spreadsheet, SHEET_NAMES.specialQuestions);
      const headers = ['id', 'question', 'correctAnswer', 'deadline', 'status', 'points'];
      ensureHeaders(sheet, headers);
      const rowIndex = findRowIndex(sheet, 'id', payload.id, headers);
      const row = [payload.id, payload.question, payload.correctAnswer, payload.deadline, payload.status, payload.points];
      if (rowIndex > 0) {
        sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
      } else {
        sheet.appendRow(row);
      }
      return jsonResponse({ status: 'ok', action: 'saveQuestion' });
    }

    return jsonResponse({ status: 'ok', received: postData });
  } catch (error) {
    return jsonResponse({ status: 'error', message: error.message });
  }
}
