import React, { useState } from 'react';
import { ScrollText, ChevronDown, ChevronUp } from 'lucide-react';
import { ManifestInfo } from '../types/jar';

interface ManifestPanelProps {
  manifest: ManifestInfo;
}

export const ManifestPanel: React.FC<ManifestPanelProps> = ({ manifest }) => {
  const [showRaw, setShowRaw] = useState(false);

  return (
    <div id="manifest-panel" className="bg-zinc-900 border border-zinc-800 rounded-lg shadow-sm overflow-hidden">
      <div className="border-b border-zinc-800 bg-zinc-950/60 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ScrollText className="w-4 h-4 text-purple-400" />
          <h2 className="text-sm font-semibold text-zinc-200 tracking-wide uppercase">
            Manifest (META-INF/MANIFEST.MF)
          </h2>
        </div>
        {manifest.rawText && (
          <button
            type="button"
            onClick={() => setShowRaw(!showRaw)}
            className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1 font-mono transition-colors"
          >
            <span>{showRaw ? 'Hide Raw' : 'View Raw'}</span>
            {showRaw ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      <div className="p-5 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="bg-zinc-950/50 p-3 rounded border border-zinc-800/80">
            <span className="text-zinc-500 block mb-1 font-mono uppercase text-[10px]">MIDlet Name</span>
            <span className="text-zinc-200 font-mono font-medium text-sm select-all">
              {manifest.midletName}
            </span>
          </div>

          <div className="bg-zinc-950/50 p-3 rounded border border-zinc-800/80">
            <span className="text-zinc-500 block mb-1 font-mono uppercase text-[10px]">Version</span>
            <span className="text-zinc-200 font-mono font-medium text-sm select-all">
              {manifest.midletVersion}
            </span>
          </div>

          <div className="bg-zinc-950/50 p-3 rounded border border-zinc-800/80">
            <span className="text-zinc-500 block mb-1 font-mono uppercase text-[10px]">Vendor</span>
            <span className="text-zinc-200 font-mono font-medium select-all">
              {manifest.midletVendor}
            </span>
          </div>

          <div className="bg-zinc-950/50 p-3 rounded border border-zinc-800/80">
            <span className="text-zinc-500 block mb-1 font-mono uppercase text-[10px]">Main (MIDlet-1)</span>
            <span className="text-zinc-200 font-mono font-medium break-all select-all">
              {manifest.midlet1}
            </span>
          </div>

          <div className="bg-zinc-950/50 p-3 rounded border border-zinc-800/80">
            <span className="text-zinc-500 block mb-1 font-mono uppercase text-[10px]">CLDC (Configuration)</span>
            <span className="text-zinc-200 font-mono font-medium select-all">
              {manifest.configuration}
            </span>
          </div>

          <div className="bg-zinc-950/50 p-3 rounded border border-zinc-800/80">
            <span className="text-zinc-500 block mb-1 font-mono uppercase text-[10px]">MIDP (Profile)</span>
            <span className="text-zinc-200 font-mono font-medium select-all">
              {manifest.profile}
            </span>
          </div>
        </div>

        <div className="text-[11px] font-mono text-zinc-500 pt-1 flex items-center justify-between">
          <span>Manifest-Version: <strong className="text-zinc-300">{manifest.manifestVersion}</strong></span>
        </div>

        {showRaw && manifest.rawText && (
          <div className="mt-3 pt-3 border-t border-zinc-800/80">
            <div className="bg-zinc-950 p-3 rounded border border-zinc-800 font-mono text-[11px] text-zinc-300 max-h-48 overflow-y-auto whitespace-pre-wrap select-all">
              {manifest.rawText}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
