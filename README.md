# 個人開発者向け統合管理システム (Personal Developer Admin System)

GitHub Pages 上で動作し、複数の個人開発アプリ・Webサイトの運営に必要な以下の3機能を一元管理する自分専用のWeb管理システムです。

1. **複数のGitHub Pagesリポジトリに対するMarkdown記事の投稿・編集・削除**（GitHub REST API連携・CodeMirror 6・リアルタイムHTMLサニタイズプレビュー・SHA競合差分解決）
2. **Google Apps Script (GAS) と Googleスプレッドシートを利用したアプリ別お知らせ管理**（公開予約・時間主導型トリガー自動公開・アプリ向け公開API配信）
3. **GAS と Googleスプレッドシートを利用したアプリ別お問い合わせ管理**（公開受付API・レート制限・重複送信防止・対応状況変更・管理者メモ独立保存・メール返信リンク）

月額費用 **0円**（GitHub Free + GitHub Pages + Google Apps Script + Google Sheets + Google Identity Services）で安全に長期運用できるよう設計されています。

---

## システムアーキテクチャとディレクトリ構成

```text
.
├── astro.config.mjs                 # Astro 静的サイト生成設定 (GitHub Pages 完全対応)
├── package.json                     # 最小限かつ役割が明確な依存関係定義
├── tsconfig.json                    # TypeScript strict モード設定
├── vitest.config.ts                 # Vitest 自動テスト設定
├── SETUP_GUIDE.md                   # 初心者向け詳細初期セットアップ手順書
├── TEST_SPECIFICATION.md            # テスト仕様書および検証項目一覧
├── .env.example                     # 公開識別子のみの環境変数テンプレート
├── .github/workflows/deploy.yml     # GitHub Pages 自動テスト＆デプロイワークフロー
├── gas/                             # Google Apps Script バックエンド (全12ファイル + マニフェスト)
│   ├── appsscript.json              # スコープ・API Executable・WebApp 設定
│   ├── Config.gs                    # シート定義・定数・Script Properties 安全取得
│   ├── Utils.gs                     # バリデーション・数式インジェクション対策・LockService
│   ├── Auth.gs                      # Session検証 & Google IDトークン厳密検証 (tokeninfo)
│   ├── SpreadsheetService.gs        # 5シート自動初期化・CRUD・OperationLogs記録
│   ├── GitHub.gs                    # GitHub REST API クライアント (レート制限・SHA競合検知)
│   ├── RepositoryService.gs         # 複数GitHubリポジトリ管理
│   ├── ArticleService.gs            # 記事一覧(Git Trees)・詳細・作成・更新・削除・画像アップロード
│   ├── AppService.gs                # アプリマスター (Applications) 管理
│   ├── NoticeService.gs             # お知らせ管理・公開予約・時間主導型トリガー処理
│   ├── InquiryService.gs            # お問い合わせ管理・スパム/レート制限対策
│   ├── Api.gs                       # 管理API (Apps Script API scripts.run エントリーポイント)
│   └── PublicApi.gs                 # アプリ向け公開API (WebApp doGet / doPost 分離実装)
├── src/
│   ├── pages/index.astro            # GitHub Pages エントリーHTML (CSPヘッダー付き)
│   ├── css/
│   │   ├── style.css                # Tailwind CSS 4 & 基本変数
│   │   ├── layout.css               # サイドバー・メイン領域・エディタ2カラム分割レイアウト
│   │   └── components.css           # Markdownプレビュー・CodeMirror 6 スタイル
│   ├── types/domain.ts              # ドメイン型定義
│   ├── schemas/validation.ts        # Zod 入力値検証スキーマ
│   └── js/
│       ├── app.tsx                  # 認証ゲートウェイ・メインシェル・トースト通知
│       ├── auth.ts                  # Google Identity Services (IDトークン + OAuth Token Model)
│       ├── api.ts                   # Apps Script API (scripts.run) 通信・再試行・タイムアウト制御
│       ├── store.ts                 # Zustand インメモリ状態管理 (アクセストークン非永続化)
│       ├── dashboard.tsx            # Dashboard (実データ集計・最近の問い合わせ・操作履歴)
│       ├── articles.tsx             # Articles (GitHub記事管理・SHA競合Diff解決モーダル)
│       ├── markdown-editor.tsx      # CodeMirror 6 エディタ・DOMPurifyプレビュー・Frontmatter編集
│       ├── notices.tsx              # Notices (アプリ別お知らせ管理・公開予約)
│       ├── inquiries.tsx            # Inquiries (お問い合わせ管理・管理者メモ・メール起動)
│       ├── applications.tsx         # Applications (アプリマスター管理)
│       ├── settings.tsx             # Settings (複数リポジトリ管理・DB初期化・トリガー設定)
│       └── utils.ts                 # JST日時変換・Frontmatterパーサー・DOMPurify・Diff計算
└── tests/
    └── system-verification.test.ts  # 認証・Frontmatter・XSSサニタイズ・Zod検証の自動テスト
```

