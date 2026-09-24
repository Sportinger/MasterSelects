package com.masterselects.app;

import android.content.Intent;
import android.webkit.WebChromeClient;
import org.junit.Test;
import static org.junit.Assert.*;

/** Run on Android: Intent behavior and the WebView chooser contract need the framework. */
public final class EditorFilePickerTest {
    @Test
    public void testApplicationOptsIntoAndroid17FileSystemAccess() {
        int target = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
            .getTargetContext().getApplicationInfo().targetSdkVersion;
        assertTrue("WebView cancels directory requests below target SDK 37", target >= 37);
    }
    @Test
    public void testProjectDirectoryUsesUnfilteredTreePicker() {
        Intent result = EditorFilePicker.createPickerIntent(params(2, new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)));
        assertEquals(Intent.ACTION_OPEN_DOCUMENT_TREE, result.getAction());
        assertNull(result.getType());
        assertNull(result.getCategories());
        assertNull(result.getExtras());
    }

    @Test
    public void testWritableFileRetainsDocumentActionAndGrants() {
        Intent request = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("application/json")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        Intent result = EditorFilePicker.createPickerIntent(params(0, request));
        assertEquals(Intent.ACTION_OPEN_DOCUMENT, result.getAction());
        assertEquals(request.getFlags(), result.getFlags());
        assertEquals("application/json", result.getType());
    }

    @Test
    public void testSaveCreatesDocumentInsteadOfSelectingAnExistingFile() {
        Intent result = EditorFilePicker.createPickerIntent(params(3,
            new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("video/mp4")));
        assertEquals(Intent.ACTION_CREATE_DOCUMENT, result.getAction());
        assertEquals("export.mp4", result.getStringExtra(Intent.EXTRA_TITLE));
    }

    @Test
    public void testMultipleImportPreservesMimeFilters() {
        Intent request = new Intent(Intent.ACTION_GET_CONTENT).setType("video/*")
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            .putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"video/mp4", "video/webm"});
        Intent result = EditorFilePicker.createPickerIntent(params(1, request));
        assertEquals(Intent.ACTION_GET_CONTENT, result.getAction());
        assertTrue(result.getBooleanExtra(Intent.EXTRA_ALLOW_MULTIPLE, false));
        assertEquals("video/webm", result.getStringArrayExtra(Intent.EXTRA_MIME_TYPES)[1]);
    }

    private static WebChromeClient.FileChooserParams params(int mode, Intent platformIntent) {
        return new WebChromeClient.FileChooserParams() {
            @Override public int getMode() { return mode; }
            @Override public String[] getAcceptTypes() { return new String[]{"video/mp4"}; }
            @Override public boolean isCaptureEnabled() { return false; }
            @Override public CharSequence getTitle() { return "Select"; }
            @Override public String getFilenameHint() { return "export.mp4"; }
            @Override public Intent createIntent() { return platformIntent; }
        };
    }
}
