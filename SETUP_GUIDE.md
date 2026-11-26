# 初期セットアップ手順書（完全ガイド）

この手順書では、プログラミングやGoogle Cloudの設定に不慣れな方でも迷わず順番に構築できるよう、**Google Cloud → Googleスプレッドシート → Google Apps Script (GAS) → GitHub → 初回ログイン** の順にすべてのURL・入力値・選択項目を記載しています。

---

## 全体の流れ（所要時間：約25〜30分）

1. **Googleスプレッドシート** を1つ新規作成し、スプレッドシートIDを控える
2. **GitHub** で記事管理対象リポジトリ用の Fine-grained Personal Access Token (PAT) を作成する
3. **Google Cloud Console** でプロジェクトを作成し、Apps Script API と OAuth クライアントを設定する
4. **Google Apps Script (GAS)** にバックエンドコードを配置し、Script Properties・API Executable・公開Webアプリ・トリガーを設定する
5. **GitHub Pages** に管理画面をデプロイし、初回ログインと動作確認を行う

---

## Step 1：Googleスプレッドシートの準備（データベース作成）

1. 自分のGoogleアカウントで [Google スプレッドシート (https://sheets.new)](https://sheets.new) を開き、新しいスプレッドシートを作成します。
2. スプレッドシートのタイトルを **`PersonalDevAdminDB`**（任意の名前で可）に変更します。
3. ブラウザのアドレスバーのURLを確認します。
   - 例：`https://docs.google.com/spreadsheets/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abcdef/edit`
   - `/d/` と `/edit` の間にある文字列（例：`1aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abcdef`）が **`SPREADSHEET_ID`（スプレッドシートID）** です。メモ帳に控えておきます。
   - ※シート（`Applications`, `Repositories`, `Notices`, `Inquiries`, `OperationLogs`）は、後の手順でGASの初期化関数を実行すると自動作成されるため、手動で作成する必要はありません。

---

## Step 2：GitHub Fine-grained Personal Access Token (PAT) の作成

管理画面からGitHubリポジトリの記事（Markdown）を読み書きするための専用トークンを発行します。このトークンは後でGASの `Script Properties` にのみ保存し、ブラウザ側には一切配置しません。

1. GitHubにログインし、[Fine-grained personal access tokens 設定画面 (https://github.com/settings/personal-access-tokens/new)](https://github.com/settings/personal-access-tokens/new) を開きます。
2. 各項目を以下のように入力・選択します。
   - **Token name**：`personal-dev-admin-gas-portfolio`（分かりやすい名前）
   - **Expiration**（有効期限）：`90 days` またはカスタム期限（期限切れ時は再発行してGASのScript Propertiesを更新します）
   - **Description**：`GAS backend token for managing GitHub Pages articles`
   - **Resource owner**：自分のGitHubアカウント
   - **Repository access**（重要）：
     - **`Only select repositories`**（選択したリポジトリのみ）を選びます。
     - 記事を管理したいGitHub Pagesリポジトリ（例：自分のポートフォリオやブログのリポジトリ）を選択します。
   - **Permissions**（権限）：
     - **Repository permissions** を展開します。
     - **`Contents`** を探し、アクセス権を **`Read and write`** に変更します。
     - （`Metadata` は自動的に `Read-only` になります。それ以外の権限は一切付与しないでください）
3. 画面下部の **「Generate token」** をクリックします。
4. `github_pat_...` から始まるトークンが表示されます。一度画面を閉じると再表示できないため、安全なメモに一時的に控えておきます（Step 4でGASに登録したらメモから消去してください）。
   - ※リポジトリごとにトークンを分けたい場合は、同様に別リポジトリ用のトークンも作成できます。

---

## Step 3：Google Cloud プロジェクトと OAuth 2.0 クライアントの設定

GASの `scripts.run`（Apps Script API）を自分のGoogleアカウントだけで安全に実行できるよう、標準のGoogle Cloudプロジェクトを作成してOAuth設定を行います。

### 3-1. Google Cloud プロジェクトの作成とプロジェクト番号の確認

1. [Google Cloud Console (https://console.cloud.google.com/)](https://console.cloud.google.com/) にアクセスします。
2. 画面左上のプロジェクト選択ドロップダウンをクリックし、**「新しいプロジェクト」** をクリックします。
   - **プロジェクト名**：`personal-dev-admin`
   - **組織 / 場所**：`組織なし`（個人の無料Googleアカウントのままで問題ありません。Google Workspaceの契約は不要です）
   - **「作成」** をクリックします。
3. 作成したプロジェクト `personal-dev-admin` が選択されていることを確認し、[ダッシュボード (https://console.cloud.google.com/home/dashboard)](https://console.cloud.google.com/home/dashboard) を開きます。
4. 「プロジェクト情報」カードにある **「プロジェクト番号」**（例：`123456789012` のような数字のみの番号）をメモ帳に控えておきます（Step 4でGASとの紐付けに使用します）。

### 3-2. Google Apps Script API の有効化

1. [Apps Script API ライブラリ画面 (https://console.cloud.google.com/apis/library/script.googleapis.com)](https://console.cloud.google.com/apis/library/script.googleapis.com) を開きます。
2. **「有効にする」** ボタンをクリックします。

### 3-3. OAuth 同意画面の設定

1. [Google Auth Platform / OAuth 同意画面 (https://console.cloud.google.com/apis/credentials/consent)](https://console.cloud.google.com/apis/credentials/consent) を開きます。
2. 初回設定ウィザードが表示されたら、以下の通り入力します。
   - **User Type（対象）**：**「外部（External）」** を選択（※Google Workspace未契約の個人Googleアカウントでは「外部」を選択します。後述の「テストユーザー」に自分のメールアドレス1つだけを登録することで、自分以外はログインできなくなります）。
   - **アプリ情報**：
     - **アプリ名**：`Personal Dev Admin Dashboard`
     - **ユーザー サポート メール**：自分のGmailアドレスを選択
     - **デベロッパーの連絡先情報**：自分のGmailアドレスを入力
   - **「保存して次へ」** をクリックします。
3. **スコープ（Scopes）** 画面：
   - **「スコープを追加または削除」** をクリックし、以下の4つのスコープを追加（下部の「手動でスコープを追加」欄に貼り付けて追加）して **「更新」** → **「保存して次へ」** をクリックします。
     ```text
     https://www.googleapis.com/auth/spreadsheets
     https://www.googleapis.com/auth/script.external_request
     https://www.googleapis.com/auth/script.scriptapp
     https://www.googleapis.com/auth/userinfo.email
     ```
4. **テストユーザー（Test users）** 画面（重要）：
   - **「＋ ADD USERS（ユーザーを追加）」** をクリックします。
   - **自分のGoogleアカウントのメールアドレス1つだけ** を入力して追加し、**「保存して次へ」** をクリックします。
   - ※公開ステータスは「テスト中」のままにしておきます。これにより無料のまま審査不要で利用でき、かつテストユーザーに登録した自分以外のGoogleアカウントからのOAuth認可はGoogle側でもブロックされます。

### 3-4. OAuth 2.0 クライアントIDの作成

1. [認証情報（Credentials）画面 (https://console.cloud.google.com/apis/credentials)](https://console.cloud.google.com/apis/credentials) を開きます。
2. 上部の **「＋ 認証情報を作成」** → **「OAuth クライアント ID」** をクリックします。
3. 以下のように入力します。
   - **アプリケーションの種類**：**`ウェブ アプリケーション`**
   - **名前**：`GitHub Pages Admin Web Client`
   - **承認済みの JavaScript 生成元（Authorized JavaScript origins）**：
     - **「＋ URI を追加」** をクリックし、GitHub Pagesの公開オリジン（末尾のスラッシュやサブパスを含めない `https://ドメイン名` のみ）を登録します。
     - 例1（GitHub Pages）：`https://your-github-username.github.io`
     - 例2（ローカルでの動作確認用・任意）：`http://localhost:4321`
   - **承認済みのリダイレクト URI**：空欄のままで構いません（Google Identity Servicesのポップアップ・トークンモデルを使用するため不要です）。
4. **「作成」** をクリックします。
5. 表示された **「クライアント ID」**（`1234567890-xxxxxxxx.apps.googleusercontent.com` の形式）をコピーして控えます。
   - ※「クライアント シークレット」はフロントエンドでもGASでも一切使用しません（ブラウザ側にシークレットを置かないセキュアな構成です）。

---

## Step 4：Google Apps Script (GAS) バックエンドの構築

### 4-1. GASプロジェクトの作成とコード配置

1. [Google Apps Script (https://script.google.com/)](https://script.google.com/) を開き、左上の **「＋ 新しいプロジェクト」** をクリックします。
2. プロジェクト名を **`PersonalDevAdminBackend`** に変更します。
3. 左側のサイドバーの **「プロジェクトの設定（歯車アイコン）」** をクリックし、**「「appsscript.json」マニフェスト ファイルをエディタで表示する」** にチェックを入れます。
4. 左側の **「エディタ（`<>` アイコン）」** に戻ります。
5. 本リポジトリの `gas/` ディレクトリ内にある以下のファイルを配置します。
   - `appsscript.json` の内容を、GASエディタ上の `appsscript.json` にそのまま貼り付けて上書き保存します。
   - デフォルトである `コード.gs`（または `Code.gs`）の名前を `Config.gs` に変更し、`gas/Config.gs` の中身を貼り付けます。
   - ファイル一覧右上の **「＋」→「スクリプト」** から、残りの11ファイルを作成してそれぞれのコードを貼り付けます：
     1. `Config.gs`
     2. `Utils.gs`
     3. `Auth.gs`
     4. `SpreadsheetService.gs`
     5. `GitHub.gs`
     6. `RepositoryService.gs`
     7. `ArticleService.gs`
     8. `AppService.gs`
     9. `NoticeService.gs`
     10. `InquiryService.gs`
     11. `Api.gs`
     12. `PublicApi.gs`
6. `Ctrl + S`（Macは `Cmd + S`）で全ファイルを保存します。

### 4-2. 標準 Google Cloud プロジェクトへの紐付け

**Apps Script API (`scripts.run`) を実行するには、GASとStep 3で作成したOAuthクライアントが同じGoogle Cloudプロジェクトに紐付いている必要があります。**

1. GAS画面左側の **「プロジェクトの設定（歯車アイコン）」** を開きます。
2. 「Google Cloud Platform (GCP) プロジェクト」セクションの **「プロジェクトを変更」** をクリックします。
3. Step 3-1 で控えた **「GCP プロジェクト番号」**（数字のみの番号）を入力し、**「プロジェクトを設定」** をクリックします。

### 4-3. Script Properties（スクリプト プロパティ）の設定

同じくGASの **「プロジェクトの設定（歯車アイコン）」** 画面の一番下にある **「スクリプト プロパティ」** セクションで、**「スクリプト プロパティを追加」** をクリックし、以下のプロパティを登録して **「スクリプト プロパティを保存」** をクリックします。

| プロパティ（キー名） | 値（設定内容） | 必須 |
| :--- | :--- | :--- |
| `ADMIN_EMAIL` | 自分のGoogleアカウントのメールアドレス（例：`yourname@gmail.com`） | 必須 |
| `SPREADSHEET_ID` | Step 1 で控えたGoogleスプレッドシートID | 必須 |
| `OAUTH_CLIENT_ID` | Step 3-4 で控えた OAuth 2.0 クライアントID（`...apps.googleusercontent.com`） | 推奨 |
| `GITHUB_TOKEN_PORTFOLIO` | Step 2 で発行した GitHub Fine-grained PAT（`github_pat_...`） | 必須 |
| `ASC_ISSUER_ID` | App Store Connect API の Issuer ID（UUID形式） | App Store連携時 |
| `ASC_KEY_ID` | App Store Connect API キーの Key ID（例：`2X9R4HXF34`） | App Store連携時 |
| `ASC_PRIVATE_KEY` | ダウンロードした `AuthKey_XXXX.p8` ファイルの全文（`-----BEGIN PRIVATE KEY-----` から末尾まで） | App Store連携時 |

※2つ目・3つ目のGitHubリポジトリ用に別トークンを使う場合は、`GITHUB_TOKEN_BLOG` や `GITHUB_TOKEN_APP_DOCS` のように **`GITHUB_TOKEN_` で始まる大文字英数字・アンダースコアの名前** で追加登録できます。
※**App Store Connect API の秘密鍵（`ASC_PRIVATE_KEY` 等）は GAS の Script Properties にのみ保存され、ブラウザ側（GitHub Pages）には1文字も送信されません。** GAS 内部で ES256 (ECDSA P-256) JWT を生成して Apple 公式サーバー（`api.appstoreconnect.apple.com`）と直接通信します。

### 4-4. スプレッドシートの初期化と時間主導型トリガーの自動設定

1. GASの **「エディタ（`<>` アイコン）」** に戻り、`Api.gs` を開きます。
2. 画面上部の関数選択ドロップダウン（初期状態では `adminApiDispatch` 等になっています）をクリックし、**`initializeSystemManually`** を選択します。
3. **「実行」** ボタンをクリックします。
4. 初回実行時は「承認が必要です」というダイアログが表示されます。
   - **「権限を確認」** → 自分のGoogleアカウントを選択 → 「このアプリはGoogleで確認されていません」と出た場合は左下の **「詳細」** → **「PersonalDevAdminBackend（安全ではないページ）に移動」** → **「許可」** をクリックします。
5. 実行ログに `Database initialized` および `Trigger initialized` と表示されれば成功です。
   - これにより、Googleスプレッドシート上に `Applications`, `Repositories`, `Notices`, `Inquiries`, `OperationLogs` の5つのシートとヘッダー行が自動作成され、同時にお知らせの公開予約を自動反映する5分間隔の時間主導型トリガー（`publishScheduledNoticesTrigger`）も自動設定されます。

### 4-5. 管理API（API 実行可能ファイル / API Executable）のデプロイ

1. GAS画面右上の **「デプロイ」** → **「新しいデプロイ」** をクリックします。
2. 左上の歯車アイコン（「種類の選択」）をクリックし、**「API 実行可能ファイル」** を選択します。
3. 以下のように設定します。
   - **説明**：`Admin API Executable v1`
   - **アクセスできるユーザー**：**「自分のみ」** を選択
4. **「デプロイ」** をクリックします。
5. 表示された **「デプロイ ID」**（`AKfycb...` で始まる文字列、または「プロジェクトの設定」にある **「スクリプト ID」**）をコピーして控えます。これが管理画面の `PUBLIC_GAS_DEPLOYMENT_ID` になります。

### 4-6. 公開API（アプリ向けお知らせ取得・お問い合わせ受付用 Webアプリ）のデプロイ

アプリやWebサイトから「公開済みお知らせの取得 (`doGet`)」と「お問い合わせの送信 (`doPost`)」を受け付けるための公開APIをデプロイします。

1. 再度、GAS画面右上の **「デプロイ」** → **「新しいデプロイ」** をクリックします。
2. 左上の歯車アイコン（「種類の選択」）から **「ウェブアプリ」** を選択します（もし既にチェックが入っている場合は、「API 実行可能ファイル」のチェックを外して「ウェブアプリ」のみを選択するか、既存デプロイに追加します）。
3. 以下のように設定します。
   - **説明**：`Public Notice & Inquiry WebApp v1`
   - **次のユーザーとして実行**：**`自分（メールアドレス）`**
   - **アクセスできるユーザー**：**`全員`**（アプリ利用者がログイン不要でお知らせ取得・問い合わせ送信できるようにするため。なお、`PublicApi.gs` のコードにより、公開済みお知らせ取得とお問い合わせ新規登録以外の管理操作は一切実行できないよう厳格に遮断されています）
4. **「デプロイ」** をクリックします。
5. 表示された **「ウェブアプリの URL」**（`https://script.google.com/macros/s/AKfycb.../exec`）を控えます。これが `PUBLIC_GAS_WEBAPP_URL` になります。

---

## Step 5：GitHub Pages の有効化と管理画面のデプロイ

1. この管理画面のコード一式を自分のGitHubリポジトリ（例：`dashboard`）に push します。
2. GitHubリポジトリの **「Settings」** → 左メニューの **「Pages」** を開きます。
3. **Build and deployment** の **Source** を **`GitHub Actions`** に変更します。
4. （推奨）左メニューの **「Secrets and variables」** → **「Actions」** → **「Variables」タブ**（Secretsではなく公開Variablesで構いません）を開き、**「New repository variable」** から以下の変数を登録します：
   - `PUBLIC_GOOGLE_CLIENT_ID`：Step 3-4 で控えた OAuth クライアントID
   - `PUBLIC_GAS_DEPLOYMENT_ID`：Step 4-5 で控えた GAS API Executable デプロイID（またはスクリプトID）
   - `PUBLIC_GAS_WEBAPP_URL`：Step 4-6 で控えた 公開WebアプリのURL
   - `PUBLIC_SITE_URL`：`https://<あなたのGitHubユーザー名>.github.io`
   - `PUBLIC_BASE_PATH`：リポジトリ名が `dashboard` の場合は `/dashboard`（`username.github.io` ルートリポジトリの場合は `/`）
   - ※もし Variables を設定せずにデプロイした場合でも、初回アクセス時に管理画面の「初期接続設定フォーム」からブラウザ上で安全に入力・保存できます。
5. GitHubリポジトリの **「Actions」** タブを開き、`Deploy Admin Dashboard to GitHub Pages` ワークフローを実行（または `main` ブランチへ push）すると、自動的にテストと静的ビルドが走り、GitHub Pagesへ公開されます。

---

## Step 6：初回ログインと動作確認

1. 公開された GitHub Pages のURL（例：`https://<あなたのユーザー名>.github.io/dashboard/`）にアクセスします。
2. 未ログイン状態では管理画面は一切表示されず、Googleログイン画面が表示されます。
3. **「Step 1: Googleでログイン」** ボタンをクリックし、`ADMIN_EMAIL` に設定した自分のGoogleアカウントを選択します。
4. 続けて **「Step 2: GAS管理APIへのアクセスを認可してログイン」** ボタンをクリックし、権限を許可します。
5. 認証に成功すると、管理画面の **Dashboard** が表示されます。
6. **GitHubリポジトリの登録**：
   - 左メニューの **「Settings」** を開き、**「リポジトリを追加」** をクリックします。
   - 例：
     - 表示名：`個人ポートフォリオブログ`
     - GitHubトークン参照キー：`GITHUB_TOKEN_PORTFOLIO`
     - GitHubオーナー：`<あなたのGitHubユーザー名>`
     - リポジトリ名：`<記事があるリポジトリ名>`
     - ブランチ：`main`
     - 記事保存ディレクトリ：`src/content/blog`（リポジトリの構成に合わせて指定）
     - Markdown拡張子：`.md`
     - Frontmatter形式：`YAML (---)`
   - **「リポジトリ設定を保存」** をクリックします。
7. **記事の確認・作成**：
   - 左メニューの **「Articles」** を開くと、登録したリポジトリ内のMarkdown記事一覧がGitHub API経由で取得・表示されます。
   - 記事の編集・リアルタイムプレビュー・GitHubへの保存がそのまま行えます。
8. **アプリの登録とお知らせ・お問い合わせの確認**：
   - 左メニューの **「Applications」** から自分のアプリ（例：`My App` / `com.example.myapp`）を登録します。
   - **「Notices」** からアプリ別のお知らせ作成・公開予約が行えます。
   - **「Inquiries」** からアプリ別に届いたお問い合わせの確認・対応状況変更・管理者メモの記録・メール返信が行えます。
