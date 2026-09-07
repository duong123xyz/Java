import React from 'react';
import { Network, PackagePlus, Trash2, X } from 'lucide-react';
import { LoadedJarSession } from '../../types/jar';
import {
  clearPatchWorkspace,
  getPatchWorkspaceOperations,
  removePatchWorkspaceOperation,
} from '../../services/patchWorkspaceStateService';

interface PatchWorkspaceBarProps {
  session: LoadedJarSession;
  onChanged: () => void;
}

export function PatchWorkspaceBar({
  session,
  onChanged,
}: PatchWorkspaceBarProps) {
  const operations = getPatchWorkspaceOperations(session);
  if (operations.length === 0) return null;

  const newItemCount = operations.filter(
    (operation) => operation.kind === 'NEW_ITEM'
  ).length;
  const hasMultiplayer = operations.some(
    (operation) => operation.kind === 'MULTIPLAYER_LITE'
  );

  return (
    <div className="shrink-0 rounded-lg border border-emerald-200 bg-emerald-50/80 px-2.5 py-1.5 flex items-center gap-2 min-w-0">
      <div className="shrink-0 flex items-center gap-1.5 text-[10px] font-bold text-emerald-800 font-mono">
        <span>PATCH WORKSPACE</span>
        <span className="px-1.5 py-0.5 rounded-full bg-white border border-emerald-200">
          {operations.length}
        </span>
      </div>

      <div className="min-w-0 flex-1 flex items-center gap-1.5 overflow-x-auto py-0.5">
        {operations.map((operation) => {
          const isItem = operation.kind === 'NEW_ITEM';
          const label = isItem
            ? `Item #${operation.values[0] || '?'} · ${operation.values[3] || '(không tên)'}`
            : `Multi ${operation.config.host}:${operation.config.port}`;

          return (
            <div
              key={operation.id}
              className="shrink-0 h-6 pl-2 pr-1 rounded-md border border-emerald-200 bg-white text-[9px] text-zinc-700 font-mono flex items-center gap-1.5"
              title={
                isItem
                  ? `${operation.sourceClass}.u · ${label}`
                  : `Multiplayer Lite · ${label}`
              }
            >
              {isItem ? (
                <PackagePlus className="w-3 h-3 text-amber-600" />
              ) : (
                <Network className="w-3 h-3 text-cyan-600" />
              )}
              <span className="max-w-[220px] truncate">{label}</span>
              <button
                type="button"
                onClick={() => {
                  removePatchWorkspaceOperation(session, operation.id);
                  onChanged();
                }}
                className="w-4 h-4 rounded hover:bg-red-50 text-zinc-400 hover:text-red-600 flex items-center justify-center cursor-pointer"
                title="Bỏ operation này khỏi Patch Workspace"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>

      <div className="hidden xl:flex shrink-0 items-center gap-1.5 text-[9px] text-emerald-700 font-mono">
        {newItemCount > 0 && <span>{newItemCount} item mới</span>}
        {newItemCount > 0 && hasMultiplayer && <span>·</span>}
        {hasMultiplayer && <span>Multiplayer</span>}
      </div>

      <button
        type="button"
        onClick={() => {
          clearPatchWorkspace(session);
          onChanged();
        }}
        className="shrink-0 h-6 px-2 rounded-md border border-red-200 bg-white hover:bg-red-50 text-[9px] text-red-600 font-semibold flex items-center gap-1 cursor-pointer"
        title="Chỉ xóa operation Item mới / Multiplayer; không xóa các nháp panel khác"
      >
        <Trash2 className="w-3 h-3" />
        <span className="hidden 2xl:inline">Xóa WS</span>
      </button>
    </div>
  );
}
