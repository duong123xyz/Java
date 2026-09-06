package com.nroeditor.jar;

import java.nio.file.Path;

public class JarValidationResult {
    private final Path jarPath;
    private final boolean exists;
    private final boolean regularFile;
    private final boolean readable;
    private final boolean validJar;
    private final long fileSize;
    private final int totalEntries;
    private final int classEntries;
    private final int pngEntries;
    private final String manifestVersion;
    private final String midletName;
    private final String midletVersion;
    private final String midletVendor;
    private final String midlet1;
    private final String configuration;
    private final String profile;
    private final String errorMessage;

    public JarValidationResult(
            Path jarPath,
            boolean exists,
            boolean regularFile,
            boolean readable,
            boolean validJar,
            long fileSize,
            int totalEntries,
            int classEntries,
            int pngEntries,
            String manifestVersion,
            String midletName,
            String midletVersion,
            String midletVendor,
            String midlet1,
            String configuration,
            String profile,
            String errorMessage) {
        this.jarPath = jarPath;
        this.exists = exists;
        this.regularFile = regularFile;
        this.readable = readable;
        this.validJar = validJar;
        this.fileSize = fileSize;
        this.totalEntries = totalEntries;
        this.classEntries = classEntries;
        this.pngEntries = pngEntries;
        this.manifestVersion = manifestVersion;
        this.midletName = midletName;
        this.midletVersion = midletVersion;
        this.midletVendor = midletVendor;
        this.midlet1 = midlet1;
        this.configuration = configuration;
        this.profile = profile;
        this.errorMessage = errorMessage;
    }

    public static JarValidationResult notFound(Path jarPath) {
        return new JarValidationResult(
                jarPath, false, false, false, false,
                0L, 0, 0, 0,
                null, null, null, null, null, null, null,
                "Target file does not exist");
    }

    public static JarValidationResult invalidFile(Path jarPath, boolean regularFile, boolean readable, String reason) {
        return new JarValidationResult(
                jarPath, true, regularFile, readable, false,
                0L, 0, 0, 0,
                null, null, null, null, null, null, null,
                reason);
    }

    public Path getJarPath() {
        return jarPath;
    }

    public boolean isExists() {
        return exists;
    }

    public boolean isRegularFile() {
        return regularFile;
    }

    public boolean isReadable() {
        return readable;
    }

    public boolean isValidJar() {
        return validJar;
    }

    public long getFileSize() {
        return fileSize;
    }

    public int getTotalEntries() {
        return totalEntries;
    }

    public int getClassEntries() {
        return classEntries;
    }

    public int getPngEntries() {
        return pngEntries;
    }

    public String getManifestVersion() {
        return manifestVersion;
    }

    public String getMidletName() {
        return midletName;
    }

    public String getMidletVersion() {
        return midletVersion;
    }

    public String getMidletVendor() {
        return midletVendor;
    }

    public String getMidlet1() {
        return midlet1;
    }

    public String getConfiguration() {
        return configuration;
    }

    public String getProfile() {
        return profile;
    }

    public String getErrorMessage() {
        return errorMessage;
    }
}
