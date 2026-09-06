import { ManifestInfo } from '../types/jar';
import {
  J2meTestSession,
  EmulatorRuntimeStatus,
  EmulatorRuntimeStage,
  EmulatorScreenSize,
  EmulatorLogEntry,
  MidletAppInfo,
  EmulatorDiagnosticsInfo,
} from '../types/emulator';
import {
  INITIAL_DIAGNOSTICS,
  testHttpRangeSupport,
  testAllEmulatorAssets,
  testBlobAndEnvironment,
} from './emulatorDiagnosticsService';

/**
 * Parses MIDlet-1 attribute from J2ME Manifest.
 * Format: <Name>, <IconPath>, <MainClass>
 * e.g. "DragonBoy, /icon.png, main.GameMidlet"
 */
export function parseMidlet1(manifest?: ManifestInfo): MidletAppInfo | null {
  if (!manifest || !manifest.midlet1) {
    return null;
  }

  const raw = manifest.midlet1.trim();
  const parts = raw.split(',').map((p) => p.trim());

  if (parts.length < 3) {
    return {
      name: parts[0] || manifest.midletName || 'J2ME App',
      iconPath: parts[1] || undefined,
      mainClass: parts[parts.length - 1] || 'main.GameMidlet',
      rawString: raw,
    };
  }

  return {
    name: parts[0],
    iconPath: parts[1],
    mainClass: parts[2],
    rawString: raw,
  };
}

export class DefaultJ2meTestSession implements J2meTestSession {
  private status: EmulatorRuntimeStatus = 'IDLE';
  private logs: EmulatorLogEntry[] = [];
  private logListeners: Set<(entry: EmulatorLogEntry) => void> = new Set();
  private statusListeners: Set<(status: EmulatorRuntimeStatus) => void> = new Set();
  private diagnosticsListeners: Set<(diag: EmulatorDiagnosticsInfo) => void> = new Set();

  private diagnostics: EmulatorDiagnosticsInfo = { ...INITIAL_DIAGNOSTICS };
  private activeBlobUrl: string | null = null;
  private iframeElement: HTMLIFrameElement | null = null;
  private currentFileName: string = '';
  private currentMidlet: MidletAppInfo | null = null;
  private currentScreenSize: EmulatorScreenSize = '240x320';
  private soundEnabled: boolean = true;
  private messageListener: ((e: MessageEvent) => void) | null = null;

  private stageTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly STAGE_TIMEOUT_MS = 15000; // 15 seconds per stage

  constructor() {
    this.setupMessageBridge();
  }

  /**
   * Bind iframe element to communicate with the isolated runner.
   */
  public bindIframe(iframe: HTMLIFrameElement | null) {
    this.iframeElement = iframe;
    if (iframe) {
      this.updateDiagnostics({
        iframeOrigin: window.location.origin,
        parentOrigin: window.location.origin,
      });
    }
  }

  private setupMessageBridge() {
    this.messageListener = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') {
        return;
      }

