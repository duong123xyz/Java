import { ItemRecord, ItemDraft, ItemOptionOverride, SchemaFieldMeta } from '../types/item';

/**
 * 15 cột dưới đây là ItemTemplate metadata, KHÔNG phải toàn bộ chỉ số chiến đấu.
 * HP/KI/Sức đánh/Giáp/Chí mạng... nằm ở ItemOption runtime (a/ab.b -> a/H[])
 * và được chỉnh riêng bằng optionOverrides trên ItemDraft.
 */
export const ITEM_SCHEMA_FIELDS: SchemaFieldMeta[] = [
  { index: 0, key: 'id', label: 'ID vật phẩm', group: 'general', type: 'number', description: 'ItemTemplate ID. Đây là ID dùng bởi shop/drop/inventory để nhận diện vật phẩm.' },
  { index: 1, key: 'type', label: 'Loại / slot', group: 'general', type: 'number', description: 'Mã type của game; quyết định nhóm trang bị/vật phẩm và nhiều nhánh xử lý runtime.' },
  { index: 2, key: 'gender', label: 'Hành tinh', group: 'general', type: 'number', description: '0: Trái Đất, 1: Namek, 2: Xayda, 3: dùng chung (theo dữ liệu JAR).' },
  { index: 3, key: 'name', label: 'Tên vật phẩm', group: 'general', type: 'string', description: 'Tên hiển thị trong game.' },
  { index: 4, key: 'description', label: 'Mô tả', group: 'general', type: 'string', description: 'Mô tả ItemTemplate. Chỉ sửa text; không tự tạo hiệu ứng/chỉ số.' },
  { index: 5, key: 'level', label: 'Level template', group: 'requirements', type: 'number', description: 'Cấp/level của ItemTemplate dùng bởi logic game; không phải level nhân vật.' },
  { index: 6, key: 'icon_id', label: 'Icon / SmallImage ID', group: 'visual', type: 'number', description: 'ID ảnh icon hiển thị của vật phẩm.' },
  { index: 7, key: 'part', label: 'Part ngoại hình', group: 'visual', type: 'number', description: 'Part/sprite ngoại hình của item; -1 nếu item không dùng part.' },
  { index: 8, key: 'is_up_to_up', label: 'Cho phép nâng cấp', group: 'requirements', type: 'number', description: 'Cờ nâng cấp theo quy ước của game; nên giữ giá trị gốc nếu chưa rõ nhánh xử lý type này.' },
  { index: 9, key: 'power_require', label: 'Sức mạnh yêu cầu', group: 'requirements', type: 'number', description: 'Mức sức mạnh tối thiểu để sử dụng/mặc item.' },
  { index: 10, key: 'gold', label: 'Giá vàng', group: 'requirements', type: 'number', description: 'Giá vàng lưu trong ItemTemplate.' },
  { index: 11, key: 'gem', label: 'Giá ngọc', group: 'requirements', type: 'number', description: 'Giá ngọc lưu trong ItemTemplate.' },
  { index: 12, key: 'head', label: 'Part đầu', group: 'visual', type: 'number', description: 'Sprite/part đầu dùng bởi một số cải trang/item ngoại hình.' },
  { index: 13, key: 'body', label: 'Part thân', group: 'visual', type: 'number', description: 'Sprite/part thân dùng bởi một số cải trang/item ngoại hình.' },
  { index: 14, key: 'leg', label: 'Part chân', group: 'visual', type: 'number', description: 'Sprite/part chân dùng bởi một số cải trang/item ngoại hình.' },
];

export function getItemDraftKey(sourceClass: string, sourceField: string, sourceRow: number): string {
  return `${sourceClass}|${sourceField}|${sourceRow}`;
}

function normalizeOptionOverrides(input: ItemOptionOverride[] | undefined): ItemOptionOverride[] {
  if (!Array.isArray(input)) return [];
  const byId = new Map<number, ItemOptionOverride>();
  for (const raw of input) {
    const optionId = Math.round(Number(raw?.optionId));
    const param = Math.round(Number(raw?.param));
    if (!Number.isInteger(optionId) || optionId < 0 || optionId > 32767) continue;
    if (!Number.isInteger(param) || param < -2147483648 || param > 2147483647) continue;
    byId.set(optionId, {
      optionId,
      param,
      enabled: raw?.enabled !== false,
      note: String(raw?.note || '').slice(0, 300),
    });
  }
  return Array.from(byId.values()).sort((a, b) => a.optionId - b.optionId);
}

function recalculateDirty(draft: ItemDraft): void {
  const dirty: number[] = [];
  const count = Math.max(draft.originalValues.length, draft.values.length, 15);
  for (let i = 0; i < count; i++) {
    const orig = draft.originalValues[i] ?? '';
    const curr = draft.values[i] ?? '';
    if (orig !== curr) dirty.push(i);
  }
  draft.dirtyFields = dirty;
  draft.optionOverrides = normalizeOptionOverrides(draft.optionOverrides);
  draft.isDirty = dirty.length > 0 || (draft.optionOverrides?.length ?? 0) > 0;
}

export function getOrCreateDraft(drafts: Map<string, ItemDraft>, item: ItemRecord): ItemDraft {
  const key = getItemDraftKey(item.sourceClass, item.sourceField, item.sourceRow);
  let draft = drafts.get(key);
  if (!draft) {
    const originalCopy = [...item.rawValues];
    const workingCopy = [...item.rawValues];
    while (originalCopy.length < 15) originalCopy.push('');
    while (workingCopy.length < 15) workingCopy.push('');
    draft = {
      key,
      sourceClass: item.sourceClass,
      sourceField: item.sourceField,
      sourceTableIndex: item.sourceTableIndex,
      sourceRow: item.sourceRow,
      originalValues: originalCopy,
      values: workingCopy,
      dirtyFields: [],
      optionOverrides: [],
      isDirty: false,
    };
    drafts.set(key, draft);
  } else {
    draft.optionOverrides = normalizeOptionOverrides(draft.optionOverrides);
    recalculateDirty(draft);
  }
  return draft;
}

