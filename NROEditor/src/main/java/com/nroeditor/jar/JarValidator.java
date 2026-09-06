package com.nroeditor.jar;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Enumeration;
import java.util.jar.Attributes;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;
import java.util.jar.Manifest;
import java.util.zip.ZipFile;

public class JarValidator {

    public JarValidationResult validate(Path jarPath) {
        if (jarPath == null) {
            return JarValidationResult.notFound(null);
        }

        if (!Files.exists(jarPath)) {
            return JarValidationResult.notFound(jarPath);
        }

        boolean regularFile = Files.isRegularFile(jarPath);
        boolean readable = Files.isReadable(jarPath);

        if (!regularFile) {
            return JarValidationResult.invalidFile(jarPath, false, readable, "Path is not a regular file");
        }

        if (!readable) {
            return JarValidationResult.invalidFile(jarPath, true, false, "File is not readable");
        }

        long fileSize;
        try {
            fileSize = Files.size(jarPath);
        } catch (IOException e) {
            return JarValidationResult.invalidFile(jarPath, true, true, "Could not determine file size: " + e.getMessage());
        }

        // Open strictly in read-only mode using standard Java JarFile
        try (JarFile jarFile = new JarFile(jarPath.toFile(), false, ZipFile.OPEN_READ)) {
            int totalEntries = 0;
            int classEntries = 0;
            int pngEntries = 0;

            Enumeration<JarEntry> entries = jarFile.entries();
            while (entries.hasMoreElements()) {
                JarEntry entry = entries.nextElement();
                totalEntries++;

                String name = entry.getName();
                if (name.endsWith(".class")) {
                    classEntries++;
                } else if (name.endsWith(".png")) {
                    pngEntries++;
                }
            }

            Manifest manifest = jarFile.getManifest();
            String manifestVersion = null;
            String midletName = null;
            String midletVersion = null;
            String midletVendor = null;
            String midlet1 = null;
            String configuration = null;
            String profile = null;

            if (manifest != null) {
                Attributes attributes = manifest.getMainAttributes();
                if (attributes != null) {
                    manifestVersion = attributes.getValue("Manifest-Version");
                    midletName = attributes.getValue("MIDlet-Name");
                    midletVersion = attributes.getValue("MIDlet-Version");
                    midletVendor = attributes.getValue("MIDlet-Vendor");
                    midlet1 = attributes.getValue("MIDlet-1");
                    configuration = attributes.getValue("MicroEdition-Configuration");
                    profile = attributes.getValue("MicroEdition-Profile");
                }
            }

            return new JarValidationResult(
                    jarPath,
                    true,
                    true,
                    true,
                    true,
                    fileSize,
                    totalEntries,
                    classEntries,
                    pngEntries,
                    manifestVersion,
                    midletName,
                    midletVersion,
                    midletVendor,
                    midlet1,
                    configuration,
                    profile,
                    null
            );

        } catch (IOException e) {
            return JarValidationResult.invalidFile(jarPath, true, true, "Invalid JAR file: " + e.getMessage());
        }
    }
}
