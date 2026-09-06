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

/** Parse MIDlet-1: <Name>,<IconPath>,<MainClass>. */
export function parseMidlet1(manifest?: ManifestInfo): MidletAppInfo | null {
  if (!manifest?.midlet1) return null;

  const raw = manifest.midlet1.trim();
  const parts = raw.split(',').map((p) => p.trim());
  return {
    name: parts[0] || manifest.midletName || 'J2ME App',
    iconPath: parts.length > 1 ? parts[1] || undefined : undefined,
    mainClass: parts.length > 2 ? parts[2] : parts[parts.length - 1] || 'main.GameMidlet',
    rawString: raw,
  };
}

type LastJarPayload = {
  jarBuffer: ArrayBuffer;
  fileName: string;
  mainClass: string;
  manifest: ManifestInfo;
};

/**
 * Same-origin bridge between React and /public/emulator/index.html.
 * IMPORTANT: CheerpJ is run only in a standalone top-level runner tab/window.
 * The embedded iframe is kept only as a visual placeholder and is never used
 * as a CheerpJ execution context.
 */
export class DefaultJ2meTestSession implements J2meTestSession {
  private status: EmulatorRuntimeStatus = 'IDLE';
  private logs: EmulatorLogEntry[] = [];
  private logListeners = new Set<(entry: EmulatorLogEntry) => void>();
  private statusListeners = new Set<(status: EmulatorRuntimeStatus) => void>();
  private diagnosticsListeners = new Set<(diag: EmulatorDiagnosticsInfo) => void>();
  private diagnostics: EmulatorDiagnosticsInfo = { ...INITIAL_DIAGNOSTICS };

  private iframeElement: HTMLIFrameElement | null = null;
  private runnerWindow: Window | null = null;
  private iframeReady = false;
  private readonly preferPopoutRunner = true;
  private messageListener: ((e: MessageEvent) => void) | null = null;
  private activeBlobUrl: string | null = null;
  private lastJar: LastJarPayload | null = null;
  private restartOnReady = false;
  // Exact browser-run generation expected from the standalone runner.
  // This prevents a stale runner page/JVM from acknowledging a newly built JAR.
  private expectedRunnerRunId: string | null = null;
  private runnerGeneration = 0;
  private stageTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly STAGE_TIMEOUT_MS = 60_000;

  private currentScreenSize: EmulatorScreenSize = '240x320';
  private soundEnabled = true;

  constructor() {
    this.setupMessageBridge();
  }

  public bindIframe(iframe: HTMLIFrameElement | null): void {
    // Keep the reference only because the existing UI still renders the phone iframe.
    // Do NOT use it as a CheerpJ runner: AI Studio Preview nests it inside another iframe
    // and cheerpjInit can stall indefinitely there.
    this.iframeElement = iframe;
    if (iframe) {
      this.updateDiagnostics({
        iframeOrigin: window.location.origin,
        parentOrigin: window.location.origin,
        corsCspStatus: 'Embedded iframe present for UI only. Runtime requires standalone top-level runner.',
      });
    }
  }

  private setupMessageBridge(): void {
    this.messageListener = (event: MessageEvent) => {
      const activeRunner = this.getActiveRunnerWindow();
      // Runtime messages are accepted ONLY from the standalone runner window.
      // This prevents the still-rendered embedded iframe from taking over the session.
      if (!activeRunner || event.source !== activeRunner) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      switch (data.type) {
        case 'IFRAME_READY':
        case 'PONG': {
          // A named popup may still be finishing messages from the previous page while
          // we navigate it to a fresh runtime. Only the page with the current runId is
          // allowed to become ready.
          if (this.expectedRunnerRunId && data.runId !== this.expectedRunnerRunId) {
            return;
          }
          const becameReady = !this.iframeReady;
          this.iframeReady = true;
          if (becameReady) {
            this.addLog('info', `Standalone emulator runner ready (${data.runnerVersion || 'runner'}, origin: ${event.origin || 'same-origin'})`);
          }
          this.updateDiagnostics({
            iframeOrigin: event.origin || window.location.origin,
            corsCspStatus: 'Standalone same-origin runner handshake verified.',
          });
          if (this.restartOnReady && this.lastJar) {
            this.restartOnReady = false;
            void this.sendLastJarToRunner();
          }
          break;
        }

        case 'JAR_ACK':
          this.updateDiagnostics({ emulatorAcknowledgedJar: true });
          this.addLog('info', `Runner ACK: ${data.fileName || 'JAR'} (${data.byteLength || '?'} bytes)`);
          break;

        case 'STATUS_CHANGE': {
          const next = data.status as EmulatorRuntimeStatus | undefined;
          if (next) {
            this.setStatus(next);
            this.updateDiagnostics({
              currentStage: (data.stage || next) as EmulatorRuntimeStage,
              stageError: data.error || undefined,
              ...(data.runtimeInfo || {}),
            });
            if (this.isBusy(next)) this.armStageTimeout(next);
            else this.clearStageTimeout();
          }
          if (data.message) {
            this.addLog(next === 'ERROR' ? 'error' : 'info', `[${data.stage || next || 'runner'}] ${data.message}`);
          }
          if (data.error) this.addLog('error', `[runner root cause] ${data.error}`);
          break;
        }

        case 'LOG':
          if (data.entry) this.pushLog(data.entry as EmulatorLogEntry);
          break;

        case 'SELF_TEST_RESULT':
          this.updateDiagnostics({
            selfTestStatus: data.status,
            selfTestRootCause: data.rootCause,
            ...(data.runtimeInfo || {}),
          });
          this.addLog(data.status === 'PASS' ? 'info' : 'error',
            data.status === 'PASS'
              ? 'EMULATOR SELF-TEST: PASS'
              : `EMULATOR SELF-TEST: FAIL - ${data.rootCause || 'unknown cause'}`);
          break;
      }
    };

    window.addEventListener('message', this.messageListener);
  }

