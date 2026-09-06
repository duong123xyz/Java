import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Search,
  X,
  Copy,
  Check,
  ToggleLeft,
  ToggleRight,
  ListFilter,
  FileCode2,
  Cpu,
  Layers,
  Sparkles,
} from 'lucide-react';
import { ResolvedCpEntry, CpTag, ConstantPoolStats } from '../../types/constantPool';
import { computeCpStats } from '../../services/constantPoolResolver';

interface ConstantPoolViewerProps {
  entries: ResolvedCpEntry[];
  className: string;
}

export type CpFilterCategory =
  | 'all'
  | 'utf8'
  | 'string'
  | 'class'
  | 'field'
  | 'method'
  | 'numbers';

const ROW_HEIGHT = 40;
const BUFFER_COUNT = 15;

export const ConstantPoolViewer: React.FC<ConstantPoolViewerProps> = ({
  entries,
  className,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<CpFilterCategory>('all');
  const [mode, setMode] = useState<'resolved' | 'raw'>('resolved');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [showUtf8Panel, setShowUtf8Panel] = useState<boolean>(false);
  const [utf8Search, setUtf8Search] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(480);

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        setContainerHeight(containerRef.current.clientHeight || 480);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  // Compute stats runtime
  const stats: ConstantPoolStats = useMemo(() => {
    return computeCpStats(entries);
  }, [entries]);

  // Real-time filtering and searching
  const filteredEntries = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return entries.filter((item) => {
      // 1. Filter category
      if (filter === 'utf8' && item.tag !== CpTag.Utf8) return false;
      if (filter === 'string' && item.tag !== CpTag.String) return false;
      if (filter === 'class' && item.tag !== CpTag.Class) return false;
      if (filter === 'field' && item.tag !== CpTag.Fieldref) return false;
      if (
        filter === 'method' &&
        item.tag !== CpTag.Methodref &&
        item.tag !== CpTag.InterfaceMethodref
      ) {
        return false;
      }
      if (
        filter === 'numbers' &&
        item.tag !== CpTag.Integer &&
        item.tag !== CpTag.Float &&
        item.tag !== CpTag.Long &&
        item.tag !== CpTag.Double
      ) {
        return false;
      }

      // 2. Search term
      if (term) {
        const indexMatch =
          `#${item.index}`.toLowerCase().includes(term) ||
          `${item.index}` === term;
        const typeMatch = item.typeName.toLowerCase().includes(term);
        const resolvedMatch = item.resolvedValue.toLowerCase().includes(term);
        const rawMatch = item.rawValue.toLowerCase().includes(term);

        if (!indexMatch && !typeMatch && !resolvedMatch && !rawMatch) {
          return false;
        }
      }

      return true;
    });
  }, [entries, filter, searchTerm]);

  // Detected UTF8 strings list for schema detection diagnostic
  const detectedUtf8List = useMemo(() => {
    const utf8s = entries
      .filter((e) => e.tag === CpTag.Utf8 && !e.isReserved)
      .map((e) => ({
        index: e.index,
        value: e.resolvedValue,
      }));

    if (!utf8Search.trim()) return utf8s;
    const s = utf8Search.trim().toLowerCase();
    return utf8s.filter((item) => item.value.toLowerCase().includes(s));
  }, [entries, utf8Search]);

  const copyValue = (value: string, index: number) => {
    navigator.clipboard.writeText(value);
    setCopiedIndex(index);
    setTimeout(() => {
      setCopiedIndex((current) => (current === index ? null : current));
    }, 1500);
  };

  // Virtual scrolling calculations
  const totalItems = filteredEntries.length;
  const startIndex = Math.max(
    0,
    Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_COUNT
  );
  const visibleCount =
    Math.ceil(containerHeight / ROW_HEIGHT) + BUFFER_COUNT * 2;
  const endIndex = Math.min(totalItems, startIndex + visibleCount);

  const visibleEntries = filteredEntries.slice(startIndex, endIndex);
  const topPadding = startIndex * ROW_HEIGHT;
  const bottomPadding = (totalItems - endIndex) * ROW_HEIGHT;

  const getTypeBadgeClass = (tag: CpTag, isReserved: boolean) => {
    if (isReserved) {
      return 'text-zinc-600 bg-zinc-900 border-zinc-800';
    }
    switch (tag) {
      case CpTag.Utf8:
        return 'text-purple-400 bg-purple-950/50 border-purple-900/40';
      case CpTag.String:
        return 'text-emerald-400 bg-emerald-950/50 border-emerald-900/40';
      case CpTag.Class:
        return 'text-blue-400 bg-blue-950/50 border-blue-900/40';
      case CpTag.Fieldref:
        return 'text-amber-400 bg-amber-950/50 border-amber-900/40';
      case CpTag.Methodref:
      case CpTag.InterfaceMethodref:
        return 'text-cyan-400 bg-cyan-950/50 border-cyan-900/40';
      case CpTag.NameAndType:
        return 'text-indigo-400 bg-indigo-950/50 border-indigo-900/40';
      case CpTag.Integer:
      case CpTag.Float:
      case CpTag.Long:
      case CpTag.Double:
        return 'text-orange-400 bg-orange-950/50 border-orange-900/40';
      default:
        return 'text-zinc-400 bg-zinc-900 border-zinc-800';
    }
  };

  return (
    <div id="constant-pool-viewer-root" className="space-y-3 font-mono">
      {/* Top Controls Bar */}
      <div className="bg-zinc-950/70 border border-zinc-800 rounded-lg p-3 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5 border-b border-zinc-800/80">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-purple-400" />
            <span className="text-xs font-bold text-zinc-100 uppercase tracking-wider">
              Constant Pool
            </span>
            <span className="text-[11px] px-2 py-0.5 rounded bg-zinc-900 text-zinc-300 border border-zinc-800">
              {stats.usableEntries.toLocaleString()} usable / {stats.totalCount.toLocaleString()} entries
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Raw vs Resolved Toggle */}
            <button
              type="button"
              onClick={() => setMode(mode === 'resolved' ? 'raw' : 'resolved')}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700/80 cursor-pointer transition-colors"
              title="Toggle between friendly resolved values and raw internal index references"
            >
              {mode === 'resolved' ? (
                <>
                  <ToggleRight className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-300 font-semibold">Resolved</span>
                </>
              ) : (
                <>
                  <ToggleLeft className="w-4 h-4 text-amber-400" />
                  <span className="text-amber-300 font-semibold">Raw Index</span>
                </>
              )}
            </button>

            {/* UTF-8 Strings Panel Toggle */}
            <button
              type="button"
              onClick={() => setShowUtf8Panel(!showUtf8Panel)}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border transition-colors cursor-pointer ${
                showUtf8Panel
                  ? 'bg-purple-950/60 text-purple-200 border-purple-800/60 font-medium'
                  : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border-zinc-800'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              <span>Detected UTF8</span>
              <span className="text-[10px] px-1 py-0.2 rounded bg-zinc-950 border border-zinc-800">
                {stats.utf8Entries}
              </span>
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            id="cp-search-input"
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search index (#12), type (Utf8), or text (icon_id, NAME, gender, <init>)..."
            className="w-full bg-zinc-900/90 border border-zinc-800 rounded pl-8 pr-8 py-1.5 text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/30 transition-all"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 cursor-pointer"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filters bar */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-[10px] text-zinc-500 uppercase mr-1 flex items-center gap-1">
            <ListFilter className="w-3 h-3" />
            <span>Filter:</span>
          </span>

          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors cursor-pointer ${
              filter === 'all'
                ? 'bg-zinc-800 text-zinc-100 font-semibold border border-zinc-700'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
            }`}
          >
            All ({stats.totalCount})
          </button>

          <button
            type="button"
            onClick={() => setFilter('utf8')}
            className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors cursor-pointer ${
              filter === 'utf8'
                ? 'bg-purple-950/60 text-purple-300 font-semibold border border-purple-800/60'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
            }`}
          >
            UTF8 ({stats.utf8Entries})
          </button>

          <button
            type="button"
            onClick={() => setFilter('string')}
            className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors cursor-pointer ${
              filter === 'string'
                ? 'bg-emerald-950/60 text-emerald-300 font-semibold border border-emerald-800/60'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
            }`}
          >
            String ({stats.stringEntries})
          </button>

          <button
            type="button"
            onClick={() => setFilter('class')}
            className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors cursor-pointer ${
              filter === 'class'
                ? 'bg-blue-950/60 text-blue-300 font-semibold border border-blue-800/60'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
            }`}
          >
            Class ({stats.classRefs})
          </button>

          <button
            type="button"
            onClick={() => setFilter('field')}
            className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors cursor-pointer ${
              filter === 'field'
                ? 'bg-amber-950/60 text-amber-300 font-semibold border border-amber-800/60'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
            }`}
          >
            Field ({stats.fieldRefs})
          </button>

          <button
            type="button"
            onClick={() => setFilter('method')}
            className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors cursor-pointer ${
              filter === 'method'
                ? 'bg-cyan-950/60 text-cyan-300 font-semibold border border-cyan-800/60'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
            }`}
          >
            Method ({stats.methodRefs})
          </button>

          <button
            type="button"
            onClick={() => setFilter('numbers')}
            className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors cursor-pointer ${
              filter === 'numbers'
                ? 'bg-orange-950/60 text-orange-300 font-semibold border border-orange-800/60'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
            }`}
          >
            Numbers ({stats.numberEntries})
          </button>
        </div>
      </div>

      {/* Detected UTF8 Strings Diagnostic Drawer */}
      {showUtf8Panel && (
        <div className="bg-purple-950/20 border border-purple-900/50 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-purple-300 font-semibold uppercase">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              <span>Detected UTF8 strings (Read-only Diagnostic)</span>
            </div>
            <span className="text-[10px] text-zinc-500">
              Showing {detectedUtf8List.length} of {stats.utf8Entries} strings
            </span>
          </div>

          <p className="text-[11px] text-zinc-400 leading-relaxed">
            Danh sách chuỗi UTF-8 thô được trích xuất trực tiếp từ Constant Pool của class{' '}
            <strong className="text-zinc-200">{className}</strong>. Không can thiệp mã bytecode hay hardcode schema.
          </p>

          <div className="relative pt-1">
            <input
              type="text"
              value={utf8Search}
              onChange={(e) => setUtf8Search(e.target.value)}
              placeholder="Search detected UTF8 strings (e.g. icon_id, TYPE, gender, NAME)..."
              className="w-full bg-zinc-950/80 border border-zinc-800 rounded px-2.5 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-purple-500/60"
            />
          </div>

          <div className="max-h-40 overflow-y-auto bg-zinc-950 p-2 rounded border border-zinc-800/80 flex flex-wrap gap-1.5">
            {detectedUtf8List.length === 0 ? (
              <span className="text-xs text-zinc-500 italic p-1">No matching UTF8 strings</span>
            ) : (
              detectedUtf8List.map((item) => (
                <button
                  key={`utf8-${item.index}`}
                  type="button"
                  onClick={() => {
                    setSearchTerm(item.value);
                    setFilter('all');
                  }}
                  className="text-[11px] px-2 py-0.5 rounded bg-zinc-900 hover:bg-purple-950/60 text-zinc-300 hover:text-purple-200 border border-zinc-800 hover:border-purple-800/60 transition-colors cursor-pointer flex items-center gap-1"
                  title={`Click to filter constant pool for "${item.value}" (#${item.index})`}
                >
                  <span className="text-zinc-600">#{item.index}</span>
                  <span className="text-purple-300 font-medium">{item.value}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Main Constant Pool Table / List */}
      <div className="border border-zinc-800 bg-zinc-950/70 rounded-lg overflow-hidden flex flex-col">
        {/* Table Header */}
        <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-zinc-900 border-b border-zinc-800 text-[10px] text-zinc-500 uppercase tracking-wider font-semibold select-none">
          <div className="col-span-2 sm:col-span-1">Index</div>
          <div className="col-span-3 sm:col-span-2">Type</div>
          <div className="col-span-6 sm:col-span-8">
            {mode === 'resolved' ? 'Resolved Value' : 'Raw Index Reference'}
          </div>
          <div className="col-span-1 text-right">Action</div>
        </div>

        {/* Viewport */}
        {totalItems === 0 ? (
          <div className="h-60 flex flex-col items-center justify-center text-center p-6 text-zinc-500 text-xs">
            <p>No constant pool entries match your criteria.</p>
            <p className="text-[11px] text-zinc-600 mt-1">
              Try adjusting your search query or reset the filter.
            </p>
          </div>
        ) : (
          <div
            id="cp-viewport"
            ref={containerRef}
            onScroll={handleScroll}
            className="h-[440px] overflow-y-auto select-none"
          >
            <div
              style={{
                paddingTop: `${topPadding}px`,
                paddingBottom: `${bottomPadding}px`,
              }}
            >
              {visibleEntries.map((item) => {
                const isCopied = copiedIndex === item.index;
                const displayVal =
                  mode === 'resolved' ? item.resolvedValue : item.rawValue;

                return (
                  <div
                    key={`cp-${item.index}`}
                    style={{ height: `${ROW_HEIGHT}px` }}
                    className={`grid grid-cols-12 gap-2 px-3 items-center border-b border-zinc-900/70 text-xs transition-colors hover:bg-zinc-900/60 ${
                      item.isReserved ? 'opacity-40 italic' : ''
                    }`}
                  >
                    {/* Index */}
                    <div className="col-span-2 sm:col-span-1 text-zinc-400 font-medium">
                      #{item.index}
                    </div>

                    {/* Type Badge */}
                    <div className="col-span-3 sm:col-span-2">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded border inline-block truncate max-w-full ${getTypeBadgeClass(
                          item.tag,
                          item.isReserved
                        )}`}
                        title={item.typeName}
                      >
                        {item.typeName}
                      </span>
                    </div>

                    {/* Value */}
                    <div className="col-span-6 sm:col-span-8 min-w-0 pr-2">
                      <span
                        className={`truncate block select-all font-mono ${
                          item.isReserved
                            ? 'text-zinc-600'
                            : item.tag === CpTag.String || item.tag === CpTag.Utf8
                            ? 'text-emerald-300'
                            : item.tag === CpTag.Class
                            ? 'text-blue-300'
                            : item.tag === CpTag.Fieldref || item.tag === CpTag.Methodref
                            ? 'text-zinc-200'
                            : 'text-zinc-300'
                        }`}
                        title={displayVal}
                      >
                        {displayVal}
                      </span>
                    </div>

                    {/* Copy Button */}
                    <div className="col-span-1 text-right">
                      {!item.isReserved && (
                        <button
                          type="button"
                          onClick={() => copyValue(displayVal, item.index)}
                          className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
                          title="Copy value"
                        >
                          {isCopied ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Diagnostics Footer Bar */}
      <div className="bg-zinc-950/50 border border-zinc-800 p-2.5 rounded-lg flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-400">
        <div className="flex items-center gap-1.5 text-zinc-500">
          <Cpu className="w-3.5 h-3.5 text-zinc-600" />
          <span>CP Diagnostics:</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span>
            Total: <strong className="text-zinc-200">{stats.totalCount}</strong>
          </span>
          <span>
            Usable:{' '}
            <strong className="text-purple-300">{stats.usableEntries}</strong>
          </span>
          <span>
            Reserved:{' '}
            <strong className="text-zinc-500">{stats.reservedSlots}</strong>
          </span>
          <span>
            UTF8: <strong className="text-purple-400">{stats.utf8Entries}</strong>
          </span>
          <span>
            String: <strong className="text-emerald-400">{stats.stringEntries}</strong>
          </span>
          <span>
            Class: <strong className="text-blue-400">{stats.classRefs}</strong>
          </span>
          <span>
            Fields: <strong className="text-amber-400">{stats.fieldRefs}</strong>
          </span>
          <span>
            Methods: <strong className="text-cyan-400">{stats.methodRefs}</strong>
          </span>
        </div>
      </div>
    </div>
  );
};
