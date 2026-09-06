import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  RotateCcw,
  Trash2,
  ChevronRight,
  AlertTriangle,
  Sparkles,
  Layers,
  FileCode,
  CheckCircle2,
  Share2,
  ShieldCheck,
  ShieldAlert,
  Play,
  FileCheck2,
  Binary,
} from 'lucide-react';
import { ItemDraft, ItemRecord } from '../../types/item';
import { LoadedJarSession } from '../../types/jar';
import { ITEM_SCHEMA_FIELDS, getItemDraftKey } from '../../services/itemDraftService';
import { ItemFieldPatchPlan, ClassPatchGroup, ClassRewriteResult } from '../../types/patch';
import { buildFieldPatchPlan, buildClassPatchGroups } from '../../services/patchPlannerService';
import { rewriteClass } from '../../services/classFileRewriter';
import { runClassPreflight, PreflightCheckResult } from '../../services/classPreflightService';
import {
  buildAndVerifyPatchedJar,
  downloadPatchedJarBlob,
  ExportValidationResult,
  ExportProgress,
} from '../../services/jarExportService';
import { PatchedJarExportSection } from './PatchedJarExportSection';

interface ChangesPanelProps {
  session?: LoadedJarSession;
  isOpen: boolean;
  onClose: () => void;
  dirtyDrafts: ItemDraft[];
  allItems?: ItemRecord[];
  onSelectItem: (itemKey: string) => void;
  onResetItem: (itemKey: string) => void;
  onDiscardAll: () => void;
  onNavigateToTestGame?: (source: 'ORIGINAL' | 'PATCHED') => void;
}

