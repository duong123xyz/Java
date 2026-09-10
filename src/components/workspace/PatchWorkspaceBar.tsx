import React, { useState } from 'react';
import { ClipboardList, Crown, Network, PackagePlus, Trash2, X } from 'lucide-react';
import { LoadedJarSession } from '../../types/jar';
import { QuestPanel } from '../quests/QuestPanel';
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
  const [showQuestPanel, setShowQuestPanel] = useState(false);
  const operations = getPatchWorkspaceOperations(session);

  const newItemCount = operations.filter(
    (operation) => operation.kind === 'NEW_ITEM'
  ).length;
  const hasMultiplayer = operations.some(
    (operation) => operation.kind === 'MULTIPLAYER_LITE'
  );
  const newBossCount = operations.filter((operation) => operation.kind === 'NEW_BOSS').length;
  const questOperation = operations.find(
    (operation) => operation.kind === 'QUEST_PATCH'
  );

  return (
    <>
      <div className="shrink-0 rounded-lg border border-emerald-200 bg-emerald-50/80 px-2.5 py-1.5 flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={() => setShowQuestPanel(true)}
          className="shrink-0 h-7 px-2.5 rounded-md border border-indigo-200 bg-white hover:bg-indigo-50 text-[10px] font-semibold text-indigo-700 flex items-center gap-1.5 cursor-pointer"
          title="Mở panel chỉnh nhiệm vụ chính và các bước nhiệm vụ"
        >
          <ClipboardList className="w-3.5 h-3.5" />
          <span>Nhiệm vụ</span>
          {questOperation && (
            <span className="px-1.5 py-0.5 rounded-full bg-indigo-100 border border-indigo-200 text-[9px] font-mono">
              {questOperation.edits.length + questOperation.rewards.filter((reward) => reward.enabled).length}
            </span>
          )}
        </button>

        <div className="shrink-0 flex items-center gap-1.5 text-[10px] font-bold text-emerald-800 font-mono">
          <span>PATCH WORKSPACE</span>
          <span className="px-1.5 py-0.5 rounded-full bg-white border border-emerald-200">
            {operations.length}
          </span>
        </div>

        <div className="min-w-0 flex-1 flex items-center gap-1.5 overflow-x-auto py-0.5">
          {operations.length === 0 ? (
            <span className="text-[9px] text-emerald-700/80 whitespace-nowrap">
              Chưa có operation · bấm Nhiệm vụ để chỉnh quest.
            </span>
          ) : operations.map((operation) => {
            const isItem = operation.kind === 'NEW_ITEM';
            const isQuest = operation.kind === 'QUEST_PATCH';
            const isBoss = operation.kind === 'NEW_BOSS';
            const label = isItem
              ? `Item #${operation.values[0] || '?'} · ${operation.values[3] || '(không tên)'}`
              : isQuest
              ? `Nhiệm vụ · ${operation.edits.length} cell · ${operation.rewards.filter((reward) => reward.enabled).length} reward`
              : isBoss
              ? `Boss ${operation.name} · char ${operation.charId} · map ${operation.mapId}`
              : `Multi ${operation.config.host}:${operation.config.port}`;

            return (
              <div
                key={operation.id}
                className="shrink-0 h-6 pl-2 pr-1 rounded-md border border-emerald-200 bg-white text-[9px] text-zinc-700 font-mono flex items-center gap-1.5"
                title={
                  isItem
                    ? `${operation.sourceClass}.u · ${label}`
                    : isQuest
                    ? 'Quest tables a/a/a/Z.u + a/a/a/ab.u + runtime reward a/a/X.c(H,int)'
                    : isBoss
                    ? `Boss Creator · a/a/d.class · ${label}`
                    : `Multiplayer Lite · ${label}`
                }
              >
                {isItem ? (
                  <PackagePlus className="w-3 h-3 text-amber-600" />
                ) : isQuest ? (
                  <ClipboardList className="w-3 h-3 text-indigo-600" />
                ) : isBoss ? (
                  <Crown className="w-3 h-3 text-rose-600" />
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
          {newItemCount > 0 && (hasMultiplayer || questOperation || newBossCount > 0) && <span>·</span>}
          {newBossCount > 0 && <span>{newBossCount} boss mới</span>}
          {newBossCount > 0 && (questOperation || hasMultiplayer) && <span>·</span>}
          {questOperation && <span>Quest {questOperation.edits.length} cell / {questOperation.rewards.filter((reward) => reward.enabled).length} reward</span>}
          {questOperation && hasMultiplayer && <span>·</span>}
          {hasMultiplayer && <span>Multiplayer</span>}
        </div>

        {operations.length > 0 && (
          <button
            type="button"
            onClick={() => {
              clearPatchWorkspace(session);
              onChanged();
            }}
            className="shrink-0 h-6 px-2 rounded-md border border-red-200 bg-white hover:bg-red-50 text-[9px] text-red-600 font-semibold flex items-center gap-1 cursor-pointer"
            title="Xóa toàn bộ operation trong Patch Workspace"
          >
            <Trash2 className="w-3 h-3" />
            <span className="hidden 2xl:inline">Xóa WS</span>
          </button>
        )}
      </div>

      {showQuestPanel && (
        <QuestPanel
          session={session}
          onClose={() => setShowQuestPanel(false)}
          onWorkspaceUpdated={onChanged}
        />
      )}
    </>
  );
}
