import React, { useEffect, useState } from 'react';
import {
  Terminal,
  XCircle,
  FileArchive,
  LayoutDashboard,
  Compass,
  Package,
  AlertTriangle,
  Gamepad2,
  Database,
  SlidersHorizontal,
  Crown,
  MapPinned,
  Bug,
  UserRound,
  PlayCircle,
  Loader2,
  CheckCircle2,
  Sparkles,
  Network,
} from 'lucide-react';
import { LoadedJarSession } from './types/jar';
import { loadAndAnalyzeJarSession } from './services/jarService';
import { JarDropZone } from './components/JarDropZone';
import { JarInfoPanel } from './components/JarInfoPanel';
import { ManifestPanel } from './components/ManifestPanel';
import { JarExplorer } from './components/explorer/JarExplorer';
import { ItemsBrowser } from './components/items/ItemsBrowser';
import { TestGameTab } from './components/emulator/TestGameTab';
import { GameDataPanel } from './components/game-data/GameDataPanel';
import { GameMechanicsPanel } from './components/mechanics/GameMechanicsPanel';
import { BossPanel } from './components/boss/BossPanel';
import { MapPanel } from './components/map/MapPanel';
import { MobPanel } from './components/mobs/MobPanel';
import { CharacterPanel } from './components/character/CharacterPanel';
import { SkillPanel } from './components/skills/SkillPanel';
import { MultiplayerPanel } from './components/multiplayer/MultiplayerPanel';
import { PatchWorkspaceBar } from './components/workspace/PatchWorkspaceBar';
import { getDirtyCount } from './services/itemDraftService';
import {
  DraftTestBuildResult,
  DraftTestProgress,
} from './services/draftTestService';
import { buildUnifiedWorkspaceCandidate } from './services/unifiedCandidateService';
import { getPatchWorkspaceOperationCount } from './services/patchWorkspaceStateService';
import {
  clearPersistedWorkspace,
  flushWorkspaceDraftSave,
  loadWorkspaceSource,
  queueWorkspaceDraftSave,
  restoreWorkspaceDrafts,
  saveWorkspaceDrafts,
  saveWorkspaceSource,
  WorkspaceDirtyCounts,
} from './services/workspacePersistenceService';


