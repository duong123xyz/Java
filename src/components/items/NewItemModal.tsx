import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CopyPlus,
  Loader2,
  PackagePlus,
  X,
} from 'lucide-react';
import { CandidateOutputJar, LoadedJarSession } from '../../types/jar';
import {
  ItemAnalysisSessionData,
  ItemRecord,
} from '../../types/item';
import { SmallImagePreview } from '../game-data/SmallImagePreview';
import { NpcBodyPreview } from '../game-data/NpcBodyPreview';
import { ITEM_CREATE_SCHEMA } from '../../services/itemCreationService';
import {
  getQueuedNewItemIds,
  isNewItemIdQueued,
  queueNewItemOperation,
} from '../../services/patchWorkspaceStateService';
import { buildUnifiedWorkspaceCandidate } from '../../services/unifiedCandidateService';

interface NewItemModalProps {
  session: LoadedJarSession;
  analysisData: ItemAnalysisSessionData;
  selectedItem: ItemRecord | null;
  onClose: () => void;
  onBuilt: (candidate: CandidateOutputJar) => void;
  onWorkspaceUpdated?: () => void;
}

const LABELS = [
  'Item ID',
  'Type',
  'Gender',
  'Tên',
  'Mô tả',
  'Level',
  'Icon ID',
  'Part',
  'Is up to up',
  'Power require',
  'Gold',
  'Gem',
  'Head',
  'Body',
  'Leg',
] as const;

function nextGlobalItemId(
  analysisData: ItemAnalysisSessionData,
  session: LoadedJarSession
): string {
  const ids = [
    ...analysisData.items.map((item) => Number(item.id)),
    ...getQueuedNewItemIds(session).map((id) => Number(id)),
  ].filter((value) => Number.isInteger(value) && value >= 0);

  return String((ids.length ? Math.max(...ids) : -1) + 1);
}

function defaultValues(
  analysisData: ItemAnalysisSessionData,
  selectedItem: ItemRecord | null,
  session: LoadedJarSession
): string[] {
  const values = selectedItem
    ? [...selectedItem.rawValues]
    : new Array(ITEM_CREATE_SCHEMA.length).fill('');

  while (values.length < ITEM_CREATE_SCHEMA.length) values.push('');
  values.length = ITEM_CREATE_SCHEMA.length;

  values[0] = nextGlobalItemId(analysisData, session);

  if (selectedItem) {
    values[3] = `${selectedItem.name || 'Item'} mới`;
  } else {
    values[1] = '5';
    values[2] = '3';
    values[3] = 'Item mới';
    values[4] = '';
    values[5] = '0';
    values[6] = '0';
    values[7] = '-1';
    values[8] = '0';
    values[9] = '0';
    values[10] = '0';
    values[11] = '0';
    values[12] = '-1';
    values[13] = '-1';
    values[14] = '-1';
  }

  return values;
}

