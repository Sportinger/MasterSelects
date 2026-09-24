package com.masterselects.app;

import android.content.res.AssetManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/** Serve the pinned editor locally; only API calls and external assets use the network. */
final class BundledEditorAssets {
    private final AssetManager assets;
    private final JSONObject files;
    BundledEditorAssets(AssetManager assets) throws Exception {
        this.assets = assets;
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(assets.open("editor-files.json"), StandardCharsets.UTF_8))) {
            files = new JSONObject(reader.lines().collect(java.util.stream.Collectors.joining("\n")));
        }
    }
    WebResourceResponse intercept(WebResourceRequest request) {
        if (!EditorUrlPolicy.isAppOrigin(request.getUrl().toString())) return null;
        String path = request.getUrl().getPath();
        if (!EditorUrlPolicy.isSafePath(path)) return missing();
        if (path.startsWith("/api/") || path.startsWith("/.well-known/")) return null;
        if (!"GET".equals(request.getMethod()) && !"HEAD".equals(request.getMethod())) return missing();
        String file = EditorUrlPolicy.isEntry(path) ? "index.html" : path.substring(1);
        JSONObject entry = files.optJSONObject(file);
        if (entry == null) return missing();
        try {
            Map<String, String> headers = new HashMap<>();
            headers.put("Cross-Origin-Opener-Policy", "same-origin");
            headers.put("Cross-Origin-Embedder-Policy", "credentialless");
            headers.put("Cross-Origin-Resource-Policy", "same-origin");
            headers.put("X-Content-Type-Options", "nosniff");
            headers.put("Cache-Control", "no-store");
            headers.put("Content-Length", Long.toString(entry.getLong("size")));
            InputStream input = "HEAD".equals(request.getMethod()) ? new ByteArrayInputStream(new byte[0]) : assets.open("editor/" + entry.getString("asset"));
            return new WebResourceResponse(entry.getString("mime"), null, 200, "OK", headers, input);
        } catch (Exception error) { return missing(); }
    }
    private static WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Map.of("Cache-Control", "no-store"),
            new ByteArrayInputStream("This resource is not included in this app version.".getBytes(StandardCharsets.UTF_8)));
    }
}
