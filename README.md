# 食材期限リマインダー 完成版

## できること

- Supabase Authによるアカウント登録・ログイン
- 同じアカウントで複数端末からデータ同期
- 食材の追加・編集・削除
- 期限の色分け
- CSV出力
- 通知設定（7日前 / 3日前 / 前日 / 当日 / 期限切れ）
- Service WorkerによるWeb Push受信基盤
- Edge Functionによる期限通知の送信基盤

## 1. Supabaseを作る

Supabaseで新規プロジェクトを作成し、SQL Editorで `supabase/schema.sql` を実行します。

Authentication > Providers > Email を有効にしてください。

## 2. フロントエンド設定

`.env.example` を `.env` にコピーして、SupabaseのProject URLとanon keyを入れます。

例:

VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=ey...

## 3. 起動

Node.js 20+ 推奨。

```bash
npm install
npm run dev
```

公開時:

```bash
npm run build
```

`dist` をHTTPSで公開してください。

## 4. 通知について

ブラウザの通知許可だけでは「アプリを閉じた状態で期限を計算して通知」はできません。
そのため、このプロジェクトにはWeb Pushの受信側Service WorkerとSupabase Edge Functionを入れています。

### VAPIDキー

Web Push用の鍵を作成し、Supabase Edge FunctionのSecretsに次を設定します。

- VAPID_SUBJECT
- VAPID_PUBLIC_KEY
- VAPID_PRIVATE_KEY

`VAPID_SUBJECT` は `mailto:あなたのメールアドレス` のような値です。

### Edge Function

Supabase CLIでログイン後:

```bash
supabase functions deploy send-expiry-notifications
```

Functionには以下のSecretsが必要です。

- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- VAPID_SUBJECT
- VAPID_PUBLIC_KEY
- VAPID_PRIVATE_KEY

Service Role Keyは絶対にブラウザ側へ入れないでください。

### 毎日実行

Supabase側のScheduled/cron機能から `send-expiry-notifications` を毎日実行してください。
「毎朝8:00 JST」などに設定すると、7日前・3日前・前日・当日等の通知条件に従って送信します。

## 重要: iPhone / iPad

iOS/iPadOSのWeb PushはHTTPS環境でWebアプリをホーム画面へ追加して使う構成を推奨します。
ブラウザやOSの通知設定が拒否されている場合、通知は届きません。

## セキュリティ

元コードの `localStorage` にユーザーと平文パスワードを保存する方式は廃止しています。
認証はSupabase Auth、食材データはRLS付きPostgresでユーザー単位に分離します。
秘密の質問でパスワードを表示する方式も廃止し、メールによるパスワード再設定に変更しています。