export function NewItemModal({
  session,
  analysisData,
  selectedItem,
  onClose,
  onBuilt,
  onWorkspaceUpdated,
}: NewItemModalProps) {
  const [sourceClass, setSourceClass] = useState(
    selectedItem?.sourceClass ??
      analysisData.sourceFilters[0]?.ownerInternalName ??
      'a/a/a/i'
  );
  const [values, setValues] = useState<string[]>(() =>
    defaultValues(analysisData, selectedItem, session)
  );
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceInfo = useMemo(
    () =>
      analysisData.sourceFilters.find(
        (filter) => filter.ownerInternalName === sourceClass
      ) ?? null,
    [analysisData.sourceFilters, sourceClass]
  );

  const duplicateId = useMemo(
    () =>
      analysisData.items.some((item) => item.id === values[0]) ||
      isNewItemIdQueued(session, values[0]),
    [analysisData.items, session, values]
  );

  const iconId = Number(values[6]);
  const head = Number(values[12]);
  const body = Number(values[13]);
  const leg = Number(values[14]);
  const hasBody =
    Number.isInteger(head) &&
    head >= 0 &&
    Number.isInteger(body) &&
    body >= 0 &&
    Number.isInteger(leg) &&
    leg >= 0;

  const update = (index: number, value: string) => {
    setValues((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? value : item
      )
    );
  };

  const build = async () => {
    setError(null);
    setBuilding(true);
    try {
      const operation = queueNewItemOperation(session, {
        sourceClass,
        values,
      });
      onWorkspaceUpdated?.();

      const result = await buildUnifiedWorkspaceCandidate(session);
      if (result.status !== 'VALIDATED' || !result.candidate) {
        const detail = result.blockers.length
          ? result.blockers.map((blocker) => `${blocker.area}: ${blocker.message}`).join('\n')
          : result.errorMessage || `Unified Workspace trả trạng thái ${result.status}.`;
        throw new Error(`${detail}\n\nItem mới vẫn được giữ trong Patch Workspace; có thể bỏ bằng nút × trên thanh Workspace.`);
      }

      session.candidateOutput = result.candidate;
      onBuilt(result.candidate);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm flex items-center justify-center p-3">
      <div className="w-full max-w-6xl max-h-[94vh] rounded-2xl border border-zinc-200 bg-white shadow-2xl overflow-hidden flex flex-col">
        <div className="shrink-0 px-4 py-3 border-b border-zinc-200 bg-zinc-50 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center">
              <PackagePlus className="w-4 h-4 text-amber-600" />
            </div>
            <div>
              <div className="text-sm font-bold text-zinc-900">
                Tạo Item Template mới
              </div>
              <div className="text-[10px] text-zinc-500">
                Item mới được đưa vào Patch Workspace rồi dựng chung với mọi nháp / Multiplayer hiện có.
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-100 flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4 text-zinc-500" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_330px] gap-4">
            <div className="space-y-3">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_220px] gap-3">
                  <label>
                    <div className="text-[10px] text-zinc-500 font-mono mb-1">
                      Bảng nguồn
                    </div>
                    <select
                      value={sourceClass}
                      onChange={(event) =>
                        setSourceClass(event.target.value)
                      }
                      className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-[11px] font-mono focus:outline-none focus:border-amber-300"
                    >
                      {analysisData.sourceFilters.map((filter) => (
                        <option
                          key={filter.ownerInternalName}
                          value={filter.ownerInternalName}
                        >
                          {filter.ownerInternalName}.u — {filter.count} row
                        </option>
                      ))}
                    </select>
                  </label>

                  <div>
                    <div className="text-[10px] text-zinc-500 font-mono mb-1">
                      Row mới
                    </div>
                    <div className="px-3 py-2 rounded-xl border border-zinc-200 bg-white text-[11px] font-mono text-zinc-700">
                      {sourceInfo
                        ? `${sourceInfo.count} → ${sourceInfo.count + 1}`
                        : '—'}
                    </div>
                  </div>
                </div>

                <div className="mt-2 text-[10px] text-zinc-500">
                  {selectedItem ? (
                    <>
                      Đang clone từ <strong>{selectedItem.name}</strong> · item #{selectedItem.id}.
                      Các field có thể sửa tự do trước khi build.
                    </>
                  ) : (
                    'Tạo row trống theo schema 15 cột.'
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
                <div className="px-3 py-2.5 border-b border-zinc-200 bg-zinc-50 flex items-center gap-2">
                  <CopyPlus className="w-3.5 h-3.5 text-amber-600" />
                  <div>
                    <div className="text-[12px] font-semibold text-zinc-900">
                      15 field Item Template
                    </div>
                    <div className="text-[9px] text-zinc-500">
                      Schema đọc trực tiếp từ a/a/a/h.aF
                    </div>
                  </div>
                </div>

                <div className="p-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {ITEM_CREATE_SCHEMA.map((field, index) => (
                    <label
                      key={field}
                      className={
                        index === 3 || index === 4
                          ? 'sm:col-span-2 xl:col-span-3'
                          : ''
                      }
                    >
                      <div className="flex items-center justify-between gap-2 text-[9px] font-mono mb-1">
                        <span className="text-zinc-500">
                          {LABELS[index]}
                        </span>
                        <span className="text-zinc-400">
                          {field}
                        </span>
                      </div>

                      {index === 4 ? (
                        <textarea
                          value={values[index] ?? ''}
                          onChange={(event) =>
                            update(index, event.target.value)
                          }
                          rows={3}
                          className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-zinc-50 text-[11px] text-zinc-900 focus:outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-100 resize-y"
                        />
                      ) : (
                        <input
                          value={values[index] ?? ''}
                          onChange={(event) =>
                            update(index, event.target.value)
                          }
                          className={`w-full px-3 py-2 rounded-xl border bg-zinc-50 text-[11px] text-zinc-900 focus:outline-none focus:ring-2 ${
                            index === 0 && duplicateId
                              ? 'border-red-300 focus:border-red-400 focus:ring-red-100'
                              : 'border-zinc-200 focus:border-amber-300 focus:ring-amber-100'
                          }`}
                        />
                      )}

                      {index === 0 && duplicateId && (
                        <div className="mt-1 text-[9px] text-red-600">
                          ID này đã tồn tại.
                        </div>
                      )}
                    </label>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] text-amber-800 leading-relaxed">
                <AlertTriangle className="w-3.5 h-3.5 inline mr-1.5 align-[-2px]" />
                Writer vẫn <strong>thêm đúng 1 row</strong> vào bảng nguồn đã chọn, nhưng không còn build từ JAR gốc riêng lẻ.
                Operation được hợp nhất với toàn bộ thay đổi hiện tại. Item vẫn chưa tự vào shop/drop/quest;
                phần Shop/Drop sẽ tham chiếu Item ID này ở các panel content tiếp theo.
              </div>

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-[10px] text-red-700 font-mono whitespace-pre-wrap">
                  {error}
                </div>
              )}
            </div>

            <aside className="space-y-3">
              <div className="rounded-xl border border-zinc-200 bg-white p-3">
                <div className="text-[11px] font-semibold text-zinc-800 mb-2">
                  Preview icon
                </div>
                <SmallImagePreview
                  session={session}
                  imageId={Number.isInteger(iconId) ? iconId : -1}
                  alt={values[3] || 'Item mới'}
                  variant="hero"
                  showTechnicalInfo
                />
              </div>

              <div className="rounded-xl border border-zinc-200 bg-white p-3">
                <div className="text-[11px] font-semibold text-zinc-800 mb-2">
                  Preview ngoại hình
                </div>

                {hasBody ? (
                  <NpcBodyPreview
                    session={session}
                    head={head}
                    body={body}
                    leg={leg}
                    alt={values[3] || 'Ngoại hình item'}
                    showTechnicalInfo
                  />
                ) : (
                  <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-5 text-center text-[10px] text-zinc-500">
                    Nhập Head / Body / Leg hợp lệ để ghép preview.
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[10px] text-emerald-700">
                <CheckCircle2 className="w-3.5 h-3.5 inline mr-1.5 align-[-2px]" />
                Builder sẽ mở lại JAR sau khi đóng ZIP và kiểm tra row count trước khi đánh dấu VALIDATED.
              </div>
            </aside>
          </div>
        </div>

        <div className="shrink-0 px-4 py-3 border-t border-zinc-200 bg-zinc-50 flex items-center justify-between gap-3">
          <div className="text-[10px] text-zinc-500 font-mono">
            {sourceClass}.u · item #{values[0] || '?'}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-100 text-[11px] font-medium cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={() => void build()}
              disabled={building || duplicateId}
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 text-[11px] font-bold flex items-center gap-2 cursor-pointer"
            >
              {building ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <PackagePlus className="w-4 h-4" />
              )}
              {building
                ? 'Đang hợp nhất & verify...'
                : 'Thêm vào Workspace & dựng JAR'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
