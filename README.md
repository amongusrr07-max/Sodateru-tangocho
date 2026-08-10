# 単語帳メーカー（Web版）

写真や手入力からAIが英検の単語帳を作ってくれるアプリ。フラッシュカード・4択クイズ（意味／穴埋め）・発音・例文・バックアップつき。

## 公開までの流れ（GitHub → Vercel）

### ① Gemini(Google AI Studio)の APIキーを用意する
1. https://aistudio.google.com にアクセスしてGoogleアカウントでログイン
2. 「Get API key」から新しいキーを発行してコピーしておく（あとで使う）
3. クレカ登録は不要。無料枠は Flash / Flash-Lite系のモデルに限られていて、1日あたりのリクエスト数に上限があるよ（詳しくは https://ai.google.dev/gemini-api/docs/models で最新情報を確認してね）
4. 無料枠で送ったデータはGoogleのモデル改善に使われる場合がある、という点だけ頭の片隅に置いておくといいよ

### ② GitHubにリポジトリを作る
1. GitHubで新しいリポジトリを作成（例: `eiken-tangocho`）
2. このフォルダの中身をそのままpushする

```bash
cd eiken-tangocho-web
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/【自分のユーザー名】/eiken-tangocho.git
git push -u origin main
```

### ③ Vercelでデプロイする
1. https://vercel.com にGitHubアカウントでログイン
2. 「Add New → Project」から、さっき作ったGitHubリポジトリを選ぶ
3. Framework は自動で「Vite」と認識されるはず（そのままでOK）
4. デプロイする**前**に、環境変数を設定する：
   - `Environment Variables` の欄に
     - Key: `GEMINI_API_KEY`
     - Value: ①でコピーしたAPIキー
   - を追加
5. 「Deploy」を押す。数分待つと `https://プロジェクト名.vercel.app` みたいなURLが発行される

これで完成！GitHubにpushするたびに自動で再デプロイされるよ。

### ④ サイト名・説明・アイコンを変えたい時
`index.html` の中の以下を書き換えるだけ：

```html
<title>単語帳メーカー | 英検AI単語帳</title>
<meta name="description" content="...">
<link rel="icon" href="...">
```

アイコンをちゃんとした画像にしたい場合は、`public/favicon.png` みたいな画像ファイルを置いて、
`<link rel="icon" href="/favicon.png" />` に書き換えてね。

---

## ローカルで動作確認したい時

```bash
npm install
npm run dev
```

ただしローカル実行だと `/api/claude` のサーバーレス関数は動かない（Vercel環境じゃないと動かない仕組みだから）。
ローカルでAPI込みで試したいなら `vercel dev` コマンド（Vercel CLI）を使うと同じ環境を再現できるよ。

## データの保存について

単語データはこのアプリを開いたブラウザの `localStorage` に保存される。つまり：
- 端末・ブラウザごとに別々のデータになる
- ブラウザのデータを消すと単語帳も消える

なので**バックアップ機能（書き出し／読み込み）は定期的に使うのがおすすめ！**
