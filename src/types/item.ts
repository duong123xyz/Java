import { CellEvidence } from './patch';

export interface ItemRecord {
  sourceClass: string;
  sourceField: string;
  sourceTableIndex: number;
  sourceRow: number;

  // Raw original string array extracted from bytecode cells
  rawValues: string[];

  // Dynamic schema mapped fields (15 fields)
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

  // Validation & diagnostics
  schemaMismatch?: boolean;
  actualColumnCount: number;
  expectedColumnCount: number;

  // Evidence
  evidence: {
    instructionOffsets: number[];
    summary: string;
  };

  // Fine-grained cell-level bytecode evidence for patch planning
  cellEvidences?: Record<number, CellEvidence>;
}

export interface ItemDraft {
  // Unique identity based on source location: `${sourceClass}|${sourceField}|${sourceRow}`
  key: string;
  sourceClass: string;
  sourceField: string;
  sourceTableIndex: number;
  sourceRow: number;

  // Original unmodified values from JAR
  originalValues: string[];

  // Current working draft values
  values: string[];

  // Indices of fields that differ from originalValues (0..14)
  dirtyFields: number[];
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
