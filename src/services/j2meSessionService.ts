import { ManifestInfo } from '../types/jar';
import {
  J2meTestSession,
  EmulatorRuntimeStatus,
  EmulatorScreenSize,
  EmulatorLogEntry,
  MidletAppInfo,
  J2ME_KEYS,
} from '../types/emulator';

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

  private activeBlobUrl: string | null = null;
  private iframeElement: HTMLIFrameElement | null = null;
  private currentFileName: string = '';
  private currentMidlet: MidletAppInfo | null = null;
  private currentScreenSize: EmulatorScreenSize = '240x320';
  private soundEnabled: boolean = true;
  private messageListener: ((e: MessageEvent) => void) | null = null;

  constructor() {
    this.setupMessageBridge();
  }

  /**
   * Bind iframe element to communicate with the isolated runner.
   */
  public bindIframe(iframe: HTMLIFrameElement | null) {
    this.iframeElement = iframe;
  }

  private setupMessageBridge() {
    this.messageListener = (event: MessageEvent) => {
      // Security check: only accept from same origin
      if (event.origin !== window.location.origin && event.origin !== 'null' && event.origin !== '') {
        return;
      }

      const data = event.data;
      if (!data || typeof data !== 'object' || data.source !== 'j2me-runner') {
        return;
      }

      switch (data.type) {
        case 'STATUS_CHANGE':
          this.setStatus(data.status);
          break;
        case 'LOG':
          this.addLog(data.level || 'info', data.message);
          break;
        case 'ERROR':
          this.addLog('error', data.message);
          this.setStatus('ERROR');
          break;
        case 'UNSUPPORTED':
          this.addLog('warn', `Unsupported J2ME API: ${data.api || data.message}`);
          this.setStatus('UNSUPPORTED');
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
      this.statusListeners.forEach((l) => l(newStatus));
    }
  }

  public async loadJar(
    jarData: Blob | ArrayBuffer,
    fileName: string,
    manifest: ManifestInfo
  ): Promise<void> {
    this.cleanupBlobUrl();
    this.setStatus('LOADING');
    this.currentFileName = fileName;

    // Detect MIDlet
    const midlet = parseMidlet1(manifest);
    this.currentMidlet = midlet;

    this.addLog('info', `========================================`);
    this.addLog('info', `Loading J2ME JAR: ${fileName}`);
    if (midlet) {
      this.addLog('info', `MIDlet Detected: ${midlet.name} -> Class: ${midlet.mainClass}`);
    } else {
      this.addLog('warn', `Manifest does not specify MIDlet-1. Using fallback detection.`);
    }

    // Convert to Blob if ArrayBuffer
    const blob = jarData instanceof Blob ? jarData : new Blob([jarData], { type: 'application/java-archive' });
    this.activeBlobUrl = URL.createObjectURL(blob);

    this.addLog('info', `JAR Blob handoff ready (${(blob.size / 1024 / 1024).toFixed(2)} MB in RAM).`);

    // Post message to iframe if bound
    if (this.iframeElement?.contentWindow) {
      this.iframeElement.contentWindow.postMessage(
        {
          target: 'j2me-runner',
          type: 'LOAD_JAR',
          jarUrl: this.activeBlobUrl,
          fileName,
          midletClass: midlet?.mainClass,
          midletName: midlet?.name,
          screenSize: this.currentScreenSize,
          sound: this.soundEnabled,
        },
        window.location.origin
      );
    }
  }

  public async start(): Promise<void> {
    if (!this.iframeElement?.contentWindow) {
      this.addLog('error', 'Emulator iframe container is not ready.');
      this.setStatus('ERROR');
      return;
    }

    this.addLog('info', `Starting J2ME execution loop for ${this.currentFileName}...`);
    this.iframeElement.contentWindow.postMessage(
      {
        target: 'j2me-runner',
        type: 'START',
      },
      window.location.origin
    );
    this.setStatus('RUNNING');
  }

  public async restart(): Promise<void> {
    this.addLog('info', `Restarting J2ME emulator session...`);
    if (this.iframeElement?.contentWindow) {
      this.iframeElement.contentWindow.postMessage(
        {
          target: 'j2me-runner',
          type: 'RESTART',
        },
        window.location.origin
      );
    }
  }

  public async stop(): Promise<void> {
    this.addLog('info', `Stopping J2ME emulator session.`);
    if (this.iframeElement?.contentWindow) {
      this.iframeElement.contentWindow.postMessage(
        {
          target: 'j2me-runner',
          type: 'STOP',
        },
        window.location.origin
      );
    }
    this.setStatus('STOPPED');
  }

  public sendKey(keyCode: number, type: 'down' | 'up'): void {
    if (this.iframeElement?.contentWindow && (this.status === 'RUNNING' || this.status === 'PAUSED')) {
      this.iframeElement.contentWindow.postMessage(
        {
          target: 'j2me-runner',
          type: 'KEY_EVENT',
          keyCode,
          keyAction: type,
        },
        window.location.origin
      );
    }
  }

  public setSound(enabled: boolean): void {
    this.soundEnabled = enabled;
    this.addLog('info', `Audio ${enabled ? 'ENABLED' : 'MUTED'}`);
    if (this.iframeElement?.contentWindow) {
      this.iframeElement.contentWindow.postMessage(
        {
          target: 'j2me-runner',
          type: 'SET_SOUND',
          sound: enabled,
        },
        window.location.origin
      );
    }
  }

  public setScreenSize(size: EmulatorScreenSize): void {
    this.currentScreenSize = size;
    this.addLog('info', `Display resolution changed to ${size}`);
    if (this.iframeElement?.contentWindow) {
      this.iframeElement.contentWindow.postMessage(
        {
          target: 'j2me-runner',
          type: 'SET_SCREEN_SIZE',
          screenSize: size,
        },
        window.location.origin
      );
    }
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
    this.stop();
    this.cleanupBlobUrl();
    if (this.messageListener) {
      window.removeEventListener('message', this.messageListener);
      this.messageListener = null;
    }
    this.logListeners.clear();
    this.statusListeners.clear();
    this.iframeElement = null;
    this.status = 'IDLE';
  }
}
