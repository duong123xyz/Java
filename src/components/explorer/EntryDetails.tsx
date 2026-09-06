import React, { useState, useEffect } from 'react';
import { FileCode, Image as ImageIcon, ScrollText, Box, Folder, Copy, Check, ShieldAlert, FileQuestion } from 'lucide-react';
import { JarEntryInfo, ManifestInfo, ClassFileInfo } from '../../types/jar';
import { PngPreview } from './PngPreview';
import { ClassInspector } from './ClassInspector';

interface EntryDetailsProps {
  entry: JarEntryInfo | null;
  manifestInfo: ManifestInfo;
  classCache?: Map<string, ClassFileInfo>;
  onCacheUpdate?: (path: string, info: ClassFileInfo) => void;
}

export const EntryDetails: React.FC<EntryDetailsProps> = ({ entry, manifestInfo, classCache, onCacheUpdate }) => {
  const [copied, setCopied] = useState(false);
  const [rawManifest, setRawManifest] = useState<string>(manifestInfo.rawText || '');

  useEffect(() => {
    if (entry?.type === 'manifest') {
      if (manifestInfo.rawText) setRawManifest(manifestInfo.rawText);
      else entry.zipEntry.async('string').then((text: string) => setRawManifest(text));
    }
  }, [entry, manifestInfo.rawText]);

  const copyPath = () => {
    if (entry) {
      navigator.clipboard.writeText(entry.path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  if (!entry) {
    return (
      <div id="entry-details-empty" className="h-full min-h-[400px] flex flex-col items-center justify-center text-center p-8 bg-zinc-900/40 rounded-lg border border-zinc-800/80 text-zinc-500">
        <div className="w-12 h-12 rounded-full bg-zinc-800/60 flex items-center justify-center mb-3"><FileQuestion className="w-6 h-6 text-zinc-500" /></div>
        <p className="text-sm font-medium text-zinc-300 mb-1">Chưa chọn mục nào</p>
        <p className="text-xs text-zinc-500 max-w-xs font-mono">Chọn một file ở danh sách bên trái để xem thông tin và nội dung có thể phân tích.</p>
      </div>
    );
  }

  return (
    <div id="entry-details-container" className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden flex flex-col h-full">
      <div className="border-b border-zinc-800 bg-zinc-950/70 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {entry.type === 'class' && <FileCode className="w-4 h-4 text-blue-400 shrink-0" />}
          {entry.type === 'png' && <ImageIcon className="w-4 h-4 text-amber-400 shrink-0" />}
          {entry.type === 'manifest' && <ScrollText className="w-4 h-4 text-purple-400 shrink-0" />}
          {entry.type === 'directory' && <Folder className="w-4 h-4 text-zinc-400 shrink-0" />}
          {entry.type === 'resource' && <Box className="w-4 h-4 text-emerald-400 shrink-0" />}
          <h3 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">{entry.type === 'class' ? 'Phân tích class' : 'Thông tin mục'}</h3>
        </div>
        <button type="button" onClick={copyPath} className="text-xs font-mono text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700/80 transition-colors cursor-pointer" title="Sao chép đường dẫn">
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? 'Đã sao chép' : 'Sao chép đường dẫn'}</span>
        </button>
      </div>

      <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1 max-h-[580px]">
        {entry.type === 'class' ? (
          <ClassInspector key={entry.path} entry={entry} classCache={classCache} onCacheUpdate={onCacheUpdate} />
        ) : (
          <>
            <div className="space-y-2.5 font-mono text-xs">
              <div className="bg-zinc-950/60 p-3 rounded border border-zinc-800/80"><span className="text-zinc-500 block mb-1 text-[10px] uppercase">Đường dẫn</span><span className="text-zinc-200 font-medium break-all select-all">{entry.path}</span></div>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="bg-zinc-950/60 p-3 rounded border border-zinc-800/80">
                  <span className="text-zinc-500 block mb-1 text-[10px] uppercase">Loại mục</span>
                  <span className={`font-semibold uppercase ${entry.type === 'png' ? 'text-amber-400' : entry.type === 'manifest' ? 'text-purple-400' : entry.type === 'directory' ? 'text-zinc-400' : 'text-emerald-400'}`}>
                    {entry.type === 'png' ? 'Ảnh PNG' : entry.type === 'manifest' ? 'Manifest' : entry.type === 'directory' ? 'Thư mục' : 'Tài nguyên'}
                  </span>
                </div>
                <div className="bg-zinc-950/60 p-3 rounded border border-zinc-800/80"><span className="text-zinc-500 block mb-1 text-[10px] uppercase">Tên file</span><span className="text-zinc-200 font-medium truncate block">{entry.name}</span></div>
              </div>
            </div>

            {entry.type === 'png' && <PngPreview entry={entry} />}

            {entry.type === 'manifest' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between"><span className="text-[11px] font-mono uppercase text-zinc-400 font-semibold">Nội dung Manifest gốc — chỉ đọc</span><span className="text-[11px] font-mono text-zinc-500">Định dạng RFC 822</span></div>
                <div className="bg-zinc-950 p-3.5 rounded-md border border-zinc-800 font-mono text-xs text-zinc-300 whitespace-pre-wrap select-all max-h-72 overflow-y-auto leading-relaxed">{rawManifest || 'Không có nội dung Manifest'}</div>
              </div>
            )}

            {entry.type === 'resource' && (
              <div className="bg-zinc-950/60 border border-zinc-800 p-4 rounded-md space-y-2">
                <div className="flex items-center gap-2 text-xs font-mono text-zinc-400"><ShieldAlert className="w-4 h-4 text-zinc-500" /><span>Tài nguyên nhị phân / dữ liệu chung</span></div>
                <p className="text-xs text-zinc-500 font-mono leading-relaxed">Tệp nhị phân được lưu bên trong JAR. Để bảo đảm hiệu năng và an toàn dữ liệu, hệ thống không tự động giải mã toàn bộ dữ liệu thô ở bước này.</p>
              </div>
            )}

            {entry.type === 'directory' && <div className="bg-zinc-950/40 border border-zinc-800 p-3.5 rounded-md text-xs font-mono text-zinc-500">Đây là một mục thư mục trong cấu trúc ZIP/JAR.</div>}
          </>
        )}
      </div>
    </div>
  );
};
