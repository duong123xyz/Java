import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Search,
  Database,
  AlertTriangle,
  Table,
  RefreshCw,
  Info,
  ChevronRight,
  Sparkles,
  ChevronLeft,
  Layers,
  RotateCcw,
} from 'lucide-react';
import { LoadedJarSession } from '../../types/jar';
import {
  ItemRecord,
  ItemAnalysisSessionData,
  ItemAnalysisProgress,
  ItemDraft,
} from '../../types/item';
import { analyzeItemTables } from '../../services/itemDataService';
import {
  getItemDraftKey,
  getOrCreateDraft,
  setDraftField,
  resetDraftField,
  resetDraftItem,
  discardAllDrafts,
  getDirtyCount,
  getDirtyDrafts,
  getEffectiveItem,
} from '../../services/itemDraftService';
import { ItemEditorForm } from './ItemEditorForm';
import { ChangesPanel } from './ChangesPanel';

interface ItemsBrowserProps {
  session: LoadedJarSession;
  onDraftsUpdated?: (dirtyCount: number) => void;
}

const PAGE_SIZE = 50;

export function ItemsBrowser({ session, onDraftsUpdated }: ItemsBrowserProps) {
  // Ensure itemDrafts map exists on session
  if (!session.itemDrafts) {
    session.itemDrafts = new Map<string, ItemDraft>();
  }

  const [analysisData, setAnalysisData] = useState<ItemAnalysisSessionData | null>(
    session.itemAnalysis || null
  );
  const [isLoading, setIsLoading] = useState<boolean>(!session.itemAnalysis);
  const [progress, setProgress] = useState<ItemAnalysisProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSourceFilter, setSelectedSourceFilter] = useState<string>('all');
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showChangesModal, setShowChangesModal] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  // Draft revision ticker to trigger React re-renders when drafts mutate
  const [draftRevision, setDraftRevision] = useState(0);

  const notifyDraftsChange = useCallback(() => {
    const dirtyCount = getDirtyCount(session.itemDrafts);
    if (onDraftsUpdated) {
      onDraftsUpdated(dirtyCount);
    }
  }, [session, onDraftsUpdated]);

  const bumpDraftRevision = useCallback(() => {
    setDraftRevision((r) => r + 1);
    notifyDraftsChange();
  }, [notifyDraftsChange]);

  const runAnalysis = async () => {
    setIsLoading(true);
    setError(null);
    setProgress({ current: 0, total: 13, currentClass: 'h.class', percent: 0 });

    try {
      const data = await analyzeItemTables(session, (p) => {
        setProgress(p);
      });
      setAnalysisData(data);
      // Select first item if not already selected
      if (data.items.length > 0 && !selectedItemKey) {
        const first = data.items[0];
        setSelectedItemKey(getItemDraftKey(first.sourceClass, first.sourceField, first.sourceRow));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!session.itemAnalysis) {
      runAnalysis();
    } else {
      setAnalysisData(session.itemAnalysis);
      if (session.itemAnalysis.items.length > 0 && !selectedItemKey) {
        const first = session.itemAnalysis.items[0];
        setSelectedItemKey(getItemDraftKey(first.sourceClass, first.sourceField, first.sourceRow));
      }
    }
  }, [session]);

  // Update parent when session is ready
  useEffect(() => {
    notifyDraftsChange();
  }, [notifyDraftsChange]);

  // Dirty count
  const dirtyCount = useMemo(() => {
    // depend on draftRevision to update
    void draftRevision;
    return getDirtyCount(session.itemDrafts);
  }, [session.itemDrafts, draftRevision]);

  // Filtered items (respects drafts for search matching!)
  const filteredItems = useMemo(() => {
    if (!analysisData) return [];
    void draftRevision; // Trigger re-calculation if drafts change

    let list = analysisData.items;

    // Filter by source
    if (selectedSourceFilter !== 'all') {
      list = list.filter((item) => item.sourceClass === selectedSourceFilter);
    }

    // Filter by search query (checks effective ID, NAME, and description)
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((item) => {
        const effective = getEffectiveItem(item, session.itemDrafts);
        return (
          effective.id.toLowerCase().includes(q) ||
          effective.name.toLowerCase().includes(q) ||
          effective.description.toLowerCase().includes(q) ||
          item.sourceClass.toLowerCase().includes(q)
        );
      });
    }

    return list;
  }, [analysisData, selectedSourceFilter, searchQuery, draftRevision, session.itemDrafts]);

  // Reset page when filter or search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedSourceFilter]);

  // Total pages
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredItems.slice(start, start + PAGE_SIZE);
  }, [filteredItems, currentPage]);

  // Selected item object (Original ItemRecord from session - NEVER MUTATED)
  const selectedItem = useMemo(() => {
    if (!analysisData || !selectedItemKey) return null;
    return (
      analysisData.items.find((it) => {
        return getItemDraftKey(it.sourceClass, it.sourceField, it.sourceRow) === selectedItemKey;
      }) || null
    );
  }, [analysisData, selectedItemKey]);

  // Active draft for selected item
  const selectedItemDraft = useMemo(() => {
    if (!selectedItem || !session.itemDrafts) return null;
    void draftRevision;
    return getOrCreateDraft(session.itemDrafts, selectedItem);
  }, [selectedItem, session.itemDrafts, draftRevision]);

  // Handlers for draft operations
  const handleUpdateField = (item: ItemRecord, colIndex: number, newValue: string) => {
    if (!session.itemDrafts) return;
    setDraftField(session.itemDrafts, item, colIndex, newValue);
    bumpDraftRevision();
  };

  const handleResetField = (item: ItemRecord, colIndex: number) => {
    if (!session.itemDrafts) return;
    resetDraftField(session.itemDrafts, item, colIndex);
    bumpDraftRevision();
  };

  const handleResetItem = (item: ItemRecord) => {
    if (!session.itemDrafts) return;
    resetDraftItem(session.itemDrafts, item);
    bumpDraftRevision();
  };

  const handleResetItemByKey = (itemKey: string) => {
    if (!session.itemDrafts || !analysisData) return;
    const it = analysisData.items.find(
      (item) => getItemDraftKey(item.sourceClass, item.sourceField, item.sourceRow) === itemKey
    );
    if (it) {
      resetDraftItem(session.itemDrafts, it);
      bumpDraftRevision();
    }
  };

  const handleDiscardAll = () => {
    if (!session.itemDrafts) return;
    discardAllDrafts(session.itemDrafts);
    bumpDraftRevision();
  };

  // Loading State
  if (isLoading) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 sm:p-12 text-center space-y-5">
        <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 mx-auto flex items-center justify-center animate-spin">
          <RefreshCw className="w-6 h-6" />
        </div>
        <div>
          <h3 className="text-base font-bold text-zinc-100 flex items-center justify-center gap-2">
            <span>Reconstructing Item Tables from Bytecode</span>
          </h3>
          <p className="text-xs text-zinc-400 mt-1 max-w-md mx-auto">
            {progress
              ? `Reading <clinit> bytecode & reconstructing table ${progress.current} / ${progress.total}: ${progress.currentClass}`
              : 'Initializing static initializer analysis...'}
          </p>
        </div>

        {progress && (
          <div className="max-w-md mx-auto space-y-2">
            <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden border border-zinc-700">
              <div
                className="bg-amber-500 h-full transition-all duration-200"
                style={{ width: `${Math.max(5, progress.percent)}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] font-mono text-zinc-500">
              <span>{progress.currentClass}</span>
              <span>{progress.percent}%</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Error State
  if (error) {
    return (
      <div className="bg-red-950/30 border border-red-800/80 rounded-xl p-6 space-y-4">
        <div className="flex items-start gap-3 text-red-300">
          <AlertTriangle className="w-5 h-5 shrink-0 text-red-400 mt-0.5" />
          <div>
            <h3 className="text-sm font-bold text-red-200">
              Lỗi khi phục dựng Item Tables
            </h3>
            <p className="text-xs text-red-300/80 mt-1 font-mono whitespace-pre-wrap">
              {error}
            </p>
          </div>
        </div>
        <div className="pt-2">
          <button
            type="button"
            onClick={runAnalysis}
            className="px-3.5 py-1.5 rounded bg-red-900/60 hover:bg-red-900 text-red-100 text-xs font-mono flex items-center gap-2 border border-red-700 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Thử lại phân tích</span>
          </button>
        </div>
      </div>
    );
  }

  if (!analysisData) {
    return null;
  }

  const { diagnostics, sourceFilters } = analysisData;
  const dirtyDraftsList = getDirtyDrafts(session.itemDrafts);

  return (
    <div className="space-y-4">
      {/* Top Diagnostics & Controls Summary Bar */}
      <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-3 sm:p-4 space-y-3 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by ID, NAME (supports Unicode), or description..."
              className="w-full bg-zinc-950 border border-zinc-700/80 focus:border-amber-500 rounded-lg pl-9 pr-8 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none font-mono"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 text-xs px-1 cursor-pointer"
              >
                &times;
              </button>
            )}
          </div>

          {/* Quick Metrics & Actions */}
          <div className="flex items-center gap-2 text-xs font-mono flex-wrap">
            <span className="px-2.5 py-1 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
              Total: <strong className="text-amber-400">{filteredItems.length.toLocaleString()}</strong> / {analysisData.items.length.toLocaleString()}
            </span>

            {/* Changes (N) Button */}
            <button
              type="button"
              onClick={() => setShowChangesModal(true)}
              className={`px-3 py-1 rounded border text-xs font-mono flex items-center gap-1.5 transition-colors cursor-pointer ${
                dirtyCount > 0
                  ? 'bg-amber-500/20 border-amber-500/60 text-amber-300 font-bold shadow-xs'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Changes ({dirtyCount})</span>
              {dirtyCount > 0 && (
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              )}
            </button>

            {/* Diagnostics Toggle */}
            <button
              type="button"
              onClick={() => setShowDiagnostics(!showDiagnostics)}
              className={`px-2.5 py-1 rounded border text-xs font-mono flex items-center gap-1.5 transition-colors cursor-pointer ${
                showDiagnostics
                  ? 'bg-amber-950/60 border-amber-700/80 text-amber-300'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Info className="w-3.5 h-3.5" />
              <span>Diagnostics</span>
            </button>
          </div>
        </div>

        {/* Source Table Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs font-mono scrollbar-thin">
          <span className="text-[11px] text-zinc-500 shrink-0 mr-1 flex items-center gap-1">
            <Table className="w-3 h-3 text-zinc-400" /> Source:
          </span>
          <button
            type="button"
            onClick={() => setSelectedSourceFilter('all')}
            className={`px-2.5 py-1 rounded-md text-xs whitespace-nowrap cursor-pointer transition-colors ${
              selectedSourceFilter === 'all'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold'
                : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-750'
            }`}
          >
            All ({analysisData.items.length})
          </button>
          {sourceFilters.map((f) => (
            <button
              key={f.ownerInternalName}
              type="button"
              onClick={() => setSelectedSourceFilter(f.ownerInternalName)}
              className={`px-2 py-1 rounded-md text-xs whitespace-nowrap cursor-pointer transition-colors flex items-center gap-1 ${
                selectedSourceFilter === f.ownerInternalName
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold'
                  : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-750'
              }`}
            >
              <span className="text-zinc-500">#{f.index}</span>
              <span>{f.shortName}.u</span>
              <span className="text-[10px] text-zinc-500 bg-zinc-900 px-1 rounded">
                {f.count}
              </span>
            </button>
          ))}
        </div>

        {/* Expandable Diagnostics Details */}
        {showDiagnostics && (
          <div className="mt-3 pt-3 border-t border-zinc-800 bg-zinc-950/60 rounded-lg p-3 space-y-2.5 text-xs font-mono">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-zinc-400">
              <div className="bg-zinc-900 p-2 rounded border border-zinc-800">
                <span className="text-zinc-500 block text-[10px]">SCHEMA COLUMNS</span>
                <span className="text-zinc-200 font-bold">{diagnostics.schemaColumnCount} columns</span>
              </div>
              <div className="bg-zinc-900 p-2 rounded border border-zinc-800">
                <span className="text-zinc-500 block text-[10px]">SOURCE TABLES</span>
                <span className="text-zinc-200 font-bold">{diagnostics.tablesParsed} / {diagnostics.totalSourceTables} parsed</span>
              </div>
              <div className="bg-zinc-900 p-2 rounded border border-zinc-800">
                <span className="text-zinc-500 block text-[10px]">IN-MEMORY DRAFTS</span>
                <span className="text-amber-400 font-bold">{dirtyCount} modified</span>
              </div>
              <div className="bg-zinc-900 p-2 rounded border border-zinc-800">
                <span className="text-zinc-500 block text-[10px]">RECONSTRUCTED ROWS</span>
                <span className="text-emerald-400 font-bold">{diagnostics.rowsReconstructed.toLocaleString()}</span>
              </div>
            </div>

            {/* Schema Column Tags */}
            <div>
              <span className="text-[11px] text-zinc-500 block mb-1">
                Schema Fields (from a/a/a/h.class field aF):
              </span>
              <div className="flex flex-wrap gap-1">
                {diagnostics.schemaColumns.map((col, idx) => (
                  <span
                    key={col}
                    className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-300"
                  >
                    <strong className="text-amber-500 mr-1">{idx}:</strong>
                    {col}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Main Split Layout: Item Master List (Left) + Item Editor (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Master Item List Table */}
        <div className="lg:col-span-6 xl:col-span-5 bg-zinc-900/80 border border-zinc-800 rounded-xl overflow-hidden flex flex-col">
          {/* Table Header */}
          <div className="px-4 py-2.5 bg-zinc-850/80 border-b border-zinc-800 flex items-center justify-between text-xs font-mono text-zinc-400">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span className="font-semibold text-zinc-200">Reconstructed Items</span>
              <span className="text-zinc-500">
                ({paginatedItems.length} / {filteredItems.length})
              </span>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:pointer-events-none cursor-pointer text-zinc-300"
                  title="Previous Page"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="text-[11px] text-zinc-400">
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:pointer-events-none cursor-pointer text-zinc-300"
                  title="Next Page"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Table Body */}
          {paginatedItems.length === 0 ? (
            <div className="p-8 text-center text-xs font-mono text-zinc-500 space-y-1">
              <p>Không tìm thấy item nào phù hợp với bộ lọc.</p>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-amber-400 hover:underline cursor-pointer"
                >
                  Xóa từ khóa tìm kiếm
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[660px] overflow-y-auto scrollbar-thin">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-zinc-950/80 text-zinc-400 sticky top-0 z-10 border-b border-zinc-800 text-[11px]">
                  <tr>
                    <th className="px-3 py-2 w-16">ID</th>
                    <th className="px-3 py-2">NAME</th>
                    <th className="px-3 py-2 w-24">SOURCE</th>
                    <th className="px-3 py-2 w-14 text-center">STATUS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {paginatedItems.map((item) => {
                    const itemKey = getItemDraftKey(item.sourceClass, item.sourceField, item.sourceRow);
                    const isSelected = selectedItemKey === itemKey;
                    const shortClass = item.sourceClass.split('/').pop() || item.sourceClass;
                    const effective = getEffectiveItem(item, session.itemDrafts);

                    return (
                      <tr
                        key={itemKey}
                        onClick={() => setSelectedItemKey(itemKey)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-amber-500/15 text-amber-200 border-l-2 border-amber-400'
                            : 'hover:bg-zinc-800/60 text-zinc-300'
                        }`}
                      >
                        <td className="px-3 py-2 font-bold text-amber-400 whitespace-nowrap">
                          {effective.id || '-'}
                        </td>
                        <td className="px-3 py-2 font-sans font-medium text-zinc-100 max-w-[180px] truncate">
                          <span>{effective.name || <span className="text-zinc-600 font-mono italic">(no name)</span>}</span>
                        </td>
                        <td className="px-3 py-2 text-zinc-400 text-[11px] whitespace-nowrap">
                          <span className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 mr-1">
                            {shortClass}
                          </span>
                          <span className="text-zinc-500">:{item.sourceRow}</span>
                        </td>
                        <td className="px-3 py-2 text-center whitespace-nowrap">
                          {effective.isDirty ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
                              MOD
                            </span>
                          ) : (
                            <span className="text-[10px] text-zinc-600">
                              -
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right Pane: Item Editor Form */}
        <div className="lg:col-span-6 xl:col-span-7 bg-zinc-900/80 border border-zinc-800 rounded-xl overflow-hidden flex flex-col max-h-[710px]">
          {selectedItem && selectedItemDraft ? (
            <div className="overflow-y-auto p-4 scrollbar-thin">
              <ItemEditorForm
                session={session}
                item={selectedItem}
                allItems={analysisData.items}
                draft={selectedItemDraft}
                drafts={session.itemDrafts}
                onUpdateField={(colIndex, newValue) => handleUpdateField(selectedItem, colIndex, newValue)}
                onResetField={(colIndex) => handleResetField(selectedItem, colIndex)}
                onResetItem={() => handleResetItem(selectedItem)}
              />
            </div>
          ) : (
            <div className="h-full min-h-[350px] flex items-center justify-center p-6 text-center text-xs font-mono text-zinc-500">
              Chọn một item từ danh sách bên trái để xem và chỉnh sửa dữ liệu in-memory draft.
            </div>
          )}
        </div>
      </div>

      {/* Changes Modal Panel */}
      <ChangesPanel
        session={session}
        isOpen={showChangesModal}
        onClose={() => setShowChangesModal(false)}
        dirtyDrafts={dirtyDraftsList}
        allItems={analysisData?.items || []}
        onSelectItem={(key) => setSelectedItemKey(key)}
        onResetItem={(key) => handleResetItemByKey(key)}
        onDiscardAll={handleDiscardAll}
      />
    </div>
  );
}
