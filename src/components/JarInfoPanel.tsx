import React from 'react';
import { FileArchive, CheckCircle2, FileCode, Image as ImageIcon, Layers } from 'lucide-react';
import { JarInfo } from '../types/jar';

interface JarInfoPanelProps {
  jarInfo: JarInfo;
}

export const JarInfoPanel: React.FC<JarInfoPanelProps> = ({ jarInfo }) => {
  const formattedSize = `${jarInfo.fileSize.toLocaleString()} bytes (${(
    jarInfo.fileSize /
    (1024 * 1024)
  ).toFixed(2)} MB)`;

  const formattedDate = new Date(jarInfo.lastModified).toLocaleString('vi-VN');

  return (
    <div id="jar-info-panel" className="bg-zinc-900 border border-zinc-800 rounded-lg shadow-sm overflow-hidden">
      <div className="border-b border-zinc-800 bg-zinc-950/60 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileArchive className="w-4 h-4 text-emerald-400" />
          <h2 className="text-sm font-semibold text-zinc-200 tracking-wide uppercase">
            File Information
          </h2>
        </div>
        <div className="flex items-center gap-1.5 text-xs font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 px-2 py-0.5 rounded">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Status: Loaded</span>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Basic metadata */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="bg-zinc-950/50 p-3 rounded border border-zinc-800/80">
            <span className="text-zinc-500 block mb-1 font-mono uppercase text-[10px]">Name</span>
            <span className="text-zinc-200 font-mono font-medium break-all select-all">
              {jarInfo.fileName}
            </span>
          </div>

          <div className="bg-zinc-950/50 p-3 rounded border border-zinc-800/80">
            <span className="text-zinc-500 block mb-1 font-mono uppercase text-[10px]">Size</span>
            <span className="text-zinc-200 font-mono font-medium">
              {formattedSize}
            </span>
          </div>

          <div className="bg-zinc-950/50 p-3 rounded border border-zinc-800/80 sm:col-span-2">
            <span className="text-zinc-500 block mb-1 font-mono uppercase text-[10px]">Last Modified</span>
            <span className="text-zinc-300 font-mono">
              {formattedDate}
            </span>
          </div>
        </div>

        {/* Entry counts */}
        <div className="pt-2 border-t border-zinc-800/80">
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Structure Summary
          </h3>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-zinc-950/60 border border-zinc-800 p-3 rounded">
              <div className="flex items-center justify-center gap-1.5 text-zinc-400 mb-1 text-xs">
                <Layers className="w-3.5 h-3.5" />
                <span>Total entries</span>
              </div>
              <span className="text-lg font-bold font-mono text-zinc-100">
                {jarInfo.totalEntries.toLocaleString()}
              </span>
            </div>

            <div className="bg-zinc-950/60 border border-zinc-800 p-3 rounded">
              <div className="flex items-center justify-center gap-1.5 text-blue-400 mb-1 text-xs">
                <FileCode className="w-3.5 h-3.5" />
                <span>Classes (.class)</span>
              </div>
              <span className="text-lg font-bold font-mono text-blue-300">
                {jarInfo.classEntries.toLocaleString()}
              </span>
            </div>

            <div className="bg-zinc-950/60 border border-zinc-800 p-3 rounded">
              <div className="flex items-center justify-center gap-1.5 text-amber-400 mb-1 text-xs">
                <ImageIcon className="w-3.5 h-3.5" />
                <span>PNG resources</span>
              </div>
              <span className="text-lg font-bold font-mono text-amber-300">
                {jarInfo.pngEntries.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
