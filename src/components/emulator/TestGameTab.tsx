import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Play,
  RotateCcw,
  Square,
  FileArchive,
  Copy,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { LoadedJarSession } from '../../types/jar';
import {
  EmulatorSourceType,
  EmulatorRuntimeStatus,
  EmulatorScreenSize,
  EmulatorLogEntry,
  J2ME_KEYS,
} from '../../types/emulator';
import { DefaultJ2meTestSession, parseMidlet1 } from '../../services/j2meSessionService';

interface TestGameTabProps {
  session: LoadedJarSession;
  initialSource?: EmulatorSourceType;
  onNavigateToPatchBuilder?: () => void;
}

function shortHash(buffer: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) return Promise.resolve('unavailable');
  return crypto.subtle.digest('SHA-256', buffer).then((digest) =>
    Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 16)
  );
}

export function TestGameTab({
  session,
  initialSource = 'ORIGINAL',
  onNavigateToPatchBuilder,
}: TestGameTabProps) {
  // IMPORTANT: source must follow App.tsx / ChangesPanel.tsx. The old implementation
  // hard-coded ORIGINAL here and therefore always ran session.originalFile.
  const [source, setSource] = useState<EmulatorSourceType>(initialSource);
  const [runtimeStatus, setRuntimeStatus] = useState<EmulatorRuntimeStatus>('IDLE');
  const [screenSize, setScreenSize] = useState<EmulatorScreenSize>('240x320');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [logs, setLogs] = useState<EmulatorLogEntry[]>([]);
  const [isFocused, setIsFocused] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  const testSessionRef = useRef<DefaultJ2meTestSession | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const candidate = session.candidateOutput;
  const patchedAvailable = candidate?.status === 'VALIDATED';

  useEffect(() => {
    setSource(initialSource);
  }, [initialSource]);

  useEffect(() => {
    // Never pretend an old candidate is the current patched source.
    if (source === 'PATCHED' && !patchedAvailable) {
      setSource('ORIGINAL');
    }
  }, [source, patchedAvailable]);

  useEffect(() => {
    const sess = new DefaultJ2meTestSession();
    testSessionRef.current = sess;

    const offLog = sess.onLog((entry) => {
      setLogs((prev) => [...prev.slice(-499), entry]);
    });
    const offStatus = sess.onStatusChange((status) => setRuntimeStatus(status));

    return () => {
      offLog();
      offStatus();
      sess.dispose();
      testSessionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (testSessionRef.current && iframeRef.current) {
      testSessionRef.current.bindIframe(iframeRef.current);
    }
  }, []);

  const loadActiveJar = useCallback(async () => {
    const sess = testSessionRef.current;
    if (!sess || isStarting) return;

    setIsStarting(true);
    try {
      if (source === 'PATCHED') {
        const current = session.candidateOutput;
        if (!current || current.status !== 'VALIDATED') {
          sess.addLog('error', '[Source: PATCHED] Không có candidateOutput VALIDATED. Không fallback sang Original.');
          return;
        }

        const bytes = await current.blob.arrayBuffer();
        const sha = await shortHash(bytes);
        sess.addLog(
          'info',
          `[Source: PATCHED] Loading EXACT candidate: ${current.fileName} (${bytes.byteLength} bytes, sha256:${sha})`
        );
        await sess.loadJar(bytes, current.fileName, session.jarInfo.manifest);
        return;
      }

      const originalBytes = await session.originalFile.arrayBuffer();
      const sha = await shortHash(originalBytes);
      sess.addLog(
        'info',
        `[Source: ORIGINAL] Loading original: ${session.jarInfo.fileName} (${originalBytes.byteLength} bytes, sha256:${sha})`
      );
      await sess.loadJar(originalBytes, session.jarInfo.fileName, session.jarInfo.manifest);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sess.addLog('error', `[TestGameTab] Failed to load ${source}: ${message}`);
    } finally {
      setIsStarting(false);
    }
  }, [isStarting, session, source]);

  const switchSource = useCallback(async (next: EmulatorSourceType) => {
    if (next === 'PATCHED' && !patchedAvailable) return;
    if (next === source) return;
    await testSessionRef.current?.stop();
    setSource(next);
  }, [patchedAvailable, source]);

  const sendKey = useCallback((keyCode: number, type: 'down' | 'up') => {
    testSessionRef.current?.sendKey(keyCode, type);
  }, []);

  useEffect(() => {
    const mapKey = (key: string): number | null => {
      switch (key) {
        case 'ArrowUp': return J2ME_KEYS.UP;
        case 'ArrowDown': return J2ME_KEYS.DOWN;
        case 'ArrowLeft': return J2ME_KEYS.LEFT;
        case 'ArrowRight': return J2ME_KEYS.RIGHT;
        case 'Enter': return J2ME_KEYS.FIRE;
        case 'q': case 'Q': case 'F1': return J2ME_KEYS.KEY_SOFT_LEFT;
        case 'w': case 'W': case 'F2': return J2ME_KEYS.KEY_SOFT_RIGHT;
        case '0': return J2ME_KEYS.KEY_NUM0;
        case '1': return J2ME_KEYS.KEY_NUM1;
        case '2': return J2ME_KEYS.KEY_NUM2;
        case '3': return J2ME_KEYS.KEY_NUM3;
        case '4': return J2ME_KEYS.KEY_NUM4;
        case '5': return J2ME_KEYS.KEY_NUM5;
        case '6': return J2ME_KEYS.KEY_NUM6;
        case '7': return J2ME_KEYS.KEY_NUM7;
        case '8': return J2ME_KEYS.KEY_NUM8;
        case '9': return J2ME_KEYS.KEY_NUM9;
        case '*': case 'e': case 'E': return J2ME_KEYS.KEY_STAR;
        case '#': case 'r': case 'R': return J2ME_KEYS.KEY_POUND;
        default: return null;
      }
    };

    const down = (e: KeyboardEvent) => {
      if (!isFocused) return;
      const tag = document.activeElement?.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      const code = mapKey(e.key);
      if (code !== null) {
        e.preventDefault();
        sendKey(code, 'down');
      }
    };
    const up = (e: KeyboardEvent) => {
      if (!isFocused) return;
      const code = mapKey(e.key);
      if (code !== null) {
        e.preventDefault();
        sendKey(code, 'up');
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [isFocused, sendKey]);

  const currentName =
    source === 'PATCHED' && patchedAvailable
      ? candidate!.fileName
      : session.jarInfo.fileName;
  const midlet = parseMidlet1(session.jarInfo.manifest);

  const keyButton = (label: string, code: number) => (
    <button
      type="button"
      onMouseDown={() => sendKey(code, 'down')}
      onMouseUp={() => sendKey(code, 'up')}
      onMouseLeave={() => sendKey(code, 'up')}
      className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs font-mono text-zinc-200 active:scale-95"
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="text-sm font-bold text-zinc-100">J2ME Test Runner</div>
            <div className="text-[11px] font-mono text-zinc-500">
              MIDlet: {midlet?.mainClass || 'main.GameMidlet'}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => switchSource('ORIGINAL')}
              className={`px-3 py-1.5 rounded-lg border text-xs font-mono ${
                source === 'ORIGINAL'
                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-400'
              }`}
            >
              <FileArchive className="inline w-3.5 h-3.5 mr-1" /> Original
            </button>
            <button
              type="button"
              disabled={!patchedAvailable}
              onClick={() => switchSource('PATCHED')}
              className={`px-3 py-1.5 rounded-lg border text-xs font-mono disabled:opacity-40 disabled:cursor-not-allowed ${
                source === 'PATCHED'
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-400'
              }`}
              title={patchedAvailable ? candidate?.fileName : 'Chưa có Patched JAR VALIDATED'}
            >
              Patched {patchedAvailable ? '✓' : '(unavailable)'}
            </button>
          </div>
        </div>

        <div className={`p-3 rounded-lg border text-xs font-mono ${
          source === 'PATCHED'
            ? 'bg-amber-950/20 border-amber-700/40 text-amber-200'
            : 'bg-zinc-950 border-zinc-800 text-zinc-300'
        }`}>
          <div><strong>ACTIVE SOURCE:</strong> {source}</div>
          <div className="truncate"><strong>JAR:</strong> {currentName}</div>
          {source === 'PATCHED' && (
            <div><strong>Candidate status:</strong> {candidate?.status}</div>
          )}
        </div>

        {initialSource === 'PATCHED' && !patchedAvailable && (
          <div className="flex gap-2 p-3 rounded-lg border border-red-800 bg-red-950/30 text-red-300 text-xs font-mono">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>App yêu cầu PATCHED nhưng candidateOutput không còn VALIDATED. Build Patched JAR lại trước khi test.</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={loadActiveJar}
            disabled={isStarting || (source === 'PATCHED' && !patchedAvailable)}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-zinc-950 font-bold text-xs font-mono flex items-center gap-1.5"
          >
            <Play className="w-4 h-4 fill-current" />
            {isStarting ? 'Starting...' : `Run ${source === 'PATCHED' ? 'Patched' : 'Original'} JAR`}
          </button>
          <button
            type="button"
            onClick={() => testSessionRef.current?.restart()}
            className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs font-mono text-zinc-200 flex items-center gap-1.5"
          >
            <RotateCcw className="w-4 h-4" /> Restart
          </button>
          <button
            type="button"
            onClick={() => testSessionRef.current?.stop()}
            className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-red-950/40 border border-zinc-700 text-xs font-mono text-zinc-200 flex items-center gap-1.5"
          >
            <Square className="w-4 h-4" /> Stop
          </button>
          <button
            type="button"
            onClick={() => {
              const next = !soundEnabled;
              setSoundEnabled(next);
              testSessionRef.current?.setSound(next);
            }}
            className="p-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300"
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          <select
            value={screenSize}
            onChange={(e) => {
              const next = e.target.value as EmulatorScreenSize;
              setScreenSize(next);
              testSessionRef.current?.setScreenSize(next);
            }}
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-2 text-xs font-mono text-zinc-300"
          >
            <option value="240x320">240x320</option>
            <option value="176x220">176x220</option>
            <option value="128x160">128x160</option>
            <option value="320x240">320x240</option>
            <option value="360x640">360x640</option>
          </select>
          {onNavigateToPatchBuilder && (
            <button
              type="button"
              onClick={onNavigateToPatchBuilder}
              className="ml-auto px-3 py-2 rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs font-mono"
            >
              Back to Items
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div
          ref={containerRef}
          onClick={() => setIsFocused(true)}
          className={`bg-zinc-900 border rounded-xl p-4 space-y-3 ${isFocused ? 'border-emerald-500/60' : 'border-zinc-800'}`}
        >
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-zinc-300">Game Screen</span>
            <span className={runtimeStatus === 'RUNNING' ? 'text-emerald-400' : 'text-zinc-500'}>
              {runtimeStatus}
            </span>
          </div>
          <div className="flex justify-center bg-black rounded-lg p-2 min-h-[340px]">
            <iframe
              ref={iframeRef}
              src="/emulator/index.html"
              title="J2ME Isolated Runner"
              className="w-[240px] h-[320px] border border-zinc-800 bg-black"
            />
          </div>
          <div className="flex justify-center gap-2 flex-wrap">
            {keyButton('LSK (Q)', J2ME_KEYS.KEY_SOFT_LEFT)}
            {keyButton('↑', J2ME_KEYS.UP)}
            {keyButton('Enter', J2ME_KEYS.FIRE)}
            {keyButton('↓', J2ME_KEYS.DOWN)}
            {keyButton('RSK (W)', J2ME_KEYS.KEY_SOFT_RIGHT)}
          </div>
          <div className="text-center text-[10px] text-zinc-500 font-mono">
            Click khung này để bật keyboard: arrows, Enter, Q/W, 0-9, E(*), R(#)
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden flex flex-col min-h-[420px]">
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-bold text-zinc-200">
              {runtimeStatus === 'RUNNING' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <FileArchive className="w-4 h-4 text-zinc-500" />
              )}
              Runtime Console
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(logs.map((l) => `[${l.timestamp}] [${l.level}] ${l.message}`).join('\n'))}
                className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400"
                title="Copy logs"
              >
                <Copy className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  testSessionRef.current?.clearLogs();
                  setLogs([]);
                }}
                className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400"
                title="Clear logs"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="p-3 overflow-auto font-mono text-[11px] space-y-1 flex-1 bg-zinc-950/50">
            {logs.length === 0 ? (
              <div className="text-zinc-600">Chưa có log. Chọn source rồi bấm Run.</div>
            ) : (
              logs.map((log) => (
                <div key={log.id} className={
                  log.level === 'error' ? 'text-red-400' :
                  log.level === 'warn' ? 'text-amber-400' :
                  log.message.includes('[Source: PATCHED]') ? 'text-amber-300' :
                  log.message.includes('[Source: ORIGINAL]') ? 'text-sky-300' :
                  'text-zinc-400'
                }>
                  <span className="text-zinc-600 mr-2">{log.timestamp}</span>{log.message}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