export function ChangesPanel({
  session,
  isOpen,
  onClose,
  dirtyDrafts,
  allItems = [],
  onSelectItem,
  onResetItem,
  onDiscardAll,
  onNavigateToTestGame,
}: ChangesPanelProps) {
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [activeView, setActiveView] = useState<'items' | 'groups'>('items');
  const [plansMap, setPlansMap] = useState<Map<string, ItemFieldPatchPlan>>(new Map());
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [rewriteResults, setRewriteResults] = useState<Map<string, ClassRewriteResult>>(new Map());
  const [preflightResults, setPreflightResults] = useState<Map<string, PreflightCheckResult>>(new Map());
  const [rewritingGroup, setRewritingGroup] = useState<string | null>(null);
  const [rewriteError, setRewriteError] = useState<string | null>(null);

  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [exportResult, setExportResult] = useState<ExportValidationResult | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    setRewriteResults(new Map());
    setPreflightResults(new Map());
    setRewriteError(null);
    setExportResult(null);
    setExportError(null);
    setExportProgress(null);
  }, [dirtyDrafts]);

  const itemRecordsByKey = useMemo(() => {
    const map = new Map<string, ItemRecord>();
    const list = allItems.length > 0 ? allItems : (session?.itemAnalysis?.items || []);
    for (const it of list) {
      const key = getItemDraftKey(it.sourceClass, it.sourceField, it.sourceRow);
      map.set(key, it);
      map.set(`${it.sourceClass}|${it.sourceField}|${it.sourceRow}`, it);
      map.set(`${it.sourceClass}:${it.sourceField}:${it.sourceRow}`, it);
    }
    return map;
  }, [allItems, session?.itemAnalysis?.items]);

  useEffect(() => {
    if (!session || dirtyDrafts.length === 0) {
      setPlansMap(new Map());
      setLoadingPlans(false);
      return;
    }

    let cancelled = false;
    setLoadingPlans(true);

    async function loadAllPlans() {
      const newPlans = new Map<string, ItemFieldPatchPlan>();
      const itemsList = allItems.length > 0 ? allItems : (session?.itemAnalysis?.items || []);

      for (const draft of dirtyDrafts) {
        let item = itemRecordsByKey.get(draft.key);
        if (!item) {
          item = itemsList.find(
            (it) =>
              it.sourceClass === draft.sourceClass &&
              it.sourceField === draft.sourceField &&
              it.sourceRow === draft.sourceRow
          );
        }
        if (!item) continue;

        for (const colIdx of draft.dirtyFields) {
          try {
            const plan = await buildFieldPatchPlan(session!, item, draft, colIdx);
            if (plan && !cancelled) {
              const planKey = `${draft.key}|${colIdx}`;
              newPlans.set(planKey, plan);
            }
          } catch (e) {
            console.error('Lỗi khi tạo kế hoạch vá trong ChangesPanel:', e);
          }
        }
      }

      if (!cancelled) {
        setPlansMap(newPlans);
        setLoadingPlans(false);
      }
    }

    loadAllPlans();
    return () => {
      cancelled = true;
    };
  }, [session, dirtyDrafts, itemRecordsByKey, allItems]);

  const classGroups = useMemo<ClassPatchGroup[]>(() => {
    const allPlansList: ItemFieldPatchPlan[] = Array.from(plansMap.values());
    return buildClassPatchGroups(allPlansList);
  }, [plansMap]);

  const handleBuildRewritePreview = async (group: ClassPatchGroup) => {
    if (!session) return;
    setRewritingGroup(group.sourceClass);
    setRewriteError(null);

    try {
      console.log(`[handleBuildRewritePreview] Running preflight on ${group.sourceClass}...`);
      const preflight = await runClassPreflight(session, group);

      setPreflightResults((prev) => {
        const next = new Map(prev);
        next.set(group.sourceClass, preflight);
        return next;
      });

      if (preflight.status !== 'PASS') {
        console.error(`[handleBuildRewritePreview] Preflight check FAILED for ${group.sourceClass}:`, preflight.reason);
        setRewriteResults((prev) => {
          const next = new Map(prev);
          next.delete(group.sourceClass);
          return next;
        });
        return;
      }

      console.log(`[handleBuildRewritePreview] Preflight PASSED for ${group.sourceClass}. Executing in-memory rewrite...`);
      const result = await rewriteClass(
        preflight.originalBytes!,
        preflight.classInfo!,
        group,
        session
      );

      setRewriteResults((prev) => {
        const next = new Map(prev);
        next.set(group.sourceClass, result);
        return next;
      });
    } catch (err: any) {
      console.error('[handleBuildRewritePreview] Rewrite error:', err);
      setRewriteError(`PRE-FLIGHT: PASS\nREWRITE: FAIL\nLý do: ${err.message || String(err)}`);
    } finally {
      setRewritingGroup(null);
    }
  };

  const handleBuildPatchedJar = async () => {
    if (!session || isExporting) return;
    setIsExporting(true);
    setExportError(null);
    setExportProgress(null);

    try {
      const result = await buildAndVerifyPatchedJar(
        session,
        classGroups,
        rewriteResults,
        (progress) => {
          setExportProgress(progress);
        }
      );

      setExportResult(result);
      if (result.status === 'VALIDATED' && result.candidateBlob && session) {
        session.candidateOutput = {
          blob: result.candidateBlob,
          fileName: result.candidateFileName,
          status: 'VALIDATED',
          validatedAt: Date.now(),
          expectedModifiedCount: classGroups.reduce((acc, g) => acc + g.modifiedCellCount, 0),
          metrics: result.metrics,
        };
      } else if (result.status === 'FAILED') {
        setExportError(
          result.failureReason || `Xác thực khi xuất JAR thất bại tại giai đoạn ${result.failurePhase}`
        );
      }
    } catch (err: any) {
      console.error('[handleBuildPatchedJar] Error building patched jar:', err);
      setExportError(err.message || String(err));
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadPatchedJar = () => {
    if (!exportResult || exportResult.status !== 'VALIDATED' || !exportResult.candidateBlob) {
      return;
    }
    downloadPatchedJarBlob(exportResult.candidateBlob, exportResult.candidateFileName);
  };

  if (!isOpen) return null;

  const handleConfirmDiscard = () => {
    onDiscardAll();
    setShowDiscardConfirm(false);
    onClose();
  };

  const totalModifiedCells = dirtyDrafts.reduce((acc, d) => acc + d.dirtyFields.length, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="px-5 py-4 bg-zinc-950/80 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                <span>Thay đổi trong RAM &amp; kế hoạch vá</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono border border-amber-500/40">
                  {dirtyDrafts.length} vật phẩm &bull; {totalModifiedCells} ô
                </span>
              </h2>
              <p className="text-[11px] text-zinc-400">
                Tất cả thay đổi hiện chỉ nằm trong RAM. Bên dưới là bằng chứng bytecode và kế hoạch vá dự kiến, chưa ghi vào JAR.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 cursor-pointer transition-colors"
            title="Đóng bảng thay đổi"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-2.5 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveView('items')}
              className={`px-3 py-1 rounded-md cursor-pointer transition-colors flex items-center gap-1.5 ${
                activeView === 'items'
                  ? 'bg-zinc-800 text-amber-300 border border-amber-500/40 font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
              }`}
            >
              <span>Vật phẩm đã sửa ({dirtyDrafts.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveView('groups')}
              className={`px-3 py-1 rounded-md cursor-pointer transition-colors flex items-center gap-1.5 ${
                activeView === 'groups'
                  ? 'bg-zinc-800 text-amber-300 border border-amber-500/40 font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>Nhóm class cần vá ({classGroups.length})</span>
            </button>
          </div>

          {dirtyDrafts.length > 0 && (
            <button
              type="button"
              onClick={() => setShowDiscardConfirm(true)}
              className="px-2.5 py-1 rounded bg-red-950/40 hover:bg-red-950/80 text-red-300 border border-red-800/60 flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              <span>Hủy toàn bộ thay đổi</span>
            </button>
          )}
        </div>

        {showDiscardConfirm && (
          <div className="p-4 bg-red-950/50 border-b border-red-800/70 text-red-200 text-xs font-mono space-y-2">
            <div className="flex items-center gap-2 font-bold text-red-300">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              <span>Xác nhận hủy toàn bộ thay đổi trong RAM?</span>
            </div>
            <p className="text-[11px] text-red-300/80">
              Tất cả {dirtyDrafts.length} vật phẩm đã chỉnh sửa sẽ được hoàn tác về dữ liệu gốc trong JAR.
            </p>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleConfirmDiscard}
                className="px-3 py-1 bg-red-800 hover:bg-red-700 text-white rounded font-bold cursor-pointer transition-colors"
              >
                Xác nhận hủy thay đổi
              </button>
              <button
                type="button"
                onClick={() => setShowDiscardConfirm(false)}
                className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded cursor-pointer transition-colors"
              >
                Giữ lại
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
          {dirtyDrafts.length === 0 ? (
            <div className="py-12 text-center text-xs font-mono text-zinc-500 space-y-2">
              <Sparkles className="w-8 h-8 mx-auto text-zinc-600 opacity-50" />
              <p>Chưa có vật phẩm nào bị chỉnh sửa trong phiên hiện tại.</p>
              <p className="text-[11px] text-zinc-600">
                Chọn một vật phẩm từ danh sách và thay đổi các trường dữ liệu để bắt đầu.
              </p>
            </div>
          ) : activeView === 'groups' ? (
            <div className="space-y-3">
              <div className="p-3 bg-zinc-950/60 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-400">
                <div className="flex items-center gap-2 text-zinc-200 font-bold mb-1">
                  <FileCode className="w-4 h-4 text-blue-400" />
                  <span>Nhóm class để dựng lại an toàn</span>
                </div>
                <p className="text-[11px] text-zinc-500">
                  Khi nhiều vật phẩm trong cùng một class được sửa, hệ thống gom chúng lại để chỉ dựng lại class một lần, tránh các kế hoạch vá riêng lẻ ghi đè nhau.
                </p>
              </div>

              <PatchedJarExportSection
                classGroups={classGroups}
                rewriteResults={rewriteResults}
                isExporting={isExporting}
                exportProgress={exportProgress}
                exportResult={exportResult}
                exportError={exportError}
                onBuildPatchedJar={handleBuildPatchedJar}
                onDownloadPatchedJar={handleDownloadPatchedJar}
                onTestPatchedJar={() => {
                  onClose();
                  onNavigateToTestGame?.('PATCHED');
                }}
                onTestOriginalJar={() => {
                  onClose();
                  onNavigateToTestGame?.('ORIGINAL');
                }}
              />

              {classGroups.map((group) => (
                <div
                  key={group.sourceClass}
                  className="p-4 bg-zinc-950/80 border border-zinc-800 rounded-xl space-y-3 font-mono text-xs"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800 pb-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <FileCode className="w-4 h-4 text-blue-400" />
                        <span className="font-bold text-zinc-100 text-sm">{group.sourceClass}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-zinc-400 flex-wrap">
                        <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-750 text-zinc-300">
                          {group.modifiedItemCount} vật phẩm
                        </span>
                        <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/30">
                          {group.modifiedCellCount} ô đã sửa
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded font-semibold border ${
                            group.requiresRebuild
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                              : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                          }`}
                        >
                          {group.requiresRebuild ? 'Cần dựng lại class' : 'Có thể vá tại chỗ'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-start sm:self-center flex-wrap">
                      <button
                        type="button"
                        onClick={() => handleBuildRewritePreview(group)}
                        disabled={rewritingGroup === group.sourceClass}
                        className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer transition-colors border ${
                          rewritingGroup === group.sourceClass
                            ? 'bg-zinc-800 text-zinc-400 border-zinc-700 cursor-not-allowed'
                            : rewriteResults.has(group.sourceClass)
                            ? 'bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/60 border-emerald-700/60'
                            : 'bg-blue-600 hover:bg-blue-500 text-white border-blue-500 shadow-sm'
                        }`}
                      >
                        {rewritingGroup === group.sourceClass ? (
                          <>
                            <div className="w-3.5 h-3.5 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
                            <span>Đang dựng lại trong RAM...</span>
                          </>
                        ) : rewriteResults.has(group.sourceClass) ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Dựng lại bản xem trước</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>Tạo bản dựng thử</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (group.plans[0]) {
                            onSelectItem(group.plans[0].draftKey);
                            onClose();
                          }
                        }}
                        className="px-2.5 py-1.5 rounded-lg bg-zinc-850 hover:bg-zinc-800 text-zinc-200 border border-zinc-700 text-xs flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <span>Xem chi tiết</span>
                        <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-[11px] text-zinc-500 font-semibold uppercase tracking-wider">
                      Các ô đã sửa:
                    </div>
                    <div className="divide-y divide-zinc-850 rounded-lg border border-zinc-800/80 overflow-hidden bg-zinc-900/60">
                      {group.plans.map((p) => (
                        <div
                          key={p.id}
                          onClick={() => {
                            onSelectItem(p.draftKey);
                            onClose();
                          }}
                          className="p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-zinc-850/50 cursor-pointer transition-colors"
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-zinc-400 text-xs">
                              dòng {p.sourceRow} / cột {p.columnIndex} / <strong className="text-amber-300">{p.fieldName}</strong>
                            </span>
                            <span
                              className={`text-[9px] px-1.5 py-0.5 rounded font-bold border ${
                                p.riskLevel === 'SAFE_TO_PLAN'
                                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                  : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                              }`}
                            >
                              {p.riskLevel}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-zinc-500 line-through truncate max-w-[140px]">{p.originalValue || '""'}</span>
                            <span className="text-zinc-600">&rarr;</span>
                            <span className="text-amber-400 font-bold truncate max-w-[180px]">{p.draftValue || '""'}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {preflightResults.get(group.sourceClass)?.status === 'FAIL' && (() => {
                    const pf = preflightResults.get(group.sourceClass)!;
                    return (
                      <div className="p-3.5 bg-red-950/40 border border-red-800/80 rounded-xl space-y-2.5 font-mono text-xs text-red-200">
                        <div className="flex items-center gap-2 text-red-300 font-bold border-b border-red-900/60 pb-2">
                          <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />
                          <span>KIỂM TRA TRƯỚC KHI VÁ THẤT BẠI</span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-red-900/60 text-red-200 border border-red-700 ml-auto font-bold">
                            BƯỚC: {pf.errorStep || 'BỊ CHẶN'}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] bg-red-950/60 p-2.5 rounded-lg border border-red-900/40">
                          <div><span className="text-zinc-400">Đường dẫn:</span> <strong className="text-zinc-100">{pf.exactPath}</strong></div>
                          <div><span className="text-zinc-400">Tìm thấy entry:</span> <strong className={pf.entryFound ? 'text-emerald-400' : 'text-red-400'}>{pf.entryFound ? 'CÓ' : 'KHÔNG'}</strong></div>
                          <div><span className="text-zinc-400">Kích thước:</span> <strong className="text-zinc-100">{pf.byteLength} byte</strong></div>
                          <div><span className="text-zinc-400">Magic (CAFEBABE):</span> <strong className={pf.magicPass ? 'text-emerald-400' : 'text-red-400'}>{pf.magicHex} ({pf.magicPass ? 'ĐẠT' : 'LỖI'})</strong></div>
                          <div><span className="text-zinc-400">Bộ phân tích class:</span> <strong className={pf.classParsePass ? 'text-emerald-400' : 'text-red-400'}>{pf.classParsePass ? 'ĐẠT' : 'LỖI'}</strong></div>
                          <div><span className="text-zinc-400">Hàm &lt;clinit&gt;:</span> <strong className={pf.clinitFound ? 'text-emerald-400' : 'text-red-400'}>{pf.clinitFound ? 'ĐÃ TÌM THẤY' : 'BỊ THIẾU'}</strong></div>
                          <div><span className="text-zinc-400">Field đích ({pf.targetFieldName}):</span> <strong className={pf.targetFieldFound ? 'text-emerald-400' : 'text-red-400'}>{pf.targetFieldFound ? 'ĐÃ TÌM THẤY' : 'BỊ THIẾU'}</strong></div>
                          <div><span className="text-zinc-400">Phục dựng bảng:</span> <strong className={pf.tableReconstructionPass ? 'text-emerald-400' : 'text-red-400'}>{pf.tableReconstructionPass ? 'ĐẠT' : 'LỖI'}</strong></div>
                        </div>

                        <div className="p-2.5 rounded-lg bg-black/50 border border-red-900/60 text-xs text-red-200">
                          <span className="text-red-400 font-bold block mb-1">Lý do thất bại:</span>
                          <p className="whitespace-pre-wrap font-mono text-[11px] text-red-300">{pf.reason}</p>
                        </div>
                      </div>
                    );
                  })()}

                  {preflightResults.get(group.sourceClass)?.status === 'PASS' && (() => {
                    const pf = preflightResults.get(group.sourceClass)!;
                    return (
                      <div className="p-2.5 bg-emerald-950/25 border border-emerald-800/50 rounded-lg text-xs font-mono text-emerald-300 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                          <span className="font-bold">Kiểm tra class gốc: ĐẠT</span>
                          <span className="text-[10px] text-zinc-400">({pf.exactPath})</span>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-zinc-400 flex-wrap">
                          <span>Entry: <strong className="text-emerald-400">CÓ</strong></span>
                          <span>Byte: <strong className="text-zinc-200">{pf.byteLength}B</strong></span>
                          <span>CAFEBABE: <strong className="text-emerald-400">ĐẠT</strong></span>
                          <span>Parser: <strong className="text-emerald-400">ĐẠT</strong></span>
                          <span>Class nội bộ: <strong className="text-zinc-200">{pf.internalClass}</strong></span>
                          <span>Bảng ({pf.targetFieldName}): <strong className="text-emerald-400">{pf.reconstructedRowCount} dòng</strong></span>
                          <span>Bằng chứng: <strong className="text-emerald-400">ĐẠT</strong></span>
                        </div>
                      </div>
                    );
                  })()}

                  {rewriteError && (
                    <div className="p-3 bg-red-950/50 border border-red-800 rounded-lg text-xs font-mono text-red-200 space-y-1">
                      <div className="flex items-center gap-2 text-red-400 font-bold">
                        <ShieldAlert className="w-4 h-4" />
                        <span>LỖI KHI THỰC THI DỰNG LẠI CLASS</span>
                      </div>
                      <pre className="whitespace-pre-wrap text-[11px] text-red-300">{rewriteError}</pre>
                    </div>
                  )}

                  {rewriteResults.get(group.sourceClass) && (() => {
                    const rewriteResult = rewriteResults.get(group.sourceClass)!;
                    return (
                      <div className="p-3.5 bg-zinc-900 border border-zinc-700/80 rounded-xl space-y-3 font-mono text-xs">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800 pb-2.5">
                          <div className="flex items-center gap-2">
                            <Binary className="w-4 h-4 text-emerald-400" />
                            <span className="font-bold text-zinc-100">Bản xem trước class đã dựng lại trong RAM</span>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded font-bold border ${
                                rewriteResult.status === 'VALIDATED'
                                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                  : 'bg-red-500/20 text-red-300 border-red-500/40'
                              }`}
                            >
                              {rewriteResult.status === 'VALIDATED' ? 'ĐÃ XÁC THỰC' : 'DỰNG LẠI THẤT BẠI'}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 text-[10px] text-zinc-400">
                            <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                              <ShieldCheck className="w-3.5 h-3.5" />
                              JAR gốc không bị thay đổi
                            </span>
                            <span>&bull;</span>
                            <span className="text-zinc-500">JSZip chưa bị sửa</span>
                          </div>
                        </div>

                        {rewriteResult.errorMessage && (
                          <div className="p-2.5 bg-red-950/50 border border-red-800/80 rounded-lg text-red-200 text-xs flex items-start gap-2">
                            <ShieldAlert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                            <div>
                              <strong className="block font-bold">Lỗi xác thực:</strong>
                              <span>{rewriteResult.errorMessage}</span>
                            </div>
                          </div>
                        )}

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                          <div className="p-2 rounded-lg bg-zinc-950 border border-zinc-800">
                            <span className="text-zinc-500 block text-[10px]">Kích thước class</span>
                            <div className="flex items-center gap-1 text-zinc-200 font-bold">
                              <span>{rewriteResult.metrics.originalClassSize}B &rarr; {rewriteResult.metrics.rewrittenClassSize}B</span>
                            </div>
                            <span className="text-[10px] text-zinc-400">
                              Chênh lệch: {rewriteResult.metrics.sizeDelta >= 0 ? `+${rewriteResult.metrics.sizeDelta}` : rewriteResult.metrics.sizeDelta}B
                            </span>
                          </div>

                          <div className="p-2 rounded-lg bg-zinc-950 border border-zinc-800">
                            <span className="text-zinc-500 block text-[10px]">Số phần tử Constant Pool</span>
                            <div className="flex items-center gap-1 text-zinc-200 font-bold">
                              <span>{rewriteResult.metrics.originalCpCount} &rarr; {rewriteResult.metrics.rewrittenCpCount}</span>
                            </div>
                            <span className="text-[10px] text-zinc-400">
                              Thêm: {rewriteResult.metrics.cpEntriesAdded >= 0 ? `+${rewriteResult.metrics.cpEntriesAdded}` : rewriteResult.metrics.cpEntriesAdded} phần tử
                            </span>
                          </div>

                          <div className="p-2 rounded-lg bg-zinc-950 border border-zinc-800">
                            <span className="text-zinc-500 block text-[10px]">Độ dài mã &lt;clinit&gt;</span>
                            <div className="flex items-center gap-1 text-zinc-200 font-bold">
                              <span>{rewriteResult.metrics.originalCodeLength}B &rarr; {rewriteResult.metrics.rewrittenCodeLength}B</span>
                            </div>
                            <span className="text-[10px] text-zinc-400">
                              Chênh lệch: {rewriteResult.metrics.codeLengthDelta >= 0 ? `+${rewriteResult.metrics.codeLengthDelta}` : rewriteResult.metrics.codeLengthDelta}B
                            </span>
                          </div>

                          <div className="p-2 rounded-lg bg-zinc-950 border border-zinc-800">
                            <span className="text-zinc-500 block text-[10px]">Lệnh phải đổi kích thước</span>
                            <div className="flex items-center gap-1 text-zinc-200 font-bold">
                              <span>{rewriteResult.metrics.instructionsResized} lệnh</span>
                            </div>
                            <span className="text-[10px] text-zinc-400">
                              {rewriteResult.metrics.instructionsResized === 0 ? 'Giữ nguyên độ dài' : 'ldc → ldc_w'}
                            </span>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <div className="text-[11px] text-zinc-400 font-bold flex items-center justify-between">
                            <span>Các bản vá đã áp dụng và chiến lược constant ({rewriteResult.appliedPlans.length}):</span>
                          </div>
                          <div className="space-y-1.5">
                            {rewriteResult.appliedPlans.map((ap, i) => (
                              <div key={i} className="p-2 rounded-lg bg-zinc-950 border border-zinc-800 space-y-1">
                                <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
                                  <span className="text-zinc-200 font-bold">
                                    Dòng {ap.sourceRow} / Cột {ap.columnIndex} ({ap.fieldName})
                                  </span>
                                  <span
                                    className={`text-[9px] px-1.5 py-0.5 rounded font-bold border ${
                                      ap.strategyUsed === 'REUSE_EXISTING_STRING'
                                        ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                                        : ap.strategyUsed === 'REWRITE_UNIQUE_UTF8'
                                        ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                                        : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                    }`}
                                  >
                                    {ap.strategyUsed}
                                  </span>
                                </div>
                                <div className="text-[11px] text-zinc-400 flex items-center gap-1 flex-wrap">
                                  <span className="text-zinc-500 line-through truncate max-w-[120px]">&quot;{ap.originalValue}&quot;</span>
                                  <span className="text-zinc-600">&rarr;</span>
                                  <span className="text-amber-300 font-bold truncate max-w-[150px]">&quot;{ap.draftValue}&quot;</span>
                                  <span className="text-zinc-600 mx-1">&bull;</span>
                                  <span className="text-zinc-400">{ap.oldProducer} &rarr; <span className="text-emerald-400 font-semibold">{ap.newProducer}</span></span>
                                </div>
                                <p className="text-[10px] text-zinc-500">{ap.details}</p>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 space-y-2">
                          <div className="flex items-center justify-between text-xs flex-wrap gap-1">
                            <div className="flex items-center gap-1.5 font-bold text-zinc-200">
                              <FileCheck2 className="w-4 h-4 text-blue-400" />
                              <span>Xác thực bảng dữ liệu sau khi dựng lại (String[][] u)</span>
                            </div>
                            <div className="flex items-center gap-2 text-[10px]">
                              <span className="text-zinc-400">
                                Dự kiến: <strong className="text-zinc-200">{rewriteResult.expectedChangedCount}</strong>
                              </span>
                              <span>&bull;</span>
                              <span className="text-zinc-400">
                                Thực tế: <strong className="text-zinc-200">{rewriteResult.actualChangedCount}</strong>
                              </span>
                              <span>&bull;</span>
                              <span className={rewriteResult.unexpectedChangedCount === 0 ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                                Ngoài dự kiến: {rewriteResult.unexpectedChangedCount}
                              </span>
                            </div>
                          </div>

                          <div className="rounded border border-zinc-800/80 overflow-hidden">
                            <table className="w-full text-left text-[11px]">
                              <thead className="bg-zinc-900 text-zinc-400 font-semibold">
                                <tr>
                                  <th className="py-1 px-2">DÒNG</th>
                                  <th className="py-1 px-2">CỘT</th>
                                  <th className="py-1 px-2">TRƯỜNG</th>
                                  <th className="py-1 px-2">GIÁ TRỊ GỐC</th>
                                  <th className="py-1 px-2">SAU KHI DỰNG LẠI</th>
                                  <th className="py-1 px-2 text-right">ĐÚNG DỰ KIẾN</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-zinc-850">
                                {rewriteResult.semanticDiffs.map((diff, idx) => (
                                  <tr key={idx} className={diff.expected ? 'hover:bg-zinc-900/50' : 'bg-red-950/40 text-red-200'}>
                                    <td className="py-1 px-2 font-mono text-zinc-400">{diff.rowIndex}</td>
                                    <td className="py-1 px-2 font-mono text-zinc-400">{diff.columnIndex}</td>
                                    <td className="py-1 px-2 font-bold text-amber-300">{diff.fieldName}</td>
                                    <td className="py-1 px-2 text-zinc-400 truncate max-w-[100px]">{diff.originalValue}</td>
                                    <td className="py-1 px-2 text-emerald-400 font-bold truncate max-w-[100px]">{diff.rewrittenValue}</td>
                                    <td className="py-1 px-2 text-right">
                                      {diff.expected ? (
                                        <span className="text-emerald-400 font-bold">CÓ</span>
                                      ) : (
                                        <span className="text-red-400 font-bold">KHÔNG — BẤT THƯỜNG</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="flex items-center justify-between pt-1 text-[11px] text-zinc-500 border-t border-zinc-850">
                    <span className="flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
                      Chỉ xem trước • Chưa ghi thay đổi vào JAR
                    </span>
                    <span className="text-zinc-500 text-[10px]">
                      Constant dùng chung: {group.sharedConstantsCount} &bull; Constant riêng: {group.uniqueConstantsCount}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            dirtyDrafts.map((draft) => {
              const currentId = draft.values[0] || '(không có ID)';
              const currentName = draft.values[3] || '(chưa có tên)';

              return (
                <div
                  key={draft.key}
                  className="bg-zinc-950/80 border border-zinc-800 hover:border-amber-500/40 rounded-xl p-3.5 space-y-3 transition-colors"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs font-mono font-bold">
                          ID: {currentId}
                        </span>
                        <span className="font-bold text-zinc-100 text-xs font-sans">
                          {currentName}
                        </span>
                      </div>

                      <div className="text-[11px] font-mono text-zinc-400 flex items-center gap-2 flex-wrap">
                        <span className="text-zinc-500">Nguồn:</span>
                        <span className="text-zinc-300 font-bold">
                          {draft.sourceClass}:{draft.sourceRow}
                        </span>
                        <span className="text-zinc-600">&bull;</span>
                        <span className="text-amber-400">
                          {draft.dirtyFields.length} trường đã sửa
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => onResetItem(draft.key)}
                        className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-amber-300 text-xs font-mono flex items-center gap-1 border border-zinc-750 cursor-pointer transition-colors"
                        title="Khôi phục thay đổi của vật phẩm này"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Khôi phục</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          onSelectItem(draft.key);
                          onClose();
                        }}
                        className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-mono flex items-center gap-1.5 cursor-pointer font-semibold transition-colors"
                        title="Xem kế hoạch vá và chỉnh sửa vật phẩm này"
                      >
                        <span>Xem &amp; lập kế hoạch</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-zinc-800/80 space-y-1.5">
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider block font-mono">
                      Các trường đã sửa &amp; trạng thái bytecode:
                    </span>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-xs">
                      {draft.dirtyFields.map((colIdx) => {
                        const meta = ITEM_SCHEMA_FIELDS[colIdx];
                        const label = meta ? meta.label : `cột #${colIdx}`;
                        const planKey = `${draft.key}|${colIdx}`;
                        const plan = plansMap.get(planKey);

                        const original = draft.originalValues[colIdx] ?? '';
                        const current = draft.values[colIdx] ?? '';

                        return (
                          <button
                            key={colIdx}
                            type="button"
                            onClick={() => {
                              onSelectItem(draft.key);
                              onClose();
                            }}
                            className="p-2 rounded-lg bg-zinc-900/90 border border-zinc-800 hover:border-amber-500/50 text-left transition-colors flex flex-col justify-between gap-1.5 cursor-pointer group"
                          >
                            <div className="flex items-center justify-between w-full">
                              <span className="font-bold text-zinc-200 group-hover:text-amber-300 transition-colors">
                                {label}
                              </span>

                              {plan ? (
                                <span
                                  className={`text-[9px] px-1.5 py-0.5 rounded font-bold border ${
                                    plan.riskLevel === 'SAFE_TO_PLAN'
                                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                      : plan.riskLevel === 'NEEDS_REBUILD'
                                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                      : plan.riskLevel === 'UNSUPPORTED'
                                      ? 'bg-red-500/20 text-red-300 border-red-500/40'
                                      : 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                                  }`}
                                >
                                  {plan.riskLevel === 'SAFE_TO_PLAN' && 'Sẵn sàng lập kế hoạch'}
                                  {plan.riskLevel === 'NEEDS_REBUILD' && 'Cần dựng lại'}
                                  {plan.riskLevel === 'UNSUPPORTED' && 'Chưa hỗ trợ'}
                                  {plan.riskLevel === 'AMBIGUOUS' && 'Chưa rõ ràng'}
                                </span>
                              ) : (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">
                                  {loadingPlans ? 'Đang phân tích...' : 'Sẵn sàng lập kế hoạch'}
                                </span>
                              )}
                            </div>

                            <div className="text-[10px] text-zinc-400 truncate w-full flex items-center gap-1">
                              <span className="text-zinc-500 truncate max-w-[45%]">&quot;{original}&quot;</span>
                              <span className="text-zinc-600">&rarr;</span>
                              <span className="text-amber-300 font-bold truncate max-w-[45%]">&quot;{current}&quot;</span>
                            </div>

                            {plan && (
                              <div className="text-[9px] text-zinc-500 flex items-center justify-between w-full pt-1 border-t border-zinc-800/50">
                                <span>
                                  {plan.producerMnemonic} &bull; CP #{plan.cpStringIndex ?? '?'}
                                </span>
                                {plan.isShared && (
                                  <span className="text-purple-400 font-semibold flex items-center gap-0.5">
                                    <Share2 className="w-2.5 h-2.5" />
                                    Dùng chung ({plan.tableCellUsageCount})
                                  </span>
                                )}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="px-5 py-3 bg-zinc-950/80 border-t border-zinc-800 flex items-center justify-between text-[11px] font-mono text-zinc-500">
          <span>NRO Studio — Bằng chứng bytecode &amp; công cụ lập kế hoạch vá</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
