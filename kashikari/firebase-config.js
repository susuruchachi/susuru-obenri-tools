// --- 貸し借り帳の Firebase の設定（貸し借り帳だけのプロジェクト。すするanki・航海日誌とは別）---
// ここだけ変えれば、ウェブ版・Android アプリ・app-login.html のどれもこのプロジェクトを使う（APK を作り直さなくてよい）
// どれも秘密ではない（ウェブのページに書くもの）。データを守るのは Firestore のルール（firestore.rules）
window.KASHIKARI_FIREBASE = {
  // Firebase コンソール → ⚙️ プロジェクトの設定 →「マイアプリ」のウェブアプリ →「SDK の設定と構成」の firebaseConfig
  config: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: '',
  },
  // Android アプリの「Google でログイン」に使う「ウェブ クライアント ID」
  // （Authentication → Sign-in method → Google →「ウェブ SDK 構成」の「ウェブ クライアント ID」。…apps.googleusercontent.com で終わる）
  webClientId: '',
};
