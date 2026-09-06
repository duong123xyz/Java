import { ConstantPoolEntry, CpTag } from '../types/constantPool';
import {
  AttributeInfo,
  CodeAttribute,
  ExceptionTableEntry,
  JvmInstruction,
  MethodInfo,
} from '../types/bytecode';
import { BinaryReader } from '../lib/binary/BinaryReader';
import {
  resolveClassName,
  resolveMemberRef,
  resolveString,
  resolveUtf8,
} from './constantPoolResolver';

/**
 * Parses the 'Code' attribute from a method's attribute list according to the JVM specification.
 */
export function parseMethodCodeAttribute(
  method: MethodInfo,
  cp: (ConstantPoolEntry | null)[]
): CodeAttribute | null {
  const codeAttr = method.attributes.find((a) => a.name === 'Code');
  if (!codeAttr) {
    return null;
  }

  const reader = new BinaryReader(codeAttr.data);
  if (reader.remaining() < 8) {
    throw new Error('Code attribute is too short for header');
  }

  const maxStack = reader.readU2();
  const maxLocals = reader.readU2();
  const codeLength = reader.readU4();

  if (codeLength > reader.remaining()) {
    throw new Error(
      `Declared code_length ${codeLength} exceeds remaining attribute data (${reader.remaining()} bytes)`
    );
  }

  const code = reader.readBytes(codeLength);

  if (reader.remaining() < 2) {
    throw new Error('Code attribute truncated before exception_table_length');
  }

  const exceptionTableLength = reader.readU2();
  const exceptionTable: ExceptionTableEntry[] = [];
  for (let i = 0; i < exceptionTableLength; i++) {
    exceptionTable.push({
      startPc: reader.readU2(),
      endPc: reader.readU2(),
      handlerPc: reader.readU2(),
      catchType: reader.readU2(),
    });
  }

  const attributesCount = reader.readU2();
  const attributes: AttributeInfo[] = [];
  for (let i = 0; i < attributesCount; i++) {
    const attributeNameIndex = reader.readU2();
    const attrLength = reader.readU4();
    const data = reader.readBytes(attrLength);
    const name = resolveUtf8(cp, attributeNameIndex);
    attributes.push({ attributeNameIndex, name, data });
  }

  const { instructions, error: decodeError } = decodeBytecode(code, cp);

  return {
    maxStack,
    maxLocals,
    codeLength,
    code,
    exceptionTable,
    attributes,
    instructions,
    decodeError,
  };
}

/**
 * Decodes raw JVM bytecode stream into structured JvmInstruction list.
 * Safe fallback: stops on unknown opcode with descriptive error.
 */
