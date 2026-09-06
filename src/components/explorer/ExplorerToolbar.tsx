import React from 'react';
import { Search, X, Layers, FileCode, Image as ImageIcon, Box } from 'lucide-react';

export type FilterCategory = 'all' | 'classes' | 'images' | 'resources';

interface ExplorerToolbarProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  filter: FilterCategory;
  onFilterChange: (filter: FilterCategory) => void;
  totalCount: number;
  classCount: number;
  imageCount: number;
  resourceCount: number;
}

export const ExplorerToolbar: React.FC<ExplorerToolbarProps> = ({
  searchTerm,
  onSearchChange,
  filter,
  onFilterChange,
  totalCount,
  classCount,
  imageCount,
  resourceCount,
}) => {
  return (
    <div id="explorer-toolbar" className="p-4 border-b border-zinc-800 bg-zinc-950/40 space-y-3">
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-500">
          <Search className="w-4 h-4" />
        </div>
        <input
          id="explorer-search-input"
          type="text"
          value={searchTerm}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSearchChange(e.target.value)}
          placeholder="Tìm theo đường dẫn hoặc tên file, ví dụ: GameMidlet, a/a/a/, .png..."
          className="w-full pl-9 pr-8 py-2 bg-zinc-900 border border-zinc-700/80 rounded-md text-xs font-mono text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
        />
        {searchTerm && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-zinc-500 hover:text-zinc-300"
            title="Xóa từ khóa tìm kiếm"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-xs font-mono">
        <button id="filter-btn-all" type="button" onClick={() => onFilterChange('all')} className={`px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors ${filter === 'all' ? 'bg-zinc-800 text-zinc-100 border border-zinc-700 font-semibold' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border border-transparent'}`}>
          <Layers className="w-3.5 h-3.5 text-zinc-400" /><span>Tất cả</span>
          <span className="text-[11px] px-1.5 py-0.2 rounded bg-zinc-900/80 text-zinc-400 border border-zinc-800">{totalCount.toLocaleString('vi-VN')}</span>
        </button>

        <button id="filter-btn-classes" type="button" onClick={() => onFilterChange('classes')} className={`px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors ${filter === 'classes' ? 'bg-blue-950/60 text-blue-200 border border-blue-800 font-semibold' : 'text-zinc-400 hover:text-blue-300 hover:bg-zinc-900 border border-transparent'}`}>
          <FileCode className="w-3.5 h-3.5 text-blue-400" /><span>Class</span>
          <span className="text-[11px] px-1.5 py-0.2 rounded bg-blue-950 text-blue-300 border border-blue-900/80">{classCount.toLocaleString('vi-VN')}</span>
        </button>

        <button id="filter-btn-images" type="button" onClick={() => onFilterChange('images')} className={`px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors ${filter === 'images' ? 'bg-amber-950/60 text-amber-200 border border-amber-800 font-semibold' : 'text-zinc-400 hover:text-amber-300 hover:bg-zinc-900 border border-transparent'}`}>
          <ImageIcon className="w-3.5 h-3.5 text-amber-400" /><span>Hình ảnh</span>
          <span className="text-[11px] px-1.5 py-0.2 rounded bg-amber-950 text-amber-300 border border-amber-900/80">{imageCount.toLocaleString('vi-VN')}</span>
        </button>

        <button id="filter-btn-resources" type="button" onClick={() => onFilterChange('resources')} className={`px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors ${filter === 'resources' ? 'bg-purple-950/60 text-purple-200 border border-purple-800 font-semibold' : 'text-zinc-400 hover:text-purple-300 hover:bg-zinc-900 border border-transparent'}`}>
          <Box className="w-3.5 h-3.5 text-purple-400" /><span>Tài nguyên</span>
          <span className="text-[11px] px-1.5 py-0.2 rounded bg-purple-950 text-purple-300 border border-purple-900/80">{resourceCount.toLocaleString('vi-VN')}</span>
        </button>
      </div>
    </div>
  );
};
