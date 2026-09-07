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
import { CandidateOutputJar, LoadedJarSession } from '../../types/jar';
import {
  EmulatorSourceType,
  EmulatorRuntimeStatus,
  EmulatorScreenSize,
  EmulatorLogEntry,
  J2ME_KEYS,
} from '../../types/emulator';
import { DefaultJ2meTestSession, parseMidlet1 } from '../../services/j2meSessionService';
import { isDraftTestCandidateFresh } from '../../services/draftTestService';

interface TestGameTabProps {
  session: LoadedJarSession;
  initialSource?: EmulatorSourceType;
  resetMode?: 'none' | 'rms' | 'full';
  onNavigateToPatchBuilder?: () => void;
  onBuildDraftCandidate?: () => Promise<CandidateOutputJar | null>;
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
  resetMode = 'rms',
  onNavigateToPatchBuilder,
  onBuildDraftCandidate,
}: TestGameTabProps) {
  const [source, setSource] = useState<EmulatorSourceType>(initialSource);
  const [runtimeStatus, setRuntimeStatus] = useState<EmulatorRuntimeStatus>('IDLE');
  const [screenSize, setScreenSize] = useState<EmulatorScreenSize>('240x320');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [logs, setLogs] = useState<EmulatorLogEntry[]>([]);
  const [isFocused, setIsFocused] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isRebuildingDraft, setIsRebuildingDraft] = useState(false);

  const testSessionRef = useRef<DefaultJ2meTestSession | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const candidate = session.candidateOutput;
  const isUnifiedWorkspaceCandidate =
    candidate?.metrics?.source === 'UNIFIED_WORKSPACE';
  const isDraftTestCandidate =
    candidate?.metrics?.source === 'DRAFT_TEST' || isUnifiedWorkspaceCandidate;
  const isMultiplayerCandidate =
    candidate?.metrics?.source === 'MULTIPLAYER_LITE' ||
    Boolean(isUnifiedWorkspaceCandidate && candidate?.metrics?.multiplayerLite);
  const draftCandidateFresh =
    Boolean(isDraftTestCandidate && candidate?.status === 'VALIDATED') &&
    isDraftTestCandidateFresh(session);
  const patchedAvailable =
    candidate?.status === 'VALIDATED' &&
    (!isDraftTestCandidate || draftCandidateFresh);
  const draftNeedsRebuild =
    initialSource === 'PATCHED' &&
    (!candidate || isDraftTestCandidate) &&
    !draftCandidateFresh;
  const patchedSourceLabel = isUnifiedWorkspaceCandidate
    ? draftCandidateFresh
      ? 'Workspace hợp nhất'
      : 'Workspace cần dựng lại'
    : isMultiplayerCandidate
    ? 'Multiplayer Lite'
    : isDraftTestCandidate
    ? draftCandidateFresh
      ? 'Nháp đã dựng'
      : 'Nháp cần dựng lại'
    : 'JAR đã vá';
  const patchedRunLabel = isUnifiedWorkspaceCandidate
    ? 'workspace'
    : isMultiplayerCandidate
    ? 'multiplayer'
    : isDraftTestCandidate
    ? 'nháp'
    : 'JAR đã vá';
  const draftTestSummary = candidate?.metrics?.summary;

  useEffect(() => {
    setSource(initialSource);
  }, [initialSource]);

  useEffect(() => {
    if (
      source === 'PATCHED' &&
      !patchedAvailable &&
      initialSource !== 'PATCHED'
    ) {
      setSource('ORIGINAL');
    }
  }, [source, patchedAvailable, initialSource]);

  useEffect(() => {
    const sess = new DefaultJ2meTestSession({ resetMode });
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
  }, [resetMode]);

  useEffect(() => {
    if (testSessionRef.current && iframeRef.current) {
      testSessionRef.current.bindIframe(iframeRef.current);
    }
  }, []);

  const runCandidateJar = useCallback(
    async (current: CandidateOutputJar) => {
      const sess = testSessionRef.current;
      if (!sess) return false;

      const bytes = await current.blob.arrayBuffer();
      const sha = await shortHash(bytes);
      const unifiedCandidate = current.metrics?.source === 'UNIFIED_WORKSPACE';
      const draftCandidate =
        current.metrics?.source === 'DRAFT_TEST' || unifiedCandidate;
      const multiplayerCandidate =
        current.metrics?.source === 'MULTIPLAYER_LITE' ||
        Boolean(unifiedCandidate && current.metrics?.multiplayerLite);

      sess.addLog(
        'info',
        `${
          unifiedCandidate
            ? '[Source: WORKSPACE]'
            : multiplayerCandidate
            ? '[Source: MULTIPLAYER]'
            : draftCandidate
            ? '[Source: DRAFT]'
            : '[Source: PATCHED]'
        } Đang nạp ${
          unifiedCandidate
            ? 'JAR hợp nhất toàn bộ Patch Workspace'
            : multiplayerCandidate
            ? 'JAR Multiplayer Lite'
            : draftCandidate
            ? 'JAR test nháp vừa dựng'
            : 'JAR đã vá'
        }: ${current.fileName} (${bytes.byteLength} byte, sha256:${sha})`
      );

      await sess.loadJar(
        bytes,
        current.fileName,
        session.jarInfo.manifest
      );
      return true;
    },
    [session.jarInfo.manifest]
  );

  const rebuildAndRunDraft = useCallback(async () => {
    const sess = testSessionRef.current;
    if (!sess || isStarting || isRebuildingDraft || !onBuildDraftCandidate) {
      return;
    }

    setIsRebuildingDraft(true);
    setIsStarting(true);
    // Giữ candidate đã verify gần nhất để người dùng vẫn có thể mở game khi
    // một draft mới bị writer chặn. Tuyệt đối không giả vờ rằng bản cũ chứa
    // thay đổi mới: log và banner vẫn báo rõ đây là candidate gần nhất.
    const lastValidated =
      session.candidateOutput?.status === 'VALIDATED'
        ? session.candidateOutput
        : null;
    try {
      sess.addLog(
        'info',
        '[Source: DRAFT] Candidate cũ thiếu hoặc đã stale. Đang dựng lại JAR test nháp...'
      );

      const rebuilt = await onBuildDraftCandidate();
      if (!rebuilt || rebuilt.status !== 'VALIDATED') {
        if (lastValidated) {
          sess.addLog(
            'warn',
            '[Source: DRAFT] Bản mới bị writer chặn. Đang chạy candidate VALIDATED gần nhất để mở game; các thay đổi vừa sửa chưa nằm trong bản này.'
          );
          setSource('PATCHED');
          await runCandidateJar(lastValidated);
        } else {
          sess.addLog(
            'error',
            '[Source: DRAFT] Không dựng được candidate VALIDATED và chưa có bản đã verify để chạy. Xem cảnh báo Test Workspace để biết field bị chặn.'
          );
        }
        return;
      }

      setSource('PATCHED');
      await runCandidateJar(rebuilt);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sess.addLog(
        'error',
        `[Source: DRAFT] Dựng lại/chạy nháp thất bại: ${message}`
      );
    } finally {
      setIsRebuildingDraft(false);
      setIsStarting(false);
    }
  }, [
    isRebuildingDraft,
    isStarting,
    onBuildDraftCandidate,
    runCandidateJar,
    session,
  ]);

  const loadActiveJar = useCallback(async () => {
    const sess = testSessionRef.current;
    if (!sess || isStarting) return;

    setIsStarting(true);
    try {
      if (source === 'PATCHED') {
        const current = session.candidateOutput;
        if (!current || current.status !== 'VALIDATED') {
          sess.addLog('error', '[Source: PATCHED] Không có candidateOutput VALIDATED. Không tự chuyển sang JAR gốc.');
          return;
        }

        if (
          ['DRAFT_TEST', 'UNIFIED_WORKSPACE'].includes(current.metrics?.source) &&
          !isDraftTestCandidateFresh(session)
        ) {
          current.status = 'STALE';
          sess.addLog(
            'error',
            '[Source: WORKSPACE] Workspace đã thay đổi sau lần dựng JAR. Bấm “Test Workspace” để build bản mới; không chạy candidate cũ.'
          );
          return;
        }

        await runCandidateJar(current);
        return;
      }

      const originalBytes = await session.originalFile.arrayBuffer();
      const sha = await shortHash(originalBytes);
      sess.addLog(
        'info',
        `[Source: ORIGINAL] Đang nạp JAR gốc: ${session.jarInfo.fileName} (${originalBytes.byteLength} byte, sha256:${sha})`
      );
      await sess.loadJar(originalBytes, session.jarInfo.fileName, session.jarInfo.manifest);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sess.addLog('error', `[TestGameTab] Không thể nạp ${source}: ${message}`);
    } finally {
      setIsStarting(false);
    }
  }, [isStarting, runCandidateJar, session, source]);

  const switchSource = useCallback(async (next: EmulatorSourceType) => {
    if (
      next === 'PATCHED' &&
      !patchedAvailable &&
      !onBuildDraftCandidate
    ) {
      return;
    }
    if (next === source) return;
    await testSessionRef.current?.stop();
    setSource(next);
  }, [patchedAvailable, source, onBuildDraftCandidate]);

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
    source === 'PATCHED' && candidate
      ? candidate.fileName
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
            <div className="text-sm font-bold text-zinc-100">Công cụ chạy thử game J2ME</div>
            <div className="text-[11px] font-mono text-zinc-500">MIDlet: {midlet?.mainClass || 'main.GameMidlet'}</div>
          </div>

          <div className="flex items-center gap-2">
            <button type="button" onClick={() => switchSource('ORIGINAL')} className={`px-3 py-1.5 rounded-lg border text-xs font-mono ${source === 'ORIGINAL' ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300' : 'bg-zinc-950 border-zinc-800 text-zinc-400'}`}>
              <FileArchive className="inline w-3.5 h-3.5 mr-1" /> JAR gốc
            </button>
            <button
              type="button"
              disabled={!patchedAvailable && !onBuildDraftCandidate}
              onClick={() => switchSource('PATCHED')}
              className={`px-3 py-1.5 rounded-lg border text-xs font-mono disabled:opacity-40 disabled:cursor-not-allowed ${
                source === 'PATCHED'
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-400'
              }`}
              title={
                patchedAvailable
                  ? candidate?.fileName
                  : onBuildDraftCandidate
                  ? 'Bấm để chọn chế độ nháp; khi chạy tool sẽ tự dựng lại candidate.'
                  : 'Chưa có JAR đã vá ở trạng thái VALIDATED'
              }
            >
              {patchedSourceLabel}{' '}
              {patchedAvailable ? '✓' : draftNeedsRebuild ? '(stale)' : '(chưa có)'}
            </button>
          </div>
        </div>

        <div className={`p-3 rounded-lg border text-xs font-mono ${source === 'PATCHED' ? 'bg-amber-950/20 border-amber-700/40 text-amber-200' : 'bg-zinc-950 border-zinc-800 text-zinc-300'}`}>
          <div><strong>NGUỒN ĐANG CHẠY:</strong> {source}</div>
          <div className="truncate"><strong>JAR:</strong> {currentName}</div>
          {source === 'PATCHED' && (
            <>
              <div><strong>Trạng thái:</strong> {candidate?.status}</div>
              {isDraftTestCandidate && draftTestSummary && (
                <div>
                  <strong>Nháp đã áp dụng:</strong>{' '}
                  {draftTestSummary.modifiedCells} cell / {draftTestSummary.rewrittenClasses} class
                </div>
              )}
              {isMultiplayerCandidate && candidate?.metrics?.config && (
                <div>
                  <strong>Multiplayer:</strong>{' '}
                  {candidate.metrics.config.host}:{candidate.metrics.config.port}
                  {candidate.metrics.config.name
                    ? ` · ${candidate.metrics.config.name}`
                    : ''}
                </div>
              )}
            </>
          )}
        </div>

        {initialSource === 'PATCHED' && !patchedAvailable && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 text-xs font-mono">
            <div className="flex items-start gap-2 flex-1">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Bản nháp hiện tại chưa có candidate mới hoặc candidate cũ đã stale.
                Không chạy JAR gốc thay thế.
              </span>
            </div>
            {onBuildDraftCandidate && (
              <button
                type="button"
                onClick={rebuildAndRunDraft}
                disabled={isStarting || isRebuildingDraft}
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-bold whitespace-nowrap cursor-pointer"
              >
                {isRebuildingDraft ? 'Đang dựng...' : 'Dựng lại & chạy nháp'}
              </button>
            )}
          </div>
        )}

        <div className="p-2.5 rounded-lg border border-indigo-200 bg-indigo-50 text-[10px] text-indigo-700 leading-relaxed">
          Trong AI Studio/Preview, CheerpJ không ổn định khi chạy trong iframe lồng nhau. Vì vậy runner riêng
          <strong> chỉ được mở khi bạn chủ động bấm Chạy</strong>; vào tab Chạy thử hoặc bấm Test nháp sẽ không tự bật tab mới nữa.
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={
              source === 'PATCHED' && !patchedAvailable
                ? rebuildAndRunDraft
                : loadActiveJar
            }
            disabled={
              isStarting ||
              isRebuildingDraft ||
              (source === 'PATCHED' &&
                !patchedAvailable &&
                !onBuildDraftCandidate)
            }
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-zinc-950 font-bold text-xs font-mono flex items-center gap-1.5 cursor-pointer"
          >
            <Play className="w-4 h-4 fill-current" />
            {isRebuildingDraft
              ? 'Đang dựng nháp...'
              : isStarting
              ? 'Đang khởi động...'
              : source === 'PATCHED' && !patchedAvailable
              ? 'Dựng lại & chạy nháp'
              : `Chạy ${source === 'PATCHED' ? patchedRunLabel : 'JAR gốc'}`}
          </button>
          <button type="button" onClick={() => testSessionRef.current?.restart()} className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs font-mono text-zinc-200 flex items-center gap-1.5"><RotateCcw className="w-4 h-4" /> Khởi động lại</button>
          <button type="button" onClick={() => testSessionRef.current?.stop()} className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-red-950/40 border border-zinc-700 text-xs font-mono text-zinc-200 flex items-center gap-1.5"><Square className="w-4 h-4" /> Dừng</button>
          <button type="button" onClick={() => { const next = !soundEnabled; setSoundEnabled(next); testSessionRef.current?.setSound(next); }} className="p-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300" title={soundEnabled ? 'Tắt âm thanh' : 'Bật âm thanh'}>
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          <select value={screenSize} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { const next = e.target.value as EmulatorScreenSize; setScreenSize(next); testSessionRef.current?.setScreenSize(next); }} className="bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-2 text-xs font-mono text-zinc-300" title="Kích thước màn hình giả lập">
            <option value="240x320">240x320</option><option value="176x220">176x220</option><option value="128x160">128x160</option><option value="320x240">320x240</option><option value="360x640">360x640</option>
          </select>
          {onNavigateToPatchBuilder && (
            <button type="button" onClick={onNavigateToPatchBuilder} className="ml-auto px-3 py-2 rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs font-mono">Quay lại Vật phẩm</button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div ref={containerRef} onClick={() => setIsFocused(true)} className={`bg-zinc-900 border rounded-xl p-4 space-y-3 ${isFocused ? 'border-emerald-500/60' : 'border-zinc-800'}`}>
          <div className="flex items-center justify-between text-xs font-mono"><span className="text-zinc-300">Màn hình game</span><span className={runtimeStatus === 'RUNNING' ? 'text-emerald-400' : 'text-zinc-500'}>{runtimeStatus}</span></div>
          <div className="flex justify-center bg-black rounded-lg p-2 min-h-[340px]">
            <iframe ref={iframeRef} src="/emulator/index.html" title="Trình chạy J2ME cách ly" className="w-[240px] h-[320px] border border-zinc-800 bg-black" />
          </div>
          <div className="flex justify-center gap-2 flex-wrap">
            {keyButton('Phím trái (Q)', J2ME_KEYS.KEY_SOFT_LEFT)}
            {keyButton('↑', J2ME_KEYS.UP)}
            {keyButton('Enter', J2ME_KEYS.FIRE)}
            {keyButton('↓', J2ME_KEYS.DOWN)}
            {keyButton('Phím phải (W)', J2ME_KEYS.KEY_SOFT_RIGHT)}
          </div>
          <div className="text-center text-[10px] text-zinc-500 font-mono">Bấm vào khung game để dùng bàn phím: mũi tên, Enter, Q/W, 0-9, E(*), R(#)</div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden flex flex-col min-h-[420px]">
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-bold text-zinc-200">
              {runtimeStatus === 'RUNNING' ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <FileArchive className="w-4 h-4 text-zinc-500" />}
              Nhật ký chạy game
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => navigator.clipboard.writeText(logs.map((l) => `[${l.timestamp}] [${l.level}] ${l.message}`).join('\n'))} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400" title="Sao chép nhật ký"><Copy className="w-4 h-4" /></button>
              <button type="button" onClick={() => { testSessionRef.current?.clearLogs(); setLogs([]); }} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400" title="Xóa nhật ký"><Trash2 className="w-4 h-4" /></button>
            </div>
          </div>
          <div className="p-3 overflow-auto font-mono text-[11px] space-y-1 flex-1 bg-zinc-950/50">
            {logs.length === 0 ? (
              <div className="text-zinc-600">Chưa có nhật ký. Chọn nguồn JAR rồi bấm Chạy.</div>
            ) : (
              logs.map((log) => (
                <div key={log.id} className={log.level === 'error' ? 'text-red-400' : log.level === 'warn' ? 'text-amber-400' : log.message.includes('[Source: WORKSPACE]') ? 'text-emerald-300' : log.message.includes('[Source: MULTIPLAYER]') ? 'text-cyan-300' : log.message.includes('[Source: DRAFT]') ? 'text-violet-300' : log.message.includes('[Source: PATCHED]') ? 'text-amber-300' : log.message.includes('[Source: ORIGINAL]') ? 'text-sky-300' : 'text-zinc-400'}>
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
