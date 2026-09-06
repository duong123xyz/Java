import { BinaryWriter } from '../lib/binary/BinaryWriter';
import { parseClassFile } from './classFileParser';
import { encodeModifiedUtf8, getModifiedUtf8ByteLength } from './modifiedUtf8Service';
import { reconstructStringArrayTable } from './stringArrayTableAnalyzer';
import { ClassFileInfo, LoadedJarSession } from '../types/jar';
import {
  ClassPatchGroup,
  ClassRewriteResult,
  AppliedPatchLog,
  SemanticCellDiff,
  StructuralMetrics,
  ItemFieldPatchPlan,
} from '../types/patch';
import { ConstantPoolEntry, CpTag, CpUtf8Entry, CpStringEntry } from '../types/constantPool';
import { AttributeInfo, CodeAttribute, FieldInfo, MethodInfo } from '../types/bytecode';
import { ITEM_SCHEMA_FIELDS } from './itemDraftService';

/**
 * Checks if method has branching instructions or exception handlers crossing a target offset.
 */
function hasCrossCuttingBranches(
  codeBytes: Uint8Array,
  targetOffset: number,
  exceptionTable: CodeAttribute['exceptionTable']
): boolean {
  for (const ex of exceptionTable) {
    if (ex.startPc <= targetOffset && ex.endPc >= targetOffset) {
      return true;
    }
  }

  // Branch opcodes in JVM
  // ifeq (153) to jsr (168), ifnull (198), ifnonnull (199), goto_w (200), jsr_w (201)
  let offset = 0;
  while (offset < codeBytes.length) {
    const op = codeBytes[offset];
    if ((op >= 153 && op <= 168) || op === 198 || op === 199) {
      // 3-byte branch instruction with 16-bit signed branch offset
      const branchOffset = (codeBytes[offset + 1] << 8) | codeBytes[offset + 2];
      const target = offset + branchOffset;
      if ((offset < targetOffset && target > targetOffset) || (offset > targetOffset && target < targetOffset)) {
        return true;
      }
      offset += 3;
    } else if (op === 200 || op === 201) {
      // 5-byte branch instruction with 32-bit signed branch offset
      const branchOffset =
        (codeBytes[offset + 1] << 24) |
        (codeBytes[offset + 2] << 16) |
        (codeBytes[offset + 3] << 8) |
        codeBytes[offset + 4];
      const target = offset + branchOffset;
      if ((offset < targetOffset && target > targetOffset) || (offset > targetOffset && target < targetOffset)) {
        return true;
      }
      offset += 5;
    } else if (op === 170 || op === 171) {
      // tableswitch / lookupswitch
      return true;
    } else {
      offset += 1;
    }
  }

  return false;
}

/**
 * Serializes the binary payload of the 'Code' attribute.
 */
function serializeCodeAttributePayload(code: CodeAttribute, codeBytes: Uint8Array): Uint8Array {
  const writer = new BinaryWriter(codeBytes.length + 64);
  writer.writeU2(code.maxStack);
  writer.writeU2(code.maxLocals);
  writer.writeU4(codeBytes.length);
  writer.writeBytes(codeBytes);

  writer.writeU2(code.exceptionTable.length);
  for (const ex of code.exceptionTable) {
    writer.writeU2(ex.startPc);
    writer.writeU2(ex.endPc);
    writer.writeU2(ex.handlerPc);
    writer.writeU2(ex.catchType);
  }

  writer.writeU2(code.attributes.length);
  for (const attr of code.attributes) {
    writer.writeU2(attr.attributeNameIndex);
    writer.writeU4(attr.data.length);
    writer.writeBytes(attr.data);
  }

  return writer.toUint8Array();
}

/**
 * Serializes a constant pool array to big-endian JVM bytecode bytes.
 */
