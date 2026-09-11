import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileCode,
  Plus,
  RotateCcw,
  Search,
  Shield,
  Sliders,
  Sparkles,
  Table,
  Trash2,
  Zap,
} from 'lucide-react';
import {
  ItemDraft,
  ItemOptionOverride,
  ItemOptionTemplateRecord,
  ItemRecord,
} from '../../types/item';
import { LoadedJarSession } from '../../types/jar';
import {
  findDuplicateIds,
  ITEM_SCHEMA_FIELDS,
  setItemOptionOverrides,
  validateFieldValue,
} from '../../services/itemDraftService';
import {
  AutoTrainingItemDraft,
  getAutoTrainingItemDraft,
  resetAutoTrainingItemDraft,
  setAutoTrainingItemDraft,
} from '../../services/advancedMechanicsService';
import { parseClassFile } from '../../services/classFileParser';
import { reconstructStringArrayTable } from '../../services/stringArrayTableAnalyzer';
import { SmallImagePreview } from '../game-data/SmallImagePreview';
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

type SubTab = 'stats' | 'template' | 'diff' | 'patch';
type OptionCacheSession = LoadedJarSession & { __itemOptionTemplates?: ItemOptionTemplateRecord[] };

const IMPORTANT_OPTION_IDS = [0, 6, 7, 14, 47, 48, 49, 50];
const JAVA_INT_MIN = -2147483648;
const JAVA_INT_MAX = 2147483647;
const STAT_WORDS = [
  'hp', 'ki', 'suc danh', 'sat thuong', 'damage', 'giap', 'chi mang', 'hut hp', 'hut ki',
  'phan sat thuong', 'xuyen giap', 'ne', 'toc do', 'the luc', 'tiem nang', 'suc manh',
  'tan cong', 'phong thu', 'hoiphuc', 'hoi phuc', 'mana', 'crit', 'armor', 'attack',
];

