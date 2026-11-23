package io.github.susuruchachi.kashikari;

// 貸し借り帳のウィジェット：返ってくる予定・返す予定の合計と、相手ごとの差し引き、届いた「返したよ」
// 押すと、アプリが開く（「返したよ」が届いていれば、それを認める画面）

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.graphics.Typeface;
import android.os.Bundle;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.StyleSpan;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class KashikariWidget extends AppWidgetProvider {
    private static final int C_TEXT = 0xFFEDE6D2, C_DIM = 0xFF5E7180, C_SUB = 0xFF97A8B5, C_SIGNAL = 0xFF7FB69E,
        C_BRASS = 0xFFE3C384, C_DANGER = 0xFFE08A84;

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) render(ctx, mgr, id);
    }

    // 大きさを変えたら、出す行の数を変える
    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager mgr, int id, Bundle opts) {
        render(ctx, mgr, id);
    }

    static void updateAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, KashikariWidget.class));
        for (int id : ids) render(ctx, mgr, id);
    }

    private static void add(SpannableStringBuilder b, String s, int color, boolean bold) {
        int st = b.length(); b.append(s);
        b.setSpan(new ForegroundColorSpan(color), st, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        if (bold) b.setSpan(new StyleSpan(Typeface.BOLD), st, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
    }

    static void render(Context ctx, AppWidgetManager mgr, int id) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_kashikari);
        JSONObject data = WidgetData.load(ctx);
        int claims = data.optInt("claims", 0);

        if (!data.optBoolean("signedIn", false)) {
            v.setTextViewText(R.id.w_in, "—");
            v.setTextViewText(R.id.w_out, "—");
            v.setTextViewText(R.id.w_lines, data.has("signedIn") ? "ログインすると、ここに貸し借りが出ます" : "タップしてアプリを開くと、ここに貸し借りが出ます");
            v.setViewVisibility(R.id.w_claims, View.GONE);
            v.setTextViewText(R.id.w_at, "");
        } else {
            v.setTextViewText(R.id.w_in, WidgetData.yen(data.optLong("inSum", 0)));
            v.setTextViewText(R.id.w_out, WidgetData.yen(data.optLong("outSum", 0)));

            // 高さに合わせて、出す相手の数を決める（4×2 で3行くらい）
            int rows = 3;
            try {
                Bundle o = mgr.getAppWidgetOptions(id);
                int h = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
                if (h > 0) rows = Math.max(1, Math.min(8, (h - 110) / 20));
            } catch (Exception ignored) {}
            if (claims > 0) rows = Math.max(1, rows - 1);

            SpannableStringBuilder t = new SpannableStringBuilder();
            JSONArray lines = data.optJSONArray("lines");
            int n = lines == null ? 0 : lines.length();
            if (n == 0) add(t, "いま返していないお金はありません ✦", C_SUB, false);
            for (int i = 0; i < Math.min(n, rows); i++) {
                JSONObject x = lines.optJSONObject(i);
                if (x == null) continue;
                if (t.length() > 0) t.append("\n");
                boolean in = "in".equals(x.optString("d"));
                if (in) { add(t, x.optString("n", "だれか"), C_TEXT, false); add(t, " → あなた  ", C_DIM, false); add(t, WidgetData.yen(x.optLong("a", 0)), C_SIGNAL, true); }
                else { add(t, "あなた → ", C_DIM, false); add(t, x.optString("n", "だれか") + "  ", C_TEXT, false); add(t, WidgetData.yen(x.optLong("a", 0)), C_DANGER, true); }
            }
            if (n > rows) { t.append("\n"); add(t, "ほか " + (n - rows) + "人", C_DIM, false); }
            v.setTextViewText(R.id.w_lines, t);

            if (claims > 0) {
                v.setViewVisibility(R.id.w_claims, View.VISIBLE);
                v.setTextViewText(R.id.w_claims, "🔔 「返したよ」が " + claims + "件 届いています（タップして認める）");
            } else v.setViewVisibility(R.id.w_claims, View.GONE);

            long at = data.optLong("at", 0);
            v.setTextViewText(R.id.w_at, at > 0 ? new SimpleDateFormat("M/d H:mm", Locale.JAPAN).format(new Date(at)) + " 時点" : "");
        }
        v.setOnClickPendingIntent(R.id.w_root, WidgetData.openApp(ctx, claims > 0 ? "view=claims" : "", 30));
        mgr.updateAppWidget(id, v);
    }
}
