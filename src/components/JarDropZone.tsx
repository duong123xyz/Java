import React, { useState, useRef, DragEvent, ChangeEvent } from 'react';
import { Upload, FileCode2, AlertCircle, Loader2 } from 'lucide-react';

interface JarDropZoneProps {
  onFileSelect: (file: File) => void;
  isLoading: boolean;
  errorMessage: string | null;
}

export const JarDropZone: React.FC<JarDropZoneProps> = ({
  onFileSelect,
  isLoading,
  errorMessage,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isLoading) setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (isLoading) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.name.toLowerCase().endsWith('.jar')) onFileSelect(file);
      else alert('Vui lòng chỉ chọn file .jar');
    }
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) onFileSelect(e.target.files[0]);
  };

  const triggerBrowse = () => {
    if (!isLoading && fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  return (
    <div id="jar-dropzone-container" className="w-full max-w-2xl mx-auto">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg shadow-sm overflow-hidden">
        <div className="border-b border-zinc-800 bg-zinc-950/60 px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileCode2 className="w-4 h-4 text-zinc-400" />
            <h2 className="text-sm font-semibold text-zinc-200 tracking-wide uppercase">
              Mở file game JAR
            </h2>
          </div>
          <span className="text-xs font-mono text-zinc-500">Phân tích an toàn trong RAM</span>
        </div>

        <div className="p-6">
          <input
            id="jar-file-input"
            ref={fileInputRef}
            type="file"
            accept=".jar,application/java-archive"
            className="hidden"
            onChange={handleFileInputChange}
            disabled={isLoading}
          />

          <div
            id="jar-drop-area"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={triggerBrowse}
            className={`cursor-pointer rounded-md border-2 border-dashed transition-colors p-10 flex flex-col items-center justify-center text-center ${
              isDragOver
                ? 'border-emerald-500 bg-emerald-950/10'
                : 'border-zinc-700 hover:border-zinc-500 bg-zinc-950/30'
            } ${isLoading ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            {isLoading ? (
              <div className="flex flex-col items-center gap-3 py-4">
                <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
                <p className="text-sm font-medium text-zinc-300">Đang đọc cấu trúc JAR bằng JSZip...</p>
                <p className="text-xs text-zinc-500">Quá trình diễn ra hoàn toàn trong bộ nhớ trình duyệt</p>
              </div>
            ) : (
              <>
                <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mb-4 text-zinc-300">
                  <Upload className="w-6 h-6" />
                </div>
                <p className="text-base font-medium text-zinc-200 mb-1">Thả file .jar vào đây</p>
                <p className="text-xs text-zinc-500 mb-4">hoặc bấm để chọn file game J2ME (.jar)</p>
                <button
                  id="browse-jar-button"
                  type="button"
                  onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                    e.stopPropagation();
                    triggerBrowse();
                  }}
                  className="px-4 py-2 text-xs font-medium text-zinc-100 bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 border border-zinc-700 rounded transition-colors"
                >
                  [ Chọn file JAR ]
                </button>
                <p className="text-[11px] text-zinc-500 mt-3 font-mono">
                  Chỉ chấp nhận *.jar, ví dụ: NgocRongChay-v1.3.8.jar
                </p>
              </>
            )}
          </div>

          {errorMessage && (
            <div id="jar-error-alert" className="mt-4 p-3.5 bg-red-950/40 border border-red-900/60 rounded-md flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-red-300">Trạng thái: JAR không hợp lệ hoặc chưa được hỗ trợ</p>
                <p className="text-xs text-red-400/90 mt-0.5 font-mono">{errorMessage}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