export function setDraftField(
  drafts: Map<string, ItemDraft>,
  item: ItemRecord,
  colIndex: number,
  newValue: string
): ItemDraft {
  const draft = getOrCreateDraft(drafts, item);
  while (draft.values.length <= colIndex) draft.values.push('');
  draft.values[colIndex] = newValue;
  recalculateDirty(draft);
  return draft;
}

export function setItemOptionOverrides(
  drafts: Map<string, ItemDraft>,
  item: ItemRecord,
  overrides: ItemOptionOverride[]
): ItemDraft {
  const draft = getOrCreateDraft(drafts, item);
  draft.optionOverrides = normalizeOptionOverrides(overrides);
  recalculateDirty(draft);
  return draft;
}

export function resetDraftField(
  drafts: Map<string, ItemDraft>,
  item: ItemRecord,
  colIndex: number
): ItemDraft {
  const draft = getOrCreateDraft(drafts, item);
  draft.values[colIndex] = draft.originalValues[colIndex] ?? '';
  recalculateDirty(draft);
  return draft;
}

export function resetDraftItem(drafts: Map<string, ItemDraft>, item: ItemRecord): ItemDraft {
  const draft = getOrCreateDraft(drafts, item);
  draft.values = [...draft.originalValues];
  draft.dirtyFields = [];
  draft.optionOverrides = [];
  draft.isDirty = false;
  return draft;
}

export function discardAllDrafts(drafts: Map<string, ItemDraft>): void {
  drafts.clear();
}

export function getDirtyCount(drafts?: Map<string, ItemDraft>): number {
  if (!drafts) return 0;
  let count = 0;
  for (const draft of drafts.values()) {
    recalculateDirty(draft);
    if (draft.isDirty) count++;
  }
  return count;
}

export function getDirtyDrafts(drafts?: Map<string, ItemDraft>): ItemDraft[] {
  if (!drafts) return [];
  const list: ItemDraft[] = [];
  for (const draft of drafts.values()) {
    recalculateDirty(draft);
    if (draft.isDirty) list.push(draft);
  }
  return list;
}

export function getEffectiveItem(
  item: ItemRecord,
  drafts?: Map<string, ItemDraft>
): {
  id: string;
  name: string;
  description: string;
  type: string;
  gender: string;
  isDirty: boolean;
  dirtyCount: number;
  draft: ItemDraft | null;
} {
  if (!drafts) {
    return { id: item.id, name: item.name, description: item.description, type: item.type, gender: item.gender, isDirty: false, dirtyCount: 0, draft: null };
  }
  const key = getItemDraftKey(item.sourceClass, item.sourceField, item.sourceRow);
  const draft = drafts.get(key);
  if (draft) recalculateDirty(draft);
  if (draft?.isDirty) {
    return {
      id: draft.values[0] ?? item.id,
      name: draft.values[3] ?? item.name,
      description: draft.values[4] ?? item.description,
      type: draft.values[1] ?? item.type,
      gender: draft.values[2] ?? item.gender,
      isDirty: true,
      dirtyCount: draft.dirtyFields.length + (draft.optionOverrides?.length ?? 0),
      draft,
    };
  }
  return { id: item.id, name: item.name, description: item.description, type: item.type, gender: item.gender, isDirty: false, dirtyCount: 0, draft: null };
}

export function validateFieldValue(colIndex: number, value: string): string | null {
  const meta = ITEM_SCHEMA_FIELDS[colIndex];
  if (!meta) return null;
  if (meta.type === 'number') {
    const trimmed = value.trim();
    if (!trimmed) return 'Trường số không được để trống';
    if (!/^-?\d+$/.test(trimmed)) return 'Phải là số nguyên hợp lệ';
    const n = Number(trimmed);
    if (!Number.isSafeInteger(n)) return 'Giá trị vượt miền số nguyên an toàn của editor';
    if (colIndex === 0 && (n < 0 || n > 32767)) return 'Item ID phải nằm trong 0..32767 (template dùng short).';
  }
  return null;
}

export interface DuplicateIdLocation {
  key: string;
  sourceClass: string;
  sourceRow: number;
  name: string;
}

export function findDuplicateIds(
  targetId: string,
  currentItemKey: string,
  allItems: ItemRecord[],
  drafts?: Map<string, ItemDraft>
): DuplicateIdLocation[] {
  if (!targetId?.trim()) return [];
  const trimmedTarget = targetId.trim();
  const duplicates: DuplicateIdLocation[] = [];
  for (const item of allItems) {
    const key = getItemDraftKey(item.sourceClass, item.sourceField, item.sourceRow);
    if (key === currentItemKey) continue;
    let effectiveId = item.id;
    let effectiveName = item.name;
    if (drafts) {
      const d = drafts.get(key);
      if (d?.values[0] !== undefined) effectiveId = d.values[0];
      if (d?.values[3] !== undefined) effectiveName = d.values[3];
    }
    if (effectiveId.trim() === trimmedTarget) {
      duplicates.push({ key, sourceClass: item.sourceClass, sourceRow: item.sourceRow, name: effectiveName });
    }
  }
  return duplicates;
}
