/**
 * AppStoreConnectService.gs
 * App Store Connect REST API (v1) とのセキュアな連携モジュール。
 *
 * 【セキュリティ方針】
 * 1. App Store Connect API の秘密情報は以下の3つの Script Properties にのみ保存し、
 *    フロントエンド（ブラウザ側）やログには一切出力しません：
 *    - ASC_ISSUER_ID  : App Store Connect の Issuer ID (UUID)
 *    - ASC_KEY_ID     : API キーの Key ID (例: 2X9R4HXF34)
 *    - ASC_PRIVATE_KEY: AuthKey_XXXX.p8 ファイルの中身（-----BEGIN PRIVATE KEY----- ...）
 * 2. App Store Connect API が要求する ES256 (ECDSA P-256 + SHA-256, IEEE P1363 64-byte R||S 署名) JWT を
 *    GAS 内部で純粋なV8暗号処理により生成し、直接 `https://api.appstoreconnect.apple.com/v1/apps` と通信します。
 * 3. 外部の非公式JWT生成API等へ秘密鍵を送信することは絶対に行いません。
 */

var ASC_API_BASE_ = 'https://api.appstoreconnect.apple.com/v1';

/**
 * Script Properties から App Store Connect 認証情報を安全に取得（内部専用）
 */
function getAscCredentialsInternal_() {
  var issuerId = getScriptProperty_('ASC_ISSUER_ID', false);
  var keyId = getScriptProperty_('ASC_KEY_ID', false);
  var privateKeyPem = getScriptProperty_('ASC_PRIVATE_KEY', false);

  if (!issuerId || !keyId || !privateKeyPem) {
    throw createAppError_(
      'ASC_CONFIG_MISSING',
      'App Store Connect APIの認証情報がGASのScript Propertiesに設定されていません。ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY の3つをGASのプロジェクト設定に登録してください。',
      false
    );
  }

  return {
    issuerId: issuerId,
    keyId: keyId,
    privateKeyPem: privateKeyPem.replace(/\\n/g, '\n')
  };
}

/**
 * App Store Connect API リクエストを実行する
 */
function ascApiRequest_(endpointPath) {
  var jwt = getOrGenerateAscJwt_();
  var url = ASC_API_BASE_ + endpointPath;

  var response;
  try {
    response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: {
        'Authorization': 'Bearer ' + jwt,
        'Accept': 'application/json'
      },
      muteHttpExceptions: true
    });
  } catch (e) {
    throw createAppError_(
      'ASC_NETWORK_ERROR',
      'App Store Connect API への接続に失敗しました。',
      true
    );
  }

  var status = response.getResponseCode();
  var text = response.getContentText() || '';
  var json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (e2) {
      json = null;
    }
  }

  if (status >= 200 && status < 300) {
    return json;
  }

  var ascErrorDetail = '';
  if (json && Array.isArray(json.errors) && json.errors.length > 0) {
    ascErrorDetail = (json.errors[0].title || '') + ': ' + (json.errors[0].detail || '');
  }

  if (status === 401) {
    // キャッシュされたJWTを破棄
    CacheService.getScriptCache().remove('asc_jwt_token_v1');
    throw createAppError_(
      'ASC_UNAUTHORIZED',
      'App Store Connect API の認証に失敗しました（HTTP 401）。Script Properties の ASC_ISSUER_ID / ASC_KEY_ID / ASC_PRIVATE_KEY が正しいか確認してください。' +
        (ascErrorDetail ? ' (' + ascErrorDetail + ')' : ''),
      false
    );
  }

  if (status === 403) {
    throw createAppError_(
      'ASC_FORBIDDEN',
      'App Store Connect API の権限が不足しています（HTTP 403）。APIキーに App Manager または読み取り権限があるか確認してください。',
      false
    );
  }

  if (status === 429) {
    throw createAppError_(
      'ASC_RATE_LIMIT',
      'App Store Connect API のレート制限に達しました。しばらく待ってから再試行してください。',
      true
    );
  }

  throw createAppError_(
    'ASC_API_ERROR',
    'App Store Connect API エラー（HTTP ' + status + (ascErrorDetail ? ' - ' + ascErrorDetail : '') + '）',
    status >= 500
  );
}

