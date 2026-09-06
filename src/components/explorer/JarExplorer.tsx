import React, { useState, useMemo } from 'react';
import { LoadedJarSession, JarEntryInfo, ClassFileInfo } from '../../types/jar';
import { ExplorerToolbar, FilterCategory } from './ExplorerToolbar';
import { EntryList } from './EntryList';
import { EntryDetails } from './EntryDetails';

interface JarExplorerProps { session: LoadedJarSession; }

export const JarExplorer: React.FC<JarExplorerProps> = ({ session }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<FilterCategory>('all');
  const [selectedEntry, setSelectedEntry] = useState<JarEntryInfo | null>(null);

  const totalCount = session.entries.length;
  const classCount = session.jarInfo.classEntries;
  const imageCount = session.jarInfo.pngEntries;
  const resourceCount = session.jarInfo.resourceEntries;

  if (!session.classParseCache) session.classParseCache = new Map<string, ClassFileInfo>();

  const handleCacheUpdate = (path: string, info: ClassFileInfo) => {
    session.classParseCache?.set(path, info);
  };

  const filteredEntries = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return session.entries.filter((entry) => {
      if (filter === 'classes' && entry.type !== 'class') return false;
      if (filter === 'images' && entry.type !== 'png') return false;
      if (filter === 'resources' && entry.type !== 'resource' && entry.type !== 'manifest') return false;
      if (term) {
        const matchesPath = entry.path.toLowerCase().includes(term);
        const matchesName = entry.name.toLowerCase().includes(term);
        if (!matchesPath && !matchesName) return false;
      }
      return true;
    });
  }, [session.entries, filter, searchTerm]);

  return (
    <div id="jar-explorer-root" className="bg-zinc-900 border border-zinc-800 rounded-lg shadow-sm overflow-hidden">
      <ExplorerToolbar
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        filter={filter}
        onFilterChange={setFilter}
        totalCount={totalCount}
        classCount={classCount}
        imageCount={imageCount}
        resourceCount={resourceCount}
      />

      <div className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-6 flex flex-col space-y-2">
          <div className="flex items-center justify-between px-1 text-[11px] font-mono text-zinc-400">
            <span className="uppercase font-semibold tracking-wider text-zinc-500">Danh sách mục trong JAR</span>
            <span>Đang hiện <strong className="text-zinc-200">{filteredEntries.length.toLocaleString('vi-VN')}</strong> / {totalCount.toLocaleString('vi-VN')}</span>
          </div>
          <EntryList entries={filteredEntries} selectedEntry={selectedEntry} onSelectEntry={setSelectedEntry} />
        </div>

        <div className="lg:col-span-6 flex flex-col">
          <div className="flex items-center justify-between px-1 pb-2 text-[11px] font-mono text-zinc-500 uppercase font-semibold tracking-wider">
            <span>Thông tin chi tiết</span>
            {selectedEntry && (
              <span className="text-zinc-300 font-mono font-normal truncate max-w-[280px]" title={selectedEntry.path}>
                {selectedEntry.path}
                {typeof selectedEntry.size === 'number' && selectedEntry.size > 0 && (
                  <span className="text-zinc-500 ml-1.5">({selectedEntry.size.toLocaleString('vi-VN')} byte)</span>
                )}
              </span>
            )}
          </div>
          <EntryDetails entry={selectedEntry} manifestInfo={session.jarInfo.manifest} classCache={session.classParseCache} onCacheUpdate={handleCacheUpdate} />
        </div>
      </div>
    </div>
  );
};
