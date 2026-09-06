import JSZip from 'jszip';
import { ConstantPoolEntry, ResolvedCpEntry } from './constantPool';

export type EntryType = 'class' | 'png' | 'manifest' | 'resource' | 'directory';

export interface JarEntryInfo {
  path: string;
  name: string;
  type: EntryType;
  directory: boolean;
  size?: number;
  zipEntry: JSZip.JSZipObject;
}

export interface ManifestInfo {
  manifestVersion: string;
  midletName: string;
  midletVersion: string;
  midletVendor: string;
  midlet1: string;
  configuration: string;
  profile: string;
  rawText?: string;
}

export interface JarInfo {
  fileName: string;
  fileSize: number;
  lastModified: number;
  totalEntries: number;
  classEntries: number;
  pngEntries: number;
  resourceEntries: number;
  manifest: ManifestInfo;
  status: 'loaded' | 'error';
  errorMessage?: string;
}

export interface ClassFileInfo {
  magic: number;
  magicHex: string;
  minorVersion: number;
  majorVersion: number;
  versionName: string;

  constantPoolCount: number;
  constantPool: (ConstantPoolEntry | null)[];
  resolvedConstantPool: ResolvedCpEntry[];
  accessFlags: number;
  accessFlagsFormatted: string[];

  internalClassName: string;
  className: string;

  internalSuperClassName?: string;
  superClassName?: string;

  interfacesCount: number;
  fieldsCount: number;
  methodsCount: number;
  attributesCount: number;

  byteLength: number;
  parsedBytes: number;
  remainingBytes: number;
  status: 'valid' | 'invalid';
  errorMessage?: string;
}

export interface LoadedJarSession {
  originalFile: File;
  zip: JSZip;
  jarInfo: JarInfo;
  entries: JarEntryInfo[];
  classParseCache?: Map<string, ClassFileInfo>;
}

export interface JarLoadState {
  isLoading: boolean;
  error: string | null;
  session: LoadedJarSession | null;
}
