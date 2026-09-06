import React, { useState, useEffect } from 'react';
import {
  FileCode,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Cpu,
  Layers,
  Binary,
  Terminal,
  Code2,
} from 'lucide-react';
import { JarEntryInfo, ClassFileInfo } from '../../types/jar';
import { parseClassFile } from '../../services/classFileParser';
import { ConstantPoolViewer } from './ConstantPoolViewer';
import { BytecodeViewer } from './BytecodeViewer';

interface ClassInspectorProps {
  entry: JarEntryInfo;
  classCache?: Map<string, ClassFileInfo>;
  onCacheUpdate?: (path: string, info: ClassFileInfo) => void;
}

export const ClassInspector: React.FC<ClassInspectorProps> = ({
  entry,
  classCache,
  onCacheUpdate,
}) => {
  const [classInfo, setClassInfo] = useState<ClassFileInfo | null>(
    classCache?.get(entry.path) || null
  );
  const [isLoading, setIsLoading] = useState<boolean>(!classCache?.has(entry.path));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'summary' | 'constant_pool' | 'bytecode'>('summary');

  useEffect(() => {
    // If cached, use it immediately
    const cached = classCache?.get(entry.path);
    if (cached) {
      setClassInfo(cached);
      setIsLoading(false);
      setErrorMessage(null);
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setErrorMessage(null);
    setClassInfo(null);

    // Read only selected entry as ArrayBuffer
    entry.zipEntry
      .async('arraybuffer')
      .then((buffer) => {
        if (!isMounted) return;
        try {
          const parsed = parseClassFile(buffer);
          setClassInfo(parsed);
          setIsLoading(false);
          if (onCacheUpdate) {
            onCacheUpdate(entry.path, parsed);
          }
        } catch (err: unknown) {
          if (!isMounted) return;
          const msg = err instanceof Error ? err.message : 'Failed to parse Java class';
          setErrorMessage(msg);
          setIsLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        const msg = err instanceof Error ? err.message : 'Failed to read class file bytes';
        setErrorMessage(msg);
        setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [entry.path, entry.zipEntry, classCache, onCacheUpdate]);

  if (isLoading) {
    return (
      <div
        id="class-inspector-loading"
        className="p-8 border border-zinc-800 rounded-lg bg-zinc-950/60 flex flex-col items-center justify-center text-center space-y-3"
      >
        <Loader2 className="w-7 h-7 text-blue-400 animate-spin" />
        <div>
          <p className="text-xs font-mono font-medium text-zinc-200">Parsing class...</p>
          <p className="text-[11px] font-mono text-zinc-500 mt-1">
            Reading binary structure &amp; constant pool via client-side BinaryReader
          </p>
        </div>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div
        id="class-inspector-error"
        className="p-5 border border-red-900/60 bg-red-950/30 rounded-lg space-y-2 font-mono"
      >
        <div className="flex items-center gap-2 text-red-400">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <h4 className="text-xs font-semibold uppercase">Class parse failed</h4>
        </div>
        <p className="text-xs text-red-300/90 pl-7">{errorMessage}</p>
        <div className="text-[11px] text-zinc-500 pl-7 pt-1">
          Path: <span className="text-zinc-400">{entry.path}</span>
        </div>
      </div>
    );
  }

  if (!classInfo) return null;

  return (
    <div id="class-inspector-container" className="space-y-4 font-mono">
      {/* Sub-navigation Tabs: [ Summary ] [ Constant Pool ] */}
      <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2.5">
        <div className="flex items-center gap-1.5 p-1 rounded-lg bg-zinc-950 border border-zinc-800">
          <button
            id="subtab-summary"
            type="button"
            onClick={() => setActiveSubTab('summary')}
            className={`px-3 py-1.5 rounded-md text-xs font-mono flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeSubTab === 'summary'
                ? 'bg-zinc-800 text-zinc-100 font-semibold shadow-sm border border-zinc-700'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
            }`}
          >
            <FileCode className="w-3.5 h-3.5 text-blue-400" />
            <span>Summary</span>
          </button>

          <button
            id="subtab-constant-pool"
            type="button"
            onClick={() => setActiveSubTab('constant_pool')}
            className={`px-3 py-1.5 rounded-md text-xs font-mono flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeSubTab === 'constant_pool'
                ? 'bg-zinc-800 text-zinc-100 font-semibold shadow-sm border border-zinc-700'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-purple-400" />
            <span>Constant Pool</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-900 text-purple-300 border border-zinc-800">
              {classInfo.constantPoolCount.toLocaleString()}
            </span>
          </button>

          <button
            id="subtab-bytecode"
            type="button"
            onClick={() => setActiveSubTab('bytecode')}
            className={`px-3 py-1.5 rounded-md text-xs font-mono flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeSubTab === 'bytecode'
                ? 'bg-zinc-800 text-zinc-100 font-semibold shadow-sm border border-zinc-700'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
            }`}
          >
            <Code2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Bytecode &amp; &lt;clinit&gt;</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-900 text-emerald-300 border border-zinc-800">
              {classInfo.methodsCount} methods
            </span>
          </button>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 px-2 py-0.5 rounded">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Valid Java Class</span>
        </div>
      </div>

      {/* Tab 1: Summary View (Preserved from Step 04) */}
      {activeSubTab === 'summary' && (
        <div className="space-y-4">
          {/* Java Class Header Overview */}
          <div className="border border-blue-900/50 bg-blue-950/20 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-blue-900/40 pb-2.5">
              <div className="flex items-center gap-2 text-blue-400">
                <FileCode className="w-4 h-4" />
                <h4 className="text-xs font-bold uppercase tracking-wider">JAVA CLASS</h4>
              </div>
              <span className="text-[11px] text-zinc-400">
                {classInfo.versionName}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2.5 text-xs">
              <div className="bg-zinc-950/70 p-2.5 rounded border border-zinc-800">
                <span className="text-zinc-500 block mb-0.5 text-[10px] uppercase">Path</span>
                <span className="text-zinc-200 font-medium break-all select-all">{entry.path}</span>
              </div>

              <div className="bg-zinc-950/70 p-2.5 rounded border border-zinc-800">
                <span className="text-zinc-500 block mb-0.5 text-[10px] uppercase">Class</span>
                <span className="text-blue-300 font-bold text-sm select-all">{classInfo.className}</span>
              </div>

              <div className="bg-zinc-950/70 p-2.5 rounded border border-zinc-800">
                <span className="text-zinc-500 block mb-0.5 text-[10px] uppercase">Super Class</span>
                <span className="text-zinc-300 font-medium select-all">
                  {classInfo.superClassName || 'None (java.lang.Object or Interface)'}
                </span>
              </div>

              {classInfo.accessFlagsFormatted.length > 0 && (
                <div className="flex items-center gap-2 pt-1 text-xs">
                  <span className="text-zinc-500 text-[10px] uppercase">Modifiers:</span>
                  <div className="flex flex-wrap gap-1">
                    {classInfo.accessFlagsFormatted.map((flag) => (
                      <span
                        key={flag}
                        className="text-[10px] px-1.5 py-0.2 rounded bg-blue-950 text-blue-300 border border-blue-900/60"
                      >
                        {flag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Class File Structure Breakdown */}
          <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between text-zinc-300 border-b border-zinc-800 pb-2">
              <div className="flex items-center gap-2">
                <Binary className="w-4 h-4 text-purple-400" />
                <h4 className="text-xs font-semibold uppercase tracking-wider">Class File</h4>
              </div>
              <button
                type="button"
                onClick={() => setActiveSubTab('constant_pool')}
                className="text-[11px] text-purple-400 hover:text-purple-300 underline cursor-pointer"
              >
                Inspect Constant Pool &rarr;
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="bg-zinc-900 p-2.5 rounded border border-zinc-800">
                <span className="text-zinc-500 block text-[10px] uppercase">Magic</span>
                <span className="text-emerald-400 font-bold">{classInfo.magicHex}</span>
              </div>

              <div className="bg-zinc-900 p-2.5 rounded border border-zinc-800">
                <span className="text-zinc-500 block text-[10px] uppercase">Version</span>
                <span className="text-zinc-100 font-bold">
                  {classInfo.majorVersion}{' '}
                  <span className="text-zinc-500 text-[10px] font-normal">
                    ({classInfo.versionName})
                  </span>
                </span>
              </div>

              <div className="bg-zinc-900 p-2.5 rounded border border-zinc-800">
                <span className="text-zinc-500 block text-[10px] uppercase">Minor</span>
                <span className="text-zinc-200 font-bold">{classInfo.minorVersion}</span>
              </div>

              <div className="bg-zinc-900 p-2.5 rounded border border-zinc-800">
                <span className="text-zinc-500 block text-[10px] uppercase">Constant Pool</span>
                <span className="text-purple-300 font-bold">
                  {classInfo.constantPoolCount.toLocaleString()}{' '}
                  <span className="text-zinc-500 text-[10px] font-normal">entries</span>
                </span>
              </div>

              <div className="bg-zinc-900 p-2.5 rounded border border-zinc-800">
                <span className="text-zinc-500 block text-[10px] uppercase">Interfaces</span>
                <span className="text-zinc-200 font-bold">{classInfo.interfacesCount}</span>
              </div>

              <div className="bg-zinc-900 p-2.5 rounded border border-zinc-800">
                <span className="text-zinc-500 block text-[10px] uppercase">Fields</span>
                <span className="text-amber-300 font-bold">{classInfo.fieldsCount}</span>
              </div>

              <div className="bg-zinc-900 p-2.5 rounded border border-zinc-800">
                <span className="text-zinc-500 block text-[10px] uppercase">Methods</span>
                <span className="text-blue-300 font-bold">{classInfo.methodsCount}</span>
              </div>

              <div className="bg-zinc-900 p-2.5 rounded border border-zinc-800">
                <span className="text-zinc-500 block text-[10px] uppercase">Attributes</span>
                <span className="text-zinc-200 font-bold">{classInfo.attributesCount}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs pt-1">
              <div className="bg-zinc-900 p-2.5 rounded border border-zinc-800">
                <span className="text-zinc-500 block text-[10px] uppercase">Size</span>
                <span className="text-zinc-200 font-bold">
                  {classInfo.byteLength.toLocaleString()} bytes
                </span>
              </div>

              <div className="bg-zinc-900 p-2.5 rounded border border-zinc-800">
                <span className="text-zinc-500 block text-[10px] uppercase">Parsed</span>
                <span className="text-emerald-400 font-bold">
                  {classInfo.parsedBytes.toLocaleString()} / {classInfo.byteLength.toLocaleString()} bytes
                </span>
              </div>
            </div>
          </div>

          {/* Parser Diagnostics Card */}
          <div className="border border-zinc-800 bg-zinc-950/40 rounded-lg p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 text-zinc-400 font-semibold uppercase text-[11px]">
                <Cpu className="w-3.5 h-3.5 text-zinc-500" />
                <span>Parser diagnostics</span>
              </div>
              {classInfo.remainingBytes === 0 ? (
                <span className="text-[11px] text-emerald-400 bg-emerald-950/50 border border-emerald-900/60 px-2 py-0.2 rounded">
                  0 bytes remaining &bull; Exact structure match
                </span>
              ) : (
                <span className="text-[11px] text-amber-400 bg-amber-950/50 border border-amber-900/60 px-2 py-0.2 rounded">
                  {classInfo.remainingBytes} bytes remaining
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-zinc-400 pt-1">
              <div>
                Byte length: <strong className="text-zinc-200">{classInfo.byteLength}</strong>
              </div>
              <div>
                Parsed bytes: <strong className="text-zinc-200">{classInfo.parsedBytes}</strong>
              </div>
              <div>
                Remaining:{' '}
                <strong className={classInfo.remainingBytes === 0 ? 'text-emerald-400' : 'text-amber-400'}>
                  {classInfo.remainingBytes}
                </strong>
              </div>
              <div>
                Constant pool count:{' '}
                <strong className="text-purple-300">{classInfo.constantPoolCount}</strong>
              </div>
            </div>

            <div className="flex items-start gap-1.5 pt-2 border-t border-zinc-800/80 text-[10px] text-zinc-500">
              <Terminal className="w-3 h-3 text-zinc-600 shrink-0 mt-0.5" />
              <span>
                Step 05 extends binary reader to resolve and search the entire Constant Pool table.
                Method bytecode decompilation &amp; JVM instructions remain strictly excluded.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Constant Pool Viewer */}
      {activeSubTab === 'constant_pool' && (
        <ConstantPoolViewer
          entries={classInfo.resolvedConstantPool}
          className={classInfo.className}
        />
      )}

      {/* Tab 3: Bytecode & <clinit> Static Analyzer */}
      {activeSubTab === 'bytecode' && (
        <BytecodeViewer classInfo={classInfo} />
      )}
    </div>
  );
};