function normalizeSearch(text: string): string {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function renderOptionPreview(name: string, param: number): string {
  if (!name) return `Option #${param}`;
  return name.includes('#') ? name.replace(/#/g, String(param)) : `${name} · ${param}`;
}

function isStatOption(option: ItemOptionTemplateRecord): boolean {
  const n = normalizeSearch(option.name);
  return STAT_WORDS.some((word) => n.includes(word));
}

async function analyzeOptionTemplates(session: LoadedJarSession): Promise<ItemOptionTemplateRecord[]> {
  const cached = (session as OptionCacheSession).__itemOptionTemplates;
  if (cached?.length) return cached;
  const entry = session.entries.find((candidate) => candidate.path === 'a/a/a/v.class')?.zipEntry
    ?? session.zip.file('a/a/a/v.class');
  if (!entry) throw new Error('Không tìm thấy a/a/a/v.class (bảng ItemOptionTemplate).');
  const parsed = parseClassFile(await entry.async('arraybuffer'));
  if (parsed.status !== 'valid' || parsed.remainingBytes !== 0) throw new Error('a/a/a/v.class không parse VALID.');
  const clinit = parsed.methods.find((method) => method.name === '<clinit>');
  if (!clinit?.code?.instructions) throw new Error('a/a/a/v.<clinit> không có instructions.');
  const table = reconstructStringArrayTable('a/a/a/v', 'u', '[[Ljava/lang/String;', 0, clinit.code.instructions, parsed.constantPool, 2);
  if (table.parseError) throw new Error(`Không đọc được bảng option: ${table.parseError}`);
  const rows = table.rows
    .map((row) => ({ id: Number(row.values[0]), name: String(row.values[1] || ''), sourceRow: row.rowIndex }))
    .filter((row) => Number.isInteger(row.id) && row.id >= 0 && row.id <= 32767)
    .map((row) => ({ ...row, name: row.name || `Option #${row.id}` }))
    .sort((a, b) => a.id - b.id) as ItemOptionTemplateRecord[];
  (session as OptionCacheSession).__itemOptionTemplates = rows;
  return rows;
}

export function ItemEditorForm({ session, item, allItems, draft, drafts, onUpdateField, onResetField, onResetItem }: ItemEditorFormProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('stats');
  const [optionTemplates, setOptionTemplates] = useState<ItemOptionTemplateRecord[]>([]);
  const [optionError, setOptionError] = useState<string | null>(null);
  const [optionQuery, setOptionQuery] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [autoTraining, setAutoTraining] = useState<AutoTrainingItemDraft>(() => getAutoTrainingItemDraft(session));

  useEffect(() => {
    let active = true;
    setOptionError(null);
    void analyzeOptionTemplates(session)
      .then((rows) => active && setOptionTemplates(rows))
      .catch((error: unknown) => active && setOptionError(error instanceof Error ? error.message : String(error)));
    setAutoTraining(getAutoTrainingItemDraft(session));
    return () => { active = false; };
  }, [session, item.sourceClass, item.sourceRow]);

  const currentDraftId = draft.values[0] ?? '';
  const isAutoTrainingItem = currentDraftId === '521' || String(item.id) === '521';
  const duplicateLocations = useMemo(
    () => findDuplicateIds(currentDraftId, draft.key, allItems, drafts),
    [currentDraftId, draft.key, allItems, drafts, draft.values]
  );
  const overrides = draft.optionOverrides ?? [];
  const optionById = useMemo(() => new Map(optionTemplates.map((option) => [option.id, option])), [optionTemplates]);
  const statOptions = useMemo(() => optionTemplates.filter(isStatOption), [optionTemplates]);

  const notifyOptionChange = (next: ItemOptionOverride[]) => {
    setItemOptionOverrides(drafts, item, next);
    onUpdateField(0, draft.values[0] ?? item.id);
  };
  const addOption = (optionId: number, param = 1) => {
    if (overrides.some((entry) => entry.optionId === optionId)) return;
    notifyOptionChange([...overrides, { optionId, param, enabled: true, note: '' }]);
    setOptionQuery('');
    setShowPicker(false);
  };
  const updateOption = (optionId: number, patch: Partial<ItemOptionOverride>) => {
    const exists = overrides.some((entry) => entry.optionId === optionId);
    if (!exists) {
      addOption(optionId, typeof patch.param === 'number' ? patch.param : 1);
      return;
    }
    notifyOptionChange(overrides.map((entry) => entry.optionId === optionId ? { ...entry, ...patch } : entry));
  };
  const removeOption = (optionId: number) => notifyOptionChange(overrides.filter((entry) => entry.optionId !== optionId));

  const patchAutoTraining = (patch: Partial<AutoTrainingItemDraft>) => {
    const next = setAutoTrainingItemDraft(session, patch);
    setAutoTraining(next);
    // Bump ItemsBrowser revision; runtime draft itself nằm trong advanced writer.
    onUpdateField(0, draft.values[0] ?? item.id);
  };

  const pickerResults = useMemo(() => {
    const q = normalizeSearch(optionQuery);
    const existing = new Set(overrides.map((entry) => entry.optionId));
    const list = optionTemplates.filter((option) => !existing.has(option.id));
    if (!q) {
      const important = IMPORTANT_OPTION_IDS.map((id) => list.find((entry) => entry.id === id)).filter((entry): entry is ItemOptionTemplateRecord => Boolean(entry));
      const rest = list.filter((entry) => !IMPORTANT_OPTION_IDS.includes(entry.id));
      return [...important, ...rest].slice(0, 80);
    }
    return list.filter((option) => String(option.id).includes(q) || normalizeSearch(option.name).includes(q)).slice(0, 100);
  }, [optionTemplates, optionQuery, overrides]);

  const changedFields = useMemo(() => draft.dirtyFields.map((colIndex) => ({
    colIndex,
    label: ITEM_SCHEMA_FIELDS[colIndex]?.label ?? `Cột ${colIndex}`,
    original: draft.originalValues[colIndex] ?? '',
    current: draft.values[colIndex] ?? '',
  })), [draft.dirtyFields, draft.originalValues, draft.values]);

  const renderField = (colIndex: number) => {
    const meta = ITEM_SCHEMA_FIELDS[colIndex];
    if (!meta) return null;
    const value = draft.values[colIndex] ?? '';
    const originalValue = draft.originalValues[colIndex] ?? '';
    const dirty = draft.dirtyFields.includes(colIndex);
    const error = validateFieldValue(colIndex, value);
    const isTextArea = meta.key === 'description';
    return (
      <div key={meta.key} className={`rounded-xl border p-3 ${dirty ? 'border-amber-300 bg-amber-50/60' : 'border-zinc-200 bg-white'}`}>
        <div className="mb-1.5 flex items-start justify-between gap-2">
          <div><div className="text-[11px] font-semibold text-zinc-800">{meta.label}</div><div className="text-[9px] font-mono text-zinc-400">#{colIndex} · {meta.key}</div></div>
          {dirty && <button type="button" onClick={() => onResetField(colIndex)} className="text-[10px] text-zinc-500 hover:text-amber-700 flex items-center gap-1 cursor-pointer"><RotateCcw className="w-3 h-3" /> Gốc</button>}
        </div>
        {isTextArea
          ? <textarea rows={2} value={value} onChange={(e) => onUpdateField(colIndex, e.target.value)} className={`w-full rounded-lg border px-3 py-2.5 sm:py-2 text-[16px] sm:text-xs focus:outline-none ${error ? 'border-red-400' : 'border-zinc-300 focus:border-amber-400'}`} />
          : <input value={value} onChange={(e) => onUpdateField(colIndex, e.target.value)} className={`w-full rounded-lg border px-3 py-2.5 sm:py-2 text-[16px] sm:text-xs font-mono focus:outline-none ${error ? 'border-red-400' : 'border-zinc-300 focus:border-amber-400'}`} />}
        <div className="mt-1 text-[9px] leading-relaxed text-zinc-500">{meta.description}</div>
        {error && <div className="mt-1 text-[10px] text-red-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{error}</div>}
        {dirty && <div className="mt-1 text-[9px] text-zinc-400">Gốc: <span className="font-mono">{originalValue}</span></div>}
      </div>
    );
  };

  const generalFields = ITEM_SCHEMA_FIELDS.filter((field) => field.group === 'general');
  const requirementFields = ITEM_SCHEMA_FIELDS.filter((field) => field.group === 'requirements');
  const visualFields = ITEM_SCHEMA_FIELDS.filter((field) => field.group === 'visual');

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <SmallImagePreview session={session} imageId={draft.values[6]} alt={draft.values[3] || item.name} variant="icon" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-bold text-zinc-900 truncate">{draft.values[3] || item.name || '(Chưa có tên)'}</h2>
                <span className="px-2 py-0.5 rounded-full bg-zinc-50 border border-zinc-200 text-[10px] font-mono">ID {draft.values[0] || item.id}</span>
                {draft.isDirty && <span className="px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-[10px] text-amber-700 font-semibold">Có nháp</span>}
              </div>
              <div className="text-[10px] text-zinc-500 mt-1">{item.sourceClass}.u[{item.sourceRow}] · type {draft.values[1]} · icon {draft.values[6]}</div>
            </div>
          </div>
          {draft.isDirty && <button type="button" onClick={onResetItem} className="px-2.5 py-1.5 rounded-lg border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 text-[10px] flex items-center gap-1 cursor-pointer"><RotateCcw className="w-3 h-3" /> Trả item về gốc</button>}
        </div>
        {duplicateLocations.length > 0 && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] text-amber-800">ID {currentDraftId} đang trùng {duplicateLocations.length} item khác.</div>}
        <div className="mt-3 flex items-center gap-1.5 overflow-x-auto border-t border-zinc-100 pt-2">
          <TabButton active={activeSubTab === 'stats'} onClick={() => setActiveSubTab('stats')} icon={<Zap className="w-3.5 h-3.5" />} label={`Chỉ số / Option (${overrides.length})`} />
          <TabButton active={activeSubTab === 'template'} onClick={() => setActiveSubTab('template')} icon={<Sliders className="w-3.5 h-3.5" />} label="Template 15 trường" />
          <TabButton active={activeSubTab === 'diff'} onClick={() => setActiveSubTab('diff')} icon={<Table className="w-3.5 h-3.5" />} label="So sánh" />
          <TabButton active={activeSubTab === 'patch'} onClick={() => setActiveSubTab('patch')} icon={<FileCode className="w-3.5 h-3.5" />} label="Bytecode" />
        </div>
      </div>

      {activeSubTab === 'patch' ? <PatchPlanTab session={session} item={item} draft={draft} /> : activeSubTab === 'diff' ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-3">
          <div className="font-semibold text-sm text-zinc-900">Thay đổi của item</div>
          {changedFields.length === 0 && overrides.length === 0 ? <div className="text-[11px] text-zinc-500">Chưa có thay đổi.</div> : <div className="space-y-2">
            {changedFields.map((change) => <div key={change.colIndex} className="grid grid-cols-1 sm:grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)] gap-2 rounded-lg border border-zinc-200 p-2 text-[10px]"><div className="font-semibold">{change.label}</div><div className="font-mono text-zinc-500 break-all">Gốc: {change.original}</div><div className="font-mono text-amber-700 break-all">Mới: {change.current}</div></div>)}
            {overrides.map((override) => <div key={`opt-${override.optionId}`} className="rounded-lg border border-violet-200 bg-violet-50 p-2 text-[10px] flex items-center justify-between gap-3"><div><strong>{optionById.get(override.optionId)?.name || `Option #${override.optionId}`}</strong> <span className="font-mono text-zinc-500">ID {override.optionId}</span></div><div className="font-mono text-violet-700">SET {override.param}</div></div>)}
          </div>}
        </div>
      ) : activeSubTab === 'template' ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-[10px] text-blue-800"><strong>Phân biệt:</strong> 15 trường này là ItemTemplate metadata. HP, KI, Sức đánh, Giáp, Chí mạng... nằm trong ItemOption ở tab <strong>Chỉ số / Option</strong>.</div>
          <FieldSection title="Thông tin cơ bản" fields={generalFields.map((f) => renderField(f.index))} />
          <FieldSection title="Yêu cầu & kinh tế" fields={requirementFields.map((f) => renderField(f.index))} />
          <FieldSection title="Hiển thị & ngoại hình" fields={visualFields.map((f) => renderField(f.index))} />
        </div>
      ) : (
        <div className="space-y-3">
          {isAutoTrainingItem && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div><div className="text-sm font-bold text-emerald-900 flex items-center gap-1.5"><Clock3 className="w-4 h-4" /> Tự động luyện tập · Item #521</div><div className="text-[10px] text-emerald-700 mt-1">Runtime patch của chính item này: có thời hạn và có thể ưu tiên quái nhiệm vụ.</div></div>
                <button type="button" onClick={() => patchAutoTraining({ enabled: !autoTraining.enabled })} className={`px-3 py-2 rounded-xl border text-xs font-bold ${autoTraining.enabled ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-emerald-300 text-emerald-800'}`}>{autoTraining.enabled ? 'ĐANG BẬT PATCH' : 'BẬT PATCH'}</button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] font-semibold text-zinc-700 mb-1">Thời hạn mỗi lần bật (phút)</div>
                  <input type="number" min={1} max={10080} disabled={!autoTraining.enabled} value={autoTraining.durationMinutes} onChange={(e) => patchAutoTraining({ durationMinutes: Math.max(1, Math.min(10080, Math.round(Number(e.target.value) || 1))) })} className="w-full rounded-xl border border-emerald-200 bg-white px-3 py-2.5 text-[16px] sm:text-xs font-mono disabled:opacity-50" />
                  <div className="mt-2 flex gap-1.5 flex-wrap">{[30, 60, 120, 300, 1440].map((minutes) => <button key={minutes} type="button" disabled={!autoTraining.enabled} onClick={() => patchAutoTraining({ durationMinutes: minutes })} className={`px-2.5 py-1.5 rounded-lg border text-[10px] font-bold disabled:opacity-40 ${autoTraining.durationMinutes === minutes ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-emerald-200 text-emerald-700'}`}>{minutes < 60 ? `${minutes}p` : minutes === 1440 ? '24h' : `${minutes / 60}h`}</button>)}</div>
                </div>
                <label className={`rounded-xl border p-3 flex gap-2 items-start ${autoTraining.enabled ? 'border-emerald-200 bg-white cursor-pointer' : 'border-zinc-200 bg-zinc-50 opacity-60'}`}><input type="checkbox" disabled={!autoTraining.enabled} checked={autoTraining.questAware} onChange={(e) => patchAutoTraining({ questAware: e.target.checked })} className="mt-0.5" /><div><div className="text-xs font-bold text-zinc-800">Đánh quái theo nhiệm vụ</div><div className="text-[10px] text-zinc-500 mt-1">Ưu tiên đúng mob của quest/substep đã xác minh; boss hoặc bước chưa map chắc chắn giữ target cũ.</div></div></label>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-emerald-200 pt-2"><span className="text-[10px] text-emerald-800">Hết thời gian tự tắt; bật lại item sẽ tạo phiên mới.</span><button type="button" onClick={() => { const next = resetAutoTrainingItemDraft(session); setAutoTraining(next); onUpdateField(0, draft.values[0] ?? item.id); }} className="text-[10px] text-zinc-500 hover:text-zinc-900 flex items-center gap-1"><RotateCcw className="w-3 h-3" /> Gốc</button></div>
            </div>
          )}

          <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-[10px] text-violet-900">
            <div className="font-semibold flex items-center gap-1.5"><Shield className="w-3.5 h-3.5" /> Form chỉ số sinh trực tiếp từ ItemOption của JAR</div>
            <div className="mt-1">Không hard-code tên chỉ số: đọc bảng <span className="font-mono">a/a/a/v.u</span>. Những option có nội dung HP/KI/Sức đánh/Giáp/Chí mạng/Hút/Phản/Xuyên/Né... được đưa thành form nhanh bên dưới.</div>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2 mb-3"><div><div className="text-[12px] font-semibold text-zinc-900">Form chỉ số nhanh</div><div className="text-[9px] text-zinc-500">{statOptions.length} chỉ số nhận diện từ bảng option thật.</div></div></div>
            {statOptions.length === 0 ? <div className="text-[10px] text-zinc-500">Không nhận diện được option chỉ số.</div> : <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {statOptions.map((option) => {
                const override = overrides.find((entry) => entry.optionId === option.id);
                return <div key={option.id} className={`rounded-xl border p-2.5 ${override?.enabled ? 'border-violet-200 bg-violet-50/50' : 'border-zinc-200 bg-zinc-50'}`}>
                  <div className="flex items-center justify-between gap-2 mb-1.5"><div className="min-w-0"><div className="text-[10px] font-semibold text-zinc-800 truncate" title={option.name}>{option.name}</div><div className="text-[9px] font-mono text-zinc-400">Option #{option.id}</div></div>{override ? <button type="button" onClick={() => removeOption(option.id)} className="text-[9px] text-red-600">Xóa</button> : <button type="button" onClick={() => addOption(option.id, 1)} className="text-[9px] px-2 py-1 rounded border border-violet-200 bg-white text-violet-700">Bật</button>}</div>
                  <input type="number" min={JAVA_INT_MIN} max={JAVA_INT_MAX} disabled={!override} value={override?.param ?? 0} onChange={(e) => updateOption(option.id, { param: Math.max(JAVA_INT_MIN, Math.min(JAVA_INT_MAX, Math.round(Number(e.target.value) || 0))), enabled: true })} className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-[16px] sm:text-xs font-mono disabled:opacity-50" />
                  {override && <div className="mt-1 text-[9px] text-violet-700 truncate">{renderOptionPreview(option.name, override.param)}</div>}
                </div>;
              })}
            </div>}
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-3">
            <div className="flex items-center justify-between gap-3"><div><div className="text-[12px] font-semibold text-zinc-900">Tất cả ItemOption</div><div className="text-[9px] text-zinc-500">{optionTemplates.length ? `${optionTemplates.length} option template đọc được từ JAR` : 'Đang đọc bảng option...'}</div></div><button type="button" onClick={() => setShowPicker((value) => !value)} className="px-2.5 py-1.5 rounded-lg border border-violet-200 bg-violet-50 hover:bg-violet-100 text-[10px] font-semibold text-violet-700 flex items-center gap-1 cursor-pointer"><Plus className="w-3.5 h-3.5" /> Thêm chỉ số</button></div>
            {optionError && <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[10px] text-red-700">{optionError}</div>}
            {showPicker && <div className="relative mt-3 rounded-xl border border-violet-200 bg-white p-2 shadow-sm"><div className="relative"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" /><input autoFocus value={optionQuery} onChange={(e) => setOptionQuery(e.target.value)} placeholder="Tìm HP, KI, sức đánh... hoặc Option ID" className="w-full pl-8 pr-3 py-2.5 rounded-lg border border-zinc-300 text-[16px] sm:text-xs" /></div><div className="mt-2 max-h-64 overflow-y-auto grid grid-cols-1 lg:grid-cols-2 gap-1.5">{pickerResults.map((option) => <button key={option.id} type="button" onClick={() => addOption(option.id)} className="rounded-lg border border-zinc-200 px-2.5 py-2 text-left hover:border-violet-300 hover:bg-violet-50"><div className="text-[10px] font-semibold text-zinc-800">{option.name}</div><div className="text-[9px] font-mono text-zinc-500">Option ID {option.id}</div></button>)}</div></div>}
            <div className="mt-3 space-y-2">{overrides.length === 0 ? <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-5 text-center text-[11px] text-zinc-500">Chưa có override chỉ số.</div> : overrides.map((override) => { const template = optionById.get(override.optionId); return <div key={override.optionId} className={`rounded-xl border p-3 ${override.enabled ? 'border-violet-200 bg-violet-50/40' : 'border-zinc-200 bg-zinc-50 opacity-70'}`}><div className="grid grid-cols-1 lg:grid-cols-[minmax(220px,1fr)_180px_auto] gap-2 items-end"><div><label className="flex items-center gap-1.5 text-[10px] font-semibold text-zinc-800"><input type="checkbox" checked={override.enabled} onChange={(e) => updateOption(override.optionId, { enabled: e.target.checked })} />{template?.name || `Option #${override.optionId}`}</label><div className="mt-1 text-[9px] text-violet-700">Preview: {renderOptionPreview(template?.name || '', override.param)}</div></div><label><div className="text-[9px] font-mono text-zinc-500 mb-1">Giá trị / param</div><input type="number" min={JAVA_INT_MIN} max={JAVA_INT_MAX} value={override.param} onChange={(e) => updateOption(override.optionId, { param: Math.max(JAVA_INT_MIN, Math.min(JAVA_INT_MAX, Math.round(Number(e.target.value) || 0))) })} className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-[16px] sm:text-xs font-mono" /></label><button type="button" onClick={() => removeOption(override.optionId)} className="px-2.5 py-2 rounded-lg border border-red-200 bg-red-50 text-red-700 text-[10px] flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" /> Xóa</button></div></div>; })}</div>
          </div>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><div className="text-[10px] font-semibold text-emerald-800 flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" /> Các chỉ số quan trọng đã xác minh trong JAR</div><div className="mt-2 flex flex-wrap gap-1.5">{IMPORTANT_OPTION_IDS.map((id) => { const option = optionById.get(id); if (!option) return null; return <button key={id} type="button" onClick={() => addOption(id)} disabled={overrides.some((entry) => entry.optionId === id)} className="px-2 py-1 rounded-lg border border-emerald-200 bg-white disabled:opacity-40 text-[9px] text-emerald-800">#{id} {option.name}</button>; })}</div></div>
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return <button type="button" onClick={onClick} className={`px-2.5 py-1.5 rounded-lg border text-[10px] font-medium flex items-center gap-1.5 whitespace-nowrap ${active ? 'bg-violet-50 border-violet-200 text-violet-700' : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}>{icon}{label}</button>;
}
function FieldSection({ title, fields }: { title: string; fields: React.ReactNode[] }) {
  return <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3"><div className="mb-2 text-[11px] font-semibold text-zinc-800">{title}</div><div className="grid grid-cols-1 xl:grid-cols-2 gap-2">{fields}</div></div>;
}
