import JSZip from 'jszip';
import { ConstantPoolEntry, ResolvedCpEntry } from './constantPool';
import { AttributeInfo, FieldInfo, MethodInfo } from './bytecode';
import { ItemAnalysisSessionData, ItemDraft } from './item';
import { ClassRewriteResult } from './patch';

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

  thisClassIndex?: number;
  superClassIndex?: number;
  internalSuperClassName?: string;
  superClassName?: string;

  interfacesCount: number;
  interfaces?: number[];
  fieldsCount: number;
  fields: FieldInfo[];
  methodsCount: number;
  methods: MethodInfo[];
  attributesCount: number;
  attributes?: AttributeInfo[];

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
  itemAnalysis?: ItemAnalysisSessionData;
  itemDrafts?: Map<string, ItemDraft>;
  rewritePreviews?: Map<string, ClassRewriteResult>;
}

export interface JarLoadState {
  isLoading: boolean;
  error: string | null;
  session: LoadedJarSession | null;
}
