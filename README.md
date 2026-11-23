# susuru-obenri-tools

ちょっと便利な道具箱。

## 🚀 すするアプリ（Android のランチャー：launcher-android/）

すするanki・航海日誌・すする帳簿（貸し借り帳）の Android アプリを、1つのところから開くアプリです。3つのアプリはそれぞれ今まで通り（データ・ウィジェット・自動更新もそれぞれ）で、このアプリは開くだけ。

- APK：`apk/susuru-launcher.apk`（GitHub Actions の launcher-apk が作る）
- ランチャーの画面：3つのタイル（入っているアプリのアイコン。入っていなければ押すと APK のダウンロード）。設定「起動したら、前に開いたアプリをすぐ開く」
- アイコンの長押し：すするanki・航海日誌・すする帳簿・ランチャー（`susurulauncher://open?app=anki|koukai|kashikari`・`susurulauncher://home`）
- ホーム画面のウィジェット「すするアプリ」：3つのアイコンを並べて、押すとそのアプリが直接開く
- iOS では、すするanki の iOS アプリ（ios/）が同じ名前のランチャーで、3つが1つのアプリの中に入っている（iOS は無料の Apple ID だと7日ごとに入れ直すため）

## 💰 貸し借り帳（kashikari/）

きょうだい・家族のお金の貸し借りを、みんなの端末（スマホ・パソコン・Android アプリ）で見られる帳簿です。
見た目と言葉づかいは航海日誌（koukai-nisshi-calendar）とそろえています（夜の海図のような紺・真鍮・羊皮紙の色、羅針盤のアイコン）。

- ウェブ版：https://susuruchachi.github.io/susuru-obenri-tools/kashikari/ （GitHub Pages を main で有効にすると開けます）
- Android アプリ：`apk/kashikari.apk`（ホーム画面のウィジェット付き）
- iOS・iPadOS：すするanki の iOS アプリ（ランチャー「すするアプリ」）の中に「すする帳簿」として入っている（ウィジェット付き）。アプリの中では Android アプリと同じ `window.KashikariApp`（setWidgetData・saveFile・googleSignIn・takeLogin）が使える（UA に `KashikariIOS/版`）。Google のログインは `app-login.html#state=…&ios=1` を iOS のログインの画面で開き、`susuruanki://auth?…` で戻る

### できること

**👪 みんなの帳簿**（きょうだいなど、何人でも）

- 「＋ 帳簿をつくる」→「招待する」で、招待リンク（または招待コード）を送ると、開いた人が参加できる。帳簿はいくつでも作れる
- 「＋ 貸した記録」：いつ・なにに・だれに・いくら。1人にでも、何人にでもまとめて貸せる
  - 「合計を割り勘」：4人でごはんに行って1人が払ったときなど。合計を入れると1人いくらかを出して、ほかの人の分を記録する（割り切れない分は払った人の分）
- **書けるのは貸した本人だけ**。ほかの人は見るだけ（帳簿をつくった人でも、ほかの人の記録は変えられない。Firestore のルールで決めている）
- 「返済を記録」：分けて返してもらっても、何回でも記録できる。残りを数えて、ぜんぶ返ってきたら「完済」の印
- **「返したよ」**：借りた人が「返したよ」を押すと、貸した人に届く（タブに数が出る）。貸した人が「認める」と、その記録に返済として入る。「断る」もできる
- 「まとめ」：返ってくる予定・返す予定、相手ごとの差し引き、みんなの「だれがだれにいくら返すか」

- **帳簿を消す**（つくった人だけ）：「帳簿 ▾」→「🗑 消す」。帳簿の名前を打ってから消す。中の記録・返したよもぜんぶ消える
  （まず帳簿を「閉じる」のでもう書けなくなり、記録を消してから帳簿を消す。途中で止まっても「続きを消す」で続きから）
- **帳簿から抜ける**（つくった人以外）：その帳簿が見られなくなる。自分が書いた記録は残る

**📒 自分の帳簿**（自分にしか見えない）

- **📅 家計簿**：収入・支出・振替（口座から口座へ）を入れる。金額は「1200+300」のような足し算もできる。「保存して続ける」で何件も続けて入れられる
  - 月ごとの収入・支出・収支、予算（ぜんぶ・分類ごと）とあといくら、「今日から1日いくらまで」
  - 何に使った？（分類ごとの棒。押すとその分類だけ出す）、日ごとの一覧
  - さがす：内容・メモ・分類・金額で、ぜんぶの月からさがす
- **👛 口座**：財布・銀行・電子マネーなど（足せる）。口座ごとの残高と合計、貸し借りを合わせた「ぜんぶ合わせると」
  - **通帳**：口座を押すと、お引出し・お預入れ・残高の通帳の形で出る。「⚖️ 残高を合わせる」でほんとうの残高に直せる（収入・支出には数えない）
