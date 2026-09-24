package com.masterselects.app;
import org.junit.Test;
import static org.junit.Assert.*;

public class EditorUrlPolicyTest {
    @Test public void preservesEditorAndSignInLinks() {
        String url = "https://www.masterselects.com/editor?source=android#timeline";
        assertEquals(url, EditorUrlPolicy.launchUrl(url));
        String callback = "https://www.masterselects.com/api/auth/callback?state=test&token=signed";
        assertEquals(callback, EditorUrlPolicy.launchUrl(callback));
    }
    @Test public void rejectsOtherOriginsCredentialsAndUnexpectedPaths() {
        String[] candidates = {null, "", "javascript:alert(1)", "http://www.masterselects.com/editor",
            "https://www.masterselects.com.evil.test/editor", "https://evil.test/editor",
            "https://evil@www.masterselects.com/editor", "https://www.masterselects.com:8443/editor",
            "https://www.masterselects.com/api/me", "https://www.masterselects.com/editor-evil",
            "https://www.masterselects.com/editor/../api/"};
        for (String candidate : candidates) assertEquals(EditorUrlPolicy.START_URL, EditorUrlPolicy.launchUrl(candidate));
    }
    @Test public void rejectsDecodedTraversalPaths() {
        for (String path : new String[]{"/../secret", "/assets/../../secret", "/assets\\secret", "//secret", "/assets/\0"}) {
            assertFalse(EditorUrlPolicy.isSafePath(path));
        }
        assertTrue(EditorUrlPolicy.isSafePath("/assets/editor.js"));
    }
}
