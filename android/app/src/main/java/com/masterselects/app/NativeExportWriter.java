package com.masterselects.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;
import androidx.activity.ComponentActivity;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.webkit.JavaScriptReplyProxy;
import org.json.JSONObject;
import java.io.OutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/** Acknowledged, bounded chunks avoid making a second full-size Base64 copy of an export. */
final class NativeExportWriter {
    private final ComponentActivity activity;
    private final ActivityResultLauncher<Intent> picker;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private volatile Transfer transfer;
    private final AtomicInteger queuedWrites = new AtomicInteger(0);
    private static final class Transfer {
        String token, mime, name, beginId;
        long size, written;
        int sequence;
        Uri uri;
        OutputStream stream;
        JavaScriptReplyProxy reply;
    }
    NativeExportWriter(ComponentActivity activity) {
        this.activity = activity;
        picker = activity.registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            Transfer job = transfer;
            if (job == null) return;
            if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
                transfer = null;
                reply(job.reply, job.beginId, "Save cancelled");
                return;
            }
            job.uri = result.getData().getData();
            if (!"content".equals(job.uri.getScheme())) { transfer = null; reply(job.reply, job.beginId, "Invalid file destination"); return; }
            io.execute(() -> {
                try {
                    if (transfer != job) return;
                    job.stream = activity.getContentResolver().openOutputStream(job.uri, "w");
                    if (job.stream == null) throw new IllegalStateException("Could not open destination");
                    reply(job.reply, job.beginId, null);
                } catch (Exception error) { fail(job, job.beginId, "Could not open destination"); }
            });
        });
    }
    void message(JSONObject message, JavaScriptReplyProxy reply) throws Exception {
        String op = message.getString("op");
        String id = message.getString("id");
        String token = message.getString("token");
        if (token.length() > 80) throw new IllegalArgumentException("Invalid transfer");
        if ("begin".equals(op)) {
            if (transfer != null) { reply(reply, id, "Another export is being saved"); return; }
            Transfer job = new Transfer();
            job.token = token;
            job.size = message.getLong("size");
            if (job.size < 0 || job.size > 9_007_199_254_740_991L) throw new IllegalArgumentException("Invalid size");
            job.name = message.optString("name", "export").replaceAll("[\\\\/\\p{Cntrl}]", "_");
            job.name = job.name.substring(0, Math.min(job.name.length(), 180));
            if (job.name.isBlank()) job.name = "export";
            job.mime = message.optString("mime", "application/octet-stream");
            if (!job.mime.matches("[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+")) job.mime = "application/octet-stream";
            job.reply = reply;
            job.beginId = id;
            transfer = job;
            try {
                picker.launch(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(job.mime).putExtra(Intent.EXTRA_TITLE, job.name));
            } catch (RuntimeException error) { transfer = null; reply(reply, id, "No file picker is available"); }
            return;
        }
        Transfer job = transfer;
        if (job == null || !job.token.equals(token)) { reply(reply, id, "Export is no longer active"); return; }
        if (queuedWrites.incrementAndGet() > 2) {
            queuedWrites.decrementAndGet();
            reply(reply, id, "Wait for the previous export chunk");
            return;
        }
        io.execute(() -> {
            try {
                if (transfer != job) { reply(reply, id, "Export cancelled"); return; }
                if ("abort".equals(op)) { fail(job, id, "Save cancelled"); return; }
                if (job.stream == null) throw new IllegalStateException("Choose a destination first");
                if ("chunk".equals(op)) {
                    String data = message.getString("data");
                    if (data.length() > 350000 || message.getInt("sequence") != job.sequence) throw new IllegalArgumentException("Invalid chunk");
                    byte[] bytes = Base64.decode(data, Base64.NO_WRAP);
                    if (bytes.length > 262144 || job.written + bytes.length > job.size) throw new IllegalArgumentException("Invalid size");
                    job.stream.write(bytes);
                    job.written += bytes.length;
                    job.sequence++;
                    reply(reply, id, null);
                } else if ("finish".equals(op)) {
                    if (job.written != job.size) throw new IllegalStateException("Incomplete export");
                    job.stream.close();
                    job.stream = null;
                    transfer = null;
                    reply(reply, id, null);
                    activity.runOnUiThread(() -> new AlertDialog.Builder(activity).setTitle("Export saved")
                        .setMessage(job.name).setPositiveButton("Done", null).setNeutralButton("Share", (dialog, which) -> {
                            Intent share = new Intent(Intent.ACTION_SEND).setType(job.mime).putExtra(Intent.EXTRA_STREAM, job.uri)
                                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            try { activity.startActivity(Intent.createChooser(share, "Share export")); } catch (RuntimeException ignored) {}
                        }).show());
                } else throw new IllegalArgumentException("Unknown export operation");
            } catch (Exception error) { fail(job, id, "Could not save the complete export. Check available space and try again."); }
            finally { queuedWrites.decrementAndGet(); }
        });
    }
    private void fail(Transfer job, String id, String error) {
        if (transfer == job) transfer = null;
        try { if (job.stream != null) job.stream.close(); } catch (Exception ignored) {}
        try { if (job.uri != null) DocumentsContract.deleteDocument(activity.getContentResolver(), job.uri); } catch (Exception ignored) {}
        reply(job.reply, id, error);
    }
    void cancel() {
        Transfer job = transfer;
        transfer = null;
        if (job != null) io.execute(() -> fail(job, job.beginId, "Save cancelled"));
    }
    void destroy() { cancel(); io.shutdown(); }
    void reply(JavaScriptReplyProxy proxy, String id, String error) {
        activity.runOnUiThread(() -> {
            try { proxy.postMessage(new JSONObject().put("id", id).put("error", error == null ? JSONObject.NULL : error).toString()); }
            catch (Exception ignored) { /* The originating page may have closed. */ }
        });
    }
}
