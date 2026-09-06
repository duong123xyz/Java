import { JvmInstruction } from '../types/bytecode';
import { StringTableResult, StringTableRow } from '../types/item';
import { ConstantPoolEntry, CpTag, CpStringEntry, CpUtf8Entry } from '../types/constantPool';
import { CellEvidence } from '../types/patch';

interface RowCell {
  val: string;
  offsets: number[];
  evidence?: CellEvidence;
}

interface RowArrayObj {
  declaredLength: number;
  creationOffset: number;
  cells: Map<number, RowCell>;
  storeOffsets: number[];
}

interface OuterArrayObj {
  declaredLength: number;
  creationOffset: number;
  rows: Map<number, { row: RowArrayObj; offsets: number[] }>;
}

type StackItem =
  | { kind: 'int'; intVal: number; offset: number; inst?: JvmInstruction }
  | { kind: 'string'; strVal: string; offset: number; inst?: JvmInstruction }
  | { kind: 'null'; offset: number; inst?: JvmInstruction }
  | { kind: 'row_array'; rowArray: RowArrayObj; offset: number; inst?: JvmInstruction }
  | { kind: 'outer_array'; outerArray: OuterArrayObj; offset: number; inst?: JvmInstruction }
  | { kind: 'ref'; desc?: string; offset: number; inst?: JvmInstruction };

/**
 * Reconstructs String[][] table created inside <clinit> bytecode for a target field (e.g. 'u').
 * Follows the JVM specification stack machine model:
 *   push ROW_COUNT -> anewarray [Ljava/lang/String; -> loop (push rowIndex -> push COL_COUNT -> anewarray java/lang/String -> cell aastore -> row aastore) -> putstatic
 * Handles local variable caches, getstatic/putstatic reloads, and preserves original cell string values.
 * In Step 09, keeps precise, fine-grained bytecode evidence for EVERY cell.
 */
