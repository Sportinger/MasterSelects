package com.masterselects.app;

import android.Manifest;
import android.webkit.PermissionRequest;
import androidx.activity.ComponentActivity;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import java.util.ArrayList;

final class EditorMediaPermissions {
    private PermissionRequest pending;
    private final ActivityResultLauncher<String[]> launcher;
    EditorMediaPermissions(ComponentActivity activity) {
        launcher = activity.registerForActivityResult(new ActivityResultContracts.RequestMultiplePermissions(), grants -> {
            PermissionRequest request = pending;
            pending = null;
            if (request == null) return;
            ArrayList<String> allowed = new ArrayList<>();
            for (String resource : request.getResources()) {
                String permission = permission(resource);
                if (permission != null && Boolean.TRUE.equals(grants.get(permission))) allowed.add(resource);
            }
            if (allowed.isEmpty()) request.deny(); else request.grant(allowed.toArray(new String[0]));
        });
    }
    void request(PermissionRequest request) {
        if (!EditorUrlPolicy.isAppOrigin(request.getOrigin().toString()) || pending != null) { request.deny(); return; }
        ArrayList<String> permissions = new ArrayList<>();
        for (String resource : request.getResources()) {
            String permission = permission(resource);
            if (permission != null) permissions.add(permission);
        }
        if (permissions.isEmpty()) { request.deny(); return; }
        pending = request;
        launcher.launch(permissions.toArray(new String[0]));
    }
    void cancel(PermissionRequest request) { if (pending == request) pending = null; }
    private static String permission(String resource) {
        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) return Manifest.permission.CAMERA;
        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) return Manifest.permission.RECORD_AUDIO;
        return null;
    }
}