- **🤝 貸し借り**：アプリを使っていない人との貸し借り（貸した・借りた・返済・完済）
- **📈 1年**：月ごとの収入・支出の棒グラフ、1年の合計と1か月の平均、1年で何に使ったか
- **⚙️ 設定**：予算、**固定費・毎月の収入**（家賃・スマホ代・お小遣いなど。毎月その日になると自動で入る）、分類（足す・直す・消す）、**CSV の書き出し**（家計簿・貸し借り）

### ファイル

```
kashikari/
  index.html       … 読み込むだけのページ（読み込み順：firebase-config → store → ledger → app-bridge → kakeibo → app）
  firebase-config.js … ★ Firebase の設定（貸し借り帳だけのプロジェクト）。ここだけ変えれば、ウェブ版も Android アプリも切りかわる
  style.css        … 見た目（航海日誌と同じ色・字）
  store.js         … ログインとデータ（Firebase）
  ledger.js        … 計算（残り・差し引き）。画面とウィジェットで同じものを使う
  app-bridge.js    … Android アプリとのやりとり（ウィジェットに渡すデータ・自動更新）
  kakeibo.js       … 自分の帳簿（家計簿・口座と通帳・予算・固定費・1年・書き出し）
  app.js           … 画面（みんなの帳簿・貸し借り・ログイン）
  app-login.html   … Android アプリの Google ログイン用（ブラウザで開いてログインし、アプリに戻る）
  firestore.rules  … Firestore のルール（★ Firebase に貼る。下を見てください）
  manifest.json, sw.js, icons/ … PWA（ホーム画面に追加できる）
android/           … Android アプリ（WebView 版＋ホーム画面のウィジェット）
apk/kashikari.apk  … 作った Android アプリ
tools/icons/       … アイコンを作り直す（bash tools/icons/make-icons.sh）
```

### Firestore のルール（kashikari/firestore.rules）のしくみ

コンソールに貼りやすいように、ファイルには説明を書かずに英数字だけにしています。中身は：

- 帳簿（kashikari_books）：帳簿ID（招待コード）を知っているログイン中の人は、その帳簿を1つ見られる。一覧で見られるのは自分が参加している帳簿だけ。
  参加は「自分を1人足して、自分の呼び名を入れる」ことだけできる。呼び名は自分の分だけ変えられる。帳簿の名前はつくった人だけが変えられる。
  抜けるのは自分だけ（つくった人は抜けられない）。消せるのはつくった人だけで、先に「閉じる」（closing）。閉じた帳簿には、だれも書けず、参加もできない。
  閉じた帳簿の中の記録・返したよは、つくった人が消せる
- 貸した記録（loans）：参加している人はみんな読める。書く・直す・消すのは貸した本人（lender）だけ。ほかの人に渡すこともできない
- 返したよ（claims）：借りた人が自分の名前で出す（はじめは「確認待ち」）。「認める・断る」は貸した人だけで、1回決めたら変えられない。消せるのは出した人か貸した人
- 自分だけの帳簿（kashikari_private/{uid}）：本人しか読めない・書けない

### データの置き場所（Firestore）

```
kashikari_books/{帳簿ID}                 { name, owner, members: [uid], names: { uid: 呼び名 }, createdAt }
kashikari_books/{帳簿ID}/loans/{id}      { lender, title, date, memo, mode, total, includeSelf, shares: [{ to, amount, repayments }] }
kashikari_books/{帳簿ID}/claims/{id}     { loanId, lender, from, amount, date, note, status: pending|approved|rejected }
kashikari_private/{uid}/entries/{id}     自分だけの貸し借り { dir: lent|borrowed, who, title, date, amount, repayments }
kashikari_private/{uid}/tx/{id}          家計簿 { kind: expense|income|transfer|adjust, date, amount, cat, account, toAccount, dir, title, memo, rec }
                                         （固定費で入ったものは id が rec_{固定費ID}_{年-月}。消した月は設定の skip に覚えて入れ直さない）
kashikari_private/{uid}/kakeibo/settings 家計簿の設定 { expenseCats, incomeCats, accounts: [{ id, name, icon, initial }], budget: { total, cats }, recurring }
```

### ★ はじめに1回だけやること（Firebase は貸し借り帳だけのプロジェクト。すするanki・航海日誌とは別）

1. **Firebase のプロジェクトをつくる**：https://console.firebase.google.com →「プロジェクトを追加」（名前の例：kashikari。Google アナリティクスはオフでよい）
2. **ログインの方法をオンにする**：Authentication →「始める」→ Sign-in method で **Google** と **メール / パスワード** を有効にする
   - Google を有効にした画面の「ウェブ SDK 構成」にある **ウェブ クライアント ID**（…apps.googleusercontent.com）を控える
   - Authentication → 設定 →「承認済みドメイン」に `susuruchachi.github.io` を足す
