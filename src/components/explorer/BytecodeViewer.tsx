import React, { useState, useMemo } from 'react';
import {
  Binary,
  Code2,
  Table,
  Info,
  ChevronRight,
  AlertTriangle,
  Cpu,
  Layers,
  Sparkles,
} from 'lucide-react';
import { ClassFileInfo } from '../../types/jar';
import {
  JvmInstruction,
  MethodInfo,
  StaticArrayElement,
} from '../../types/bytecode';
import { analyzeStaticInitializer } from '../../services/staticInitializerAnalyzer';

interface BytecodeViewerProps {
  classInfo: ClassFileInfo;
}

export const BytecodeViewer: React.FC<BytecodeViewerProps> = ({ classInfo }) => {
  // Methods list
  const methods = classInfo.methods || [];

  // Default selection: find <clinit> first, or first method
  const initialMethod = useMemo(() => {
    const clinit = methods.find((m) => m.name === '<clinit>');
    return clinit || methods[0] || null;
  }, [methods]);

  const [selectedMethod, setSelectedMethod] = useState<MethodInfo | null>(initialMethod);
  const [selectedElementEvidence, setSelectedElementEvidence] = useState<{
    fieldName: string;
    element: StaticArrayElement;
  } | null>(null);
  const [highlightedOffset, setHighlightedOffset] = useState<number | null>(null);

  // Run static initializer analyzer if selected method is <clinit>
  const staticAnalysis = useMemo(() => {
    if (!selectedMethod || selectedMethod.name !== '<clinit>' || !selectedMethod.code?.instructions) {
      return null;
    }
    return analyzeStaticInitializer(
      selectedMethod,
      selectedMethod.code.instructions,
      classInfo.fields,
      classInfo.constantPool
    );
  }, [selectedMethod, classInfo.fields, classInfo.constantPool]);

  if (methods.length === 0) {
    return (
      <div
        id="bytecode-viewer-empty"
        className="p-8 border border-zinc-800 rounded-lg bg-zinc-950/60 text-center space-y-2 font-mono"
      >
        <Code2 className="w-8 h-8 text-zinc-600 mx-auto" />
        <p className="text-xs text-zinc-400">No methods found in this class file.</p>
      </div>
    );
  }

  const codeAttr = selectedMethod?.code;
  const instructions = codeAttr?.instructions || [];

  const handleEvidenceClick = (fieldName: string, element: StaticArrayElement) => {
    setSelectedElementEvidence({ fieldName, element });
    if (element.evidence.instructionOffsets.length > 0) {
      setHighlightedOffset(element.evidence.instructionOffsets[0]);
    }
  };

  return (
    <div id="bytecode-viewer-container" className="space-y-4 font-mono">
      {/* Method Selector Pills */}
      <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-zinc-400 text-xs">
            <Cpu className="w-4 h-4 text-emerald-400" />
            <span className="font-semibold uppercase tracking-wider text-[11px]">
              Class Methods ({methods.length})
            </span>
          </div>
          <span className="text-[11px] text-zinc-500">
            Select method to inspect JVM bytecode instructions
          </span>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          {methods.map((m, idx) => {
            const isSelected =
              selectedMethod?.name === m.name &&
              selectedMethod?.descriptor === m.descriptor;
            const isClinit = m.name === '<clinit>';
            const hasCode = !!m.code;

            return (
              <button
                key={`${m.name}-${m.descriptor}-${idx}`}
                id={`method-btn-${m.name}`}
                type="button"
                onClick={() => {
                  setSelectedMethod(m);
                  setSelectedElementEvidence(null);
                  setHighlightedOffset(null);
                }}
                className={`px-3 py-1.5 rounded-md text-xs font-mono flex items-center gap-2 border transition-all cursor-pointer ${
                  isSelected
                    ? isClinit
                      ? 'bg-amber-950/70 border-amber-500/80 text-amber-200 shadow-sm font-semibold'
                      : 'bg-zinc-800 border-zinc-600 text-zinc-100 font-semibold'
                    : isClinit
                    ? 'bg-amber-950/30 border-amber-900/60 text-amber-300 hover:bg-amber-950/60'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                }`}
              >
                <Code2
                  className={`w-3.5 h-3.5 ${
                    isClinit ? 'text-amber-400' : 'text-blue-400'
                  }`}
                />
                <span className={isClinit ? 'font-bold' : ''}>{m.name}</span>
                <span className="text-[10px] opacity-70">{m.descriptor}</span>
                {isClinit && (
                  <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                    TARGET
                  </span>
                )}
                {!hasCode && (
                  <span className="text-[9px] px-1 py-0.2 rounded bg-zinc-800 text-zinc-500">
                    Native/Abstract
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {selectedMethod && (
        <div className="space-y-4">
          {/* Method Metadata Banner */}
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3.5 text-xs grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <span className="text-[10px] text-zinc-500 uppercase block">Method</span>
              <span className="text-zinc-200 font-bold text-sm select-all">
                {selectedMethod.name}
              </span>
            </div>

            <div className="space-y-1">
              <span className="text-[10px] text-zinc-500 uppercase block">Descriptor</span>
              <span className="text-emerald-300 font-medium select-all">
                {selectedMethod.descriptor}
              </span>
            </div>

            <div className="space-y-1">
              <span className="text-[10px] text-zinc-500 uppercase block">Modifiers</span>
              <div className="flex flex-wrap gap-1">
                {selectedMethod.accessFlagsFormatted.length > 0 ? (
                  selectedMethod.accessFlagsFormatted.map((f) => (
                    <span
                      key={f}
                      className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-300 border border-zinc-700"
                    >
                      {f}
                    </span>
                  ))
                ) : (
                  <span className="text-zinc-500 text-[11px]">default</span>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-[10px] text-zinc-500 uppercase block">Code Metrics</span>
              {codeAttr ? (
                <div className="text-[11px] text-zinc-300 space-x-2">
                  <span>
                    stack: <strong className="text-amber-400">{codeAttr.maxStack}</strong>
                  </span>
                  <span>
                    locals: <strong className="text-blue-400">{codeAttr.maxLocals}</strong>
                  </span>
                  <span>
                    code: <strong className="text-zinc-100">{codeAttr.codeLength} B</strong>
                  </span>
                </div>
              ) : (
                <span className="text-zinc-500 text-[11px]">No Code Attribute</span>
              )}
            </div>
          </div>

          {/* Decode Warning if unsupported opcode encountered */}
          {codeAttr?.decodeError && (
            <div
              id="bytecode-decode-warning"
              className="p-3 border border-amber-900/60 bg-amber-950/20 rounded-lg flex items-start gap-2.5 text-xs text-amber-300"
            >
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block">Bytecode Decoder Notice:</span>
                <span className="text-amber-200/90">{codeAttr.decodeError}</span>
                <span className="block text-[11px] text-zinc-400 mt-0.5">
                  Decoded safely up to this offset. Remaining instructions are preserved in raw byte format.
                </span>
              </div>
            </div>
          )}

          {/* STATIC INITIALIZER ANALYSIS PANEL */}
          {staticAnalysis && (
            <div
              id="static-initializer-analysis-panel"
              className="border border-purple-900/50 bg-purple-950/20 rounded-lg p-4 space-y-4 shadow-sm"
            >
              <div className="flex items-center justify-between border-b border-purple-900/40 pb-3">
                <div className="flex items-center gap-2 text-purple-300">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  <h3 className="text-xs font-bold uppercase tracking-wider">
                    STATIC INITIALIZER ANALYSIS (&lt;clinit&gt;)
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-purple-900/60 text-purple-200 border border-purple-700/60">
                    Detected static arrays: {staticAnalysis.detectedArrays.length}
                  </span>
                </div>
              </div>

              {staticAnalysis.detectedArrays.length === 0 ? (
                <div className="text-xs text-zinc-400 p-3 bg-zinc-950/60 rounded border border-zinc-800">
                  No static array initialization sequences found in &lt;clinit&gt;.
                </div>
              ) : (
                <div className="space-y-4">
                  {staticAnalysis.detectedArrays.map((arr) => {
                    const isAF = arr.fieldName === 'aF';
                    const isB = arr.fieldName === 'b';

                    return (
                      <div
                        key={arr.fieldName}
                        id={`static-array-${arr.fieldName}`}
                        className="bg-zinc-950/90 border border-zinc-800 rounded-lg overflow-hidden"
                      >
                        {/* Array Header */}
                        <div className="p-3 bg-zinc-900/70 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <span className="text-xs font-bold px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800">
                              FIELD {arr.fieldName}
                            </span>
                            <span className="text-xs text-zinc-300">
                              Type: <strong className="text-emerald-400">{arr.displayType}</strong>
                              <span className="text-[10px] text-zinc-500 ml-1">
                                ({arr.fieldDescriptor})
                              </span>
                            </span>
                            <span className="text-xs text-zinc-400">
                              Length: <strong className="text-amber-400">{arr.declaredLength}</strong>
                            </span>
                            {isAF && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-950/60 text-amber-300 border border-amber-800/60 font-semibold">
                                SCHEMA ARRAY
                              </span>
                            )}
                            {isB && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-950/60 text-purple-300 border border-purple-800/60 font-semibold">
                                DATA SOURCES ARRAY
                              </span>
                            )}
                          </div>

                          <div className="text-[11px] text-zinc-500">
                            putstatic offset: <span className="text-zinc-300 font-semibold">{arr.putstaticOffset}</span>
                          </div>
                        </div>

                        {/* Array Elements Table */}
                        <div className="overflow-x-auto max-h-72 overflow-y-auto">
                          <table className="w-full text-xs text-left border-collapse">
                            <thead className="text-[11px] text-zinc-400 uppercase bg-zinc-900/90 sticky top-0 border-b border-zinc-800">
                              <tr>
                                <th className="py-1.5 px-3 w-12 text-center">#</th>
                                <th className="py-1.5 px-3">
                                  {isB ? 'Source Field / Ref' : 'Value / Name'}
                                </th>
                                {isB && <th className="py-1.5 px-3">Descriptor</th>}
                                <th className="py-1.5 px-3 w-48 text-right">Evidence</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-800/60 font-mono">
                              {arr.elements.map((el) => {
                                const isEvidenceSelected =
                                  selectedElementEvidence?.fieldName === arr.fieldName &&
                                  selectedElementEvidence?.element.index === el.index;

                                return (
                                  <tr
                                    key={el.index}
                                    id={`array-item-${arr.fieldName}-${el.index}`}
                                    onClick={() => handleEvidenceClick(arr.fieldName, el)}
                                    className={`transition-colors cursor-pointer ${
                                      isEvidenceSelected
                                        ? 'bg-purple-950/50 text-purple-100'
                                        : 'hover:bg-zinc-900/50 text-zinc-200'
                                    }`}
                                  >
                                    <td className="py-1.5 px-3 text-center text-zinc-400 font-semibold">
                                      {el.index}
                                    </td>
                                    <td className="py-1.5 px-3 font-medium">
                                      {el.valueType === 'string' ? (
                                        <span className="text-amber-300 font-semibold">
                                          {el.stringValue}
                                        </span>
                                      ) : (
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-blue-300 font-semibold">
                                            {el.fieldRef?.displayRef}
                                          </span>
                                          <span className="text-[10px] text-zinc-500">
                                            ({el.fieldRef?.fullRef})
                                          </span>
                                        </div>
                                      )}
                                    </td>
                                    {isB && (
                                      <td className="py-1.5 px-3 text-emerald-400 text-[11px]">
                                        {el.fieldRef?.descriptor}
                                      </td>
                                    )}
                                    <td className="py-1.5 px-3 text-right">
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleEvidenceClick(arr.fieldName, el);
                                        }}
                                        className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 inline-flex items-center gap-1 cursor-pointer"
                                      >
                                        <span>Evidence</span>
                                        <ChevronRight className="w-3 h-3 text-zinc-500" />
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Evidence Inspector Card */}
              {selectedElementEvidence && (
                <div
                  id="evidence-inspector-card"
                  className="bg-zinc-900/90 border border-purple-700/60 p-3 rounded-lg text-xs space-y-2 animate-in fade-in duration-150"
                >
                  <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-purple-300 uppercase text-[11px]">
                        Raw Bytecode Evidence
                      </span>
                      <span className="text-zinc-400 text-[11px]">
                        Field {selectedElementEvidence.fieldName} [
                        {selectedElementEvidence.element.index}]
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedElementEvidence(null)}
                      className="text-[11px] text-zinc-500 hover:text-zinc-300 cursor-pointer"
                    >
                      Close
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-zinc-300">
                      <span className="text-zinc-500 text-[11px]">Flow:</span>
                      <span className="text-amber-300 font-mono text-[11px]">
                        {selectedElementEvidence.element.evidence.summary}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-zinc-400 text-[11px]">
                      <span className="text-zinc-500">Instruction Offsets:</span>
                      <div className="flex gap-1.5">
                        {selectedElementEvidence.element.evidence.instructionOffsets.map((off) => (
                          <button
                            key={off}
                            type="button"
                            onClick={() => setHighlightedOffset(off)}
                            className="px-1.5 py-0.5 rounded bg-purple-950 text-purple-200 border border-purple-800 hover:bg-purple-900 cursor-pointer font-bold"
                          >
                            offset {off}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* JVM INSTRUCTION STREAM TABLE */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden space-y-0">
            <div className="p-3 bg-zinc-900/80 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Table className="w-4 h-4 text-zinc-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                  JVM Bytecode Instruction Stream ({instructions.length})
                </span>
              </div>
              <span className="text-[11px] text-zinc-500">
                Method: <span className="text-zinc-300">{selectedMethod.name}</span>
              </span>
            </div>

            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead className="text-[11px] text-zinc-400 uppercase bg-zinc-900 sticky top-0 border-b border-zinc-800">
                  <tr>
                    <th className="py-2 px-3 w-16 text-right">Offset</th>
                    <th className="py-2 px-3 w-20 text-center">Opcode</th>
                    <th className="py-2 px-3 w-32">Mnemonic</th>
                    <th className="py-2 px-3 w-32">Operands</th>
                    <th className="py-2 px-3">Resolved / Annotation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50 font-mono">
                  {instructions.map((inst) => {
                    const isHighlighted = highlightedOffset === inst.offset;
                    const hexOpcode =
                      '0x' + inst.opcode.toString(16).toUpperCase().padStart(2, '0');

                    // Opcode styling
                    let mnemonicColor = 'text-zinc-300';
                    if (inst.mnemonic.startsWith('iconst') || inst.mnemonic.startsWith('bipush')) {
                      mnemonicColor = 'text-amber-400 font-semibold';
                    } else if (inst.mnemonic === 'anewarray' || inst.mnemonic === 'new') {
                      mnemonicColor = 'text-blue-400 font-semibold';
                    } else if (inst.mnemonic === 'getstatic' || inst.mnemonic === 'putstatic') {
                      mnemonicColor = 'text-purple-400 font-semibold';
                    } else if (inst.mnemonic === 'aastore' || inst.mnemonic === 'dup') {
                      mnemonicColor = 'text-emerald-400 font-semibold';
                    } else if (inst.mnemonic === 'ldc' || inst.mnemonic === 'ldc_w') {
                      mnemonicColor = 'text-amber-300 font-semibold';
                    } else if (inst.mnemonic === 'return' || inst.mnemonic.endsWith('return')) {
                      mnemonicColor = 'text-rose-400 font-bold';
                    }

                    return (
                      <tr
                        key={inst.offset}
                        id={`instruction-row-${inst.offset}`}
                        className={`transition-colors ${
                          isHighlighted
                            ? 'bg-amber-950/60 text-amber-100 font-medium'
                            : 'hover:bg-zinc-900/60'
                        }`}
                      >
                        <td className="py-1.5 px-3 text-right text-zinc-500 select-all">
                          {inst.offset}
                        </td>
                        <td className="py-1.5 px-3 text-center text-zinc-500 font-mono text-[11px]">
                          {hexOpcode}
                        </td>
                        <td className={`py-1.5 px-3 ${mnemonicColor}`}>
                          {inst.mnemonic}
                        </td>
                        <td className="py-1.5 px-3 text-zinc-400">
                          {inst.operandDisplay ||
                            (inst.operands.length > 0
                              ? inst.operands.map((b) => b.toString(16).padStart(2, '0')).join(' ')
                              : '')}
                        </td>
                        <td className="py-1.5 px-3 font-mono text-zinc-300 truncate max-w-md">
                          {inst.resolved ? (
                            <span
                              className={
                                inst.mnemonic.includes('ldc')
                                  ? 'text-amber-300'
                                  : inst.mnemonic.includes('static')
                                  ? 'text-purple-300'
                                  : inst.mnemonic.includes('array')
                                  ? 'text-blue-300'
                                  : 'text-zinc-300'
                              }
                            >
                              {inst.resolved}
                            </span>
                          ) : (
                            <span className="text-zinc-600">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
