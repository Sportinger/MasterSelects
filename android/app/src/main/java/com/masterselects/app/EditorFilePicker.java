package com.masterselects.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import androidx.activity.ComponentActivity;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import java.util.ArrayList;

final class EditorFilePicker {
    private ValueCallback<Uri[]> callback;
    private boolean selectingFolder;
    private final ActivityResultLauncher<Intent> launcher;
    EditorFilePicker(ComponentActivity activity) {
        launcher = activity.registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            ValueCallback<Uri[]> pending = callback;
            boolean folder = selectingFolder;
            callback = null;
            selectingFolder = false;
            if (pending == null) return;
            Intent data = result.getData();
            if (result.getResultCode() != Activity.RESULT_OK || data == null) { pending.onReceiveValue(null); return; }
            ArrayList<Uri> uris = new ArrayList<>();
            if (data.getClipData() != null) {
                for (int i = 0; i < data.getClipData().getItemCount(); i++) uris.add(data.getClipData().getItemAt(i).getUri());
            } else if (data.getData() != null) uris.add(data.getData());
            uris.removeIf(uri -> uri == null || !"content".equals(uri.getScheme())
                || (folder && !DocumentsContract.isTreeUri(uri)));
            for (Uri uri : uris) {
                try {
                    if ((data.getFlags() & Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION) == 0) continue;
                    boolean read = (data.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0;
                    boolean write = (data.getFlags() & Intent.FLAG_GRANT_WRITE_URI_PERMISSION) != 0;
                    if (read && write) activity.getContentResolver().takePersistableUriPermission(uri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    else if (read) activity.getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    else if (write) activity.getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                } catch (SecurityException ignored) { /* Some providers grant session access only. */ }
            }
            pending.onReceiveValue(uris.isEmpty() ? null : uris.toArray(new Uri[0]));
        });
    }
    boolean open(ValueCallback<Uri[]> next, WebChromeClient.FileChooserParams params) {
        if (callback != null) { next.onReceiveValue(null); return true; }
        callback = next;
        try {
            Intent intent = createPickerIntent(params);
            selectingFolder = Intent.ACTION_OPEN_DOCUMENT_TREE.equals(intent.getAction());
            launcher.launch(intent);
        } catch (RuntimeException error) { callback = null; selectingFolder = false; next.onReceiveValue(null); }
        return true;
    }
    static Intent createPickerIntent(WebChromeClient.FileChooserParams params) {
        // WebView knows whether this is a file import, writable file, Save As,
        // or File System Access directory request. Never replace its intent
        // with a generic file picker: that loses folder mode and write access.
        Intent intent = params.createIntent();
        if (Intent.ACTION_CREATE_DOCUMENT.equals(intent.getAction()) && params.getFilenameHint() != null) {
            intent.putExtra(Intent.EXTRA_TITLE, params.getFilenameHint());
        }
        return intent;
    }
    void cancel() { if (callback != null) { callback.onReceiveValue(null); callback = null; } selectingFolder = false; }
}