function serializeConstantPool(
  writer: BinaryWriter,
  cp: (ConstantPoolEntry | null)[]
): void {
  // CP count is 1-indexed (indices 1 .. count-1)
  const count = cp.length;
  writer.writeU2(count);

  for (let i = 1; i < count; i++) {
    const entry = cp[i];
    if (!entry) continue;

    if (entry.tag === CpTag.Reserved) {
      // Reserved entry occupied by the second slot of Long/Double; do not serialize tag
      continue;
    }

    switch (entry.tag) {
      case CpTag.Utf8: {
        writer.writeU1(CpTag.Utf8);
        const encoded = encodeModifiedUtf8(entry.value);
        writer.writeU2(encoded.length);
        writer.writeBytes(encoded);
        break;
      }
      case CpTag.Integer: {
        writer.writeU1(CpTag.Integer);
        writer.writeI4(entry.value);
        break;
      }
      case CpTag.Float: {
        writer.writeU1(CpTag.Float);
        writer.writeF4(entry.value);
        break;
      }
      case CpTag.Long: {
        writer.writeU1(CpTag.Long);
        writer.writeU4(entry.highBytes);
        writer.writeU4(entry.lowBytes);
        break;
      }
      case CpTag.Double: {
        writer.writeU1(CpTag.Double);
        writer.writeF8(entry.value);
        break;
      }
      case CpTag.Class: {
        writer.writeU1(CpTag.Class);
        writer.writeU2(entry.nameIndex);
        break;
      }
      case CpTag.String: {
        writer.writeU1(CpTag.String);
        writer.writeU2(entry.stringIndex);
        break;
      }
      case CpTag.Fieldref: {
        writer.writeU1(CpTag.Fieldref);
        writer.writeU2(entry.classIndex);
        writer.writeU2(entry.nameAndTypeIndex);
        break;
      }
      case CpTag.Methodref: {
        writer.writeU1(CpTag.Methodref);
        writer.writeU2(entry.classIndex);
        writer.writeU2(entry.nameAndTypeIndex);
        break;
      }
      case CpTag.InterfaceMethodref: {
        writer.writeU1(CpTag.InterfaceMethodref);
        writer.writeU2(entry.classIndex);
        writer.writeU2(entry.nameAndTypeIndex);
        break;
      }
      case CpTag.NameAndType: {
        writer.writeU1(CpTag.NameAndType);
        writer.writeU2(entry.nameIndex);
        writer.writeU2(entry.descriptorIndex);
        break;
      }
      case CpTag.MethodHandle: {
        writer.writeU1(CpTag.MethodHandle);
        writer.writeU1(entry.referenceKind);
        writer.writeU2(entry.referenceIndex);
        break;
      }
      case CpTag.MethodType: {
        writer.writeU1(CpTag.MethodType);
        writer.writeU2(entry.descriptorIndex);
        break;
      }
      case CpTag.Dynamic:
      case CpTag.InvokeDynamic: {
        writer.writeU1(entry.tag);
        writer.writeU2(entry.bootstrapMethodAttrIndex);
        writer.writeU2(entry.nameAndTypeIndex);
        break;
      }
      case CpTag.Module:
      case CpTag.Package: {
        writer.writeU1(entry.tag);
        writer.writeU2(entry.nameIndex);
        break;
      }
      default:
        throw new Error(`Cannot serialize unsupported constant pool tag: ${(entry as any).tag}`);
    }
  }
}

/**
 * Serializes the complete ClassFile structure to an ArrayBuffer.
 */
function serializeClassFile(
  classInfo: ClassFileInfo,
  constantPool: (ConstantPoolEntry | null)[],
  fields: FieldInfo[],
  methods: MethodInfo[],
  classAttributes: AttributeInfo[]
): ArrayBuffer {
  const writer = new BinaryWriter(classInfo.byteLength + 2048);

  // 1. Magic
  writer.writeU4(0xcafebabe);

  // 2. Minor & Major Version
  writer.writeU2(classInfo.minorVersion);
  writer.writeU2(classInfo.majorVersion);

  // 3. Constant Pool
  serializeConstantPool(writer, constantPool);

  // 4. Access Flags, This Class, Super Class
  writer.writeU2(classInfo.accessFlags);
  const thisClassIdx = classInfo.thisClassIndex ?? 1;
  const superClassIdx = classInfo.superClassIndex ?? (classInfo.internalSuperClassName ? 2 : 0);
  writer.writeU2(thisClassIdx);
  writer.writeU2(superClassIdx);

  // 5. Interfaces
  const interfaces = classInfo.interfaces || [];
  writer.writeU2(interfaces.length);
  for (const ifaceIdx of interfaces) {
    writer.writeU2(ifaceIdx);
  }

  // 6. Fields
  writer.writeU2(fields.length);
  for (const field of fields) {
    writer.writeU2(field.accessFlags);
    writer.writeU2(field.nameIndex);
    writer.writeU2(field.descriptorIndex);
    writer.writeU2(field.attributes.length);
    for (const attr of field.attributes) {
      writer.writeU2(attr.attributeNameIndex);
      writer.writeU4(attr.data.length);
      writer.writeBytes(attr.data);
    }
  }

  // 7. Methods
  writer.writeU2(methods.length);
  for (const method of methods) {
    writer.writeU2(method.accessFlags);
    writer.writeU2(method.nameIndex);
    writer.writeU2(method.descriptorIndex);
    writer.writeU2(method.attributes.length);
    for (const attr of method.attributes) {
      writer.writeU2(attr.attributeNameIndex);
      writer.writeU4(attr.data.length);
      writer.writeBytes(attr.data);
    }
  }

  // 8. Class Attributes
  writer.writeU2(classAttributes.length);
  for (const attr of classAttributes) {
    writer.writeU2(attr.attributeNameIndex);
    writer.writeU4(attr.data.length);
    writer.writeBytes(attr.data);
  }

  return writer.toArrayBuffer();
}

