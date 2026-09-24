package com.masterselects.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import androidx.activity.ComponentActivity;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import java.util.ArrayList;

final class EditorFilePicker {
    private ValueCallback<Uri[]> callback;
    private final ActivityResultLauncher<Intent> launcher;
    EditorFilePicker(ComponentActivity activity) {
        launcher = activity.registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            ValueCallback<Uri[]> pending = callback;
            callback = null;
            if (pending == null) return;
            Intent data = result.getData();
            if (result.getResultCode() != Activity.RESULT_OK || data == null) { pending.onReceiveValue(null); return; }
            ArrayList<Uri> uris = new ArrayList<>();
            if (data.getClipData() != null) {
                for (int i = 0; i < data.getClipData().getItemCount(); i++) uris.add(data.getClipData().getItemAt(i).getUri());
            } else if (data.getData() != null) uris.add(data.getData());
            uris.removeIf(uri -> !"content".equals(uri.getScheme()));
            for (Uri uri : uris) {
                try {
                    activity.getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                } catch (SecurityException ignored) { /* Some providers grant session access only. */ }
            }
            pending.onReceiveValue(uris.isEmpty() ? null : uris.toArray(new Uri[0]));
        });
    }
    boolean open(ValueCallback<Uri[]> next, WebChromeClient.FileChooserParams params) {
        if (callback != null) callback.onReceiveValue(null);
        callback = next;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*").putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        String[] types = java.util.Arrays.stream(params.getAcceptTypes()).filter(type -> type.contains("/")).toArray(String[]::new);
        if (types.length == 1) intent.setType(types[0]);
        else if (types.length > 1) intent.putExtra(Intent.EXTRA_MIME_TYPES, types);
        try { launcher.launch(intent); } catch (RuntimeException error) { callback = null; next.onReceiveValue(null); }
        return true;
    }
    void cancel() { if (callback != null) { callback.onReceiveValue(null); callback = null; } }
}