export function decodeBytecode(
  code: Uint8Array,
  cp: (ConstantPoolEntry | null)[]
): { instructions: JvmInstruction[]; error?: string } {
  const instructions: JvmInstruction[] = [];
  let offset = 0;
  const length = code.length;

  while (offset < length) {
    const startOffset = offset;
    const opcode = code[offset++];

    switch (opcode) {
      // 0x00 nop
      case 0x00:
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'nop',
          length: 1,
          operands: [],
        });
        break;

      // 0x01 aconst_null
      case 0x01:
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'aconst_null',
          length: 1,
          operands: [],
          resolved: 'null',
        });
        break;

      // 0x02 iconst_m1
      case 0x02:
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'iconst_m1',
          length: 1,
          operands: [],
          pushValue: -1,
          resolved: '-1',
        });
        break;

      // 0x03 iconst_0 .. 0x08 iconst_5
      case 0x03:
      case 0x04:
      case 0x05:
      case 0x06:
      case 0x07:
      case 0x08: {
        const val = opcode - 0x03;
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: `iconst_${val}`,
          length: 1,
          operands: [],
          pushValue: val,
          resolved: String(val),
        });
        break;
      }

      // 0x10 bipush (signed byte)
      case 0x10: {
        if (offset >= length) {
          return {
            instructions,
            error: `Truncated bipush operand at offset ${startOffset}`,
          };
        }
        const rawByte = code[offset++];
        // Convert to signed 8-bit integer
        const signedVal = (rawByte << 24) >> 24;
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'bipush',
          length: 2,
          operands: [rawByte],
          pushValue: signedVal,
          operandDisplay: String(signedVal),
          resolved: String(signedVal),
        });
        break;
      }

      // 0x11 sipush (signed short)
      case 0x11: {
        if (offset + 1 >= length) {
          return {
            instructions,
            error: `Truncated sipush operand at offset ${startOffset}`,
          };
        }
        const b1 = code[offset++];
        const b2 = code[offset++];
        const rawVal = (b1 << 8) | b2;
        const signedVal = (rawVal << 16) >> 16;
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'sipush',
          length: 3,
          operands: [b1, b2],
          pushValue: signedVal,
          operandDisplay: String(signedVal),
          resolved: String(signedVal),
        });
        break;
      }

      // 0x12 ldc (unsigned 8-bit CP index)
      case 0x12: {
        if (offset >= length) {
          return {
            instructions,
            error: `Truncated ldc operand at offset ${startOffset}`,
          };
        }
        const cpIndex = code[offset++];
        const resolved = resolveLdcConstant(cp, cpIndex);
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'ldc',
          length: 2,
          operands: [cpIndex],
          cpIndex,
          pushValue: resolved.literalValue,
          operandDisplay: `#${cpIndex}`,
          resolved: resolved.display,
        });
        break;
      }

      // 0x13 ldc_w (unsigned 16-bit CP index)
      case 0x13: {
        if (offset + 1 >= length) {
          return {
            instructions,
            error: `Truncated ldc_w operand at offset ${startOffset}`,
          };
        }
        const b1 = code[offset++];
        const b2 = code[offset++];
        const cpIndex = (b1 << 8) | b2;
        const resolved = resolveLdcConstant(cp, cpIndex);
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'ldc_w',
          length: 3,
          operands: [b1, b2],
          cpIndex,
          pushValue: resolved.literalValue,
          operandDisplay: `#${cpIndex}`,
          resolved: resolved.display,
        });
        break;
      }

      // 0x15 iload
      case 0x15: {
        if (offset >= length) {
          return {
            instructions,
            error: `Truncated iload operand at offset ${startOffset}`,
          };
        }
        const idx = code[offset++];
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'iload',
          length: 2,
          operands: [idx],
          operandDisplay: String(idx),
        });
        break;
      }

      // 0x19 aload
      case 0x19: {
        if (offset >= length) {
          return {
            instructions,
            error: `Truncated aload operand at offset ${startOffset}`,
          };
        }
        const idx = code[offset++];
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'aload',
          length: 2,
          operands: [idx],
          operandDisplay: String(idx),
        });
        break;
      }

      // 0x2A aload_0 .. 0x2D aload_3
      case 0x2A:
      case 0x2B:
      case 0x2C:
      case 0x2D: {
        const idx = opcode - 0x2A;
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: `aload_${idx}`,
          length: 1,
          operands: [],
        });
        break;
      }

      // 0x1A iload_0 .. 0x1D iload_3
      case 0x1A:
      case 0x1B:
      case 0x1C:
      case 0x1D: {
        const idx = opcode - 0x1A;
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: `iload_${idx}`,
          length: 1,
          operands: [],
        });
        break;
      }

      // 0x36 istore
      case 0x36: {
        if (offset >= length) {
          return {
            instructions,
            error: `Truncated istore operand at offset ${startOffset}`,
          };
        }
        const idx = code[offset++];
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'istore',
          length: 2,
          operands: [idx],
          operandDisplay: String(idx),
        });
        break;
      }

      // 0x3B istore_0 .. 0x3E istore_3
      case 0x3B:
      case 0x3C:
      case 0x3D:
      case 0x3E: {
        const idx = opcode - 0x3B;
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: `istore_${idx}`,
          length: 1,
          operands: [],
        });
        break;
      }

      // 0x3A astore
      case 0x3A: {
        if (offset >= length) {
          return {
            instructions,
            error: `Truncated astore operand at offset ${startOffset}`,
          };
        }
        const idx = code[offset++];
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'astore',
          length: 2,
          operands: [idx],
          operandDisplay: String(idx),
        });
        break;
      }

      // 0x4B astore_0 .. 0x4E astore_3
      case 0x4B:
      case 0x4C:
      case 0x4D:
      case 0x4E: {
        const idx = opcode - 0x4B;
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: `astore_${idx}`,
          length: 1,
          operands: [],
        });
        break;
      }

      // 0x53 aastore
      case 0x53:
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'aastore',
          length: 1,
          operands: [],
        });
        break;

      // 0x4F iastore
      case 0x4F:
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'iastore',
          length: 1,
          operands: [],
        });
        break;

      // 0x57 pop
      case 0x57:
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'pop',
          length: 1,
          operands: [],
        });
        break;

      // 0x58 pop2
      case 0x58:
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'pop2',
          length: 1,
          operands: [],
        });
        break;

      // 0x5F swap
      case 0x5F:
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'swap',
          length: 1,
          operands: [],
        });
        break;

      // 0x59 dup
      case 0x59:
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'dup',
          length: 1,
          operands: [],
        });
        break;

      // 0x5A dup_x1
      case 0x5A:
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'dup_x1',
          length: 1,
          operands: [],
        });
        break;

      // 0x5B dup_x2
      case 0x5B:
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'dup_x2',
          length: 1,
          operands: [],
        });
        break;

      // 0x5C dup2
      case 0x5C:
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'dup2',
          length: 1,
          operands: [],
        });
        break;

      // 0xB2 getstatic (u2 CP index)
      case 0xB2: {
        if (offset + 1 >= length) {
          return {
            instructions,
            error: `Truncated getstatic operand at offset ${startOffset}`,
          };
        }
        const b1 = code[offset++];
        const b2 = code[offset++];
        const cpIndex = (b1 << 8) | b2;
        const ref = resolveMemberRef(cp, cpIndex);
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'getstatic',
          length: 3,
          operands: [b1, b2],
          cpIndex,
          operandDisplay: `#${cpIndex}`,
          resolved: ref.formatted,
          fieldRef: ref,
        });
        break;
      }

      // 0xB3 putstatic (u2 CP index)
      case 0xB3: {
        if (offset + 1 >= length) {
          return {
            instructions,
            error: `Truncated putstatic operand at offset ${startOffset}`,
          };
        }
        const b1 = code[offset++];
        const b2 = code[offset++];
        const cpIndex = (b1 << 8) | b2;
        const ref = resolveMemberRef(cp, cpIndex);
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'putstatic',
          length: 3,
          operands: [b1, b2],
          cpIndex,
          operandDisplay: `#${cpIndex}`,
          resolved: ref.formatted,
          fieldRef: ref,
        });
        break;
      }

      // 0xB4 getfield (u2 CP index)
      case 0xB4: {
        if (offset + 1 >= length) {
          return {
            instructions,
            error: `Truncated getfield operand at offset ${startOffset}`,
          };
        }
        const b1 = code[offset++];
        const b2 = code[offset++];
        const cpIndex = (b1 << 8) | b2;
        const ref = resolveMemberRef(cp, cpIndex);
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'getfield',
          length: 3,
          operands: [b1, b2],
          cpIndex,
          operandDisplay: `#${cpIndex}`,
          resolved: ref.formatted,
          fieldRef: ref,
        });
        break;
      }

      // 0xB5 putfield (u2 CP index)
      case 0xB5: {
        if (offset + 1 >= length) {
          return {
            instructions,
            error: `Truncated putfield operand at offset ${startOffset}`,
          };
        }
        const b1 = code[offset++];
        const b2 = code[offset++];
        const cpIndex = (b1 << 8) | b2;
        const ref = resolveMemberRef(cp, cpIndex);
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'putfield',
          length: 3,
          operands: [b1, b2],
          cpIndex,
          operandDisplay: `#${cpIndex}`,
          resolved: ref.formatted,
          fieldRef: ref,
        });
        break;
      }

      // 0xB6 invokevirtual
      case 0xB6: {
        if (offset + 1 >= length) {
          return {
            instructions,
            error: `Truncated invokevirtual operand at offset ${startOffset}`,
          };
        }
        const b1 = code[offset++];
        const b2 = code[offset++];
        const cpIndex = (b1 << 8) | b2;
        const ref = resolveMemberRef(cp, cpIndex);
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'invokevirtual',
          length: 3,
          operands: [b1, b2],
          cpIndex,
          operandDisplay: `#${cpIndex}`,
          resolved: ref.formatted,
          methodRef: ref,
        });
        break;
      }

      // 0xB7 invokespecial
      case 0xB7: {
        if (offset + 1 >= length) {
          return {
            instructions,
            error: `Truncated invokespecial operand at offset ${startOffset}`,
          };
        }
        const b1 = code[offset++];
        const b2 = code[offset++];
        const cpIndex = (b1 << 8) | b2;
        const ref = resolveMemberRef(cp, cpIndex);
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'invokespecial',
          length: 3,
          operands: [b1, b2],
          cpIndex,
          operandDisplay: `#${cpIndex}`,
          resolved: ref.formatted,
          methodRef: ref,
        });
        break;
      }

      // 0xB8 invokestatic
      case 0xB8: {
        if (offset + 1 >= length) {
          return {
            instructions,
            error: `Truncated invokestatic operand at offset ${startOffset}`,
          };
        }
        const b1 = code[offset++];
        const b2 = code[offset++];
        const cpIndex = (b1 << 8) | b2;
        const ref = resolveMemberRef(cp, cpIndex);
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'invokestatic',
          length: 3,
          operands: [b1, b2],
          cpIndex,
          operandDisplay: `#${cpIndex}`,
          resolved: ref.formatted,
          methodRef: ref,
        });
        break;
      }

      // 0xBB new (u2 class index)
      case 0xBB: {
        if (offset + 1 >= length) {
          return {
            instructions,
            error: `Truncated new operand at offset ${startOffset}`,
          };
        }
        const b1 = code[offset++];
        const b2 = code[offset++];
        const cpIndex = (b1 << 8) | b2;
        const className = resolveClassName(cp, cpIndex);
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'new',
          length: 3,
          operands: [b1, b2],
          cpIndex,
          operandDisplay: `#${cpIndex}`,
          resolved: className,
          classRef: className,
        });
        break;
      }

      // 0xBC newarray (1 byte atype)
      case 0xBC: {
        if (offset >= length) {
          return {
            instructions,
            error: `Truncated newarray operand at offset ${startOffset}`,
          };
        }
        const atype = code[offset++];
        const atypeName = getAtypeName(atype);
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'newarray',
          length: 2,
          operands: [atype],
          operandDisplay: `${atype} (${atypeName})`,
          resolved: atypeName,
        });
        break;
      }

      // 0xBD anewarray (u2 class index)
      case 0xBD: {
        if (offset + 1 >= length) {
          return {
            instructions,
            error: `Truncated anewarray operand at offset ${startOffset}`,
          };
        }
        const b1 = code[offset++];
        const b2 = code[offset++];
        const cpIndex = (b1 << 8) | b2;
        const className = resolveClassName(cp, cpIndex);
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'anewarray',
          length: 3,
          operands: [b1, b2],
          cpIndex,
          operandDisplay: `#${cpIndex}`,
          resolved: className,
          classRef: className,
        });
        break;
      }

      // 0xB1 return (void return)
      case 0xB1:
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'return',
          length: 1,
          operands: [],
        });
        break;

      // 0xB0 areturn
      case 0xB0:
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'areturn',
          length: 1,
          operands: [],
        });
        break;

      // 0xAC ireturn
      case 0xAC:
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'ireturn',
          length: 1,
          operands: [],
        });
        break;

      // 0xC0 checkcast
      case 0xC0: {
        if (offset + 1 >= length) {
          return {
            instructions,
            error: `Truncated checkcast operand at offset ${startOffset}`,
          };
        }
        const b1 = code[offset++];
        const b2 = code[offset++];
        const cpIndex = (b1 << 8) | b2;
        const className = resolveClassName(cp, cpIndex);
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: 'checkcast',
          length: 3,
          operands: [b1, b2],
          cpIndex,
          operandDisplay: `#${cpIndex}`,
          resolved: className,
        });
        break;
      }

      // Branching / Jump Instructions (2-byte signed branch offset)
      case 0x99:
      case 0x9A:
      case 0x9B:
      case 0x9C:
      case 0x9D:
      case 0x9E:
      case 0x9F:
      case 0xA0:
      case 0xA1:
      case 0xA2:
      case 0xA3:
      case 0xA4:
      case 0xA5:
      case 0xA6:
      case 0xA7:
      case 0xC6:
      case 0xC7: {
        if (offset + 1 >= length) {
          return {
            instructions,
            error: `Truncated branch operand at offset ${startOffset}`,
          };
        }
        const b1 = code[offset++];
        const b2 = code[offset++];
        const rawOffset = (b1 << 8) | b2;
        const signedOffset = (rawOffset << 16) >> 16;
        const targetPc = startOffset + signedOffset;

        const branchMnemonics: Record<number, string> = {
          0x99: 'ifeq',
          0x9A: 'ifne',
          0x9B: 'iflt',
          0x9C: 'ifge',
          0x9D: 'ifgt',
          0x9E: 'ifle',
          0x9F: 'if_icmpeq',
          0xA0: 'if_icmpne',
          0xA1: 'if_icmplt',
          0xA2: 'if_icmpge',
          0xA3: 'if_icmpgt',
          0xA4: 'if_icmple',
          0xA5: 'if_acmpeq',
          0xA6: 'if_acmpne',
          0xA7: 'goto',
          0xC6: 'ifnull',
          0xC7: 'ifnonnull',
        };

        const mnem = branchMnemonics[opcode] || 'branch';
        instructions.push({
          offset: startOffset,
          opcode,
          mnemonic: mnem,
          length: 3,
          operands: [b1, b2],
          operandDisplay: `${signedOffset >= 0 ? '+' : ''}${signedOffset} -> ${targetPc}`,
          resolved: `target: ${targetPc}`,
        });
        break;
      }

      // Unsupported opcode: STOP safely
      default: {
        const hex = opcode.toString(16).toUpperCase().padStart(2, '0');
        const errorMsg = `Unsupported opcode 0x${hex} at bytecode offset ${startOffset}`;
        return {
          instructions,
          error: errorMsg,
        };
      }
    }
  }

  return { instructions };
}

