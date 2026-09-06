import React, { useRef, useState, useEffect } from 'react';
import {
  FileCode,
  Image as ImageIcon,
  ScrollText,
  Box,
  Folder,
  ChevronRight,
} from 'lucide-react';
import { JarEntryInfo } from '../../types/jar';

interface EntryListProps {
  entries: JarEntryInfo[];
  selectedEntry: JarEntryInfo | null;
  onSelectEntry: (entry: JarEntryInfo) => void;
}

const ITEM_HEIGHT = 38; // px per row
const BUFFER_COUNT = 15; // extra rows before & after visible viewport

export const EntryList: React.FC<EntryListProps> = ({
  entries,
  selectedEntry,
  onSelectEntry,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(560);

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        setContainerHeight(containerRef.current.clientHeight || 560);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  const totalItems = entries.length;
  const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER_COUNT);
  const visibleCount = Math.ceil(containerHeight / ITEM_HEIGHT) + BUFFER_COUNT * 2;
  const endIndex = Math.min(totalItems, startIndex + visibleCount);

  const visibleEntries = entries.slice(startIndex, endIndex);
  const topPadding = startIndex * ITEM_HEIGHT;
  const bottomPadding = (totalItems - endIndex) * ITEM_HEIGHT;

  const renderIcon = (type: JarEntryInfo['type']) => {
    switch (type) {
      case 'class':
        return <FileCode className="w-3.5 h-3.5 text-blue-400 shrink-0" />;
      case 'png':
        return <ImageIcon className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
      case 'manifest':
        return <ScrollText className="w-3.5 h-3.5 text-purple-400 shrink-0" />;
      case 'directory':
        return <Folder className="w-3.5 h-3.5 text-zinc-500 shrink-0" />;
      default:
        return <Box className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    }
  };

  if (totalItems === 0) {
    return (
      <div className="h-[560px] flex flex-col items-center justify-center text-center p-6 text-zinc-500 font-mono text-xs">
        <p>No matching entries found.</p>
        <p className="text-[11px] text-zinc-600 mt-1">Try adjusting your search query or filter.</p>
      </div>
    );
  }

  return (
    <div
      id="entry-list-viewport"
      ref={containerRef}
      onScroll={handleScroll}
      className="h-[560px] overflow-y-auto bg-zinc-950/70 border border-zinc-800 rounded-lg select-none"
    >
      <div style={{ paddingTop: `${topPadding}px`, paddingBottom: `${bottomPadding}px` }}>
        {visibleEntries.map((entry, index) => {
          const isSelected = selectedEntry?.path === entry.path;
          const actualIndex = startIndex + index;

          return (
            <div
              key={entry.path}
              id={`entry-item-${actualIndex}`}
              onClick={() => onSelectEntry(entry)}
              style={{ height: `${ITEM_HEIGHT}px` }}
              className={`px-3 flex items-center justify-between gap-2 text-xs font-mono cursor-pointer border-b border-zinc-900/60 transition-colors ${
                isSelected
                  ? 'bg-emerald-950/50 text-emerald-200 border-emerald-900/60 font-medium'
                  : 'text-zinc-300 hover:bg-zinc-900/80 hover:text-zinc-100'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {renderIcon(entry.type)}
                <span className="truncate font-mono select-none" title={entry.path}>
                  {entry.path}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {typeof entry.size === 'number' && entry.size > 0 && (
                  <span className="text-[11px] font-mono text-zinc-400 tabular-nums">
                    {entry.size.toLocaleString()} bytes
                  </span>
                )}
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-mono uppercase ${
                    entry.type === 'class'
                      ? 'text-blue-400 bg-blue-950/50 border border-blue-900/40'
                      : entry.type === 'png'
                      ? 'text-amber-400 bg-amber-950/50 border border-amber-900/40'
                      : entry.type === 'manifest'
                      ? 'text-purple-400 bg-purple-950/50 border border-purple-900/40'
                      : entry.type === 'directory'
                      ? 'text-zinc-500 bg-zinc-900 border border-zinc-800'
                      : 'text-emerald-400 bg-emerald-950/50 border border-emerald-900/40'
                  }`}
                >
                  {entry.type}
                </span>
                <ChevronRight
                  className={`w-3.5 h-3.5 transition-transform ${
                    isSelected ? 'text-emerald-400 translate-x-0.5' : 'text-zinc-600'
                  }`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