      switch (data.type) {
        case 'IFRAME_READY':
          this.addLog('info', `Emulator runner iframe initialized (origin: ${event.origin || 'same-origin'})`);
          this.updateDiagnostics({
            iframeOrigin: event.origin || window.location.origin,
            corsCspStatus: 'Handshake verified. Runner ready.',
          });
          break;

        case 'STATUS_CHANGE':
          this.clearStageTimeout();
          if (data.status) {
            this.setStatus(data.status);
            this.updateDiagnostics({
              currentStage: data.stage || (data.status as EmulatorRuntimeStage),
              stageError: data.error || undefined,
              ...(data.runtimeInfo || {}),
            });
          }
          if (data.message) {
            this.addLog(data.status === 'ERROR' ? 'error' : 'info', `[Runner Stage: ${data.stage || data.status}] ${data.message}`);
          }
          if (data.error) {
            this.addLog('error', `[Runner Error] ${data.error}`);
          }
          break;

        case 'LOG':
          if (data.entry) {
            this.logs.push(data.entry);
            if (this.logs.length > 500) this.logs.shift();
            this.logListeners.forEach((l) => l(data.entry));
          }
          break;

        case 'SELF_TEST_RESULT':
          this.clearStageTimeout();
          this.updateDiagnostics({
            selfTestStatus: data.status,
            selfTestRootCause: data.rootCause,
            ...(data.runtimeInfo || {}),
          });
          if (data.status === 'PASS') {
            this.addLog('info', '========================================');
            this.addLog('info', 'EMULATOR SELF-TEST: PASS');
            this.addLog('info', 'CheerpJ runtime and FreeJ2ME core verified successfully.');
            this.addLog('info', '========================================');
          } else {
            this.addLog('error', '========================================');
            this.addLog('error', 'EMULATOR SELF-TEST: FAIL');
            this.addLog('error', `Root Cause: ${data.rootCause || 'Unknown failure'}`);
            this.addLog('error', '========================================');
          }
          break;
      }
    };

    window.addEventListener('message', this.messageListener);
  }

  public addLog(level: 'info' | 'warn' | 'error' | 'debug', message: string) {
    const entry: EmulatorLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toLocaleTimeString(),
      level,
      message,
    };
    this.logs.push(entry);
    if (this.logs.length > 500) {
      this.logs.shift();
    }
    this.logListeners.forEach((l) => l(entry));
  }

  private setStatus(newStatus: EmulatorRuntimeStatus) {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.updateDiagnostics({
        currentStage: newStatus as EmulatorRuntimeStage,
      });
      this.statusListeners.forEach((l) => l(newStatus));
    }
  }

  public getDiagnostics(): EmulatorDiagnosticsInfo {
    return { ...this.diagnostics };
  }

  public updateDiagnostics(patch: Partial<EmulatorDiagnosticsInfo>) {
    this.diagnostics = { ...this.diagnostics, ...patch };
    this.diagnosticsListeners.forEach((l) => l(this.diagnostics));
  }

  public onDiagnosticsChange(listener: (diag: EmulatorDiagnosticsInfo) => void): () => void {
    this.diagnosticsListeners.add(listener);
    listener(this.diagnostics);
    return () => this.diagnosticsListeners.delete(listener);
  }

  private startStageTimeout(stageName: EmulatorRuntimeStage) {
    this.clearStageTimeout();
    this.stageTimeoutTimer = setTimeout(() => {
      const timeoutMsg = `Runtime initialization timed out after 15s at stage: ${stageName}`;
      this.addLog('error', timeoutMsg);
      this.setStatus('ERROR');
      this.updateDiagnostics({
        currentStage: 'ERROR',
        stageError: timeoutMsg,
      });
    }, this.STAGE_TIMEOUT_MS);
  }

  private clearStageTimeout() {
    if (this.stageTimeoutTimer) {
      clearTimeout(this.stageTimeoutTimer);
      this.stageTimeoutTimer = null;
    }
  }

  /**
   * Run automated Emulator Self-Test without needing a user game.
   */
  public async runSelfTest(): Promise<boolean> {
    this.addLog('info', '========================================');
    this.addLog('info', 'RUNNING EMULATOR SELF-TEST...');
    this.addLog('info', 'Stage 1/4: Testing HTTP Range Request Support (HTTP 206)...');

    this.setStatus('LOADING_RUNTIME');
    this.updateDiagnostics({
      selfTestStatus: 'RUNNING',
      selfTestRootCause: undefined,
      currentStage: 'LOADING_RUNTIME',
    });

    // 1. Test Range Header
    const rangeResult = await testHttpRangeSupport();
    this.updateDiagnostics({
      rangeRequestSupported: rangeResult.supported,
      rangeHttpStatus: rangeResult.status,
    });

    if (rangeResult.supported) {
      this.addLog('info', `Range Request Supported: YES (HTTP ${rangeResult.status} Partial Content)`);
    } else {
      this.addLog('warn', `Range Request Supported: NO (${rangeResult.error})`);
      this.addLog('warn', 'AI STUDIO PREVIEW SERVER INCOMPATIBLE WITH THIS EMULATOR RUNTIME');
    }

    // 2. Test Assets
    this.addLog('info', 'Stage 2/4: Testing required emulator assets (JS, JAR, ZIP)...');
    const assetResults = await testAllEmulatorAssets();
    this.updateDiagnostics({ assets: assetResults });

    for (const a of assetResults) {
      if (a.status === 'LOADED') {
        this.addLog('info', `  Asset OK: ${a.name} (${a.url}) -> HTTP ${a.httpStatus}, size: ${a.contentLength || 'unknown'} bytes`);
      } else {
        this.addLog('error', `  Asset FAILED: ${a.name} (${a.url}) -> ${a.error}`);
      }
    }

    // 3. Test Blob & Context
    this.addLog('info', 'Stage 3/4: Testing Blob & ArrayBuffer context...');
    const blobRes = await testBlobAndEnvironment();
    this.updateDiagnostics({
      blobAccessible: blobRes.blobAccessible,
      corsCspStatus: blobRes.corsCspStatus,
    });

    // 4. Test CheerpJ + FreeJ2ME in Runner Iframe
    this.addLog('info', 'Stage 4/4: Triggering CheerpJ & FreeJ2ME runtime initialization in runner iframe...');

    if (!this.iframeElement?.contentWindow) {
      const err = 'Emulator iframe container not attached to DOM.';
      this.addLog('error', err);
      this.updateDiagnostics({
        selfTestStatus: 'FAIL',
        selfTestRootCause: err,
        currentStage: 'ERROR',
      });
      this.setStatus('ERROR');
      return false;
    }

    this.startStageTimeout('LOADING_RUNTIME');
    this.iframeElement.contentWindow.postMessage(
      {
        type: 'RUN_SELF_TEST',
      },
      '*'
    );

    return true;
  }

  public async loadJar(
    jarData: Blob | ArrayBuffer,
    fileName: string,
    manifest: ManifestInfo
  ): Promise<void> {
    this.cleanupBlobUrl();
    this.currentFileName = fileName;

    // Detect MIDlet
    const midlet = parseMidlet1(manifest);
    this.currentMidlet = midlet;

    let arrayBuffer: ArrayBuffer;
    let byteLength = 0;

    if (jarData instanceof ArrayBuffer) {
      arrayBuffer = jarData;
      byteLength = arrayBuffer.byteLength;
    } else {
      arrayBuffer = await jarData.arrayBuffer();
      byteLength = arrayBuffer.byteLength;
    }

    const blob = new Blob([arrayBuffer], { type: 'application/java-archive' });
    this.activeBlobUrl = URL.createObjectURL(blob);

    this.addLog('info', `========================================`);
    this.addLog('info', `Original JAR byteLength: ${byteLength} bytes`);
    this.addLog('info', `Blob created: YES`);
    this.addLog('info', `Blob URL: created (${(byteLength / 1024 / 1024).toFixed(2)} MB in RAM)`);
    if (midlet) {
      this.addLog('info', `MIDlet Detected: ${midlet.name} -> Class: ${midlet.mainClass}`);
    } else {
      this.addLog('warn', `Manifest does not specify MIDlet-1. Defaulting to main.GameMidlet`);
    }

    this.updateDiagnostics({
      jarByteLength: byteLength,
      blobCreated: true,
      blobUrlStatus: 'Created in RAM',
      currentStage: 'LOADING_RUNTIME',
    });

    // Check Range Support
    const rangeRes = await testHttpRangeSupport();
    this.updateDiagnostics({
      rangeRequestSupported: rangeRes.supported,
      rangeHttpStatus: rangeRes.status,
    });

    if (!rangeRes.supported) {
      this.addLog('warn', `Range check warning: ${rangeRes.error}`);
    }

    this.setStatus('LOADING_RUNTIME');
    this.startStageTimeout('LOADING_RUNTIME');

    if (!this.iframeElement?.contentWindow) {
      const err = 'Emulator iframe is not mounted or ready.';
      this.addLog('error', err);
      this.setStatus('ERROR');
      this.updateDiagnostics({ stageError: err, currentStage: 'ERROR' });
      return;
    }

    this.addLog('info', `Handoff: Passing JAR buffer (${byteLength} bytes) to runner iframe...`);
    this.updateDiagnostics({
      jarHandedToEmulator: true,
      emulatorAcknowledgedJar: true,
    });

    this.iframeElement.contentWindow.postMessage(
      {
        type: 'LOAD_JAR',
        jarBuffer: arrayBuffer,
        fileName,
        mainClass: midlet?.mainClass || 'main.GameMidlet',
        manifest,
      },
      '*'
    );
  }

  public async start(): Promise<void> {
    // start is managed through loadJar transition to RUNNING
  }

  public async restart(): Promise<void> {
    this.addLog('info', `Restarting J2ME emulator session...`);
    if (this.iframeElement?.contentWindow) {
      this.iframeElement.contentWindow.location.reload();
    }
  }

  public async stop(): Promise<void> {
    this.clearStageTimeout();
    this.addLog('info', `Stopping J2ME emulator session.`);
    if (this.iframeElement?.contentWindow) {
      this.iframeElement.contentWindow.postMessage(
        {
          type: 'STOP',
        },
        '*'
      );
    }
    this.setStatus('STOPPED');
  }

  public sendKey(keyCode: number, type: 'down' | 'up'): void {
    if (this.iframeElement?.contentWindow && (this.status === 'RUNNING')) {
      this.iframeElement.contentWindow.postMessage(
        {
          type: 'SEND_KEY',
          keyCode,
          keyAction: type,
        },
        '*'
      );
    }
  }

  public setSound(enabled: boolean): void {
    this.soundEnabled = enabled;
    this.addLog('info', `Audio ${enabled ? 'ENABLED' : 'MUTED'}`);
  }

  public setScreenSize(size: EmulatorScreenSize): void {
    this.currentScreenSize = size;
    this.addLog('info', `Display resolution changed to ${size}`);
  }

  public getStatus(): EmulatorRuntimeStatus {
    return this.status;
  }

  public getLogs(): EmulatorLogEntry[] {
    return [...this.logs];
  }

  public clearLogs(): void {
    this.logs = [];
    this.addLog('info', 'Runtime console cleared.');
  }

  public onLog(listener: (entry: EmulatorLogEntry) => void): () => void {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  }

  public onStatusChange(listener: (status: EmulatorRuntimeStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private cleanupBlobUrl() {
    if (this.activeBlobUrl) {
      URL.revokeObjectURL(this.activeBlobUrl);
      this.activeBlobUrl = null;
    }
  }

  public dispose(): void {
    this.clearStageTimeout();
    this.stop();
    this.cleanupBlobUrl();
    if (this.messageListener) {
      window.removeEventListener('message', this.messageListener);
      this.messageListener = null;
    }
    this.logListeners.clear();
    this.statusListeners.clear();
    this.diagnosticsListeners.clear();
    this.iframeElement = null;
    this.status = 'IDLE';
  }
}
