import JSZip from 'jszip';
import { JarInfo, ManifestInfo, JarEntryInfo, LoadedJarSession, EntryType } from '../types/jar';

export function parseManifest(rawText: string): ManifestInfo {
  // JAR Manifest spec RFC 822: continuation lines start with a single space
  const unfolded = rawText.replace(/\r?\n /g, '');
  const lines = unfolded.split(/\r?\n/);
  const attributes: Record<string, string> = {};

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      attributes[key] = value;
    }
  }

  return {
    manifestVersion: attributes['Manifest-Version'] || 'N/A',
    midletName: attributes['MIDlet-Name'] || 'N/A',
    midletVersion: attributes['MIDlet-Version'] || 'N/A',
    midletVendor: attributes['MIDlet-Vendor'] || 'N/A',
    midlet1: attributes['MIDlet-1'] || 'N/A',
    configuration: attributes['MicroEdition-Configuration'] || 'N/A',
    profile: attributes['MicroEdition-Profile'] || 'N/A',
    rawText,
  };
}

export function classifyEntry(path: string, isDir: boolean): EntryType {
  const lowerPath = path.toLowerCase();
  if (isDir || path.endsWith('/')) {
    return 'directory';
  }
  if (lowerPath === 'meta-inf/manifest.mf') {
    return 'manifest';
  }
  if (lowerPath.endsWith('.class')) {
    return 'class';
  }
  if (lowerPath.endsWith('.png')) {
    return 'png';
  }
  return 'resource';
}

export async function loadAndAnalyzeJarSession(file: File): Promise<LoadedJarSession> {
  if (!file) {
    throw new Error('No file provided');
  }

  if (!file.name.toLowerCase().endsWith('.jar')) {
    throw new Error('Chỉ chấp nhận file có phần mở rộng .jar');
  }

  // Load zip in browser memory using standard ArrayBuffer
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  let totalEntries = 0;
  let classEntries = 0;
  let pngEntries = 0;
  let resourceEntries = 0;

  const entries: JarEntryInfo[] = [];
  let manifestEntry: JSZip.JSZipObject | null = null;

  zip.forEach((relativePath, zipEntry) => {
    totalEntries++;
    const isDir = Boolean(zipEntry.dir || relativePath.endsWith('/'));
    const entryType = classifyEntry(relativePath, isDir);

    if (entryType === 'class') {
      classEntries++;
    } else if (entryType === 'png') {
      pngEntries++;
    } else if (entryType === 'resource' || entryType === 'manifest') {
      resourceEntries++;
    }

    if (entryType === 'manifest') {
      manifestEntry = zipEntry;
    }

    // Extract simple filename
    const pathParts = relativePath.split('/').filter(Boolean);
    const name = pathParts.length > 0 ? pathParts[pathParts.length - 1] : relativePath;

    // Extract uncompressed size directly from entry data (preserves exact size)
    const uncompressedSize =
      typeof (zipEntry as any)._data?.uncompressedSize === 'number'
        ? (zipEntry as any)._data.uncompressedSize
        : typeof (zipEntry as any)._data?.compressedSize === 'number'
        ? (zipEntry as any)._data.compressedSize
        : 0;

    entries.push({
      path: relativePath,
      name: isDir ? `${name}/` : name,
      type: entryType,
      directory: isDir,
      size: uncompressedSize,
      zipEntry,
    });
  });

  let manifestInfo: ManifestInfo = {
    manifestVersion: 'N/A',
    midletName: 'N/A',
    midletVersion: 'N/A',
    midletVendor: 'N/A',
    midlet1: 'N/A',
    configuration: 'N/A',
    profile: 'N/A',
  };

  if (manifestEntry) {
    try {
      const manifestText = await (manifestEntry as JSZip.JSZipObject).async('string');
      manifestInfo = parseManifest(manifestText);
    } catch {
      manifestInfo.rawText = 'Error reading META-INF/MANIFEST.MF';
    }
  }

  const jarInfo: JarInfo = {
    fileName: file.name,
    fileSize: file.size,
    lastModified: file.lastModified,
    totalEntries,
    classEntries,
    pngEntries,
    resourceEntries,
    manifest: manifestInfo,
    status: 'loaded',
  };

  return {
    originalFile: file,
    zip,
    jarInfo,
    entries,
  };
}

/**
 * Backward compatibility wrapper
 */
export async function loadAndAnalyzeJar(file: File): Promise<JarInfo> {
  const session = await loadAndAnalyzeJarSession(file);
  return session.jarInfo;
}
