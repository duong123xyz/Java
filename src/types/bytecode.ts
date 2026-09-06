import { ConstantPoolEntry } from './constantPool';

export interface AttributeInfo {
  attributeNameIndex: number;
  name: string;
  data: Uint8Array;
}

export interface FieldInfo {
  accessFlags: number;
  accessFlagsFormatted: string[];
  nameIndex: number;
  descriptorIndex: number;
  name: string;
  descriptor: string;
  attributes: AttributeInfo[];
}

export interface ExceptionTableEntry {
  startPc: number;
  endPc: number;
  handlerPc: number;
  catchType: number;
}

export interface CodeAttribute {
  maxStack: number;
  maxLocals: number;
  codeLength: number;
  code: Uint8Array;
  exceptionTable: ExceptionTableEntry[];
  attributes: AttributeInfo[];
  instructions?: JvmInstruction[];
  decodeError?: string;
}

export interface MethodInfo {
  accessFlags: number;
  accessFlagsFormatted: string[];
  nameIndex: number;
  descriptorIndex: number;
  name: string;
  descriptor: string;
  attributes: AttributeInfo[];
  code?: CodeAttribute;
}

export interface JvmInstruction {
  offset: number;
  opcode: number;
  mnemonic: string;
  length: number;
  operands: number[];
  cpIndex?: number;
  pushValue?: number | string;
  operandDisplay?: string;
  resolved?: string;
  fieldRef?: {
    owner: string;
    name: string;
    descriptor: string;
    formatted: string;
  };
  classRef?: string;
  methodRef?: {
    owner: string;
    name: string;
    descriptor: string;
    formatted: string;
  };
}

export interface StaticArrayElement {
  index: number;
  valueType: 'string' | 'fieldref';
  stringValue?: string;
  fieldRef?: {
    owner: string;
    name: string;
    descriptor: string;
    fullRef: string; // e.g. "a/a/a/i.u"
    displayRef: string; // e.g. "a.a.a.i.u"
  };
  evidence: {
    instructionOffsets: number[];
    summary: string;
  };
}

export interface DetectedStaticArray {
  fieldName: string;
  fieldDescriptor: string;
  displayType: string;
  declaredLength: number;
  elementCount: number;
  targetFieldOwner: string;
  elements: StaticArrayElement[];
  creationOffset: number;
  putstaticOffset: number;
}

export interface StaticAnalysisResult {
  analyzedMethod: string;
  detectedArrays: DetectedStaticArray[];
  warnings: string[];
}
