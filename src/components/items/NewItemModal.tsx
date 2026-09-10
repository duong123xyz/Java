import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CopyPlus,
  Loader2,
  ImagePlus,
  RefreshCw,
  PackagePlus,
  Plus,
  Search,
  Shield,
  Trash2,
  X,
} from 'lucide-react';
import { CandidateOutputJar, LoadedJarSession } from '../../types/jar';
import {
  ItemAnalysisSessionData,
  ItemOptionOverride,
  ItemOptionTemplateRecord,
  ItemRecord,
} from '../../types/item';
import { SmallImagePreview } from '../game-data/SmallImagePreview';
import { NpcBodyPreview } from '../game-data/NpcBodyPreview';
import { ITEM_CREATE_SCHEMA } from '../../services/itemCreationService';
import { parseClassFile } from '../../services/classFileParser';
import { reconstructStringArrayTable } from '../../services/stringArrayTableAnalyzer';
import { getItemDraftKey } from '../../services/itemDraftService';
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
  'ID vật phẩm',
  'Loại trang bị',
  'Hành tinh sử dụng',
  'Tên vật phẩm',
  'Mô tả',
  'Cấp vật phẩm',
  'Ảnh icon trong túi',
  'Mã ngoại hình khi mặc (Part)',
  'Cho phép nâng cấp',
  'Sức mạnh yêu cầu',
  'Giá vàng',
  'Giá ngọc',
  'Đầu của bộ ngoại hình (Head)',
  'Thân của bộ ngoại hình (Body)',
  'Chân của bộ ngoại hình (Leg)',
] as const;

const FIELD_HELP = [
  'ID duy nhất của item. Panel quét toàn bộ ItemTemplate trong JAR và các item đang chờ để chống trùng.',
  '0=Áo, 1=Quần, 2=Găng, 3=Giày, 4=Rada, 5=Cải trang.',
  'Nhân vật/hành tinh được phép dùng item: 0=Trái Đất, 1=Namek, 2=Xayda, 3=Tất cả.',
  'Tên hiển thị của vật phẩm trong game.',
  'Dòng mô tả hiển thị khi xem chi tiết vật phẩm.',
  'Cấp/level nền của ItemTemplate.',
  'ID ảnh SmallImage hiển thị trong túi/shop. Có thể tải PNG mới ở khung bên phải để panel tự cấp ID ảnh.',
  'Mã sprite/part mà game dùng khi trang bị. Với Áo/Quần/Găng/Giày/Rada, đây là trường ngoại hình chính.',
  'Cờ kỹ thuật của hệ thống nâng cấp. Thường nên clone từ item cùng loại rồi giữ nguyên nếu chưa chắc.',
  'Mốc sức mạnh tối thiểu để sử dụng/trang bị item.',
  'Giá bán/mua bằng vàng theo logic của ItemTemplate.',
  'Giá bán/mua bằng ngọc theo logic của ItemTemplate.',
  'Chỉ dùng khi item cần ghép cả bộ ngoại hình, điển hình Cải trang. -1 nghĩa là không dùng trường này.',
  'Chỉ dùng khi item cần ghép cả bộ ngoại hình, điển hình Cải trang. -1 nghĩa là không dùng trường này.',
  'Chỉ dùng khi item cần ghép cả bộ ngoại hình, điển hình Cải trang. -1 nghĩa là không dùng trường này.',
] as const;

const EQUIPMENT_PRESETS = [
  { label: 'Áo', type: '0' },
  { label: 'Quần', type: '1' },
  { label: 'Găng', type: '2' },
  { label: 'Giày', type: '3' },
  { label: 'Rada', type: '4' },
  { label: 'Cải trang', type: '5' },
] as const;

const IMPORTANT_OPTION_IDS = [0, 6, 7, 14, 47, 48, 49, 50];
const JAVA_INT_MIN = -2147483648;
const JAVA_INT_MAX = 2147483647;

type OptionCacheSession = LoadedJarSession & {
  __itemOptionTemplates?: ItemOptionTemplateRecord[];
};