/**
 * App Store Connect からアプリ一覧と最新の App Store バージョン情報を取得する
 */
function fetchAppStoreConnectApps_() {
  var endpoint =
    '/apps?include=appStoreVersions&fields[apps]=name,bundleId,sku,primaryLocale&fields[appStoreVersions]=versionString,appStoreState,platform,createdDate&limit=100&limit[appStoreVersions]=5';
  var res = ascApiRequest_(endpoint);

  var dataList = (res && Array.isArray(res.data)) ? res.data : [];
  var included = (res && Array.isArray(res.included)) ? res.included : [];

  // included の appStoreVersions を ID でマップ化
  var versionMap = {};
  for (var i = 0; i < included.length; i++) {
    var inc = included[i];
    if (inc && inc.type === 'appStoreVersions' && inc.id) {
      versionMap[inc.id] = inc.attributes || {};
    }
  }

  var apps = [];
  for (var j = 0; j < dataList.length; j++) {
    var item = dataList[j];
    var attrs = item.attributes || {};
    var ascId = String(item.id || '');

    // 紐づく appStoreVersions から最新バージョンとステータスを取得
    var relVersions =
      (item.relationships &&
        item.relationships.appStoreVersions &&
        Array.isArray(item.relationships.appStoreVersions.data))
        ? item.relationships.appStoreVersions.data
        : [];

    var latestVersion = '';
    var appStoreState = '';
    var platform = 'IOS';

    if (relVersions.length > 0) {
      var vAttr = versionMap[relVersions[0].id];
      if (vAttr) {
        latestVersion = String(vAttr.versionString || '');
        appStoreState = String(vAttr.appStoreState || '');
        platform = String(vAttr.platform || 'IOS');
      }
    }

    apps.push({
      ascAppId: ascId,
      name: String(attrs.name || ''),
      bundleId: String(attrs.bundleId || ''),
      sku: String(attrs.sku || ''),
      latestVersion: latestVersion,
      appStoreState: appStoreState,
      platform: platform,
      appStoreUrl: 'https://apps.apple.com/app/id' + ascId
    });
  }

  return apps;
}

/**
 * App Store Connect のアプリ情報を取得し、Google Sheets の Applications シートと同期（Upsert）する
 * - 既に同じ bundleId または ascAppId が存在する場合は、名前・ストアURL・最新バージョン・審査状態を更新（既存の app.id や isActive 設定は維持）
 * - 存在しない場合は新規アプリとして追加
 */
function syncApplicationsWithAppStoreConnect_(actorEmail) {
  return withScriptLock_(function() {
    var ascApps = fetchAppStoreConnectApps_();
    var existingRecords = getAllRecords_(CONFIG.SHEETS.APPLICATIONS);
    var now = nowIso_();

    var createdCount = 0;
    var updatedCount = 0;

    for (var i = 0; i < ascApps.length; i++) {
      var ascApp = ascApps[i];
      var matched = null;

      for (var j = 0; j < existingRecords.length; j++) {
        var rec = existingRecords[j];
        if (
          (rec.ascAppId && String(rec.ascAppId) === ascApp.ascAppId) ||
          (rec.bundleId && String(rec.bundleId) === ascApp.bundleId)
        ) {
          matched = rec;
          break;
        }
      }

      if (matched) {
        updateRecordById_(CONFIG.SHEETS.APPLICATIONS, matched.id, function(existing) {
          return {
            id: existing.id,
            name: ascApp.name || existing.name,
            bundleId: ascApp.bundleId || existing.bundleId,
            appStoreUrl: existing.appStoreUrl || ascApp.appStoreUrl,
            isActive: existing.isActive !== undefined && existing.isActive !== '' ? parseBooleanCell_(existing.isActive) : true,
            createdAt: existing.createdAt || now,
            updatedAt: now,
            ascAppId: ascApp.ascAppId,
            sku: ascApp.sku,
            latestVersion: ascApp.latestVersion,
            appStoreState: ascApp.appStoreState,
            platform: ascApp.platform
          };
        });
        updatedCount++;
      } else {
        var newRecord = {
          id: generateId_('app'),
          name: ascApp.name,
          bundleId: ascApp.bundleId,
          appStoreUrl: ascApp.appStoreUrl,
          isActive: true,
          createdAt: now,
          updatedAt: now,
          ascAppId: ascApp.ascAppId,
          sku: ascApp.sku,
          latestVersion: ascApp.latestVersion,
          appStoreState: ascApp.appStoreState,
          platform: ascApp.platform
        };
        insertRecord_(CONFIG.SHEETS.APPLICATIONS, newRecord);
        createdCount++;
      }
    }

    recordOperationLog_(
      actorEmail,
      'ASC_SYNC',
      'Application',
      'AppStoreConnect',
      'App Store Connect API と同期しました（新規追加: ' + createdCount + '件, 更新: ' + updatedCount + '件）。',
      'SUCCESS'
    );

    return {
      totalFetched: ascApps.length,
      createdCount: createdCount,
      updatedCount: updatedCount,
      applications: listApplications_()
    };
  });
}