const LIGHT_THEME_CSS = `
  .light-theme {
    color-scheme: light;
    background: #f4f4f5;
    color: #18181b;
  }

  /* Nền trung tính dùng trong toàn bộ component cũ */
  .light-theme [class~="bg-zinc-950"],
  .light-theme [class~="bg-zinc-950/90"],
  .light-theme [class~="bg-zinc-950/80"],
  .light-theme [class~="bg-zinc-950/70"],
  .light-theme [class~="bg-zinc-950/60"],
  .light-theme [class~="bg-zinc-950/50"],
  .light-theme [class~="bg-zinc-950/45"],
  .light-theme [class~="bg-zinc-950/40"] {
    background-color: #fafafa !important;
  }

  .light-theme [class~="bg-zinc-900"],
  .light-theme [class~="bg-zinc-900/95"],
  .light-theme [class~="bg-zinc-900/90"],
  .light-theme [class~="bg-zinc-900/80"],
  .light-theme [class~="bg-zinc-900/70"],
  .light-theme [class~="bg-zinc-900/60"],
  .light-theme [class~="bg-zinc-900/55"],
  .light-theme [class~="bg-zinc-900/50"] {
    background-color: #ffffff !important;
  }

  .light-theme [class~="bg-zinc-850"],
  .light-theme [class~="bg-zinc-800"],
  .light-theme [class~="bg-zinc-800/90"],
  .light-theme [class~="bg-zinc-800/80"],
  .light-theme [class~="bg-zinc-800/70"],
  .light-theme [class~="bg-zinc-800/60"],
  .light-theme [class~="bg-zinc-800/50"] {
    background-color: #f4f4f5 !important;
  }

  .light-theme [class~="bg-zinc-700"],
  .light-theme [class~="bg-zinc-700/50"] {
    background-color: #e4e4e7 !important;
  }

  /* Chữ */
  .light-theme [class~="text-zinc-100"] { color: #18181b !important; }
  .light-theme [class~="text-zinc-200"] { color: #27272a !important; }
  .light-theme [class~="text-zinc-300"] { color: #3f3f46 !important; }
  .light-theme [class~="text-zinc-400"] { color: #52525b !important; }
  .light-theme [class~="text-zinc-500"] { color: #71717a !important; }
  .light-theme [class~="text-zinc-600"] { color: #8a8a93 !important; }
  .light-theme [class~="text-zinc-700"] { color: #a1a1aa !important; }

  /* Viền */
  .light-theme [class~="border-zinc-950"] { border-color: #e4e4e7 !important; }
  .light-theme [class~="border-zinc-900"],
  .light-theme [class~="border-zinc-900/80"],
  .light-theme [class~="border-zinc-900/60"],
  .light-theme [class~="border-zinc-900/50"] {
    border-color: #e4e4e7 !important;
  }

  .light-theme [class~="border-zinc-800"],
  .light-theme [class~="border-zinc-800/90"],
  .light-theme [class~="border-zinc-800/80"],
  .light-theme [class~="border-zinc-800/70"],
  .light-theme [class~="border-zinc-800/60"],
  .light-theme [class~="border-zinc-800/50"] {
    border-color: #e4e4e7 !important;
  }

  .light-theme [class~="border-zinc-750"],
  .light-theme [class~="border-zinc-700"],
  .light-theme [class~="border-zinc-700/80"],
  .light-theme [class~="border-zinc-700/60"],
  .light-theme [class~="border-zinc-700/50"] {
    border-color: #d4d4d8 !important;
  }

  /* Hover trung tính */
  .light-theme [class~="hover:bg-zinc-950"]:hover,
  .light-theme [class~="hover:bg-zinc-900"]:hover,
  .light-theme [class~="hover:bg-zinc-850"]:hover,
  .light-theme [class~="hover:bg-zinc-800"]:hover,
  .light-theme [class~="hover:bg-zinc-700"]:hover {
    background-color: #f4f4f5 !important;
  }

  .light-theme [class~="hover:text-zinc-100"]:hover,
  .light-theme [class~="hover:text-zinc-200"]:hover,
  .light-theme [class~="hover:text-zinc-300"]:hover {
    color: #18181b !important;
  }

  /* Semantic dark panels -> pastel trên light theme */
  .light-theme [class~="bg-red-950/80"],
  .light-theme [class~="bg-red-950/70"],
  .light-theme [class~="bg-red-950/60"],
  .light-theme [class~="bg-red-950/50"],
  .light-theme [class~="bg-red-950/40"],
  .light-theme [class~="bg-red-950/30"],
  .light-theme [class~="bg-red-950/20"] {
    background-color: #fff1f2 !important;
  }

  .light-theme [class~="bg-amber-950/60"],
  .light-theme [class~="bg-amber-950/50"],
  .light-theme [class~="bg-amber-950/40"],
  .light-theme [class~="bg-amber-950/30"],
  .light-theme [class~="bg-amber-950/25"],
  .light-theme [class~="bg-amber-950/20"],
  .light-theme [class~="bg-amber-950/15"] {
    background-color: #fffbeb !important;
  }

  .light-theme [class~="bg-emerald-950/60"],
  .light-theme [class~="bg-emerald-950/50"],
  .light-theme [class~="bg-emerald-950/40"],
  .light-theme [class~="bg-emerald-950/30"],
  .light-theme [class~="bg-emerald-950/20"] {
    background-color: #ecfdf5 !important;
  }

  .light-theme [class~="bg-cyan-950/50"],
  .light-theme [class~="bg-cyan-950/40"],
  .light-theme [class~="bg-cyan-950/30"],
  .light-theme [class~="bg-cyan-950/20"],
  .light-theme [class~="bg-cyan-950/15"] {
    background-color: #ecfeff !important;
  }

  .light-theme [class~="bg-violet-950/50"],
  .light-theme [class~="bg-violet-950/30"],
  .light-theme [class~="bg-violet-950/20"],
  .light-theme [class~="bg-violet-950/15"],
  .light-theme [class~="bg-violet-950/10"] {
    background-color: #f5f3ff !important;
  }

  .light-theme [class~="bg-purple-950/50"],
  .light-theme [class~="bg-purple-950/40"],
  .light-theme [class~="bg-purple-950/30"],
  .light-theme [class~="bg-purple-950/20"] {
    background-color: #faf5ff !important;
  }

  .light-theme [class~="bg-blue-950/40"],
  .light-theme [class~="bg-blue-950/30"],
  .light-theme [class~="bg-blue-950/20"] {
    background-color: #eff6ff !important;
  }

  /* Màu chữ semantic trên nền sáng */
  .light-theme [class~="text-red-200"],
  .light-theme [class~="text-red-300"],
  .light-theme [class~="text-red-400"] { color: #be123c !important; }

  .light-theme [class~="text-amber-200"],
  .light-theme [class~="text-amber-300"],
  .light-theme [class~="text-amber-400"] { color: #b45309 !important; }

  .light-theme [class~="text-emerald-200"],
  .light-theme [class~="text-emerald-300"],
  .light-theme [class~="text-emerald-400"] { color: #047857 !important; }

  .light-theme [class~="text-cyan-200"],
  .light-theme [class~="text-cyan-300"],
  .light-theme [class~="text-cyan-400"] { color: #0e7490 !important; }

  .light-theme [class~="text-violet-200"],
  .light-theme [class~="text-violet-300"],
  .light-theme [class~="text-violet-400"] { color: #6d28d9 !important; }

  .light-theme [class~="text-purple-300"],
  .light-theme [class~="text-purple-400"] { color: #7e22ce !important; }

  .light-theme [class~="text-blue-300"],
  .light-theme [class~="text-blue-400"] { color: #1d4ed8 !important; }

  .light-theme [class~="text-rose-300"],
  .light-theme [class~="text-rose-400"] { color: #be123c !important; }

  /* Input / textarea / select */
  .light-theme input,
  .light-theme textarea,
  .light-theme select {
    color: #18181b;
    caret-color: #18181b;
  }

  .light-theme input::placeholder,
  .light-theme textarea::placeholder {
    color: #a1a1aa !important;
  }

  /* Pixel preview: nền caro sáng giúp thấy sprite trắng */
  .light-theme img[style*="pixelated"] {
    filter: none;
  }

  .light-theme [class~="shadow-2xl"],
  .light-theme [class~="shadow-lg"],
  .light-theme [class~="shadow-md"] {
    --tw-shadow-color: rgba(24, 24, 27, 0.10) !important;
  }

  /* Scrollbar desktop sáng */
  .light-theme * {
    scrollbar-color: #c4c4c9 #f4f4f5;
  }
`;


