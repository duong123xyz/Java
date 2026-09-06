import React from 'react';
import {
  PackageCheck,
  Download,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  FileCode,
  Layers,
  ArrowRight,
  Play,
} from 'lucide-react';
import { ClassPatchGroup, ClassRewriteResult } from '../../types/patch';
import { ExportValidationResult, ExportProgress } from '../../services/jarExportService';

interface PatchedJarExportSectionProps {
  classGroups: ClassPatchGroup[];
  rewriteResults: Map<string, ClassRewriteResult>;
  isExporting: boolean;
  exportProgress: ExportProgress | null;
  exportResult: ExportValidationResult | null;
  exportError: string | null;
  onBuildPatchedJar: () => void;
  onDownloadPatchedJar: () => void;
  onTestPatchedJar?: () => void;
  onTestOriginalJar?: () => void;
}

export function PatchedJarExportSection({
  classGroups,
  rewriteResults,
  isExporting,
  exportProgress,
  exportResult,
  exportError,
  onBuildPatchedJar,
  onDownloadPatchedJar,
  onTestPatchedJar,
  onTestOriginalJar,
}: PatchedJarExportSectionProps) {
  // Check if all current groups have validated rewrite previews
  const unvalidatedGroups = classGroups.filter(
    (g) => rewriteResults.get(g.sourceClass)?.status !== 'VALIDATED'
  );
  const canExport = classGroups.length > 0 && unvalidatedGroups.length === 0;

  const totalModifiedCells = classGroups.reduce((acc, g) => acc + g.modifiedCellCount, 0);

  return (
    <div className="bg-zinc-950/90 border border-zinc-800 rounded-xl p-4 font-mono text-xs space-y-4">
      {/* Top Banner / Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <PackageCheck className="w-5 h-5 text-emerald-400" />
            <span className="font-bold text-zinc-100 text-sm">
              BƯỚC 11 — Build, Verify &amp; Export Patched JAR
            </span>
          </div>
          <p className="text-[11px] text-zinc-400">
            Tạo JAR mới độc lập trong RAM, serialize, reopen và xác thực lại toàn bộ bytecode &amp; semantics trước khi cho phép download.
          </p>
        </div>

        {/* Primary Action Button */}
        {!exportResult || exportResult.status !== 'VALIDATED' ? (
          <button
            type="button"
            onClick={onBuildPatchedJar}
            disabled={!canExport || isExporting}
            className={`px-4 py-2 rounded-lg font-bold flex items-center gap-2 transition-colors cursor-pointer shrink-0 ${
              isExporting
                ? 'bg-zinc-800 text-zinc-400 cursor-not-allowed'
                : canExport
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-950/50'
                : 'bg-zinc-800/80 text-zinc-500 border border-zinc-700/50 cursor-not-allowed'
            }`}
          >
            {isExporting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
                <span>Đang Build &amp; Verify Output...</span>
              </>
            ) : (
              <>
                <PackageCheck className="w-4 h-4" />
                <span>Build Patched JAR</span>
              </>
            )}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            {onTestPatchedJar && (
              <button
                type="button"
                id="test-patched-jar-quick-button"
                onClick={onTestPatchedJar}
                className="px-3.5 py-2 rounded-lg font-bold bg-amber-500 hover:bg-amber-400 text-zinc-950 flex items-center gap-1.5 shadow-md shadow-amber-950/50 cursor-pointer transition-colors shrink-0"
                title="Mở tab Test Game và chạy trực tiếp Patched JAR từ RAM"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>▶ Test Patched JAR</span>
              </button>
            )}
            {onTestOriginalJar && (
              <button
                type="button"
                id="test-original-jar-quick-button"
                onClick={onTestOriginalJar}
                className="px-3 py-2 rounded-lg font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 flex items-center gap-1.5 cursor-pointer transition-colors shrink-0 text-xs"
                title="Mở tab Test Game và chạy Original JAR"
              >
                <span>Run Original</span>
              </button>
            )}
            <button
              type="button"
              id="download-patched-jar-button"
              onClick={onDownloadPatchedJar}
              className="px-3.5 py-2 rounded-lg font-bold bg-emerald-500 hover:bg-emerald-400 text-zinc-950 flex items-center gap-1.5 shadow-md shadow-emerald-900/50 cursor-pointer transition-colors shrink-0 text-xs"
            >
              <Download className="w-3.5 h-3.5 text-zinc-950 stroke-[2.5]" />
              <span>Download Patched JAR</span>
            </button>
          </div>
        )}
      </div>

      {/* Pre-conditions / Block Notice */}
      {!canExport && !isExporting && !exportResult && (
        <div className="p-3 bg-amber-950/30 border border-amber-800/60 rounded-lg text-amber-300 space-y-1.5">
          <div className="flex items-center gap-2 font-bold text-amber-400">
            <AlertTriangle className="w-4 h-4" />
            <span>Chưa đủ điều kiện Export ({unvalidatedGroups.length} group chưa Validated)</span>
          </div>
          <p className="text-[11px] text-amber-300/80 leading-relaxed">
            Chỉ những class đã có <strong>Rewrite Preview Status = VALIDATED</strong> mới được phép xuất ra file JAR. Vui lòng bấm{' '}
            <span className="text-zinc-200 underline">Build Rewrite Preview</span> cho các class sau:
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {unvalidatedGroups.map((g) => (
              <span
                key={g.sourceClass}
                className="px-2 py-0.5 rounded bg-amber-900/50 border border-amber-700/60 text-amber-200 text-[10px]"
              >
                {g.sourceClass} ({g.modifiedCellCount} cells)
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Progress View */}
      {isExporting && exportProgress && (
        <div className="p-3 bg-zinc-900 border border-zinc-750 rounded-lg space-y-2.5">
          <div className="flex items-center justify-between text-zinc-300 text-[11px]">
            <span className="font-semibold text-emerald-400 flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>{exportProgress.phaseLabel}</span>
            </span>
            <span className="text-zinc-400 font-mono">
              Step {exportProgress.currentStep} / {exportProgress.totalSteps}
            </span>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-emerald-500 h-full transition-all duration-300"
              style={{
                width: `${Math.round((exportProgress.currentStep / exportProgress.totalSteps) * 100)}%`,
              }}
            />
          </div>

          {exportProgress.subProgress && (
            <div className="flex items-center justify-between text-[10px] text-zinc-500">
              <span className="truncate max-w-xs">{exportProgress.subProgress.message || ''}</span>
              <span>
                {exportProgress.subProgress.current} / {exportProgress.subProgress.total}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Error View */}
      {exportError && (
        <div className="p-3 bg-red-950/40 border border-red-800/80 rounded-lg text-red-300 space-y-2">
          <div className="flex items-center gap-2 font-bold text-red-400">
            <XCircle className="w-4 h-4" />
            <span>XÁC THỰC OUTPUT JAR THẤT BẠI</span>
          </div>
          <pre className="text-[11px] text-red-200 whitespace-pre-wrap font-mono bg-black/40 p-2.5 rounded border border-red-900/50">
            {exportError}
          </pre>
          <div className="flex items-center justify-between pt-1">
            <span className="text-[10px] text-red-400/80">
              Download đã bị khóa để bảo vệ tính toàn vẹn của game.
            </span>
            <button
              type="button"
              onClick={onBuildPatchedJar}
              className="px-3 py-1 bg-red-900 hover:bg-red-800 text-white rounded text-[11px] font-bold cursor-pointer transition-colors"
            >
              Thử lại
            </button>
          </div>
        </div>
      )}

      {/* Validation Result View */}
      {exportResult && exportResult.status === 'VALIDATED' && (
        <div className="p-4 bg-emerald-950/20 border border-emerald-800/60 rounded-xl space-y-4">
          {/* Header Status */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-emerald-900/50 pb-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <div>
                <div className="font-bold text-emerald-300 text-sm">
                  OUTPUT JAR VALIDATION — VALIDATED FOR EXPORT
                </div>
                <div className="text-[11px] text-emerald-400/70">
                  Tất cả 10 tiêu chuẩn kiểm định độc lập đã PASS 100%. Candidate JAR sẵn sàng tải về.
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onBuildPatchedJar}
                className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] flex items-center gap-1 cursor-pointer transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Re-verify</span>
              </button>
              <button
                type="button"
                onClick={onDownloadPatchedJar}
                className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold flex items-center gap-1.5 shadow cursor-pointer transition-colors"
              >
                <Download className="w-3.5 h-3.5 text-zinc-950 stroke-[2.5]" />
                <span>Download Patched JAR</span>
              </button>
            </div>
          </div>

          {/* Metrics Overview Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <div className="p-2 bg-zinc-900/80 border border-zinc-800 rounded-lg space-y-0.5">
              <span className="text-zinc-500 text-[10px]">Original JAR</span>
              <p className="font-bold text-zinc-200 truncate">{exportResult.metrics.originalFileName}</p>
              <p className="text-[10px] text-zinc-400">
                {(exportResult.metrics.originalFileSize / 1024 / 1024).toFixed(2)} MB &bull; {exportResult.metrics.originalTotalEntries} entries
              </p>
            </div>

            <div className="p-2 bg-emerald-950/40 border border-emerald-800/40 rounded-lg space-y-0.5">
              <span className="text-emerald-400 text-[10px]">Patched Output JAR</span>
              <p className="font-bold text-emerald-300 truncate">{exportResult.metrics.outputFileName}</p>
              <p className="text-[10px] text-emerald-400/80">
                {(exportResult.metrics.outputFileSize / 1024 / 1024).toFixed(2)} MB &bull; {exportResult.metrics.outputTotalEntries} entries
              </p>
            </div>

            <div className="p-2 bg-zinc-900/80 border border-zinc-800 rounded-lg space-y-0.5">
              <span className="text-zinc-500 text-[10px]">Patched Classes</span>
              <p className="font-bold text-blue-300">
                {exportResult.metrics.validatedClassGroupsCount} class ({exportResult.metrics.patchedClassPaths.join(', ')})
              </p>
              <p className="text-[10px] text-zinc-400">
                {exportResult.metrics.actualModifiedCellsCount} cells modified
              </p>
            </div>

            <div className="p-2 bg-zinc-900/80 border border-zinc-800 rounded-lg space-y-0.5">
              <span className="text-zinc-500 text-[10px]">Side Effects</span>
              <p className="font-bold text-emerald-400">
                0 unexpected changes
              </p>
              <p className="text-[10px] text-zinc-400">
                Original JAR: IMMUTABLE
              </p>
            </div>
          </div>

          {/* 10 Step Verification Checklist */}
          <div className="space-y-1.5">
            <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">
              Verification Checklist (Round-Trip Reopen &amp; Bytecode Inspection)
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px]">
              {exportResult.checkSteps.map((step, idx) => (
                <div
                  key={step.name}
                  className="p-2 bg-zinc-900/90 border border-zinc-800/80 rounded-lg flex items-start gap-2"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div className="space-y-0.5 min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-zinc-200 truncate">{step.name}</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-800/60">
                        PASS
                      </span>
                    </div>
                    {step.details && (
                      <p className="text-[10px] text-zinc-400 truncate">{step.details}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Signature warning notice if detected */}
          {exportResult.metrics.signatureDetected && (
            <div className="p-2.5 bg-amber-950/30 border border-amber-800/60 rounded-lg flex items-start gap-2 text-[11px] text-amber-300">
              <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">This JAR appears to contain signature metadata.</span>
                <p className="text-[10px] text-amber-300/80">
                  Modifying class contents may invalidate the original signature: {exportResult.metrics.signatureFiles.join(', ')}
                </p>
              </div>
            </div>
          )}

          {/* Semantic Changes Table */}
          {exportResult.semanticDiffs.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">
                Confirmed Semantic Changes in Output Bytecode ({exportResult.semanticDiffs.length})
              </span>
              <div className="border border-zinc-800 rounded-lg overflow-hidden divide-y divide-zinc-800/60">
                {exportResult.semanticDiffs.map((diff, i) => (
                  <div
                    key={`${diff.rowIndex}-${diff.columnIndex}-${i}`}
                    className="p-2 bg-zinc-900/60 flex items-center justify-between text-[11px]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[10px]">
                        Row {diff.rowIndex} &bull; Col {diff.columnIndex} ({diff.fieldName})
                      </span>
                    </div>
                    <div className="flex items-center gap-2 font-mono">
                      <span className="text-zinc-500 line-through">{diff.originalValue}</span>
                      <ArrowRight className="w-3 h-3 text-emerald-400" />
                      <span className="font-bold text-emerald-300 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/40">
                        {diff.rewrittenValue}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
