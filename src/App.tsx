import React, { useState } from 'react';
import {
  Terminal,
  XCircle,
  FileArchive,
  LayoutDashboard,
  Compass,
  Package,
  AlertTriangle,
  Gamepad2,
  Loader2,
} from 'lucide-react';
import { LoadedJarSession } from './types/jar';
import { loadAndAnalyzeJarSession } from './services/jarService';
import { JarDropZone } from './components/JarDropZone';
import { JarInfoPanel } from './components/JarInfoPanel';
import { ManifestPanel } from './components/ManifestPanel';
import { JarExplorer } from './components/explorer/JarExplorer';
import { ItemsBrowser } from './components/items/ItemsBrowser';
import { TestGameTab } from './components/emulator/TestGameTab';
import { getDirtyCount, discardAllDrafts } from './services/itemDraftService';
import { buildLatestPatchedJarForTest } from './services/quickTestService';

export default function App() {
  const [session, setSession] = useState<LoadedJarSession | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'explorer' | 'items' | 'test'>('overview');
  const [testGameSource, setTestGameSource] = useState<'ORIGINAL' | 'PATCHED'>('ORIGINAL');
  // Incremented for every test launch so React never reuses an old emulator session.
  const [testLaunchNonce, setTestLaunchNonce] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dirtyItemCount, setDirtyItemCount] = useState(0);
  const [showCloseConfirmModal, setShowCloseConfirmModal] = useState(false);

  // One-click "edit -> rebuild -> verify -> test" state.
  const [isQuickTesting, setIsQuickTesting] = useState(false);
  const [quickTestMessage, setQuickTestMessage] = useState('');
  const [quickTestError, setQuickTestError] = useState<string | null>(null);

  const handleFileSelect = async (file: File) => {
    setIsLoading(true);
    setErrorMessage(null);
    setQuickTestError(null);

    try {
      const loadedSession = await loadAndAnalyzeJarSession(file);
      setSession(loadedSession);
      setActiveTab('overview');
      setDirtyItemCount(0);
      setTestGameSource('ORIGINAL');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error loading JAR';
      setErrorMessage(message);
      setSession(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCloseJar = () => {
    const dirty = getDirtyCount(session?.itemDrafts);
    if (dirty > 0) {
      setShowCloseConfirmModal(true);
      return;
    }
    forceCloseJar();
  };

  const forceCloseJar = () => {
    if (session?.itemDrafts) {
      discardAllDrafts(session.itemDrafts);
    }
    setSession(null);
    setActiveTab('overview');
    setErrorMessage(null);
    setIsLoading(false);
    setDirtyItemCount(0);
    setShowCloseConfirmModal(false);
    setQuickTestError(null);
    setQuickTestMessage('');
    setIsQuickTesting(false);
    setTestGameSource('ORIGINAL');
  };

  /**
   * New behavior:
   * - If there are in-memory item edits, clicking Test Game automatically rebuilds all current drafts,
   *   validates the class rewrites, builds & verifies a patched JAR in RAM, then opens Test Game using it.
   * - If there are no edits, it simply opens the original JAR.
   * No download/re-upload round trip is required.
   */
  const handleTestGameClick = async () => {
    if (!session || isQuickTesting) return;

    const dirtyNow = getDirtyCount(session.itemDrafts);
    setQuickTestError(null);

    if (dirtyNow <= 0) {
      setTestGameSource('ORIGINAL');
      setTestLaunchNonce((n) => n + 1);
      setActiveTab('test');
      return;
    }

    setIsQuickTesting(true);
    setQuickTestMessage('Đang chuẩn bị thay đổi mới nhất...');

    try {
      await buildLatestPatchedJarForTest(session, (progress) => {
        setQuickTestMessage(progress.message);
      });

      // TestGameTab is mounted only after the verified candidate exists,
      // so it receives the newest Patched JAR on first render.
      setTestGameSource('PATCHED');
      setTestLaunchNonce((n) => n + 1);
      setActiveTab('test');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Quick Test Latest Changes] Failed:', err);
      setQuickTestError(message);
    } finally {
      setIsQuickTesting(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-emerald-500/20 selection:text-emerald-300">
      <header className="border-b border-zinc-800/80 bg-zinc-900/90 sticky top-0 z-20 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 shadow-inner">
              <Terminal className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-zinc-100 flex items-center gap-2">
                NRO Studio
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                  v0.5
                </span>
              </h1>
              <p className="text-[11px] text-zinc-400 leading-tight">J2ME JAR Editor</p>
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
                <button
                  id="close-jar-button"
                  type="button"
                  onClick={handleCloseJar}
                  className="px-3 py-1 text-xs font-medium text-red-300 hover:text-red-200 bg-red-950/40 hover:bg-red-950/70 border border-red-800/60 rounded flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Đóng file JAR và giải phóng bộ nhớ"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>[ Close JAR ]</span>
                </button>
              </div>
            ) : (
              <div className="text-xs font-mono text-zinc-500">Chế độ Client-Side Memory</div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-5 sm:py-6">
        {!session ? (
          <div className="pt-4 sm:pt-8">
            <JarDropZone
              onFileSelect={handleFileSelect}
              isLoading={isLoading}
              errorMessage={errorMessage}
            />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-zinc-800/80">
              <div className="flex items-center gap-1 bg-zinc-900/90 p-1 rounded-lg border border-zinc-800 w-fit flex-wrap">
                <button
                  id="tab-overview"
                  type="button"
                  onClick={() => setActiveTab('overview')}
                  className={`px-3.5 py-1.5 rounded-md text-xs font-mono flex items-center gap-2 transition-colors cursor-pointer ${
                    activeTab === 'overview'
                      ? 'bg-zinc-800 text-zinc-100 font-semibold shadow-sm border border-zinc-700'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
                  }`}
                >
                  <LayoutDashboard className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Overview</span>
                </button>

                <button
                  id="tab-explorer"
                  type="button"
                  onClick={() => setActiveTab('explorer')}
                  className={`px-3.5 py-1.5 rounded-md text-xs font-mono flex items-center gap-2 transition-colors cursor-pointer ${
                    activeTab === 'explorer'
                      ? 'bg-zinc-800 text-zinc-100 font-semibold shadow-sm border border-zinc-700'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
                  }`}
                >
                  <Compass className="w-3.5 h-3.5 text-blue-400" />
                  <span>JAR Explorer</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-950 text-zinc-400 border border-zinc-800">
                    {session.entries.length.toLocaleString()}
                  </span>
                </button>

                <button
                  id="tab-items"
                  type="button"
                  onClick={() => setActiveTab('items')}
                  className={`px-3.5 py-1.5 rounded-md text-xs font-mono flex items-center gap-2 transition-colors cursor-pointer ${
                    activeTab === 'items'
                      ? 'bg-zinc-800 text-zinc-100 font-semibold shadow-sm border border-zinc-700'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
                  }`}
                >
                  <Package className="w-3.5 h-3.5 text-amber-400" />
                  <span>Items</span>
                  {dirtyItemCount > 0 ? (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold animate-pulse">
                      {dirtyItemCount} modified
                    </span>
                  ) : (
                    session.itemAnalysis && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-950 text-amber-400 border border-zinc-800">
                        {session.itemAnalysis.items.length.toLocaleString()}
                      </span>
                    )
                  )}
                </button>

                <button
                  id="tab-test-game"
                  type="button"
                  onClick={handleTestGameClick}
                  disabled={isQuickTesting}
                  className={`px-3.5 py-1.5 rounded-md text-xs font-mono flex items-center gap-2 transition-colors cursor-pointer disabled:cursor-wait disabled:opacity-80 ${
                    activeTab === 'test'
                      ? 'bg-zinc-800 text-zinc-100 font-semibold shadow-sm border border-zinc-700'
                      : dirtyItemCount > 0
                        ? 'bg-purple-500/10 text-purple-200 border border-purple-500/40 hover:bg-purple-500/20'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
                  }`}
                  title={
                    dirtyItemCount > 0
                      ? 'Tự động rebuild thay đổi mới nhất trong RAM rồi chạy Patched JAR'
                      : 'Chạy Original JAR'
                  }
                >
                  {isQuickTesting ? (
                    <Loader2 className="w-3.5 h-3.5 text-purple-300 animate-spin" />
                  ) : (
                    <Gamepad2 className="w-3.5 h-3.5 text-purple-400" />
                  )}
                  <span>{isQuickTesting ? 'Building latest...' : dirtyItemCount > 0 ? 'Test Latest Changes' : 'Test Game'}</span>
                  {dirtyItemCount > 0 && !isQuickTesting && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-purple-500/20 text-purple-200 border border-purple-500/40 font-bold">
                      auto rebuild
                    </span>
                  )}
                </button>
              </div>

              <div className="flex items-center gap-3 text-xs font-mono text-zinc-400">
                <span>
                  Status: <strong className="text-emerald-400">JAR loaded successfully</strong>
                </span>
                <span className="text-zinc-600">&bull;</span>
                <button
                  type="button"
                  onClick={handleCloseJar}
                  className="text-zinc-400 hover:text-zinc-200 underline cursor-pointer"
                >
                  Close JAR
                </button>
              </div>
            </div>

            {quickTestError && (
              <div className="p-3.5 rounded-xl bg-red-950/40 border border-red-800/70 text-red-200 font-mono text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">Không thể chạy thay đổi mới nhất</div>
                  <div className="mt-1 text-red-300/90 whitespace-pre-wrap">{quickTestError}</div>
                </div>
              </div>
            )}

            {activeTab === 'overview' ? (
              <div className="space-y-5">
                <JarInfoPanel jarInfo={session.jarInfo} />
                <ManifestPanel manifest={session.jarInfo.manifest} />
              </div>
            ) : activeTab === 'explorer' ? (
              <JarExplorer session={session} />
            ) : activeTab === 'items' ? (
              <ItemsBrowser
                session={session}
                onDraftsUpdated={(count) => setDirtyItemCount(count)}
                onNavigateToTestGame={(src) => {
                  setTestGameSource(src);
                  setTestLaunchNonce((n) => n + 1);
                  setActiveTab('test');
                }}
              />
            ) : (
              <TestGameTab
                key={`test-${testGameSource}-${session.candidateOutput?.validatedAt ?? 0}-${testLaunchNonce}`}
                session={session}
                initialSource={testGameSource}
                onNavigateToPatchBuilder={() => setActiveTab('items')}
              />
            )}
          </div>
        )}
      </main>

      {showCloseConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-start gap-3 text-amber-400">
              <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-zinc-100">
                  There are unsaved in-memory changes.
                </h3>
                <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                  Bạn đang có <strong className="text-amber-400 font-mono">{dirtyItemCount} item</strong> đã chỉnh sửa trong bộ nhớ RAM. Đóng file JAR sẽ hủy bỏ vĩnh viễn toàn bộ các thay đổi nháp này.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800 font-mono">
              <button
                type="button"
                onClick={() => setShowCloseConfirmModal(false)}
                className="px-3.5 py-1.5 rounded-lg text-xs text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 border border-zinc-700 cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={forceCloseJar}
                className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-red-950/80 hover:bg-red-900 text-red-200 border border-red-800 cursor-pointer transition-colors"
              >
                Discard Changes &amp; Close
              </button>
            </div>
          </div>
        </div>
      )}

      {isQuickTesting && (
        <div className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl border border-purple-500/40 bg-zinc-950 shadow-2xl p-5 font-mono">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-purple-300 animate-spin" />
              </div>
              <div>
                <div className="text-sm font-bold text-zinc-100">Test Latest Changes</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">Draft → Patch Plan → Rewrite → Verify JAR → Run</div>
              </div>
            </div>
            <div className="mt-4 p-3 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-purple-200">
              {quickTestMessage || 'Đang xử lý...'}
            </div>
            <div className="mt-3 text-[10px] text-zinc-500">
              Không download, không upload lại. JAR mới chỉ được tạo và kiểm tra trong RAM.
            </div>
          </div>
        </div>
      )}

      <footer className="border-t border-zinc-800/60 bg-zinc-950 py-2.5 px-4 text-center text-[11px] font-mono text-zinc-500">
        NRO Studio &bull; One-Click Quick Test &bull; Draft → Verified Patched JAR → Emulator
      </footer>
    </div>
  );
}
