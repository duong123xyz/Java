import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
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

type OptionCacheSession = LoadedJarSession & {
  __itemOptionTemplates?: ItemOptionTemplateRecord[];
};

const IMPORTANT_OPTION_IDS = [0, 6, 7, 14, 47, 48, 49, 50];
const JAVA_INT_MIN = -2147483648;
const JAVA_INT_MAX = 2147483647;

function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function renderOptionPreview(name: string, param: number): string {
  if (!name) return `Option #${param}`;
  return name.includes('#') ? name.replace(/#/g, String(param)) : `${name} · ${param}`;
}

async function analyzeOptionTemplates(session: LoadedJarSession): Promise<ItemOptionTemplateRecord[]> {
  const cached = (session as OptionCacheSession).__itemOptionTemplates;
  if (cached?.length) return cached;

  const entry = session.entries.find((candidate) => candidate.path === 'a/a/a/v.class')?.zipEntry
    ?? session.zip.file('a/a/a/v.class');
  if (!entry) throw new Error('Không tìm thấy a/a/a/v.class (bảng ItemOptionTemplate).');

  const buffer = await entry.async('arraybuffer');
  const parsed = parseClassFile(buffer);
  if (parsed.status !== 'valid' || parsed.remainingBytes !== 0) {
    throw new Error('a/a/a/v.class không parse VALID.');
  }
  const clinit = parsed.methods.find((method) => method.name === '<clinit>');
  if (!clinit?.code?.instructions) throw new Error('a/a/a/v.<clinit> không có instructions.');

  const table = reconstructStringArrayTable(
    'a/a/a/v',
    'u',
    '[[Ljava/lang/String;',
    0,
    clinit.code.instructions,
    parsed.constantPool,
    2
  );
  if (table.parseError) throw new Error(`Không đọc được bảng option: ${table.parseError}`);

  const rows: ItemOptionTemplateRecord[] = [];
  for (const row of table.rows) {
    const id = Number(row.values[0]);
    if (!Number.isInteger(id) || id < 0 || id > 32767) continue;
    rows.push({ id, name: String(row.values[1] || `Option #${id}`), sourceRow: row.rowIndex });
  }
  rows.sort((a, b) => a.id - b.id);
  (session as OptionCacheSession).__itemOptionTemplates = rows;
  return rows;
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
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('stats');
  const [optionTemplates, setOptionTemplates] = useState<ItemOptionTemplateRecord[]>([]);
  const [optionError, setOptionError] = useState<string | null>(null);
  const [optionQuery, setOptionQuery] = useState('');
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    let active = true;
    setOptionError(null);
    void analyzeOptionTemplates(session)
      .then((rows) => active && setOptionTemplates(rows))
      .catch((error: unknown) => active && setOptionError(error instanceof Error ? error.message : String(error)));
    return () => { active = false; };
  }, [session]);

  const currentDraftId = draft.values[0] ?? '';
  const duplicateLocations = useMemo(
    () => findDuplicateIds(currentDraftId, draft.key, allItems, drafts),
    [currentDraftId, draft.key, allItems, drafts, draft.values]
  );

  const overrides = draft.optionOverrides ?? [];
  const optionById = useMemo(
    () => new Map(optionTemplates.map((option) => [option.id, option])),
    [optionTemplates]
  );

  const notifyOptionChange = (next: ItemOptionOverride[]) => {
    setItemOptionOverrides(drafts, item, next);
    // Trigger ItemsBrowser revision + dirty count without changing the template ID.
    onUpdateField(0, draft.values[0] ?? item.id);
  };

  const addOption = (optionId: number) => {
    if (overrides.some((entry) => entry.optionId === optionId)) return;
    notifyOptionChange([
      ...overrides,
      { optionId, param: 1, enabled: true, note: '' },
    ]);
    setOptionQuery('');
    setShowPicker(false);
  };

  const updateOption = (optionId: number, patch: Partial<ItemOptionOverride>) => {
    notifyOptionChange(
      overrides.map((entry) => entry.optionId === optionId ? { ...entry, ...patch } : entry)
    );
  };

  const removeOption = (optionId: number) => {
    notifyOptionChange(overrides.filter((entry) => entry.optionId !== optionId));
  };

  const pickerResults = useMemo(() => {
    const q = normalizeSearch(optionQuery);
    const existing = new Set(overrides.map((entry) => entry.optionId));
    const list = optionTemplates.filter((option) => !existing.has(option.id));
    if (!q) {
      const important = IMPORTANT_OPTION_IDS
        .map((id) => list.find((entry) => entry.id === id))
        .filter((entry): entry is ItemOptionTemplateRecord => Boolean(entry));
      const rest = list.filter((entry) => !IMPORTANT_OPTION_IDS.includes(entry.id));
      return [...important, ...rest].slice(0, 60);
    }
    return list.filter((option) => {
      return String(option.id).includes(q) || normalizeSearch(option.name).includes(q);
    }).slice(0, 80);
  }, [optionTemplates, optionQuery, overrides]);

  const changedFields = useMemo(() => draft.dirtyFields.map((colIndex) => {
    const meta = ITEM_SCHEMA_FIELDS[colIndex];
    return {
      colIndex,
      label: meta?.label ?? `Cột ${colIndex}`,
      original: draft.originalValues[colIndex] ?? '',
      current: draft.values[colIndex] ?? '',
    };
  }), [draft.dirtyFields, draft.originalValues, draft.values]);

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
          <div>
            <div className="text-[11px] font-semibold text-zinc-800">{meta.label}</div>
            <div className="text-[9px] font-mono text-zinc-400">#{colIndex} · {meta.key}</div>
          </div>
          {dirty && (
            <button type="button" onClick={() => onResetField(colIndex)} className="text-[10px] text-zinc-500 hover:text-amber-700 flex items-center gap-1 cursor-pointer">
              <RotateCcw className="w-3 h-3" /> Gốc
            </button>
          )}
        </div>
        {isTextArea ? (
          <textarea rows={2} value={value} onChange={(e) => onUpdateField(colIndex, e.target.value)} className={`w-full rounded-lg border px-2.5 py-2 text-[11px] focus:outline-none ${error ? 'border-red-400' : 'border-zinc-200 focus:border-amber-300'}`} />
        ) : (
          <input value={value} onChange={(e) => onUpdateField(colIndex, e.target.value)} className={`w-full rounded-lg border px-2.5 py-2 text-[11px] font-mono focus:outline-none ${error ? 'border-red-400' : 'border-zinc-200 focus:border-amber-300'}`} />
        )}
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
          {draft.isDirty && (
            <button type="button" onClick={onResetItem} className="px-2.5 py-1.5 rounded-lg border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 text-[10px] flex items-center gap-1 cursor-pointer">
              <RotateCcw className="w-3 h-3" /> Trả item về gốc
            </button>
          )}
        </div>

        {duplicateLocations.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] text-amber-800">
            ID {currentDraftId} đang trùng {duplicateLocations.length} item khác. Đổi ID có thể làm shop/drop trỏ sai template.
          </div>
        )}

        <div className="mt-3 flex items-center gap-1.5 overflow-x-auto border-t border-zinc-100 pt-2">
          <TabButton active={activeSubTab === 'stats'} onClick={() => setActiveSubTab('stats')} icon={<Zap className="w-3.5 h-3.5" />} label={`Chỉ số / Option (${overrides.length})`} />
          <TabButton active={activeSubTab === 'template'} onClick={() => setActiveSubTab('template')} icon={<Sliders className="w-3.5 h-3.5" />} label="Template 15 trường" />
          <TabButton active={activeSubTab === 'diff'} onClick={() => setActiveSubTab('diff')} icon={<Table className="w-3.5 h-3.5" />} label="So sánh" />
          <TabButton active={activeSubTab === 'patch'} onClick={() => setActiveSubTab('patch')} icon={<FileCode className="w-3.5 h-3.5" />} label="Bytecode" />
        </div>
      </div>

      {activeSubTab === 'patch' ? (
        <PatchPlanTab session={session} item={item} draft={draft} />
      ) : activeSubTab === 'diff' ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-3">
          <div className="font-semibold text-sm text-zinc-900">Thay đổi của item</div>
          {changedFields.length === 0 && overrides.length === 0 ? (
            <div className="text-[11px] text-zinc-500">Chưa có thay đổi.</div>
          ) : (
            <div className="space-y-2">
              {changedFields.map((change) => (
                <div key={change.colIndex} className="grid grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)] gap-2 rounded-lg border border-zinc-200 p-2 text-[10px]">
                  <div className="font-semibold">{change.label}</div>
                  <div className="font-mono text-zinc-500 break-all">Gốc: {change.original}</div>
                  <div className="font-mono text-amber-700 break-all">Mới: {change.current}</div>
                </div>
              ))}
              {overrides.map((override) => (
                <div key={`opt-${override.optionId}`} className="rounded-lg border border-violet-200 bg-violet-50 p-2 text-[10px] flex items-center justify-between gap-3">
                  <div><strong>{optionById.get(override.optionId)?.name || `Option #${override.optionId}`}</strong> <span className="font-mono text-zinc-500">ID {override.optionId}</span></div>
                  <div className="font-mono text-violet-700">SET {override.param}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : activeSubTab === 'template' ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-[10px] text-blue-800">
            <strong>Phân biệt:</strong> 15 trường này là ItemTemplate metadata. HP, KI, Sức đánh, Giáp, Chí mạng, Hút HP/KI, Phản sát thương... không nằm ở đây; chúng nằm trong ItemOption và chỉnh ở tab <strong>Chỉ số / Option</strong>.
          </div>
          <FieldSection title="Thông tin cơ bản" fields={generalFields.map((f) => renderField(f.index))} />
          <FieldSection title="Yêu cầu & kinh tế" fields={requirementFields.map((f) => renderField(f.index))} />
          <FieldSection title="Hiển thị & ngoại hình" fields={visualFields.map((f) => renderField(f.index))} />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-[10px] text-violet-900">
            <div className="font-semibold flex items-center gap-1.5"><Shield className="w-3.5 h-3.5" /> Chỉ số thực của trang bị nằm ở ItemOption</div>
            <div className="mt-1 leading-relaxed">
              Game lưu option ở <span className="font-mono">a/ab.b -&gt; a/H[]</span>; mỗi option có <strong>Option ID</strong> + <strong>param</strong>. Bảng tên option được đọc trực tiếp từ <span className="font-mono">a/a/a/v.u</span>. Writer runtime sẽ SET option này cho mọi instance có ItemTemplate ID {draft.values[0] || item.id}, kể cả khi option đó trước đây chưa có.
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[12px] font-semibold text-zinc-900">Option đang áp cho item</div>
                <div className="text-[9px] text-zinc-500">{optionTemplates.length ? `${optionTemplates.length} option template đọc được từ JAR` : 'Đang đọc bảng option...'}</div>
              </div>
              <button type="button" onClick={() => setShowPicker((value) => !value)} className="px-2.5 py-1.5 rounded-lg border border-violet-200 bg-violet-50 hover:bg-violet-100 text-[10px] font-semibold text-violet-700 flex items-center gap-1 cursor-pointer">
                <Plus className="w-3.5 h-3.5" /> Thêm chỉ số
              </button>
            </div>

            {optionError && <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[10px] text-red-700">{optionError}</div>}

            {showPicker && (
              <div className="relative mt-3 rounded-xl border border-violet-200 bg-white p-2 shadow-sm">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
                  <input autoFocus value={optionQuery} onChange={(e) => setOptionQuery(e.target.value)} placeholder="Tìm: HP, KI, sức đánh, giáp, chí mạng, hút, phản, xuyên, né... hoặc Option ID" className="w-full pl-8 pr-3 py-2 rounded-lg border border-zinc-200 text-[11px] focus:outline-none focus:border-violet-300" />
                </div>
                <div className="mt-2 max-h-64 overflow-y-auto grid grid-cols-1 lg:grid-cols-2 gap-1.5">
                  {pickerResults.map((option) => (
                    <button key={option.id} type="button" onClick={() => addOption(option.id)} className="rounded-lg border border-zinc-200 px-2.5 py-2 text-left hover:border-violet-300 hover:bg-violet-50 cursor-pointer">
                      <div className="text-[10px] font-semibold text-zinc-800">{option.name}</div>
                      <div className="text-[9px] font-mono text-zinc-500">Option ID {option.id}</div>
                    </button>
                  ))}
                  {pickerResults.length === 0 && <div className="p-3 text-[10px] text-zinc-500">Không tìm thấy option phù hợp.</div>}
                </div>
              </div>
            )}

            <div className="mt-3 space-y-2">
              {overrides.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-5 text-center text-[11px] text-zinc-500">
                  Chưa có override chỉ số. Bấm <strong>Thêm chỉ số</strong> để thêm HP/KI/Sức đánh/Giáp/Chí mạng hoặc bất kỳ option nào có trong JAR.
                </div>
              ) : overrides.map((override) => {
                const template = optionById.get(override.optionId);
                return (
                  <div key={override.optionId} className={`rounded-xl border p-3 ${override.enabled ? 'border-violet-200 bg-violet-50/40' : 'border-zinc-200 bg-zinc-50 opacity-70'}`}>
                    <div className="grid grid-cols-1 lg:grid-cols-[minmax(220px,1fr)_180px_auto] gap-2 items-end">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <label className="flex items-center gap-1.5 text-[10px] font-semibold text-zinc-800 cursor-pointer">
                            <input type="checkbox" checked={override.enabled} onChange={(e) => updateOption(override.optionId, { enabled: e.target.checked })} />
                            {template?.name || `Option #${override.optionId}`}
                          </label>
                          <span className="px-1.5 py-0.5 rounded-full border border-zinc-200 bg-white text-[9px] font-mono">ID {override.optionId}</span>
                        </div>
                        <div className="mt-1 text-[9px] text-violet-700">Preview: {renderOptionPreview(template?.name || '', override.param)}</div>
                      </div>
                      <label>
                        <div className="text-[9px] font-mono text-zinc-500 mb-1">Giá trị / param</div>
                        <input type="number" min={JAVA_INT_MIN} max={JAVA_INT_MAX} value={override.param} onChange={(e) => updateOption(override.optionId, { param: Math.max(JAVA_INT_MIN, Math.min(JAVA_INT_MAX, Math.round(Number(e.target.value) || 0))) })} className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-[11px] font-mono focus:outline-none focus:border-violet-300" />
                      </label>
                      <button type="button" onClick={() => removeOption(override.optionId)} className="px-2.5 py-2 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-[10px] flex items-center gap-1 cursor-pointer">
                        <Trash2 className="w-3.5 h-3.5" /> Xóa
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-[10px] font-semibold text-emerald-800 flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" /> Các chỉ số quan trọng đã xác minh trong JAR</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {IMPORTANT_OPTION_IDS.map((id) => {
                const option = optionById.get(id);
                if (!option) return null;
                return <button key={id} type="button" onClick={() => addOption(id)} disabled={overrides.some((entry) => entry.optionId === id)} className="px-2 py-1 rounded-lg border border-emerald-200 bg-white disabled:opacity-40 text-[9px] text-emerald-800 cursor-pointer">#{id} {option.name}</button>;
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick} className={`px-2.5 py-1.5 rounded-lg border text-[10px] font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${active ? 'bg-violet-50 border-violet-200 text-violet-700' : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}>
      {icon}{label}
    </button>
  );
}

function FieldSection({ title, fields }: { title: string; fields: React.ReactNode[] }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
      <div className="mb-2 text-[11px] font-semibold text-zinc-800">{title}</div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">{fields}</div>
    </div>
  );
}