3. **Firestore をつくる**：Firestore Database →「データベースの作成」（場所は asia-northeast1（東京）など・「本番環境モード」）
   →「ルール」タブで、書いてあるものを**ぜんぶ消してから**、`kashikari/firestore.rules` をまるごと貼り付けて「公開」
   - 1行目が `rules_version = '2';` になっているか確かめる。メモ帳アプリなどを通すと `'` が `’`（曲がった引用符）に変わって「Line 1: Parse error」になることがある。
     いちばん確実なのは、パソコンで https://raw.githubusercontent.com/susuruchachi/susuru-obenri-tools/main/kashikari/firestore.rules を開いて全部コピーすること
4. **ウェブアプリを登録する**：⚙️ プロジェクトの設定 →「マイアプリ」→ ウェブ（</>）→ 名前を入れて登録 → 出てくる `firebaseConfig` を
   `kashikari/firebase-config.js` の `config` に、2. で控えたウェブ クライアント ID を `webClientId` に入れる
5. **GitHub Pages を有効にする**：このリポジトリの Settings → Pages → Branch を `main`・`/ (root)` にして Save
6. （Android アプリで「Google でログイン」を使うなら）⚙️ プロジェクトの設定 →「マイアプリ」→「アプリを追加」→ Android →
   パッケージ名 `io.github.susuruchachi.kashikari`・署名証明書 SHA-1 `08:41:4B:1B:94:FF:A0:38:1B:5C:FC:55:57:60:C9:84:D4:F2:84:8E` →「アプリを登録」
   （google-services.json は要らない）。登録しないときは「うまくいかないとき：ブラウザでログイン」かメールでログインできます

firebase-config.js が空のあいだは、ページに「⚙️ まだ準備中です」と出ます。

### 🤖 Android アプリ（android/・ウィジェット付き）

`apk/kashikari.apk` を Android の端末で開くと入れられます（「提供元不明のアプリ」の許可が要ることがあります）。
ウェブ版を WebView でそのまま表示するので、画面の中身はウェブ版（main）を更新すれば自動で新しくなります。

- **ホーム画面のウィジェット「貸し借り帳」**（4×2。大きさを変えられる）：返ってくる予定・返す予定の合計（みんなの帳簿ぜんぶ＋自分だけの帳簿）、
  今月の支出と予算のあと（家計簿）、相手ごとの差し引き、届いた「🔔 返したよ」。押すとアプリが開く（「返したよ」が届いていれば、それを認める画面）
  - データはアプリを開いたとき（記録が変わったとき）に届く
- **Google ログイン**：航海日誌と同じしくみ（アカウントを選ぶ画面。だめなら、ブラウザでログインして戻る）。メールでもログインできる。
  使うウェブ クライアント ID は firebase-config.js から受け取るので、Firebase を変えても APK は作り直さなくてよい
- つながらないときは「📴 つながりません」の画面に「もう一度ためす」
- 家計簿の CSV の書き出しは「ダウンロード」フォルダーに保存（1.2.0 から）
- **⚙️ アプリと更新**（上の帯の ⚙️。新しい版があると印が付く・1.3.0 から）：いまの版といちばん新しい版、「🔄 更新を確認する」「📲 更新する」、
  ダウンロード中・入れ替え中などのようす、うまくいかなかった理由（ダウンロードできなかった・署名がちがう・提供元の許可がオフ など。アプリが覚えておく）、
  「うまくいかないとき：ブラウザでダウンロードして入れる」、「画面を読み込み直す」。ブラウザで開いたときは、いちばん新しい版とダウンロード
  - いちばん新しい版は `apk/version.json`（`{ code, name, date, notes }`）を毎回読んで調べる。`notes`（変わったこと）は APK を作る前に手で書く
- **自動更新**：アプリを開いたとき、`kashikari/app-bridge.js` の `ANDROID_APK_CODE` が入っているアプリより新しければ、
  このサイトの `apk/kashikari.apk` を裏でダウンロードして入れ替える（はじめの1回だけ確認が出る。航海日誌と同じしくみ）
- **作り直すとき**（android/ を変えたときだけ）：`android/app/build.gradle` の `versionCode` を1つ上げて、GitHub の Actions →「kashikari-apk」→ Run workflow。
  署名鍵を Secrets（`KASHIKARI_KEYSTORE_B64`・`KASHIKARI_KEYSTORE_PASSWORD`）に入れておくと、APK を `apk/kashikari.apk` に置き、`ANDROID_APK_CODE` と `apk/version.json` も同じ版にする（先にウィジェットのテスト `gradle testReleaseUnitTest` も走る）
  （署名鍵は、いまの APK と同じものを使わないと、入っているアプリの上から入れられない）
- 手元で作るとき：`cd android && gradle assembleRelease`（Android SDK と JDK 17 以上。`KASHIKARI_KEYSTORE`・`KASHIKARI_KEYSTORE_PASSWORD` で署名鍵を渡す）
