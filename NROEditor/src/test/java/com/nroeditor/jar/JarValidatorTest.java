package com.nroeditor.jar;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class JarValidatorTest {

    private final JarValidator validator = new JarValidator();

    @Test
    void testNonExistentPathDoesNotCrash() {
        Path nonExistent = Path.of("non_existent_directory/non_existent_file.jar");
        JarValidationResult result = validator.validate(nonExistent);

        assertNotNull(result);
        assertFalse(result.isExists());
        assertFalse(result.isValidJar());
    }

    @Test
    void testInvalidJarFileReturnsValidJarFalse(@TempDir Path tempDir) throws IOException {
        Path fakeJar = tempDir.resolve("not_a_jar.jar");
        Files.writeString(fakeJar, "This is plain text, not a valid zip/jar file.");

        JarValidationResult result = validator.validate(fakeJar);

        assertNotNull(result);
        assertTrue(result.isExists());
        assertTrue(result.isRegularFile());
        assertFalse(result.isValidJar());
    }

    @Test
    void testValidateTargetJarIfPresent() {
        Path targetPath = Path.of("input/NgocRongChay-v1.3.8.jar");
        if (!Files.exists(targetPath) && Files.exists(Path.of("NROEditor/input/NgocRongChay-v1.3.8.jar"))) {
            targetPath = Path.of("NROEditor/input/NgocRongChay-v1.3.8.jar");
        }

        if (Files.exists(targetPath)) {
            JarValidationResult result = validator.validate(targetPath);
            assertNotNull(result);
            assertTrue(result.isExists());
            assertTrue(result.isValidJar());
            assertEquals(2484, result.getTotalEntries());
            assertEquals(301, result.getClassEntries());
            assertEquals(1137, result.getPngEntries());
            assertEquals("Ngọc Rồng", result.getMidletName());
            assertEquals("2.4.8", result.getMidletVersion());
            assertEquals("KKrot", result.getMidletVendor());
            assertEquals("DragonBoy,/icon.png,main.GameMidlet", result.getMidlet1());
            assertEquals("CLDC-1.1", result.getConfiguration());
            assertEquals("MIDP-2.0", result.getProfile());
        } else {
            JarValidationResult result = validator.validate(targetPath);
            assertNotNull(result);
            assertFalse(result.isExists());
            assertFalse(result.isValidJar());
        }
    }
}
