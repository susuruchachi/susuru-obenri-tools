package io.github.susuruchachi.kashikari;

// ウィジェットのデータ：ウェブ版（kashikari/app-bridge.js の kkBuildWidgetData）が KashikariApp.setWidgetData で渡す
//   { signedIn, inSum: 返ってくる予定, outSum: 返す予定, lines: [{ n: 名前, d: in|out, a: 金額 }], claims: 届いた返したよの数, today, at }

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import org.json.JSONObject;

import java.text.NumberFormat;
import java.util.Locale;

final class WidgetData {
    static final String PREFS = "kashikari_widget";

    private WidgetData() {}

    static JSONObject load(Context ctx) {
        try { return new JSONObject(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("data", "{}")); }
        catch (Exception e) { return new JSONObject(); }
    }

    static void save(Context ctx, String json) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("data", json == null ? "{}" : json).apply();
        KashikariWidget.updateAll(ctx);
    }

    static String yen(long n) { return "¥" + NumberFormat.getIntegerInstance(Locale.JAPAN).format(n); }

    // アプリを開く（query は "view=claims" など。ウェブ版の __kashikariOpen が受け取る）
    static PendingIntent openApp(Context ctx, String query, int requestCode) {
        String url = ctx.getString(R.string.launchUrl) + (query == null || query.isEmpty() ? "" : "&" + query);
        Intent i = new Intent(ctx, MainActivity.class).setAction(Intent.ACTION_VIEW).setData(Uri.parse(url));
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, requestCode, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
