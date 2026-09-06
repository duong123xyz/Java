import { LoadedJarSession, ClassFileInfo } from '../types/jar';
import {
  ItemRecord,
  ItemAnalysisSessionData,
  ItemAnalysisProgress,
  StringTableResult,
  SourceTableFilterInfo,
} from '../types/item';
import { parseClassFile } from './classFileParser';
import { analyzeStaticInitializer } from './staticInitializerAnalyzer';
import { reconstructStringArrayTable } from './stringArrayTableAnalyzer';

/**
 * Orchestrator service to reconstruct Item Tables dynamically from bytecode.
 * 1. Reads a/a/a/h.class -> extracts schema from aF (String[15]) and sources from b (String[][][][13])
 * 2. Parses each source class dynamically (exact case-sensitive path lookup)
 * 3. Reconstructs u: String[][] from <clinit> bytecode
 * 4. Combines rows with schema to create read-only ItemRecord[]
 * 5. Caches output in session.itemAnalysis
 */
export async function analyzeItemTables(
  session: LoadedJarSession,
  onProgress?: (progress: ItemAnalysisProgress) => void
): Promise<ItemAnalysisSessionData> {
  // If already analyzed and cached in this session, return immediately
  if (session.itemAnalysis) {
    return session.itemAnalysis;
  }

  // Helper to get or parse class file
  const getClassInfo = async (path: string): Promise<ClassFileInfo> => {
    if (session.classParseCache && session.classParseCache.has(path)) {
      return session.classParseCache.get(path)!;
    }

    const entry = session.entries.find((e) => e.path === path);
    if (!entry) {
      throw new Error(`Không tìm thấy entry '${path}' trong file JAR.`);
    }

    const buffer = await entry.zipEntry.async('arraybuffer');
    const classInfo = parseClassFile(buffer);

    if (!session.classParseCache) {
      session.classParseCache = new Map();
    }
    session.classParseCache.set(path, classInfo);

    return classInfo;
  };

  // STEP 1: Load and analyze a/a/a/h.class
  const hClassInfo = await getClassInfo('a/a/a/h.class');
  const hClinit = hClassInfo.methods.find((m) => m.name === '<clinit>');
  if (!hClinit || !hClinit.code?.instructions) {
    throw new Error(
      'Không thể giải mã bytecode method <clinit> của class a/a/a/h.class.'
    );
  }

  const hStaticAnalysis = analyzeStaticInitializer(
    hClinit,
    hClinit.code.instructions,
    hClassInfo.fields,
    hClassInfo.constantPool
  );

  // Extract schema from field aF
  const afArray = hStaticAnalysis.detectedArrays.find(
    (arr) => arr.fieldName === 'aF'
  );
  if (!afArray) {
    throw new Error(
      'Không tìm thấy static array aF (schema) trong <clinit> của a/a/a/h.class.'
    );
  }

  const schemaColumns = afArray.elements
    .sort((a, b) => a.index - b.index)
    .map((el) => (el.valueType === 'string' ? el.stringValue : ''));

  if (schemaColumns.length === 0) {
    throw new Error('Static array aF trong a/a/a/h.class không có phần tử nào.');
  }

  // Extract source list from field b
  const bArray = hStaticAnalysis.detectedArrays.find(
    (arr) => arr.fieldName === 'b'
  );
  if (!bArray) {
    throw new Error(
      'Không tìm thấy static array b (data sources) trong <clinit> của a/a/a/h.class.'
    );
  }

  const sourceMetaList = bArray.elements
    .sort((a, b) => a.index - b.index)
    .map((el) => {
      const fRef = el.fieldRef;
      if (!fRef) {
        throw new Error(
          `Phần tử #${el.index} của field b không phải là Fieldref hợp lệ.`
        );
      }
      return {
        sourceIndex: el.index,
        ownerInternalName: fRef.owner, // e.g. "a/a/a/i", "a/a/a/r"
        fieldName: fRef.name, // e.g. "u"
        descriptor: fRef.descriptor, // e.g. "[[Ljava/lang/String;"
      };
    });

  const totalSources = sourceMetaList.length;
  const sourceTables: StringTableResult[] = [];
  const parseErrors: Array<{ sourceClass: string; error: string }> = [];

  // STEP 2: Parse each source class dynamically
  for (let i = 0; i < totalSources; i++) {
    const src = sourceMetaList[i];
    const classPath = `${src.ownerInternalName}.class`;

    // Notify progress
    if (onProgress) {
      onProgress({
        current: i + 1,
        total: totalSources,
        currentClass: src.ownerInternalName,
        percent: Math.round(((i + 1) / totalSources) * 100),
      });
    }

    // Yield thread slightly so React UI updates smoothly
    await new Promise((resolve) => setTimeout(resolve, 15));

    try {
      const srcClassInfo = await getClassInfo(classPath);
      const srcClinit = srcClassInfo.methods.find((m) => m.name === '<clinit>');

      if (!srcClinit || !srcClinit.code?.instructions) {
        parseErrors.push({
          sourceClass: src.ownerInternalName,
          error: `Không tìm thấy method <clinit> hoặc instructions trong ${classPath}`,
        });
        continue;
      }

      // Reconstruct String[][] u table
      const tableResult = reconstructStringArrayTable(
        src.ownerInternalName,
        src.fieldName,
        src.descriptor,
        src.sourceIndex,
        srcClinit.code.instructions,
        srcClassInfo.constantPool,
        schemaColumns.length
      );

      if (tableResult.parseError) {
        parseErrors.push({
          sourceClass: src.ownerInternalName,
          error: tableResult.parseError,
        });
      }

      sourceTables.push(tableResult);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      parseErrors.push({
        sourceClass: src.ownerInternalName,
        error: message,
      });
    }
  }

  // STEP 3: Map schema columns to item fields dynamically
  const colIndexMap = new Map<string, number>();
  schemaColumns.forEach((colName, idx) => {
    colIndexMap.set(colName.toLowerCase().replace(/_/g, ''), idx);
  });

  const items: ItemRecord[] = [];

  for (const table of sourceTables) {
    for (const row of table.rows) {
      const rawValues = row.values;
      const actualCount = rawValues.length;
      const expectedCount = schemaColumns.length;
      const isMismatch = row.schemaMismatch || actualCount !== expectedCount;

      const id = rawValues[colIndexMap.get('id') ?? 0] ?? '';
      const type = rawValues[colIndexMap.get('type') ?? 1] ?? '';
      const gender = rawValues[colIndexMap.get('gender') ?? 2] ?? '';
      const name = rawValues[colIndexMap.get('name') ?? 3] ?? '';
      const description = rawValues[colIndexMap.get('description') ?? 4] ?? '';
      const level = rawValues[colIndexMap.get('level') ?? 5] ?? '';
      const iconId = rawValues[colIndexMap.get('iconid') ?? 6] ?? '';
      const part = rawValues[colIndexMap.get('part') ?? 7] ?? '';
      const isUpToUp = rawValues[colIndexMap.get('isuptoup') ?? 8] ?? '';
      const powerRequire = rawValues[colIndexMap.get('powerrequire') ?? 9] ?? '';
      const gold = rawValues[colIndexMap.get('gold') ?? 10] ?? '';
      const gem = rawValues[colIndexMap.get('gem') ?? 11] ?? '';
      const head = rawValues[colIndexMap.get('head') ?? 12] ?? '';
      const body = rawValues[colIndexMap.get('body') ?? 13] ?? '';
      const leg = rawValues[colIndexMap.get('leg') ?? 14] ?? '';

      items.push({
        sourceClass: table.owner,
        sourceField: table.field,
        sourceTableIndex: table.sourceTableIndex,
        sourceRow: row.rowIndex,
        rawValues,
        id,
        type,
        gender,
        name,
        description,
        level,
        iconId,
        part,
        isUpToUp,
        powerRequire,
        gold,
        gem,
        head,
        body,
        leg,
        schemaMismatch: isMismatch,
        actualColumnCount: actualCount,
        expectedColumnCount: expectedCount,
        evidence: {
          instructionOffsets: row.evidence.instructionOffsets,
          summary: `${table.owner}.${table.field} [row ${row.rowIndex}]: ${row.evidence.summary}`,
        },
        cellEvidences: row.cellEvidences,
      });
    }
  }

  // STEP 4: Build source table filter metadata dynamically
  const sourceFilters: SourceTableFilterInfo[] = sourceMetaList.map((src) => {
    const shortName = src.ownerInternalName.split('/').pop() || src.ownerInternalName;
    const count = items.filter((item) => item.sourceClass === src.ownerInternalName).length;
    return {
      index: src.sourceIndex,
      shortName,
      ownerInternalName: src.ownerInternalName,
      count,
    };
  });

  const rowsWithMismatch = items.filter((it) => it.schemaMismatch).length;
  const rowsValid = items.length - rowsWithMismatch;

  const resultData: ItemAnalysisSessionData = {
    diagnostics: {
      schemaColumns,
      schemaColumnCount: schemaColumns.length,
      totalSourceTables: totalSources,
      tablesParsed: sourceTables.filter((t) => !t.parseError).length,
      rowsReconstructed: items.length,
      rowsValid,
      rowsWithMismatch,
      parseErrors,
    },
    sourceTables,
    items,
    sourceFilters,
  };

  // Cache in session
  session.itemAnalysis = resultData;

  return resultData;
}