---

## 採用ライブラリと役割

| ライブラリ | 採用理由と役割 |
| :--- | :--- |
| **Astro 5** | GitHub Pages向けの完全な静的HTML/アセット生成。サーバー機能に一切依存しない軽量出力。 |
| **React 19** | 複数セクション間で認証状態や選択リポジトリを共有する統合管理UIの構築。 |
| **TypeScript (strict)** | API通信ペイロードやシート構造の型安全性をコンパイル時に保証。 |
| **Tailwind CSS 4** | 装飾を抑えた実用的・高視認性の管理画面スタイリング。 |
| **Zustand 5** | OAuthアクセストークンを `localStorage` に保存せずメモリ内だけで安全に保持し、未保存変更ガードを管理。 |
| **TanStack Query 5** | GAS / GitHub API通信のキャッシュ、ローディング状態、再取得制御。 |
| **TanStack Table 8** | 記事一覧・お知らせ一覧・お問い合わせ一覧のソート、フィルタリング、ページネーション。 |
| **CodeMirror 6** | Markdown構文ハイライト、行番号、キーボードショートカットを備えた堅牢なテキストエディタ。 |
| **Zod 3** | フォーム送信前および設定値の厳格なスキーマ検証。 |
| **DOMPurify + Marked** | MarkdownのリアルタイムHTML変換と、XSSを完全に防ぐHTMLサニタイズ処理。 |
| **Lucide React** | 機能を識別するための最小限の操作アイコン。 |

---

## セキュリティ設計の要点

- **ブラウザ側に秘密情報を一切配置しない**：GitHub Fine-grained PAT は GAS の `Script Properties` にのみ保存し、フロントエンドでは参照キー名（例：`GITHUB_TOKEN_PORTFOLIO`）のみを扱います。
- **アクセストークンの非永続化**：OAuthアクセストークンは `localStorage` や `sessionStorage` に保存せず、Zustandのインメモリストアのみで保持します。
- **二層認証検証**：Google Identity Services の IDトークン（本人確認）と OAuthアクセストークン（`scripts.run` 実行権限）を分離し、GAS側でも `Session.getActiveUser().getEmail() === ADMIN_EMAIL` および Google公式 `tokeninfo` によるIDトークン検証を実施します。
- **管理APIと公開APIの完全分離**：
  - 管理API（`Api.gs`）：Apps Script API `scripts.run`（アクセス権：自分のみ）で動作。
  - 公開API（`PublicApi.gs`）：Webアプリ `doGet` / `doPost` で動作し、「公開済みお知らせの取得」と「新規お問い合わせ登録（レート制限・重複防止付き）」の2操作のみを受け付けます。

---

## セットアップとローカル開発コマンド

詳細な初期設定手順は **[SETUP_GUIDE.md](./SETUP_GUIDE.md)** を参照してください。

```bash
# 1. 依存パッケージのインストール
npm install

# 2. 自動テストの実行
npm test

# 3. ローカル開発サーバーの起動 (http://localhost:4321)
npm run dev

# 4. 本番用静的ビルド (./dist に出力)
npm run build
```

---

## アプリ向け公開APIの呼び出し方法（個人開発アプリからの連携例）

### 1. 公開済みお知らせ一覧の取得 (`GET`)

```ts
// appId には Applications シートの id または bundleId (例: com.example.myapp) を指定できます
const res = await fetch(
  'https://script.google.com/macros/s/<YOUR_WEBAPP_DEPLOYMENT_ID>/exec?action=notices&appId=com.example.myapp'
);
const data = await res.json();
// data.notices に status === "published" のお知らせ配列のみが返却されます
```

### 2. お問い合わせの送信 (`POST`)

```ts
const res = await fetch(
  'https://script.google.com/macros/s/<YOUR_WEBAPP_DEPLOYMENT_ID>/exec',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8' // GAS WebアプリのCORSプリフライト回避のためtext/plainでJSON文字列を送信可能
    },
    body: JSON.stringify({
      appId: 'com.example.myapp',
      name: '山田 太郎',
      email: 'taro@example.com',
      subject: '機能に関する質問',
      message: 'いつもアプリを利用しています。...'
    })
  }
);
const result = await res.json();
```
