const { google } = require('googleapis');
const { googleServiceAccountKeyPath } = require('../../config/env');

const auth = new google.auth.GoogleAuth({
  keyFile: googleServiceAccountKeyPath,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

async function getSheetRows(spreadsheetId, tabName) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: tabName,
  });

  const rows = response.data.values || [];
  if (rows.length === 0) return [];

  const [headerRow, ...dataRows] = rows;

  return dataRows.map((row) => {
    const record = {};
    headerRow.forEach((header, index) => {
      record[header] = row[index] || '';
    });
    return record;
  });
}

module.exports = { getSheetRows };