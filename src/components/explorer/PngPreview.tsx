import React, { useState, useEffect } from 'react';
import { Image as ImageIcon, Loader2, AlertTriangle, Maximize2 } from 'lucide-react';
import { JarEntryInfo } from '../../types/jar';

interface PngPreviewProps { entry: JarEntryInfo; }

export const PngPreview: React.FC<PngPreviewProps> = ({ entry }) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    let active = true;
    let createdUrl: string | null = null;
    setIsLoading(true); setError(null); setDimensions(null);
    entry.zipEntry.async('blob').then((blob: Blob) => {
      if (!active) return;
      createdUrl = URL.createObjectURL(blob); setImageUrl(createdUrl); setIsLoading(false);
    }).catch((err: unknown) => {
      if (!active) return;
      setError(err instanceof Error ? err.message : 'Không đọc được dữ liệu ảnh PNG'); setIsLoading(false);
    });
    return () => { active = false; if (createdUrl) URL.revokeObjectURL(createdUrl); };
  }, [entry.path, entry.zipEntry]);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setDimensions({ width: img.naturalWidth, height: img.naturalHeight });
  };

  return (
    <div id="png-preview-container" className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-xs font-mono">
        <div className="bg-zinc-950/60 p-3 rounded border border-zinc-800"><span className="text-zinc-500 block mb-1 text-[10px] uppercase">Kích thước ảnh</span><span className="text-amber-300 font-semibold flex items-center gap-1.5"><Maximize2 className="w-3.5 h-3.5" />{dimensions ? `${dimensions.width} × ${dimensions.height} px` : 'Đang đọc...'}</span></div>
        <div className="bg-zinc-950/60 p-3 rounded border border-zinc-800"><span className="text-zinc-500 block mb-1 text-[10px] uppercase">Định dạng</span><span className="text-zinc-300 font-semibold">Ảnh PNG (Portable Network Graphics)</span></div>
      </div>

      <div className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-950 p-6 flex flex-col items-center justify-center min-h-[260px] relative">
        {isLoading && <div className="flex flex-col items-center gap-2 text-zinc-400"><Loader2 className="w-6 h-6 animate-spin text-amber-400" /><span className="text-xs font-mono">Đang trích xuất ảnh PNG...</span></div>}
        {error && <div className="flex items-center gap-2 text-red-400 text-xs font-mono"><AlertTriangle className="w-4 h-4 shrink-0" /><span>{error}</span></div>}
        {!isLoading && !error && imageUrl && (
          <div className="p-4 rounded-md border border-zinc-700/60 shadow-md max-w-full overflow-auto flex items-center justify-center" style={{ backgroundImage: `linear-gradient(45deg, #18181b 25%, transparent 25%), linear-gradient(-45deg, #18181b 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #18181b 75%), linear-gradient(-45deg, transparent 75%, #18181b 75%)`, backgroundSize: '16px 16px', backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px', backgroundColor: '#09090b' }}>
            <img id="png-preview-image" src={imageUrl} alt={entry.name} onLoad={handleImageLoad} className="max-h-72 object-contain image-rendering-pixelated transition-transform" style={{ imageRendering: 'pixelated' }} />
          </div>
        )}
        <div className="text-[11px] text-zinc-500 font-mono mt-4 flex items-center gap-2"><ImageIcon className="w-3.5 h-3.5 text-zinc-600" /><span>Trích xuất trực tiếp từ RAM theo yêu cầu &bull; không tải lên máy chủ</span></div>
      </div>
    </div>
  );
};
