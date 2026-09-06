import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play,
  RotateCcw,
  Square,
  Volume2,
  VolumeX,
  Smartphone,
  Maximize2,
  Terminal,
  Trash2,
  Copy,
  CheckCircle2,
  AlertTriangle,
  FileArchive,
  Sparkles,
  Info,
  ShieldCheck,
} from 'lucide-react';
import { LoadedJarSession } from '../../types/jar';
import {
  EmulatorSourceType,
  EmulatorRuntimeStatus,
  EmulatorScreenSize,
  EmulatorPhoneType,
  EmulatorLogEntry,
  J2ME_KEYS,
} from '../../types/emulator';
import { DefaultJ2meTestSession, parseMidlet1 } from '../../services/j2meSessionService';
import { getDirtyCount } from '../../services/itemDraftService';

interface TestGameTabProps {
  session: LoadedJarSession;
  initialSource?: EmulatorSourceType;
  onNavigateToPatchBuilder?: () => void;
}

export function TestGameTab({
  session,
  initialSource = 'ORIGINAL',
  onNavigateToPatchBuilder,
}: TestGameTabProps) {
  const [source, setSource] = useState<EmulatorSourceType>(initialSource);
  const [runtimeStatus, setRuntimeStatus] = useState<EmulatorRuntimeStatus>('IDLE');
  const [screenSize, setScreenSize] = useState<EmulatorScreenSize>('240x320');
  const [phoneType, setPhoneType] = useState<EmulatorPhoneType>('nokia');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [isFocused, setIsFocused] = useState<boolean>(false);
  const [logs, setLogs] = useState<EmulatorLogEntry[]>([]);
  const [copiedLogs, setCopiedLogs] = useState<boolean>(false);
  const [pressedKeyCodes, setPressedKeyCodes] = useState<Set<number>>(new Set());

  // Stale detection
  const currentDirtyCount = getDirtyCount(session.itemDrafts);
  const candidateOutput = session.candidateOutput;
  const isPatchedValid =
    candidateOutput &&
    candidateOutput.status === 'VALIDATED' &&
    candidateOutput.blob &&
    candidateOutput.expectedModifiedCount === currentDirtyCount;

  const isPatchedStale =
    candidateOutput &&
    candidateOutput.status === 'VALIDATED' &&
    candidateOutput.expectedModifiedCount !== currentDirtyCount;

  // Emulator Session Reference
  const testSessionRef = useRef<DefaultJ2meTestSession | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Initialize Session
  useEffect(() => {
    const sess = new DefaultJ2meTestSession();
    testSessionRef.current = sess;

    const unsubLog = sess.onLog((entry) => {
      setLogs((prev) => [...prev.slice(-300), entry]);
    });

    const unsubStatus = sess.onStatusChange((status) => {
      setRuntimeStatus(status);
    });

    return () => {
      unsubLog();
      unsubStatus();
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

  // Handle Load JAR when Source changes
  const loadActiveJar = useCallback(async () => {
    const sess = testSessionRef.current;
    if (!sess) return;

    if (source === 'ORIGINAL') {
      sess.addLog('info', `[Source: ORIGINAL] Đang nạp file gốc: ${session.jarInfo.fileName}`);
      await sess.loadJar(
        session.originalFile,
        session.jarInfo.fileName,
        session.jarInfo.manifest
      );
    } else {
      if (!candidateOutput || !candidateOutput.blob) {
        sess.addLog('error', 'Chưa có Patched JAR nào được xuất và thẩm định.');
        return;
      }
      sess.addLog('info', `[Source: PATCHED] Đang nạp patched build: ${candidateOutput.fileName}`);
      await sess.loadJar(
        candidateOutput.blob,
        candidateOutput.fileName,
        session.jarInfo.manifest
      );
    }
  }, [source, session, candidateOutput]);

  // Trigger load when iframe is mounted and source changes
  useEffect(() => {
    const timer = setTimeout(() => {
      loadActiveJar();
    }, 250);
    return () => clearTimeout(timer);
  }, [loadActiveJar]);

  // Handle Switch Source
  const handleSwitchSource = (newSource: EmulatorSourceType) => {
    if (newSource === source) return;
    if (newSource === 'PATCHED' && !isPatchedValid) {
      return;
    }
    setSource(newSource);
  };

  // Actions
  const handleStart = async () => {
    if (testSessionRef.current) {
      await testSessionRef.current.start();
    }
  };

  const handleRestart = async () => {
    if (testSessionRef.current) {
      await testSessionRef.current.restart();
    }
  };

  const handleStop = async () => {
    if (testSessionRef.current) {
      await testSessionRef.current.stop();
    }
  };

  const handleToggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    if (testSessionRef.current) {
      testSessionRef.current.setSound(next);
    }
  };

  const handleScreenSizeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const size = e.target.value as EmulatorScreenSize;
    setScreenSize(size);
    if (testSessionRef.current) {
      testSessionRef.current.setScreenSize(size);
    }
  };

  const handleClearLogs = () => {
    if (testSessionRef.current) {
      testSessionRef.current.clearLogs();
    }
    setLogs([]);
  };

  const handleCopyLogs = () => {
    const text = logs.map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopiedLogs(true);
    setTimeout(() => setCopiedLogs(false), 2000);
  };

  // Send Key to Emulator
  const sendKey = useCallback((keyCode: number, type: 'down' | 'up') => {
    if (testSessionRef.current) {
      testSessionRef.current.sendKey(keyCode, type);
    }
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

      // Do NOT capture if typing in input, textarea or select
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
        {/* Source Selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-zinc-400 font-semibold">Source:</span>
          <div className="inline-flex rounded-lg bg-zinc-950 p-1 border border-zinc-800">
            <button
              id="source-original-button"
              type="button"
              onClick={() => handleSwitchSource('ORIGINAL')}
              className={`px-3 py-1.5 rounded-md text-xs font-mono font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                source === 'ORIGINAL'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <FileArchive className="w-3.5 h-3.5" />
              <span>Original JAR</span>
            </button>

            <button
              id="source-patched-button"
              type="button"
              disabled={!isPatchedValid && !candidateOutput}
              onClick={() => handleSwitchSource('PATCHED')}
              className={`px-3 py-1.5 rounded-md text-xs font-mono font-medium transition-colors flex items-center gap-1.5 ${
                source === 'PATCHED'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                  : isPatchedValid
                  ? 'text-zinc-400 hover:text-zinc-200 cursor-pointer'
                  : 'text-zinc-600 cursor-not-allowed opacity-60'
              }`}
              title={
                !candidateOutput
                  ? 'Chưa build Patched JAR ở Bước 11'
                  : isPatchedStale
                  ? 'Patched JAR đã cũ so với bản nháp hiện tại'
                  : 'Chạy bản Patched JAR đã xác thực'
              }
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Patched JAR</span>
              {isPatchedValid && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              )}
            </button>
          </div>
        </div>

        {/* Playback Controls */}
        <div className="flex items-center gap-2">
          <button
            id="emulator-start-button"
            type="button"
            onClick={handleStart}
            disabled={runtimeStatus === 'RUNNING' || runtimeStatus === 'LOADING'}
            className="px-3.5 py-1.5 rounded-lg text-xs font-mono font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:pointer-events-none text-zinc-950 font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Start</span>
          </button>

          <button
            id="emulator-restart-button"
            type="button"
            onClick={handleRestart}
            disabled={runtimeStatus === 'IDLE' || runtimeStatus === 'LOADING'}
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

        {/* Screen & Phone Configurations */}
        <div className="flex items-center gap-3">
          {/* Screen Size */}
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

          {/* Phone Profile */}
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

          {/* Sound Toggle */}
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

      {/* Safety & Stale Warnings */}
      {source === 'PATCHED' && isPatchedStale && (
        <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-800/60 text-xs font-mono text-amber-300 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <strong>Running stale patched build:</strong> Bản nháp draft đã thay đổi ({currentDirtyCount} ô đã sửa) nhưng file patched hiện tại dựa trên phiên bản trước ({candidateOutput?.expectedModifiedCount} ô).
            </span>
          </div>
          {onNavigateToPatchBuilder && (
            <button
              type="button"
              onClick={onNavigateToPatchBuilder}
              className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 rounded text-[11px] font-medium transition-colors cursor-pointer shrink-0"
            >
              Rebuild Patched JAR &rarr;
            </button>
          )}
        </div>
      )}

      {/* Main Runner Grid: Left Phone Shell, Right Status & Console */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: Phone Shell & LCD Canvas */}
        <div
          ref={containerRef}
          onClick={() => setIsFocused(true)}
          className={`lg:col-span-6 xl:col-span-5 flex flex-col items-center p-5 rounded-2xl bg-zinc-900/80 border transition-all ${
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
                {/* D-Pad Background Circle */}
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

                {/* Center Fire Key */}
                <button
                  type="button"
                  onMouseDown={() => sendKey(J2ME_KEYS.FIRE, 'down')}
                  onMouseUp={() => sendKey(J2ME_KEYS.FIRE, 'up')}
                  className={`w-9 h-9 rounded-full bg-zinc-700 hover:bg-zinc-650 border border-zinc-600 flex items-center justify-center text-[10px] font-bold text-zinc-100 shadow active:scale-90 transition-transform cursor-pointer ${
                    pressedKeyCodes.has(J2ME_KEYS.FIRE)
                      ? 'bg-emerald-500 text-zinc-950 font-extrabold'
                      : ''
                  }`}
                  title="Fire / Enter"
                >
                  OK
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

            {/* Numeric 12-Key Pad (1-9, *, 0, #) */}
            <div className="w-full grid grid-cols-3 gap-1.5 mt-4 px-3">
              {[
                { label: '1', sub: '', code: J2ME_KEYS.KEY_NUM1 },
                { label: '2', sub: 'abc', code: J2ME_KEYS.KEY_NUM2 },
                { label: '3', sub: 'def', code: J2ME_KEYS.KEY_NUM3 },
                { label: '4', sub: 'ghi', code: J2ME_KEYS.KEY_NUM4 },
                { label: '5', sub: 'jkl', code: J2ME_KEYS.KEY_NUM5 },
                { label: '6', sub: 'mno', code: J2ME_KEYS.KEY_NUM6 },
                { label: '7', sub: 'pqrs', code: J2ME_KEYS.KEY_NUM7 },
                { label: '8', sub: 'tuv', code: J2ME_KEYS.KEY_NUM8 },
                { label: '9', sub: 'wxyz', code: J2ME_KEYS.KEY_NUM9 },
                { label: '*', sub: '(E)', code: J2ME_KEYS.KEY_STAR },
                { label: '0', sub: '␣', code: J2ME_KEYS.KEY_NUM0 },
                { label: '#', sub: '(R)', code: J2ME_KEYS.KEY_POUND },
              ].map((key) => {
                const isPressed = pressedKeyCodes.has(key.code);
                return (
                  <button
                    key={key.label}
                    type="button"
                    onMouseDown={() => sendKey(key.code, 'down')}
                    onMouseUp={() => sendKey(key.code, 'up')}
                    className={`py-1.5 px-2 rounded-lg border flex flex-col items-center justify-center active:scale-95 transition-transform cursor-pointer shadow-sm ${
                      isPressed
                        ? 'bg-emerald-500/40 border-emerald-400 text-emerald-100'
                        : 'bg-zinc-800/90 border-zinc-700/80 text-zinc-200 hover:bg-zinc-750'
                    }`}
                  >
                    <span className="text-xs font-mono font-bold leading-none">{key.label}</span>
                    <span className="text-[8px] font-mono text-zinc-400 uppercase leading-none mt-0.5">
                      {key.sub || '-'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Status & Runtime Console */}
        <div className="lg:col-span-6 xl:col-span-7 space-y-4">
          {/* Status Diagnostic Card */}
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
              <h3 className="text-xs font-mono font-semibold text-zinc-200 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Test Session Status</span>
              </h3>
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                    runtimeStatus === 'RUNNING'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : runtimeStatus === 'ERROR'
                      ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                      : runtimeStatus === 'UNSUPPORTED'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                  }`}
                >
                  Runtime: {runtimeStatus}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
              <div className="bg-zinc-950 p-2 rounded border border-zinc-850">
                <div className="text-[10px] text-zinc-500 uppercase">Active Source</div>
                <div
                  className={`font-semibold truncate ${
                    source === 'PATCHED' ? 'text-amber-400' : 'text-emerald-400'
                  }`}
                >
                  {source}
                </div>
              </div>

              <div className="bg-zinc-950 p-2 rounded border border-zinc-855">
                <div className="text-[10px] text-zinc-500 uppercase">Patch Validated</div>
                <div className="font-semibold text-zinc-200">
                  {candidateOutput?.status === 'VALIDATED' ? (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> YES
                    </span>
                  ) : (
                    <span className="text-zinc-500">NO / N/A</span>
                  )}
                </div>
              </div>

              <div className="bg-zinc-950 p-2 rounded border border-zinc-850">
                <div className="text-[10px] text-zinc-500 uppercase">MIDlet Class</div>
                <div className="font-semibold text-zinc-200 truncate" title={midlet?.mainClass}>
                  {midlet?.mainClass || 'Auto-detect'}
                </div>
              </div>

              <div className="bg-zinc-950 p-2 rounded border border-zinc-850">
                <div className="text-[10px] text-zinc-500 uppercase">Audio Stack</div>
                <div className="font-semibold text-zinc-200">
                  {soundEnabled ? (
                    <span className="text-emerald-400">SYNTH ON</span>
                  ) : (
                    <span className="text-zinc-500">MUTED</span>
                  )}
                </div>
              </div>
            </div>

            {/* Verification Separation Notice */}
            <div className="p-2.5 rounded-lg bg-zinc-950/60 border border-zinc-800 text-[11px] font-mono text-zinc-400 space-y-1">
              <div className="flex items-center justify-between">
                <span>1. Bytecode Patch Engine Validation:</span>
                <span className="text-emerald-400 font-bold">
                  {candidateOutput?.status === 'VALIDATED' ? 'PASS (10/10 Checks)' : 'READY FOR BUILD'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>2. Web Browser J2ME Compatibility:</span>
                <span className="text-blue-400 font-bold">
                  {runtimeStatus === 'RUNNING' ? 'ACTIVE CANVAS' : 'STANDBY'}
                </span>
              </div>
            </div>
          </div>

          {/* Runtime Console Output */}
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
                  Chưa có thông báo runtime. Nhấn [ Start ] để khởi chạy J2ME loop.
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
