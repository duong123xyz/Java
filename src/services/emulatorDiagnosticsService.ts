import {
  EmulatorDiagnosticsInfo,
  EmulatorAssetDiagnostic,
} from '../types/emulator';

const CHEERPJ_URL = 'https://cjrtnc.leaningtech.com/20260317_2978/loader.js';
const LOCAL_ASSETS = [
  { name: 'NRO Emulator Runner', url: '/emulator/index.html' },
  { name: 'FreeJ2ME Web JAR', url: '/emulator/core/freej2me-web.jar' },
  { name: 'Canvas Graphics Native Bridge', url: '/emulator/core/libjs/libcanvasgraphics.js' },
  { name: 'Media Native Bridge', url: '/emulator/core/libjs/libmediabridge.js' },
  { name: 'LibMedia', url: '/emulator/core/libmedia/libmedia.js' },
];

export const INITIAL_DIAGNOSTICS: EmulatorDiagnosticsInfo = {
  backend: 'CheerpJ + FreeJ2ME Web (NRO iframe runner)',
  version: 'NRO runner fix v1 / CheerpJ 20260317_2978',
  cheerpjLoaded: false,
  freej2meLoaded: false,
  runtimeScriptLoaded: false,
  runtimeInitialized: false,
  gameJarMounted: false,
  midletStarted: false,
  canvasConnected: false,
  rangeRequestSupported: null,
  rangeHttpStatus: undefined,
  corsCspStatus: 'Checking...',
  iframeOrigin: typeof window !== 'undefined' ? window.location.origin : '',
  parentOrigin: typeof window !== 'undefined' ? window.location.origin : '',
  blobAccessible: null,
  jarByteLength: 0,
  blobCreated: false,
  blobUrlStatus: 'Idle',
  jarHandedToEmulator: false,
  emulatorAcknowledgedJar: false,
  currentStage: 'IDLE',
  stageError: undefined,
  selfTestStatus: 'IDLE',
  selfTestRootCause: undefined,
  assets: [
    { name: 'CheerpJ Loader CDN', url: CHEERPJ_URL, httpStatus: null, contentLength: null, status: 'PENDING' },
    ...LOCAL_ASSETS.map((asset) => ({
      ...asset,
      httpStatus: null,
      contentLength: null,
      status: 'PENDING' as const,
    })),
  ],
};

/**
 * CheerpJ benefits from servers that honor Range requests. Test the actual local
 * freej2me-web.jar instead of an unrelated placeholder asset.
 */
export async function testHttpRangeSupport(): Promise<{
  supported: boolean;
  status: number;
  contentRange: string | null;
  error?: string;
}> {
  try {
    const response = await fetch('/emulator/core/freej2me-web.jar', {
      method: 'GET',
      headers: { Range: 'bytes=0-1' },
      cache: 'no-cache',
    });
    const status = response.status;
    const contentRange = response.headers.get('content-range');
    return {
      supported: status === 206,
      status,
      contentRange,
      error: status === 206 ? undefined : `Server returned HTTP ${status}, not 206 Partial Content`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      supported: false,
      status: 0,
      contentRange: null,
      error: `Range test failed: ${message}`,
    };
  }
}

async function probeAsset(name: string, url: string): Promise<EmulatorAssetDiagnostic> {
  try {
    // HEAD is cheap, but some CDNs reject it. Fall back to a tiny GET/range request.
    let response: Response;
    try {
      response = await fetch(url, { method: 'HEAD', cache: 'no-cache', mode: url.startsWith('http') ? 'cors' : 'same-origin' });
      if (!response.ok && response.status !== 206) throw new Error(`HEAD HTTP ${response.status}`);
    } catch (_) {
      response = await fetch(url, {
        method: 'GET',
        headers: url.includes('freej2me-web.jar') ? { Range: 'bytes=0-16' } : undefined,
        cache: 'no-cache',
        mode: url.startsWith('http') ? 'cors' : 'same-origin',
      });
    }

    const ok = response.status >= 200 && response.status < 400;
    const len = response.headers.get('content-length');
    return {
      name,
      url,
      httpStatus: response.status,
      contentLength: len ? Number.parseInt(len, 10) : null,
      status: ok ? 'LOADED' : 'FAILED',
      error: ok ? undefined : `HTTP ${response.status} ${response.statusText}`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      name,
      url,
      httpStatus: 0,
      contentLength: null,
      status: 'FAILED',
      error: `Network/CORS fetch error: ${message}`,
    };
  }
}

export async function testAllEmulatorAssets(): Promise<EmulatorAssetDiagnostic[]> {
  const definitions = [
    { name: 'CheerpJ Loader CDN', url: CHEERPJ_URL },
    ...LOCAL_ASSETS,
  ];
  return Promise.all(definitions.map((asset) => probeAsset(asset.name, asset.url)));
}

export async function testBlobAndEnvironment(testBuffer?: ArrayBuffer): Promise<{
  blobAccessible: boolean;
  corsCspStatus: string;
  error?: string;
}> {
  let url: string | null = null;
  try {
    const source = testBuffer || new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
    const blob = new Blob([source], { type: 'application/java-archive' });
    url = URL.createObjectURL(blob);
    const response = await fetch(url);
    const roundTrip = await response.arrayBuffer();
    const ok = roundTrip.byteLength === source.byteLength;
    return {
      blobAccessible: ok,
      corsCspStatus: ok
        ? 'Blob + ArrayBuffer round-trip works in browser context'
        : 'Blob round-trip byte length mismatch',
      error: ok ? undefined : `Expected ${source.byteLength} bytes, received ${roundTrip.byteLength}`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      blobAccessible: false,
      corsCspStatus: `Blob access failed: ${message}`,
      error: message,
    };
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}