export default function App() {
  const [session, setSession] = useState<LoadedJarSession | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'game-data' | 'maps' | 'mobs' | 'characters' | 'skills' | 'bosses' | 'mechanics' | 'multiplayer' | 'explorer' | 'items' | 'test'>('overview');
  const [testGameSource, setTestGameSource] = useState<'ORIGINAL' | 'PATCHED'>('ORIGINAL');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dirtyItemCount, setDirtyItemCount] = useState(0);
  const [dirtyNpcCount, setDirtyNpcCount] = useState(0);
  const [dirtyMechanicCount, setDirtyMechanicCount] = useState(0);
  const [dirtyBossCount, setDirtyBossCount] = useState(0);
  const [dirtyMapCount, setDirtyMapCount] = useState(0);
  const [dirtyMobCount, setDirtyMobCount] = useState(0);
  const [dirtyCharacterCount, setDirtyCharacterCount] = useState(0);
  const [dirtySkillCount, setDirtySkillCount] = useState(0);
  const [showCloseConfirmModal, setShowCloseConfirmModal] = useState(false);
  const [isBuildingDraftTest, setIsBuildingDraftTest] = useState(false);
  const [draftTestProgress, setDraftTestProgress] = useState<DraftTestProgress | null>(null);
  const [draftTestResult, setDraftTestResult] = useState<DraftTestBuildResult | null>(null);
  const [isRestoringWorkspace, setIsRestoringWorkspace] = useState(true);
  const [workspaceStatus, setWorkspaceStatus] = useState<'idle' | 'saved' | 'restored' | 'error'>('idle');
  const [, setPatchWorkspaceRevision] = useState(0);

  const currentWorkspaceCounts = (
    patch: Partial<WorkspaceDirtyCounts> = {}
  ): WorkspaceDirtyCounts => ({
    items: patch.items ?? dirtyItemCount,
    npcs: patch.npcs ?? dirtyNpcCount,
    maps: patch.maps ?? dirtyMapCount,
    mobs: patch.mobs ?? dirtyMobCount,
    characters: patch.characters ?? dirtyCharacterCount,
    bosses: patch.bosses ?? dirtyBossCount,
    mechanics: patch.mechanics ?? dirtyMechanicCount,
    skills: patch.skills ?? dirtySkillCount,
    parts: 0,
  });

  const persistDraftChange = (
    patch: Partial<WorkspaceDirtyCounts> = {}
  ) => {
    if (!session) return;
    queueWorkspaceDraftSave(session, currentWorkspaceCounts(patch));
    setWorkspaceStatus('saved');
  };

  const handlePatchWorkspaceUpdated = () => {
    setPatchWorkspaceRevision((value) => value + 1);
    persistDraftChange();
  };

  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      setIsRestoringWorkspace(true);
      try {
        const savedFile = await loadWorkspaceSource();
        if (!savedFile || cancelled) return;

        const restoredSession = await loadAndAnalyzeJarSession(savedFile);
        const restored = await restoreWorkspaceDrafts(restoredSession);
        if (cancelled) return;

        setSession(restoredSession);
        setActiveTab('overview');
        setTestGameSource('ORIGINAL');
        setDirtyItemCount(restored.counts.items);
        setDirtyNpcCount(restored.counts.npcs);
        setDirtyMapCount(restored.counts.maps);
        setDirtyMobCount(restored.counts.mobs);
        setDirtyCharacterCount(restored.counts.characters);
        setDirtyBossCount(restored.counts.bosses);
        setDirtyMechanicCount(restored.counts.mechanics);
        setDirtySkillCount(restored.counts.skills);
        setWorkspaceStatus('restored');
        setErrorMessage(null);
      } catch (error) {
        if (!cancelled) {
          console.warn('[workspace restore] failed', error);
          setWorkspaceStatus('error');
        }
      } finally {
        if (!cancelled) setIsRestoringWorkspace(false);
      }
    };

    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const flush = () => {
      void flushWorkspaceDraftSave().catch(() => undefined);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };

    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  // Tải và phân tích JAR. Phần xử lý kỹ thuật được giữ nguyên, chỉ Việt hóa thông báo lỗi mặc định.
  const handleFileSelect = async (file: File) => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const loadedSession = await loadAndAnalyzeJarSession(file);
      // Nếu người dùng chọn lại đúng JAR đang làm, nhập lại toàn bộ draft thay
      // vì ghi một snapshot rỗng đè lên workspace cũ.
      const restored = await restoreWorkspaceDrafts(loadedSession);
      if (!restored.restored) {
        await clearPersistedWorkspace().catch(() => undefined);
      }
      await saveWorkspaceSource(loadedSession);
      const restoredCounts = restored.restored
        ? restored.counts
        : {
            items: 0,
            npcs: 0,
            maps: 0,
            mobs: 0,
            characters: 0,
            bosses: 0,
            mechanics: 0,
            skills: 0,
            parts: 0,
          };
      await saveWorkspaceDrafts(loadedSession, restoredCounts);
      setWorkspaceStatus('saved');
      setSession(loadedSession);
      setActiveTab('overview');
      setDirtyItemCount(restoredCounts.items);
      setDirtyNpcCount(restoredCounts.npcs);
      setDirtyMechanicCount(restoredCounts.mechanics);
      setDirtyBossCount(restoredCounts.bosses);
      setDirtyMapCount(restoredCounts.maps);
      setDirtyMobCount(restoredCounts.mobs);
      setDirtyCharacterCount(restoredCounts.characters);
      setDirtySkillCount(restoredCounts.skills);
      setDraftTestProgress(null);
      setDraftTestResult(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Không xác định được lỗi khi tải file JAR';
      setErrorMessage(message);
      setSession(null);
    } finally {
      setIsLoading(false);
    }
  };

  // Nếu còn bản nháp trong RAM thì yêu cầu xác nhận trước khi đóng JAR.
  const handleCloseJar = () => {
    const dirtyItems = getDirtyCount(session?.itemDrafts);
    const workspaceOperations = session ? getPatchWorkspaceOperationCount(session) : 0;
    if (
      dirtyItems > 0 ||
      workspaceOperations > 0 ||
      dirtyNpcCount > 0 ||
      dirtyMapCount > 0 ||
      dirtyMobCount > 0 ||
      dirtyCharacterCount > 0 ||
      dirtySkillCount > 0 ||
      dirtyMechanicCount > 0 ||
      dirtyBossCount > 0
    ) {
      setShowCloseConfirmModal(true);
      return;
    }
    forceCloseJar();
  };

  // Chỉ đóng JAR khỏi giao diện. Source + draft đã autosave vẫn được giữ để
  // F5/mở lại ứng dụng có thể khôi phục đúng workspace gần nhất.
  const forceCloseJar = () => {
    void flushWorkspaceDraftSave().catch(() => undefined);
    setSession(null);
    setActiveTab('overview');
    setErrorMessage(null);
    setIsLoading(false);
    setDirtyItemCount(0);
    setDirtyNpcCount(0);
    setDirtyMechanicCount(0);
    setDirtyBossCount(0);
    setDirtyMapCount(0);
    setDirtyMobCount(0);
    setDirtyCharacterCount(0);
    setDirtySkillCount(0);
    setDraftTestProgress(null);
    setDraftTestResult(null);
    setIsBuildingDraftTest(false);
    setWorkspaceStatus('idle');
    setPatchWorkspaceRevision((value) => value + 1);
    setShowCloseConfirmModal(false);
  };

  const workspaceOperationCount = session
    ? getPatchWorkspaceOperationCount(session)
    : 0;

  const totalDirtyDrafts =
    dirtyItemCount +
    dirtyNpcCount +
    dirtyMapCount +
    dirtyMobCount +
    dirtyCharacterCount +
    dirtySkillCount +
    dirtyBossCount +
    dirtyMechanicCount +
    workspaceOperationCount;

  const handleTestDraft = async (
    navigateToTest = true
  ): Promise<import('./types/jar').CandidateOutputJar | null> => {
    if (!session || isBuildingDraftTest) return null;

    setIsBuildingDraftTest(true);
    setDraftTestProgress({
      phase: 'COLLECTING',
      label: 'Đang gom nháp...',
      current: 0,
      total: 5,
    });
    setDraftTestResult(null);

    try {
      await flushWorkspaceDraftSave().catch(() => undefined);
      const result = await buildUnifiedWorkspaceCandidate(session, setDraftTestProgress);
      setDraftTestResult(result);

      if (result.status === 'VALIDATED' && result.candidate) {
        session.candidateOutput = result.candidate;
        setSession({ ...session });
        setTestGameSource('PATCHED');
        if (navigateToTest) {
          setActiveTab('test');
        }
        return result.candidate;
      }

      return null;
    } finally {
      setIsBuildingDraftTest(false);
    }
  };

  return (
    <div className="light-theme h-screen overflow-hidden bg-zinc-100 text-zinc-900 flex flex-col font-sans selection:bg-emerald-200 selection:text-emerald-900">
      <style>{LIGHT_THEME_CSS}</style>
      {/* Thanh tiêu đề ứng dụng */}
      <header className="border-b border-zinc-200 bg-white/95 sticky top-0 z-20 backdrop-blur shadow-sm">
        <div className="w-full px-3 xl:px-5 h-12 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 shadow-inner">
              <Terminal className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-zinc-100 flex items-center gap-2">
                NRO Studio
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                  v0.5
                </span>
              </h1>
              <p className="hidden lg:block text-[10px] text-zinc-500 leading-tight">J2ME JAR Editor</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {session ? (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-800/90 border border-zinc-700 text-xs font-mono text-zinc-200">
                  <FileArchive className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="text-zinc-400">JAR:</span>
                  <span className="font-semibold text-zinc-100 max-w-[180px] sm:max-w-xs truncate">
                    {session.jarInfo.fileName}
                  </span>
                </div>
                <div
                  className={`hidden xl:flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-mono ${
                    workspaceStatus === 'error'
                      ? 'bg-red-50 border-red-200 text-red-600'
                      : workspaceStatus === 'restored'
                      ? 'bg-indigo-50 border-indigo-200 text-indigo-600'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-600'
                  }`}
                  title="JAR gốc và các nháp được tự lưu trong IndexedDB của trình duyệt"
                >
                  <Database className="w-3 h-3" />
                  {workspaceStatus === 'error'
                    ? 'Tự lưu lỗi'
                    : workspaceStatus === 'restored'
                    ? 'Đã khôi phục'
                    : 'Tự lưu'}
                </div>
                <button
                  id="close-jar-button"
                  type="button"
                  onClick={handleCloseJar}
                  className="px-3 py-1 text-xs font-medium text-red-300 hover:text-red-200 bg-red-950/40 hover:bg-red-950/70 border border-red-800/60 rounded flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Đóng file JAR và giải phóng bộ nhớ"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>[ Đóng JAR ]</span>
                </button>
              </div>
            ) : (
              <div className="text-xs font-mono text-zinc-500">Chế độ bộ nhớ phía trình duyệt</div>
            )}
          </div>
        </div>
      </header>

      {/* Khu vực nội dung chính */}
      <main className={`flex-1 min-h-0 w-full ${session ? 'px-2 xl:px-3 py-2 overflow-hidden' : 'max-w-6xl mx-auto px-4 sm:px-6 py-5 sm:py-6 overflow-auto'}`}>
        {!session ? (
          <div className="pt-4 sm:pt-8">
            {isRestoringWorkspace ? (
              <div className="min-h-[360px] flex items-center justify-center">
                <div className="text-center space-y-2">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-indigo-500" />
                  <div className="text-sm font-semibold text-zinc-700">Đang khôi phục workspace...</div>
                  <div className="text-[11px] text-zinc-500">JAR và nháp lần trước được đọc từ IndexedDB.</div>
                </div>
              </div>
            ) : (
            <JarDropZone
              onFileSelect={handleFileSelect}
              isLoading={isLoading}
              errorMessage={errorMessage}
            />
            )}
          </div>
        ) : (
          <div className="h-full min-h-0 flex flex-col gap-2">
            {/* Thanh chuyển tab */}
            <div className="shrink-0 flex items-center gap-2">
              <div className="min-w-0 flex-1 flex items-center gap-0.5 bg-white p-1 rounded-lg border border-zinc-200 overflow-x-auto shadow-sm">
                <button
                  id="tab-overview"
                  type="button"
                  onClick={() => setActiveTab('overview')}
                  className={`px-2.5 py-1.5 rounded-md text-[11px] font-mono flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
                    activeTab === 'overview'
                      ? 'bg-zinc-800 text-zinc-100 font-semibold shadow-sm border border-zinc-700'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
                  }`}
                >
                  <LayoutDashboard className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Tổng quan</span>
                </button>

                <button
                  id="tab-game-data"
                  type="button"
                  onClick={() => setActiveTab('game-data')}
                  className={`px-2.5 py-1.5 rounded-md text-[11px] font-mono flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
                    activeTab === 'game-data'
                      ? 'bg-zinc-800 text-zinc-100 font-semibold shadow-sm border border-zinc-700'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
                  }`}
                >
                  <Database className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Dữ liệu</span>
                  {dirtyNpcCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold animate-pulse">
                      {dirtyNpcCount}
                    </span>
                  )}
                </button>

                <button
                  id="tab-maps"
                  type="button"
                  onClick={() => setActiveTab('maps')}
                  className={`px-2.5 py-1.5 rounded-md text-[11px] font-mono flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
                    activeTab === 'maps'
                      ? 'bg-zinc-800 text-zinc-100 font-semibold shadow-sm border border-zinc-700'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
                  }`}
                >
                  <MapPinned className="w-3.5 h-3.5 text-blue-400" />
                  <span>Map</span>
                  {dirtyMapCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/40 font-bold animate-pulse">
                      {dirtyMapCount}
                    </span>
                  )}
                </button>

                <button
                  id="tab-characters"
                  type="button"
                  onClick={() => setActiveTab('characters')}
                  className={`px-2.5 py-1.5 rounded-md text-[11px] font-mono flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
                    activeTab === 'characters'
                      ? 'bg-zinc-800 text-zinc-100 font-semibold shadow-sm border border-zinc-700'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
                  }`}
                >
                  <UserRound className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Nhân vật</span>
                  {dirtyCharacterCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 font-bold animate-pulse">
                      {dirtyCharacterCount}
                    </span>
                  )}
                </button>

                <button
                  id="tab-skills"
                  type="button"
                  onClick={() => setActiveTab('skills')}
                  className={`px-2.5 py-1.5 rounded-md text-[11px] font-mono flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
                    activeTab === 'skills'
                      ? 'bg-zinc-800 text-zinc-100 font-semibold shadow-sm border border-zinc-700'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5 text-fuchsia-500" />
                  <span>Kỹ năng</span>
                  {dirtySkillCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-fuchsia-500/20 text-fuchsia-700 border border-fuchsia-300 font-bold animate-pulse">
                      {dirtySkillCount}
                    </span>
                  )}
                </button>


                <button
                  id="tab-mobs"
                  type="button"
                  onClick={() => setActiveTab('mobs')}
                  className={`px-2.5 py-1.5 rounded-md text-[11px] font-mono flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
                    activeTab === 'mobs'
                      ? 'bg-zinc-800 text-zinc-100 font-semibold shadow-sm border border-zinc-700'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
                  }`}
                >
                  <Bug className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Quái</span>
                  {dirtyMobCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-600 border border-emerald-500/40 font-bold animate-pulse">
                      {dirtyMobCount}
                    </span>
                  )}
                </button>

                <button
                  id="tab-bosses"
                  type="button"
                  onClick={() => setActiveTab('bosses')}
                  className={`px-2.5 py-1.5 rounded-md text-[11px] font-mono flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
                    activeTab === 'bosses'
                      ? 'bg-zinc-800 text-zinc-100 font-semibold shadow-sm border border-zinc-700'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
                  }`}
                >
                  <Crown className="w-3.5 h-3.5 text-rose-400" />
                  <span>Boss</span>
                  {dirtyBossCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold animate-pulse">
                      {dirtyBossCount}
                    </span>
                  )}
                </button>

                <button
                  id="tab-mechanics"
                  type="button"
                  onClick={() => setActiveTab('mechanics')}
                  className={`px-2.5 py-1.5 rounded-md text-[11px] font-mono flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
                    activeTab === 'mechanics'
                      ? 'bg-zinc-800 text-zinc-100 font-semibold shadow-sm border border-zinc-700'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
                  }`}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5 text-violet-400" />
                  <span>Cơ chế</span>
                  {dirtyMechanicCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/40 font-bold animate-pulse">
                      {dirtyMechanicCount}
                    </span>
                  )}
                </button>

                <button
                  id="tab-explorer"
                  type="button"
                  onClick={() => setActiveTab('explorer')}
                  className={`px-2.5 py-1.5 rounded-md text-[11px] font-mono flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
                    activeTab === 'explorer'
                      ? 'bg-zinc-800 text-zinc-100 font-semibold shadow-sm border border-zinc-700'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
                  }`}
                >
                  <Compass className="w-3.5 h-3.5 text-blue-400" />
                  <span>Duyệt JAR</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-950 text-zinc-400 border border-zinc-800">
                    {session.entries.length.toLocaleString('vi-VN')}
                  </span>
                </button>

                <button
                  id="tab-items"
                  type="button"
                  onClick={() => setActiveTab('items')}
                  className={`px-2.5 py-1.5 rounded-md text-[11px] font-mono flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
                    activeTab === 'items'
                      ? 'bg-zinc-800 text-zinc-100 font-semibold shadow-sm border border-zinc-700'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
                  }`}
                >
                  <Package className="w-3.5 h-3.5 text-amber-400" />
                  <span>Vật phẩm</span>
                  {dirtyItemCount > 0 ? (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold animate-pulse">
                      {dirtyItemCount}
                    </span>
                  ) : (
                    session.itemAnalysis && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-950 text-amber-400 border border-zinc-800">
                        {session.itemAnalysis.items.length.toLocaleString('vi-VN')}
                      </span>
                    )
                  )}
                </button>

                <button
                  id="tab-multiplayer"
                  type="button"
                  onClick={() => setActiveTab('multiplayer')}
                  className={`px-2.5 py-1.5 rounded-md text-[11px] font-mono flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
                    activeTab === 'multiplayer'
                      ? 'bg-zinc-800 text-zinc-100 font-semibold shadow-sm border border-zinc-700'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
                  }`}
                >
                  <Network className="w-3.5 h-3.5 text-cyan-500" />
                  <span>Multiplayer</span>
                  {session.candidateOutput?.status === 'VALIDATED' &&
                    (session.candidateOutput?.metrics?.source === 'MULTIPLAYER_LITE' ||
                      (session.candidateOutput?.metrics?.source === 'UNIFIED_WORKSPACE' &&
                        session.candidateOutput?.metrics?.multiplayerLite)) && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-cyan-100 text-cyan-700 border border-cyan-200 font-bold">
                        Ready
                      </span>
                    )}
                </button>

                <button
                  id="test-drafts-button"
                  type="button"
                  onClick={() => {
                    void handleTestDraft(true);
                  }}
                  disabled={isBuildingDraftTest || totalDirtyDrafts === 0}
                  className="px-2.5 py-1.5 rounded-md text-[11px] font-mono flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer bg-violet-500/10 border border-violet-500/30 text-violet-600 hover:bg-violet-500/15 disabled:opacity-40 disabled:cursor-not-allowed"
                  title={
                    totalDirtyDrafts === 0
                      ? 'Chưa có nháp / operation để test'
                      : 'Hợp nhất toàn bộ nháp + Item mới + Multiplayer thành một JAR test'
                  }
                >
                  {isBuildingDraftTest ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <PlayCircle className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {isBuildingDraftTest
                      ? draftTestProgress?.label || 'Đang dựng...'
                      : 'Test Workspace'}
                  </span>
                  {totalDirtyDrafts > 0 && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-violet-100 text-violet-700 border border-violet-200 font-bold">
                      {totalDirtyDrafts}
                    </span>
                  )}
                  {workspaceOperationCount > 0 && (
                    <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold">
                      WS {workspaceOperationCount}
                    </span>
                  )}
                </button>

                <button
                  id="tab-test-game"
                  type="button"
                  onClick={() => setActiveTab('test')}
                  className={`px-2.5 py-1.5 rounded-md text-[11px] font-mono flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
                    activeTab === 'test'
                      ? 'bg-zinc-800 text-zinc-100 font-semibold shadow-sm border border-zinc-700'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
                  }`}
                >
                  <Gamepad2 className="w-3.5 h-3.5 text-purple-400" />
                  <span>Chạy thử</span>
                  {session.candidateOutput?.status === 'VALIDATED' && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-600 border border-emerald-500/40 font-bold">
                      {session.candidateOutput?.metrics?.source === 'UNIFIED_WORKSPACE'
                        ? 'Workspace'
                        : session.candidateOutput?.metrics?.source === 'DRAFT_TEST'
                        ? 'Nháp'
                        : session.candidateOutput?.metrics?.source === 'MULTIPLAYER_LITE'
                        ? 'Multi'
                        : 'Đã vá'}
                    </span>
                  )}
                  {session.candidateOutput?.status === 'STALE' &&
                    ['DRAFT_TEST', 'UNIFIED_WORKSPACE'].includes(session.candidateOutput?.metrics?.source) && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-700 border border-amber-200 font-bold">
                        Workspace cũ
                      </span>
                    )}
                </button>
              </div>


            </div>

            <PatchWorkspaceBar
              session={session}
              onChanged={handlePatchWorkspaceUpdated}
            />

            {/* Nội dung từng tab */}
            <div className={`min-h-0 flex-1 ${
              activeTab === 'bosses' || activeTab === 'maps' || activeTab === 'mobs' || activeTab === 'characters' || activeTab === 'skills' || activeTab === 'multiplayer'
                ? 'overflow-hidden'
                : 'overflow-auto'
            }`}>
            {activeTab === 'overview' ? (
              <div className="space-y-5">
                <JarInfoPanel jarInfo={session.jarInfo} />
                <ManifestPanel manifest={session.jarInfo.manifest} />
              </div>
            ) : activeTab === 'game-data' ? (
              <GameDataPanel
                session={session}
                onNpcDraftsUpdated={(count) => {
                  setDirtyNpcCount(count);
                  persistDraftChange({ npcs: count });
                }}
              />
            ) : activeTab === 'maps' ? (
              <MapPanel
                session={session}
                onDraftsUpdated={(count) => {
                  setDirtyMapCount(count);
                  persistDraftChange({ maps: count });
                }}
                onBossDraftsUpdated={(count) => {
                  setDirtyBossCount(count);
                  persistDraftChange({ bosses: count });
                }}
              />
            ) : activeTab === 'mobs' ? (
              <MobPanel
                session={session}
                onDraftsUpdated={(count) => {
                  setDirtyMobCount(count);
                  persistDraftChange({ mobs: count });
                }}
              />
            ) : activeTab === 'characters' ? (
              <CharacterPanel
                session={session}
                onDraftsUpdated={(count) => {
                  setDirtyCharacterCount(count);
                  persistDraftChange({ characters: count });
                }}
              />
            ) : activeTab === 'skills' ? (
              <SkillPanel
                session={session}
                onDraftsUpdated={(count) => {
                  setDirtySkillCount(count);
                  persistDraftChange({ skills: count });
                }}
              />
            ) : activeTab === 'bosses' ? (
              <BossPanel
                session={session}
                onDraftsUpdated={(count) => {
                  setDirtyBossCount(count);
                  persistDraftChange({ bosses: count });
                }}
              />
            ) : activeTab === 'mechanics' ? (
              <GameMechanicsPanel
                session={session}
                onDraftsUpdated={(count) => {
                  setDirtyMechanicCount(count);
                  persistDraftChange({ mechanics: count });
                }}
              />
            ) : activeTab === 'multiplayer' ? (
              <MultiplayerPanel
                session={session}
                onWorkspaceUpdated={handlePatchWorkspaceUpdated}
                onCandidateBuilt={(candidate) => {
                  session.candidateOutput = candidate;
                  setSession({ ...session });
                  setTestGameSource('PATCHED');
                  setActiveTab('test');
                }}
              />
            ) : activeTab === 'explorer' ? (
              <JarExplorer session={session} />
            ) : activeTab === 'items' ? (
              <ItemsBrowser
                session={session}
                onDraftsUpdated={(count) => {
                  setDirtyItemCount(count);
                  persistDraftChange({ items: count });
                }}
                onWorkspaceUpdated={handlePatchWorkspaceUpdated}
                onNavigateToTestGame={(src) => {
                  setTestGameSource(src);
                  setActiveTab('test');
                }}
              />
            ) : (
              <TestGameTab
                session={session}
                initialSource={testGameSource}
                onBuildDraftCandidate={() => handleTestDraft(false)}
                onNavigateToPatchBuilder={() => setActiveTab('items')}
              />
            )}
            </div>
          </div>
        )}
      </main>

      {draftTestResult && draftTestResult.status !== 'VALIDATED' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm">
          <div className="bg-white border border-zinc-200 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-200 flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                  draftTestResult.status === 'NO_CHANGES'
                    ? 'bg-zinc-100 text-zinc-500'
                    : 'bg-amber-50 text-amber-600'
                }`}>
                  {draftTestResult.status === 'NO_CHANGES' ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <AlertTriangle className="w-4 h-4" />
                  )}
                </div>
                <div>
                  <div className="text-sm font-bold text-zinc-900">
                    {draftTestResult.status === 'BLOCKED'
                      ? 'Chưa thể Test nháp chính xác'
                      : draftTestResult.status === 'NO_CHANGES'
                      ? 'Không có thay đổi để test'
                      : 'Dựng JAR test thất bại'}
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-1">
                    Tool không âm thầm bỏ qua nháp chưa có writer.
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDraftTestResult(null)}
                className="text-zinc-400 hover:text-zinc-700 text-xl leading-none cursor-pointer"
              >
                ×
              </button>
            </div>

            <div className="p-5 space-y-3">
              {draftTestResult.errorMessage && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-[11px] font-mono">
                  {draftTestResult.errorMessage}
                </div>
              )}

              {draftTestResult.blockers.length > 0 && (
                <div className="space-y-2">
                  {draftTestResult.blockers.map((blocker, index) => (
                    <div
                      key={`${blocker.area}-${index}`}
                      className="p-3 rounded-xl border border-amber-200 bg-amber-50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <strong className="text-[11px] text-amber-800">
                          {blocker.area}
                        </strong>
                        <span className="text-[10px] font-mono text-amber-700">
                          {blocker.count} nháp
                        </span>
                      </div>
                      <div className="text-[11px] text-amber-700 mt-1 leading-relaxed">
                        {blocker.message}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-[10px] font-mono">
                <div className="p-2 rounded-lg bg-zinc-50 border border-zinc-200">
                  <div className="text-zinc-500">Hỗ trợ</div>
                  <div className="text-base font-bold text-emerald-600">
                    {draftTestResult.summary.supportedDrafts}
                  </div>
                </div>
                <div className="p-2 rounded-lg bg-zinc-50 border border-zinc-200">
                  <div className="text-zinc-500">Chưa writer</div>
                  <div className="text-base font-bold text-amber-600">
                    {draftTestResult.summary.unsupportedDrafts}
                  </div>
                </div>
                <div className="p-2 rounded-lg bg-zinc-50 border border-zinc-200">
                  <div className="text-zinc-500">Map</div>
                  <div className="text-base font-bold text-blue-600">
                    {draftTestResult.summary.mapDrafts}
                  </div>
                </div>
                <div className="p-2 rounded-lg bg-zinc-50 border border-zinc-200">
                  <div className="text-zinc-500">Kỹ năng</div>
                  <div className="text-base font-bold text-fuchsia-600">
                    {draftTestResult.summary.skillDrafts}
                  </div>
                </div>
                <div className="p-2 rounded-lg bg-zinc-50 border border-zinc-200">
                  <div className="text-zinc-500">NPC / Item</div>
                  <div className="text-base font-bold text-violet-600">
                    {draftTestResult.summary.npcDrafts + draftTestResult.summary.itemDrafts}
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-zinc-200 bg-zinc-50 flex justify-end">
              <button
                type="button"
                onClick={() => setDraftTestResult(null)}
                className="px-4 py-2 rounded-xl bg-zinc-900 text-white text-xs font-medium cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Xác nhận khi đóng JAR trong lúc còn thay đổi chưa lưu */}
      {showCloseConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-start gap-3 text-amber-400">
              <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-zinc-100">Workspace đã được tự động lưu</h3>
                <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                  Bạn đang có{' '}
                  <strong className="text-amber-400 font-mono">{dirtyItemCount}</strong> vật phẩm và{' '}
                  <strong className="text-cyan-400 font-mono">{dirtyNpcCount}</strong> NPC,{' '}
                  <strong className="text-blue-400 font-mono">{dirtyMapCount}</strong> map,{' '}
                  <strong className="text-indigo-400 font-mono">{dirtyCharacterCount}</strong> nhân vật,{' '}
                  <strong className="text-fuchsia-500 font-mono">{dirtySkillCount}</strong> kỹ năng,{' '}
                  <strong className="text-rose-400 font-mono">{dirtyBossCount}</strong> boss và{' '}
                  <strong className="text-violet-400 font-mono">{dirtyMechanicCount}</strong> cơ chế đang được lưu trong workspace.
                  Đóng JAR chỉ ẩn phiên hiện tại; F5 hoặc mở lại web sẽ tự khôi phục các thay đổi này.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800 font-mono">
              <button
                type="button"
                onClick={() => setShowCloseConfirmModal(false)}
                className="px-3.5 py-1.5 rounded-lg text-xs text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 border border-zinc-700 cursor-pointer transition-colors"
              >
                Tiếp tục chỉnh sửa
              </button>
              <button
                type="button"
                onClick={forceCloseJar}
                className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-red-950/80 hover:bg-red-900 text-red-200 border border-red-800 cursor-pointer transition-colors"
              >
                Đóng JAR (vẫn lưu nháp)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
