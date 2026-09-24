package com.masterselects.app;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.view.View;
import android.view.WindowManager;
import android.webkit.*;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.TextView;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.stream.Collectors;

public final class MainActivity extends ComponentActivity {
    private WebView editor;
    private NativeExportWriter exports;
    private EditorFilePicker filePicker;
    private EditorChromeClient chrome;
    private final Set<String> screenLocks = new HashSet<>();

    @SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(20, 20, 20));
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime());
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            return insets;
        });
        setContentView(root);
        try {
            editor = new WebView(this);
            root.addView(editor, new FrameLayout.LayoutParams(-1, -1));
            editor.setBackgroundColor(Color.rgb(20, 20, 20));
            WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
            WebSettings settings = editor.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(true);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            settings.setMediaPlaybackRequiresUserGesture(true);
            settings.setJavaScriptCanOpenWindowsAutomatically(false);
            settings.setSupportMultipleWindows(false);
            settings.setUserAgentString(settings.getUserAgentString() + " MasterSelectsAndroid/" + BuildConfig.VERSION_NAME);
            CookieManager.getInstance().setAcceptCookie(true);
            CookieManager.getInstance().setAcceptThirdPartyCookies(editor, false);

            if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
                    || !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                throw new IllegalStateException("Update Android System WebView to use this editor.");
            }
            BundledEditorAssets assets = new BundledEditorAssets(getAssets());
            exports = new NativeExportWriter(this);
            filePicker = new EditorFilePicker(this);
            chrome = new EditorChromeClient(this, filePicker, new EditorMediaPermissions(this));
            editor.setWebChromeClient(chrome);
            editor.setWebViewClient(new WebViewClient() {
                @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) { return assets.intercept(request); }
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    String url = request.getUrl().toString();
                    if (!request.isForMainFrame()) return false;
                    if (EditorUrlPolicy.isAppOrigin(url) && !request.getUrl().getPath().startsWith("/docs")) return false;
                    openExternal(request.getUrl());
                    return true;
                }
                @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                    exports.cancel();
                    screenLocks.clear();
                    getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
                @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                    if (request.isForMainFrame()) showLoadError();
                }
                @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                    exports.cancel();
                    ((android.view.ViewGroup) view.getParent()).removeView(view);
                    view.destroy();
                    editor = null;
                    new AlertDialog.Builder(MainActivity.this).setTitle("Editor stopped")
                        .setMessage("Android stopped the editor process. Reopen your saved project to continue.")
                        .setCancelable(false).setPositiveButton("Reopen", (dialog, which) -> recreate()).show();
                    return true;
                }
            });
            WebViewCompat.addWebMessageListener(editor, "MasterSelectsNative", Set.of(EditorUrlPolicy.ORIGIN), (view, message, origin, mainFrame, reply) -> {
                if (!mainFrame || !EditorUrlPolicy.isAppOrigin(origin.toString()) || !EditorUrlPolicy.isAppOrigin(view.getUrl())) return;
                String id = "";
                try {
                    String data = message.getData();
                    if (data == null || data.length() > 360000) return;
                    JSONObject request = new JSONObject(data);
                    id = request.getString("id");
                    if (!id.matches("[a-zA-Z0-9-]{1,80}")) return;
                    String operation = request.getString("op");
                    if ("screenLock".equals(operation)) {
                        String lease = request.getString("lease");
                        if (!lease.matches("[a-zA-Z0-9-]{1,80}") || screenLocks.size() > 32) throw new IllegalArgumentException();
                        if (request.getBoolean("active")) screenLocks.add(lease); else screenLocks.remove(lease);
                        if (screenLocks.isEmpty()) getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                        else getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                        exports.reply(reply, id, null);
                    } else if ("signInLink".equals(operation)) {
                        openSignInLinkDialog();
                        exports.reply(reply, id, null);
                    } else exports.message(request, reply);
                } catch (Exception error) { exports.reply(reply, id, "Android could not complete this request."); }
            });
            String bridge;
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(getAssets().open("android-bridge.js"), StandardCharsets.UTF_8))) {
                bridge = reader.lines().collect(Collectors.joining("\n"))
                    .replace("__MASTERSELECTS_ANDROID_SDK__", Integer.toString(android.os.Build.VERSION.SDK_INT));
            }
            WebViewCompat.addDocumentStartJavaScript(editor, bridge, Set.of(EditorUrlPolicy.ORIGIN));
            editor.setDownloadListener(this::downloadUrl);
            getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
                @Override public void handleOnBackPressed() {
                    if (chrome.exitFullscreen()) return;
                    if (editor != null && editor.canGoBack()) { editor.goBack(); return; }
                    new AlertDialog.Builder(MainActivity.this).setTitle("Leave editor?")
                        .setMessage("Save your project before leaving. Exports need the app to stay open.")
                        .setNegativeButton("Keep editing", null).setPositiveButton("Leave", (dialog, which) -> finish()).show();
                }
            });
            // Project restoration belongs to the editor's durable project store, not a WebView history snapshot.
            editor.loadUrl(EditorUrlPolicy.launchUrl(getIntent().getDataString()));
        } catch (Exception error) {
            root.removeAllViews();
            TextView message = new TextView(this);
            message.setText("MasterSelects could not start. Update Android System WebView and reopen the app.\n\n" + error.getMessage());
            message.setTextColor(Color.WHITE);
            message.setPadding(32, 32, 32, 32);
            root.addView(message);
        }
    }
    private void showLoadError() {
        new AlertDialog.Builder(this).setTitle("Could not open this page")
            .setMessage("Cloud services and sign-in need internet access. Your local editor and saved projects remain available.")
            .setPositiveButton("Back to editor", (dialog, which) -> { if (editor != null) editor.loadUrl(EditorUrlPolicy.START_URL); }).show();
    }
    private void openExternal(Uri uri) {
        if ("accounts.google.com".equals(uri.getHost())) {
            new AlertDialog.Builder(this).setTitle("Sign in by email")
                .setMessage("Use Send link in the app's sign-in dialog. Open the email link with MasterSelects, or copy it and choose Open email sign-in link in the app.")
                .setPositiveButton("OK", null).show();
            return;
        }
        if (!"https".equals(uri.getScheme()) && !"mailto".equals(uri.getScheme())) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (RuntimeException ignored) {}
    }
    private void openSignInLinkDialog() {
        EditText input = new EditText(this);
        input.setHint("Paste the sign-in link from your email");
        input.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        new AlertDialog.Builder(this).setTitle("Open email sign-in link").setView(input)
            .setNegativeButton("Cancel", null).setPositiveButton("Sign in", (dialog, which) -> {
                String url = input.getText().toString().trim();
                Uri parsed = Uri.parse(url);
                if (EditorUrlPolicy.isAppOrigin(url) && "/api/auth/callback".equals(parsed.getPath())
                        && parsed.getQueryParameter("state") != null && parsed.getQueryParameter("token") != null) editor.loadUrl(url);
                else new AlertDialog.Builder(this).setMessage("Use the original MasterSelects sign-in link from your email.").setPositiveButton("OK", null).show();
            }).show();
    }
    private void downloadUrl(String url, String userAgent, String disposition, String mime, long length) {
        Uri uri = Uri.parse(url);
        if (!"https".equals(uri.getScheme())) return;
        String filename = URLUtil.guessFileName(url, disposition, mime);
        new AlertDialog.Builder(this).setTitle("Download file?").setMessage(filename)
            .setNegativeButton("Cancel", null).setPositiveButton("Download", (dialog, which) -> {
                try {
                    DownloadManager.Request request = new DownloadManager.Request(uri).setTitle(filename)
                        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                        .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);
                    if (EditorUrlPolicy.isAppOrigin(url)) {
                        String cookie = CookieManager.getInstance().getCookie(url);
                        if (cookie != null) request.addRequestHeader("Cookie", cookie);
                    }
                    request.addRequestHeader("User-Agent", userAgent);
                    ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(request);
                } catch (RuntimeException error) { new AlertDialog.Builder(this).setMessage("Download could not be started.").setPositiveButton("OK", null).show(); }
            }).show();
    }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String destination = EditorUrlPolicy.launchUrl(intent.getDataString());
        if (editor != null && intent.getDataString() != null && destination.contains("/api/auth/callback")) {
            new AlertDialog.Builder(this).setTitle("Complete email sign-in?")
                .setMessage("Continue with the account from this email link. Save your project before continuing.")
                .setNegativeButton("Cancel", null).setPositiveButton("Continue", (dialog, which) -> editor.loadUrl(destination)).show();
        }
    }
    @Override protected void onPause() {
        CookieManager.getInstance().flush();
        super.onPause();
    }
    @Override protected void onDestroy() {
        if (exports != null) exports.destroy();
        if (filePicker != null) filePicker.cancel();
        if (editor != null) { editor.stopLoading(); editor.destroy(); editor = null; }
        super.onDestroy();
    }
}
