export enum CpTag {
  Reserved = 0,
  Utf8 = 1,
  Integer = 3,
  Float = 4,
  Long = 5,
  Double = 6,
  Class = 7,
  String = 8,
  Fieldref = 9,
  Methodref = 10,
  InterfaceMethodref = 11,
  NameAndType = 12,
  MethodHandle = 15,
  MethodType = 16,
  Dynamic = 17,
  InvokeDynamic = 18,
  Module = 19,
  Package = 20,
}

export interface CpUtf8Entry {
  tag: CpTag.Utf8;
  index: number;
  value: string;
}

export interface CpIntegerEntry {
  tag: CpTag.Integer;
  index: number;
  value: number;
}

export interface CpFloatEntry {
  tag: CpTag.Float;
  index: number;
  value: number;
}

export interface CpLongEntry {
  tag: CpTag.Long;
  index: number;
  value: bigint;
  highBytes: number;
  lowBytes: number;
}

export interface CpDoubleEntry {
  tag: CpTag.Double;
  index: number;
  value: number;
}

export interface CpClassEntry {
  tag: CpTag.Class;
  index: number;
  nameIndex: number;
}

export interface CpStringEntry {
  tag: CpTag.String;
  index: number;
  stringIndex: number;
}

export interface CpFieldrefEntry {
  tag: CpTag.Fieldref;
  index: number;
  classIndex: number;
  nameAndTypeIndex: number;
}

export interface CpMethodrefEntry {
  tag: CpTag.Methodref;
  index: number;
  classIndex: number;
  nameAndTypeIndex: number;
}

export interface CpInterfaceMethodrefEntry {
  tag: CpTag.InterfaceMethodref;
  index: number;
  classIndex: number;
  nameAndTypeIndex: number;
}

export interface CpNameAndTypeEntry {
  tag: CpTag.NameAndType;
  index: number;
  nameIndex: number;
  descriptorIndex: number;
}

export interface CpMethodHandleEntry {
  tag: CpTag.MethodHandle;
  index: number;
  referenceKind: number;
  referenceIndex: number;
}

export interface CpMethodTypeEntry {
  tag: CpTag.MethodType;
  index: number;
  descriptorIndex: number;
}

export interface CpInvokeDynamicEntry {
  tag: CpTag.Dynamic | CpTag.InvokeDynamic;
  index: number;
  bootstrapMethodAttrIndex: number;
  nameAndTypeIndex: number;
}

export interface CpModuleOrPackageEntry {
  tag: CpTag.Module | CpTag.Package;
  index: number;
  nameIndex: number;
}

export interface CpReservedEntry {
  tag: CpTag.Reserved;
  index: number;
  isReserved: true;
  forIndex: number;
}

export type ConstantPoolEntry =
  | CpUtf8Entry
  | CpIntegerEntry
  | CpFloatEntry
  | CpLongEntry
  | CpDoubleEntry
  | CpClassEntry
  | CpStringEntry
  | CpFieldrefEntry
  | CpMethodrefEntry
  | CpInterfaceMethodrefEntry
  | CpNameAndTypeEntry
  | CpMethodHandleEntry
  | CpMethodTypeEntry
  | CpInvokeDynamicEntry
  | CpModuleOrPackageEntry
  | CpReservedEntry;

export interface ResolvedCpEntry {
  index: number;
  tag: CpTag;
  typeName: string;
  isReserved: boolean;
  rawValue: string;
  resolvedValue: string;
  entry: ConstantPoolEntry;
}

export interface ConstantPoolStats {
  totalCount: number;
  usableEntries: number;
  reservedSlots: number;
  utf8Entries: number;
  stringEntries: number;
  classRefs: number;
  fieldRefs: number;
  methodRefs: number;
  numberEntries: number;
}
