import {
  EmulatorDiagnosticsInfo,
  EmulatorAssetDiagnostic,
} from '../types/emulator';

export const INITIAL_DIAGNOSTICS: EmulatorDiagnosticsInfo = {
  backend: 'CheerpJ + FreeJ2ME Web',
  version: 'FreeJ2ME zb3 / CheerpJ 2026',
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
    {
      name: 'CheerpJ Loader CDN',
      url: 'https://cjrtnc.leaningtech.com/20260317_2978/loader.js',
      httpStatus: null,
      contentLength: null,
      status: 'PENDING',
    },
    {
      name: 'FreeJ2ME Web JAR',
      url: '/emulator/core/freej2me-web.jar',
      httpStatus: null,
      contentLength: null,
      status: 'PENDING',
    },
    {
      name: 'FreeJ2ME Init ZIP',
      url: '/emulator/core/init.zip',
      httpStatus: null,
      contentLength: null,
      status: 'PENDING',
    },
    {
      name: 'FreeJ2ME Main Module',
      url: '/emulator/core/src/main.js',
      httpStatus: null,
      contentLength: null,
      status: 'PENDING',
    },
  ],
};

/**
 * Perform real HTTP Range request test (bytes=0-1) against local server asset.
 * If server returns 206 Partial Content, Range is supported.
 */
export async function testHttpRangeSupport(): Promise<{
  supported: boolean;
  status: number;
  contentRange: string | null;
  error?: string;
}> {
  try {
    const testUrl = '/emulator/core/freej2me-web.jar';
    const response = await fetch(testUrl, {
      method: 'GET',
      headers: {
        Range: 'bytes=0-1',
      },
    });

    const status = response.status;
    const contentRange = response.headers.get('content-range');
    const is206 = status === 206;

    return {
      supported: is206,
      status,
      contentRange,
      error: is206
        ? undefined
        : `Server returned HTTP ${status} instead of 206 Partial Content`,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      supported: false,
      status: 0,
      contentRange: null,
      error: `Range test fetch exception: ${errorMsg}`,
    };
  }
}

/**
 * Diagnostics check for all required emulator assets.
 * Fetches status, headers and content-length without swallowing exceptions.
 */
export async function testAllEmulatorAssets(): Promise<EmulatorAssetDiagnostic[]> {
  const assetDefs = [
    {
      name: 'CheerpJ Loader CDN',
      url: 'https://cjrtnc.leaningtech.com/20260317_2978/loader.js',
    },
    {
      name: 'FreeJ2ME Web JAR',
      url: '/emulator/core/freej2me-web.jar',
    },
    {
      name: 'FreeJ2ME Init ZIP',
      url: '/emulator/core/init.zip',
    },
    {
      name: 'FreeJ2ME Main Module',
      url: '/emulator/core/src/main.js',
    },
  ];

  const results: EmulatorAssetDiagnostic[] = [];

  for (const def of assetDefs) {
    try {
      const resp = await fetch(def.url, {
        method: 'HEAD',
        cache: 'no-cache',
      }).catch(async () => {
        // Fallback to GET with small slice if HEAD rejected by server/CDN
        return await fetch(def.url, {
          method: 'GET',
          headers: { Range: 'bytes=0-10' },
          cache: 'no-cache',
        });
      });

      const contentLength = resp.headers.get('content-length')
        ? parseInt(resp.headers.get('content-length')!, 10)
        : null;

      const isOk = resp.status >= 200 && resp.status < 400;

      results.push({
        name: def.name,
        url: def.url,
        httpStatus: resp.status,
        contentLength,
        status: isOk ? 'LOADED' : 'FAILED',
        error: isOk ? undefined : `HTTP error ${resp.status} (${resp.statusText})`,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      results.push({
        name: def.name,
        url: def.url,
        httpStatus: 0,
        contentLength: null,
        status: 'FAILED',
        error: `Network/CORS fetch error: ${errorMsg}`,
      });
    }
  }

  return results;
}

/**
 * Tests Blob URL accessibility and FileReader in current execution context.
 */
export async function testBlobAndEnvironment(testBuffer?: ArrayBuffer): Promise<{
  blobAccessible: boolean;
  corsCspStatus: string;
  error?: string;
}> {
  try {
    const dummy = testBuffer || new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
    const testBlob = new Blob([dummy], { type: 'application/java-archive' });
    const testUrl = URL.createObjectURL(testBlob);

    const resp = await fetch(testUrl);
    const readBuffer = await resp.arrayBuffer();
    URL.revokeObjectURL(testUrl);

    if (readBuffer.byteLength === dummy.byteLength) {
      return {
        blobAccessible: true,
        corsCspStatus: 'Blob & ArrayBuffer fetch operational in context',
      };
    } else {
      return {
        blobAccessible: false,
        corsCspStatus: 'Blob size mismatch in context',
        error: 'Blob URL read byteLength does not match source buffer',
      };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      blobAccessible: false,
      corsCspStatus: `Blob access failed: ${msg}`,
      error: msg,
    };
  }
}
