import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play,
  RotateCcw,
  Square,
  Volume2,
  VolumeX,
  Terminal,
  Trash2,
  Copy,
  CheckCircle2,
  AlertTriangle,
  FileArchive,
  ShieldCheck,
  XCircle,
  Activity,
  Cpu,
  Globe,
  Radio,
} from 'lucide-react';
import { LoadedJarSession } from '../../types/jar';
import {
  EmulatorSourceType,
  EmulatorRuntimeStatus,
  EmulatorScreenSize,
  EmulatorPhoneType,
  EmulatorLogEntry,
  EmulatorDiagnosticsInfo,
  J2ME_KEYS,
} from '../../types/emulator';
import { DefaultJ2meTestSession, parseMidlet1 } from '../../services/j2meSessionService';
import { INITIAL_DIAGNOSTICS } from '../../services/emulatorDiagnosticsService';

interface TestGameTabProps {
  session: LoadedJarSession;
  initialSource?: EmulatorSourceType;
  onNavigateToPatchBuilder?: () => void;
}

const STAGES: { key: string; label: string }[] = [
  { key: 'IDLE', label: 'Idle' },
  { key: 'LOADING_RUNTIME', label: 'Loading Runtime' },
  { key: 'RUNTIME_READY', label: 'Runtime Ready' },
  { key: 'MOUNTING_JAR', label: 'Mounting JAR' },
  { key: 'JAR_MOUNTED', label: 'JAR Mounted' },
  { key: 'STARTING_MIDLET', label: 'Starting MIDlet' },
  { key: 'RUNNING', label: 'Running' },
];