function normalizeSearch(text: string): string {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function renderOptionPreview(name: string, param: number): string {
  if (!name) return `Option · ${param}`;
  const raw = String(name || '');
  if (param < 0) {
    const negativeAbs = String(Math.abs(param));
    return raw
      .replace(/\+\s*#/g, String(param))
      .replace(/#\s*%/g, `${negativeAbs}%`)
      .replace(/#(?!\s*%)/g, negativeAbs)
      .replace(/\+\s*-/g, '-')
      .replace(/--/g, '-');
  }
  return raw.includes('#') ? raw.replace(/#/g, String(param)) : `${raw} · ${param}`;
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
    rows.push({
      id,
      name: String(row.values[1] || `Option #${id}`),
      sourceRow: row.rowIndex,
    });
  }
  rows.sort((a, b) => a.id - b.id);
  (session as OptionCacheSession).__itemOptionTemplates = rows;
  return rows;
}

function nextGlobalItemId(
  analysisData: ItemAnalysisSessionData,
  session: LoadedJarSession
): string {
  const used = new Set<number>();
  for (const item of analysisData.items) {
    const id = Number(item.id);
    if (Number.isInteger(id) && id >= 0 && id <= 32767) used.add(id);
  }
  for (const raw of getQueuedNewItemIds(session)) {
    const id = Number(raw);
    if (Number.isInteger(id) && id >= 0 && id <= 32767) used.add(id);
  }

  let max = -1;
  used.forEach((id) => { if (id > max) max = id; });
  if (max < 32767 && !used.has(max + 1)) return String(max + 1);
  for (let id = 0; id <= 32767; id++) {
    if (!used.has(id)) return String(id);
  }
  throw new Error('Không còn Item ID trống trong dải 0..32767.');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunk)));
  }
  return btoa(binary);
}

