import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.zip.ZipFile;

/** JDK-only final-package check: AAPT must preserve every offline asset byte. */
public final class VerifyBundle {
    public static void main(String[] args) throws Exception {
        Path source = Path.of(args[1]);
        String prefix = args.length > 2 ? args[2] : "assets/";
        int count = 0;
        try (ZipFile archive = new ZipFile(args[0]); var paths = Files.walk(source)) {
            for (Path file : paths.filter(Files::isRegularFile).toList()) {
                String name = prefix + source.relativize(file).toString().replace('\\', '/');
                var entry = archive.getEntry(name);
                if (entry == null || entry.getSize() != Files.size(file)) {
                    throw new IllegalStateException("Missing or modified packaged asset: " + name);
                }
                try (InputStream original = Files.newInputStream(file); InputStream packaged = archive.getInputStream(entry)) {
                    if (!Arrays.equals(digest(original), digest(packaged))) {
                        throw new IllegalStateException("Packaged asset checksum mismatch: " + name);
                    }
                }
                count++;
            }
        }
        if (count < 3) throw new IllegalStateException("Editor assets were not prepared");
        System.out.println("Verified " + count + " packaged assets byte-for-byte against the prepared editor.");
    }
    private static byte[] digest(InputStream stream) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[65536];
        int read;
        while ((read = stream.read(buffer)) != -1) digest.update(buffer, 0, read);
        return digest.digest();
    }
}