export function reconstructStringArrayTable(
  ownerInternalName: string,
  fieldName: string,
  descriptor: string,
  sourceTableIndex: number,
  instructions: JvmInstruction[],
  cp?: (ConstantPoolEntry | null)[],
  expectedColCount = 15
): StringTableResult {
  const stack: StackItem[] = [];
  const locals = new Map<number, StackItem>();
  const staticFields = new Map<string, StackItem>();
  const createdOuterArrays: OuterArrayObj[] = [];

  for (let i = 0; i < instructions.length; i++) {
    const inst = instructions[i];

    switch (inst.opcode) {
      // 0x00 nop
      case 0x00:
        break;

      // 0x01 aconst_null
      case 0x01:
        stack.push({ kind: 'null', offset: inst.offset, inst });
        break;

      // 0x02 iconst_m1
      case 0x02:
        stack.push({ kind: 'int', intVal: -1, offset: inst.offset, inst });
        break;

      // 0x03 iconst_0 .. 0x08 iconst_5
      case 0x03:
      case 0x04:
      case 0x05:
      case 0x06:
      case 0x07:
      case 0x08: {
        const val = inst.opcode - 0x03;
        stack.push({ kind: 'int', intVal: val, offset: inst.offset, inst });
        break;
      }

      // 0x10 bipush, 0x11 sipush
      case 0x10:
      case 0x11: {
        const val = typeof inst.pushValue === 'number' ? inst.pushValue : 0;
        stack.push({ kind: 'int', intVal: val, offset: inst.offset, inst });
        break;
      }

      // 0x12 ldc, 0x13 ldc_w
      case 0x12:
      case 0x13: {
        if (typeof inst.pushValue === 'string') {
          stack.push({ kind: 'string', strVal: inst.pushValue, offset: inst.offset, inst });
        } else if (typeof inst.pushValue === 'number') {
          // If it's an integer constant, store both intVal and string representation
          stack.push({
            kind: 'int',
            intVal: inst.pushValue,
            offset: inst.offset,
            inst,
          });
        } else if (inst.resolved) {
          const raw = inst.resolved.replace(/^"(.*)"$/, '$1');
          stack.push({ kind: 'string', strVal: raw, offset: inst.offset, inst });
        } else {
          stack.push({ kind: 'string', strVal: '', offset: inst.offset, inst });
        }
        break;
      }

      // 0x1A iload_0 .. 0x1D iload_3
      case 0x1A:
      case 0x1B:
      case 0x1C:
      case 0x1D: {
        const idx = inst.opcode - 0x1A;
        const val = locals.get(idx);
        if (val) stack.push(val);
        break;
      }

      // 0x15 iload
      case 0x15: {
        const idx = inst.operands[0] ?? 0;
        const val = locals.get(idx);
        if (val) stack.push(val);
        break;
      }

      // 0x2A aload_0 .. 0x2D aload_3
      case 0x2A:
      case 0x2B:
      case 0x2C:
      case 0x2D: {
        const idx = inst.opcode - 0x2A;
        const val = locals.get(idx);
        if (val) stack.push(val);
        break;
      }

      // 0x19 aload
      case 0x19: {
        const idx = inst.operands[0] ?? 0;
        const val = locals.get(idx);
        if (val) stack.push(val);
        break;
      }

      // 0x36 istore, 0x3B..0x3E istore_0..3
      case 0x36:
      case 0x3B:
      case 0x3C:
      case 0x3D:
      case 0x3E: {
        const idx =
          inst.opcode === 0x36
            ? (inst.operands[0] ?? 0)
            : inst.opcode - 0x3B;
        const val = stack.pop();
        if (val) locals.set(idx, val);
        break;
      }

      // 0x3A astore, 0x4B..0x4E astore_0..3
      case 0x3A:
      case 0x4B:
      case 0x4C:
      case 0x4D:
      case 0x4E: {
        const idx =
          inst.opcode === 0x3A
            ? (inst.operands[0] ?? 0)
            : inst.opcode - 0x4B;
        const val = stack.pop();
        if (val) locals.set(idx, val);
        break;
      }

      // 0x57 pop
      case 0x57:
        stack.pop();
        break;

      // 0x58 pop2
      case 0x58:
        stack.pop();
        stack.pop();
        break;

      // 0x59 dup
      case 0x59: {
        const top = stack[stack.length - 1];
        if (top) stack.push(top);
        break;
      }

      // 0x5A dup_x1
      case 0x5A: {
        if (stack.length >= 2) {
          const v1 = stack.pop()!;
          const v2 = stack.pop()!;
          stack.push(v1);
          stack.push(v2);
          stack.push(v1);
        }
        break;
      }

      // 0x5C dup2
      case 0x5C: {
        if (stack.length >= 2) {
          const v1 = stack[stack.length - 2];
          const v2 = stack[stack.length - 1];
          stack.push(v1);
          stack.push(v2);
        }
        break;
      }

      // 0x5F swap
      case 0x5F: {
        if (stack.length >= 2) {
          const v1 = stack.pop()!;
          const v2 = stack.pop()!;
          stack.push(v1);
          stack.push(v2);
        }
        break;
      }

      // 0xBD anewarray
      case 0xBD: {
        const lenVal = stack.pop();
        const declaredLength = lenVal && lenVal.kind === 'int' ? lenVal.intVal : 0;
        const refName = inst.classRef || inst.resolved || '';

        // Check if this is an outer 2D array (e.g. "[Ljava/lang/String;") or a 1D row array ("java/lang/String")
        const isOuter =
          refName.includes('[') ||
          refName.startsWith('[L') ||
          refName.endsWith(';') ||
          (declaredLength > expectedColCount && createdOuterArrays.length === 0);

        if (isOuter) {
          const outerObj: OuterArrayObj = {
            declaredLength,
            creationOffset: inst.offset,
            rows: new Map(),
          };
          createdOuterArrays.push(outerObj);
          stack.push({
            kind: 'outer_array',
            outerArray: outerObj,
            offset: inst.offset,
          });
        } else {
          const rowObj: RowArrayObj = {
            declaredLength,
            creationOffset: inst.offset,
            cells: new Map(),
            storeOffsets: [],
          };
          stack.push({
            kind: 'row_array',
            rowArray: rowObj,
            offset: inst.offset,
          });
        }
        break;
      }

      // 0x53 aastore
      case 0x53: {
        if (stack.length >= 3) {
          const valItem = stack.pop()!;
          const idxItem = stack.pop()!;
          const targetItem = stack.pop()!;

          const idx = idxItem.kind === 'int' ? idxItem.intVal : 0;

          if (targetItem.kind === 'row_array') {
            // Storing cell value into row array
            let strVal = '';
            if (valItem.kind === 'string') {
              strVal = valItem.strVal;
            } else if (valItem.kind === 'int') {
              strVal = String(valItem.intVal);
            } else if (valItem.kind === 'null') {
              strVal = '';
            }

            const offsets = [inst.offset, idxItem.offset, valItem.offset].filter(
              (o) => typeof o === 'number'
            );

            // Compute CellEvidence
            const producerInst = valItem.inst;
            const producerOpcode = producerInst?.opcode ?? (valItem.kind === 'null' ? 0x01 : 0);
            const producerMnemonic = producerInst?.mnemonic ?? (valItem.kind === 'null' ? 'aconst_null' : 'unknown');
            const cpIndex = producerInst?.cpIndex;
            let stringIndex: number | undefined;
            let utf8Index: number | undefined;
            let utf8Raw: string | undefined;
            let isUnsupported = false;
            let unsupportedReason: string | undefined;

            if (producerInst && (producerInst.opcode === 0x12 || producerInst.opcode === 0x13)) {
              if (cp && typeof cpIndex === 'number' && cpIndex >= 0 && cpIndex < cp.length) {
                const cpEntry = cp[cpIndex];
                if (cpEntry && cpEntry.tag === CpTag.String) {
                  stringIndex = cpIndex;
                  const strEntry = cpEntry as CpStringEntry;
                  utf8Index = strEntry.stringIndex;
                  if (utf8Index >= 0 && utf8Index < cp.length) {
                    const utf8Entry = cp[utf8Index];
                    if (utf8Entry && utf8Entry.tag === CpTag.Utf8) {
                      utf8Raw = (utf8Entry as CpUtf8Entry).value;
                    }
                  }
                } else {
                  isUnsupported = true;
                  unsupportedReason = `CP #${cpIndex} không phải CONSTANT_String (tag: ${cpEntry ? cpEntry.tag : 'null'})`;
                }
              }
            } else if (producerInst) {
              isUnsupported = true;
              unsupportedReason = `Producer opcode '${producerMnemonic}' (0x${producerOpcode.toString(16)}) không phải ldc/ldc_w`;
            } else {
              isUnsupported = true;
              unsupportedReason = 'Không tìm thấy producer instruction trong stack machine';
            }

            const cellEvidence: CellEvidence = {
              rowIndex: -1, // updated when row is assigned or reconstructed
              columnIndex: idx,
              sourceClass: ownerInternalName,
              sourceField: fieldName,
              producerInstructionOffset: valItem.offset,
              producerOpcode,
              producerMnemonic,
              constantPoolIndex: cpIndex,
              stringConstantIndex: stringIndex,
              utf8Index,
              utf8RawString: utf8Raw,
              aastoreInstructionOffset: inst.offset,
              originalValue: strVal,
              isUnsupportedProducer: isUnsupported,
              unsupportedReason,
            };

            targetItem.rowArray.cells.set(idx, {
              val: strVal,
              offsets,
              evidence: cellEvidence,
            });
            targetItem.rowArray.storeOffsets.push(inst.offset);
          } else if (targetItem.kind === 'outer_array') {
            // Storing row array into outer array
            if (valItem.kind === 'row_array') {
              const offsets = [inst.offset, idxItem.offset, valItem.rowArray.creationOffset].filter(
                (o) => typeof o === 'number'
              );
              targetItem.outerArray.rows.set(idx, {
                row: valItem.rowArray,
                offsets,
              });
            }
          }
        }
        break;
      }

      // 0xB3 putstatic
      case 0xB3: {
        const val = stack.pop();
        if (val && inst.fieldRef) {
          const fName = inst.fieldRef.name;
          const fOwner = inst.fieldRef.owner;
          staticFields.set(fName, val);
          staticFields.set(`${fOwner}.${fName}`, val);
        }
        break;
      }

      // 0xB2 getstatic
      case 0xB2: {
        if (inst.fieldRef) {
          const fName = inst.fieldRef.name;
          const fOwner = inst.fieldRef.owner;
          const val =
            staticFields.get(fName) ||
            staticFields.get(`${fOwner}.${fName}`);

          if (val) {
            stack.push(val);
          } else {
            stack.push({
              kind: 'ref',
              desc: `${fOwner}.${fName}`,
              offset: inst.offset,
              inst,
            });
          }
        }
        break;
      }

      default:
        // Ignore other instructions
        break;
    }
  }

  // Find the target outer array:
  // 1. Check staticFields for target fieldName (e.g. 'u')
  let targetOuterArray: OuterArrayObj | null = null;
  const staticVal =
    staticFields.get(fieldName) ||
    staticFields.get(`${ownerInternalName}.${fieldName}`);

  if (staticVal && staticVal.kind === 'outer_array') {
    targetOuterArray = staticVal.outerArray;
  }

  // 2. Fallback: Check createdOuterArrays (take the one with most rows or first)
  if (!targetOuterArray && createdOuterArrays.length > 0) {
    targetOuterArray = createdOuterArrays.reduce((prev, curr) =>
      curr.rows.size > prev.rows.size ? curr : prev
    );
  }

  if (!targetOuterArray) {
    return {
      owner: ownerInternalName,
      field: fieldName,
      descriptor,
      sourceTableIndex,
      rowCount: 0,
      rows: [],
      parseError: `Không tìm thấy outer array cho static field '${fieldName}' (${descriptor}) trong class '${ownerInternalName}'.`,
    };
  }

  // Reconstruct rows
  const reconstructedRows: StringTableRow[] = [];
  const maxRowIndex = Math.max(
    targetOuterArray.declaredLength - 1,
    ...Array.from(targetOuterArray.rows.keys())
  );

  for (let r = 0; r <= maxRowIndex; r++) {
    const rowEntry = targetOuterArray.rows.get(r);
    if (!rowEntry) {
      continue;
    }

    const rowObj = rowEntry.row;
    const values: string[] = [];
    const cellEvidences: Record<number, CellEvidence> = {};

    // Determine column count: if declaredLength > 0, use declaredLength; otherwise highest cell index + 1
    const maxCol = Math.max(
      rowObj.declaredLength - 1,
      ...Array.from(rowObj.cells.keys())
    );

    // Build raw values array without padding to fake correctness
    const colLimit = rowObj.declaredLength > 0 ? rowObj.declaredLength : maxCol + 1;
    for (let c = 0; c < colLimit; c++) {
      const cell = rowObj.cells.get(c);
      values.push(cell ? cell.val : '');
      if (cell && cell.evidence) {
        cell.evidence.rowIndex = r;
        cellEvidences[c] = cell.evidence;
      }
    }

    const isMismatch = values.length !== expectedColCount;

    reconstructedRows.push({
      rowIndex: r,
      values,
      evidence: {
        instructionOffsets: rowEntry.offsets,
        summary: `row ${r} with ${values.length} cols (creation offset ${rowObj.creationOffset})`,
      },
      cellEvidences,
      schemaMismatch: isMismatch,
    });
  }

  return {
    owner: ownerInternalName,
    field: fieldName,
    descriptor,
    sourceTableIndex,
    rowCount: reconstructedRows.length,
    rows: reconstructedRows,
  };
}
