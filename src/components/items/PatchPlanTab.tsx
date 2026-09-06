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

const RISK_LABEL: Record<string, string> = {
  SAFE_TO_PLAN: 'AN TOÀN ĐỂ LẬP KẾ HOẠCH',
  NEEDS_REBUILD: 'CẦN DỰNG LẠI CLASS',
  UNSUPPORTED: 'CHƯA HỖ TRỢ',
  AMBIGUOUS: 'CHƯA XÁC ĐỊNH',
};

export function PatchPlanTab({ session, item, draft }: PatchPlanTabProps) {
  const [plans, setPlans] = useState<ItemFieldPatchPlan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isCancelled = false;
    async function loadPlans() {
      setLoading(true);
      try {
        const generatedPlans = await buildItemDraftPatchPlans(session, item, draft);
        if (!isCancelled) setPlans(generatedPlans);
      } catch (err) {
        console.error('Failed to generate patch plans:', err);
      } finally {
        if (!isCancelled) setLoading(false);
      }
    }
    loadPlans();
    return () => { isCancelled = true; };
  }, [session, item, draft, draft.dirtyFields, draft.values]);

  if (loading) {
    return (
      <div className="py-16 text-center text-xs font-mono text-zinc-500 space-y-2">
        <div className="w-6 h-6 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin mx-auto" />
        <p>Đang phân tích bằng chứng bytecode và các tham chiếu Constant Pool...</p>
      </div>
    );
  }

  if (plans.length === 0) {
    return (
      <div className="py-16 text-center text-xs font-mono text-zinc-500 space-y-3 bg-zinc-950/40 rounded-xl border border-dashed border-zinc-800 p-8">
        <Sparkles className="w-8 h-8 mx-auto text-zinc-600 opacity-60" />
        <p className="text-zinc-400 font-semibold">Chưa có thay đổi nào trên vật phẩm này.</p>
        <p className="text-[11px] text-zinc-600 max-w-md mx-auto leading-relaxed">
          Hãy chỉnh một giá trị trong tab <strong>Chỉnh sửa 15 trường</strong> (ví dụ: tên hoặc giá vàng),
          hệ thống sẽ tự lần ngược bytecode và lập <strong>bằng chứng ô dữ liệu + kế hoạch vá</strong>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="p-3.5 bg-amber-950/30 border border-amber-500/40 rounded-xl flex items-start gap-3 text-xs font-mono">
        <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1 text-amber-200/90 text-[11px] leading-relaxed">
          <div className="font-bold text-amber-300 flex items-center gap-2">
            <span>KẾ HOẠCH VÁ BYTECODE — CHỈ ĐỌC</span>
            <span className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider rounded bg-amber-500/20 border border-amber-500/40">
              BƯỚC 09 ĐANG HOẠT ĐỘNG
            </span>
          </div>
          <p>
            Kế hoạch được phân tích ngược từ dữ liệu trong RAM về bytecode <code className="text-amber-300">&lt;clinit&gt;</code> gốc.
            Ở màn này hệ thống <strong>chưa sửa byte của class</strong>, chưa thay đổi JSZip và chưa xuất JAR.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {plans.map((plan) => {
          const isLdcRisk = plan.mayRequireLdcW;
          return (
            <div key={plan.id} className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-4 space-y-4 font-mono text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-3">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-blue-500/10 border border-blue-500/30 text-blue-300 rounded font-bold">
                    {plan.fieldName}
                  </span>
                  <span className="text-[11px] text-zinc-500">chỉ số cột: <strong>{plan.columnIndex}</strong></span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 border ${
                    plan.riskLevel === 'SAFE_TO_PLAN'
                      ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                      : plan.riskLevel === 'NEEDS_REBUILD'
                      ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                      : 'bg-red-500/10 text-red-300 border-red-500/30'
                  }`}>
                    {plan.riskLevel === 'SAFE_TO_PLAN' ? <CheckCircle2 className="w-3 h-3" /> : plan.riskLevel === 'NEEDS_REBUILD' ? <Layers className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                    {RISK_LABEL[plan.riskLevel] || plan.riskLevel}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[10px]" title="Mã trạng thái kỹ thuật">
                    {plan.status}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-zinc-900/60 rounded-lg border border-zinc-800/80">
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-1">Giá trị gốc:</span>
                  <div className="text-zinc-200 break-all font-sans bg-zinc-950/80 p-2 rounded border border-zinc-800/50">
                    {plan.originalValue || <span className="text-zinc-600 italic">(trống)</span>}
                  </div>
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-amber-400 block mb-1">Giá trị bản nháp:</span>
                  <div className="text-amber-200 break-all font-sans bg-amber-950/20 p-2 rounded border border-amber-500/30 font-medium">
                    {plan.draftValue || <span className="text-zinc-600 italic">(trống)</span>}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                <div className="p-3 bg-zinc-900/40 rounded-lg border border-zinc-800 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-zinc-400 font-semibold border-b border-zinc-800 pb-1">
                    <FileCode className="w-3.5 h-3.5 text-blue-400" />
                    <span>Vị trí đích ổn định</span>
                  </div>
                  <div className="text-zinc-300 space-y-1 pt-1">
                    <div><span className="text-zinc-500">Class nguồn:</span> <span className="text-zinc-100 font-bold">{plan.sourceClass}.class</span></div>
                    <div><span className="text-zinc-500">Field nguồn:</span> <span className="text-zinc-200">{plan.sourceField}</span></div>
                    <div><span className="text-zinc-500">Dòng nguồn:</span> <span className="text-zinc-200">{plan.sourceRow}</span></div>
                    <div><span className="text-zinc-500">Chỉ số cột:</span> <span className="text-zinc-200">{plan.columnIndex}</span></div>
                  </div>
                </div>

                <div className="p-3 bg-zinc-900/40 rounded-lg border border-zinc-800 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-zinc-400 font-semibold border-b border-zinc-800 pb-1">
                    <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Chuỗi lệnh bytecode</span>
                  </div>
                  <div className="text-zinc-300 space-y-1 pt-1">
                    <div><span className="text-zinc-500">Lệnh tạo giá trị:</span> <code className="text-emerald-300 bg-emerald-950/40 px-1 py-0.5 rounded">&lt;clinit&gt; offset {plan.producerOffset}</code></div>
                    <div><span className="text-zinc-500">Opcode:</span> <span className="text-zinc-200 font-bold">{plan.producerMnemonic}</span> <span className="text-zinc-500">(0x{plan.producerOpcode.toString(16)})</span></div>
                    <div><span className="text-zinc-500">Offset aastore:</span> <span className="text-zinc-400">{plan.aastoreOffset}</span></div>
                    <div>
                      <span className="text-zinc-500">Constant Pool:</span>{' '}
                      <span className="text-amber-300 font-bold">String #{plan.cpStringIndex ?? 'N/A'}</span>{' '}
                      <ArrowRight className="w-3 h-3 inline text-zinc-500 mx-0.5" />{' '}
                      <span className="text-cyan-300 font-bold">Utf8 #{plan.utf8Index ?? 'N/A'}</span>
                    </div>
                  </div>
                </div>

                <div className="p-3 bg-zinc-900/40 rounded-lg border border-zinc-800 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-zinc-400 font-semibold border-b border-zinc-800 pb-1">
                    <Share2 className="w-3.5 h-3.5 text-purple-400" />
                    <span>Phân tích constant dùng chung</span>
                  </div>
                  <div className="text-zinc-300 space-y-1 pt-1">
                    <div>
                      <span className="text-zinc-500">Đang dùng chung:</span>{' '}
                      {plan.isShared ? (
                        <span className="px-1.5 py-0.5 bg-red-950/60 border border-red-800 text-red-300 rounded font-bold">CÓ — CONSTANT DÙNG CHUNG</span>
                      ) : (
                        <span className="px-1.5 py-0.5 bg-emerald-950/60 border border-emerald-800 text-emerald-300 rounded font-bold">KHÔNG — CONSTANT RIÊNG</span>
                      )}
                    </div>
                    <div><span className="text-zinc-500">Số ô bảng tham chiếu String:</span> <span className="text-zinc-200 font-bold">{plan.tableCellUsageCount} ô</span></div>
                    <div><span className="text-zinc-500">Tham chiếu từ lệnh bytecode:</span> <span className="text-zinc-200 font-bold">{plan.stringConstantInstructionRefCount}</span></div>
                    <div><span className="text-zinc-500">Tổng tham chiếu CP tới UTF8:</span> <span className="text-zinc-200 font-bold">{plan.utf8TotalCpRefCount}</span></div>
                    <div className="text-[10px] text-zinc-400 italic pt-0.5">{plan.sharingExplanation}</div>
                  </div>
                </div>

                <div className="p-3 bg-zinc-900/40 rounded-lg border border-zinc-800 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-zinc-400 font-semibold border-b border-zinc-800 pb-1">
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    <span>MUTF-8 &amp; yêu cầu dựng lại</span>
                  </div>
                  <div className="text-zinc-300 space-y-1 pt-1">
                    <div><span className="text-zinc-500">MUTF-8 gốc:</span> <span className="text-zinc-200 font-bold">{plan.originalMutf8Length} byte</span></div>
                    <div><span className="text-zinc-500">MUTF-8 bản nháp:</span> <span className="text-amber-300 font-bold">{plan.draftMutf8Length} byte</span> <span className="text-zinc-500">(chênh lệch: {plan.mutf8Delta > 0 ? `+${plan.mutf8Delta}` : plan.mutf8Delta})</span></div>
                    <div>
                      <span className="text-zinc-500">Cần dựng lại class:</span>{' '}
                      <span className={`font-bold ${plan.requiresClassRebuild ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {plan.requiresClassRebuild ? 'CÓ' : 'KHÔNG — độ dài phù hợp để thay tại chỗ'}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-500">Rủi ro ldc / ldc_w:</span>{' '}
                      {isLdcRisk ? (
                        <span className="text-red-400 font-bold">Có thể phải đổi ldc → ldc_w (CP &gt; 255)</span>
                      ) : (
                        <span className="text-zinc-400">{plan.currentOpcodeIsLdc ? 'Hiện tại dùng ldc (u1)' : 'ldc_w (u2, an toàn)'}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-3 bg-zinc-900/80 rounded-lg border border-zinc-800/80 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-bold">Chiến lược đề xuất:</span>
                  <span className="px-2 py-0.5 rounded font-bold text-xs bg-amber-500/20 text-amber-300 border border-amber-500/40">
                    {plan.strategy === 'CLONE_AND_RETARGET' && 'NHÂN BẢN CONSTANT + CHUYỂN ĐÍCH LDC'}
                    {plan.strategy === 'UNIQUE_REPLACE' && 'THAY / NHÂN BẢN CONSTANT RIÊNG'}
                    {plan.strategy === 'UNSUPPORTED' && 'LỆNH TẠO CHƯA HỖ TRỢ — CHỈ ĐỌC'}
                    {plan.strategy === 'NO_PATCH' && 'KHÔNG CẦN VÁ — GIÁ TRỊ KHÔNG ĐỔI'}
                  </span>
                </div>
                <ul className="text-[11px] text-zinc-400 space-y-1 list-disc list-inside">
                  {plan.diagnostics.map((diag, i) => <li key={i}>{diag}</li>)}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
