# susuru-obenri-tools

ちょっと便利な道具箱。

## 💰 貸し借り帳（kashikari/）

きょうだい・家族のお金の貸し借りを、みんなの端末（スマホ・パソコン・Android アプリ）で見られる帳簿です。
見た目と言葉づかいは航海日誌（koukai-nisshi-calendar）とそろえています（夜の海図のような紺・真鍮・羊皮紙の色、羅針盤のアイコン）。

- ウェブ版：https://susuruchachi.github.io/susuru-obenri-tools/kashikari/ （GitHub Pages を main で有効にすると開けます）
- Android アプリ：`apk/kashikari.apk`（ホーム画面のウィジェット付き）

### できること

**👪 みんなの帳簿**（きょうだいなど、何人でも）

- 「＋ 帳簿をつくる」→「招待する」で、招待リンク（または招待コード）を送ると、開いた人が参加できる。帳簿はいくつでも作れる
- 「＋ 貸した記録」：いつ・なにに・だれに・いくら。1人にでも、何人にでもまとめて貸せる
  - 「合計を割り勘」：4人でごはんに行って1人が払ったときなど。合計を入れると1人いくらかを出して、ほかの人の分を記録する（割り切れない分は払った人の分）
- **書けるのは貸した本人だけ**。ほかの人は見るだけ（帳簿をつくった人でも、ほかの人の記録は変えられない。Firestore のルールで決めている）
- 「返済を記録」：分けて返してもらっても、何回でも記録できる。残りを数えて、ぜんぶ返ってきたら「完済」の印
- **「返したよ」**：借りた人が「返したよ」を押すと、貸した人に届く（タブに数が出る）。貸した人が「認める」と、その記録に返済として入る。「断る」もできる
- 「まとめ」：返ってくる予定・返す予定、相手ごとの差し引き、みんなの「だれがだれにいくら返すか」

**📒 自分だけの帳簿**

- 友だちなど、アプリを使っていない人との貸し借り（貸した・借りた）を書いておける。自分にしか見えない
- 相手ごとの差し引き・返済の記録・完済の印はみんなの帳簿と同じ

### ファイル

```
kashikari/
  index.html       … 読み込むだけのページ（読み込み順：store → ledger → app-bridge → app）
  style.css        … 見た目（航海日誌と同じ色・字）
  store.js         … ログインとデータ（Firebase：すするanki・航海日誌と同じプロジェクト）
  ledger.js        … 計算（残り・差し引き）。画面とウィジェットで同じものを使う
  app-bridge.js    … Android アプリとのやりとり（ウィジェットに渡すデータ・自動更新）
  app.js           … 画面
  app-login.html   … Android アプリの Google ログイン用（ブラウザで開いてログインし、アプリに戻る）
  firestore.rules  … Firestore のルール（★ Firebase に足す。下を見てください）
  manifest.json, sw.js, icons/ … PWA（ホーム画面に追加できる）
android/           … Android アプリ（WebView 版＋ホーム画面のウィジェット）
apk/kashikari.apk  … 作った Android アプリ
tools/icons/       … アイコンを作り直す（bash tools/icons/make-icons.sh）
```

### データの置き場所（Firestore）

```
kashikari_books/{帳簿ID}                 { name, owner, members: [uid], names: { uid: 呼び名 }, createdAt }
kashikari_books/{帳簿ID}/loans/{id}      { lender, title, date, memo, mode, total, includeSelf, shares: [{ to, amount, repayments }] }
kashikari_books/{帳簿ID}/claims/{id}     { loanId, lender, from, amount, date, note, status: pending|approved|rejected }
kashikari_private/{uid}/entries/{id}     自分だけの帳簿 { dir: lent|borrowed, who, title, date, amount, repayments }
```

### ★ はじめに1回だけやること

1. **Firestore のルールを足す**：Firebase コンソール（susuruanki）→ Firestore Database →「ルール」で、
   `kashikari/firestore.rules` の「ここから」〜「ここまで」を、いまあるルールの `match /databases/{database}/documents {` の中に**足して**「公開」。
   いまあるルール（すするanki・航海日誌の分）は消さないでください。これをしないと、帳簿をつくるときに「書けませんでした」になります
2. **GitHub Pages を有効にする**：このリポジトリの Settings → Pages → Branch を `main`・`/ (root)` にして Save
3. （Android アプリで「Google でログイン」を使うなら）Firebase コンソール → ⚙️ プロジェクトの設定 →「マイアプリ」→「アプリを追加」→ Android →
   パッケージ名 `io.github.susuruchachi.kashikari`・署名証明書 SHA-1 `08:41:4B:1B:94:FF:A0:38:1B:5C:FC:55:57:60:C9:84:D4:F2:84:8E` →「アプリを登録」
   （google-services.json は要らない）。登録しないときは「うまくいかないとき：ブラウザでログイン」かメールでログインできます

### 🤖 Android アプリ（android/・ウィジェット付き）

`apk/kashikari.apk` を Android の端末で開くと入れられます（「提供元不明のアプリ」の許可が要ることがあります）。
ウェブ版を WebView でそのまま表示するので、画面の中身はウェブ版（main）を更新すれば自動で新しくなります。

- **ホーム画面のウィジェット「貸し借り帳」**（4×2。大きさを変えられる）：返ってくる予定・返す予定の合計（みんなの帳簿ぜんぶ＋自分だけの帳簿）、
  相手ごとの差し引き、届いた「🔔 返したよ」。押すとアプリが開く（「返したよ」が届いていれば、それを認める画面）
  - データはアプリを開いたとき（記録が変わったとき）に届く
- **Google ログイン**：航海日誌と同じ（アカウントを選ぶ画面。だめなら、ブラウザでログインして戻る）。メールでもログインできる
- つながらないときは「📴 つながりません」の画面に「もう一度ためす」
- **自動更新**：アプリを開いたとき、`kashikari/app-bridge.js` の `ANDROID_APK_CODE` が入っているアプリより新しければ、
  このサイトの `apk/kashikari.apk` を裏でダウンロードして入れ替える（はじめの1回だけ確認が出る。航海日誌と同じしくみ）
- **作り直すとき**（android/ を変えたときだけ）：`android/app/build.gradle` の `versionCode` を1つ上げて、GitHub の Actions →「kashikari-apk」→ Run workflow。
  署名鍵を Secrets（`KASHIKARI_KEYSTORE_B64`・`KASHIKARI_KEYSTORE_PASSWORD`）に入れておくと、APK を `apk/kashikari.apk` に置き、`ANDROID_APK_CODE` も同じ数にする
  （署名鍵は、いまの APK と同じものを使わないと、入っているアプリの上から入れられない）
- 手元で作るとき：`cd android && gradle assembleRelease`（Android SDK と JDK 17 以上。`KASHIKARI_KEYSTORE`・`KASHIKARI_KEYSTORE_PASSWORD` で署名鍵を渡す）
