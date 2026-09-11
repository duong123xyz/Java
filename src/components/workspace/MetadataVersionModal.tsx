import React, { useState } from 'react';
import {
  X,
  Tag,
  User,
  History,
  Sparkles,
  ArrowUpRight,
  Check,
  FileCode,
  RotateCcw,
  Sliders,
  Download,
  FileText,
  Layers,
} from 'lucide-react';
import { LoadedJarSession } from '../../types/jar';
import {
  getWorkspaceMetadata,
  setWorkspaceMetadata,
  resolveExportFileName,
  bumpVersionString,
  recordVersionHistory,
  VersionIncrementStrategy,
  WorkspaceMetadata,
} from '../../services/workspaceMetadataService';

interface MetadataVersionModalProps {
  session: LoadedJarSession;
  onClose: () => void;
  onSaved: () => void;
}

const PRESET_PATTERNS = [
  {
    label: 'Chuẩn: Tên_vPhiênBản_TácGiả.jar',
    pattern: '{name}_v{version}_{author}.jar',
    example: 'game_v1.0.1_Admin.jar',
  },
  {
    label: 'Gọn: Tên_vPhiênBản.jar',
    pattern: '{name}_v{version}.jar',
    example: 'game_v1.0.1.jar',
  },
  {
    label: 'Tác giả: Tên_TácGiả.jar',
    pattern: '{name}_{author}.jar',
    example: 'game_Admin.jar',
  },
  {
    label: 'Nguyên bản: Tên.jar',
    pattern: '{name}.jar',
    example: 'game.jar',
  },
  {
    label: 'Kèm ngày: Tên_vPhiênBản_Ngày.jar',
    pattern: '{name}_v{version}_{timestamp}.jar',
    example: 'game_v1.0.1_20260910.jar',
  },
];

