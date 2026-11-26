/**
 * Utils.gs
 * 共通ユーティリティ・エラー生成・入力値検証・排他ロック・日時処理を提供します。
 */

/**
 * アプリケーション共通エラーオブジェクトを生成
 * @param {string} code エラーコード
 * @param {string} message ユーザーに表示可能なエラーメッセージ（秘密情報を含めない）
 * @param {boolean} retryable 再試行可能かどうか
 * @param {Object=} details 追加の安全な詳細情報（SHA競合時のremoteContent等）
 */
function createAppError_(code, message, retryable, details) {
  var err = new Error(message);
  err.name = 'AppError';
  err.code = code || 'UNKNOWN_ERROR';
  err.userMessage = message;
  err.retryable = Boolean(retryable);
  err.details = details || null;
  return err;
}

/**
 * 現在時刻をISO 8601形式（UTC）で取得
 */
function nowIso_() {
  return new Date().toISOString();
}

/**
 * ISO 8601文字列が有効かどうかを判定し、標準化したISO文字列を返す
 */
function normalizeIsoDate_(value, fieldName, allowEmpty) {
  if (value === null || value === undefined || String(value).trim() === '') {
    if (allowEmpty) return '';
    throw createAppError_('VALIDATION_ERROR', fieldName + ' の日時が空です。', false);
  }
  var d = new Date(String(value));
  if (isNaN(d.getTime())) {
    throw createAppError_('VALIDATION_ERROR', fieldName + ' の日時形式が不正です（ISO 8601形式で指定してください）。', false);
  }
  return d.toISOString();
}

/**
 * 一意のUUIDを生成
 */
function generateId_(prefix) {
  var uuid = Utilities.getUuid();
  return prefix ? prefix + '_' + uuid : uuid;
}

/**
 * 文字列の必須・最大長チェック
 */
function validateString_(value, fieldLabel, options) {
  var opts = options || {};
  var str = value === null || value === undefined ? '' : String(value);
  if (opts.trim !== false) {
    str = str.trim();
  }
  if (opts.required && str.length === 0) {
    throw createAppError_('VALIDATION_ERROR', fieldLabel + ' は必須項目です。', false);
  }
  if (opts.maxLength && str.length > opts.maxLength) {
    throw createAppError_(
      'VALIDATION_ERROR',
      fieldLabel + ' は ' + opts.maxLength + ' 文字以内で入力してください（現在: ' + str.length + ' 文字）。',
      false
    );
  }
  if (opts.pattern && str.length > 0 && !opts.pattern.test(str)) {
    throw createAppError_(
      'VALIDATION_ERROR',
      opts.patternMessage || (fieldLabel + ' の形式が正しくありません。'),
      false
    );
  }
  return str;
}

/**
 * メールアドレス形式の検証
 */
function validateEmail_(email, fieldLabel) {
  var str = validateString_(email, fieldLabel || 'メールアドレス', {
    required: true,
    maxLength: CONFIG.LIMITS.INQUIRY_EMAIL_MAX
  });
  var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(str)) {
    throw createAppError_('VALIDATION_ERROR', (fieldLabel || 'メールアドレス') + ' の形式が正しくありません。', false);
  }
  return str;
}

/**
 * Google Sheetsの数式インジェクション（CSV/Sheet Injection）を防止するためのサニタイズ
 * 先頭が =, +, -, @ で始まる文字列をセルに書き込む際、文字列として扱うかエスケープします。
 */
function sanitizeForSheetCell_(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  var str = String(value);
  if (/^[=+\-@]/.test(str)) {
    return "'" + str;
  }
  return str;
}

/**
 * シートから読み取ったセル値の先頭アポストロフィ補正（必要に応じて文字列化）
 */
function parseBooleanCell_(val) {
  if (val === true || val === 'true' || val === 'TRUE' || val === '1' || val === 1) {
    return true;
  }
  return false;
}

/**
 * LockServiceを用いた排他実行ラッパー
 */
function withScriptLock_(fn) {
  var lock = LockService.getScriptLock();
  var acquired = lock.tryLock(15000);
  if (!acquired) {
    throw createAppError_(
      'LOCK_TIMEOUT',
      '他の処理が実行中のためロックを取得できませんでした。数秒待ってから再試行してください。',
      true
    );
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/**
 * SHA-256ハッシュの16進文字列を計算（重複送信検知・レート制限キー用）
 */
function computeSha256Hex_(input) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(input), Utilities.Charset.UTF_8);
  var hex = [];
  for (var i = 0; i < digest.length; i++) {
    var b = digest[i];
    if (b < 0) b += 256;
    var s = b.toString(16);
    if (s.length === 1) s = '0' + s;
    hex.push(s);
  }
  return hex.join('');
}
