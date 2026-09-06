package com.nroeditor;

import com.nroeditor.jar.JarValidationResult;
import com.nroeditor.jar.JarValidator;

import java.nio.file.Files;
import java.nio.file.Path;

public class Main {

    public static void main(String[] args) {
        Path targetPath = Path.of("input/NgocRongChay-v1.3.8.jar");
        if (!Files.exists(targetPath) && Files.exists(Path.of("NROEditor/input/NgocRongChay-v1.3.8.jar"))) {
            targetPath = Path.of("NROEditor/input/NgocRongChay-v1.3.8.jar");
        }

        System.out.println("NROEditor JAR validation\n");
        System.out.println("Path: " + targetPath);

        JarValidator validator = new JarValidator();
        JarValidationResult result = validator.validate(targetPath);

        System.out.println("Exists: " + result.isExists());
        System.out.println("Readable: " + result.isReadable());
        System.out.println("Valid JAR: " + result.isValidJar());
        System.out.println();

        if (!result.isExists()) {
            System.out.println("TARGET JAR NOT FOUND");
            System.out.println("Please place the file at: input/NgocRongChay-v1.3.8.jar");
            System.out.println("\nJAR VALIDATION: FAIL");
            return;
        }

        if (!result.isValidJar()) {
            System.out.println("Error: " + result.getErrorMessage());
            System.out.println("\nJAR VALIDATION: FAIL");
            return;
        }

        System.out.println("File size: " + result.getFileSize() + " bytes");
        System.out.println("Total entries: " + result.getTotalEntries());
        System.out.println("Class entries: " + result.getClassEntries());
        System.out.println("PNG entries: " + result.getPngEntries());
        System.out.println();
        System.out.println("Manifest-Version: " + result.getManifestVersion());
        System.out.println("MIDlet-Name: " + result.getMidletName());
        System.out.println("MIDlet-Version: " + result.getMidletVersion());
        System.out.println("MIDlet-Vendor: " + result.getMidletVendor());
        System.out.println("MIDlet-1: " + result.getMidlet1());
        System.out.println("Configuration: " + result.getConfiguration());
        System.out.println("Profile: " + result.getProfile());
        System.out.println();

        boolean matchesExpected =
                result.getTotalEntries() == 2484
                && result.getClassEntries() == 301
                && result.getPngEntries() == 1137
                && "Ngọc Rồng".equals(result.getMidletName())
                && "2.4.8".equals(result.getMidletVersion())
                && "KKrot".equals(result.getMidletVendor())
                && "DragonBoy,/icon.png,main.GameMidlet".equals(result.getMidlet1())
                && "CLDC-1.1".equals(result.getConfiguration())
                && "MIDP-2.0".equals(result.getProfile());

        if (matchesExpected) {
            System.out.println("JAR VALIDATION: PASS");
        } else {
            System.out.println("JAR VALIDATION: FAIL (Values do not match expected verification criteria)");
        }
    }
}
