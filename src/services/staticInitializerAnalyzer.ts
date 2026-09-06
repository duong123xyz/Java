import { ConstantPoolEntry } from '../types/constantPool';
import {
  DetectedStaticArray,
  FieldInfo,
  JvmInstruction,
  MethodInfo,
  StaticAnalysisResult,
  StaticArrayElement,
} from '../types/bytecode';

/**
 * Reconstructs static array initializations from decoded <clinit> JVM bytecode instructions.
 * Pure logic function - no React dependencies.
 */
export function analyzeStaticInitializer(
  method: MethodInfo,
  instructions: JvmInstruction[],
  _fields: FieldInfo[],
  _cp: (ConstantPoolEntry | null)[]
): StaticAnalysisResult {
  const detectedArrays: DetectedStaticArray[] = [];
  const warnings: string[] = [];

  // Track pending array currently being populated
  interface PendingArray {
    creationOffset: number;
    declaredLength: number;
    elementClass?: string;
    elements: Map<number, StaticArrayElement>;
  }

  let currentPendingArray: PendingArray | null = null;

  for (let i = 0; i < instructions.length; i++) {
    const inst = instructions[i];

    // Check for array instantiation: push length + anewarray / newarray
    if (inst.mnemonic === 'anewarray' || inst.mnemonic === 'newarray') {
      // Find the instruction immediately before that pushed the array length
      const prevInst = i > 0 ? instructions[i - 1] : null;
      let declaredLength = 0;
      if (prevInst && typeof prevInst.pushValue === 'number') {
        declaredLength = prevInst.pushValue;
      }

      currentPendingArray = {
        creationOffset: prevInst ? prevInst.offset : inst.offset,
        declaredLength,
        elementClass: inst.classRef || inst.resolved,
        elements: new Map<number, StaticArrayElement>(),
      };
      continue;
    }

    // Check for array element store: aastore
    if (inst.mnemonic === 'aastore' && currentPendingArray) {
      // Trace backwards from aastore to find: value instruction, index instruction, dup instruction
      if (i >= 2) {
        const valInst = instructions[i - 1];
        const idxInst = instructions[i - 2];
        const dupInst = i >= 3 && instructions[i - 3].mnemonic === 'dup' ? instructions[i - 3] : null;

        if (typeof idxInst.pushValue === 'number') {
          const index = idxInst.pushValue;
          const offsets: number[] = [];
          if (dupInst) offsets.push(dupInst.offset);
          offsets.push(idxInst.offset);
          offsets.push(valInst.offset);
          offsets.push(inst.offset);

          let element: StaticArrayElement;

          if (valInst.mnemonic === 'getstatic' && valInst.fieldRef) {
            const owner = valInst.fieldRef.owner;
            const name = valInst.fieldRef.name;
            const descriptor = valInst.fieldRef.descriptor;
            const fullRef = `${owner}.${name}`;
            const displayRef = `${owner.replace(/\//g, '.')}.${name}`;

            element = {
              index,
              valueType: 'fieldref',
              fieldRef: {
                owner,
                name,
                descriptor,
                fullRef,
                displayRef,
              },
              evidence: {
                instructionOffsets: offsets,
                summary: `${idxInst.mnemonic} (${index}) -> ${valInst.mnemonic} ${valInst.operandDisplay || ''} (${fullRef}) -> aastore`,
              },
            };
          } else {
            // String or literal value
            let stringVal = '';
            if (typeof valInst.pushValue === 'string') {
              stringVal = valInst.pushValue;
            } else if (typeof valInst.pushValue === 'number') {
              stringVal = String(valInst.pushValue);
            } else if (valInst.resolved) {
              stringVal = valInst.resolved.replace(/^"(.*)"$/, '$1');
            }

            element = {
              index,
              valueType: 'string',
              stringValue: stringVal,
              evidence: {
                instructionOffsets: offsets,
                summary: `${idxInst.mnemonic} (${index}) -> ${valInst.mnemonic} ${valInst.operandDisplay || ''} ("${stringVal}") -> aastore`,
              },
            };
          }

          currentPendingArray.elements.set(index, element);
        }
      }
      continue;
    }

    // Check for final static field assignment: putstatic
    if (inst.mnemonic === 'putstatic' && currentPendingArray && inst.fieldRef) {
      const fieldRef = inst.fieldRef;
      const elementsList: StaticArrayElement[] = [];

      // Reconstruct elements sorted by index
      const maxIdx = Math.max(
        currentPendingArray.declaredLength - 1,
        ...Array.from(currentPendingArray.elements.keys())
      );

      for (let idx = 0; idx <= maxIdx; idx++) {
        const el = currentPendingArray.elements.get(idx);
        if (el) {
          elementsList.push(el);
        }
      }

      detectedArrays.push({
        fieldName: fieldRef.name,
        fieldDescriptor: fieldRef.descriptor,
        displayType: formatTypeDescriptor(fieldRef.descriptor),
        declaredLength: currentPendingArray.declaredLength,
        elementCount: elementsList.length,
        targetFieldOwner: fieldRef.owner,
        elements: elementsList,
        creationOffset: currentPendingArray.creationOffset,
        putstaticOffset: inst.offset,
      });

      // Reset pending array after putstatic
      currentPendingArray = null;
    }
  }

  if (detectedArrays.length === 0) {
    warnings.push('No static array assignments to static fields detected in this method.');
  }

  return {
    analyzedMethod: `${method.name} ${method.descriptor}`,
    detectedArrays,
    warnings,
  };
}

/**
 * Formats a JVM type descriptor into readable Java-like type syntax.
 * e.g. [Ljava/lang/String; -> String[]
 * e.g. [[[Ljava/lang/String; -> String[][][]
 */
export function formatTypeDescriptor(descriptor: string): string {
  let arrayDims = 0;
  let cursor = 0;

  while (cursor < descriptor.length && descriptor[cursor] === '[') {
    arrayDims++;
    cursor++;
  }

  const base = descriptor.substring(cursor);
  let baseName = base;

  if (base.startsWith('L') && base.endsWith(';')) {
    const rawClass = base.substring(1, base.length - 1);
    const parts = rawClass.split('/');
    baseName = parts[parts.length - 1]; // e.g. String
  } else {
    switch (base) {
      case 'I':
        baseName = 'int';
        break;
      case 'B':
        baseName = 'byte';
        break;
      case 'C':
        baseName = 'char';
        break;
      case 'S':
        baseName = 'short';
        break;
      case 'J':
        baseName = 'long';
        break;
      case 'F':
        baseName = 'float';
        break;
      case 'D':
        baseName = 'double';
        break;
      case 'Z':
        baseName = 'boolean';
        break;
      case 'V':
        baseName = 'void';
        break;
    }
  }

  return baseName + '[]'.repeat(arrayDims);
}