function resolveLdcConstant(
  cp: (ConstantPoolEntry | null)[],
  index: number
): { display: string; literalValue?: string | number } {
  if (index <= 0 || index >= cp.length) {
    return { display: `<invalid CP #${index}>` };
  }
  const entry = cp[index];
  if (!entry) {
    return { display: `<empty CP #${index}>` };
  }

  switch (entry.tag) {
    case CpTag.String: {
      const rawStr = resolveUtf8(cp, entry.stringIndex);
      return {
        display: `"${rawStr}"`,
        literalValue: rawStr,
      };
    }
    case CpTag.Integer:
      return {
        display: String(entry.value),
        literalValue: entry.value,
      };
    case CpTag.Float:
      return {
        display: `${entry.value}f`,
        literalValue: entry.value,
      };
    case CpTag.Class: {
      const className = resolveClassName(cp, index);
      return {
        display: className,
        literalValue: className,
      };
    }
    default:
      return { display: `#${index} (${CpTag[entry.tag] || entry.tag})` };
  }
}

function getAtypeName(atype: number): string {
  switch (atype) {
    case 4:
      return 'boolean';
    case 5:
      return 'char';
    case 6:
      return 'float';
    case 7:
      return 'double';
    case 8:
      return 'byte';
    case 9:
      return 'short';
    case 10:
      return 'int';
    case 11:
      return 'long';
    default:
      return `atype_${atype}`;
  }
}
