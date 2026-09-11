import React, { useEffect, useState, useRef, useCallback } from 'react';
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
  Download,
  Tag,
  Edit3,
  Sliders,
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
import { MetadataVersionModal } from './components/workspace/MetadataVersionModal';
import { AppTabNavigation, AppTabKey } from './components/navigation/AppTabNavigation';
import {
  bumpSessionVersion,
  getWorkspaceMetadata,
  recordVersionHistory,
  resolveExportFileName,
} from './services/workspaceMetadataService';
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
  const [activeTab, setActiveTab] = useState<AppTabKey>('overview');
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
  const [showMetadataModal, setShowMetadataModal] = useState(false);
  const [exportNotice, setExportNotice] = useState<{
    fileName: string;
    version: string;
    nextVersion?: string;
  } | null>(null);

  const dirtyCountsRef = useRef<WorkspaceDirtyCounts>({
    items: 0,
    npcs: 0,
    maps: 0,
    mobs: 0,
    characters: 0,
    skills: 0,
    bosses: 0,
    mechanics: 0,
    parts: 0,
  });

  const currentWorkspaceCounts = (
    patch: Partial<WorkspaceDirtyCounts> = {}
  ): WorkspaceDirtyCounts => ({
    items: patch.items ?? dirtyCountsRef.current.items,
    npcs: patch.npcs ?? dirtyCountsRef.current.npcs,
    maps: patch.maps ?? dirtyCountsRef.current.maps,
    mobs: patch.mobs ?? dirtyCountsRef.current.mobs,
    characters: patch.characters ?? dirtyCountsRef.current.characters,
    bosses: patch.bosses ?? dirtyCountsRef.current.bosses,
    mechanics: patch.mechanics ?? dirtyCountsRef.current.mechanics,
    skills: patch.skills ?? dirtyCountsRef.current.skills,
    parts: 0,
  });

  const updateDirtyCount = useCallback((key: keyof WorkspaceDirtyCounts, count: number) => {
    if (dirtyCountsRef.current[key] === count) return;
    dirtyCountsRef.current[key] = count;

    if (key === 'items') setDirtyItemCount(count);
    else if (key === 'npcs') setDirtyNpcCount(count);
    else if (key === 'maps') setDirtyMapCount(count);
    else if (key === 'mobs') setDirtyMobCount(count);
    else if (key === 'characters') setDirtyCharacterCount(count);
    else if (key === 'skills') setDirtySkillCount(count);
    else if (key === 'bosses') setDirtyBossCount(count);
    else if (key === 'mechanics') setDirtyMechanicCount(count);

    if (session) {
      queueWorkspaceDraftSave(session, { ...dirtyCountsRef.current });
      setWorkspaceStatus('saved');
    }
  }, [session]);

  const handleNpcDraftsUpdated = useCallback((count: number) => {
    updateDirtyCount('npcs', count);
  }, [updateDirtyCount]);

  const handleMapDraftsUpdated = useCallback((count: number) => {
    updateDirtyCount('maps', count);
  }, [updateDirtyCount]);

  const handleMobDraftsUpdated = useCallback((count: number) => {
    updateDirtyCount('mobs', count);
  }, [updateDirtyCount]);

  const handleCharacterDraftsUpdated = useCallback((count: number) => {
    updateDirtyCount('characters', count);
  }, [updateDirtyCount]);

  const handleSkillDraftsUpdated = useCallback((count: number) => {
    updateDirtyCount('skills', count);
  }, [updateDirtyCount]);

  const handleBossDraftsUpdated = useCallback((count: number) => {
    updateDirtyCount('bosses', count);
  }, [updateDirtyCount]);

  const handleMechanicDraftsUpdated = useCallback((count: number) => {
    updateDirtyCount('mechanics', count);
  }, [updateDirtyCount]);

  const handleItemDraftsUpdated = useCallback((count: number) => {
    updateDirtyCount('items', count);
  }, [updateDirtyCount]);

  const persistDraftChange = useCallback((
    patch: Partial<WorkspaceDirtyCounts> = {}
  ) => {
    if (!session) return;
    queueWorkspaceDraftSave(session, currentWorkspaceCounts(patch));
    setWorkspaceStatus('saved');
  }, [session]);

  const handlePatchWorkspaceUpdated = useCallback(() => {
    if (session) {
      const meta = getWorkspaceMetadata(session);
      if (meta.autoIncrementOnEdit) {
        bumpSessionVersion(session, meta.incrementStrategy, 'EDIT');
      }
    }
    setPatchWorkspaceRevision((value) => value + 1);
    if (session) {
      queueWorkspaceDraftSave(session, { ...dirtyCountsRef.current });
      setWorkspaceStatus('saved');
    }
  }, [session]);

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

        dirtyCountsRef.current = { ...restored.counts, parts: 0 };
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
      dirtyCountsRef.current = { ...restoredCounts, parts: 0 };
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

  const downloadJarBlob = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleExportWorkspaceJar = async () => {
    if (!session || isBuildingDraftTest) return;

    const metadata = getWorkspaceMetadata(session);
    let candidate =
      session.candidateOutput?.status === 'VALIDATED'
        ? session.candidateOutput
        : null;

    if (!candidate) {
      candidate = await handleTestDraft(false);
    }

    if (candidate?.status === 'VALIDATED') {
      const finalFileName = candidate.fileName || resolveExportFileName(metadata);
      downloadJarBlob(candidate.blob, finalFileName);

      recordVersionHistory(session, {
        action: 'EXPORT',
        version: metadata.version,
        fileName: finalFileName,
        description: `Tải về file JAR thành công: ${finalFileName}`,
      });

      let nextVersionStr: string | undefined;
      if (metadata.autoIncrementOnDownload) {
        const bumped = bumpSessionVersion(session, metadata.incrementStrategy, 'EXPORT');
        nextVersionStr = bumped.newVersion;
        setPatchWorkspaceRevision((v) => v + 1);
      }

      setExportNotice({
        fileName: finalFileName,
        version: metadata.version,
        nextVersion: nextVersionStr,
      });

      setTimeout(() => setExportNotice(null), 8000);
      void flushWorkspaceDraftSave().catch(() => undefined);
      return;
    }

    window.alert('Không thể xuất JAR: bản dựng workspace chưa vượt qua kiểm tra. Xem lỗi ở Test Workspace.');
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
                <button
                  id="header-metadata-button"
                  type="button"
                  onClick={() => setShowMetadataModal(true)}
                  className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700/90 border border-zinc-700 text-xs font-mono text-zinc-200 cursor-pointer transition-colors shadow-2xs"
                  title="Chỉnh sửa Tên file, Tác giả và Phiên bản xuất JAR"
                >
                  <Tag className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="hidden sm:inline text-zinc-400">Xuất:</span>
                  <span className="font-semibold text-emerald-300 max-w-[85px] sm:max-w-[130px] truncate">
                    {getWorkspaceMetadata(session).exportFileName}
                  </span>
                  <span className="px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-700 text-[10px] font-bold shrink-0">
                    v{getWorkspaceMetadata(session).version}
                  </span>
                  <Edit3 className="w-3 h-3 text-zinc-400 ml-0.5 hover:text-white shrink-0" />
                </button>

                <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-800/90 border border-zinc-700 text-xs font-mono text-zinc-200">
                  <FileArchive className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="text-zinc-400">JAR:</span>
                  <span className="font-semibold text-zinc-100 max-w-[140px] sm:max-w-xs truncate">
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

                <div className="flex items-center shrink-0">
                  <button
                    id="export-workspace-jar-button"
                    type="button"
                    onClick={() => void handleExportWorkspaceJar()}
                    disabled={isBuildingDraftTest}
                    className="px-2.5 sm:px-3 py-1 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 border border-emerald-500 rounded-l flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    title={`Dựng và tải JAR: ${resolveExportFileName(getWorkspaceMetadata(session))}`}
                  >
                    {isBuildingDraftTest ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <span>
                      {isBuildingDraftTest ? (
                        'Đang dựng...'
                      ) : (
                        <>
                          <span className="hidden sm:inline">Xuất JAR (v{getWorkspaceMetadata(session).version})</span>
                          <span className="sm:hidden">Xuất v{getWorkspaceMetadata(session).version}</span>
                        </>
                      )}
                    </span>
                  </button>
                  <button
                    id="header-metadata-quick-toggle"
                    type="button"
                    onClick={() => setShowMetadataModal(true)}
                    className="px-2 py-1 text-xs text-emerald-200 hover:text-white bg-emerald-700 hover:bg-emerald-600 border-y border-r border-emerald-500 rounded-r flex items-center transition-colors cursor-pointer"
                    title="Cấu hình Tên file, Tác giả & Phiên bản"
                  >
                    <Sliders className="w-3.5 h-3.5" />
                  </button>
                </div>

                <button
                  id="close-jar-button"
                  type="button"
                  onClick={handleCloseJar}
                  className="px-2 sm:px-3 py-1 text-xs font-medium text-red-300 hover:text-red-200 bg-red-950/40 hover:bg-red-950/70 border border-red-800/60 rounded flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                  title="Đóng file JAR và giải phóng bộ nhớ"
                >
                  <XCircle className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden sm:inline">[ Đóng JAR ]</span>
                  <span className="sm:hidden">Đóng</span>
                </button>
              </div>
            ) : (
              <div className="text-xs font-mono text-zinc-500">Chế độ bộ nhớ phía trình duyệt</div>
            )}
          </div>
        </div>
      </header>

      {/* Thông báo xuất file thành công */}
      {exportNotice && (
        <div className="bg-emerald-600 text-white px-4 py-2 text-xs flex items-center justify-between shadow-md animate-in fade-in duration-150 shrink-0">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-200 shrink-0" />
            <span>
              Đã xuất và tải về file: <strong className="font-mono">{exportNotice.fileName}</strong> (Phiên bản: <strong className="font-mono">v{exportNotice.version}</strong>).
              {exportNotice.nextVersion && (
                <span className="ml-2 bg-emerald-700 px-2 py-0.5 rounded font-mono text-[11px] inline-flex items-center gap-1">
                  <span>Phiên bản tiếp theo:</span>
                  <strong className="text-emerald-100">v{exportNotice.nextVersion}</strong>
                </span>
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setExportNotice(null)}
            className="text-emerald-200 hover:text-white ml-3 cursor-pointer"
            title="Đóng"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}

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
          <div className="h-full min-h-0 flex flex-col gap-2 pb-14 md:pb-0 w-full min-w-0 max-w-full">
            {/* Thanh chuyển tab tương thích tối ưu Desktop & Mobile */}
            <AppTabNavigation
              session={session}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              dirtyCounts={{
                items: dirtyItemCount,
                npcs: dirtyNpcCount,
                maps: dirtyMapCount,
                mobs: dirtyMobCount,
                characters: dirtyCharacterCount,
                skills: dirtySkillCount,
                bosses: dirtyBossCount,
                mechanics: dirtyMechanicCount,
              }}
              totalDirtyDrafts={totalDirtyDrafts}
              workspaceOperationCount={workspaceOperationCount}
              isBuildingDraftTest={isBuildingDraftTest}
              draftTestProgress={draftTestProgress}
              onTestDraft={() => void handleTestDraft(true)}
            />

            <PatchWorkspaceBar
              session={session}
              onChanged={handlePatchWorkspaceUpdated}
            />

            {/* Nội dung từng tab */}
            <div className={`min-h-0 flex-1 w-full min-w-0 max-w-full ${
              activeTab === 'bosses' || activeTab === 'maps' || activeTab === 'mobs' || activeTab === 'characters' || activeTab === 'skills' || activeTab === 'multiplayer'
                ? 'overflow-auto md:overflow-hidden'
                : 'overflow-auto'
            }`}>
            {activeTab === 'overview' ? (
              <div className="space-y-5">
                <JarInfoPanel jarInfo={session.jarInfo} />
                <ManifestPanel
                  manifest={session.jarInfo.manifest}
                  session={session}
                  onMetadataChanged={() => setPatchWorkspaceRevision((v) => v + 1)}
                />
              </div>
            ) : activeTab === 'game-data' ? (
              <GameDataPanel
                session={session}
                onNpcDraftsUpdated={handleNpcDraftsUpdated}
              />
            ) : activeTab === 'maps' ? (
              <MapPanel
                session={session}
                onDraftsUpdated={handleMapDraftsUpdated}
                onBossDraftsUpdated={handleBossDraftsUpdated}
              />
            ) : activeTab === 'mobs' ? (
              <MobPanel
                session={session}
                onDraftsUpdated={handleMobDraftsUpdated}
              />
            ) : activeTab === 'characters' ? (
              <CharacterPanel
                session={session}
                onDraftsUpdated={handleCharacterDraftsUpdated}
              />
            ) : activeTab === 'skills' ? (
              <SkillPanel
                session={session}
                onDraftsUpdated={handleSkillDraftsUpdated}
              />
            ) : activeTab === 'bosses' ? (
              <BossPanel
                session={session}
                onDraftsUpdated={handleBossDraftsUpdated}
              />
            ) : activeTab === 'mechanics' ? (
              <GameMechanicsPanel
                session={session}
                onDraftsUpdated={handleMechanicDraftsUpdated}
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
                onDraftsUpdated={handleItemDraftsUpdated}
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

      {showMetadataModal && session && (
        <MetadataVersionModal
          session={session}
          onClose={() => setShowMetadataModal(false)}
          onSaved={() => setPatchWorkspaceRevision((v) => v + 1)}
        />
      )}
    </div>
  );
}