export function TestGameTab({
  session,
  initialSource = 'ORIGINAL',
}: TestGameTabProps) {
  // Requirement 13: Strictly isolate to ORIGINAL JAR
  const [source] = useState<EmulatorSourceType>('ORIGINAL');
  const [runtimeStatus, setRuntimeStatus] = useState<EmulatorRuntimeStatus>('IDLE');
  const [diagnostics, setDiagnostics] = useState<EmulatorDiagnosticsInfo>(INITIAL_DIAGNOSTICS);
  const [screenSize, setScreenSize] = useState<EmulatorScreenSize>('240x320');
  const [phoneType, setPhoneType] = useState<EmulatorPhoneType>('nokia');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [isFocused, setIsFocused] = useState<boolean>(false);
  const [logs, setLogs] = useState<EmulatorLogEntry[]>([]);
  const [copiedLogs, setCopiedLogs] = useState<boolean>(false);
  const [pressedKeyCodes, setPressedKeyCodes] = useState<Set<number>>(new Set());
  const [isSelfTesting, setIsSelfTesting] = useState<boolean>(false);

  // Emulator Session Reference
  const testSessionRef = useRef<DefaultJ2meTestSession | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Initialize Session
  useEffect(() => {
    const sess = new DefaultJ2meTestSession();
    testSessionRef.current = sess;

    const unsubLog = sess.onLog((entry) => {
      setLogs((prev) => [...prev.slice(-400), entry]);
    });

    const unsubStatus = sess.onStatusChange((status) => {
      setRuntimeStatus(status);
    });

    const unsubDiag = sess.onDiagnosticsChange((diag) => {
      setDiagnostics({ ...diag });
    });

    return () => {
      unsubLog();
      unsubStatus();
      unsubDiag();
      sess.dispose();
      testSessionRef.current = null;
    };
  }, []);

  // Bind iframe
  useEffect(() => {
    if (testSessionRef.current && iframeRef.current) {
      testSessionRef.current.bindIframe(iframeRef.current);
    }
  }, []);

  // Handle Load JAR when Source changes or on mount
  const loadActiveJar = useCallback(async () => {
    const sess = testSessionRef.current;
    if (!sess) return;

    sess.addLog('info', `[Source: ORIGINAL] Đang nạp file gốc: ${session.jarInfo.fileName}`);
    await sess.loadJar(
      session.originalFile,
      session.jarInfo.fileName,
      session.jarInfo.manifest
    );
  }, [session.jarInfo.fileName, session.jarInfo.manifest, session.originalFile]);

  // Self-Test Handler
  const handleRunSelfTest = async () => {
    const sess = testSessionRef.current;
    if (!sess) return;
    setIsSelfTesting(true);
    try {
      await sess.runSelfTest();
    } finally {
      setIsSelfTesting(false);
    }
  };

  // Playback Handlers
  const handleStart = () => {
    loadActiveJar();
  };

  const handleRestart = () => {
    testSessionRef.current?.restart();
  };

  const handleStop = () => {
    testSessionRef.current?.stop();
  };

  const handleToggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    testSessionRef.current?.setSound(next);
  };

  const handleScreenSizeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const size = e.target.value as EmulatorScreenSize;
    setScreenSize(size);
    testSessionRef.current?.setScreenSize(size);
  };

  const handleCopyLogs = () => {
    const text = logs.map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopiedLogs(true);
    setTimeout(() => setCopiedLogs(false), 2000);
  };

  const handleClearLogs = () => {
    testSessionRef.current?.clearLogs();
    setLogs([]);
  };

  // Virtual Keypad Sender
  const sendKey = useCallback((keyCode: number, type: 'down' | 'up') => {
    testSessionRef.current?.sendKey(keyCode, type);
    setPressedKeyCodes((prev) => {
      const next = new Set(prev);
      if (type === 'down') {
        next.add(keyCode);
      } else {
        next.delete(keyCode);
      }
      return next;
    });
  }, []);

  // Keyboard Event Listener (Only when isFocused is true)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isFocused) return;
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
        return;
      }

      let code: number | null = null;
      switch (e.key) {
        case 'ArrowUp':
          code = J2ME_KEYS.UP;
          break;
        case 'ArrowDown':
          code = J2ME_KEYS.DOWN;
          break;
        case 'ArrowLeft':
          code = J2ME_KEYS.LEFT;
          break;
        case 'ArrowRight':
          code = J2ME_KEYS.RIGHT;
          break;
        case 'Enter':
          code = J2ME_KEYS.FIRE;
          break;
        case 'F1':
        case 'q':
        case 'Q':
          code = J2ME_KEYS.KEY_SOFT_LEFT;
          break;
        case 'F2':
        case 'w':
        case 'W':
          code = J2ME_KEYS.KEY_SOFT_RIGHT;
          break;
        case '0':
          code = J2ME_KEYS.KEY_NUM0;
          break;
        case '1':
          code = J2ME_KEYS.KEY_NUM1;
          break;
        case '2':
          code = J2ME_KEYS.KEY_NUM2;
          break;
        case '3':
          code = J2ME_KEYS.KEY_NUM3;
          break;
        case '4':
          code = J2ME_KEYS.KEY_NUM4;
          break;
        case '5':
          code = J2ME_KEYS.KEY_NUM5;
          break;
        case '6':
          code = J2ME_KEYS.KEY_NUM6;
          break;
        case '7':
          code = J2ME_KEYS.KEY_NUM7;
          break;
        case '8':
          code = J2ME_KEYS.KEY_NUM8;
          break;
        case '9':
          code = J2ME_KEYS.KEY_NUM9;
          break;
        case 'e':
        case 'E':
        case '*':
          code = J2ME_KEYS.KEY_STAR;
          break;
        case 'r':
        case 'R':
        case '#':
          code = J2ME_KEYS.KEY_POUND;
          break;
      }

      if (code !== null) {
        e.preventDefault();
        sendKey(code, 'down');
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!isFocused) return;
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
        return;
      }

      let code: number | null = null;
      switch (e.key) {
        case 'ArrowUp':
          code = J2ME_KEYS.UP;
          break;
        case 'ArrowDown':
          code = J2ME_KEYS.DOWN;
          break;
        case 'ArrowLeft':
          code = J2ME_KEYS.LEFT;
          break;
        case 'ArrowRight':
          code = J2ME_KEYS.RIGHT;
          break;
        case 'Enter':
          code = J2ME_KEYS.FIRE;
          break;
        case 'F1':
        case 'q':
        case 'Q':
          code = J2ME_KEYS.KEY_SOFT_LEFT;
          break;
        case 'F2':
        case 'w':
        case 'W':
          code = J2ME_KEYS.KEY_SOFT_RIGHT;
          break;
        case '0':
          code = J2ME_KEYS.KEY_NUM0;
          break;
        case '1':
          code = J2ME_KEYS.KEY_NUM1;
          break;
        case '2':
          code = J2ME_KEYS.KEY_NUM2;
          break;
        case '3':
          code = J2ME_KEYS.KEY_NUM3;
          break;
        case '4':
          code = J2ME_KEYS.KEY_NUM4;
          break;
        case '5':
          code = J2ME_KEYS.KEY_NUM5;
          break;
        case '6':
          code = J2ME_KEYS.KEY_NUM6;
          break;
        case '7':
          code = J2ME_KEYS.KEY_NUM7;
          break;
        case '8':
          code = J2ME_KEYS.KEY_NUM8;
          break;
        case '9':
          code = J2ME_KEYS.KEY_NUM9;
          break;
        case 'e':
        case 'E':
        case '*':
          code = J2ME_KEYS.KEY_STAR;
          break;
        case 'r':
        case 'R':
        case '#':
          code = J2ME_KEYS.KEY_POUND;
          break;
      }

      if (code !== null) {
        e.preventDefault();
        sendKey(code, 'up');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isFocused, sendKey]);

  // Click outside to defocus
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsFocused(false);
      }
    };
    document.addEventListener('mousedown', handleDocumentClick);
    return () => document.removeEventListener('mousedown', handleDocumentClick);
  }, []);

  const midlet = parseMidlet1(session.jarInfo.manifest);

  return (
    <div className="space-y-5">
      {/* Top Toolbar: Desktop Style Controls */}
      <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-4">
        {/* Source Selector (Locked to ORIGINAL as requested) */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-zinc-400 font-semibold">Source:</span>
          <div className="inline-flex rounded-lg bg-zinc-950 p-1 border border-zinc-800">
            <button
              id="source-original-button"
              type="button"
              className="px-3 py-1.5 rounded-md text-xs font-mono font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm flex items-center gap-1.5 cursor-default"
            >
              <FileArchive className="w-3.5 h-3.5" />
              <span>Original JAR (Active)</span>
            </button>

            <button
              id="source-patched-button"
              type="button"
              disabled={true}
              className="px-3 py-1.5 rounded-md text-xs font-mono font-medium text-zinc-600 cursor-not-allowed opacity-50 flex items-center gap-1.5"
              title="Tạm thời disable Patched mode. Chỉ debug: ORIGINAL JAR cho tới khi Original chạy được."
            >
              <span>Patched JAR (Disabled)</span>
            </button>
          </div>
        </div>

        {/* Playback Controls & Self-Test */}
        <div className="flex items-center gap-2">
          <button
            id="emulator-self-test-button"
            type="button"
            onClick={handleRunSelfTest}
            disabled={isSelfTesting || runtimeStatus === 'LOADING_RUNTIME' || runtimeStatus === 'MOUNTING_JAR'}
            className="px-3 py-1.5 rounded-lg text-xs font-mono font-medium bg-sky-950/60 hover:bg-sky-900/60 text-sky-300 border border-sky-800/80 disabled:opacity-50 disabled:pointer-events-none flex items-center gap-1.5 transition-colors cursor-pointer shadow"
            title="Kiểm tra CheerpJ, FreeJ2ME, Range request, và Assets mà không cần nạp game"
          >
            <Activity className={`w-3.5 h-3.5 ${isSelfTesting ? 'animate-spin' : ''}`} />
            <span>{isSelfTesting ? 'Testing...' : 'Run Emulator Self-Test'}</span>
          </button>

          <button
            id="emulator-start-button"
            type="button"
            onClick={handleStart}
            disabled={runtimeStatus === 'RUNNING' || runtimeStatus === 'LOADING_RUNTIME' || runtimeStatus === 'MOUNTING_JAR' || runtimeStatus === 'STARTING_MIDLET'}
            className="px-3.5 py-1.5 rounded-lg text-xs font-mono font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:pointer-events-none text-zinc-950 font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Run Original JAR</span>
          </button>

          <button
            id="emulator-restart-button"
            type="button"
            onClick={handleRestart}
            disabled={runtimeStatus === 'IDLE'}
            className="px-3 py-1.5 rounded-lg text-xs font-mono font-medium bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:pointer-events-none text-zinc-200 border border-zinc-700 flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Restart</span>
          </button>

          <button
            id="emulator-stop-button"
            type="button"
            onClick={handleStop}
            disabled={runtimeStatus === 'STOPPED' || runtimeStatus === 'IDLE'}
            className="px-3 py-1.5 rounded-lg text-xs font-mono font-medium bg-zinc-800 hover:bg-red-950/40 hover:text-red-300 disabled:opacity-50 disabled:pointer-events-none text-zinc-300 border border-zinc-700 hover:border-red-800/60 flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Square className="w-3.5 h-3.5" />
            <span>Stop</span>
          </button>
        </div>

        {/* Screen & Sound Config */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-mono">
            <span className="text-zinc-500">Screen:</span>
            <select
              value={screenSize}
              onChange={handleScreenSizeChange}
              className="bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs rounded-md px-2 py-1 outline-none focus:border-emerald-500 font-mono cursor-pointer"
            >
              <option value="240x320">240x320 (QVGA Standard)</option>
              <option value="176x220">176x220 (Mid-Range)</option>
              <option value="128x160">128x160 (Classic S40)</option>
              <option value="320x240">320x240 (Landscape)</option>
              <option value="360x640">360x640 (Touch S60v5)</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 text-xs font-mono">
            <span className="text-zinc-500">Device:</span>
            <select
              value={phoneType}
              onChange={(e) => setPhoneType(e.target.value as EmulatorPhoneType)}
              className="bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs rounded-md px-2 py-1 outline-none focus:border-emerald-500 font-mono cursor-pointer"
            >
              <option value="nokia">Nokia Series 40 / 60</option>
              <option value="standard">Standard J2ME MIDP 2.0</option>
              <option value="sonyericsson">Sony Ericsson</option>
              <option value="motorola">Motorola</option>
            </select>
          </div>

          <button
            type="button"
            onClick={handleToggleSound}
            className={`p-1.5 rounded-lg border text-xs font-mono flex items-center gap-1 transition-colors cursor-pointer ${
              soundEnabled
                ? 'bg-zinc-800 border-zinc-700 text-emerald-400'
                : 'bg-zinc-950 border-zinc-800 text-zinc-500'
            }`}
            title={soundEnabled ? 'Sound On' : 'Sound Muted'}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* State Machine Status Progression Bar */}
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3.5 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-mono font-semibold text-zinc-200">
              J2ME State Machine Progression
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-zinc-400">Current Stage:</span>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                runtimeStatus === 'RUNNING'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : runtimeStatus === 'ERROR'
                  ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                  : 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
              }`}
            >
              {runtimeStatus}
            </span>
          </div>
        </div>

        {/* Step Progression Visualizer */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-1.5 text-[11px] font-mono">
          {STAGES.map((s, idx) => {
            const isActive = runtimeStatus === s.key;
            const isPast =
              runtimeStatus === 'RUNNING' ||
              STAGES.findIndex((st) => st.key === runtimeStatus) > idx;

            return (
              <div
                key={s.key}
                className={`p-2 rounded-lg border text-center transition-all ${
                  isActive
                    ? 'bg-sky-950/80 border-sky-500 text-sky-200 font-bold shadow-sm'
                    : isPast
                    ? 'bg-emerald-950/30 border-emerald-800/60 text-emerald-300'
                    : 'bg-zinc-950 border-zinc-850 text-zinc-600'
                }`}
              >
                <div className="text-[9px] text-zinc-500 uppercase">Step {idx + 1}</div>
                <div className="truncate">{s.label}</div>
              </div>
            );
          })}
        </div>

        {/* Error / Timeout banner if stage is ERROR */}
        {runtimeStatus === 'ERROR' && (
          <div className="p-3 rounded-lg bg-red-950/40 border border-red-800/60 text-xs font-mono text-red-300 space-y-1">
            <div className="flex items-center gap-2 font-bold">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span>Initialization Failed or Timed Out (15s Watchdog)</span>
            </div>
            <p className="text-[11px] text-red-300/90 pl-6">
              {diagnostics.stageError || 'The emulator runtime failed to advance to the RUNNING state within the 15-second limit.'}
            </p>
          </div>
        )}

        {/* Range Header Notice */}
        {diagnostics.rangeRequestSupported === false && (
          <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-800/60 text-xs font-mono text-amber-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <strong>AI STUDIO PREVIEW SERVER INCOMPATIBLE WITH THIS EMULATOR RUNTIME:</strong> HTTP Range header test returned status {diagnostics.rangeHttpStatus} instead of 206 Partial Content.
            </span>
          </div>
        )}
      </div>

      {/* Main Runner Grid: Left Phone Shell, Right Diagnostics & Console */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: Phone Shell & LCD Canvas */}
        <div
          ref={containerRef}
          onClick={() => setIsFocused(true)}
          className={`lg:col-span-5 xl:col-span-5 flex flex-col items-center p-5 rounded-2xl bg-zinc-900/80 border transition-all ${
            isFocused
              ? 'border-emerald-500/80 ring-2 ring-emerald-500/20 shadow-lg'
              : 'border-zinc-800 shadow'
          }`}
        >
          {/* Focus indicator banner */}
          <div className="w-full flex items-center justify-between pb-3 mb-3 border-b border-zinc-800 text-[11px] font-mono">
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  isFocused ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'
                }`}
              />
              <span className={isFocused ? 'text-emerald-400 font-medium' : 'text-zinc-500'}>
                {isFocused ? 'Bàn phím PC ĐÃ KẾT NỐI' : 'Click vào để bắt đầu điều khiển'}
              </span>
            </div>
            <span className="text-zinc-500">Phím: Q/W, Mũi tên, Enter, 0-9</span>
          </div>

          {/* Retro Phone Shell (Nokia style) */}
          <div className="relative w-full max-w-[340px] bg-gradient-to-b from-zinc-800 via-zinc-850 to-zinc-900 border-4 border-zinc-700 rounded-[36px] p-4 shadow-2xl flex flex-col items-center">
            {/* Phone Earpiece */}
            <div className="w-14 h-1.5 bg-zinc-700 rounded-full mb-3 shadow-inner" />

            {/* LCD Screen Bezel */}
            <div className="w-full bg-zinc-950 p-2.5 rounded-xl border border-zinc-700 shadow-inner flex flex-col items-center">
              <iframe
                ref={iframeRef}
                src="/emulator/index.html"
                title="J2ME Isolated Runner"
                className="w-[240px] h-[320px] rounded border border-zinc-800 bg-black block"
                tabIndex={-1}
              />
            </div>

            {/* Soft Keys & D-Pad (Navigation) */}
            <div className="w-full mt-4 px-2 flex items-center justify-between gap-2">
              {/* Left Soft Key */}
              <button
                type="button"
                onMouseDown={() => sendKey(J2ME_KEYS.KEY_SOFT_LEFT, 'down')}
                onMouseUp={() => sendKey(J2ME_KEYS.KEY_SOFT_LEFT, 'up')}
                className={`flex-1 py-2 px-1 text-[11px] font-mono font-bold rounded-lg border text-center transition-transform active:scale-95 shadow cursor-pointer ${
                  pressedKeyCodes.has(J2ME_KEYS.KEY_SOFT_LEFT)
                    ? 'bg-emerald-500/40 text-emerald-200 border-emerald-400'
                    : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-750'
                }`}
              >
                LSK (Q)
              </button>

              {/* D-Pad 5-way Controller */}
              <div className="relative w-28 h-28 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full bg-zinc-800 border border-zinc-700 shadow-inner" />

                {/* Up */}
                <button
                  type="button"
                  onMouseDown={() => sendKey(J2ME_KEYS.UP, 'down')}
                  onMouseUp={() => sendKey(J2ME_KEYS.UP, 'up')}
                  className={`absolute top-1 left-1/2 -translate-x-1/2 w-8 h-7 flex items-center justify-center text-xs font-bold rounded hover:bg-zinc-700 active:scale-90 text-zinc-300 transition-transform cursor-pointer ${
                    pressedKeyCodes.has(J2ME_KEYS.UP) ? 'bg-emerald-500/40 text-emerald-200' : ''
                  }`}
                  title="Up (Arrow Up)"
                >
                  ▲
                </button>

                {/* Down */}
                <button
                  type="button"
                  onMouseDown={() => sendKey(J2ME_KEYS.DOWN, 'down')}
                  onMouseUp={() => sendKey(J2ME_KEYS.DOWN, 'up')}
                  className={`absolute bottom-1 left-1/2 -translate-x-1/2 w-8 h-7 flex items-center justify-center text-xs font-bold rounded hover:bg-zinc-700 active:scale-90 text-zinc-300 transition-transform cursor-pointer ${
                    pressedKeyCodes.has(J2ME_KEYS.DOWN) ? 'bg-emerald-500/40 text-emerald-200' : ''
                  }`}
                  title="Down (Arrow Down)"
                >
                  ▼
                </button>

                {/* Left */}
                <button
                  type="button"
                  onMouseDown={() => sendKey(J2ME_KEYS.LEFT, 'down')}
                  onMouseUp={() => sendKey(J2ME_KEYS.LEFT, 'up')}
                  className={`absolute left-1 top-1/2 -translate-y-1/2 w-7 h-8 flex items-center justify-center text-xs font-bold rounded hover:bg-zinc-700 active:scale-90 text-zinc-300 transition-transform cursor-pointer ${
                    pressedKeyCodes.has(J2ME_KEYS.LEFT) ? 'bg-emerald-500/40 text-emerald-200' : ''
                  }`}
                  title="Left (Arrow Left)"
                >
                  ◀
                </button>

                {/* Center / Fire */}
                <button
                  type="button"
                  onMouseDown={() => sendKey(J2ME_KEYS.FIRE, 'down')}
                  onMouseUp={() => sendKey(J2ME_KEYS.FIRE, 'up')}
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-[10px] font-bold z-10 shadow active:scale-90 transition-transform cursor-pointer ${
                    pressedKeyCodes.has(J2ME_KEYS.FIRE)
                      ? 'bg-emerald-500 text-zinc-950 font-extrabold'
                      : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200 border border-zinc-600'
                  }`}
                  title="Fire (Enter)"
                >
                  OK
                </button>

                {/* Right */}
                <button
                  type="button"
                  onMouseDown={() => sendKey(J2ME_KEYS.RIGHT, 'down')}
                  onMouseUp={() => sendKey(J2ME_KEYS.RIGHT, 'up')}
                  className={`absolute right-1 top-1/2 -translate-y-1/2 w-7 h-8 flex items-center justify-center text-xs font-bold rounded hover:bg-zinc-700 active:scale-90 text-zinc-300 transition-transform cursor-pointer ${
                    pressedKeyCodes.has(J2ME_KEYS.RIGHT) ? 'bg-emerald-500/40 text-emerald-200' : ''
                  }`}
                  title="Right (Arrow Right)"
                >
                  ▶
                </button>
              </div>

              {/* Right Soft Key */}
              <button
                type="button"
                onMouseDown={() => sendKey(J2ME_KEYS.KEY_SOFT_RIGHT, 'down')}
                onMouseUp={() => sendKey(J2ME_KEYS.KEY_SOFT_RIGHT, 'up')}
                className={`flex-1 py-2 px-1 text-[11px] font-mono font-bold rounded-lg border text-center transition-transform active:scale-95 shadow cursor-pointer ${
                  pressedKeyCodes.has(J2ME_KEYS.KEY_SOFT_RIGHT)
                    ? 'bg-emerald-500/40 text-emerald-200 border-emerald-400'
                    : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-750'
                }`}
              >
                RSK (W)
              </button>
            </div>

            {/* Numeric 12-Key Pad (0-9, *, #) */}
            <div className="w-full mt-3 grid grid-cols-3 gap-1.5 px-2">
              {[
                { code: J2ME_KEYS.KEY_NUM1, label: '1', sub: '.,' },
                { code: J2ME_KEYS.KEY_NUM2, label: '2', sub: 'abc' },
                { code: J2ME_KEYS.KEY_NUM3, label: '3', sub: 'def' },
                { code: J2ME_KEYS.KEY_NUM4, label: '4', sub: 'ghi' },
                { code: J2ME_KEYS.KEY_NUM5, label: '5', sub: 'jkl' },
                { code: J2ME_KEYS.KEY_NUM6, label: '6', sub: 'mno' },
                { code: J2ME_KEYS.KEY_NUM7, label: '7', sub: 'pqrs' },
                { code: J2ME_KEYS.KEY_NUM8, label: '8', sub: 'tuv' },
                { code: J2ME_KEYS.KEY_NUM9, label: '9', sub: 'wxyz' },
                { code: J2ME_KEYS.KEY_STAR, label: '*', sub: 'e' },
                { code: J2ME_KEYS.KEY_NUM0, label: '0', sub: '␣' },
                { code: J2ME_KEYS.KEY_POUND, label: '#', sub: 'r' },
              ].map((k) => (
                <button
                  key={k.code}
                  type="button"
                  onMouseDown={() => sendKey(k.code, 'down')}
                  onMouseUp={() => sendKey(k.code, 'up')}
                  className={`py-1.5 px-1 rounded-md border text-center transition-transform active:scale-95 shadow-sm cursor-pointer ${
                    pressedKeyCodes.has(k.code)
                      ? 'bg-emerald-500/40 text-emerald-200 border-emerald-400'
                      : 'bg-zinc-800/90 hover:bg-zinc-750 text-zinc-200 border-zinc-700'
                  }`}
                >
                  <div className="text-xs font-mono font-bold leading-none">{k.label}</div>
                  <div className="text-[8px] font-mono text-zinc-500 uppercase leading-none mt-0.5">
                    {k.sub}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Comprehensive Diagnostics & Runtime Console */}
        <div className="lg:col-span-7 xl:col-span-7 space-y-4">
          {/* Section 2: Real Runtime Implementation Diagnostic Matrix */}
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4 space-y-3.5">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-sky-400" />
                <span className="text-xs font-mono font-semibold text-zinc-200">
                  Runtime Implementation Diagnostics
                </span>
              </div>
              <div className="flex items-center gap-2">
                {diagnostics.selfTestStatus && diagnostics.selfTestStatus !== 'IDLE' && (
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                      diagnostics.selfTestStatus === 'PASS'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : diagnostics.selfTestStatus === 'FAIL'
                        ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                        : 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse'
                    }`}
                  >
                    SELF-TEST: {diagnostics.selfTestStatus}
                  </span>
                )}
              </div>
            </div>

            {/* Diagnostic Matrix Table */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs font-mono">
              <div className="bg-zinc-950 p-2.5 rounded border border-zinc-850">
                <div className="text-[10px] text-zinc-500 uppercase">Emulator Backend</div>
                <div className="font-semibold text-zinc-200 truncate">{diagnostics.backend}</div>
              </div>

              <div className="bg-zinc-950 p-2.5 rounded border border-zinc-850">
                <div className="text-[10px] text-zinc-500 uppercase">Emulator Version</div>
                <div className="font-semibold text-zinc-200">{diagnostics.version}</div>
              </div>

              <div className="bg-zinc-950 p-2.5 rounded border border-zinc-850">
                <div className="text-[10px] text-zinc-500 uppercase">CheerpJ Loaded</div>
                <div className="font-semibold">
                  {diagnostics.cheerpjLoaded ? (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> YES
                    </span>
                  ) : (
                    <span className="text-zinc-500 flex items-center gap-1">
                      <XCircle className="w-3 h-3" /> NO
                    </span>
                  )}
                </div>
              </div>

              <div className="bg-zinc-950 p-2.5 rounded border border-zinc-850">
                <div className="text-[10px] text-zinc-500 uppercase">FreeJ2ME Loaded</div>
                <div className="font-semibold">
                  {diagnostics.freej2meLoaded ? (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> YES
                    </span>
                  ) : (
                    <span className="text-zinc-500 flex items-center gap-1">
                      <XCircle className="w-3 h-3" /> NO
                    </span>
                  )}
                </div>
              </div>

              <div className="bg-zinc-950 p-2.5 rounded border border-zinc-850">
                <div className="text-[10px] text-zinc-500 uppercase">Runtime Script</div>
                <div className="font-semibold">
                  {diagnostics.runtimeScriptLoaded ? (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> YES
                    </span>
                  ) : (
                    <span className="text-zinc-500 flex items-center gap-1">
                      <XCircle className="w-3 h-3" /> NO
                    </span>
                  )}
                </div>
              </div>

              <div className="bg-zinc-950 p-2.5 rounded border border-zinc-850">
                <div className="text-[10px] text-zinc-500 uppercase">Runtime Initialized</div>
                <div className="font-semibold">
                  {diagnostics.runtimeInitialized ? (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> YES
                    </span>
                  ) : (
                    <span className="text-zinc-500 flex items-center gap-1">
                      <XCircle className="w-3 h-3" /> NO
                    </span>
                  )}
                </div>
              </div>

              <div className="bg-zinc-950 p-2.5 rounded border border-zinc-850">
                <div className="text-[10px] text-zinc-500 uppercase">Game JAR Mounted</div>
                <div className="font-semibold">
                  {diagnostics.gameJarMounted ? (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> YES
                    </span>
                  ) : (
                    <span className="text-zinc-500 flex items-center gap-1">
                      <XCircle className="w-3 h-3" /> NO
                    </span>
                  )}
                </div>
              </div>

              <div className="bg-zinc-950 p-2.5 rounded border border-zinc-850">
                <div className="text-[10px] text-zinc-500 uppercase">MIDlet Started</div>
                <div className="font-semibold">
                  {diagnostics.midletStarted ? (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> YES
                    </span>
                  ) : (
                    <span className="text-zinc-500 flex items-center gap-1">
                      <XCircle className="w-3 h-3" /> NO
                    </span>
                  )}
                </div>
              </div>

              <div className="bg-zinc-950 p-2.5 rounded border border-zinc-850">
                <div className="text-[10px] text-zinc-500 uppercase">Canvas Connected</div>
                <div className="font-semibold">
                  {diagnostics.canvasConnected ? (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> YES
                    </span>
                  ) : (
                    <span className="text-zinc-500 flex items-center gap-1">
                      <XCircle className="w-3 h-3" /> NO
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Section 7 & 9: Range Request & JAR Handoff Details */}
            <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-850 text-xs font-mono space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Range Request (bytes=0-1):</span>
                <span className="font-bold">
                  {diagnostics.rangeRequestSupported === true ? (
                    <span className="text-emerald-400">YES (HTTP 206 Partial Content)</span>
                  ) : diagnostics.rangeRequestSupported === false ? (
                    <span className="text-red-400">NO (HTTP {diagnostics.rangeHttpStatus})</span>
                  ) : (
                    <span className="text-zinc-500">Untested</span>
                  )}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Original JAR byteLength:</span>
                <span className="text-zinc-200">{diagnostics.jarByteLength ? `${diagnostics.jarByteLength} bytes` : `${session.originalFile.size} bytes`}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Blob Created / In RAM:</span>
                <span className={diagnostics.blobCreated ? 'text-emerald-400' : 'text-zinc-500'}>
                  {diagnostics.blobCreated ? 'YES (application/java-archive)' : 'NO'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-zinc-400">JAR Handed to Emulator:</span>
                <span className={diagnostics.jarHandedToEmulator ? 'text-emerald-400' : 'text-zinc-500'}>
                  {diagnostics.jarHandedToEmulator ? 'YES (via ArrayBuffer transfer)' : 'NO'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Target MIDlet Main-Class:</span>
                <span className="text-sky-300 font-bold">{midlet?.mainClass || 'main.GameMidlet'}</span>
              </div>
            </div>

            {/* Section 6: Assets Diagnostics Table */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-mono text-zinc-400 font-semibold flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-zinc-500" />
                <span>Emulator Runtime Assets Status:</span>
              </div>
              <div className="bg-zinc-950 rounded-lg border border-zinc-850 divide-y divide-zinc-850/60 overflow-hidden">
                {diagnostics.assets.map((asset) => (
                  <div key={asset.name} className="px-3 py-1.5 flex items-center justify-between text-[11px] font-mono">
                    <div className="truncate max-w-[280px]">
                      <span className="text-zinc-200 font-medium">{asset.name}</span>
                      <span className="text-zinc-500 text-[10px] ml-1.5">({asset.url})</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {asset.contentLength && (
                        <span className="text-zinc-400 text-[10px]">
                          {(asset.contentLength / 1024).toFixed(1)} KB
                        </span>
                      )}
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                          asset.status === 'LOADED'
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                            : asset.status === 'FAILED'
                            ? 'bg-red-950 text-red-400 border border-red-800/60'
                            : 'bg-zinc-800 text-zinc-400'
                        }`}
                      >
                        {asset.status === 'LOADED' ? `HTTP ${asset.httpStatus}` : asset.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Section 12: Real Runtime Console Output */}
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl overflow-hidden flex flex-col h-[340px]">
            {/* Console Header */}
            <div className="px-3.5 py-2.5 bg-zinc-950/80 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-xs font-mono font-semibold text-zinc-300">
                  Runtime Console
                </span>
                <span className="text-[10px] font-mono text-zinc-500">
                  ({logs.length} messages)
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleCopyLogs}
                  disabled={logs.length === 0}
                  className="px-2 py-1 text-[11px] font-mono text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded flex items-center gap-1 transition-colors cursor-pointer"
                  title="Sao chép toàn bộ log"
                >
                  {copiedLogs ? (
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  <span>{copiedLogs ? 'Copied' : 'Copy'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleClearLogs}
                  disabled={logs.length === 0}
                  className="px-2 py-1 text-[11px] font-mono text-zinc-400 hover:text-red-300 hover:bg-red-950/40 rounded flex items-center gap-1 transition-colors cursor-pointer"
                  title="Xóa console"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Clear</span>
                </button>
              </div>
            </div>

            {/* Console Messages List */}
            <div className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-1.5 bg-zinc-950/90 scrollbar-thin">
              {logs.length === 0 ? (
                <div className="h-full flex items-center justify-center text-zinc-600 text-xs italic">
                  Chưa có thông báo runtime. Nhấn [ Run Emulator Self-Test ] hoặc [ Run Original JAR ].
                </div>
              ) : (
                logs.map((log) => {
                  const color =
                    log.level === 'error'
                      ? 'text-red-400'
                      : log.level === 'warn'
                      ? 'text-amber-400'
                      : log.level === 'debug'
                      ? 'text-blue-400'
                      : 'text-zinc-300';

                  return (
                    <div key={log.id} className="flex items-start gap-2 leading-relaxed">
                      <span className="text-zinc-600 select-none text-[10px] shrink-0">
                        {log.timestamp}
                      </span>
                      <span
                        className={`text-[9px] uppercase px-1 py-0.2 rounded font-bold shrink-0 ${
                          log.level === 'error'
                            ? 'bg-red-950 text-red-400 border border-red-800/60'
                            : log.level === 'warn'
                            ? 'bg-amber-950 text-amber-400 border border-amber-800/60'
                            : 'bg-zinc-800 text-zinc-400'
                        }`}
                      >
                        {log.level}
                      </span>
                      <span className={`break-all ${color}`}>{log.message}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
