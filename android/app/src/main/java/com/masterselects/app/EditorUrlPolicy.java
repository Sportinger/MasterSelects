package com.masterselects.app;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Set;

final class EditorUrlPolicy {
    static final String ORIGIN = "https://www.masterselects.com";
    static final String START_URL = ORIGIN + "/editor";
    private static final Set<String> ENTRIES = Set.of("/", "/index.html", "/editor", "/medium", "/chat",
        "/landing", "/imprint", "/privacy", "/terms", "/withdrawal", "/cancel",
        "/impressum", "/datenschutz", "/agb", "/widerruf", "/kuendigen", "/credits/claim", "/claim");

    static boolean isAppOrigin(String candidate) {
        try {
            URI uri = new URI(candidate);
            return "https".equalsIgnoreCase(uri.getScheme())
                && "www.masterselects.com".equalsIgnoreCase(uri.getHost())
                && uri.getRawUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443);
        } catch (URISyntaxException | NullPointerException error) { return false; }
    }
    static boolean isEntry(String path) {
        return ENTRIES.contains(path.endsWith("/") && path.length() > 1 ? path.substring(0, path.length() - 1) : path);
    }
    static boolean isSafePath(String path) {
        return path != null && path.startsWith("/") && !path.contains("\\") && !path.contains("\0")
            && !path.contains("//") && !java.util.Arrays.asList(path.split("/")).contains("..");
    }
    static String launchUrl(String candidate) {
        if (!isAppOrigin(candidate)) return START_URL;
        try {
            URI uri = new URI(candidate);
            String path = uri.getPath();
            if (!isSafePath(path)) return START_URL;
            if (isEntry(path) || "/api/auth/callback".equals(path)) return uri.toASCIIString();
        } catch (URISyntaxException error) { /* default entry */ }
        return START_URL;
    }
    private EditorUrlPolicy() {}
}
