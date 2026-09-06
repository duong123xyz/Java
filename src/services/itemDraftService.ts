import { ItemRecord, ItemDraft, SchemaFieldMeta } from '../types/item';

/**
 * Metadata for 15 runtime item schema columns extracted from bytecode.
 * Split into logical desktop groups: general, requirements, visual.
 */
export const ITEM_SCHEMA_FIELDS: SchemaFieldMeta[] = [
  { index: 0, key: 'id', label: 'ID', group: 'general', type: 'number', description: 'Mã định danh item' },
  { index: 1, key: 'type', label: 'TYPE', group: 'general', type: 'number', description: 'Loại item / category' },
  { index: 2, key: 'gender', label: 'gender', group: 'general', type: 'number', description: 'Giới tính (0: Trái Đất, 1: Namếc, 2: Xayda, 3: Chung)' },
  { index: 3, key: 'name', label: 'NAME', group: 'general', type: 'string', description: 'Tên hiển thị (Unicode tiếng Việt)' },
  { index: 4, key: 'description', label: 'description', group: 'general', type: 'string', description: 'Mô tả chi tiết (Unicode tiếng Việt)' },
  { index: 5, key: 'level', label: 'level', group: 'requirements', type: 'number', description: 'Cấp độ yêu cầu' },
  { index: 6, key: 'icon_id', label: 'icon_id', group: 'visual', type: 'number', description: 'ID icon trang bị / hành trang' },
  { index: 7, key: 'part', label: 'part', group: 'visual', type: 'number', description: 'Part ngoại trang (-1 nếu không có)' },
  { index: 8, key: 'is_up_to_up', label: 'is_up_to_up', group: 'requirements', type: 'number', description: 'Cờ nâng cấp vật phẩm' },
  { index: 9, key: 'power_require', label: 'power_require', group: 'requirements', type: 'number', description: 'Sức mạnh tối thiểu yêu cầu' },
  { index: 10, key: 'gold', label: 'gold', group: 'requirements', type: 'number', description: 'Giá bán / mua bằng vàng' },
  { index: 11, key: 'gem', label: 'gem', group: 'requirements', type: 'number', description: 'Giá bán / mua bằng ngọc' },
  { index: 12, key: 'head', label: 'head', group: 'visual', type: 'number', description: 'Sprite part đầu' },
  { index: 13, key: 'body', label: 'body', group: 'visual', type: 'number', description: 'Sprite part thân' },
  { index: 14, key: 'leg', label: 'leg', group: 'visual', type: 'number', description: 'Sprite part chân' },
];

/**
 * Generate a unique identity key based on source location.
 * MUST NOT use item ID as key because IDs can be duplicate or edited.
 * Case-sensitive.
 */
export function getItemDraftKey(sourceClass: string, sourceField: string, sourceRow: number): string {
  return `${sourceClass}|${sourceField}|${sourceRow}`;
}

/**
 * Helper to calculate dirty fields for a draft compared to its original values.
 */
function recalculateDirty(draft: ItemDraft): void {
  const dirty: number[] = [];
  const count = Math.max(draft.originalValues.length, draft.values.length, 15);
  for (let i = 0; i < count; i++) {
    const orig = draft.originalValues[i] ?? '';
    const curr = draft.values[i] ?? '';
    if (orig !== curr) {
      dirty.push(i);
    }
  }
  draft.dirtyFields = dirty;
  draft.isDirty = dirty.length > 0;
}

/**
 * Retrieve or create an in-memory draft for a given ItemRecord.
 * Original values are strictly copied and NEVER mutated.
 */
export function getOrCreateDraft(drafts: Map<string, ItemDraft>, item: ItemRecord): ItemDraft {
  const key = getItemDraftKey(item.sourceClass, item.sourceField, item.sourceRow);
  let draft = drafts.get(key);

  if (!draft) {
    // Clone rawValues to guarantee original values cannot be mutated
    const originalCopy = [...item.rawValues];
    const workingCopy = [...item.rawValues];

    // Ensure array has at least 15 slots
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

/**
 * Set a specific field in the draft. Preserves raw String (never auto-converts "001" to "1").
 */
export function setDraftField(
  drafts: Map<string, ItemDraft>,
  item: ItemRecord,
  colIndex: number,
  newValue: string
): ItemDraft {
  const draft = getOrCreateDraft(drafts, item);
  // Ensure capacity
  while (draft.values.length <= colIndex) {
    draft.values.push('');
  }
  draft.values[colIndex] = newValue;
  recalculateDirty(draft);
  return draft;
}

/**
 * Reset a single field in the draft back to its original value.
 */
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

/**
 * Reset the entire item draft back to its original values.
 */
export function resetDraftItem(
  drafts: Map<string, ItemDraft>,
  item: ItemRecord
): ItemDraft {
  const draft = getOrCreateDraft(drafts, item);
  draft.values = [...draft.originalValues];
  draft.dirtyFields = [];
  draft.isDirty = false;
  return draft;
}

/**
 * Discard all drafts in memory (reset all to original).
 */
export function discardAllDrafts(drafts: Map<string, ItemDraft>): void {
  drafts.clear();
}

/**
 * Get count of items that have uncommitted in-memory changes.
 */
export function getDirtyCount(drafts?: Map<string, ItemDraft>): number {
  if (!drafts) return 0;
  let count = 0;
  for (const draft of drafts.values()) {
    if (draft.isDirty) count++;
  }
  return count;
}

/**
 * Get all dirty drafts currently in memory.
 */
export function getDirtyDrafts(drafts?: Map<string, ItemDraft>): ItemDraft[] {
  if (!drafts) return [];
  const list: ItemDraft[] = [];
  for (const draft of drafts.values()) {
    if (draft.isDirty) {
      list.push(draft);
    }
  }
  return list;
}

/**
 * Get effective values for display in lists/tables.
 * If draft exists and is dirty, returns draft values; otherwise original values.
 */
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

/**
 * Validate a field value according to its column type.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateFieldValue(colIndex: number, value: string): string | null {
  const meta = ITEM_SCHEMA_FIELDS[colIndex];
  if (!meta) return null;

  if (meta.type === 'number') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return 'Trường số không được để trống';
    }
    // Allow negative integer (e.g. -1 for part) or non-negative integer
    if (!/^-?\d+$/.test(trimmed)) {
      return 'Phải là số nguyên hợp lệ (ví dụ: 0, 100, -1)';
    }
  }

  return null;
}

export interface DuplicateIdLocation {
  key: string;
  sourceClass: string;
  sourceRow: number;
  name: string;
}

/**
 * Scan for duplicate IDs across all items (checking draft values first).
 * Does not block editing, only warns the user.
 */
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

    // Check effective ID of this item
    let effectiveId = item.id;
    let effectiveName = item.name;

    if (drafts) {
      const d = drafts.get(key);
      if (d && d.values[0] !== undefined) {
        effectiveId = d.values[0];
      }
      if (d && d.values[3] !== undefined) {
        effectiveName = d.values[3];
      }
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
