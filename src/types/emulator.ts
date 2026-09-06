import { ManifestInfo } from './jar';

export type EmulatorSourceType = 'ORIGINAL' | 'PATCHED';

export type EmulatorRuntimeStatus =
  | 'IDLE'
  | 'LOADING_RUNTIME'
  | 'RUNTIME_READY'
  | 'MOUNTING_JAR'
  | 'JAR_MOUNTED'
  | 'STARTING_MIDLET'
  | 'RUNNING'
  | 'ERROR'
  | 'STOPPED'
  | 'UNSUPPORTED';

export type EmulatorRuntimeStage =
  | 'IDLE'
  | 'LOADING_RUNTIME'
  | 'RUNTIME_READY'
  | 'MOUNTING_JAR'
  | 'JAR_MOUNTED'
  | 'STARTING_MIDLET'
  | 'RUNNING'
  | 'ERROR';

export interface EmulatorAssetDiagnostic {
  name: string;
  url: string;
  httpStatus: number | null;
  contentLength: number | null;
  status: 'PENDING' | 'LOADED' | 'FAILED';
  error?: string;
  isRangeTested?: boolean;
  rangeStatus?: number | null;
}

export interface EmulatorDiagnosticsInfo {
  backend: string;
  version: string;
  cheerpjLoaded: boolean;
  freej2meLoaded: boolean;
  runtimeScriptLoaded: boolean;
  runtimeInitialized: boolean;
  gameJarMounted: boolean;
  midletStarted: boolean;
  canvasConnected: boolean;
  rangeRequestSupported: boolean | null;
  rangeHttpStatus?: number;
  corsCspStatus?: string;
  iframeOrigin?: string;
  parentOrigin?: string;
  blobAccessible?: boolean | null;
  jarByteLength?: number;
  blobCreated?: boolean;
  blobUrlStatus?: string;
  jarHandedToEmulator?: boolean;
  emulatorAcknowledgedJar?: boolean;
  currentStage: EmulatorRuntimeStage;
  stageError?: string;
  selfTestStatus?: 'IDLE' | 'RUNNING' | 'PASS' | 'FAIL';
  selfTestRootCause?: string;
  assets: EmulatorAssetDiagnostic[];
}

export type EmulatorScreenSize = '240x320' | '176x220' | '128x160' | '320x240' | '360x640';

export type EmulatorPhoneType = 'nokia' | 'standard' | 'sonyericsson' | 'motorola';

export interface EmulatorConfig {
  screenSize: EmulatorScreenSize;
  phoneType: EmulatorPhoneType;
  sound: boolean;
  scale: number;
}

export interface EmulatorLogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
}

export interface MidletAppInfo {
  name: string;
  iconPath?: string;
  mainClass: string;
  rawString: string;
}

/**
 * Standard Key Codes for J2ME MIDP Canvas
 */
export const J2ME_KEYS = {
  UP: -1,
  DOWN: -2,
  LEFT: -3,
  RIGHT: -4,
  FIRE: -5,
  KEY_SOFT_LEFT: -6,
  KEY_SOFT_RIGHT: -7,
  KEY_NUM0: 48,
  KEY_NUM1: 49,
  KEY_NUM2: 50,
  KEY_NUM3: 51,
  KEY_NUM4: 52,
  KEY_NUM5: 53,
  KEY_NUM6: 54,
  KEY_NUM7: 55,
  KEY_NUM8: 56,
  KEY_NUM9: 57,
  KEY_STAR: 42,
  KEY_POUND: 35,
} as const;

/**
 * Interface for the J2me Emulator Session Abstraction
 */
export interface J2meTestSession {
  loadJar(
    jarData: Blob | ArrayBuffer,
    fileName: string,
    manifest: ManifestInfo
  ): Promise<void>;
  start(): Promise<void>;
  restart(): Promise<void>;
  stop(): Promise<void>;
  dispose(): void;
  sendKey(keyCode: number, type: 'down' | 'up'): void;
  setSound(enabled: boolean): void;
  setScreenSize(size: EmulatorScreenSize): void;
  getStatus(): EmulatorRuntimeStatus;
  getLogs(): EmulatorLogEntry[];
  getDiagnostics(): EmulatorDiagnosticsInfo;
  onLog(listener: (entry: EmulatorLogEntry) => void): () => void;
  onStatusChange(listener: (status: EmulatorRuntimeStatus) => void): () => void;
  onDiagnosticsChange(listener: (diag: EmulatorDiagnosticsInfo) => void): () => void;
  runSelfTest(): Promise<boolean>;
}
