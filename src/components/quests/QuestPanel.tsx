import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Coins,
  Gem,
  Gift,
  Loader2,
  Package,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { LoadedJarSession } from '../../types/jar';
import {
  analyzeQuests,
  QuestAnalysisSnapshot,
  QuestCellEdit,
  QuestRewardOverride,
  getOriginalQuestReward,
  QUEST_MAIN_CLASS,
  QUEST_STEP_CLASS,
} from '../../services/questDataService';
import {
  getQuestWorkspaceOperation,
  setQuestWorkspaceOperation,
} from '../../services/patchWorkspaceStateService';
import { SmallImagePreview } from '../game-data/SmallImagePreview';

interface QuestPanelProps {
  session: LoadedJarSession;
  onClose: () => void;
  onWorkspaceUpdated: () => void;
}

interface StepFieldDef {
  index: number;
  label: string;
  help: string;
  multiline?: boolean;
}

const STEP_FIELDS: StepFieldDef[] = [
  { index: 1, label: 'Nội dung bước', help: 'Dòng mục tiêu người chơi nhìn thấy ở bước này.', multiline: true },
  { index: 2, label: 'Số lượng cần đạt', help: 'max_count — số lần/số lượng cần hoàn thành. Giữ số nguyên nếu logic bước dùng bộ đếm.', multiline: false },
  { index: 3, label: 'Thông báo tiến độ', help: 'notify — text thông báo khi tiến độ thay đổi; có thể để trống.', multiline: true },
  { index: 4, label: 'NPC liên quan', help: 'npc_id — mã NPC của bước. Giá trị âm có thể là sentinel đặc biệt của engine; không đổi nếu chưa chắc.', multiline: false },
  { index: 5, label: 'Map liên quan', help: 'map — mã map/điểm nhiệm vụ. -1 thường có nghĩa là không khóa map.', multiline: false },
  { index: 6, label: 'Mã điều kiện / hành động', help: 'ducvupro — field kỹ thuật của source nhiệm vụ. Panel giữ raw value để không đoán sai ý nghĩa.', multiline: false },
];

