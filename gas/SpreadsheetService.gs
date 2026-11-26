/**
 * SpreadsheetService.gs
 * Googleスプレッドシートへの接続、初回セットアップ（シート作成・ヘッダー初期化）、
 * 行データのオブジェクト変換・CRUD共通処理、操作ログ記録を担当します。
 */

var cachedSpreadsheet_ = null;

/**
 * 対象スプレッドシートを取得
 */
function getSpreadsheet_() {
  if (cachedSpreadsheet_) {
    return cachedSpreadsheet_;
  }
  var spreadsheetId = getSpreadsheetId_();
  try {
    cachedSpreadsheet_ = SpreadsheetApp.openById(spreadsheetId);
    return cachedSpreadsheet_;
  } catch (e) {
    throw createAppError_(
      'SPREADSHEET_OPEN_ERROR',
      '指定されたSPREADSHEET_IDのスプレッドシートを開けませんでした。IDとアクセス権限を確認してください。',
      false
    );
  }
}

/**
 * 全必須シートの存在確認と初期化（既存データは絶対に消去しない）
 */
function ensureDatabaseInitialized_() {
  var ss = getSpreadsheet_();
  var sheetNames = [
    CONFIG.SHEETS.APPLICATIONS,
    CONFIG.SHEETS.REPOSITORIES,
    CONFIG.SHEETS.ARTICLE_TEMPLATES,
    CONFIG.SHEETS.NOTICES,
    CONFIG.SHEETS.INQUIRIES,
    CONFIG.SHEETS.OPERATION_LOGS
  ];

  var initializedSheets = [];

  for (var i = 0; i < sheetNames.length; i++) {
    var name = sheetNames[i];
    var headers = CONFIG.HEADERS[name];
    var sheet = ss.getSheetByName(name);
    var created = false;

    if (!sheet) {
      sheet = ss.insertSheet(name);
      created = true;
    }

    var lastRow = sheet.getLastRow();
    if (lastRow === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    } else {
      // 既存ヘッダーを確認し、不足カラムがあれば末尾に追加（既存データを破壊しない）
      var lastCol = Math.max(sheet.getLastColumn(), headers.length);
      var currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      var updated = false;
      for (var c = 0; c < headers.length; c++) {
        if (!currentHeaders[c] || String(currentHeaders[c]).trim() === '') {
          currentHeaders[c] = headers[c];
          updated = true;
        }
      }
      if (updated) {
        sheet.getRange(1, 1, 1, currentHeaders.length).setValues([currentHeaders]);
      }
    }

    initializedSheets.push({
      name: name,
      created: created,
      rowCount: Math.max(0, sheet.getLastRow() - 1)
    });
  }

  return {
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName(),
    sheets: initializedSheets
  };
}

/**
 * 指定シートを取得（存在しなければ自動作成・ヘッダー設定）
 */
function getSheetByNameSafe_(sheetName) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    ensureDatabaseInitialized_();
    sheet = ss.getSheetByName(sheetName);
  }
  return sheet;
}

/**
 * シートの全レコードをオブジェクト配列として取得
 */
function getAllRecords_(sheetName) {
  var sheet = getSheetByNameSafe_(sheetName);
  var headers = CONFIG.HEADERS[sheetName];
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return [];
  }
  var numRows = lastRow - 1;
  var values = sheet.getRange(2, 1, numRows, headers.length).getValues();
  var records = [];

  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    // ID列が空の行はスキップ
    if (row[0] === null || row[0] === undefined || String(row[0]).trim() === '') {
      continue;
    }
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      var val = row[c];
      if (val instanceof Date) {
        obj[headers[c]] = val.toISOString();
      } else {
        obj[headers[c]] = val;
      }
    }
    obj._rowIndex = r + 2; // 1-based row number in sheet
    records.push(obj);
  }
  return records;
}

/**
 * IDで単一レコードを検索
 */
function findRecordById_(sheetName, id) {
  var targetId = String(id || '').trim();
  if (!targetId) return null;
  var records = getAllRecords_(sheetName);
  for (var i = 0; i < records.length; i++) {
    if (String(records[i].id) === targetId) {
      return records[i];
    }
  }
  return null;
}

/**
 * 新規レコードを末尾に追加
 */
function insertRecord_(sheetName, recordObj) {
  var sheet = getSheetByNameSafe_(sheetName);
  var headers = CONFIG.HEADERS[sheetName];
  var row = [];
  for (var c = 0; c < headers.length; c++) {
    var key = headers[c];
    var val = Object.prototype.hasOwnProperty.call(recordObj, key) ? recordObj[key] : '';
    row.push(sanitizeForSheetCell_(val));
  }
  sheet.appendRow(row);
  return recordObj;
}

/**
 * ID指定で既存レコードを更新
 */
function updateRecordById_(sheetName, id, updaterFn) {
  var sheet = getSheetByNameSafe_(sheetName);
  var headers = CONFIG.HEADERS[sheetName];
  var existing = findRecordById_(sheetName, id);
  if (!existing) {
    throw createAppError_('NOT_FOUND', '対象のデータ（ID: ' + id + '）が見つかりません。', false);
  }

  var updatedObj = updaterFn(existing);
  var row = [];
  for (var c = 0; c < headers.length; c++) {
    var key = headers[c];
    var val = Object.prototype.hasOwnProperty.call(updatedObj, key) ? updatedObj[key] : '';
    row.push(sanitizeForSheetCell_(val));
  }

  sheet.getRange(existing._rowIndex, 1, 1, headers.length).setValues([row]);
  return updatedObj;
}

/**
 * ID指定でレコードを削除
 */
function deleteRecordById_(sheetName, id) {
  var sheet = getSheetByNameSafe_(sheetName);
  var existing = findRecordById_(sheetName, id);
  if (!existing) {
    throw createAppError_('NOT_FOUND', '削除対象のデータ（ID: ' + id + '）が見つかりません。', false);
  }
  sheet.deleteRow(existing._rowIndex);
  return existing;
}

/**
 * 操作ログを OperationLogs シートに記録
 */
function recordOperationLog_(actorEmail, action, targetType, targetId, summary, status) {
  try {
    var logRecord = {
      id: generateId_('log'),
      timestamp: nowIso_(),
      actorEmail: String(actorEmail || 'system'),
      action: String(action || ''),
      targetType: String(targetType || ''),
      targetId: String(targetId || ''),
      summary: String(summary || ''),
      status: String(status || 'SUCCESS')
    };
    insertRecord_(CONFIG.SHEETS.OPERATION_LOGS, logRecord);
  } catch (e) {
    // ログ記録の失敗で本処理を中断させないがStackdriverに出力
    console.error('OperationLog記録失敗:', e);
  }
}
