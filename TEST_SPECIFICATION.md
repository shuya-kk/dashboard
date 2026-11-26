# テスト仕様書および検証結果

本システム（GitHub Pages管理画面 + Google Apps Scriptバックエンド + Google Sheetsデータベース）のテスト仕様と検証手順を定義します。

---

## 1. 自動テストスイート（Vitest）

フロントエンドの認証検証ロジック、Zod入力検証、Frontmatter解析・双方向同期、SHA競合時の行単位Diff計算、およびDOMPurifyによるXSSサニタイズは [`tests/system-verification.test.ts`](file:///Users/shuya/Documents/github/dashboard/tests/system-verification.test.ts) に自動テストとして実装されています。

実行コマンド：
```bash
npm test
```

---

## 2. 機能領域別テスト項目一覧

### 2.1 認証（Authentication & Authorization）

| テストID | テスト項目 | 検証手順 / 条件 | 期待される結果 | 実装箇所 |
| :--- | :--- | :--- | :--- | :--- |
| AUTH-01 | 許可されたGoogleアカウントでログインできる | `ADMIN_EMAIL` に登録したGoogleアカウントでStep 1 (IDトークン取得) とStep 2 (OAuthアクセストークン取得 + `auth.verify`) を実行する | 認証が成功し、Dashboard画面および6セクションが表示される | `src/js/auth.ts`, `src/js/app.tsx`, `gas/Auth.gs` |
| AUTH-02 | 別アカウントでは管理操作が拒否される | `ADMIN_EMAIL` 以外のGoogleアカウントでログインまたは `scripts.run` を呼び出す | GAS側の `verifyAdminAccess_()` が `FORBIDDEN` を返し、管理画面への侵入・操作が拒否される | `gas/Auth.gs` |
| AUTH-03 | 未認証状態で管理APIを実行できない | ログイン前（またはログアウト後）の状態を確認する | 管理画面のコンポーネントは描画されず、API呼び出し時は `UNAUTHORIZED` で遮断される | `src/js/app.tsx`, `src/js/api.ts`, `gas/Api.gs` |
| AUTH-04 | アクセストークン失効時に再認証できる | トークン有効期限到来時、またはHTTP 401 (`OAUTH_TOKEN_EXPIRED`) 発生時 | 画面上部に再認証バナーが表示され、「アクセストークンを再取得する」ボタンから編集中データを失わずに再認証できる | `src/js/api.ts`, `src/js/store.ts`, `src/js/app.tsx` |

### 2.2 GitHub記事管理（Articles & Multi-Repository）

| テストID | テスト項目 | 検証手順 / 条件 | 期待される結果 | 実装箇所 |
| :--- | :--- | :--- | :--- | :--- |
| ART-01 | 複数リポジトリを登録できる | Settings画面から異なる owner/repo/articlesDir/frontmatterFormat を持つリポジトリを複数登録する | Google Sheetsの `Repositories` シートに保存され、一覧に表示される | `src/js/settings.tsx`, `gas/RepositoryService.gs` |
| ART-02 | リポジトリを切り替えられる | Articles画面上部のリポジトリ選択ドロップダウンを切り替える | 選択したリポジトリのブランチ・ディレクトリ配下の記事一覧に切り替わる（未保存変更がある場合は確認ダイアログが表示される） | `src/js/articles.tsx`, `src/js/store.ts` |
| ART-03 | 記事一覧を取得できる | GitHub Git Trees API (`recursive=1`) 経由で一覧を取得し、タイトル検索・更新日時ソートを行う | 指定ディレクトリ配下の `.md` / `.mdx` / `.markdown` ファイル一覧が表示され、検索・並べ替え・ページネーションが機能する | `src/js/articles.tsx`, `gas/ArticleService.gs` |
| ART-04 | Markdownを編集できプレビューが即座に反映される | CodeMirror 6 エディタおよびFrontmatterパネルを操作する | 見出し・太字・斜体・リンク・画像・リスト・引用・コードブロック・テーブル・水平線が即座に右ペインにプレビュー描画される | `src/js/markdown-editor.tsx`, `src/js/utils.ts` |
| ART-05 | 新規記事を作成できる | 「新規記事作成」からファイル名・本文・コミットメッセージを入力し、保存確認モーダルで確定する | GitHub Contents API (`PUT`) により新規ファイルがコミットされ、一覧が更新される | `src/js/articles.tsx`, `gas/ArticleService.gs` |
| ART-06 | 既存記事を更新できる | 既存記事を開いて最新内容とSHAを取得し、編集後に保存確認モーダルで確定する | SHAを指定して GitHub Contents API (`PUT`) で更新コミットが作成される | `src/js/articles.tsx`, `gas/ArticleService.gs` |
| ART-07 | 記事を削除できる | 削除ボタンをクリックし、削除確認モーダルで確定する | SHA確認の上で GitHub Contents API (`DELETE`) により削除され、一覧から消える | `src/js/articles.tsx`, `gas/ArticleService.gs` |
| ART-08 | SHA競合を検知し差分を提示できる | 記事を開いた状態でGitHub上で直接ファイルを変更し、管理画面から保存を実行する | 無条件で上書きせず、`GITHUB_SHA_CONFLICT` としてリモート最新版を取得し、行単位のDiff比較・解決モーダルを表示する | `src/js/articles.tsx`, `gas/ArticleService.gs` |

### 2.3 お知らせ管理（Notices）

| テストID | テスト項目 | 検証手順 / 条件 | 期待される結果 | 実装箇所 |
| :--- | :--- | :--- | :--- | :--- |
| NTC-01 | 新規登録・編集・削除ができる | Notices画面から対象アプリを選び、お知らせを作成・編集・削除する | Google Sheetsの `Notices` シートに排他ロック（`LockService`）付きで保存・更新・削除される | `src/js/notices.tsx`, `gas/NoticeService.gs` |
| NTC-02 | 公開予約ができる | ステータスを `scheduled` にし、公開予定日時（JST）を指定して保存後、日時到来時（またはトリガー実行時）を確認する | `publishScheduledNoticesTrigger` により公開予定日時を過ぎたお知らせだけが `published` に自動変更される | `gas/NoticeService.gs` |
| NTC-03 | 公開APIからアプリ別に公開済みだけ取得できる | 公開WebアプリURLに `GET ?action=notices&appId=<AppIDまたはBundleID>` でアクセスする | 指定アプリの `status === 'published'` のお知らせのみが返却され、`draft` / `scheduled` / `archived` や他アプリのお知らせは一切返らない | `gas/PublicApi.gs` |

### 2.4 お問い合わせ管理（Inquiries）

| テストID | テスト項目 | 検証手順 / 条件 | 期待される結果 | 実装箇所 |
| :--- | :--- | :--- | :--- | :--- |
| INQ-01 | 公開APIから登録できる | 公開WebアプリURLに `POST` で `appId, name, email, subject, message` を送信する | サーバー側検証を通過し、`Inquiries` シートにステータス `未対応` で登録される | `gas/PublicApi.gs`, `gas/InquiryService.gs` |
| INQ-02 | 管理画面から閲覧・アプリ別/状態別絞り込みができる | Inquiries画面でアプリフィルター・ステータスフィルター・キーワード検索・日付ソートを行う | 条件に一致するお問い合わせが表示され、選択すると右ペインに本文全文が表示される | `src/js/inquiries.tsx` |
| INQ-03 | 対応状況変更と管理者メモを独立保存できる | 詳細ペインで対応状況（未対応/対応中/完了）と管理者メモを編集して保存する | 問い合わせ本文 (`message`) を一切変更せず、`status` と `adminMemo` が独立して保存される | `src/js/inquiries.tsx`, `gas/InquiryService.gs` |
| INQ-04 | 不正な入力・スパム送信を拒否できる | 必須項目欠落、不正なメール形式、文字数超過、存在しない `appId`、同一内容の重複送信、短時間の連続送信を行う | すべて `VALIDATION_ERROR` / `DUPLICATE_SUBMISSION` / `RATE_LIMIT_EXCEEDED` としてサーバー側で拒否される | `gas/InquiryService.gs` |

### 2.5 セキュリティ（Security）

| テストID | テスト項目 | 検証手順 / 条件 | 期待される結果 | 実装箇所 |
| :--- | :--- | :--- | :--- | :--- |
| SEC-01 | GitHubトークンがブラウザに露出しない | ビルド成果物 (`dist/`) およびAPIレスポンスを検査する | トークン本体はGASの `Script Properties` 内に留まり、フロントエンドには参照キー名（`GITHUB_TOKEN_*`）しか渡らない | `gas/Config.gs`, `gas/RepositoryService.gs` |
| SEC-02 | OAuthクライアントシークレットやアクセストークンが永続露出しない | ソースコードおよび `localStorage` を確認する | クライアントシークレットは不使用。アクセストークンはメモリ内のみで保持され、`localStorage` に保存されない | `src/js/auth.ts`, `src/js/store.ts` |
| SEC-03 | 問い合わせの個人情報が公開APIから取得できない | 公開Webアプリの `doGet` / `doPost` に問い合わせ取得パラメータ等を送信する | `doGet` は `action=notices` 以外をすべて `FORBIDDEN_ACTION` で拒否し、個人情報は一切取得できない | `gas/PublicApi.gs` |
| SEC-04 | XSS対策およびスプレッドシート数式インジェクション対策が機能する | Markdownや問い合わせ本文に `<script>alert(1)</script>` や `=IMPORTXML(...)` を入力する | Markdownプレビューは `DOMPurify` で危険タグ・属性を除去。問い合わせ本文はReactテキストノードとして安全描画。シート保存時は先頭 `=+-@` をエスケープ | `src/js/utils.ts`, `src/js/inquiries.tsx`, `gas/Utils.gs` |
