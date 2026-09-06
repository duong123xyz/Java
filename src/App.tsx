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

export default function App() {
  const [session, setSession] = useState<LoadedJarSession | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'explorer' | 'items' | 'test'>('overview');
  const [testGameSource, setTestGameSource] = useState<'ORIGINAL' | 'PATCHED'>('ORIGINAL');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dirtyItemCount, setDirtyItemCount] = useState(0);
  const [showCloseConfirmModal, setShowCloseConfirmModal] = useState(false);

  // Tải và phân tích JAR. Phần xử lý kỹ thuật được giữ nguyên, chỉ Việt hóa thông báo lỗi mặc định.
  const handleFileSelect = async (file: File) => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const loadedSession = await loadAndAnalyzeJarSession(file);
      setSession(loadedSession);
      setActiveTab('overview');
      setDirtyItemCount(0);
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
    const dirty = getDirtyCount(session?.itemDrafts);
    if (dirty > 0) {
      setShowCloseConfirmModal(true);
      return;
    }
    forceCloseJar();
  };

  // Đóng JAR và dọn toàn bộ trạng thái tạm trong bộ nhớ.
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
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-emerald-500/20 selection:text-emerald-300">
      {/* Thanh tiêu đề ứng dụng */}
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
              <p className="text-[11px] text-zinc-400 leading-tight">Trình chỉnh sửa JAR J2ME</p>
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
            {/* Thanh chuyển tab */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-zinc-800/80">
              <div className="flex items-center gap-1 bg-zinc-900/90 p-1 rounded-lg border border-zinc-800 w-fit">
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
                  <span>Tổng quan</span>
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
                  <span>Duyệt JAR</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-950 text-zinc-400 border border-zinc-800">
                    {session.entries.length.toLocaleString('vi-VN')}
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
                  <span>Vật phẩm</span>
                  {dirtyItemCount > 0 ? (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold animate-pulse">
                      {dirtyItemCount} đã sửa
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
                  id="tab-test-game"
                  type="button"
                  onClick={() => setActiveTab('test')}
                  className={`px-3.5 py-1.5 rounded-md text-xs font-mono flex items-center gap-2 transition-colors cursor-pointer ${
                    activeTab === 'test'
                      ? 'bg-zinc-800 text-zinc-100 font-semibold shadow-sm border border-zinc-700'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
                  }`}
                >
                  <Gamepad2 className="w-3.5 h-3.5 text-purple-400" />
                  <span>Chạy thử game</span>
                  {session.candidateOutput?.status === 'VALIDATED' && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold">
                      Đã vá
                    </span>
                  )}
                </button>
              </div>

              <div className="flex items-center gap-3 text-xs font-mono text-zinc-400">
                <span>
                  Trạng thái:{' '}
                  <strong className="text-emerald-400">Đã tải JAR thành công</strong>
                </span>
                <span className="text-zinc-600">&bull;</span>
                <button
                  type="button"
                  onClick={handleCloseJar}
                  className="text-zinc-400 hover:text-zinc-200 underline cursor-pointer"
                >
                  Đóng JAR
                </button>
              </div>
            </div>

            {/* Nội dung từng tab */}
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
                  setActiveTab('test');
                }}
              />
            ) : (
              <TestGameTab
                session={session}
                initialSource={testGameSource}
                onNavigateToPatchBuilder={() => setActiveTab('items')}
              />
            )}
          </div>
        )}
      </main>

      {/* Xác nhận khi đóng JAR trong lúc còn thay đổi chưa lưu */}
      {showCloseConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-start gap-3 text-amber-400">
              <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-zinc-100">Có thay đổi chưa được lưu.</h3>
                <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                  Bạn đang có{' '}
                  <strong className="text-amber-400 font-mono">{dirtyItemCount}</strong>{' '}
                  vật phẩm đã chỉnh sửa trong bộ nhớ RAM. Nếu đóng file JAR, toàn bộ thay đổi nháp này sẽ bị hủy.
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
                Hủy thay đổi và đóng JAR
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
