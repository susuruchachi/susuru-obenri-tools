package io.github.susuruchachi.kashikari;

// ウィジェットが組み立てられるかのテスト（Robolectric：Android の本物の部品の組み立てを PC で動かす）
// 実行：cd android && gradle testReleaseUnitTest
// ウィジェット（RemoteViews）で使えない部品がレイアウトに入っていると、ここで失敗する（端末では「何も出ない」になる）

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.robolectric.Shadows.shadowOf;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.RemoteViews;
import android.widget.TextView;

import androidx.test.core.app.ApplicationProvider;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class WidgetTest {
    private final Context ctx = ApplicationProvider.getApplicationContext();

    private static String text(View root, int id) {
        TextView t = root.findViewById(id);
        assertNotNull(t);
        return t.getText().toString();
    }

    @Test
    public void layoutInflatesAsRemoteViews() {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_kashikari);
        View root = v.apply(ctx, new FrameLayout(ctx));
        assertNotNull(root);
    }

    @Test
    public void showsPlaceholderBeforeData() {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int id = shadowOf(mgr).createWidget(KashikariWidget.class, R.layout.widget_kashikari);
        View root = shadowOf(mgr).getViewFor(id);
        assertTrue(text(root, R.id.w_lines).contains("アプリを開く"));
    }

    @Test
    public void showsTotalsLinesClaimsAndMonth() {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int id = shadowOf(mgr).createWidget(KashikariWidget.class, R.layout.widget_kashikari);
        WidgetData.save(ctx, "{\"signedIn\":true,\"inSum\":5000,\"outSum\":1200,"
            + "\"lines\":[{\"n\":\"弟\",\"d\":\"in\",\"a\":3000},{\"n\":\"📒 みか\",\"d\":\"out\",\"a\":1200}],"
            + "\"claims\":2,\"kb\":{\"m\":11,\"exp\":2300,\"inc\":30000,\"budget\":20000},\"at\":1795428006209}");
        View root = shadowOf(mgr).getViewFor(id);
        assertEquals("¥5,000", text(root, R.id.w_in));
        assertEquals("¥1,200", text(root, R.id.w_out));
        assertTrue(text(root, R.id.w_lines).contains("弟 → あなた"));
        assertTrue(text(root, R.id.w_claims).contains("2件"));
        assertEquals(View.VISIBLE, root.findViewById(R.id.w_claims).getVisibility());
        assertTrue(text(root, R.id.w_month).contains("11月の支出 ¥2,300"));
        assertTrue(text(root, R.id.w_month).contains("予算あと ¥17,700"));
    }

    @Test
    public void signedOut() {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int id = shadowOf(mgr).createWidget(KashikariWidget.class, R.layout.widget_kashikari);
        WidgetData.save(ctx, "{\"signedIn\":false}");
        View root = shadowOf(mgr).getViewFor(id);
        assertTrue(text(root, R.id.w_lines).contains("ログイン"));
        assertEquals(View.GONE, root.findViewById(R.id.w_month).getVisibility());
    }
}
