import { ItemRecord, ItemDraft, SchemaFieldMeta } from '../types/item';

/**
 * Metadata cho 15 cột dữ liệu vật phẩm được phục dựng từ bytecode.
 * key/group/type là mã kỹ thuật phục vụ logic và KHÔNG được Việt hóa.
 * label/description là nội dung hiển thị cho người dùng và có thể chỉnh sửa.
 */
export const ITEM_SCHEMA_FIELDS: SchemaFieldMeta[] = [
  { index: 0, key: 'id', label: 'ID', group: 'general', type: 'number', description: 'Mã định danh duy nhất của vật phẩm' },
  { index: 1, key: 'type', label: 'Loại vật phẩm', group: 'general', type: 'number', description: 'Mã loại / nhóm vật phẩm' },
  { index: 2, key: 'gender', label: 'Hành tinh / giới tính', group: 'general', type: 'number', description: '0: Trái Đất, 1: Namếc, 2: Xayda, 3: dùng chung' },
  { index: 3, key: 'name', label: 'Tên vật phẩm', group: 'general', type: 'string', description: 'Tên hiển thị trong game (hỗ trợ Unicode tiếng Việt)' },
  { index: 4, key: 'description', label: 'Mô tả', group: 'general', type: 'string', description: 'Mô tả chi tiết của vật phẩm (hỗ trợ Unicode tiếng Việt)' },
  { index: 5, key: 'level', label: 'Cấp độ yêu cầu', group: 'requirements', type: 'number', description: 'Cấp độ tối thiểu để sử dụng vật phẩm' },
  { index: 6, key: 'icon_id', label: 'ID biểu tượng', group: 'visual', type: 'number', description: 'ID icon hiển thị trong trang bị / hành trang' },
  { index: 7, key: 'part', label: 'Part ngoại trang', group: 'visual', type: 'number', description: 'Mã part ngoại trang; -1 nếu không có' },
  { index: 8, key: 'is_up_to_up', label: 'Cờ nâng cấp', group: 'requirements', type: 'number', description: 'Giá trị cờ nâng cấp vật phẩm; giữ nguyên quy ước số của game' },
  { index: 9, key: 'power_require', label: 'Sức mạnh yêu cầu', group: 'requirements', type: 'number', description: 'Mức sức mạnh tối thiểu yêu cầu' },
  { index: 10, key: 'gold', label: 'Giá vàng', group: 'requirements', type: 'number', description: 'Giá mua / bán bằng vàng' },
  { index: 11, key: 'gem', label: 'Giá ngọc', group: 'requirements', type: 'number', description: 'Giá mua / bán bằng ngọc' },
  { index: 12, key: 'head', label: 'Part đầu', group: 'visual', type: 'number', description: 'Mã sprite / part phần đầu' },
  { index: 13, key: 'body', label: 'Part thân', group: 'visual', type: 'number', description: 'Mã sprite / part phần thân' },
  { index: 14, key: 'leg', label: 'Part chân', group: 'visual', type: 'number', description: 'Mã sprite / part phần chân' },
];

export function getItemDraftKey(sourceClass: string, sourceField: string, sourceRow: number): string {
  return `${sourceClass}|${sourceField}|${sourceRow}`;
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
  draft.isDirty = dirty.length > 0;
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
      isDirty: false,
    };
    drafts.set(key, draft);
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

export function resetDraftField(
  drafts: Map<string, ItemDraft>,
  item: ItemRecord,
  colIndex: number
): ItemDraft {
  const draft = getOrCreateDraft(drafts, item);
  const orig = draft.originalValues[colIndex] ?? '';
  draft.values[colIndex] = orig;
  recalculateDirty(draft);
  return draft;
}

export function resetDraftItem(drafts: Map<string, ItemDraft>, item: ItemRecord): ItemDraft {
  const draft = getOrCreateDraft(drafts, item);
  draft.values = [...draft.originalValues];
  draft.dirtyFields = [];
  draft.isDirty = false;
  return draft;
}

export function discardAllDrafts(drafts: Map<string, ItemDraft>): void {
  drafts.clear();
}

export function getDirtyCount(drafts?: Map<string, ItemDraft>): number {
  if (!drafts) return 0;
  let count = 0;
  for (const draft of drafts.values()) if (draft.isDirty) count++;
  return count;
}

export function getDirtyDrafts(drafts?: Map<string, ItemDraft>): ItemDraft[] {
  if (!drafts) return [];
  const list: ItemDraft[] = [];
  for (const draft of drafts.values()) if (draft.isDirty) list.push(draft);
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
    return {
      id: item.id,
      name: item.name,
      description: item.description,
      type: item.type,
      gender: item.gender,
      isDirty: false,
      dirtyCount: 0,
      draft: null,
    };
  }

  const key = getItemDraftKey(item.sourceClass, item.sourceField, item.sourceRow);
  const draft = drafts.get(key);
  if (draft && draft.isDirty) {
    return {
      id: draft.values[0] ?? item.id,
      name: draft.values[3] ?? item.name,
      description: draft.values[4] ?? item.description,
      type: draft.values[1] ?? item.type,
      gender: draft.values[2] ?? item.gender,
      isDirty: true,
      dirtyCount: draft.dirtyFields.length,
      draft,
    };
  }

  return {
    id: item.id,
    name: item.name,
    description: item.description,
    type: item.type,
    gender: item.gender,
    isDirty: false,
    dirtyCount: 0,
    draft: null,
  };
}

export function validateFieldValue(colIndex: number, value: string): string | null {
  const meta = ITEM_SCHEMA_FIELDS[colIndex];
  if (!meta) return null;

  if (meta.type === 'number') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return 'Trường số không được để trống';
    if (!/^-?\d+$/.test(trimmed)) return 'Phải là số nguyên hợp lệ (ví dụ: 0, 100, -1)';
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
  if (!targetId || targetId.trim() === '') return [];
  const trimmedTarget = targetId.trim();
  const duplicates: DuplicateIdLocation[] = [];

  for (const item of allItems) {
    const key = getItemDraftKey(item.sourceClass, item.sourceField, item.sourceRow);
    if (key === currentItemKey) continue;

    let effectiveId = item.id;
    let effectiveName = item.name;
    if (drafts) {
      const d = drafts.get(key);
      if (d && d.values[0] !== undefined) effectiveId = d.values[0];
      if (d && d.values[3] !== undefined) effectiveName = d.values[3];
    }

    if (effectiveId.trim() === trimmedTarget) {
      duplicates.push({
        key,
        sourceClass: item.sourceClass,
        sourceRow: item.sourceRow,
        name: effectiveName,
      });
    }
  }
  return duplicates;
}
