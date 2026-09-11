import React, { useState } from 'react';
import { ScrollText, ChevronDown, ChevronUp, Edit3, Tag, CheckCircle2 } from 'lucide-react';
import { ManifestInfo, LoadedJarSession } from '../types/jar';
import { getWorkspaceMetadata } from '../services/workspaceMetadataService';
import { MetadataVersionModal } from './workspace/MetadataVersionModal';

interface ManifestPanelProps {
  manifest: ManifestInfo;
  session?: LoadedJarSession;
  onMetadataChanged?: () => void;
}

export const ManifestPanel: React.FC<ManifestPanelProps> = ({
  manifest,
  session,
  onMetadataChanged,
}) => {
  const [showRaw, setShowRaw] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const metadata = session ? getWorkspaceMetadata(session) : null;
  const isCustomVendor = metadata && metadata.author && metadata.author !== manifest.midletVendor;
  const isCustomVersion = metadata && metadata.version && metadata.version !== manifest.midletVersion;
  const isCustomName = metadata && metadata.gameName && metadata.gameName !== manifest.midletName;

  return (
    <>
      <div id="manifest-panel" className="bg-zinc-900 border border-zinc-800 rounded-lg shadow-sm overflow-hidden">
        <div className="border-b border-zinc-800 bg-zinc-950/60 px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ScrollText className="w-4 h-4 text-purple-400" />
            <h2 className="text-sm font-semibold text-zinc-200 tracking-wide uppercase">Manifest (META-INF/MANIFEST.MF)</h2>
          </div>
          <div className="flex items-center gap-3">
            {session && (
              <button
                type="button"
                onClick={() => setShowModal(true)}
                className="text-xs px-2.5 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/40 font-mono flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Sửa tên file xuất, tác giả và phiên bản"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Sửa Tên / Tác giả / Version</span>
              </button>
            )}
            {manifest.rawText && (
              <button type="button" onClick={() => setShowRaw(!showRaw)} className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1 font-mono transition-colors cursor-pointer">
                <span>{showRaw ? 'Ẩn nội dung gốc' : 'Xem nội dung gốc'}</span>
                {showRaw ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
        </div>

        <div className="p-5 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="bg-zinc-950/50 p-3 rounded border border-zinc-800/80">
              <span className="text-zinc-500 block mb-1 font-mono uppercase text-[10px] flex items-center justify-between">
                <span>Tên MIDlet</span>
                {isCustomName && <span className="text-emerald-400 font-normal lowercase">(sẽ đổi khi xuất)</span>}
              </span>
              <div className="flex items-center justify-between">
                <span className="text-zinc-200 font-mono font-medium text-sm select-all">
                  {metadata?.gameName || manifest.midletName}
                </span>
                {isCustomName && (
                  <span className="text-[10px] text-zinc-500 line-through">Gốc: {manifest.midletName}</span>
                )}
              </div>
            </div>

            <div className="bg-zinc-950/50 p-3 rounded border border-zinc-800/80">
              <span className="text-zinc-500 block mb-1 font-mono uppercase text-[10px] flex items-center justify-between">
                <span>Phiên bản</span>
                {isCustomVersion && <span className="text-emerald-400 font-normal lowercase">(sẽ đổi khi xuất)</span>}
              </span>
              <div className="flex items-center justify-between">
                <span className="text-emerald-400 font-mono font-medium text-sm select-all">
                  {metadata?.version || manifest.midletVersion}
                </span>
                {isCustomVersion && (
                  <span className="text-[10px] text-zinc-500 line-through">Gốc: {manifest.midletVersion}</span>
                )}
              </div>
            </div>

            <div className="bg-zinc-950/50 p-3 rounded border border-zinc-800/80">
              <span className="text-zinc-500 block mb-1 font-mono uppercase text-[10px] flex items-center justify-between">
                <span>Nhà phát hành / Tác giả</span>
                {isCustomVendor && <span className="text-emerald-400 font-normal lowercase">(sẽ đổi khi xuất)</span>}
              </span>
              <div className="flex items-center justify-between">
                <span className="text-zinc-200 font-mono font-medium select-all">
                  {metadata?.author || manifest.midletVendor}
                </span>
                {isCustomVendor && (
                  <span className="text-[10px] text-zinc-500 line-through">Gốc: {manifest.midletVendor}</span>
                )}
              </div>
            </div>

            <div className="bg-zinc-950/50 p-3 rounded border border-zinc-800/80">
              <span className="text-zinc-500 block mb-1 font-mono uppercase text-[10px]">Điểm chạy chính (MIDlet-1)</span>
              <span className="text-zinc-200 font-mono font-medium break-all select-all">{manifest.midlet1}</span>
            </div>

            <div className="bg-zinc-950/50 p-3 rounded border border-zinc-800/80">
              <span className="text-zinc-500 block mb-1 font-mono uppercase text-[10px]">CLDC (Cấu hình)</span>
              <span className="text-zinc-200 font-mono font-medium select-all">{manifest.configuration}</span>
            </div>

            <div className="bg-zinc-950/50 p-3 rounded border border-zinc-800/80">
              <span className="text-zinc-500 block mb-1 font-mono uppercase text-[10px]">MIDP (Hồ sơ)</span>
              <span className="text-zinc-200 font-mono font-medium select-all">{manifest.profile}</span>
            </div>
          </div>

          {metadata && (
            <div className="p-2.5 rounded bg-emerald-950/20 border border-emerald-800/40 text-[11px] text-emerald-300 font-mono flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-emerald-400" />
                <span>File xuất: <strong className="text-emerald-200">{metadata.exportFileName}</strong> · Tác giả: <strong className="text-emerald-200">{metadata.author}</strong> · Version: <strong className="text-emerald-200">{metadata.version}</strong></span>
              </div>
              <span className="text-[10px] text-zinc-400">
                {metadata.autoIncrementOnDownload ? 'Tự tăng phiên bản khi tải' : 'Phiên bản cố định'}
              </span>
            </div>
          )}

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

      {showModal && session && (
        <MetadataVersionModal
          session={session}
          onClose={() => setShowModal(false)}
          onSaved={() => onMetadataChanged?.()}
        />
      )}
    </>
  );
};