function isPng(bytes: Uint8Array): boolean {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.length >= 8 && sig.every((value, index) => bytes[index] === value);
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

function cloneDraftOptions(session: LoadedJarSession, selectedItem: ItemRecord | null): ItemOptionOverride[] {
  if (!selectedItem || !session.itemDrafts) return [];
  const key = getItemDraftKey(selectedItem.sourceClass, selectedItem.sourceField, selectedItem.sourceRow);
  const source = session.itemDrafts.get(key)?.optionOverrides ?? [];
  return source.map((option) => ({ ...option }));
}

function findCloneTemplateForType(
  analysisData: ItemAnalysisSessionData,
  preferredType: string,
  preferredSourceClass?: string | null,
  fallbackItem?: ItemRecord | null
): ItemRecord | null {
  const items = analysisData.items.filter((item) => String(item.rawValues?.[1] ?? item.type ?? '') === preferredType);
  if (!items.length) return fallbackItem ?? null;
  const sameSource = preferredSourceClass ? items.find((item) => item.sourceClass === preferredSourceClass) : null;
  return sameSource ?? items[0] ?? fallbackItem ?? null;
}

function cloneValuesFromItem(
  analysisData: ItemAnalysisSessionData,
  item: ItemRecord | null,
  session: LoadedJarSession,
  forcedType?: string,
  nameHint?: string,
  currentValues?: string[]
): string[] {
  const next = item ? [...item.rawValues] : defaultValues(analysisData, null, session);
  while (next.length < ITEM_CREATE_SCHEMA.length) next.push('');
  next.length = ITEM_CREATE_SCHEMA.length;
  next[0] = nextGlobalItemId(analysisData, session);
  if (forcedType != null) next[1] = forcedType;
  if (nameHint) next[3] = nameHint;
  if (currentValues) {
    if (String(currentValues[4] || '').trim()) next[4] = currentValues[4];
    if (String(currentValues[6] || '').trim()) next[6] = currentValues[6];
    if (String(currentValues[9] || '').trim()) next[9] = currentValues[9];
    if (String(currentValues[10] || '').trim()) next[10] = currentValues[10];
    if (String(currentValues[11] || '').trim()) next[11] = currentValues[11];
  }
  return next;
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
    selectedItem?.sourceClass ?? analysisData.sourceFilters[0]?.ownerInternalName ?? 'a/a/a/i'
  );
  const [values, setValues] = useState<string[]>(() => defaultValues(analysisData, selectedItem, session));
  const [options, setOptions] = useState<ItemOptionOverride[]>(() => cloneDraftOptions(session, selectedItem));
  const [optionTemplates, setOptionTemplates] = useState<ItemOptionTemplateRecord[]>([]);
  const [optionQuery, setOptionQuery] = useState('');
  const [optionError, setOptionError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customIcon, setCustomIcon] = useState<{ fileName: string; pngBase64: string; size: number } | null>(null);
  const [iconError, setIconError] = useState<string | null>(null);
  const [cloneTemplateItem, setCloneTemplateItem] = useState<ItemRecord | null>(selectedItem);

  useEffect(() => {
    let active = true;
    void analyzeOptionTemplates(session)
      .then((rows) => {
        if (!active) return;
        setOptionTemplates(rows);
        setOptionError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setOptionError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [session]);

  const sourceInfo = useMemo(
    () => analysisData.sourceFilters.find((filter) => filter.ownerInternalName === sourceClass) ?? null,
    [analysisData.sourceFilters, sourceClass]
  );

  const duplicateId = useMemo(() => {
    const id = Number(values[0]);
    if (!Number.isInteger(id)) return false;
    return analysisData.items.some((item) => Number(item.id) === id)
      || getQueuedNewItemIds(session).some((raw) => Number(raw) === id);
  }, [analysisData.items, session, values]);

  const idScan = useMemo(() => {
    const id = Number(values[0]);
    const existingMatches = Number.isInteger(id)
      ? analysisData.items.filter((item) => Number(item.id) === id)
      : [];
    const queuedMatch = Number.isInteger(id)
      ? getQueuedNewItemIds(session).some((raw) => Number(raw) === id)
      : false;
    return {
      existingMatches,
      queuedMatch,
      scannedTemplates: analysisData.items.length,
      queuedCount: getQueuedNewItemIds(session).length,
    };
  }, [analysisData.items, session, values]);

  const optionById = useMemo(
    () => new Map(optionTemplates.map((option) => [option.id, option])),
    [optionTemplates]
  );

  const optionResults = useMemo(() => {
    const existing = new Set(options.map((option) => option.optionId));
    const q = normalizeSearch(optionQuery);
    let list = optionTemplates.filter((option) => !existing.has(option.id));
    if (!q) {
      const important = IMPORTANT_OPTION_IDS
        .map((id) => optionById.get(id))
        .filter((option): option is ItemOptionTemplateRecord => Boolean(option) && !existing.has(option.id));
      const rest = list.filter((option) => !IMPORTANT_OPTION_IDS.includes(option.id));
      return [...important, ...rest].slice(0, 18);
    }
    list = list.filter((option) =>
      String(option.id).includes(q) || normalizeSearch(option.name).includes(q)
    );
    return list.slice(0, 24);
  }, [optionTemplates, optionById, optionQuery, options]);

  const iconId = Number(values[6]);
  const head = Number(values[12]);
  const body = Number(values[13]);
  const leg = Number(values[14]);
  const hasBody = [head, body, leg].every((value) => Number.isInteger(value) && value >= 0);
  const itemType = String(values[1] ?? '').trim();
  const usesPartAppearance = ['0', '1', '2', '3', '4'].includes(itemType);
  const usesFullBodyAppearance = itemType === '5';
  const selectedTypeLabel = EQUIPMENT_PRESETS.find((preset) => preset.type === itemType)?.label ?? `type ${itemType || '?'}`;

  const update = (index: number, value: string) => {
    setValues((current) => current.map((item, itemIndex) => itemIndex === index ? value : item));
  };

  const applyPresetType = (presetType: string) => {
    const presetLabel = EQUIPMENT_PRESETS.find((preset) => preset.type === presetType)?.label ?? 'Item';
    const template = findCloneTemplateForType(analysisData, presetType, sourceClass, cloneTemplateItem ?? selectedItem);
    const nextValues = cloneValuesFromItem(
      analysisData,
      template,
      session,
      presetType,
      `${presetLabel} mới`,
      values
    );
    if (presetType !== '5') {
      nextValues[12] = '-1';
      nextValues[13] = '-1';
      nextValues[14] = '-1';
    }
    setCloneTemplateItem(template);
    setSourceClass(template?.sourceClass ?? sourceClass);
    setValues(nextValues);
    setOptions(cloneDraftOptions(session, template));
    setError(null);
  };

  const handleTypeChange = (nextType: string) => {
    const currentType = String(values[1] ?? '');
    if (nextType === currentType) {
      update(1, nextType);
      return;
    }
    if (EQUIPMENT_PRESETS.some((preset) => preset.type === nextType)) {
      applyPresetType(nextType);
      return;
    }
    update(1, nextType);
  };

  const allocateFreshId = () => {
    try {
      update(0, nextGlobalItemId(analysisData, session));
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const chooseCustomIcon = async (file: File | null) => {
    setIconError(null);
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setIconError('PNG quá lớn. Giữ ảnh dưới 2 MB để tránh J2ME tốn RAM.');
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!isPng(bytes)) throw new Error('Ảnh icon phải là PNG thật.');
      setCustomIcon({ fileName: file.name || 'item-icon.png', pngBase64: bytesToBase64(bytes), size: bytes.length });
    } catch (err: unknown) {
      setIconError(err instanceof Error ? err.message : String(err));
    }
  };

  const addOption = (optionId: number) => {
    setOptions((current) => {
      if (current.some((option) => option.optionId === optionId)) return current;
      return [...current, { optionId, param: 0, enabled: true, note: '' }]
        .sort((a, b) => a.optionId - b.optionId);
    });
    setOptionQuery('');
  };

  const updateOption = (optionId: number, patch: Partial<ItemOptionOverride>) => {
    setOptions((current) => current.map((option) =>
      option.optionId === optionId ? { ...option, ...patch } : option
    ));
  };

  const removeOption = (optionId: number) => {
    setOptions((current) => current.filter((option) => option.optionId !== optionId));
  };

  const validationError = useMemo(() => {
    const id = Number(values[0]);
    if (!Number.isInteger(id) || id < 0 || id > 32767) return 'Item ID phải là số nguyên 0..32767.';
    if (duplicateId) return `Item ID ${values[0]} đã tồn tại.`;
    if (!String(values[3] || '').trim()) return 'Tên item không được để trống.';
    for (const option of options) {
      if (!Number.isInteger(option.optionId) || option.optionId < 0 || option.optionId > 32767) {
        return `Option ID ${option.optionId} không hợp lệ.`;
      }
      if (!Number.isInteger(option.param) || option.param < JAVA_INT_MIN || option.param > JAVA_INT_MAX) {
        return `Giá trị Option #${option.optionId} vượt Java int32.`;
      }
    }
    return null;
  }, [values, duplicateId, options]);

  const build = async () => {
    setError(null);
    if (validationError) {
      setError(validationError);
      return;
    }

    setBuilding(true);
    try {
      queueNewItemOperation(session, {
        sourceClass,
        values,
        optionOverrides: options,
        customIcon: customIcon ? { fileName: customIcon.fileName, pngBase64: customIcon.pngBase64 } : undefined,
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
      <div className="w-full max-w-7xl max-h-[95vh] rounded-2xl border border-zinc-200 bg-white shadow-2xl overflow-hidden flex flex-col">
        <div className="shrink-0 px-4 py-3 border-b border-zinc-200 bg-zinc-50 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center">
              <PackagePlus className="w-4 h-4 text-amber-600" />
            </div>
            <div>
              <div className="text-sm font-bold text-zinc-900">Tạo Item / Trang bị mới</div>
              <div className="text-[10px] text-zinc-500">
                Clone template thật + tạo ItemOption thật. Test workspace và Export JAR dùng cùng một operation.
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-100 flex items-center justify-center cursor-pointer">
            <X className="w-4 h-4 text-zinc-500" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_360px] gap-4">
            <div className="space-y-4">
              <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-[11px] font-semibold text-zinc-800 mr-1">Nhóm trang bị nhanh:</div>
                  {EQUIPMENT_PRESETS.map((preset) => (
                    <button
                      key={preset.type}
                      type="button"
                      onClick={() => applyPresetType(preset.type)}
                      className={`px-3 py-1.5 rounded-lg border text-[10px] font-medium cursor-pointer ${
                        values[1] === preset.type
                          ? 'bg-amber-100 border-amber-300 text-amber-800'
                          : 'bg-white border-zinc-200 text-zinc-600 hover:border-amber-200'
                      }`}
                    >
                      {preset.label} · mã {preset.type}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_220px] gap-3">
                  <label>
                    <div className="text-[10px] text-zinc-500 font-mono mb-1">Bảng nguồn</div>
                    <select value={sourceClass} onChange={(event) => setSourceClass(event.target.value)} className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-[11px] font-mono focus:outline-none focus:border-amber-300">
                      {analysisData.sourceFilters.map((filter) => (
                        <option key={filter.ownerInternalName} value={filter.ownerInternalName}>
                          {filter.ownerInternalName}.u — {filter.count} row
                        </option>
                      ))}
                    </select>
                  </label>
                  <div>
                    <div className="text-[10px] text-zinc-500 font-mono mb-1">Row mới</div>
                    <div className="px-3 py-2 rounded-xl border border-zinc-200 bg-white text-[11px] font-mono text-zinc-700">
                      {sourceInfo ? `${sourceInfo.count} → ${sourceInfo.count + 1}` : '—'}
                    </div>
                  </div>
                </div>
                <div className="text-[10px] text-zinc-500">
                  {cloneTemplateItem ? <>
                    Đang clone metadata từ <strong>{cloneTemplateItem.name}</strong> · item #{cloneTemplateItem.id} · type {cloneTemplateItem.rawValues?.[1] ?? cloneTemplateItem.type ?? '?'}. Khi đổi nhanh sang loại khác, panel sẽ tự tìm một template cùng loại để clone cho đúng nền.
                  </> : 'Đang tạo row trống. Với áo/quần/găng/giày/cải trang nên chọn một item cùng loại ở danh sách trước hoặc bấm nhóm trang bị nhanh để panel tự lấy template gần đúng.'}
                </div>
              </section>

              <section className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
                <div className="px-3 py-2.5 border-b border-zinc-200 bg-zinc-50 flex items-center gap-2">
                  <CopyPlus className="w-3.5 h-3.5 text-amber-600" />
                  <div>
                    <div className="text-[12px] font-semibold text-zinc-900">Thông tin vật phẩm</div>
                    <div className="text-[9px] text-zinc-500">Tên tiếng Việt dễ hiểu; mã kỹ thuật vẫn hiện nhỏ bên phải để đối chiếu.</div>
                  </div>
                </div>
                <div className="px-3 pt-3">
                  <div className={`rounded-xl border px-3 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${duplicateId ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}>
                    <div>
                      <div className={`text-[11px] font-semibold ${duplicateId ? 'text-red-700' : 'text-emerald-700'}`}>
                        {duplicateId ? `ID ${values[0] || '?'} ĐANG BỊ TRÙNG` : `ID ${values[0] || '?'} đang trống`}
                      </div>
                      <div className="text-[9px] text-zinc-600 mt-0.5">
                        Đã quét {idScan.scannedTemplates.toLocaleString('vi-VN')} ItemTemplate trong toàn JAR + {idScan.queuedCount} item đang chờ trong Workspace.
                        {idScan.existingMatches.length > 0 ? ` Trùng ${idScan.existingMatches.length} template gốc.` : ''}
                        {idScan.queuedMatch ? ' Trùng item đang chờ.' : ''}
                      </div>
                    </div>
                    <button type="button" onClick={allocateFreshId} className="shrink-0 px-3 py-1.5 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-100 text-[10px] font-medium text-zinc-700 flex items-center gap-1.5 cursor-pointer">
                      <RefreshCw className="w-3.5 h-3.5" />
                      Tự cấp ID không trùng
                    </button>
                  </div>
                </div>

                <div className="px-3 pt-3">
                  {usesPartAppearance ? (
                    <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-[10px] text-sky-800 leading-relaxed">
                      <strong>{selectedTypeLabel} dùng Part #{values[7] || '?'} làm ngoại hình khi mặc.</strong>{' '}
                      Head / Body / Leg không phải 3 phần của chiếc {selectedTypeLabel.toLowerCase()}; chúng là bộ ngoại hình riêng dùng cho Cải trang/NPC. Vì vậy giá trị <strong>-1 là đúng</strong> với trang bị loại này.
                    </div>
                  ) : usesFullBodyAppearance ? (
                    <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 text-[10px] text-violet-800 leading-relaxed">
                      <strong>Cải trang dùng Head + Body + Leg để ghép ngoại hình đầy đủ.</strong> Với loại này hãy nhập 3 mã bộ phận hợp lệ; -1 nghĩa là phần đó chưa được gán.
                    </div>
                  ) : (
                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-[10px] text-zinc-600">
                      Type này không nằm trong nhóm trang bị nhanh. Panel vẫn giữ đủ field kỹ thuật để không làm mất dữ liệu khi clone.
                    </div>
                  )}
                </div>

                <div className="p-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {ITEM_CREATE_SCHEMA.map((field, index) => {
                    if (usesPartAppearance && index >= 12 && index <= 14) return null;
                    return (
                    <label key={field} className={index === 3 || index === 4 ? 'sm:col-span-2 xl:col-span-3' : ''}>
                      <div className="flex items-center justify-between gap-2 text-[9px] font-mono mb-1">
                        <span className="text-zinc-600">{LABELS[index]}</span>
                        <span className="text-zinc-400">{field}</span>
                      </div>
                      {index === 1 ? (
                        <select value={values[index] ?? ''} onChange={(event) => handleTypeChange(event.target.value)} className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-zinc-50 text-[11px] text-zinc-900 focus:outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-100">
                          {!EQUIPMENT_PRESETS.some((preset) => preset.type === values[index]) && values[index] !== '' && (
                            <option value={values[index]}>Loại khác · mã {values[index]} (giữ từ item gốc)</option>
                          )}
                          {EQUIPMENT_PRESETS.map((preset) => <option key={preset.type} value={preset.type}>{preset.label} · mã {preset.type}</option>)}
                        </select>
                      ) : index === 2 ? (
                        <select value={values[index] ?? ''} onChange={(event) => update(index, event.target.value)} className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-zinc-50 text-[11px] text-zinc-900 focus:outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-100">
                          {!['0', '1', '2', '3'].includes(values[index] ?? '') && values[index] !== '' && (
                            <option value={values[index]}>Giá trị khác · mã {values[index]} (giữ từ item gốc)</option>
                          )}
                          <option value="0">Trái Đất · mã 0</option>
                          <option value="1">Namek · mã 1</option>
                          <option value="2">Xayda · mã 2</option>
                          <option value="3">Tất cả · mã 3</option>
                        </select>
                      ) : index === 4 ? (
                        <textarea value={values[index] ?? ''} onChange={(event) => update(index, event.target.value)} rows={3} className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-zinc-50 text-[11px] text-zinc-900 focus:outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-100 resize-y" />
                      ) : (
                        <input value={values[index] ?? ''} onChange={(event) => update(index, event.target.value)} className={`w-full px-3 py-2 rounded-xl border bg-zinc-50 text-[11px] text-zinc-900 focus:outline-none focus:ring-2 ${index === 0 && duplicateId ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : 'border-zinc-200 focus:border-amber-300 focus:ring-amber-100'}`} />
                      )}
                      <div className="mt-1 text-[9px] text-zinc-500 leading-relaxed">{FIELD_HELP[index]}</div>
                      {(index === 12 || index === 13 || index === 14) && values[index] === '-1' && (
                        <div className="mt-1 inline-flex px-1.5 py-0.5 rounded bg-zinc-100 border border-zinc-200 text-[9px] text-zinc-500">-1 = không dùng trường này</div>
                      )}
                    </label>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-xl border border-violet-200 bg-white overflow-hidden">
                <div className="px-3 py-2.5 border-b border-violet-100 bg-violet-50 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-violet-600" />
                    <div>
                      <div className="text-[12px] font-semibold text-zinc-900">Chỉ số / ItemOption thật</div>
                      <div className="text-[9px] text-zinc-500">HP, KI, sức đánh, giáp, chí mạng… được writer gameplay V27 áp cho item mới.</div>
                    </div>
                  </div>
                  <div className="text-[10px] font-mono text-violet-700">{options.length} option</div>
                </div>

                <div className="p-3 space-y-3">
                  {optionError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[10px] text-red-700">{optionError}</div>}
                  <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[10px] text-violet-800 leading-relaxed">Cho phép <strong>chỉ số âm</strong>. Ví dụ: nhập <strong>-10</strong> cho option HP+#% sẽ hiển thị thành <strong>HP-10%</strong>. Các option vẫn giới hạn trong Java int32.</div>

                  {options.length > 0 && (
                    <div className="space-y-2">
                      {options.map((option) => {
                        const template = optionById.get(option.optionId);
                        return (
                          <div key={option.optionId} className="grid grid-cols-[minmax(0,1fr)_160px_42px] gap-2 items-center rounded-xl border border-violet-100 bg-violet-50/50 p-2.5">
                            <div className="min-w-0">
                              <div className="text-[10px] font-semibold text-zinc-800 truncate">{template?.name || `Option #${option.optionId}`}</div>
                              <div className="text-[9px] font-mono text-zinc-500">ID {option.optionId} · {renderOptionPreview(template?.name || '', option.param)}</div>
                            </div>
                            <div>
                              <input
                                type="number"
                                inputMode="numeric"
                                step="1"
                                min={JAVA_INT_MIN}
                                max={JAVA_INT_MAX}
                                value={option.param}
                                onChange={(event) => updateOption(option.optionId, { param: Math.round(Number(event.target.value) || 0) })}
                                className="w-full px-3 py-2 rounded-lg border border-violet-200 bg-white text-[11px] font-mono focus:outline-none focus:border-violet-400"
                                title="Giá trị thay cho dấu # trong mô tả option. Cho phép số âm như -10."
                              />
                              <div className="mt-1 text-[9px] text-violet-700">Cho phép số âm, ví dụ -10.</div>
                            </div>
                            <button type="button" onClick={() => removeOption(option.optionId)} className="w-9 h-9 rounded-lg border border-red-200 bg-white text-red-500 hover:bg-red-50 flex items-center justify-center cursor-pointer" title="Xóa option">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="rounded-xl border border-zinc-200 p-2.5 bg-zinc-50">
                    <div className="relative mb-2">
                      <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                      <input
                        value={optionQuery}
                        onChange={(event) => setOptionQuery(event.target.value)}
                        placeholder="Tìm tên chỉ số hoặc Option ID: sức đánh, HP, KI, chí mạng..."
                        className="w-full pl-8 pr-3 py-2 rounded-lg border border-zinc-200 bg-white text-[11px] focus:outline-none focus:border-violet-300"
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 max-h-56 overflow-auto">
                      {optionResults.map((option) => (
                        <button key={option.id} type="button" onClick={() => addOption(option.id)} className="rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-left hover:border-violet-300 hover:bg-violet-50 cursor-pointer">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-[10px] font-semibold text-zinc-800 truncate">{option.name}</div>
                            <Plus className="w-3 h-3 text-violet-500 shrink-0" />
                          </div>
                          <div className="text-[9px] font-mono text-zinc-500">Option ID {option.id}</div>
                        </button>
                      ))}
                    </div>
                    {!optionTemplates.length && !optionError && <div className="text-[10px] text-zinc-500 py-3 text-center">Đang đọc bảng 251 ItemOption từ JAR…</div>}
                  </div>
                </div>
              </section>

              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[10px] text-emerald-800 leading-relaxed">
                <CheckCircle2 className="w-3.5 h-3.5 inline mr-1.5 align-[-2px]" />
                Item mới được thêm vào bảng template trước khi export cuối, còn ItemOption được đóng vào runtime helper theo đúng Item ID mới. Vì vậy áo/quần mới có thể mang chỉ số thật, không chỉ hiện text.
              </div>

              {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-[10px] text-red-700 font-mono whitespace-pre-wrap">{error}</div>}
            </div>

            <aside className="space-y-3">
              <div className="rounded-xl border border-zinc-200 bg-white p-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[11px] font-semibold text-zinc-800">Ảnh icon vật phẩm</div>
                    <div className="text-[9px] text-zinc-500">Dùng Icon ID có sẵn hoặc tải PNG mới vào JAR.</div>
                  </div>
                  {customIcon && (
                    <button type="button" onClick={() => setCustomIcon(null)} className="text-[9px] px-2 py-1 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600 cursor-pointer">Bỏ PNG mới</button>
                  )}
                </div>

                {customIcon ? (
                  <div className="min-h-[210px] p-4 rounded-lg border border-emerald-200 bg-emerald-50 flex items-center justify-center overflow-hidden">
                    <img src={`data:image/png;base64,${customIcon.pngBase64}`} alt={values[3] || 'Icon mới'} className="max-h-48 max-w-full object-contain" style={{ imageRendering: 'pixelated' }} />
                  </div>
                ) : (
                  <SmallImagePreview session={session} imageId={Number.isInteger(iconId) ? iconId : -1} alt={values[3] || 'Item mới'} variant="hero" showTechnicalInfo />
                )}

                <label className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-xl border border-dashed border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-[10px] font-semibold text-emerald-700 cursor-pointer">
                  <ImagePlus className="w-4 h-4" />
                  <span>{customIcon ? 'Đổi sang PNG khác' : 'Tải PNG icon mới'}</span>
                  <input type="file" accept="image/png,.png" className="hidden" onChange={(event) => void chooseCustomIcon(event.target.files?.[0] ?? null)} />
                </label>

                {customIcon && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[9px] text-emerald-700 leading-relaxed">
                    <strong>{customIcon.fileName}</strong> · {(customIcon.size / 1024).toFixed(1)} KB. Khi build, writer tự tạo SmallImage ID mới không trùng và đổi field <code>icon_id</code> của item sang ID đó.
                  </div>
                )}
                {iconError && <div className="text-[9px] text-red-600">{iconError}</div>}
              </div>

              <div className="rounded-xl border border-zinc-200 bg-white p-3">
                <div className="text-[11px] font-semibold text-zinc-800 mb-2">Ngoại hình khi mặc</div>
                {usesPartAppearance ? (
                  <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-[10px] text-sky-800 leading-relaxed">
                    <div className="font-semibold mb-1">{selectedTypeLabel}: dùng Part #{values[7] || '?'}</div>
                    <div>Không cần Head / Body / Leg. Ba field đó được ẩn vì không áp dụng cho {selectedTypeLabel.toLowerCase()}.</div>
                  </div>
                ) : hasBody ? (
                  <NpcBodyPreview session={session} head={head} body={body} leg={leg} alt={values[3] || 'Ngoại hình item'} showTechnicalInfo />
                ) : (
                  <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-5 text-center text-[10px] text-zinc-500">Cải trang cần đủ mã Đầu / Thân / Chân để ghép preview. -1 = chưa dùng.</div>
                )}
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] text-amber-800 leading-relaxed">
                <AlertTriangle className="w-3.5 h-3.5 inline mr-1.5 align-[-2px]" />
                Item mới chưa tự xuất hiện trong shop/drop. Sau khi tạo, dùng chính Item ID mới ở panel Quái/Boss để cho rơi hoặc ở Shop khi writer shop được nối.
              </div>

              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-[10px] text-zinc-600">
                <div className="font-semibold text-zinc-800 mb-1">Kiểm tra trước khi build</div>
                <div>ID: <span className="font-mono">{values[0] || '—'}</span></div>
                <div>Loại: <span className="font-mono">{selectedTypeLabel} · mã {values[1] || '—'}</span></div>
                <div>Options: <span className="font-mono">{options.length}</span></div>
                <div>Icon: <span className="font-mono">{customIcon ? 'PNG mới → auto SmallImage ID' : `SmallImage #${values[6] || '?'}`}</span></div>
                <div>Nguồn: <span className="font-mono">{sourceClass}.u</span></div>
              </div>
            </aside>
          </div>
        </div>

        <div className="shrink-0 px-4 py-3 border-t border-zinc-200 bg-zinc-50 flex items-center justify-between gap-3">
          <div className="text-[10px] text-zinc-500 font-mono">
            {sourceClass}.u · item #{values[0] || '?'} · {options.length} option · {customIcon ? 'PNG icon mới' : `icon #${values[6] || '?'}`} 
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-100 text-[11px] font-medium cursor-pointer">Hủy</button>
            <button
              type="button"
              onClick={() => void build()}
              disabled={building || Boolean(validationError)}
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[11px] font-semibold flex items-center gap-2 cursor-pointer"
              title={validationError || 'Tạo item và Test workspace'}
            >
              {building ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackagePlus className="w-4 h-4" />}
              <span>{building ? 'Đang dựng JAR…' : 'Tạo + Test workspace'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
