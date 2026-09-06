import React, { useState } from 'react';
import { Terminal, XCircle, FileArchive, LayoutDashboard, Compass } from 'lucide-react';
import { LoadedJarSession } from './types/jar';
import { loadAndAnalyzeJarSession } from './services/jarService';
import { JarDropZone } from './components/JarDropZone';
import { JarInfoPanel } from './components/JarInfoPanel';
import { ManifestPanel } from './components/ManifestPanel';
import { JarExplorer } from './components/explorer/JarExplorer';

export default function App() {
  const [session, setSession] = useState<LoadedJarSession | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'explorer'>('overview');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleFileSelect = async (file: File) => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const loadedSession = await loadAndAnalyzeJarSession(file);
      setSession(loadedSession);
      setActiveTab('overview');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error loading JAR';
      setErrorMessage(message);
      setSession(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCloseJar = () => {
    // Clear reference and reset UI to dropzone screen
    setSession(null);
    setActiveTab('overview');
    setErrorMessage(null);
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-emerald-500/20 selection:text-emerald-300">
      {/* Top Application Header / Menu Bar */}
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
              <div className="text-xs font-mono text-zinc-500">
                Chế độ Client-Side Memory
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
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
            {/* Navigation Tabs Bar */}
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

            {/* Tab Views */}
            {activeTab === 'overview' ? (
              <div className="space-y-5">
                <JarInfoPanel jarInfo={session.jarInfo} />
                <ManifestPanel manifest={session.jarInfo.manifest} />
              </div>
            ) : (
              <JarExplorer session={session} />
            )}
          </div>
        )}
      </main>

      {/* Footer / Status bar */}
      <footer className="border-t border-zinc-800/60 bg-zinc-950 py-2.5 px-4 text-center text-[11px] font-mono text-zinc-500">
        NRO Studio &bull; Step 05 &bull; Constant Pool Inspector &bull; Client-side in-memory parser
      </footer>
    </div>
  );
}
