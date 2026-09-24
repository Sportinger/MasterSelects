package com.masterselects.app;

import android.app.AlertDialog;
import android.net.Uri;
import android.view.View;
import android.webkit.*;
import android.widget.EditText;
import android.widget.FrameLayout;

final class EditorChromeClient extends WebChromeClient {
    private final MainActivity activity;
    private final EditorFilePicker picker;
    private final EditorMediaPermissions permissions;
    private View fullscreen;
    private CustomViewCallback fullscreenCallback;
    EditorChromeClient(MainActivity activity, EditorFilePicker picker, EditorMediaPermissions permissions) {
        this.activity = activity;
        this.picker = picker;
        this.permissions = permissions;
    }
    @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
        if (!EditorUrlPolicy.isAppOrigin(view.getUrl())) { callback.onReceiveValue(null); return true; }
        return picker.open(callback, params);
    }
    @Override public void onPermissionRequest(PermissionRequest request) { permissions.request(request); }
    @Override public void onPermissionRequestCanceled(PermissionRequest request) { permissions.cancel(request); }
    @Override public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
        new AlertDialog.Builder(activity).setMessage(message).setPositiveButton("OK", (dialog, which) -> result.confirm())
            .setOnCancelListener(dialog -> result.cancel()).show();
        return true;
    }
    @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
        new AlertDialog.Builder(activity).setMessage(message).setPositiveButton("OK", (dialog, which) -> result.confirm())
            .setNegativeButton("Cancel", (dialog, which) -> result.cancel()).setOnCancelListener(dialog -> result.cancel()).show();
        return true;
    }
    @Override public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, JsPromptResult result) {
        EditText input = new EditText(activity);
        input.setText(defaultValue);
        new AlertDialog.Builder(activity).setMessage(message).setView(input)
            .setPositiveButton("OK", (dialog, which) -> result.confirm(input.getText().toString()))
            .setNegativeButton("Cancel", (dialog, which) -> result.cancel()).setOnCancelListener(dialog -> result.cancel()).show();
        return true;
    }
    @Override public void onShowCustomView(View view, CustomViewCallback callback) {
        if (fullscreen != null) { callback.onCustomViewHidden(); return; }
        fullscreen = view;
        fullscreenCallback = callback;
        activity.addContentView(view, new FrameLayout.LayoutParams(-1, -1));
    }
    @Override public void onHideCustomView() {
        if (fullscreen == null) return;
        ((android.view.ViewGroup) fullscreen.getParent()).removeView(fullscreen);
        fullscreen = null;
        fullscreenCallback.onCustomViewHidden();
        fullscreenCallback = null;
    }
    boolean exitFullscreen() {
        if (fullscreen == null) return false;
        onHideCustomView();
        return true;
    }
}
