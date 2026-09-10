import { CellEvidence } from './patch';

export interface ItemRecord {
  sourceClass: string;
  sourceField: string;
  sourceTableIndex: number;
  sourceRow: number;
  rawValues: string[];
  id: string;
  type: string;
  gender: string;
  name: string;
  description: string;
  level: string;
  iconId: string;
  part: string;
  isUpToUp: string;
  powerRequire: string;
  gold: string;
  gem: string;
  head: string;
  body: string;
  leg: string;
  schemaMismatch?: boolean;
  actualColumnCount: number;
  expectedColumnCount: number;
  evidence: {
    instructionOffsets: number[];
    summary: string;
  };
  cellEvidences?: Record<number, CellEvidence>;
}

/**
 * Runtime option của một item instance (a/ab.b -> a/H[]).
 * optionId trỏ tới a/a/a/v.u; param là giá trị thay cho ký tự # trong mô tả option.
 */
export interface ItemOptionOverride {
  optionId: number;
  param: number;
  enabled: boolean;
  note?: string;
}

export interface ItemOptionTemplateRecord {
  id: number;
  name: string;
  sourceRow: number;
}

export interface ItemDraft {
  key: string;
  sourceClass: string;
  sourceField: string;
  sourceTableIndex: number;
  sourceRow: number;
  originalValues: string[];
  values: string[];
  dirtyFields: number[];
  /**
   * Không nằm trong 15 cột ItemTemplate. Writer runtime dùng danh sách này để
   * SET/thêm option cho mọi instance có cùng ItemTemplate ID trong game.
   */
  optionOverrides?: ItemOptionOverride[];
  isDirty: boolean;
}

export interface SchemaFieldMeta {
  index: number;
  key: string;
  label: string;
  group: 'general' | 'requirements' | 'visual';
  type: 'string' | 'number';
  description?: string;
}

export interface StringTableRow {
  rowIndex: number;
  values: string[];
  evidence: {
    instructionOffsets: number[];
    summary: string;
  };
  cellEvidences?: Record<number, CellEvidence>;
  schemaMismatch?: boolean;
}

export interface StringTableResult {
  owner: string;
  field: string;
  descriptor: string;
  sourceTableIndex: number;
  rowCount: number;
  rows: StringTableRow[];
  parseError?: string;
}

export interface ItemAnalysisDiagnostics {
  schemaColumns: string[];
  schemaColumnCount: number;
  totalSourceTables: number;
  tablesParsed: number;
  rowsReconstructed: number;
  rowsValid: number;
  rowsWithMismatch: number;
  parseErrors: Array<{
    sourceClass: string;
    error: string;
  }>;
}

export interface SourceTableFilterInfo {
  index: number;
  shortName: string;
  ownerInternalName: string;
  count: number;
}

export interface ItemAnalysisSessionData {
  diagnostics: ItemAnalysisDiagnostics;
  sourceTables: StringTableResult[];
  items: ItemRecord[];
  sourceFilters: SourceTableFilterInfo[];
}

export interface ItemAnalysisProgress {
  current: number;
  total: number;
  currentClass: string;
  percent: number;
}
