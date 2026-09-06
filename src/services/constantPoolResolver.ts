import {
  ConstantPoolEntry,
  CpTag,
  ResolvedCpEntry,
  ConstantPoolStats,
} from '../types/constantPool';

export function resolveUtf8(
  cp: (ConstantPoolEntry | null)[],
  index: number
): string {
  if (index <= 0 || index >= cp.length) {
    return `<invalid CP index #${index}>`;
  }
  const entry = cp[index];
  if (!entry || entry.tag !== CpTag.Utf8) {
    return `<expected Utf8 at #${index}>`;
  }
  return entry.value;
}

export function resolveClassName(
  cp: (ConstantPoolEntry | null)[],
  index: number
): string {
  if (index <= 0 || index >= cp.length) {
    return `<invalid CP index #${index}>`;
  }
  const entry = cp[index];
  if (!entry || entry.tag !== CpTag.Class) {
    return `<expected Class at #${index}>`;
  }
  return resolveUtf8(cp, entry.nameIndex);
}

export function resolveString(
  cp: (ConstantPoolEntry | null)[],
  index: number
): string {
  if (index <= 0 || index >= cp.length) {
    return `<invalid CP index #${index}>`;
  }
  const entry = cp[index];
  if (!entry || entry.tag !== CpTag.String) {
    return `<expected String at #${index}>`;
  }
  return `"${resolveUtf8(cp, entry.stringIndex)}"`;
}

export function resolveNameAndType(
  cp: (ConstantPoolEntry | null)[],
  index: number
): { name: string; descriptor: string; formatted: string } {
  if (index <= 0 || index >= cp.length) {
    return {
      name: `<invalid #${index}>`,
      descriptor: `<invalid #${index}>`,
      formatted: `<invalid NameAndType #${index}>`,
    };
  }
  const entry = cp[index];
  if (!entry || entry.tag !== CpTag.NameAndType) {
    return {
      name: `<invalid #${index}>`,
      descriptor: `<invalid #${index}>`,
      formatted: `<expected NameAndType at #${index}>`,
    };
  }
  const name = resolveUtf8(cp, entry.nameIndex);
  const descriptor = resolveUtf8(cp, entry.descriptorIndex);
  return {
    name,
    descriptor,
    formatted: `${name} : ${descriptor}`,
  };
}

export function resolveMemberRef(
  cp: (ConstantPoolEntry | null)[],
  index: number
): { owner: string; name: string; descriptor: string; formatted: string } {
  if (index <= 0 || index >= cp.length) {
    return {
      owner: `<invalid #${index}>`,
      name: `<invalid #${index}>`,
      descriptor: `<invalid #${index}>`,
      formatted: `<invalid Ref #${index}>`,
    };
  }
  const entry = cp[index];
  if (
    !entry ||
    (entry.tag !== CpTag.Fieldref &&
      entry.tag !== CpTag.Methodref &&
      entry.tag !== CpTag.InterfaceMethodref)
  ) {
    return {
      owner: `<invalid #${index}>`,
      name: `<invalid #${index}>`,
      descriptor: `<invalid #${index}>`,
      formatted: `<expected MemberRef at #${index}>`,
    };
  }
  const owner = resolveClassName(cp, entry.classIndex);
  const nat = resolveNameAndType(cp, entry.nameAndTypeIndex);
  return {
    owner,
    name: nat.name,
    descriptor: nat.descriptor,
    formatted: `${owner}.${nat.name} : ${nat.descriptor}`,
  };
}