function normalize(text: string): string {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function nextQuestHint(questId: number): string {
  if (questId === 3) return 'Sau #3: Trái Đất → #4 · Namek → #5 · Xayda → #6';
  if (questId >= 4 && questId <= 6) return `Sau #${questId} → #7`;
  if (questId >= 0 && questId < 31) return `Sau #${questId} → #${questId + 1}`;
  return 'Đây là cuối chuỗi nhiệm vụ chuẩn.';
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? Math.round(value).toLocaleString('vi-VN') : '0';
}

function cloneRows(snapshot: QuestAnalysisSnapshot) {
  return {
    main: snapshot.mainTable.rows.map((row) => [...row.values]),
    steps: snapshot.stepTable.rows.map((row) => [...row.values]),
  };
}

function applyQueuedEdits(
  rows: ReturnType<typeof cloneRows>,
  edits: Array<{ sourceClass: string; rowIndex: number; columnIndex: number; value: string }>
) {
  for (const edit of edits) {
    const target = edit.sourceClass === QUEST_MAIN_CLASS ? rows.main : edit.sourceClass === QUEST_STEP_CLASS ? rows.steps : null;
    if (!target?.[edit.rowIndex]) continue;
    target[edit.rowIndex][edit.columnIndex] = edit.value;
  }
  return rows;
}

export function QuestPanel({ session, onClose, onWorkspaceUpdated }: QuestPanelProps) {
  const [analysis, setAnalysis] = useState<QuestAnalysisSnapshot | null>(null);
  const [mainRows, setMainRows] = useState<string[][]>([]);
  const [stepRows, setStepRows] = useState<string[][]>([]);
  const [selectedId, setSelectedId] = useState('0');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [rewardOverrides, setRewardOverrides] = useState<QuestRewardOverride[]>([]);
  const [rewardItemQuery, setRewardItemQuery] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void analyzeQuests(session)
      .then((snapshot) => {
        if (!active) return;
        const queued = getQuestWorkspaceOperation(session);
        const rows = applyQueuedEdits(cloneRows(snapshot), queued?.edits ?? []);
        setAnalysis(snapshot);
        setMainRows(rows.main);
        setStepRows(rows.steps);
        setRewardOverrides((queued?.rewards ?? []).map((reward) => ({ ...reward })));
        setSelectedId(rows.main[0]?.[0] ?? '0');
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [session]);

  const questList = useMemo(() => {
    if (!analysis) return [];
    const q = normalize(query);
    return analysis.quests.filter((quest) => {
      if (!q) return true;
      const row = mainRows[quest.rowIndex] ?? [];
      return normalize(`${row[0] ?? quest.id} ${row[1] ?? quest.name} ${row[2] ?? quest.detail}`).includes(q);
    });
  }, [analysis, mainRows, query]);

  const selectedQuest = useMemo(() => {
    if (!analysis) return null;
    return analysis.quests.find((quest) => quest.id === selectedId) ?? analysis.quests[0] ?? null;
  }, [analysis, selectedId]);

  const selectedMainRow = selectedQuest ? mainRows[selectedQuest.rowIndex] ?? [] : [];
  const selectedSteps = useMemo(() => {
    if (!selectedQuest) return [];
    return selectedQuest.steps.map((step) => ({
      rowIndex: step.rowIndex,
      values: stepRows[step.rowIndex] ?? step.values,
    }));
  }, [selectedQuest, stepRows]);

  const selectedQuestIdNumber = Number(selectedQuest?.id ?? -1);
  const originalReward = getOriginalQuestReward(selectedQuestIdNumber);
  const selectedReward = useMemo<QuestRewardOverride>(() => {
    const existing = rewardOverrides.find((reward) => reward.questId === selectedQuestIdNumber);
    return existing ?? {
      questId: selectedQuestIdNumber,
      enabled: false,
      ...originalReward,
    };
  }, [rewardOverrides, selectedQuestIdNumber, originalReward.gold, originalReward.power, originalReward.potential]);

  const activeRewardCount = useMemo(
    () => rewardOverrides.filter((reward) => reward.enabled).length,
    [rewardOverrides]
  );

  const itemResults = useMemo(() => {
    const q = normalize(rewardItemQuery);
    if (!q) return [];
    const items = session.itemAnalysis?.items ?? [];
    return items.filter((item) =>
      normalize(`${item.id} ${item.name}`).includes(q)
    ).slice(0, 10);
  }, [rewardItemQuery, session.itemAnalysis]);

  const selectedRewardItem = useMemo(() => {
    if (selectedReward.itemId == null) return null;
    return (session.itemAnalysis?.items ?? []).find((item) => Number(item.id) === selectedReward.itemId) ?? null;
  }, [selectedReward.itemId, session.itemAnalysis]);

  const updateReward = (patch: Partial<QuestRewardOverride>) => {
    if (!selectedQuest || selectedQuest.runtimeOverride || selectedQuestIdNumber < 0) return;
    setSaved(false);
    setRewardOverrides((current) => {
      const base: QuestRewardOverride = current.find((reward) => reward.questId === selectedQuestIdNumber) ?? {
        questId: selectedQuestIdNumber,
        enabled: false,
        ...originalReward,
      };
      const next = { ...base, ...patch, questId: selectedQuestIdNumber };
      return [...current.filter((reward) => reward.questId !== selectedQuestIdNumber), next]
        .sort((a, b) => a.questId - b.questId);
    });
  };

  const rewardFlowWarnings = useMemo(() => {
    const warnings: string[] = [];
    for (const step of selectedSteps) {
      const maxCount = Number(step.values[2]);
      const npcId = Number(step.values[4]);
      const mapId = Number(step.values[5]);
      if (!Number.isInteger(maxCount) || maxCount < 0) warnings.push(`Bước ${step.rowIndex}: max_count "${step.values[2] ?? ''}" không phải số nguyên >= 0.`);
      if (String(step.values[4] ?? '').trim() && !Number.isInteger(npcId)) warnings.push(`Bước ${step.rowIndex}: NPC "${step.values[4]}" không phải ID số.`);
      if (String(step.values[5] ?? '').trim() && !Number.isInteger(mapId)) warnings.push(`Bước ${step.rowIndex}: map "${step.values[5]}" không phải ID số.`);
    }
    if (selectedReward.enabled && selectedReward.itemId != null && !selectedRewardItem) {
      warnings.push(`Reward item #${selectedReward.itemId} không tìm thấy trong ItemTemplate đang phân tích.`);
    }
    return warnings;
  }, [selectedSteps, selectedReward.enabled, selectedReward.itemId, selectedRewardItem]);

  const edits = useMemo<QuestCellEdit[]>(() => {
    if (!analysis) return [];
    const result: QuestCellEdit[] = [];

    for (const quest of analysis.quests) {
      if (quest.runtimeOverride) continue;
      const original = analysis.mainTable.rows[quest.rowIndex]?.values ?? [];
      const current = mainRows[quest.rowIndex] ?? original;
      for (const columnIndex of [1, 2]) {
        if ((current[columnIndex] ?? '') !== (original[columnIndex] ?? '')) {
          result.push({
            sourceClass: QUEST_MAIN_CLASS,
            sourceField: 'u',
            rowIndex: quest.rowIndex,
            columnIndex,
            value: current[columnIndex] ?? '',
          });
        }
      }
    }

    for (const originalRow of analysis.stepTable.rows) {
      const taskId = originalRow.values[0] ?? '';
      if (taskId === '29') continue;
      const current = stepRows[originalRow.rowIndex] ?? originalRow.values;
      for (let columnIndex = 1; columnIndex <= 6; columnIndex++) {
        if ((current[columnIndex] ?? '') !== (originalRow.values[columnIndex] ?? '')) {
          result.push({
            sourceClass: QUEST_STEP_CLASS,
            sourceField: 'u',
            rowIndex: originalRow.rowIndex,
            columnIndex,
            value: current[columnIndex] ?? '',
          });
        }
      }
    }

    return result;
  }, [analysis, mainRows, stepRows]);

  const setMainCell = (columnIndex: number, value: string) => {
    if (!selectedQuest || selectedQuest.runtimeOverride) return;
    setSaved(false);
    setMainRows((current) => current.map((row, index) =>
      index === selectedQuest.rowIndex
        ? row.map((cell, column) => column === columnIndex ? value : cell)
        : row
    ));
  };

  const setStepCell = (rowIndex: number, columnIndex: number, value: string) => {
    if (selectedQuest?.runtimeOverride) return;
    setSaved(false);
    setStepRows((current) => current.map((row, index) =>
      index === rowIndex
        ? row.map((cell, column) => column === columnIndex ? value : cell)
        : row
    ));
  };

  const saveWorkspace = () => {
    setQuestWorkspaceOperation(session, edits, rewardOverrides);
    setSaved(true);
    setError(null);
    onWorkspaceUpdated();
  };

  const resetAll = () => {
    if (!analysis) return;
    const rows = cloneRows(analysis);
    setMainRows(rows.main);
    setStepRows(rows.steps);
    setRewardOverrides([]);
    setQuestWorkspaceOperation(session, [], []);
    setSaved(false);
    onWorkspaceUpdated();
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/45 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className="w-full max-w-[1500px] h-[94vh] rounded-2xl bg-white border border-zinc-200 shadow-2xl overflow-hidden flex flex-col">
        <header className="shrink-0 px-4 py-3 border-b border-zinc-200 bg-zinc-50 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center shrink-0">
              <ClipboardList className="w-4 h-4 text-indigo-600" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-zinc-900">Panel Nhiệm vụ</div>
              <div className="text-[10px] text-zinc-500 truncate">
                Đọc trực tiếp a/a/a/Z.u (nhiệm vụ chính) + a/a/a/ab.u (các bước). Lưu vào Patch Workspace để Test/Export chung.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {analysis && (
              <div className="hidden lg:flex items-center gap-1.5 text-[9px] font-mono text-zinc-500">
                <span className="px-2 py-1 rounded-lg border border-zinc-200 bg-white">{analysis.diagnostics.mainRows} nhiệm vụ</span>
                <span className="px-2 py-1 rounded-lg border border-zinc-200 bg-white">{analysis.diagnostics.stepRows} bước</span>
                <span className="px-2 py-1 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700">{edits.length} cell</span>
                <span className="px-2 py-1 rounded-lg border border-amber-200 bg-amber-50 text-amber-700">{activeRewardCount} reward</span>
              </div>
            )}
            <button type="button" onClick={onClose} className="w-8 h-8 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-100 flex items-center justify-center cursor-pointer">
              <X className="w-4 h-4 text-zinc-500" />
            </button>
          </div>
        </header>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-sm text-zinc-500 gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
            Đang đọc bảng nhiệm vụ từ JAR…
          </div>
        ) : error ? (
          <div className="flex-1 p-6">
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
          </div>
        ) : analysis && selectedQuest ? (
          <div className="min-h-0 flex-1 grid grid-cols-[300px_minmax(0,1fr)]">
            <aside className="min-h-0 border-r border-zinc-200 bg-zinc-50 flex flex-col">
              <div className="p-3 border-b border-zinc-200">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Tìm ID / tên / nội dung…"
                    className="w-full pl-8 pr-3 py-2 rounded-xl border border-zinc-200 bg-white text-[11px] focus:outline-none focus:border-indigo-300"
                  />
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-2 space-y-1.5">
                {questList.map((quest) => {
                  const row = mainRows[quest.rowIndex] ?? [];
                  const selected = quest.id === selectedQuest.id;
                  return (
                    <button
                      key={`${quest.id}-${quest.rowIndex}`}
                      type="button"
                      onClick={() => setSelectedId(quest.id)}
                      className={`w-full text-left rounded-xl border px-3 py-2.5 cursor-pointer ${
                        selected
                          ? 'bg-indigo-50 border-indigo-300'
                          : 'bg-white border-zinc-200 hover:border-indigo-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[11px] font-semibold text-zinc-900 truncate">{row[1] || `(Nhiệm vụ #${quest.id})`}</div>
                        <span className="text-[9px] font-mono text-zinc-500 shrink-0">#{quest.id}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[9px] text-zinc-500">
                        <span>{quest.steps.length} bước</span>
                        {quest.runtimeOverride && <span className="text-amber-700">· runtime override</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>

            <main className="min-h-0 overflow-auto p-4 space-y-4">
              {selectedQuest.runtimeOverride && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] text-amber-800 leading-relaxed flex gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div><strong>Nhiệm vụ #{selectedQuest.id} đang bị runtime override.</strong> {selectedQuest.runtimeOverrideNote} Panel khóa sửa mục này để tránh mày sửa bảng nhưng vào game không đổi.</div>
                </div>
              )}

              <section className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
                <div className="px-3 py-2.5 border-b border-zinc-200 bg-zinc-50 flex items-center justify-between">
                  <div>
                    <div className="text-[12px] font-semibold text-zinc-900">Nhiệm vụ chính #{selectedQuest.id}</div>
                    <div className="text-[9px] text-zinc-500 font-mono">a/a/a/Z.u[{selectedQuest.rowIndex}] · schema: id / NAME / detail</div>
                  </div>
                  {!selectedQuest.runtimeOverride && <span className="text-[9px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-1">writer hỗ trợ</span>}
                </div>
                <div className="p-3 grid grid-cols-1 xl:grid-cols-2 gap-3">
                  <label className="xl:col-span-1">
                    <div className="text-[10px] font-semibold text-zinc-700 mb-1">Tên nhiệm vụ</div>
                    <input
                      disabled={selectedQuest.runtimeOverride}
                      value={selectedMainRow[1] ?? ''}
                      onChange={(event) => setMainCell(1, event.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-zinc-50 text-[11px] disabled:opacity-60 focus:outline-none focus:border-indigo-300"
                    />
                  </label>
                  <div className="xl:col-span-1 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-[10px] text-zinc-600">
                    <div><strong>ID:</strong> {selectedQuest.id} — giữ nguyên để không làm đứt liên kết step/runtime.</div>
                    <div className="mt-1"><strong>Luồng:</strong> {nextQuestHint(selectedQuestIdNumber)}.</div>
                    <div className="mt-1"><strong>Reward:</strong> V33 ghi vào runtime thật; text “Thưởng …” trong mô tả vẫn là text riêng.</div>
                  </div>
                  <label className="xl:col-span-2">
                    <div className="text-[10px] font-semibold text-zinc-700 mb-1">Mô tả / hướng dẫn nhiệm vụ</div>
                    <textarea
                      disabled={selectedQuest.runtimeOverride}
                      value={selectedMainRow[2] ?? ''}
                      onChange={(event) => setMainCell(2, event.target.value)}
                      rows={6}
                      className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-zinc-50 text-[11px] leading-relaxed disabled:opacity-60 focus:outline-none focus:border-indigo-300 resize-y"
                    />
                  </label>
                </div>
              </section>

              <section className="rounded-xl border border-amber-200 bg-white overflow-hidden">
                <div className="px-3 py-2.5 border-b border-amber-200 bg-amber-50 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Gift className="w-4 h-4 text-amber-600" />
                    <div>
                      <div className="text-[12px] font-semibold text-zinc-900">Phần thưởng runtime thật</div>
                      <div className="text-[9px] text-zinc-600">Hook đúng a/a/X.c(H, questId). Khi bật tùy chỉnh, các giá trị dưới đây THAY THẾ reward gốc của quest này.</div>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-[10px] font-semibold text-amber-800">
                    <input
                      type="checkbox"
                      disabled={selectedQuest.runtimeOverride}
                      checked={selectedReward.enabled}
                      onChange={(event) => updateReward({ enabled: event.target.checked })}
                    />
                    Dùng reward tùy chỉnh
                  </label>
                </div>
                <div className="p-3 space-y-3">
                  <div className="grid grid-cols-2 xl:grid-cols-4 gap-2 text-[10px]">
                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-2.5"><div className="text-zinc-500">Gốc · Sức mạnh</div><div className="font-bold text-zinc-900">{formatNumber(originalReward.power)}</div></div>
                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-2.5"><div className="text-zinc-500">Gốc · Tiềm năng</div><div className="font-bold text-zinc-900">{formatNumber(originalReward.potential)}</div></div>
                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-2.5"><div className="text-zinc-500">Gốc · Vàng</div><div className="font-bold text-zinc-900">{formatNumber(originalReward.gold)}</div></div>
                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-2.5"><div className="text-zinc-500">Gốc · Ngọc</div><div className="font-bold text-zinc-900">0</div></div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                    <label>
                      <div className="text-[10px] font-semibold text-zinc-700 mb-1 flex items-center gap-1"><Sparkles className="w-3 h-3" /> Sức mạnh</div>
                      <input type="number" min="0" step="1" disabled={!selectedReward.enabled || selectedQuest.runtimeOverride} value={selectedReward.power} onChange={(event) => updateReward({ power: Math.max(0, Math.round(Number(event.target.value) || 0)) })} className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-zinc-50 text-[11px] font-mono disabled:opacity-50 focus:outline-none focus:border-amber-300" />
                    </label>
                    <label>
                      <div className="text-[10px] font-semibold text-zinc-700 mb-1 flex items-center gap-1"><Sparkles className="w-3 h-3" /> Tiềm năng</div>
                      <input type="number" min="0" step="1" disabled={!selectedReward.enabled || selectedQuest.runtimeOverride} value={selectedReward.potential} onChange={(event) => updateReward({ potential: Math.max(0, Math.round(Number(event.target.value) || 0)) })} className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-zinc-50 text-[11px] font-mono disabled:opacity-50 focus:outline-none focus:border-amber-300" />
                    </label>
                    <label>
                      <div className="text-[10px] font-semibold text-zinc-700 mb-1 flex items-center gap-1"><Coins className="w-3 h-3" /> Vàng</div>
                      <input type="number" min="0" step="1" disabled={!selectedReward.enabled || selectedQuest.runtimeOverride} value={selectedReward.gold} onChange={(event) => updateReward({ gold: Math.max(0, Math.round(Number(event.target.value) || 0)) })} className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-zinc-50 text-[11px] font-mono disabled:opacity-50 focus:outline-none focus:border-amber-300" />
                    </label>
                    <label>
                      <div className="text-[10px] font-semibold text-zinc-700 mb-1 flex items-center gap-1"><Gem className="w-3 h-3" /> Ngọc xanh</div>
                      <input type="number" min="0" max="2147483647" step="1" disabled={!selectedReward.enabled || selectedQuest.runtimeOverride} value={selectedReward.gems} onChange={(event) => updateReward({ gems: Math.max(0, Math.min(2147483647, Math.round(Number(event.target.value) || 0))) })} className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-zinc-50 text-[11px] font-mono disabled:opacity-50 focus:outline-none focus:border-amber-300" />
                    </label>
                  </div>

                  <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                    <div className="flex items-center gap-2 mb-2"><Package className="w-4 h-4 text-indigo-600" /><div className="text-[10px] font-semibold text-zinc-800">Vật phẩm thưởng (tùy chọn)</div></div>
                    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_140px] gap-2">
                      <div>
                        {selectedRewardItem ? (
                          <div className="rounded-xl border border-indigo-200 bg-white p-2 flex items-center gap-2">
                            <SmallImagePreview session={session} imageId={Number(selectedRewardItem.iconId)} alt={selectedRewardItem.name} variant="icon" />
                            <div className="min-w-0 flex-1"><div className="text-[10px] font-semibold truncate">{selectedRewardItem.name}</div><div className="text-[9px] font-mono text-zinc-500">Item #{selectedRewardItem.id}</div></div>
                            <button type="button" disabled={!selectedReward.enabled} onClick={() => updateReward({ itemId: null, itemQuantity: 1 })} className="px-2 py-1 rounded-lg border border-zinc-200 text-[9px] text-red-600 disabled:opacity-50">Bỏ</button>
                          </div>
                        ) : (
                          <input disabled={!selectedReward.enabled || selectedQuest.runtimeOverride} value={rewardItemQuery} onChange={(event) => setRewardItemQuery(event.target.value)} placeholder="Tìm tên item hoặc ID để thưởng…" className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-[11px] disabled:opacity-50 focus:outline-none focus:border-indigo-300" />
                        )}
                        {selectedReward.enabled && !selectedRewardItem && itemResults.length > 0 && (
                          <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-36 overflow-auto">
                            {itemResults.map((item) => (
                              <button key={`${item.sourceClass}-${item.id}`} type="button" onClick={() => { updateReward({ itemId: Number(item.id), itemQuantity: Math.max(1, selectedReward.itemQuantity || 1) }); setRewardItemQuery(''); }} className="rounded-lg border border-zinc-200 bg-white hover:border-indigo-300 px-2 py-1.5 text-left">
                                <div className="text-[9px] font-semibold truncate">{item.name}</div><div className="text-[8px] font-mono text-zinc-500">#{item.id}</div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <label>
                        <div className="text-[9px] text-zinc-500 mb-1">Số lượng item</div>
                        <input type="number" min="1" max="2147483647" disabled={!selectedReward.enabled || selectedReward.itemId == null} value={selectedReward.itemQuantity} onChange={(event) => updateReward({ itemQuantity: Math.max(1, Math.min(2147483647, Math.round(Number(event.target.value) || 1))) })} className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-[11px] font-mono disabled:opacity-50" />
                      </label>
                    </div>
                    <div className="mt-2 text-[9px] text-zinc-500">Nếu hành trang đầy, writer dùng đúng logic quest gốc: item thưởng rơi xuống đất tại vị trí nhân vật.</div>
                  </div>
                </div>
              </section>

              <section className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
                <div className="px-3 py-2.5 border-b border-zinc-200 bg-zinc-50">
                  <div className="text-[12px] font-semibold text-zinc-900">Các bước nhiệm vụ</div>
                  <div className="text-[9px] text-zinc-500">{selectedSteps.length} step khớp task_main_id = {selectedQuest.id}. Có thể chỉnh mục tiêu, số lượng, NPC và map.</div>
                </div>
                <div className="p-3 space-y-3">
                  {selectedSteps.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-6 text-center text-[11px] text-zinc-500">Không tìm thấy step trong a/a/a/ab.u cho nhiệm vụ này.</div>
                  ) : selectedSteps.map((step, order) => (
                    <div key={step.rowIndex} className="rounded-xl border border-zinc-200 overflow-hidden">
                      <div className="px-3 py-2 bg-zinc-50 border-b border-zinc-200 flex items-center justify-between gap-2">
                        <div className="text-[10px] font-semibold text-zinc-800">Bước {order + 1}</div>
                        <div className="text-[9px] font-mono text-zinc-500">ab.u[{step.rowIndex}] · task_main_id {step.values[0] ?? '?'}</div>
                      </div>
                      <div className="p-3 grid grid-cols-1 xl:grid-cols-3 gap-3">
                        {STEP_FIELDS.map((field) => (
                          <label key={field.index} className={field.multiline ? 'xl:col-span-3' : ''}>
                            <div className="text-[10px] font-semibold text-zinc-700 mb-1">{field.label}</div>
                            {field.multiline ? (
                              <textarea
                                disabled={selectedQuest.runtimeOverride}
                                value={step.values[field.index] ?? ''}
                                onChange={(event) => setStepCell(step.rowIndex, field.index, event.target.value)}
                                rows={field.index === 1 ? 3 : 2}
                                className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-zinc-50 text-[11px] disabled:opacity-60 focus:outline-none focus:border-indigo-300 resize-y"
                              />
                            ) : (
                              <input
                                disabled={selectedQuest.runtimeOverride}
                                value={step.values[field.index] ?? ''}
                                onChange={(event) => setStepCell(step.rowIndex, field.index, event.target.value)}
                                className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-zinc-50 text-[11px] font-mono disabled:opacity-60 focus:outline-none focus:border-indigo-300"
                              />
                            )}
                            <div className="mt-1 text-[9px] text-zinc-500 leading-relaxed">{field.help}</div>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <div className={`rounded-xl border p-3 text-[10px] leading-relaxed ${rewardFlowWarnings.length ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
                <div className="font-semibold mb-1">Kiểm tra luồng nhiệm vụ</div>
                {rewardFlowWarnings.length ? rewardFlowWarnings.map((warning) => <div key={warning}>• {warning}</div>) : <div>Không thấy lỗi format ở max_count / NPC / map / reward item của nhiệm vụ đang chọn.</div>}
                <div className="mt-1">{nextQuestHint(selectedQuestIdNumber)}. V33 chỉ hiển thị chain gốc; chưa đổi quy tắc chuyển quest.</div>
              </div>

              <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-[10px] text-indigo-800 leading-relaxed">
                <strong>Đã xác minh trên JAR v1.9.6f:</strong> bảng nhiệm vụ chính nằm ở <code>a/a/a/Z.u</code> (3 cột) và 125 step nằm ở <code>a/a/a/ab.u</code> (7 cột). V33 giữ writer cell của V32 và thêm reward runtime: vàng=bS/l, sức mạnh=bT/a, tiềm năng=bU/i, ngọc=xv/U; item thưởng dùng cùng logic inventory của quest gốc.
              </div>
            </main>
          </div>
        ) : null}

        <footer className="shrink-0 px-4 py-3 border-t border-zinc-200 bg-zinc-50 flex items-center justify-between gap-3">
          <div className="min-w-0 text-[10px] text-zinc-500">
            {saved ? (
              <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" /> Đã lưu {edits.length} cell + {activeRewardCount} reward vào Patch Workspace.</span>
            ) : edits.length > 0 || activeRewardCount > 0 ? (
              <span>{edits.length} cell + {activeRewardCount} reward chưa lưu.</span>
            ) : (
              <span>Chưa có thay đổi nhiệm vụ.</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={resetAll} disabled={!analysis} className="px-3 py-2 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-100 text-[10px] font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
              <RotateCcw className="w-3.5 h-3.5" /> Trả về gốc
            </button>
            <button type="button" onClick={saveWorkspace} disabled={!analysis || (edits.length === 0 && activeRewardCount === 0)} className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
              <Save className="w-3.5 h-3.5" /> Lưu vào Workspace
            </button>
            <button type="button" onClick={onClose} className="px-3 py-2 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-100 text-[10px] font-medium cursor-pointer">Đóng</button>
          </div>
        </footer>
      </div>
    </div>
  );
}
