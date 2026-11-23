package io.github.susuruchachi.susurulauncher;

// ホーム画面のウィジェット：3つのアプリのアイコンと名前。押すとそのアプリが直接開く（入っていなければランチャーの画面）
// アイコンは入っているアプリのものを使う。ランチャーの画面を開いたときにも描き直す（入れた・消したを反映）

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.widget.RemoteViews;

public class LauncherWidget extends AppWidgetProvider {
    private static final int[] CELL = { R.id.w_cell_0, R.id.w_cell_1, R.id.w_cell_2 };
    private static final int[] ICON = { R.id.w_icon_0, R.id.w_icon_1, R.id.w_icon_2 };
    private static final int[] NAME = { R.id.w_name_0, R.id.w_name_1, R.id.w_name_2 };

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, views(ctx));
    }

    static void updateAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, LauncherWidget.class));
        if (ids.length == 0) return;
        RemoteViews v = views(ctx);
        for (int id : ids) mgr.updateAppWidget(id, v);
    }

    static RemoteViews views(Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_launcher);
        int px = Math.round(34 * ctx.getResources().getDisplayMetrics().density);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        for (int i = 0; i < Apps.ALL.length && i < CELL.length; i++) {
            Apps.App a = Apps.ALL[i];
            v.setTextViewText(NAME[i], a.name);
            Drawable d = Apps.icon(ctx, a);
            if (d != null) v.setImageViewBitmap(ICON[i], Apps.bitmap(d, px));
            else v.setImageViewResource(ICON[i], R.drawable.ic_launcher);
            Intent open = Apps.launchIntent(ctx, a);
            if (open == null) {
                // 入っていない：ランチャーの画面（そこからダウンロード）
                open = new Intent(Intent.ACTION_VIEW, Uri.parse("susurulauncher://home"), ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            }
            v.setOnClickPendingIntent(CELL[i], PendingIntent.getActivity(ctx, 100 + i, open, flags));
        }
        return v;
    }
}
