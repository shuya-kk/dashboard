/**
 * Config.gs
 * システム全体の設定値・定数・Script Propertiesの取得を管理します。
 * 秘密情報はScript Propertiesに保存し、フロントエンドへは直接返却しません。
 */

var CONFIG = {
  SHEETS: {
    APPLICATIONS: 'Applications',
    REPOSITORIES: 'Repositories',
    NOTICES: 'Notices',
    INQUIRIES: 'Inquiries',
    OPERATION_LOGS: 'OperationLogs'
  },
  HEADERS: {
    Applications: [
      'id',
      'name',
      'bundleId',
      'appStoreUrl',
      'isActive',
      'createdAt',
      'updatedAt'
    ],
    Repositories: [
      'id',
      'displayName',
      'owner',
      'repo',
      'branch',
      'articlesDir',
      'imagesDir',
      'markdownExt',
      'frontmatterFormat',
      'defaultTemplate',
      'siteUrl',
      'articleUrlPattern',
      'tokenPropertyKey',
      'isActive',
      'createdAt',
      'updatedAt'
    ],
    Notices: [
      'id',
      'appId',
      'title',
      'body',
      'createdAt',
      'publishedAt',
      'status',
      'updatedAt'
    ],
    Inquiries: [
      'id',
      'appId',
      'name',
      'email',
      'subject',
      'message',
      'createdAt',
      'status',
      'adminMemo',
      'updatedAt'
    ],
    OperationLogs: [
      'id',
      'timestamp',
      'actorEmail',
      'action',
      'targetType',
      'targetId',
      'summary',
      'status'
    ]
  },
  NOTICE_STATUSES: ['draft', 'scheduled', 'published', 'archived'],
  INQUIRY_STATUSES: ['未対応', '対応中', '完了'],
  RATE_LIMIT: {
    INQUIRY_WINDOW_SECONDS: 600, // 10分
    INQUIRY_MAX_PER_WINDOW: 3,   // 同一キーあたり10分に3回まで
    DUPLICATE_TTL_SECONDS: 1800  // 同一内容の重複送信防止（30分）
  },
  LIMITS: {
    INQUIRY_NAME_MAX: 80,
    INQUIRY_EMAIL_MAX: 254,
    INQUIRY_SUBJECT_MAX: 150,
    INQUIRY_MESSAGE_MAX: 5000,
    NOTICE_TITLE_MAX: 200,
    NOTICE_BODY_MAX: 20000,
    ADMIN_MEMO_MAX: 5000
  }
};

/**
 * Script Propertiesを取得するヘルパー
 */
function getScriptProperty_(key, required) {
  var props = PropertiesService.getScriptProperties();
  var val = props.getProperty(key);
  if (required && (!val || String(val).trim() === '')) {
    throw createAppError_(
      'CONFIG_MISSING',
      'Script Property "' + key + '" が設定されていません。セットアップ手順書に従って設定してください。',
      false
    );
  }
  return val ? String(val).trim() : '';
}

/**
 * 許可された管理者メールアドレスを取得
 */
function getAdminEmail_() {
  return getScriptProperty_('ADMIN_EMAIL', true).toLowerCase();
}

/**
 * スプレッドシートIDを取得
 */
function getSpreadsheetId_() {
  return getScriptProperty_('SPREADSHEET_ID', true);
}

/**
 * OAuth クライアントID（IDトークン検証のAudience確認用・任意だが推奨）
 */
function getOAuthClientId_() {
  return getScriptProperty_('OAUTH_CLIENT_ID', false);
}

/**
 * GitHubトークン参照キーから実際のFine-grained PATを取得
 * セキュリティのため、"GITHUB_TOKEN_" で始まるキーのみ許可する。
 */
function getGitHubTokenByKey_(propertyKey) {
  var key = String(propertyKey || '').trim();
  if (!/^GITHUB_TOKEN_[A-Z0-9_]+$/.test(key)) {
    throw createAppError_(
      'INVALID_TOKEN_KEY',
      'GitHubトークン参照キーは "GITHUB_TOKEN_" で始まる英数字・アンダースコア形式で指定してください。',
      false
    );
  }
  var token = getScriptProperty_(key, false);
  if (!token) {
    throw createAppError_(
      'GITHUB_TOKEN_NOT_Configured',
      'Script Properties に "' + key + '" が登録されていません。GASのプロジェクト設定で登録してください。',
      false
    );
  }
  return token;
}

/**
 * Script Propertiesに登録されている利用可能なGITHUB_TOKEN_* のキー一覧のみを返す（値は絶対に返さない）
 */
function listAvailableGitHubTokenKeys_() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var keys = [];
  for (var k in props) {
    if (Object.prototype.hasOwnProperty.call(props, k) && /^GITHUB_TOKEN_[A-Z0-9_]+$/.test(k)) {
      if (props[k] && String(props[k]).trim().length > 0) {
        keys.push(k);
      }
    }
  }
  keys.sort();
  return keys;
}
