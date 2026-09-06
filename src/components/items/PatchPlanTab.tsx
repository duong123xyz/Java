import React, { useState, useEffect } from 'react';
import {
  FileCode,
  AlertTriangle,
  CheckCircle2,
  Share2,
  Cpu,
  Layers,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Zap,
  Info,
  ExternalLink,
} from 'lucide-react';
import { ItemRecord, ItemDraft } from '../../types/item';
import { LoadedJarSession } from '../../types/jar';
import { ItemFieldPatchPlan } from '../../types/patch';
import { buildItemDraftPatchPlans } from '../../services/patchPlannerService';

interface PatchPlanTabProps {
  session: LoadedJarSession;
  item: ItemRecord;
  draft: ItemDraft;
}

export function PatchPlanTab({ session, item, draft }: PatchPlanTabProps) {
  const [plans, setPlans] = useState<ItemFieldPatchPlan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isCancelled = false;

    async function loadPlans() {
      setLoading(true);
      try {
        const generatedPlans = await buildItemDraftPatchPlans(session, item, draft);
        if (!isCancelled) {
          setPlans(generatedPlans);
        }
      } catch (err) {
        console.error('Failed to generate patch plans:', err);
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    loadPlans();

    return () => {
      isCancelled = true;
    };
  }, [session, item, draft, draft.dirtyFields, draft.values]);

  if (loading) {
    return (
      <div className="py-16 text-center text-xs font-mono text-zinc-500 space-y-2">
        <div className="w-6 h-6 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin mx-auto" />
        <p>Đang phân tích bytecode evidence & constant pool references...</p>
      </div>
    );
  }

  if (plans.length === 0) {
    return (
      <div className="py-16 text-center text-xs font-mono text-zinc-500 space-y-3 bg-zinc-950/40 rounded-xl border border-dashed border-zinc-800 p-8">
        <Sparkles className="w-8 h-8 mx-auto text-zinc-600 opacity-60" />
        <p className="text-zinc-400 font-semibold">Chưa có thay đổi nào trên item này.</p>
        <p className="text-[11px] text-zinc-600 max-w-md mx-auto leading-relaxed">
          Hãy chỉnh sửa bất kỳ giá trị nào trong tab <strong>15 Fields Editor</strong> (ví dụ: đổi NAME hoặc gold),
          hệ thống sẽ tự động lần ngược bytecode và lập <strong>Bytecode Cell Evidence & Patch Plan</strong>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Read-Only Safety Banner */}
      <div className="p-3.5 bg-amber-950/30 border border-amber-500/40 rounded-xl flex items-start gap-3 text-xs font-mono">
        <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1 text-amber-200/90 text-[11px] leading-relaxed">
          <div className="font-bold text-amber-300 flex items-center gap-2">
            <span>READ-ONLY BYTECODE PATCH PLAN</span>
            <span className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider rounded bg-amber-500/20 border border-amber-500/40">
              BƯỚC 09 ACTIVE
            </span>
          </div>
          <p>
            Kế hoạch phân tích ngược từ RAM về bytecode <code className="text-amber-300">&lt;clinit&gt;</code> gốc.
            Tuyệt đối <strong>CHƯA sửa class byte nào</strong>, chưa sửa JSZip, chưa export JAR.
          </p>
        </div>
      </div>

      {/* Plans List */}
      <div className="space-y-4">
        {plans.map((plan) => {
          const isLdcRisk = plan.mayRequireLdcW;

          return (
            <div
              key={plan.id}
              className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-4 space-y-4 font-mono text-xs"
            >
              {/* Header: Field and Status */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-3">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-blue-500/10 border border-blue-500/30 text-blue-300 rounded font-bold">
                    {plan.fieldName}
                  </span>
                  <span className="text-[11px] text-zinc-500">
                    column index: <strong>{plan.columnIndex}</strong>
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {plan.riskLevel === 'SAFE_TO_PLAN' && (
                    <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      SAFE TO PLAN
                    </span>
                  )}
                  {plan.riskLevel === 'NEEDS_REBUILD' && (
                    <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30 text-[10px] font-bold flex items-center gap-1">
                      <Layers className="w-3 h-3" />
                      NEEDS REBUILD
                    </span>
                  )}
                  {plan.riskLevel === 'UNSUPPORTED' && (
                    <span className="px-2 py-0.5 rounded bg-red-500/10 text-red-300 border border-red-500/30 text-[10px] font-bold flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      UNSUPPORTED
                    </span>
                  )}
                  {plan.riskLevel === 'AMBIGUOUS' && (
                    <span className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/30 text-[10px] font-bold flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      AMBIGUOUS
                    </span>
                  )}

                  <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[10px]">
                    {plan.status}
                  </span>
                </div>
              </div>

              {/* Value Comparison */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-zinc-900/60 rounded-lg border border-zinc-800/80">
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-1">
                    Original Value:
                  </span>
                  <div className="text-zinc-200 break-all font-sans bg-zinc-950/80 p-2 rounded border border-zinc-800/50">
                    {plan.originalValue || <span className="text-zinc-600 italic">(empty)</span>}
                  </div>
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-amber-400 block mb-1">
                    Draft Value:
                  </span>
                  <div className="text-amber-200 break-all font-sans bg-amber-950/20 p-2 rounded border border-amber-500/30 font-medium">
                    {plan.draftValue || <span className="text-zinc-600 italic">(empty)</span>}
                  </div>
                </div>
              </div>

              {/* Grid of Technical Details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                {/* Location Identification */}
                <div className="p-3 bg-zinc-900/40 rounded-lg border border-zinc-800 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-zinc-400 font-semibold border-b border-zinc-800 pb-1">
                    <FileCode className="w-3.5 h-3.5 text-blue-400" />
                    <span>Target Stable Location</span>
                  </div>
                  <div className="text-zinc-300 space-y-1 pt-1">
                    <div>
                      <span className="text-zinc-500">Source Class:</span>{' '}
                      <span className="text-zinc-100 font-bold">{plan.sourceClass}.class</span>
                    </div>
                    <div>
                      <span className="text-zinc-500">Source Field:</span>{' '}
                      <span className="text-zinc-200">{plan.sourceField}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500">Source Row:</span>{' '}
                      <span className="text-zinc-200">{plan.sourceRow}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500">Column Index:</span>{' '}
                      <span className="text-zinc-200">{plan.columnIndex}</span>
                    </div>
                  </div>
                </div>

                {/* Bytecode Producer */}
                <div className="p-3 bg-zinc-900/40 rounded-lg border border-zinc-800 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-zinc-400 font-semibold border-b border-zinc-800 pb-1">
                    <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Bytecode Instruction Chain</span>
                  </div>
                  <div className="text-zinc-300 space-y-1 pt-1">
                    <div>
                      <span className="text-zinc-500">Producer:</span>{' '}
                      <code className="text-emerald-300 bg-emerald-950/40 px-1 py-0.5 rounded">
                        &lt;clinit&gt; offset {plan.producerOffset}
                      </code>
                    </div>
                    <div>
                      <span className="text-zinc-500">Opcode:</span>{' '}
                      <span className="text-zinc-200 font-bold">{plan.producerMnemonic}</span>{' '}
                      <span className="text-zinc-500">(0x{plan.producerOpcode.toString(16)})</span>
                    </div>
                    <div>
                      <span className="text-zinc-500">AAStore Offset:</span>{' '}
                      <span className="text-zinc-400">offset {plan.aastoreOffset}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500">Constant Pool:</span>{' '}
                      <span className="text-amber-300 font-bold">
                        String #{plan.cpStringIndex ?? 'N/A'}
                      </span>{' '}
                      <ArrowRight className="w-3 h-3 inline text-zinc-500 mx-0.5" />{' '}
                      <span className="text-cyan-300 font-bold">
                        Utf8 #{plan.utf8Index ?? 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Constant Sharing Analysis */}
                <div className="p-3 bg-zinc-900/40 rounded-lg border border-zinc-800 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-zinc-400 font-semibold border-b border-zinc-800 pb-1">
                    <Share2 className="w-3.5 h-3.5 text-purple-400" />
                    <span>Constant Sharing Analysis</span>
                  </div>
                  <div className="text-zinc-300 space-y-1 pt-1">
                    <div>
                      <span className="text-zinc-500">Is Shared:</span>{' '}
                      {plan.isShared ? (
                        <span className="px-1.5 py-0.5 bg-red-950/60 border border-red-800 text-red-300 rounded font-bold">
                          YES (SHARED CONSTANT)
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 bg-emerald-950/60 border border-emerald-800 text-emerald-300 rounded font-bold">
                          NO (UNIQUE CONSTANT)
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="text-zinc-500">String Ref In Table:</span>{' '}
                      <span className="text-zinc-200 font-bold">{plan.tableCellUsageCount} cells</span>
                    </div>
                    <div>
                      <span className="text-zinc-500">Bytecode Instruction Refs:</span>{' '}
                      <span className="text-zinc-200 font-bold">{plan.stringConstantInstructionRefCount}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500">UTF8 Total CP Refs:</span>{' '}
                      <span className="text-zinc-200 font-bold">{plan.utf8TotalCpRefCount}</span>
                    </div>
                    <div className="text-[10px] text-zinc-400 italic pt-0.5">
                      {plan.sharingExplanation}
                    </div>
                  </div>
                </div>

                {/* Modified UTF-8 & Rebuild Analysis */}
                <div className="p-3 bg-zinc-900/40 rounded-lg border border-zinc-800 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-zinc-400 font-semibold border-b border-zinc-800 pb-1">
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    <span>MUTF-8 & Rebuild Requirement</span>
                  </div>
                  <div className="text-zinc-300 space-y-1 pt-1">
                    <div>
                      <span className="text-zinc-500">Original MUTF-8:</span>{' '}
                      <span className="text-zinc-200 font-bold">{plan.originalMutf8Length} bytes</span>
                    </div>
                    <div>
                      <span className="text-zinc-500">Draft MUTF-8:</span>{' '}
                      <span className="text-amber-300 font-bold">{plan.draftMutf8Length} bytes</span>{' '}
                      <span className="text-zinc-500">
                        (Delta: {plan.mutf8Delta > 0 ? `+${plan.mutf8Delta}` : plan.mutf8Delta})
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-500">Class Rebuild Required:</span>{' '}
                      <span
                        className={`font-bold ${
                          plan.requiresClassRebuild ? 'text-amber-400' : 'text-emerald-400'
                        }`}
                      >
                        {plan.requiresClassRebuild ? 'YES' : 'NO (Technically in-place length)'}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-500">LDC vs LDC_W Risk:</span>{' '}
                      {isLdcRisk ? (
                        <span className="text-red-400 font-bold">
                          May require ldc -&gt; ldc_w (CP &gt; 255)
                        </span>
                      ) : (
                        <span className="text-zinc-400">
                          {plan.currentOpcodeIsLdc ? 'Current ldc (u1)' : 'ldc_w (u2 safe)'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Patch Strategy Resolution */}
              <div className="p-3 bg-zinc-900/80 rounded-lg border border-zinc-800/80 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-bold">
                    Recommended Strategy:
                  </span>
                  <span className="px-2 py-0.5 rounded font-bold text-xs bg-amber-500/20 text-amber-300 border border-amber-500/40">
                    {plan.strategy === 'CLONE_AND_RETARGET' && 'CLONE CONSTANT + RETARGET LDC'}
                    {plan.strategy === 'UNIQUE_REPLACE' && 'REPLACE / CLONE UNIQUE CONSTANT'}
                    {plan.strategy === 'UNSUPPORTED' && 'UNSUPPORTED PRODUCER (READ-ONLY)'}
                    {plan.strategy === 'NO_PATCH' && 'NO PATCH (SAME VALUE)'}
                  </span>
                </div>

                <ul className="text-[11px] text-zinc-400 space-y-1 list-disc list-inside">
                  {plan.diagnostics.map((diag, i) => (
                    <li key={i}>{diag}</li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
