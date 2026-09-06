import React, { useState, useMemo } from 'react';
import {
  RotateCcw,
  AlertTriangle,
  FileCode,
  Sliders,
  Eye,
  CheckCircle,
  Copy,
  Check,
  Table,
  Layers,
  Info,
  Sparkles,
} from 'lucide-react';
import { ItemRecord, ItemDraft } from '../../types/item';
import { LoadedJarSession } from '../../types/jar';
import {
  ITEM_SCHEMA_FIELDS,
  validateFieldValue,
  findDuplicateIds,
  getItemDraftKey,
} from '../../services/itemDraftService';
import { PatchPlanTab } from './PatchPlanTab';

interface ItemEditorFormProps {
  session: LoadedJarSession;
  item: ItemRecord;
  allItems: ItemRecord[];
  draft: ItemDraft;
  drafts: Map<string, ItemDraft>;
  onUpdateField: (colIndex: number, newValue: string) => void;
  onResetField: (colIndex: number) => void;
  onResetItem: () => void;
}

export function ItemEditorForm({
  session,
  item,
  allItems,
  draft,
  drafts,
  onUpdateField,
  onResetField,
  onResetItem,
}: ItemEditorFormProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'editor' | 'diff' | 'patch'>('editor');

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(label);
    setTimeout(() => setCopiedField(null), 1800);
  };

  // Duplicate ID warning check
  const currentDraftId = draft.values[0] ?? '';
  const duplicateLocations = useMemo(() => {
    return findDuplicateIds(currentDraftId, draft.key, allItems, drafts);
  }, [currentDraftId, draft.key, allItems, drafts]);

  // Dirty fields info for comparison
  const changedFields = useMemo(() => {
    return draft.dirtyFields.map((colIdx) => {
      const meta = ITEM_SCHEMA_FIELDS[colIdx];
      return {
        colIndex: colIdx,
        label: meta ? meta.label : `Col ${colIdx}`,
        description: meta ? meta.description : '',
        original: draft.originalValues[colIdx] ?? '',
        current: draft.values[colIdx] ?? '',
      };
    });
  }, [draft]);

  // Groups
  const generalFields = ITEM_SCHEMA_FIELDS.filter((f) => f.group === 'general');
  const requirementsFields = ITEM_SCHEMA_FIELDS.filter((f) => f.group === 'requirements');
  const visualFields = ITEM_SCHEMA_FIELDS.filter((f) => f.group === 'visual');

  const renderFieldInput = (colIndex: number) => {
    const meta = ITEM_SCHEMA_FIELDS[colIndex];
    if (!meta) return null;

    const value = draft.values[colIndex] ?? '';
    const originalValue = draft.originalValues[colIndex] ?? '';
    const isFieldDirty = draft.dirtyFields.includes(colIndex);
    const validationError = validateFieldValue(colIndex, value);

    const isLongText = meta.key === 'description';

    return (
      <div
        key={meta.key}
        className={`p-2.5 rounded-lg border transition-all ${
          isFieldDirty
            ? 'bg-amber-950/20 border-amber-500/50 shadow-xs'
            : 'bg-zinc-950/60 border-zinc-800/80 hover:border-zinc-700/80'
        }`}
      >
        <div className="flex items-center justify-between mb-1.5 gap-2">
          <label
            htmlFor={`field-input-${meta.key}`}
            className="text-[11px] font-mono font-medium text-zinc-300 flex items-center gap-1.5"
          >
            <span className="text-zinc-500 text-[10px]">#{colIndex}</span>
            <span className={isFieldDirty ? 'text-amber-300 font-bold' : 'text-zinc-200'}>
              {meta.label}
            </span>
            {meta.type === 'number' && (
              <span className="text-[9px] px-1 py-0.2 rounded bg-zinc-800 text-zinc-400">
                numeric
              </span>
            )}
          </label>

          <div className="flex items-center gap-1.5">
            {isFieldDirty && (
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-mono font-semibold border border-amber-500/30">
                Modified
              </span>
            )}
            {isFieldDirty && (
              <button
                type="button"
                onClick={() => onResetField(colIndex)}
                className="text-[10px] font-mono text-zinc-400 hover:text-amber-300 flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700 cursor-pointer transition-colors"
                title={`Revert ${meta.label} to original: "${originalValue}"`}
              >
                <RotateCcw className="w-2.5 h-2.5" />
                <span>Reset</span>
              </button>
            )}
          </div>
        </div>

        {isLongText ? (
          <textarea
            id={`field-input-${meta.key}`}
            value={value}
            rows={2}
            onChange={(e) => onUpdateField(colIndex, e.target.value)}
            className={`w-full bg-zinc-900 border rounded px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none font-sans resize-y ${
              validationError
                ? 'border-red-500 focus:border-red-400'
                : isFieldDirty
                ? 'border-amber-500/60 focus:border-amber-400'
                : 'border-zinc-750 focus:border-amber-500/60'
            }`}
          />
        ) : (
          <input
            id={`field-input-${meta.key}`}
            type="text"
            value={value}
            onChange={(e) => onUpdateField(colIndex, e.target.value)}
            className={`w-full bg-zinc-900 border rounded px-2.5 py-1 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none font-mono ${
              validationError
                ? 'border-red-500 focus:border-red-400'
                : isFieldDirty
                ? 'border-amber-500/60 focus:border-amber-400'
                : 'border-zinc-750 focus:border-amber-500/60'
            }`}
          />
        )}

        {/* Validation error message */}
        {validationError && (
          <div className="mt-1 text-[11px] text-red-400 font-mono flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 shrink-0" />
            <span>{validationError}</span>
          </div>
        )}

        {/* Previous original value indicator if modified */}
        {isFieldDirty && (
          <div className="mt-1 text-[10px] text-zinc-400 font-mono flex items-center justify-between">
            <span className="truncate">
              Modified from: <strong className="text-zinc-300">&quot;{originalValue}&quot;</strong>
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Item Top Bar */}
      <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-xl p-3.5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/40 text-xs font-mono font-bold">
                ID: {draft.values[0] || item.id}
              </span>
              <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 text-xs font-mono">
                {item.sourceClass}:{item.sourceRow}
              </span>

              {draft.isDirty ? (
                <span className="px-2 py-0.5 rounded bg-amber-950/70 text-amber-300 border border-amber-700/80 text-[11px] font-mono font-semibold flex items-center gap-1 animate-pulse">
                  Modified ({draft.dirtyFields.length} field{draft.dirtyFields.length > 1 ? 's' : ''})
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded bg-emerald-950/50 text-emerald-400 border border-emerald-800/50 text-[11px] font-mono flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" /> In-Memory Original
                </span>
              )}
            </div>

            <h2 className="text-base font-bold text-zinc-100 mt-1 font-sans">
              {draft.values[3] || item.name || '(Chưa có tên)'}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {draft.isDirty && (
              <button
                type="button"
                onClick={onResetItem}
                className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-750 text-zinc-300 hover:text-amber-300 text-xs font-mono flex items-center gap-1.5 border border-zinc-700 cursor-pointer transition-colors"
                title="Reset toàn bộ thay đổi của item này về giá trị gốc trong JAR"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Item</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => handleCopy(draft.values[0] || item.id, 'id')}
              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs flex items-center gap-1 border border-zinc-750 cursor-pointer"
              title="Copy Item ID"
            >
              {copiedField === 'id' ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>

        {/* Duplicate ID Diagnostic Warning */}
        {duplicateLocations.length > 0 && (
          <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-600/70 text-amber-200 text-xs font-mono space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-amber-300">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Duplicate item ID detected: &quot;{currentDraftId}&quot;</span>
            </div>
            <p className="text-[11px] text-amber-200/80">
              ID này cũng đang được sử dụng tại {duplicateLocations.length} vị trí khác trong JAR:
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {duplicateLocations.map((dup) => (
                <span
                  key={dup.key}
                  className="px-2 py-0.5 rounded bg-amber-900/60 border border-amber-700 text-[10px] text-amber-100"
                >
                  {dup.sourceClass}:{dup.sourceRow} ({dup.name || 'no-name'})
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Sub-tab view: Editor Form vs Diff Comparison */}
        <div className="flex items-center gap-2 pt-1 border-t border-zinc-800/80 text-xs font-mono">
          <button
            type="button"
            onClick={() => setActiveSubTab('editor')}
            className={`px-3 py-1 rounded-md cursor-pointer transition-colors flex items-center gap-1.5 ${
              activeSubTab === 'editor'
                ? 'bg-zinc-800 text-amber-300 border border-amber-500/40 font-semibold'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>15 Fields Editor</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('diff')}
            className={`px-3 py-1 rounded-md cursor-pointer transition-colors flex items-center gap-1.5 ${
              activeSubTab === 'diff'
                ? 'bg-zinc-800 text-amber-300 border border-amber-500/40 font-semibold'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
            }`}
          >
            <Table className="w-3.5 h-3.5" />
            <span>Compare (Original vs Draft)</span>
            {draft.dirtyFields.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-500/30 text-amber-300 font-bold">
                {draft.dirtyFields.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('patch')}
            className={`px-3 py-1 rounded-md cursor-pointer transition-colors flex items-center gap-1.5 ${
              activeSubTab === 'patch'
                ? 'bg-zinc-800 text-amber-300 border border-amber-500/40 font-semibold'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>Patch Plan</span>
            {draft.dirtyFields.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-500/30 text-amber-300 font-bold">
                {draft.dirtyFields.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {activeSubTab === 'patch' ? (
        /* Bytecode Evidence & Patch Plan Tab */
        <PatchPlanTab session={session} item={item} draft={draft} />
      ) : activeSubTab === 'diff' ? (
        /* Compare Mode Panel */
        <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-mono font-bold text-zinc-200 uppercase tracking-wider flex items-center gap-2">
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              <span>Original vs Draft Differences</span>
            </h3>
            {draft.dirtyFields.length > 0 && (
              <button
                type="button"
                onClick={onResetItem}
                className="text-[11px] font-mono text-zinc-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset All to Original</span>
              </button>
            )}
          </div>

          {changedFields.length === 0 ? (
            <div className="p-8 text-center text-xs font-mono text-zinc-500 border border-dashed border-zinc-800 rounded-lg">
              Chưa có trường nào bị chỉnh sửa trong item này. Dữ liệu khớp 100% với JAR gốc.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-zinc-800">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-zinc-900 text-zinc-400 border-b border-zinc-800 text-[11px]">
                  <tr>
                    <th className="px-3 py-2 w-32">FIELD</th>
                    <th className="px-3 py-2">ORIGINAL VALUE</th>
                    <th className="px-3 py-2">DRAFT VALUE</th>
                    <th className="px-3 py-2 w-20 text-center">ACTION</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {changedFields.map((field) => (
                    <tr key={field.colIndex} className="bg-zinc-950/50 hover:bg-zinc-900/40">
                      <td className="px-3 py-2 font-bold text-amber-300">
                        {field.label}
                        <span className="text-[10px] text-zinc-500 block font-normal">
                          col #{field.colIndex}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-zinc-400 break-all font-mono">
                        <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800">
                          {field.original || <span className="italic text-zinc-600">(empty)</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-amber-200 font-bold break-all font-mono">
                        <span className="px-1.5 py-0.5 rounded bg-amber-950/40 border border-amber-800/60">
                          {field.current || <span className="italic text-zinc-600">(empty)</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => onResetField(field.colIndex)}
                          className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-amber-300 text-[10px] font-mono border border-zinc-700 cursor-pointer"
                          title="Revert field to original"
                        >
                          Reset
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* Desktop Grouped Editor Layout */
        <div className="space-y-4">
          {/* GROUP 1: GENERAL */}
          <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-3.5 space-y-3">
            <h3 className="text-xs font-mono font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-zinc-800/80">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span>General Information</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {generalFields.map((f) => renderFieldInput(f.index))}
            </div>
          </div>

          {/* GROUP 2: REQUIREMENTS / VALUE */}
          <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-3.5 space-y-3">
            <h3 className="text-xs font-mono font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-zinc-800/80">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>Requirements &amp; Economy</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {requirementsFields.map((f) => renderFieldInput(f.index))}
            </div>
          </div>

          {/* GROUP 3: VISUAL & SPRITE */}
          <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-3.5 space-y-3">
            <h3 className="text-xs font-mono font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-zinc-800/80">
              <span className="w-2 h-2 rounded-full bg-blue-400" />
              <span>Visual &amp; Sprite Parts</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {visualFields.map((f) => renderFieldInput(f.index))}
            </div>
          </div>

          {/* SECTION 4: SOURCE TECHNICAL INFORMATION (READ-ONLY) */}
          <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-xl p-3.5 space-y-2">
            <h3 className="text-xs font-mono font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
              <FileCode className="w-3.5 h-3.5 text-zinc-500" />
              <span>Source Information (Read-Only)</span>
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
              <div className="p-2 rounded bg-zinc-900 border border-zinc-800">
                <span className="text-zinc-500 text-[10px] block">SOURCE CLASS</span>
                <span className="text-zinc-200 font-bold truncate block" title={item.sourceClass}>
                  {item.sourceClass}.class
                </span>
              </div>
              <div className="p-2 rounded bg-zinc-900 border border-zinc-800">
                <span className="text-zinc-500 text-[10px] block">SOURCE FIELD</span>
                <span className="text-zinc-200 font-bold">{item.sourceField} ([[LString;)</span>
              </div>
              <div className="p-2 rounded bg-zinc-900 border border-zinc-800">
                <span className="text-zinc-500 text-[10px] block">SOURCE TABLE INDEX</span>
                <span className="text-zinc-200 font-bold">#{item.sourceTableIndex}</span>
              </div>
              <div className="p-2 rounded bg-zinc-900 border border-zinc-800">
                <span className="text-zinc-500 text-[10px] block">SOURCE ROW</span>
                <span className="text-amber-400 font-bold">{item.sourceRow}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