/**
 * Rewrites a single Java Class in RAM according to a ClassPatchGroup.
 * Pure in-memory rewrite; originalBytes remains completely immutable.
 */
export async function rewriteClass(
  originalBytes: ArrayBuffer,
  classFileInfo: ClassFileInfo,
  patchGroup: ClassPatchGroup,
  session?: LoadedJarSession
): Promise<ClassRewriteResult> {
  const originalSize = originalBytes.byteLength;
  const originalCpCount = classFileInfo.constantPoolCount;

  // Track strategy logs
  const appliedPlans: AppliedPatchLog[] = [];
  let instructionsResized = 0;

  // STEP 1: Pre-write verification
  const clinitMethod = classFileInfo.methods.find((m) => m.name === '<clinit>');
  if (!clinitMethod || !clinitMethod.code) {
    return {
      sourceClass: patchGroup.sourceClass,
      status: 'FAILED',
      errorMessage: `Không tìm thấy method <clinit> hoặc Code attribute trong ${patchGroup.sourceClass}`,
      originalBytes,
      appliedPlans: [],
      semanticDiffs: [],
      expectedChangedCount: patchGroup.plans.length,
      actualChangedCount: 0,
      unexpectedChangedCount: 0,
      metrics: {
        originalClassSize: originalSize,
        rewrittenClassSize: originalSize,
        sizeDelta: 0,
        originalCpCount,
        rewrittenCpCount: originalCpCount,
        cpEntriesAdded: 0,
        originalCodeLength: 0,
        rewrittenCodeLength: 0,
        codeLengthDelta: 0,
        instructionsResized: 0,
      },
      originalUnchanged: true,
      zipMutated: false,
    };
  }

  const originalCodeLength = clinitMethod.code.codeLength;
  const originalCodeBytes = clinitMethod.code.code;

  // Verify each plan against current class info
  for (const plan of patchGroup.plans) {
    if (!plan.hasEvidence || plan.producerOffset < 0 || plan.producerOffset >= originalCodeBytes.length) {
      return {
        sourceClass: patchGroup.sourceClass,
        status: 'FAILED',
        errorMessage: `STALE_EVIDENCE: Producer offset ${plan.producerOffset} vượt ngoài bytecode bounds`,
        originalBytes,
        appliedPlans: [],
        semanticDiffs: [],
        expectedChangedCount: patchGroup.plans.length,
        actualChangedCount: 0,
        unexpectedChangedCount: 0,
        metrics: {
          originalClassSize: originalSize,
          rewrittenClassSize: originalSize,
          sizeDelta: 0,
          originalCpCount,
          rewrittenCpCount: originalCpCount,
          cpEntriesAdded: 0,
          originalCodeLength,
          rewrittenCodeLength: originalCodeLength,
          codeLengthDelta: 0,
          instructionsResized: 0,
        },
        originalUnchanged: true,
        zipMutated: false,
      };
    }

    const currentOpcode = originalCodeBytes[plan.producerOffset];
    if (currentOpcode !== plan.producerOpcode) {
      return {
        sourceClass: patchGroup.sourceClass,
        status: 'FAILED',
        errorMessage: `STALE_EVIDENCE: Opcode tại offset ${plan.producerOffset} (0x${currentOpcode.toString(16)}) không khớp evidence (0x${plan.producerOpcode.toString(16)})`,
        originalBytes,
        appliedPlans: [],
        semanticDiffs: [],
        expectedChangedCount: patchGroup.plans.length,
        actualChangedCount: 0,
        unexpectedChangedCount: 0,
        metrics: {
          originalClassSize: originalSize,
          rewrittenClassSize: originalSize,
          sizeDelta: 0,
          originalCpCount,
          rewrittenCpCount: originalCpCount,
          cpEntriesAdded: 0,
          originalCodeLength,
          rewrittenCodeLength: originalCodeLength,
          codeLengthDelta: 0,
          instructionsResized: 0,
        },
        originalUnchanged: true,
        zipMutated: false,
      };
    }
  }

  // STEP 2: Clone Constant Pool and prepare modifications
  const cp: (ConstantPoolEntry | null)[] = classFileInfo.constantPool.map((entry) => {
    if (!entry) return null;
    return { ...entry } as ConstantPoolEntry;
  });

  // Track newly created CONSTANT_String entries in this rewrite pass to reuse across patches
  const newlyCreatedStrings = new Map<string, number>();

  // Working copy of bytecode for <clinit>
  // We may need offset mapping if instruction expands (e.g. ldc -> ldc_w)
  let codeBytes = new Uint8Array(originalCodeBytes);

  // Helper to find existing CONSTANT_String matching value
  function findExistingStringConstant(val: string): number | null {
    for (let i = 1; i < cp.length; i++) {
      const entry = cp[i];
      if (entry && entry.tag === CpTag.String) {
        const utf8 = cp[entry.stringIndex];
        if (utf8 && utf8.tag === CpTag.Utf8 && utf8.value === val) {
          return entry.index;
        }
      }
    }
    return null;
  }

  // Helper to count how many CP entries reference a given Utf8 entry
  function countUtf8References(utf8Idx: number): number {
    let refs = 0;
    for (let i = 1; i < cp.length; i++) {
      const entry = cp[i];
      if (!entry) continue;
      if (entry.tag === CpTag.String && entry.stringIndex === utf8Idx) refs++;
      if (entry.tag === CpTag.Class && entry.nameIndex === utf8Idx) refs++;
      if (entry.tag === CpTag.NameAndType && (entry.nameIndex === utf8Idx || entry.descriptorIndex === utf8Idx)) refs++;
    }
    return refs;
  }

  // Sort plans by producerOffset descending so if any instruction expansion occurs, earlier offsets stay unaffected
  const sortedPlans = [...patchGroup.plans].sort((a, b) => b.producerOffset - a.producerOffset);

  for (const plan of sortedPlans) {
    const draftVal = plan.draftValue;
    const origVal = plan.originalValue;
    const pOffset = plan.producerOffset;
    const curOpcode = codeBytes[pOffset];

    const oldProducerStr =
      curOpcode === 0x12
        ? `ldc #${codeBytes[pOffset + 1]}`
        : curOpcode === 0x13
        ? `ldc_w #${(codeBytes[pOffset + 1] << 8) | codeBytes[pOffset + 2]}`
        : `opcode 0x${curOpcode.toString(16)}`;

    // STRATEGY SELECTION
    // Priority A: Reuse existing exact CONSTANT_String in constant pool
    const existingCpIndex = findExistingStringConstant(draftVal);
    let chosenStrategy: 'REUSE_EXISTING_STRING' | 'REWRITE_UNIQUE_UTF8' | 'CLONE_AND_RETARGET';
    let targetCpStringIndex: number | null = null;
    let newProducerStr = oldProducerStr;

    // Check if existing constant can be reused without opcode expansion
    const canReuseDirectly =
      existingCpIndex !== null &&
      ((curOpcode === 0x12 && existingCpIndex <= 255) || curOpcode === 0x13);

    if (canReuseDirectly && existingCpIndex !== null) {
      chosenStrategy = 'REUSE_EXISTING_STRING';
      targetCpStringIndex = existingCpIndex;

      if (curOpcode === 0x12) {
        codeBytes[pOffset + 1] = existingCpIndex;
        newProducerStr = `ldc #${existingCpIndex}`;
      } else {
        codeBytes[pOffset + 1] = (existingCpIndex >> 8) & 0xff;
        codeBytes[pOffset + 2] = existingCpIndex & 0xff;
        newProducerStr = `ldc_w #${existingCpIndex}`;
      }

      appliedPlans.push({
        planId: plan.id,
        sourceRow: plan.sourceRow,
        columnIndex: plan.columnIndex,
        fieldName: plan.fieldName,
        originalValue: origVal,
        draftValue: draftVal,
        strategyUsed: chosenStrategy,
        details: `Reused existing CONSTANT_String #${existingCpIndex} ("${draftVal}")`,
        oldProducer: oldProducerStr,
        newProducer: newProducerStr,
      });
      continue;
    }

    // Priority B: Unique constant in-place rewrite of CONSTANT_Utf8
    // If not shared and utf8 entry is unique
    const isPlanUnique = !plan.isShared || plan.strategy === 'UNIQUE_REPLACE';
    const utf8Index = plan.utf8Index;
    const canRewriteUnique =
      isPlanUnique &&
      utf8Index !== undefined &&
      utf8Index > 0 &&
      utf8Index < cp.length &&
      cp[utf8Index]?.tag === CpTag.Utf8 &&
      countUtf8References(utf8Index) === 1;

    if (canRewriteUnique && utf8Index !== undefined) {
      chosenStrategy = 'REWRITE_UNIQUE_UTF8';
      // In-place rewrite of Utf8 constant
      const utf8Entry = cp[utf8Index] as CpUtf8Entry;
      utf8Entry.value = draftVal;

      appliedPlans.push({
        planId: plan.id,
        sourceRow: plan.sourceRow,
        columnIndex: plan.columnIndex,
        fieldName: plan.fieldName,
        originalValue: origVal,
        draftValue: draftVal,
        strategyUsed: chosenStrategy,
        details: `Rewrote unique CONSTANT_Utf8 #${utf8Index} in-place ("${origVal}" -> "${draftVal}")`,
        oldProducer: oldProducerStr,
        newProducer: oldProducerStr,
      });
      continue;
    }

    // Priority C: Shared constant -> Clone new CONSTANT_Utf8 + CONSTANT_String and retarget
    chosenStrategy = 'CLONE_AND_RETARGET';

    if (newlyCreatedStrings.has(draftVal)) {
      targetCpStringIndex = newlyCreatedStrings.get(draftVal)!;
    } else {
      // Create new Utf8
      const newUtf8Idx = cp.length;
      const newUtf8Entry: CpUtf8Entry = {
        tag: CpTag.Utf8,
        index: newUtf8Idx,
        value: draftVal,
      };
      cp.push(newUtf8Entry);

      // Create new String
      const newStrIdx = cp.length;
      const newStrEntry: CpStringEntry = {
        tag: CpTag.String,
        index: newStrIdx,
        stringIndex: newUtf8Idx,
      };
      cp.push(newStrEntry);

      newlyCreatedStrings.set(draftVal, newStrIdx);
      targetCpStringIndex = newStrIdx;
    }

    // Retarget producer instruction
    if (curOpcode === 0x12) {
      if (targetCpStringIndex <= 255) {
        // Can stay ldc
        codeBytes[pOffset + 1] = targetCpStringIndex;
        newProducerStr = `ldc #${targetCpStringIndex}`;
      } else {
        // Must expand ldc -> ldc_w (code size increases by 1 byte)
        if (hasCrossCuttingBranches(codeBytes, pOffset, clinitMethod.code.exceptionTable)) {
          return {
            sourceClass: patchGroup.sourceClass,
            status: 'FAILED',
            errorMessage: `UNSUPPORTED_CODE_RESIZE: Không thể expand ldc thành ldc_w vì method có control flow / branches crossing offset ${pOffset}`,
            originalBytes,
            appliedPlans,
            semanticDiffs: [],
            expectedChangedCount: patchGroup.plans.length,
            actualChangedCount: 0,
            unexpectedChangedCount: 0,
            metrics: {
              originalClassSize: originalSize,
              rewrittenClassSize: originalSize,
              sizeDelta: 0,
              originalCpCount,
              rewrittenCpCount: cp.length,
              cpEntriesAdded: cp.length - originalCpCount,
              originalCodeLength,
              rewrittenCodeLength: codeBytes.length,
              codeLengthDelta: codeBytes.length - originalCodeLength,
              instructionsResized,
            },
            originalUnchanged: true,
            zipMutated: false,
          };
        }

        // Expand instruction: 0x12 u1 -> 0x13 u2
        const newCode = new Uint8Array(codeBytes.length + 1);
        newCode.set(codeBytes.subarray(0, pOffset));
        newCode[pOffset] = 0x13; // ldc_w
        newCode[pOffset + 1] = (targetCpStringIndex >> 8) & 0xff;
        newCode[pOffset + 2] = targetCpStringIndex & 0xff;
        newCode.set(codeBytes.subarray(pOffset + 2), pOffset + 3);
        codeBytes = newCode;

        instructionsResized++;
        newProducerStr = `ldc_w #${targetCpStringIndex}`;
      }
    } else if (curOpcode === 0x13) {
      codeBytes[pOffset + 1] = (targetCpStringIndex >> 8) & 0xff;
      codeBytes[pOffset + 2] = targetCpStringIndex & 0xff;
      newProducerStr = `ldc_w #${targetCpStringIndex}`;
    }

    appliedPlans.push({
      planId: plan.id,
      sourceRow: plan.sourceRow,
      columnIndex: plan.columnIndex,
      fieldName: plan.fieldName,
      originalValue: origVal,
      draftValue: draftVal,
      strategyUsed: chosenStrategy,
      details: `Cloned CONSTANT_String #${targetCpStringIndex} and retargeted producer instruction`,
      oldProducer: oldProducerStr,
      newProducer: newProducerStr,
    });
  }

  // Restore plans order for reporting
  appliedPlans.reverse();

  // STEP 3: Assemble Method Attributes & ClassFile
  const updatedCodePayload = serializeCodeAttributePayload(clinitMethod.code, codeBytes);

  const updatedMethods: MethodInfo[] = classFileInfo.methods.map((m) => {
    if (m.name !== '<clinit>') {
      return m;
    }
    const updatedAttrs = m.attributes.map((a) => {
      if (a.name === 'Code') {
        return {
          attributeNameIndex: a.attributeNameIndex,
          name: 'Code',
          data: updatedCodePayload,
        };
      }
      return a;
    });

    return {
      ...m,
      attributes: updatedAttrs,
    };
  });

  const rewrittenBytes = serializeClassFile(
    classFileInfo,
    cp,
    classFileInfo.fields,
    updatedMethods,
    classFileInfo.attributes || []
  );

  const rewrittenSize = rewrittenBytes.byteLength;
  const rewrittenCpCount = cp.length;
  const cpEntriesAdded = rewrittenCpCount - originalCpCount;
  const rewrittenCodeLength = codeBytes.length;
  const codeLengthDelta = rewrittenCodeLength - originalCodeLength;

  const metrics: StructuralMetrics = {
    originalClassSize: originalSize,
    rewrittenClassSize: rewrittenSize,
    sizeDelta: rewrittenSize - originalSize,
    originalCpCount,
    rewrittenCpCount,
    cpEntriesAdded,
    originalCodeLength,
    rewrittenCodeLength,
    codeLengthDelta,
    instructionsResized,
  };

  // STEP 4: Parse Rewritten Class to verify valid JVM class structure
  let rewrittenClassInfo: ClassFileInfo;
  try {
    rewrittenClassInfo = parseClassFile(rewrittenBytes);
  } catch (parseErr: any) {
    return {
      sourceClass: patchGroup.sourceClass,
      status: 'FAILED',
      errorMessage: `Class parse failed on rewritten bytes: ${parseErr.message || String(parseErr)}`,
      originalBytes,
      rewrittenBytes,
      appliedPlans,
      semanticDiffs: [],
      expectedChangedCount: patchGroup.plans.length,
      actualChangedCount: 0,
      unexpectedChangedCount: 0,
      metrics,
      originalUnchanged: true,
      zipMutated: false,
    };
  }

  if (
    rewrittenClassInfo.magic !== 0xcafebabe ||
    rewrittenClassInfo.internalClassName !== classFileInfo.internalClassName ||
    rewrittenClassInfo.remainingBytes !== 0
  ) {
    return {
      sourceClass: patchGroup.sourceClass,
      status: 'FAILED',
      errorMessage: `Rewritten class validation failed: remainingBytes = ${rewrittenClassInfo.remainingBytes}, magic = 0x${rewrittenClassInfo.magic.toString(16)}`,
      originalBytes,
      rewrittenBytes,
      appliedPlans,
      semanticDiffs: [],
      expectedChangedCount: patchGroup.plans.length,
      actualChangedCount: 0,
      unexpectedChangedCount: 0,
      metrics,
      originalUnchanged: true,
      zipMutated: false,
    };
  }

  // STEP 5: Reconstruct Table u from both Original and Rewritten class bytecode
  const targetFieldName = patchGroup.plans[0]?.sourceField || 'u';
  const targetFieldInfo = classFileInfo.fields.find((f) => f.name === targetFieldName);
  const targetDescriptor = targetFieldInfo?.descriptor || '[[Ljava/lang/String;';

  const origClinit = classFileInfo.methods.find((m) => m.name === '<clinit>');
  const newClinit = rewrittenClassInfo.methods.find((m) => m.name === '<clinit>');

  if (!origClinit?.code?.instructions || !newClinit?.code?.instructions) {
    return {
      sourceClass: patchGroup.sourceClass,
      status: 'FAILED',
      errorMessage: 'Could not decode instructions for <clinit> in rewritten class',
      originalBytes,
      rewrittenBytes,
      appliedPlans,
      semanticDiffs: [],
      expectedChangedCount: patchGroup.plans.length,
      actualChangedCount: 0,
      unexpectedChangedCount: 0,
      metrics,
      originalUnchanged: true,
      zipMutated: false,
    };
  }

  const schemaCols = session?.itemAnalysis?.diagnostics.schemaColumns || ITEM_SCHEMA_FIELDS.map((f) => f.key);
  const expectedColCount = schemaCols.length;

  const origTable = reconstructStringArrayTable(
    classFileInfo.internalClassName,
    targetFieldName,
    targetDescriptor,
    0,
    origClinit.code.instructions,
    classFileInfo.constantPool,
    expectedColCount
  );

  const newTable = reconstructStringArrayTable(
    rewrittenClassInfo.internalClassName,
    targetFieldName,
    targetDescriptor,
    0,
    newClinit.code.instructions,
    rewrittenClassInfo.constantPool,
    expectedColCount
  );

  // STEP 6: Semantic Table Diff across ALL rows and columns
  const semanticDiffs: SemanticCellDiff[] = [];
  const expectedPlansMap = new Map<string, ItemFieldPatchPlan>();
  for (const p of patchGroup.plans) {
    expectedPlansMap.set(`${p.sourceRow}|${p.columnIndex}`, p);
  }

  const maxRows = Math.max(origTable.rows.length, newTable.rows.length);
  for (let r = 0; r < maxRows; r++) {
    const origRow = origTable.rows[r];
    const newRow = newTable.rows[r];
    const origVals = origRow?.values || [];
    const newVals = newRow?.values || [];
    const maxCols = Math.max(origVals.length, newVals.length, expectedColCount);

    for (let c = 0; c < maxCols; c++) {
      const origCell = origVals[c] ?? '';
      const newCell = newVals[c] ?? '';

      if (origCell !== newCell) {
        const planKey = `${r}|${c}`;
        const plan = expectedPlansMap.get(planKey);
        const expected = plan !== undefined;
        const fieldName = plan ? plan.fieldName : schemaCols[c] || `col_${c}`;

        semanticDiffs.push({
          rowIndex: r,
          columnIndex: c,
          fieldName,
          originalValue: origCell,
          rewrittenValue: newCell,
          expected,
        });
      }
    }
  }

  const expectedChangedCount = patchGroup.plans.length;
  const actualChangedCount = semanticDiffs.length;
  const unexpectedChangedCount = semanticDiffs.filter((d) => !d.expected).length;

  // STEP 7: Check original immutability
  let originalUnchanged = true;
  try {
    const checkOrig = parseClassFile(originalBytes);
    if (checkOrig.byteLength !== originalSize) {
      originalUnchanged = false;
    }
  } catch {
    originalUnchanged = false;
  }

  // STEP 8: Final validation result determination
  const isValidationSuccess =
    unexpectedChangedCount === 0 &&
    actualChangedCount === expectedChangedCount &&
    originalUnchanged;

  return {
    sourceClass: patchGroup.sourceClass,
    status: isValidationSuccess ? 'VALIDATED' : 'FAILED',
    errorMessage: !isValidationSuccess
      ? unexpectedChangedCount > 0
        ? `UNEXPECTED_SIDE_EFFECT: Phát hiện ${unexpectedChangedCount} cell ngoài target bị thay đổi`
        : `Số cell thay đổi (${actualChangedCount}) không khớp số patch plan mong đợi (${expectedChangedCount})`
      : undefined,
    originalBytes,
    rewrittenBytes,
    appliedPlans,
    semanticDiffs,
    expectedChangedCount,
    actualChangedCount,
    unexpectedChangedCount,
    metrics,
    originalUnchanged,
    zipMutated: false,
  };
}