export const MetadataVersionModal: React.FC<MetadataVersionModalProps> = ({
  session,
  onClose,
  onSaved,
}) => {
  const [activeTab, setActiveTab] = useState<'general' | 'naming' | 'history'>('general');
  const metadata = getWorkspaceMetadata(session);

  const [exportFileName, setExportFileName] = useState(metadata.exportFileName);
  const [author, setAuthor] = useState(metadata.author);
  const [gameName, setGameName] = useState(metadata.gameName);
  const [version, setVersion] = useState(metadata.version);
  const [namingPattern, setNamingPattern] = useState(metadata.namingPattern);
  const [autoIncrementOnDownload, setAutoIncrementOnDownload] = useState(metadata.autoIncrementOnDownload);
  const [autoIncrementOnEdit, setAutoIncrementOnEdit] = useState(metadata.autoIncrementOnEdit);
  const [incrementStrategy, setIncrementStrategy] = useState<VersionIncrementStrategy>(metadata.incrementStrategy);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Live draft preview metadata
  const draftMeta: WorkspaceMetadata = {
    exportFileName,
    author,
    gameName,
    version,
    namingPattern,
    autoIncrementOnDownload,
    autoIncrementOnEdit,
    incrementStrategy,
    history: metadata.history || [],
  };

  const resolvedFileName = resolveExportFileName(draftMeta);

  const handleQuickBump = (strategy: VersionIncrementStrategy) => {
    const nextVer = bumpVersionString(version, strategy);
    setVersion(nextVer);
  };

  const handleSave = () => {
    const isVersionChanged = version.trim() !== metadata.version.trim();
    const updated = setWorkspaceMetadata(session, {
      exportFileName: exportFileName.trim() || 'game',
      author: author.trim() || 'Modder',
      gameName: gameName.trim() || 'Game',
      version: version.trim() || '1.0.0',
      namingPattern: namingPattern.trim() || '{name}_v{version}_{author}.jar',
      autoIncrementOnDownload,
      autoIncrementOnEdit,
      incrementStrategy,
    });

    if (isVersionChanged) {
      recordVersionHistory(session, {
        version: updated.version,
        action: 'MANUAL',
        description: `Chỉnh sửa phiên bản thủ công (${metadata.version} -> ${updated.version})`,
        fileName: resolveExportFileName(updated),
      });
    }

    // Invalidate candidate so candidateOutput gets updated on next build
    if (session.candidateOutput) {
      session.candidateOutput.status = 'STALE';
    }

    setSaveSuccess(true);
    setTimeout(() => {
      onSaved();
      onClose();
    }, 400);
  };

  const originalVendor = session.jarInfo.manifest.midletVendor || 'N/A';
  const originalVersion = session.jarInfo.manifest.midletVersion || 'N/A';
  const originalName = session.jarInfo.manifest.midletName || 'N/A';

  return (
    <div
      id="metadata-version-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="metadata-version-modal"
        className="bg-white rounded-xl shadow-2xl border border-zinc-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-zinc-200 bg-zinc-50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center border border-emerald-200 shadow-xs">
              <Tag className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-800 flex items-center gap-2">
                Quản lý Tên file, Tác giả & Phiên bản
              </h2>
              <p className="text-[11px] text-zinc-500">
                Tùy chỉnh thông tin xuất JAR, MANIFEST.MF và tự động gán tên phiên bản riêng cho mỗi lần sửa/tải.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-md hover:bg-zinc-200/70 text-zinc-400 hover:text-zinc-700 flex items-center justify-center transition-colors cursor-pointer"
            title="Đóng"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 px-5 pt-3 border-b border-zinc-200 bg-white">
          <button
            type="button"
            onClick={() => setActiveTab('general')}
            className={`px-3 py-2 text-xs font-semibold rounded-t-md flex items-center gap-1.5 transition-colors cursor-pointer border-b-2 ${
              activeTab === 'general'
                ? 'border-emerald-500 text-emerald-700 bg-emerald-50/50'
                : 'border-transparent text-zinc-500 hover:text-zinc-800'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>Tên & Tác giả & Phiên bản</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('naming')}
            className={`px-3 py-2 text-xs font-semibold rounded-t-md flex items-center gap-1.5 transition-colors cursor-pointer border-b-2 ${
              activeTab === 'naming'
                ? 'border-emerald-500 text-emerald-700 bg-emerald-50/50'
                : 'border-transparent text-zinc-500 hover:text-zinc-800'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Quy tắc đặt tên & Tự tăng</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`px-3 py-2 text-xs font-semibold rounded-t-md flex items-center gap-1.5 transition-colors cursor-pointer border-b-2 ${
              activeTab === 'history'
                ? 'border-emerald-500 text-emerald-700 bg-emerald-50/50'
                : 'border-transparent text-zinc-500 hover:text-zinc-800'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Lịch sử phiên bản ({metadata.history?.length || 0})</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4 text-xs">
          {activeTab === 'general' && (
            <div className="space-y-4">
              {/* Tên file xuất */}
              <div>
                <label className="block text-zinc-700 font-semibold mb-1 flex items-center justify-between">
                  <span>Tên file xuất cơ sở (File Name):</span>
                  <span className="text-[10px] text-zinc-400 font-normal">Không cần nhập đuôi .jar</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="metadata-export-filename-input"
                    type="text"
                    value={exportFileName}
                    onChange={(e) => setExportFileName(e.target.value)}
                    placeholder="ví dụ: DragonBall_Mod"
                    className="flex-1 px-3 py-2 sm:py-1.5 rounded-md border border-zinc-300 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-zinc-800 font-mono text-[16px] sm:text-xs outline-none bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => setExportFileName(session.jarInfo.fileName.replace(/\.jar$/i, '') || 'game')}
                    className="px-2.5 py-1.5 rounded border border-zinc-200 hover:bg-zinc-100 text-zinc-600 font-mono text-[11px] flex items-center gap-1 cursor-pointer"
                    title="Khôi phục theo tên file gốc"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Gốc</span>
                  </button>
                </div>
              </div>

              {/* Tác giả & Tên hiển thị game */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-700 font-semibold mb-1 flex items-center justify-between">
                    <span>Tác giả (Author / Vendor):</span>
                    <span className="text-[10px] text-zinc-400 font-mono">MIDlet-Vendor</span>
                  </label>
                  <input
                    id="metadata-author-input"
                    type="text"
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                    placeholder="ví dụ: ModderPro hoặc Tên của bạn"
                    className="w-full px-3 py-2 sm:py-1.5 rounded-md border border-zinc-300 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-zinc-800 text-[16px] sm:text-xs outline-none bg-white"
                  />
                  <span className="text-[10px] text-zinc-400 mt-1 block truncate">
                    Gốc: {originalVendor}
                  </span>
                </div>

                <div>
                  <label className="block text-zinc-700 font-semibold mb-1 flex items-center justify-between">
                    <span>Tên game hiển thị:</span>
                    <span className="text-[10px] text-zinc-400 font-mono">MIDlet-Name</span>
                  </label>
                  <input
                    id="metadata-gamename-input"
                    type="text"
                    value={gameName}
                    onChange={(e) => setGameName(e.target.value)}
                    placeholder="ví dụ: DragonBoy 240"
                    className="w-full px-3 py-2 sm:py-1.5 rounded-md border border-zinc-300 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-zinc-800 text-[16px] sm:text-xs outline-none bg-white"
                  />
                  <span className="text-[10px] text-zinc-400 mt-1 block truncate">
                    Gốc: {originalName}
                  </span>
                </div>
              </div>

              {/* Tên phiên bản & Nút tăng phiên bản */}
              <div className="p-3.5 rounded-lg border border-emerald-200 bg-emerald-50/60 space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-zinc-800 font-bold flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Tên phiên bản hiện tại (Version Name):</span>
                  </label>
                  <span className="text-[10px] text-emerald-700 font-mono bg-emerald-100/80 px-2 py-0.5 rounded border border-emerald-200">
                    Ghi vào MANIFEST.MF & Tên file
                  </span>
                </div>

                <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                  <input
                    id="metadata-version-input"
                    type="text"
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    placeholder="ví dụ: 1.0.0, v1.0.1, beta-2"
                    className="flex-1 px-3 py-2 sm:py-1.5 rounded-md border border-emerald-300 bg-white font-mono font-semibold text-emerald-800 text-[16px] sm:text-xs outline-none focus:ring-1 focus:ring-emerald-500"
                  />

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleQuickBump('patch')}
                      className="px-2.5 py-1.5 rounded-md bg-white border border-emerald-300 hover:bg-emerald-100 text-emerald-700 font-mono text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
                      title="Tăng số phiên bản patch (ví dụ: 1.0.0 -> 1.0.1)"
                    >
                      <Sparkles className="w-3 h-3 text-emerald-600" />
                      <span>+Patch (1.0.x)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleQuickBump('minor')}
                      className="px-2.5 py-1.5 rounded-md bg-white border border-indigo-200 hover:bg-indigo-50 text-indigo-700 font-mono text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
                      title="Tăng số phiên bản minor (ví dụ: 1.0.0 -> 1.1.0)"
                    >
                      <span>+Minor (1.x.0)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleQuickBump('revision')}
                      className="px-2 py-1.5 rounded-md bg-white border border-zinc-300 hover:bg-zinc-100 text-zinc-700 font-mono text-[11px] cursor-pointer transition-colors shadow-2xs"
                      title="Tăng revision (ví dụ: rev1 -> rev2)"
                    >
                      <span>+Rev</span>
                    </button>
                  </div>
                </div>

                <div className="text-[11px] text-zinc-500 flex items-center justify-between">
                  <span>Phiên bản gốc trong JAR: <strong className="font-mono text-zinc-700">{originalVersion}</strong></span>
                  <span className="text-[10px] text-emerald-700">Mỗi lần tải về hoặc sửa, phiên bản có thể tự tăng riêng biệt.</span>
                </div>
              </div>

              {/* Preview trực quan */}
              <div className="p-3.5 rounded-lg border border-zinc-200 bg-zinc-50 space-y-2">
                <div className="text-[11px] font-bold text-zinc-700 flex items-center gap-1.5 uppercase tracking-wide">
                  <FileCode className="w-3.5 h-3.5 text-zinc-500" />
                  <span>Xem trước kết quả xuất JAR:</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] font-mono">
                  <div className="p-2 rounded bg-white border border-zinc-200">
                    <span className="text-zinc-400 block text-[10px] mb-0.5">Tên file tải về:</span>
                    <span className="font-bold text-emerald-700 break-all select-all flex items-center gap-1">
                      <Download className="w-3.5 h-3.5 shrink-0" />
                      <span>{resolvedFileName}</span>
                    </span>
                  </div>

                  <div className="p-2 rounded bg-white border border-zinc-200">
                    <span className="text-zinc-400 block text-[10px] mb-0.5">META-INF/MANIFEST.MF:</span>
                    <div className="text-zinc-600 space-y-0.5 text-[10px]">
                      <div>MIDlet-Name: <strong className="text-zinc-800">{gameName || '(trống)'}</strong></div>
                      <div>MIDlet-Vendor: <strong className="text-zinc-800">{author || '(trống)'}</strong></div>
                      <div>MIDlet-Version: <strong className="text-zinc-800">{version || '(trống)'}</strong></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'naming' && (
            <div className="space-y-4">
              <div>
                <label className="block text-zinc-700 font-semibold mb-1">
                  Chọn mẫu định dạng tên file xuất (.jar):
                </label>
                <div className="space-y-1.5">
                  {PRESET_PATTERNS.map((preset) => (
                    <div
                      key={preset.pattern}
                      onClick={() => setNamingPattern(preset.pattern)}
                      className={`p-2.5 rounded-md border text-xs cursor-pointer flex items-center justify-between transition-all ${
                        namingPattern === preset.pattern
                          ? 'border-emerald-500 bg-emerald-50/70 font-semibold text-emerald-800 ring-1 ring-emerald-400'
                          : 'border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700'
                      }`}
                    >
                      <div className="space-y-0.5">
                        <div className="font-mono text-[11px]">{preset.pattern}</div>
                        <div className="text-[10px] text-zinc-400">{preset.label}</div>
                      </div>
                      <span className="text-[10px] font-mono text-zinc-500 bg-zinc-100 px-2 py-0.5 rounded border border-zinc-200">
                        {preset.example}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-zinc-700 font-semibold mb-1 flex items-center justify-between">
                  <span>Mẫu tùy biến (Custom Pattern):</span>
                  <span className="text-[10px] text-zinc-400">Các tag: &#123;name&#125;, &#123;version&#125;, &#123;author&#125;, &#123;timestamp&#125;, &#123;rev&#125;</span>
                </label>
                <input
                  id="metadata-pattern-input"
                  type="text"
                  value={namingPattern}
                  onChange={(e) => setNamingPattern(e.target.value)}
                  className="w-full px-3 py-2 sm:py-1.5 rounded-md border border-zinc-300 font-mono text-[16px] sm:text-xs outline-none bg-white text-zinc-800 focus:border-emerald-500"
                />
              </div>

              {/* Tùy chọn tự động tăng phiên bản */}
              <div className="p-3.5 rounded-lg border border-zinc-200 bg-zinc-50 space-y-3">
                <div className="text-zinc-700 font-bold text-xs uppercase tracking-wide flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-zinc-500" />
                  <span>Cài đặt tự động tăng phiên bản riêng:</span>
                </div>

                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoIncrementOnDownload}
                    onChange={(e) => setAutoIncrementOnDownload(e.target.checked)}
                    className="mt-0.5 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                  />
                  <div>
                    <span className="font-semibold text-zinc-800 block">
                      Tự động tăng phiên bản mỗi lần tải file về (Khuyên dùng)
                    </span>
                    <span className="text-[11px] text-zinc-500">
                      Mỗi file tải về sẽ có một tên phiên bản độc nhất (ví dụ v1.0.0, rồi v1.0.1, v1.0.2...) để dễ dàng phân biệt các bản patch bạn đã chia sẻ hoặc thử nghiệm.
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoIncrementOnEdit}
                    onChange={(e) => setAutoIncrementOnEdit(e.target.checked)}
                    className="mt-0.5 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                  />
                  <div>
                    <span className="font-semibold text-zinc-800 block">
                      Tự động tăng phiên bản khi sửa đổi / lưu nháp dữ liệu
                    </span>
                    <span className="text-[11px] text-zinc-500">
                      Tự động nhảy số phiên bản mỗi khi bạn thêm Item mới, Boss mới, chỉnh nhiệm vụ hoặc sửa cơ chế game.
                    </span>
                  </div>
                </label>

                <div className="pt-2 border-t border-zinc-200">
                  <span className="block text-zinc-600 font-semibold mb-1.5">
                    Kiểu tăng phiên bản mặc định khi tự động:
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'patch', label: 'Patch (+0.0.1)', desc: '1.0.0 -> 1.0.1' },
                      { id: 'minor', label: 'Minor (+0.1.0)', desc: '1.0.0 -> 1.1.0' },
                      { id: 'revision', label: 'Revision (+rev)', desc: '1.0.0 -> 1.0.0.1' },
                    ].map((st) => (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => setIncrementStrategy(st.id as VersionIncrementStrategy)}
                        className={`p-2 rounded border text-left cursor-pointer transition-all ${
                          incrementStrategy === st.id
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-800 font-semibold'
                            : 'border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700'
                        }`}
                      >
                        <div className="text-[11px]">{st.label}</div>
                        <div className="text-[9px] font-mono text-zinc-400">{st.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-zinc-600 font-semibold">
                  Nhật ký các lần xuất và chỉnh sửa phiên bản:
                </span>
                <span className="text-[10px] text-zinc-400">Tối đa 50 bản ghi gần nhất</span>
              </div>

              {!metadata.history || metadata.history.length === 0 ? (
                <div className="p-8 text-center bg-zinc-50 rounded-lg border border-dashed border-zinc-200 text-zinc-400 space-y-1">
                  <History className="w-6 h-6 mx-auto opacity-40 text-zinc-400" />
                  <div className="text-xs font-medium">Chưa có lịch sử phiên bản nào.</div>
                  <div className="text-[11px]">Lịch sử sẽ tự động được ghi nhận mỗi khi bạn tải file JAR về hoặc đổi phiên bản.</div>
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {metadata.history.map((item) => (
                    <div
                      key={item.id}
                      className="p-2.5 rounded-lg border border-zinc-200 bg-white hover:border-zinc-300 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold font-mono uppercase ${
                            item.action === 'EXPORT'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              : item.action === 'EDIT'
                              ? 'bg-blue-100 text-blue-800 border border-blue-200'
                              : 'bg-zinc-100 text-zinc-700 border border-zinc-200'
                          }`}>
                            {item.action === 'EXPORT' ? 'Tải về' : item.action === 'EDIT' ? 'Sửa nháp' : 'Thủ công'}
                          </span>
                          <span className="font-mono font-bold text-zinc-800">
                            v{item.version}
                          </span>
                          <span className="text-[10px] text-zinc-400">
                            {new Date(item.timestamp).toLocaleTimeString('vi-VN')} {new Date(item.timestamp).toLocaleDateString('vi-VN')}
                          </span>
                        </div>
                        <div className="text-[11px] text-zinc-600 truncate">
                          {item.description}
                        </div>
                        {item.fileName && (
                          <div className="text-[10px] font-mono text-zinc-400 truncate">
                            File: {item.fileName}
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setVersion(item.version);
                          setActiveTab('general');
                        }}
                        className="shrink-0 px-2 py-1 rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-mono text-[10px] flex items-center gap-1 cursor-pointer"
                        title="Dùng lại phiên bản này"
                      >
                        <ArrowUpRight className="w-3 h-3" />
                        <span>Dùng lại</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-zinc-200 bg-zinc-50 flex items-center justify-between">
          <div className="text-[11px] text-zinc-500 font-mono truncate max-w-xs sm:max-w-md">
            File sẽ tải: <strong className="text-emerald-700">{resolvedFileName}</strong>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md border border-zinc-300 bg-white hover:bg-zinc-100 text-zinc-700 text-xs font-medium transition-colors cursor-pointer"
            >
              Hủy
            </button>
            <button
              id="save-metadata-button"
              type="button"
              onClick={handleSave}
              className="px-4 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
            >
              {saveSuccess ? <Check className="w-3.5 h-3.5" /> : null}
              <span>{saveSuccess ? 'Đã lưu!' : 'Lưu cấu hình'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
