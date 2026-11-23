package io.github.susuruchachi.kashikari;

// アプリの更新（PackageInstaller のセッション）の結果を受け取る
// ・確認が要るとき：アプリを開いていれば確認の画面を開く。裏にいるときは、次に開いたときに確認する（MainActivity が見る）
// ・入れ終わると、このアプリは新しい版に入れ替わる（そのときアプリは一度終わる）

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.widget.Toast;

public class InstallResultReceiver extends BroadcastReceiver {
    static volatile boolean foreground = false;
    static volatile boolean askLater = false;

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (ApkUpdater.ACTION_AUTO.equals(intent.getAction())) {
            if (!ApkUpdater.autoOk(ctx)) return;
            final PendingResult pr = goAsync();
            final Context app = ctx.getApplicationContext();
            new Thread(() -> { try { ApkUpdater.install(app); } finally { pr.finish(); } }).start();
            return;
        }
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            ApkUpdater.installing = false;
            Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm == null) return;
            if (!foreground) { askLater = true; return; }
            confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try { ctx.startActivity(confirm); } catch (Exception e) { askLater = true; }
            return;
        }
        ApkUpdater.installing = false;
        if (status == PackageInstaller.STATUS_SUCCESS) { ApkUpdater.clearFail(ctx); return; }
        String msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        // うまくいかなかった理由を覚えておく（ウェブ版の「アプリと更新」に出す）
        String why = status == PackageInstaller.STATUS_FAILURE_ABORTED ? "入れ替えの確認で「キャンセル」されました"
            : status == PackageInstaller.STATUS_FAILURE_CONFLICT ? "入っているアプリと署名がちがうので、上から入れられませんでした（一度アンインストールしてから入れてください）"
            : status == PackageInstaller.STATUS_FAILURE_STORAGE ? "端末の空きが足りませんでした"
            : status == PackageInstaller.STATUS_FAILURE_BLOCKED ? "端末の設定で入れ替えが止められました"
            : "アプリを入れ替えられませんでした";
        ApkUpdater.fail(ctx, why + (msg != null ? "（" + msg + "）" : ""));
        if (foreground && status != PackageInstaller.STATUS_FAILURE_ABORTED)
            Toast.makeText(ctx, "アプリを更新できませんでした" + (msg != null ? "（" + msg + "）" : ""), Toast.LENGTH_LONG).show();
    }
}