  private isBusy(status: EmulatorRuntimeStatus): boolean {
    return ['LOADING_RUNTIME', 'MOUNTING_JAR', 'JAR_MOUNTED', 'STARTING_MIDLET'].includes(status);
  }

  private getActiveRunnerWindow(): Window | null {
    if (this.runnerWindow && !this.runnerWindow.closed) return this.runnerWindow;
    return null;
  }

  /**
   * CheerpJ can stall when it is booted inside AI Studio's nested Preview iframe.
   * Prefer a same-origin top-level popup runner, which is still fully browser-side
   * but avoids the extra iframe sandbox. Falls back to the embedded iframe if popups
   * are blocked by the host. Call this synchronously from a user click path.
   */
  private ensurePopoutRunner(): Window | null {
    if (this.runnerWindow && !this.runnerWindow.closed) return this.runnerWindow;

    const url = `/emulator/index.html?standalone=1&cj=stable&reset=rms&run=bootstrap-${Date.now()}`;

    // Opening a normal tab is more reliable than requesting a popup window from
    // inside Google AI Studio's sandboxed Preview iframe.
    let runner: Window | null = null;
    try {
      runner = window.open(url, 'nro-j2me-runner');
    } catch (error) {
      this.addLog('error', `Unable to open standalone J2ME runner: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!runner) {
      const message = 'Standalone emulator tab was blocked. Allow pop-ups/new tabs for AI Studio Preview, then click Run again.';
      this.addLog('error', message);
      this.updateDiagnostics({
        corsCspStatus: 'Standalone runner blocked by browser/Preview host.',
        currentStage: 'ERROR',
        stageError: message,
      });
      this.setStatus('ERROR');
      return null;
    }

    this.runnerWindow = runner;
    this.iframeReady = false;
    this.updateDiagnostics({
      corsCspStatus: 'Standalone top-level runner opened. Waiting for opener handshake.',
    });
    this.addLog('info', 'Opened standalone J2ME runner tab. Embedded iframe runtime is disabled.');
    return runner;
  }

  private navigateRunnerToFreshRuntime(reason: string): boolean {
    const runner = this.getActiveRunnerWindow();
    if (!runner) return false;

    const runId = `${Date.now()}-${++this.runnerGeneration}`;
    this.expectedRunnerRunId = runId;
    this.iframeReady = false;
    this.restartOnReady = !!this.lastJar;
    this.clearStageTimeout();
    this.setStatus('LOADING_RUNTIME');
    this.updateDiagnostics({
      currentStage: 'LOADING_RUNTIME',
      emulatorAcknowledgedJar: false,
      stageError: undefined,
      corsCspStatus: `Fresh standalone runtime requested (${reason}), run=${runId}.`,
    });
    this.addLog('info', `Fresh JVM required (${reason}). Reloading standalone runner: ${runId}`);

    const url = `/emulator/index.html?standalone=1&cj=stable&reset=rms&run=${encodeURIComponent(runId)}&t=${Date.now()}`;
    try {
      // location.replace tears down the old CheerpJ page/JVM without leaving another
      // history entry. The matching runId handshake will resend lastJar automatically.
      runner.location.replace(url);
      return true;
    } catch (error) {
      this.restartOnReady = false;
      const message = `Could not reload standalone runner: ${error instanceof Error ? error.message : String(error)}`;
      this.addLog('error', message);
      this.updateDiagnostics({ currentStage: 'ERROR', stageError: message });
      this.setStatus('ERROR');
      return false;
    }
  }

  private pingRunner(): void {
    try { this.getActiveRunnerWindow()?.postMessage({ type: 'PING' }, '*'); } catch (_) {}
  }

  private async waitForRunnerReady(timeoutMs = 10_000): Promise<boolean> {
    if (this.iframeReady && this.getActiveRunnerWindow()) return true;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      this.pingRunner();
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (this.iframeReady && this.getActiveRunnerWindow()) return true;
    }
    return false;
  }

  private armStageTimeout(status: EmulatorRuntimeStatus): void {
    this.clearStageTimeout();
    this.stageTimeoutTimer = setTimeout(() => {
      const message = `Runner made no progress for ${Math.round(this.STAGE_TIMEOUT_MS / 1000)}s at stage ${status}.`;
      this.addLog('error', message);
      this.setStatus('ERROR');
      this.updateDiagnostics({ currentStage: 'ERROR', stageError: message });
    }, this.STAGE_TIMEOUT_MS);
  }

  private clearStageTimeout(): void {
    if (this.stageTimeoutTimer) clearTimeout(this.stageTimeoutTimer);
    this.stageTimeoutTimer = null;
  }

  private setStatus(status: EmulatorRuntimeStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((listener) => listener(status));
  }

  private pushLog(entry: EmulatorLogEntry): void {
    this.logs.push(entry);
    if (this.logs.length > 500) this.logs.shift();
    this.logListeners.forEach((listener) => listener(entry));
  }

  public addLog(level: EmulatorLogEntry['level'], message: string): void {
    this.pushLog({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toLocaleTimeString(),
      level,
      message,
    });
  }

  public getDiagnostics(): EmulatorDiagnosticsInfo {
    return { ...this.diagnostics, assets: [...(this.diagnostics.assets || [])] };
  }

  public updateDiagnostics(patch: Partial<EmulatorDiagnosticsInfo>): void {
    this.diagnostics = { ...this.diagnostics, ...patch };
    this.diagnosticsListeners.forEach((listener) => listener(this.getDiagnostics()));
  }

  public onDiagnosticsChange(listener: (diag: EmulatorDiagnosticsInfo) => void): () => void {
    this.diagnosticsListeners.add(listener);
    listener(this.getDiagnostics());
    return () => this.diagnosticsListeners.delete(listener);
  }

  public async runSelfTest(): Promise<boolean> {
    // Must happen before the first await so browsers treat this as user-initiated.
    const runner = this.ensurePopoutRunner();
    if (!runner) return false;
    this.addLog('info', '=== Emulator self-test (standalone runner) ===');
    this.setStatus('LOADING_RUNTIME');
    this.updateDiagnostics({ selfTestStatus: 'RUNNING', selfTestRootCause: undefined, currentStage: 'LOADING_RUNTIME' });

    try {
      const [rangeResult, assetResults, blobResult] = await Promise.all([
        testHttpRangeSupport(),
        testAllEmulatorAssets(),
        testBlobAndEnvironment(),
      ]);

      this.updateDiagnostics({
        rangeRequestSupported: rangeResult.supported,
        rangeHttpStatus: rangeResult.status ?? undefined,
        assets: assetResults,
        blobAccessible: blobResult.blobAccessible,
        corsCspStatus: blobResult.corsCspStatus,
      });

      if (!rangeResult.supported) {
        this.addLog('warn', `Range request test did not return 206 (${rangeResult.error || rangeResult.status}). CheerpJ may still report a clearer error below.`);
      }
      for (const asset of assetResults) {
        this.addLog(asset.status === 'LOADED' ? 'info' : 'error',
          `Asset ${asset.status}: ${asset.name} ${asset.url}${asset.httpStatus ? ` [HTTP ${asset.httpStatus}]` : ''}`);
      }

      const ready = await this.waitForRunnerReady();
      if (!ready || !this.getActiveRunnerWindow()) {
        const error = 'Standalone runner did not complete opener handshake within 10 seconds.';
        this.addLog('error', error);
        this.updateDiagnostics({ selfTestStatus: 'FAIL', selfTestRootCause: error, currentStage: 'ERROR' });
        this.setStatus('ERROR');
        return false;
      }

      this.getActiveRunnerWindow()!.postMessage({ type: 'RUN_SELF_TEST' }, '*');
      return true; // final PASS/FAIL arrives asynchronously as SELF_TEST_RESULT
    } catch (error) {
      const message = error instanceof Error ? (error.stack || error.message) : String(error);
      this.addLog('error', `Self-test setup failed: ${message}`);
      this.updateDiagnostics({ selfTestStatus: 'FAIL', selfTestRootCause: message, currentStage: 'ERROR' });
      this.setStatus('ERROR');
      return false;
    }
  }

  public async loadJar(jarData: Blob | ArrayBuffer, fileName: string, manifest: ManifestInfo): Promise<void> {
    // Open the standalone runner before the first await so this remains tied to the user gesture.
    const runner = this.ensurePopoutRunner();
    if (!runner) return;
    this.cleanupBlobUrl();

    const jarBuffer = jarData instanceof ArrayBuffer ? jarData.slice(0) : await jarData.arrayBuffer();
    const midlet = parseMidlet1(manifest);
    const mainClass = midlet?.mainClass || 'main.GameMidlet';

    const blob = new Blob([jarBuffer], { type: 'application/java-archive' });
    this.activeBlobUrl = URL.createObjectURL(blob);
    this.lastJar = { jarBuffer, fileName, mainClass, manifest };

    this.updateDiagnostics({
      jarByteLength: jarBuffer.byteLength,
      blobCreated: true,
      blobUrlStatus: 'Created in RAM',
      jarHandedToEmulator: false,
      emulatorAcknowledgedJar: false,
      currentStage: 'LOADING_RUNTIME',
      stageError: undefined,
    });

    this.addLog('info', `JAR prepared in RAM: ${fileName} (${jarBuffer.byteLength} bytes)`);
    this.addLog('info', `MIDlet: ${midlet?.name || 'unknown'} -> ${mainClass}`);

    // CRITICAL: never launch a newly built JAR inside an already-running CheerpJ JVM.
    // FreeJ2ME keeps Java static/classloader state alive, which made the previous TEST
    // value appear again even after a newer patched JAR had validated successfully.
    // Always hard-reload the standalone runner; its runId handshake will resend lastJar.
    if (!this.navigateRunnerToFreshRuntime(`load ${fileName}`)) return;
  }

  private async sendLastJarToRunner(): Promise<void> {
    const target = this.getActiveRunnerWindow();
    if (!this.lastJar || !target) return;
    const { jarBuffer, fileName, mainClass, manifest } = this.lastJar;

    this.setStatus('LOADING_RUNTIME');
    this.updateDiagnostics({
      currentStage: 'LOADING_RUNTIME',
      jarHandedToEmulator: true,
      emulatorAcknowledgedJar: false,
      stageError: undefined,
    });
    this.armStageTimeout('LOADING_RUNTIME');
    this.addLog('info', `Handoff -> runner: ${fileName} (${jarBuffer.byteLength} bytes)`);

    // Do not transfer/detach this buffer: restart() deliberately reuses it.
    target.postMessage({
      type: 'LOAD_JAR',
      jarBuffer,
      fileName,
      mainClass,
      manifest,
    }, '*');
  }

  public async start(): Promise<void> {
    if (this.lastJar) await this.sendLastJarToRunner();
  }

  public async restart(): Promise<void> {
    this.addLog('info', 'Restarting J2ME runtime with a fresh JVM; the last JAR will be loaded again after handshake.');
    const runner = this.ensurePopoutRunner();
    if (!runner) {
      this.restartOnReady = false;
      return;
    }
    this.navigateRunnerToFreshRuntime('manual restart');
  }

  public async stop(): Promise<void> {
    this.clearStageTimeout();
    this.getActiveRunnerWindow()?.postMessage({ type: 'STOP' }, '*');
    this.setStatus('STOPPED');
    this.addLog('info', 'Stop requested. Use Restart/Run Original for a fresh runtime.');
  }

  public sendKey(keyCode: number, type: 'down' | 'up'): void {
    if (this.status !== 'RUNNING') return;
    this.getActiveRunnerWindow()?.postMessage({
      type: 'SEND_KEY',
      keyCode,
      keyAction: type,
    }, '*');
  }

  public setSound(enabled: boolean): void {
    this.soundEnabled = enabled;
    this.addLog('info', `Sound preference: ${enabled ? 'ON' : 'OFF'} (MIDI is stubbed in current standalone runner).`);
  }

  public setScreenSize(size: EmulatorScreenSize): void {
    this.currentScreenSize = size;
    this.addLog('info', `Requested shell size: ${size}. Game Canvas size is controlled by FreeJ2ME.`);
  }

  public getStatus(): EmulatorRuntimeStatus { return this.status; }
  public getLogs(): EmulatorLogEntry[] { return [...this.logs]; }

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

  private cleanupBlobUrl(): void {
    if (!this.activeBlobUrl) return;
    URL.revokeObjectURL(this.activeBlobUrl);
    this.activeBlobUrl = null;
  }

  public dispose(): void {
    this.clearStageTimeout();
    this.cleanupBlobUrl();
    if (this.messageListener) window.removeEventListener('message', this.messageListener);
    this.messageListener = null;
    this.lastJar = null;
    if (this.runnerWindow && !this.runnerWindow.closed) {
      try { this.runnerWindow.close(); } catch (_) {}
    }
    this.runnerWindow = null;
    this.expectedRunnerRunId = null;
    this.iframeElement = null;
    this.iframeReady = false;
    this.logListeners.clear();
    this.statusListeners.clear();
    this.diagnosticsListeners.clear();
    this.status = 'IDLE';
  }
}