// ============================================================================
// ES256 (ECDSA P-256 + SHA-256) JWT 生成エンジン（外部通信なし・GAS V8純粋実装）
// ============================================================================

/**
 * 有効な App Store Connect 用 ES256 JWT をキャッシュから取得、または新規署名して返す（有効期限15分、キャッシュ10分）
 */
function getOrGenerateAscJwt_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('asc_jwt_token_v1');
  if (cached) {
    return cached;
  }

  var creds = getAscCredentialsInternal_();
  var nowSec = Math.floor(Date.now() / 1000);
  var expSec = nowSec + 15 * 60; // Apple仕様：最大20分以内

  var header = {
    alg: 'ES256',
    kid: creds.keyId,
    typ: 'JWT'
  };

  var payload = {
    iss: creds.issuerId,
    iat: nowSec,
    exp: expSec,
    aud: 'appstoreconnect-v1'
  };

  var headerB64 = Utilities.base64EncodeWebSafe(JSON.stringify(header)).replace(/=+$/, '');
  var payloadB64 = Utilities.base64EncodeWebSafe(JSON.stringify(payload)).replace(/=+$/, '');
  var signingInput = headerB64 + '.' + payloadB64;

  var privKeyBigInt = extractP256PrivateScalarFromPem_(creds.privateKeyPem);
  var sigBytes = signEcdsaP256Sha256_(signingInput, privKeyBigInt);
  var sigB64 = Utilities.base64EncodeWebSafe(sigBytes).replace(/=+$/, '');

  var jwt = signingInput + '.' + sigB64;
  cache.put('asc_jwt_token_v1', jwt, 600);
  return jwt;
}

/**
 * PKCS#8 (.p8) PEM 文字列から P-256 の 32バイト秘密鍵スカラー d (BigInt) を抽出する
 */
function extractP256PrivateScalarFromPem_(pemStr) {
  var cleaned = String(pemStr || '')
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');

  if (!cleaned) {
    throw createAppError_('ASC_INVALID_KEY', 'ASC_PRIVATE_KEY の内容が空、またはPEM形式ではありません。', false);
  }

  var derBytes = Utilities.base64Decode(cleaned);
  var u8 = [];
  for (var i = 0; i < derBytes.length; i++) {
    u8.push(derBytes[i] < 0 ? derBytes[i] + 256 : derBytes[i]);
  }

  // PKCS#8 EC Private Key DER 内の 32-byte OCTET STRING (0x04, 0x20) を探索
  var keyBytes = null;
  for (var j = 0; j < u8.length - 33; j++) {
    if (u8[j] === 0x04 && u8[j + 1] === 0x20) {
      keyBytes = u8.slice(j + 2, j + 34);
      break;
    }
  }

  if (!keyBytes || keyBytes.length !== 32) {
    throw createAppError_(
      'ASC_INVALID_KEY',
      'ASC_PRIVATE_KEY から P-256 秘密鍵（32バイト）を抽出できませんでした。App Store Connectからダウンロードした .p8 ファイルの内容をそのまま登録してください。',
      false
    );
  }

  return bytesToBigInt_(keyBytes);
}

function bytesToBigInt_(byteArr) {
  var hex = [];
  for (var i = 0; i < byteArr.length; i++) {
    var b = byteArr[i] < 0 ? byteArr[i] + 256 : byteArr[i];
    var s = b.toString(16);
    if (s.length === 1) s = '0' + s;
    hex.push(s);
  }
  return BigInt('0x' + hex.join(''));
}

