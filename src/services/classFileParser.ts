import { BinaryReader } from '../lib/binary/BinaryReader';
import { ClassFileInfo } from '../types/jar';
import { ConstantPoolEntry, CpTag } from '../types/constantPool';
import { resolveAllEntries, resolveClassName as resolveCpClassName } from './constantPoolResolver';

export function decodeModifiedUtf8(bytes: Uint8Array): string {
  let result = '';
  let i = 0;
  const len = bytes.length;

  try {
    while (i < len) {
      const b1 = bytes[i++];
      if ((b1 & 0x80) === 0) {
        // 1-byte ASCII (0x01 to 0x7F, or 0x00 if standard ascii stream)
        result += String.fromCharCode(b1);
      } else if ((b1 & 0xe0) === 0xc0) {
        // 2-byte sequence
        if (i >= len) {
          result += '\uFFFD';
          break;
        }
        const b2 = bytes[i++];
        const charCode = ((b1 & 0x1f) << 6) | (b2 & 0x3f);
        result += String.fromCharCode(charCode);
      } else if ((b1 & 0xf0) === 0xe0) {
        // 3-byte sequence (common for Vietnamese characters)
        if (i + 1 >= len) {
          result += '\uFFFD';
          break;
        }
        const b2 = bytes[i++];
        const b3 = bytes[i++];
        const charCode = ((b1 & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
        result += String.fromCharCode(charCode);
      } else {
        // Standard UTF-8 fallback / replacement character
        result += '\uFFFD';
      }
    }
  } catch {
    // Ultimate fallback if any indexing or charCode error occurs
    result = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }

  return result;
}

export function formatJavaVersion(major: number, minor: number): string {
  const versionMap: Record<number, string> = {
    45: 'Java 1.1',
    46: 'Java 1.2',
    47: 'Java 1.3 (J2ME CLDC/MIDP)',
    48: 'Java 1.4',
    49: 'Java 5',
    50: 'Java 6',
    51: 'Java 7',
    52: 'Java 8',
    53: 'Java 9',
    54: 'Java 10',
    55: 'Java 11',
    56: 'Java 12',
    57: 'Java 13',
    58: 'Java 14',
    59: 'Java 15',
    60: 'Java 16',
    61: 'Java 17',
    62: 'Java 18',
    63: 'Java 19',
    64: 'Java 20',
    65: 'Java 21',
  };

  const friendly = versionMap[major];
  if (friendly) {
    return minor > 0 ? `${friendly} (minor ${minor})` : friendly;
  }
  return `Java (Major ${major}.${minor})`;
}

export function formatAccessFlags(flags: number): string[] {
  const result: string[] = [];
  if (flags & 0x0001) result.push('public');
  if (flags & 0x0010) result.push('final');
  if (flags & 0x0020) result.push('super');
  if (flags & 0x0200) result.push('interface');
  if (flags & 0x0400) result.push('abstract');
  if (flags & 0x1000) result.push('synthetic');
  if (flags & 0x2000) result.push('annotation');
  if (flags & 0x4000) result.push('enum');
  if (flags & 0x8000) result.push('module');
  return result;
}

export function parseClassFile(buffer: ArrayBuffer): ClassFileInfo {
  const byteLength = buffer.byteLength;
  const reader = new BinaryReader(buffer);

  // 1. Magic Number Check (0xCAFEBABE)
  const magic = reader.readU4();
  const magicHex = magic.toString(16).toUpperCase().padStart(8, '0');
  if (magic !== 0xcafebabe) {
    throw new Error(
      `Invalid Java class file: expected magic 0xCAFEBABE but got 0x${magicHex}`
    );
  }

  // 2. Version
  const minorVersion = reader.readU2();
  const majorVersion = reader.readU2();
  const versionName = formatJavaVersion(majorVersion, minorVersion);

  // 3. Constant Pool
  const constantPoolCount = reader.readU2();
  // constant_pool is 1-indexed (indices 1 to constantPoolCount - 1)
  const constantPool: (ConstantPoolEntry | null)[] = new Array(constantPoolCount).fill(null);

  for (let i = 1; i < constantPoolCount; i++) {
    const tagOffset = reader.getOffset();
    const tag = reader.readU1();

    switch (tag) {
      case CpTag.Utf8: {
        // CONSTANT_Utf8 (1): u2 length, u1 bytes[length]
        const length = reader.readU2();
        const bytes = reader.readBytes(length);
        const str = decodeModifiedUtf8(bytes);
        constantPool[i] = { tag: CpTag.Utf8, index: i, value: str };
        break;
      }
      case CpTag.Integer: {
        // CONSTANT_Integer (3): u4 bytes
        const val = reader.readI4();
        constantPool[i] = { tag: CpTag.Integer, index: i, value: val };
        break;
      }
      case CpTag.Float: {
        // CONSTANT_Float (4): u4 bytes
        const val = reader.readF4();
        constantPool[i] = { tag: CpTag.Float, index: i, value: val };
        break;
      }
      case CpTag.Long: {
        // CONSTANT_Long (5): u4 high, u4 low -> Takes TWO slots
        const highBytes = reader.readU4();
        const lowBytes = reader.readU4();
        const val = (BigInt(highBytes) << 32n) | BigInt(lowBytes);
        constantPool[i] = {
          tag: CpTag.Long,
          index: i,
          value: val,
          highBytes,
          lowBytes,
        };
        i++; // 8-byte constants take two entries in the constant_pool table
        constantPool[i] = {
          tag: CpTag.Reserved,
          index: i,
          isReserved: true,
          forIndex: i - 1,
        };
        break;
      }
      case CpTag.Double: {
        // CONSTANT_Double (6): u4 high, u4 low -> Takes TWO slots
        const val = reader.readF8();
        constantPool[i] = {
          tag: CpTag.Double,
          index: i,
          value: val,
        };
        i++; // 8-byte constants take two entries in the constant_pool table
        constantPool[i] = {
          tag: CpTag.Reserved,
          index: i,
          isReserved: true,
          forIndex: i - 1,
        };
        break;
      }
      case CpTag.Class: {
        // CONSTANT_Class (7): u2 name_index
        const nameIndex = reader.readU2();
        constantPool[i] = { tag: CpTag.Class, index: i, nameIndex };
        break;
      }
      case CpTag.String: {
        // CONSTANT_String (8): u2 string_index
        const stringIndex = reader.readU2();
        constantPool[i] = { tag: CpTag.String, index: i, stringIndex };
        break;
      }
      case CpTag.Fieldref: {
        // CONSTANT_Fieldref (9)
        const classIndex = reader.readU2();
        const nameAndTypeIndex = reader.readU2();
        constantPool[i] = {
          tag: CpTag.Fieldref,
          index: i,
          classIndex,
          nameAndTypeIndex,
        };
        break;
      }
      case CpTag.Methodref: {
        // CONSTANT_Methodref (10)
        const classIndex = reader.readU2();
        const nameAndTypeIndex = reader.readU2();
        constantPool[i] = {
          tag: CpTag.Methodref,
          index: i,
          classIndex,
          nameAndTypeIndex,
        };
        break;
      }
      case CpTag.InterfaceMethodref: {
        // CONSTANT_InterfaceMethodref (11)
        const classIndex = reader.readU2();
        const nameAndTypeIndex = reader.readU2();
        constantPool[i] = {
          tag: CpTag.InterfaceMethodref,
          index: i,
          classIndex,
          nameAndTypeIndex,
        };
        break;
      }
      case CpTag.NameAndType: {
        // CONSTANT_NameAndType (12): u2 name_index, u2 descriptor_index
        const nameIndex = reader.readU2();
        const descriptorIndex = reader.readU2();
        constantPool[i] = {
          tag: CpTag.NameAndType,
          index: i,
          nameIndex,
          descriptorIndex,
        };
        break;
      }
      case CpTag.MethodHandle: {
        // CONSTANT_MethodHandle (15): u1 reference_kind, u2 reference_index
        const referenceKind = reader.readU1();
        const referenceIndex = reader.readU2();
        constantPool[i] = {
          tag: CpTag.MethodHandle,
          index: i,
          referenceKind,
          referenceIndex,
        };
        break;
      }
      case CpTag.MethodType: {
        // CONSTANT_MethodType (16): u2 descriptor_index
        const descriptorIndex = reader.readU2();
        constantPool[i] = {
          tag: CpTag.MethodType,
          index: i,
          descriptorIndex,
        };
        break;
      }
      case CpTag.Dynamic:
      case CpTag.InvokeDynamic: {
        // CONSTANT_Dynamic (17), CONSTANT_InvokeDynamic (18)
        const bootstrapMethodAttrIndex = reader.readU2();
        const nameAndTypeIndex = reader.readU2();
        constantPool[i] = {
          tag,
          index: i,
          bootstrapMethodAttrIndex,
          nameAndTypeIndex,
        };
        break;
      }
      case CpTag.Module:
      case CpTag.Package: {
        // CONSTANT_Module (19), CONSTANT_Package (20): u2 name_index
        const nameIndex = reader.readU2();
        constantPool[i] = {
          tag,
          index: i,
          nameIndex,
        };
        break;
      }
      default:
        throw new Error(`Unsupported constant pool tag: ${tag} at offset ${tagOffset}`);
    }
  }

  // 4. Class Header
  const accessFlags = reader.readU2();
  const thisClassIndex = reader.readU2();
  const superClassIndex = reader.readU2();

  const internalClassName =
    resolveCpClassName(constantPool, thisClassIndex) || 'UnknownClass';
  const className = internalClassName.replace(/\//g, '.');

  const internalSuperClassName =
    superClassIndex !== 0
      ? resolveCpClassName(constantPool, superClassIndex)
      : undefined;
  const superClassName = internalSuperClassName
    ? internalSuperClassName.replace(/\//g, '.')
    : undefined;

  // 5. Interfaces
  const interfacesCount = reader.readU2();
  for (let i = 0; i < interfacesCount; i++) {
    reader.skip(2); // interface index u2
  }

  // 6. Fields
  const fieldsCount = reader.readU2();
  for (let i = 0; i < fieldsCount; i++) {
    reader.skip(2); // access_flags
    reader.skip(2); // name_index
    reader.skip(2); // descriptor_index
    const attributesCount = reader.readU2();
    for (let a = 0; a < attributesCount; a++) {
      reader.skip(2); // attribute_name_index
      const attrLength = reader.readU4();
      reader.skip(attrLength);
    }
  }

  // 7. Methods
  const methodsCount = reader.readU2();
  for (let i = 0; i < methodsCount; i++) {
    reader.skip(2); // access_flags
    reader.skip(2); // name_index
    reader.skip(2); // descriptor_index
    const attributesCount = reader.readU2();
    for (let a = 0; a < attributesCount; a++) {
      reader.skip(2); // attribute_name_index
      const attrLength = reader.readU4();
      reader.skip(attrLength);
    }
  }

  // 8. Class Attributes
  const attributesCount = reader.readU2();
  for (let a = 0; a < attributesCount; a++) {
    reader.skip(2); // attribute_name_index
    const attrLength = reader.readU4();
    reader.skip(attrLength);
  }

  const parsedBytes = reader.getOffset();
  const remainingBytes = reader.remaining();

  // Resolve all constant pool entries for UI inspector
  const resolvedConstantPool = resolveAllEntries(constantPool);

  return {
    magic,
    magicHex,
    minorVersion,
    majorVersion,
    versionName,
    constantPoolCount,
    constantPool,
    resolvedConstantPool,
    accessFlags,
    accessFlagsFormatted: formatAccessFlags(accessFlags),
    internalClassName,
    className,
    internalSuperClassName,
    superClassName,
    interfacesCount,
    fieldsCount,
    methodsCount,
    attributesCount,
    byteLength,
    parsedBytes,
    remainingBytes,
    status: 'valid',
  };
}
