package io.github.susuruchachi.susurulauncher;

// ランチャーの画面：すするanki・航海日誌・すする帳簿のタイル。押すとそのアプリを開く（入っていなければダウンロード）
//  ・アイコンの長押し（shortcuts.xml）：susurulauncher://open?app=… でそのアプリを開く／susurulauncher://home でこの画面
//  ・設定「起動したら、前に開いたアプリをすぐ開く」：アイコンから開いたとき、この画面を出さずに前のアプリへ
// 画面は部品を組み立てて作る（レイアウトのファイルは使わない）

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final int INK = 0xFF131E29, PANEL = 0xFF1D2E3D, BRASS = 0xFFE3C384, PARCHMENT = 0xFFEDE6D2, DIM = 0xFF97A8B5, FAINT = 0xFF5E7180;
    private LinearLayout list;
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        prefs = getSharedPreferences(Apps.PREFS, MODE_PRIVATE);
        build();
        if (saved == null) handle(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handle(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        fill();
        LauncherWidget.updateAll(this); // 入れた・消したアプリを、ウィジェットにも
    }

    // アイコンの長押し・アイコンから開いたとき
    private void handle(Intent intent) {
        Uri d = intent == null ? null : intent.getData();
        if (d != null && "susurulauncher".equals(d.getScheme())) {
            if ("open".equals(d.getHost())) {
                Apps.App a = Apps.byKey(d.getQueryParameter("app"));
                if (a != null && Apps.open(this, a)) moveTaskToBack(true);
            }
            return; // home：この画面
        }
        if (intent != null && Intent.ACTION_MAIN.equals(intent.getAction()) && prefs.getBoolean(Apps.AUTO, false)) {
            Apps.App a = Apps.byKey(prefs.getString(Apps.LAST, ""));
            if (a != null && Apps.installed(this, a) && Apps.open(this, a)) moveTaskToBack(true);
        }
    }

    private int dp(float v) { return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics())); }

    private TextView text(String s, float sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private GradientDrawable round(int color, float r) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(dp(r));
        return g;
    }

    private void build() {
        ScrollView sv = new ScrollView(this);
        sv.setBackgroundColor(INK);
        sv.setFillViewport(true);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(20);
        root.setPadding(pad, dp(16), pad, dp(24));
        sv.addView(root, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        // Android 15 からは画面のはし（状態バー・ナビゲーションバー）の下まで描くので、そのぶん空ける
        sv.setOnApplyWindowInsetsListener((v, ins) -> {
            root.setPadding(pad + ins.getSystemWindowInsetLeft(), dp(16) + ins.getSystemWindowInsetTop(), pad + ins.getSystemWindowInsetRight(), dp(24) + ins.getSystemWindowInsetBottom());
            return ins;
        });

        root.addView(text(new SimpleDateFormat("M月d日（E）", Locale.JAPAN).format(new Date()), 14, DIM, false));
        TextView title = text("どれを開く？", 30, PARCHMENT, true);
        title.setPadding(0, 0, 0, dp(14));
        root.addView(title);

        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        root.addView(list);

        // 設定
        LinearLayout set = new LinearLayout(this);
        set.setOrientation(LinearLayout.VERTICAL);
        set.setPadding(dp(16), dp(14), dp(16), dp(14));
        set.setBackground(round(PANEL, 20));
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        sp.topMargin = dp(10);
        root.addView(set, sp);
        set.addView(text("⚙️ ランチャー", 16, PARCHMENT, true));
        Switch auto = new Switch(this);
        auto.setText("起動したら、前に開いたアプリをすぐ開く");
        auto.setTextColor(PARCHMENT);
        auto.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        auto.setChecked(prefs.getBoolean(Apps.AUTO, false));
        auto.setPadding(0, dp(8), 0, dp(4));
        auto.setOnCheckedChangeListener((b, on) -> prefs.edit().putBoolean(Apps.AUTO, on).apply());
        set.addView(auto);
        TextView hint = text("この画面に戻るときは、アイコンを長押しして「ランチャー」。アイコンの長押しからは、それぞれのアプリもすぐ開けます。ホーム画面のウィジェット「すするアプリ」からも、3つのアプリを直接開けます。\n\n3つのアプリは今まで通り、それぞれ別のアプリです（データ・ウィジェット・アプリの自動更新もそれぞれ）。", 12, DIM, false);
        hint.setPadding(0, dp(6), 0, 0);
        set.addView(hint);

        String ver = "";
        try { ver = getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception ignored) {}
        TextView foot = text("すするアプリ " + ver, 11, FAINT, false);
        foot.setGravity(Gravity.CENTER);
        foot.setPadding(0, dp(16), 0, 0);
        root.addView(foot, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        setContentView(sv);
    }

    // タイル（開くたびに、入っているかを見直す）
    private void fill() {
        list.removeAllViews();
        for (Apps.App a : Apps.ALL) {
            boolean ok = Apps.installed(this, a);
            LinearLayout tile = new LinearLayout(this);
            tile.setOrientation(LinearLayout.HORIZONTAL);
            tile.setGravity(Gravity.CENTER_VERTICAL);
            tile.setPadding(dp(16), dp(14), dp(16), dp(14));
            tile.setBackground(round(PANEL, 20));
            tile.setClickable(true);
            tile.setFocusable(true);
            tile.setOnClickListener((v) -> Apps.open(this, a));

            ImageView ic = new ImageView(this);
            Drawable d = Apps.icon(this, a);
            ic.setImageDrawable(d != null ? d : getDrawable(R.drawable.ic_launcher));
            if (!ok) ic.setAlpha(0.4f);
            tile.addView(ic, new LinearLayout.LayoutParams(dp(56), dp(56)));

            LinearLayout tx = new LinearLayout(this);
            tx.setOrientation(LinearLayout.VERTICAL);
            tx.setPadding(dp(14), 0, dp(8), 0);
            tx.addView(text(a.name, 19, PARCHMENT, true));
            tx.addView(text(a.sub, 12, DIM, false));
            if (!ok) tx.addView(text("まだ入っていません（押すとダウンロード）", 12, BRASS, true));
            tile.addView(tx, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            tile.addView(text(ok ? "›" : "⬇", 22, DIM, false));

            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.bottomMargin = dp(10);
            list.addView(tile, lp);
        }
    }
}