export function resolveEntry(
  cp: (ConstantPoolEntry | null)[],
  entry: ConstantPoolEntry
): ResolvedCpEntry {
  const index = entry.index;

  switch (entry.tag) {
    case CpTag.Reserved: {
      return {
        index,
        tag: CpTag.Reserved,
        typeName: 'Reserved',
        isReserved: true,
        rawValue: `(reserved slot following 8-byte constant #${entry.forIndex})`,
        resolvedValue: `(unusable slot for Long/Double #${entry.forIndex})`,
        entry,
      };
    }
    case CpTag.Utf8: {
      return {
        index,
        tag: CpTag.Utf8,
        typeName: 'Utf8',
        isReserved: false,
        rawValue: `"${entry.value}"`,
        resolvedValue: entry.value,
        entry,
      };
    }
    case CpTag.Integer: {
      return {
        index,
        tag: CpTag.Integer,
        typeName: 'Integer',
        isReserved: false,
        rawValue: `bytes=0x${(entry.value >>> 0).toString(16).padStart(8, '0')}`,
        resolvedValue: `${entry.value}`,
        entry,
      };
    }
    case CpTag.Float: {
      return {
        index,
        tag: CpTag.Float,
        typeName: 'Float',
        isReserved: false,
        rawValue: `value=${entry.value}`,
        resolvedValue: `${entry.value}f`,
        entry,
      };
    }
    case CpTag.Long: {
      return {
        index,
        tag: CpTag.Long,
        typeName: 'Long',
        isReserved: false,
        rawValue: `high=0x${(entry.highBytes >>> 0).toString(16)}, low=0x${(entry.lowBytes >>> 0).toString(16)}`,
        resolvedValue: `${entry.value.toString()}L`,
        entry,
      };
    }
    case CpTag.Double: {
      return {
        index,
        tag: CpTag.Double,
        typeName: 'Double',
        isReserved: false,
        rawValue: `value=${entry.value}`,
        resolvedValue: `${entry.value}d`,
        entry,
      };
    }
    case CpTag.Class: {
      const className = resolveUtf8(cp, entry.nameIndex);
      return {
        index,
        tag: CpTag.Class,
        typeName: 'Class',
        isReserved: false,
        rawValue: `name_index=#${entry.nameIndex}`,
        resolvedValue: className,
        entry,
      };
    }
    case CpTag.String: {
      const strVal = resolveUtf8(cp, entry.stringIndex);
      return {
        index,
        tag: CpTag.String,
        typeName: 'String',
        isReserved: false,
        rawValue: `string_index=#${entry.stringIndex}`,
        resolvedValue: `"${strVal}"`,
        entry,
      };
    }
    case CpTag.Fieldref: {
      const ref = resolveMemberRef(cp, index);
      return {
        index,
        tag: CpTag.Fieldref,
        typeName: 'Fieldref',
        isReserved: false,
        rawValue: `class_index=#${entry.classIndex}, name_and_type_index=#${entry.nameAndTypeIndex}`,
        resolvedValue: ref.formatted,
        entry,
      };
    }
    case CpTag.Methodref: {
      const ref = resolveMemberRef(cp, index);
      return {
        index,
        tag: CpTag.Methodref,
        typeName: 'Methodref',
        isReserved: false,
        rawValue: `class_index=#${entry.classIndex}, name_and_type_index=#${entry.nameAndTypeIndex}`,
        resolvedValue: ref.formatted,
        entry,
      };
    }
    case CpTag.InterfaceMethodref: {
      const ref = resolveMemberRef(cp, index);
      return {
        index,
        tag: CpTag.InterfaceMethodref,
        typeName: 'InterfaceMethodref',
        isReserved: false,
        rawValue: `class_index=#${entry.classIndex}, name_and_type_index=#${entry.nameAndTypeIndex}`,
        resolvedValue: ref.formatted,
        entry,
      };
    }
    case CpTag.NameAndType: {
      const nat = resolveNameAndType(cp, index);
      return {
        index,
        tag: CpTag.NameAndType,
        typeName: 'NameAndType',
        isReserved: false,
        rawValue: `name_index=#${entry.nameIndex}, descriptor_index=#${entry.descriptorIndex}`,
        resolvedValue: nat.formatted,
        entry,
      };
    }
    case CpTag.MethodHandle: {
      return {
        index,
        tag: CpTag.MethodHandle,
        typeName: 'MethodHandle',
        isReserved: false,
        rawValue: `kind=${entry.referenceKind}, ref_index=#${entry.referenceIndex}`,
        resolvedValue: `MethodHandle(kind=${entry.referenceKind}, #${entry.referenceIndex})`,
        entry,
      };
    }
    case CpTag.MethodType: {
      const desc = resolveUtf8(cp, entry.descriptorIndex);
      return {
        index,
        tag: CpTag.MethodType,
        typeName: 'MethodType',
        isReserved: false,
        rawValue: `descriptor_index=#${entry.descriptorIndex}`,
        resolvedValue: desc,
        entry,
      };
    }
    case CpTag.Dynamic:
    case CpTag.InvokeDynamic: {
      const nat = resolveNameAndType(cp, entry.nameAndTypeIndex);
      return {
        index,
        tag: entry.tag,
        typeName: entry.tag === CpTag.Dynamic ? 'Dynamic' : 'InvokeDynamic',
        isReserved: false,
        rawValue: `bsm_attr_index=#${entry.bootstrapMethodAttrIndex}, nat_index=#${entry.nameAndTypeIndex}`,
        resolvedValue: `bsm=#${entry.bootstrapMethodAttrIndex} : ${nat.formatted}`,
        entry,
      };
    }
    case CpTag.Module:
    case CpTag.Package: {
      const name = resolveUtf8(cp, entry.nameIndex);
      return {
        index,
        tag: entry.tag,
        typeName: entry.tag === CpTag.Module ? 'Module' : 'Package',
        isReserved: false,
        rawValue: `name_index=#${entry.nameIndex}`,
        resolvedValue: name,
        entry,
      };
    }
    default: {
      return {
        index,
        tag: 0 as CpTag,
        typeName: 'Unknown',
        isReserved: false,
        rawValue: `unknown`,
        resolvedValue: `<unknown entry>`,
        entry,
      };
    }
  }
}

export function resolveAllEntries(
  cp: (ConstantPoolEntry | null)[]
): ResolvedCpEntry[] {
  const result: ResolvedCpEntry[] = [];
  for (let i = 1; i < cp.length; i++) {
    const entry = cp[i];
    if (entry) {
      result.push(resolveEntry(cp, entry));
    }
  }
  return result;
}

export function computeCpStats(entries: ResolvedCpEntry[]): ConstantPoolStats {
  let reservedSlots = 0;
  let utf8Entries = 0;
  let stringEntries = 0;
  let classRefs = 0;
  let fieldRefs = 0;
  let methodRefs = 0;
  let numberEntries = 0;

  for (const e of entries) {
    if (e.isReserved) {
      reservedSlots++;
      continue;
    }
    switch (e.tag) {
      case CpTag.Utf8:
        utf8Entries++;
        break;
      case CpTag.String:
        stringEntries++;
        break;
      case CpTag.Class:
        classRefs++;
        break;
      case CpTag.Fieldref:
        fieldRefs++;
        break;
      case CpTag.Methodref:
      case CpTag.InterfaceMethodref:
        methodRefs++;
        break;
      case CpTag.Integer:
      case CpTag.Float:
      case CpTag.Long:
      case CpTag.Double:
        numberEntries++;
        break;
    }
  }

  const usableEntries = entries.length - reservedSlots;

  return {
    totalCount: entries.length,
    usableEntries,
    reservedSlots,
    utf8Entries,
    stringEntries,
    classRefs,
    fieldRefs,
    methodRefs,
    numberEntries,
  };
}
