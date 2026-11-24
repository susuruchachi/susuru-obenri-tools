package io.github.susuruchachi.susurulauncher;

// 開くアプリの一覧（すするanki・航海日誌・すする帳簿）と、開く・アイコンを取る
// 3つのアプリはそれぞれ別の Android アプリのまま。入っていなければ、その APK をダウンロードするページを開く

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.net.Uri;

final class Apps {
    static final class App {
        final String key, pkg, name, sub, apk;
        App(String key, String pkg, String name, String sub, String apk) { this.key = key; this.pkg = pkg; this.name = name; this.sub = sub; this.apk = apk; }
    }

    static final App[] ALL = {
        new App("anki", "io.github.susuruchachi.susuruanki", "すするanki", "暗記・連続記録・週間プラン",
            "https://susuruchachi.github.io/-anki0.02.03.000-0-c/apk/susuruanki.apk"),
        new App("koukai", "io.github.susuruchachi.koukainisshi", "航海日誌", "予定・できた事日記",
            "https://koukai-nisshi-calendar.vercel.app/apk/koukai-nisshi.apk"),
        new App("kashikari", "io.github.susuruchachi.kashikari", "すする帳簿", "貸し借り帳・家計簿",
            "https://susuruchachi.github.io/susuru-obenri-tools/apk/kashikari.apk"),
    };

    static final String PREFS = "launcher";
    static final String LAST = "last";
    static final String AUTO = "autoOpenLast";

    static App byKey(String key) {
        for (App a : ALL) if (a.key.equals(key)) return a;
        return null;
    }

    static Intent launchIntent(Context c, App a) {
        Intent i = c.getPackageManager().getLaunchIntentForPackage(a.pkg);
        if (i != null) i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return i;
    }

    static boolean installed(Context c, App a) { return launchIntent(c, a) != null; }

    static Drawable icon(Context c, App a) {
        try { return c.getPackageManager().getApplicationIcon(a.pkg); } catch (PackageManager.NameNotFoundException e) { return null; }
    }

    static Bitmap bitmap(Drawable d, int px) {
        Bitmap b = Bitmap.createBitmap(px, px, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(b);
        d.setBounds(0, 0, px, px);
        d.draw(cv);
        return b;
    }

    // 開く（入っていなければ APK のダウンロード）。開いたら「前に開いたアプリ」として覚える
    static boolean open(Context c, App a) {
        Intent i = launchIntent(c, a);
        try {
            if (i != null) {
                c.startActivity(i);
                c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(LAST, a.key).apply();
                return true;
            }
            c.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(a.apk)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (ActivityNotFoundException ignored) {}
        return false;
    }
}