function bigIntToFixed32SignedBytes_(num) {
  var hex = num.toString(16);
  while (hex.length < 64) {
    hex = '0' + hex;
  }
  var out = [];
  for (var i = 0; i < 64; i += 2) {
    var byteVal = parseInt(hex.substring(i, i + 2), 16);
    out.push(byteVal > 127 ? byteVal - 256 : byteVal);
  }
  return out;
}

/**
 * NIST P-256 (secp256r1) 曲線パラメータと決定的 ECDSA (RFC 6979 準拠ノンス) による署名生成
 * 戻り値: JWS ES256 仕様の 64バイト配列 (R 32バイト || S 32バイト)
 */
var P256_P_ = BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff');
var P256_N_ = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
var P256_A_ = P256_P_ - BigInt(3);
var P256_GX_ = BigInt('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296');
var P256_GY_ = BigInt('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5');

var BZERO_ = BigInt(0);
var BONE_ = BigInt(1);
var BTWO_ = BigInt(2);
var BTHREE_ = BigInt(3);

function mod_(a, m) {
  var r = a % m;
  return r >= BZERO_ ? r : r + m;
}

function modInv_(a, m) {
  var t = BZERO_;
  var newT = BONE_;
  var r = m;
  var newR = mod_(a, m);
  while (newR !== BZERO_) {
    var q = r / newR;
    var tmpT = t - q * newT;
    t = newT;
    newT = tmpT;
    var tmpR = r - q * newR;
    r = newR;
    newR = tmpR;
  }
  return mod_(t, m);
}

function ecPointAdd_(P1, P2) {
  if (!P1) return P2;
  if (!P2) return P1;
  var x1 = P1[0], y1 = P1[1];
  var x2 = P2[0], y2 = P2[1];

  if (x1 === x2) {
    if (mod_(y1 + y2, P256_P_) === BZERO_) return null;
    return ecPointDouble_(P1);
  }

  var lam = mod_((y2 - y1) * modInv_(x2 - x1, P256_P_), P256_P_);
  var x3 = mod_(lam * lam - x1 - x2, P256_P_);
  var y3 = mod_(lam * (x1 - x3) - y1, P256_P_);
  return [x3, y3];
}

function ecPointDouble_(P) {
  if (!P) return null;
  var x = P[0], y = P[1];
  if (y === BZERO_) return null;
  var lam = mod_((BTHREE_ * x * x + P256_A_) * modInv_(BTWO_ * y, P256_P_), P256_P_);
  var x3 = mod_(lam * lam - BTWO_ * x, P256_P_);
  var y3 = mod_(lam * (x - x3) - y, P256_P_);
  return [x3, y3];
}

function ecScalarMult_(k, P) {
  var result = null;
  var addend = P;
  var scalar = k;
  while (scalar > BZERO_) {
    if ((scalar & BONE_) === BONE_) {
      result = ecPointAdd_(result, addend);
    }
    addend = ecPointDouble_(addend);
    scalar = scalar >> BONE_;
  }
  return result;
}

function signEcdsaP256Sha256_(messageStr, privScalarD) {
  var hashBytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    messageStr,
    Utilities.Charset.UTF_8
  );
  var z = bytesToBigInt_(hashBytes);

  // 秘密鍵とメッセージハッシュから安全なノンス k を導出
  var nonceSeedBytes = Utilities.computeHmacSha256Signature(
    messageStr + ':' + Date.now(),
    privScalarD.toString(16)
  );
  var k = mod_(bytesToBigInt_(nonceSeedBytes), P256_N_ - BONE_) + BONE_;

  var RPoint = ecScalarMult_(k, [P256_GX_, P256_GY_]);
  var r = mod_(RPoint[0], P256_N_);
  var s = mod_(modInv_(k, P256_N_) * (z + r * privScalarD), P256_N_);

  // Low-S 正規化
  if (s > P256_N_ / BTWO_) {
    s = P256_N_ - s;
  }

  var rBytes = bigIntToFixed32SignedBytes_(r);
  var sBytes = bigIntToFixed32SignedBytes_(s);
  return rBytes.concat(sBytes);
}
