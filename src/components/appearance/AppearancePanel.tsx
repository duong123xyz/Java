import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  Image as ImageIcon,
  Layers3,
  Loader2,
  RotateCcw,
  Search,
  Shirt,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { LoadedJarSession } from '../../types/jar';
import { SmallImagePreview } from '../game-data/SmallImagePreview';
import { NpcBodyPreview } from '../game-data/NpcBodyPreview';
import {
  analyzePartUsages,
  getDirtyPartCount,
  getPartDraft,
  getPartTypeLabel,
  isPartDraftDirty,
  loadPartSnapshot,
  PartDataSnapshot,
  PartDraft,
  PartFrameDefinition,
  PartUsageRef,
  resetPartDraft,
  setPartDraft,
} from '../../services/partDataService';

interface AppearancePanelProps {
  session: LoadedJarSession;
  onDraftsUpdated?: (count: number) => void;
}

type PartTypeFilter = 'all' | 0 | 1 | 2;

const TYPE_FILTERS: Array<{ value: PartTypeFilter; label: string }> = [
  { value: 'all', label: 'Tất cả' },
  { value: 0, label: 'Head' },
  { value: 1, label: 'Body' },
  { value: 2, label: 'Leg' },
];

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString('vi-VN') : '0';
}

function usageBadge(kind: PartUsageRef['kind']): string {
  return kind === 'item'
    ? 'Vật phẩm'
    : kind === 'npc'
    ? 'NPC'
    : 'Boss';
}

export function AppearancePanel({
  session,
  onDraftsUpdated,
}: AppearancePanelProps) {
  const [snapshot, setSnapshot] = useState<PartDataSnapshot | null>(null);
  const [usages, setUsages] = useState<Map<number, PartUsageRef[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [usageLoading, setUsageLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<PartTypeFilter>('all');
  const [dirtyOnly, setDirtyOnly] = useState(false);
  const [selectedPartId, setSelectedPartId] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);

  const [previewHead, setPreviewHead] = useState(64);
  const [previewBody, setPreviewBody] = useState(65);
  const [previewLeg, setPreviewLeg] = useState(66);

  useEffect(() => {
    let active = true;

    setLoading(true);
    setUsageLoading(true);
    setError(null);

    loadPartSnapshot(session)
      .then((result) => {
        if (!active) return;
        setSnapshot(result);
        setSelectedPartId((current) => current ?? result.parts[0]?.id ?? null);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    analyzePartUsages(session)
      .then((result) => {
        if (active) setUsages(result);
      })
      .catch((err) => {
        console.warn('[AppearancePanel] usage analysis failed', err);
      })
      .finally(() => {
        if (active) setUsageLoading(false);
      });

    return () => {
      active = false;
    };
  }, [session]);

  const onDraftsUpdatedRef = useRef(onDraftsUpdated);
  onDraftsUpdatedRef.current = onDraftsUpdated;

  useEffect(() => {
    if (!snapshot) return;
    void revision;
    onDraftsUpdatedRef.current?.(getDirtyPartCount(session, snapshot.parts));
  }, [session, snapshot, revision]);

  const visibleParts = useMemo(() => {
    if (!snapshot) return [];
    const q = query.trim().toLowerCase();

    return snapshot.parts.filter((part) => {
      if (typeFilter !== 'all' && part.type !== typeFilter) return false;

      const draft = getPartDraft(session, part);
      if (dirtyOnly && !isPartDraftDirty(part, draft)) return false;

      if (!q) return true;

      return (
        String(part.id).includes(q) ||
        getPartTypeLabel(part.type).toLowerCase().includes(q) ||
        part.sourceClass.toLowerCase().includes(q) ||
        draft.frames.some((frame) => String(frame.imageId).includes(q))
      );
    });
  }, [snapshot, typeFilter, dirtyOnly, query, session, revision]);

  const selectedPart = useMemo(() => {
    if (!snapshot) return null;
    return (
      snapshot.catalog.get(selectedPartId ?? -1) ??
      visibleParts[0] ??
      snapshot.parts[0] ??
      null
    );
  }, [snapshot, selectedPartId, visibleParts]);

  const selectedDraft = useMemo(() => {
    if (!selectedPart) return null;
    void revision;
    return getPartDraft(session, selectedPart);
  }, [session, selectedPart, revision]);

  const selectedUsage = selectedPart ? usages.get(selectedPart.id) ?? [] : [];
  const dirtyCount = snapshot
    ? getDirtyPartCount(session, snapshot.parts)
    : 0;

  const updateDraft = (next: PartDraft) => {
    if (!selectedPart) return;
    setPartDraft(session, selectedPart, next);
    setRevision((value) => value + 1);
  };

  const updateFrame = (
    frameIndex: number,
    patch: Partial<PartFrameDefinition>
  ) => {
    if (!selectedDraft) return;
    const frames = selectedDraft.frames.map((frame, index) =>
      index === frameIndex ? { ...frame, ...patch } : { ...frame }
    );
    updateDraft({ frames });
  };

  const useSelectedInPreview = () => {
    if (!selectedPart) return;
    if (selectedPart.type === 0) setPreviewHead(selectedPart.id);
    if (selectedPart.type === 1) setPreviewBody(selectedPart.id);
    if (selectedPart.type === 2) setPreviewLeg(selectedPart.id);
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center rounded-2xl border border-zinc-200 bg-white">
        <div className="text-center space-y-2">
          <Loader2 className="w-6 h-6 animate-spin mx-auto text-pink-500" />
          <div className="text-xs font-mono text-zinc-500">
            Đang đọc 14 bảng Part Data...
          </div>
        </div>
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="h-full flex items-center justify-center rounded-2xl border border-red-200 bg-red-50">
        <div className="max-w-xl p-5 text-red-700 text-xs font-mono">
          <div className="flex items-center gap-2 font-bold mb-2">
            <AlertTriangle className="w-4 h-4" />
            Không đọc được Part Data
          </div>
          <div className="whitespace-pre-wrap">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col gap-2">
      <div className="shrink-0 rounded-xl border border-zinc-200 bg-white shadow-sm px-3 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-pink-50 border border-pink-200 flex items-center justify-center">
            <Shirt className="w-4 h-4 text-pink-600" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-zinc-900">Ngoại hình / Parts</span>
              <Chip>{formatNumber(snapshot.totalParts)} part</Chip>
              <Chip>{snapshot.headCount} head</Chip>
              <Chip>{snapshot.bodyCount} body</Chip>
              <Chip>{snapshot.legCount} leg</Chip>
              <Chip>14 bảng F → S</Chip>
              {dirtyCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-pink-50 border border-pink-200 text-pink-700 text-[10px] font-mono">
                  {dirtyCount} nháp
                </span>
              )}
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">
              Chỉnh SmallImage + offset từng frame, ghép thử head/body/leg và kiểm tra item/NPC/Boss đang dùng part.
            </div>
          </div>
        </div>

        <div className="hidden xl:flex items-center gap-1.5 text-[10px] text-emerald-600 font-mono">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Có writer Test nháp
        </div>
      </div>

      <div className="shrink-0 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-[10px] text-blue-700">
        Part ID và số frame được khóa để tránh phá index runtime. Phase này chỉnh <strong>SmallImage ID / dx / dy</strong> trên part hiện có.
        Muốn thêm part hoàn toàn mới sẽ cần row-insertion writer riêng.
      </div>

      <div className="min-h-0 flex-1 grid grid-cols-1 xl:grid-cols-[330px_minmax(0,1fr)] gap-2">
        <aside className="min-h-0 rounded-xl border border-zinc-200 bg-white shadow-sm overflow-hidden flex flex-col">
          <div className="shrink-0 p-2.5 border-b border-zinc-200 space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Tìm part ID, SmallImage ID, class..."
                className="w-full pl-8 pr-3 py-2 rounded-lg border border-zinc-200 bg-zinc-50 text-[11px] text-zinc-900 focus:outline-none focus:border-pink-300 focus:ring-2 focus:ring-pink-100"
              />
            </div>

            <div className="flex items-center gap-1 overflow-x-auto">
              {TYPE_FILTERS.map((filter) => (
                <FilterButton
                  key={String(filter.value)}
                  active={typeFilter === filter.value}
                  onClick={() => setTypeFilter(filter.value)}
                >
                  {filter.label}
                </FilterButton>
              ))}
              <FilterButton
                active={dirtyOnly}
                onClick={() => setDirtyOnly((value) => !value)}
              >
                Có nháp
              </FilterButton>
            </div>
          </div>

          <div className="shrink-0 h-8 px-3 flex items-center justify-between border-b border-zinc-200 bg-zinc-50 text-[9px] text-zinc-500 font-mono">
            <span>Danh sách Part</span>
            <span>{visibleParts.length}/{snapshot.totalParts}</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1.5 space-y-1">
            {visibleParts.map((part) => {
              const draft = getPartDraft(session, part);
              const dirty = isPartDraftDirty(part, draft);
              const selected = selectedPart?.id === part.id;
              const usageCount = usages.get(part.id)?.length ?? 0;

              return (
                <button
                  key={part.id}
                  type="button"
                  onClick={() => setSelectedPartId(part.id)}
                  className={`w-full rounded-xl border px-2 py-2 text-left transition cursor-pointer ${
                    selected
                      ? 'border-pink-300 bg-pink-50'
                      : dirty
                      ? 'border-pink-200 bg-pink-50/60 hover:bg-pink-50'
                      : 'border-zinc-200 bg-white hover:bg-zinc-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <SmallImagePreview
                      session={session}
                      imageId={draft.frames[0]?.imageId ?? -1}
                      alt={`Part ${part.id} frame 0`}
                      variant="icon"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-[12px] text-zinc-900">
                          Part #{part.id}
                        </span>
                        {dirty && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-pink-100 text-pink-700 border border-pink-200 font-mono">
                            nháp
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">
                        {getPartTypeLabel(part.type)} · {draft.frames.length} frame · {part.sourceClass.split('/').pop()}.u
                      </div>
                      <div className="mt-1 text-[9px] text-zinc-500 font-mono">
                        image đầu #{draft.frames[0]?.imageId ?? '-'} · dùng {usageCount} nơi
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="min-h-0 overflow-auto space-y-2">
          {selectedPart && selectedDraft ? (
            <>
              <div className="rounded-xl border border-zinc-200 bg-white shadow-sm p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-bold text-zinc-900">
                      Part #{selectedPart.id}
                    </h2>
                    <Chip>{getPartTypeLabel(selectedPart.type)}</Chip>
                    <Chip>{selectedDraft.frames.length} frame</Chip>
                    <Chip>{selectedPart.sourceClass}.u[{selectedPart.sourceRow}]</Chip>
                    {isPartDraftDirty(selectedPart, selectedDraft) && (
                      <span className="px-2 py-0.5 rounded-full bg-pink-50 border border-pink-200 text-pink-700 text-[10px] font-mono">
                        Đã sửa
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-[10px] text-zinc-500">
                    Part type: 0 = Head, 1 = Body, 2 = Leg. Writer chỉ thay cột <code>frames</code>.
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={useSelectedInPreview}
                    className="px-3 py-1.5 rounded-lg border border-pink-200 bg-pink-50 hover:bg-pink-100 text-pink-700 text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Dùng trong preview
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      resetPartDraft(session, selectedPart);
                      setRevision((value) => value + 1);
                    }}
                    className="px-3 py-1.5 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 text-[11px] font-medium flex items-center gap-1.5 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Trả về gốc
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_390px] gap-2">
                <div className="space-y-2">
                  <Section
                    title="Frame editor"
                    subtitle="Mỗi dòng tương ứng đúng một frame runtime. Sửa image/offset rồi Test nháp để patch bảng Part Data."
                  >
                    <div className="space-y-2">
                      {selectedDraft.frames.map((frame, index) => (
                        <div
                          key={index}
                          className="rounded-xl border border-zinc-200 bg-zinc-50 p-2.5 grid grid-cols-[72px_minmax(0,1fr)] gap-3"
                        >
                          <div>
                            <SmallImagePreview
                              session={session}
                              imageId={frame.imageId}
                              alt={`Part ${selectedPart.id} frame ${index}`}
                              variant="medium"
                            />
                            <div className="mt-1 text-center text-[9px] text-zinc-500 font-mono">
                              frame {index}
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 content-start">
                            <NumberField
                              label="SmallImage ID"
                              value={frame.imageId}
                              onChange={(value) =>
                                updateFrame(index, { imageId: value })
                              }
                            />
                            <NumberField
                              label="dx"
                              value={frame.dx}
                              onChange={(value) =>
                                updateFrame(index, { dx: value })
                              }
                            />
                            <NumberField
                              label="dy"
                              value={frame.dy}
                              onChange={(value) =>
                                updateFrame(index, { dy: value })
                              }
                            />
                            <div className="sm:col-span-3 text-[9px] text-zinc-500 font-mono">
                              [{frame.imageId},{frame.dx},{frame.dy}]
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Section>

                  <Section
                    title="Đang được dùng ở đâu?"
                    subtitle="Cross-reference theo Item Template, NPC và Boss đã parse."
                  >
                    {usageLoading ? (
                      <div className="py-8 flex items-center justify-center gap-2 text-[11px] text-zinc-500">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Đang rà item / NPC / boss...
                      </div>
                    ) : selectedUsage.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 py-8 text-center text-[11px] text-zinc-500">
                        Chưa tìm thấy reference trực tiếp tới part này trong các bảng đã hỗ trợ.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {selectedUsage.slice(0, 80).map((usage, index) => (
                          <div
                            key={`${usage.kind}-${usage.label}-${index}`}
                            className="rounded-xl border border-zinc-200 bg-zinc-50 p-2.5"
                          >
                            <div className="flex items-center gap-2">
                              <span className={`px-1.5 py-0.5 rounded-full border text-[9px] font-mono ${
                                usage.kind === 'item'
                                  ? 'bg-amber-50 border-amber-200 text-amber-700'
                                  : usage.kind === 'npc'
                                  ? 'bg-cyan-50 border-cyan-200 text-cyan-700'
                                  : 'bg-rose-50 border-rose-200 text-rose-700'
                              }`}>
                                {usageBadge(usage.kind)}
                              </span>
                              <span className="text-[11px] font-semibold text-zinc-900 truncate">
                                {usage.label}
                              </span>
                            </div>
                            <div className="mt-1 text-[9px] text-zinc-500 font-mono">
                              {usage.detail}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Section>
                </div>

                <div className="space-y-2">
                  <Section
                    title="Ghép thử ngoại hình"
                    subtitle="Dùng để tìm bộ head/body/leg trước khi gán vào Item/NPC/Boss."
                  >
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      <NumberField
                        label="Head"
                        value={previewHead}
                        onChange={setPreviewHead}
                      />
                      <NumberField
                        label="Body"
                        value={previewBody}
                        onChange={setPreviewBody}
                      />
                      <NumberField
                        label="Leg"
                        value={previewLeg}
                        onChange={setPreviewLeg}
                      />
                    </div>

                    <div className="flex flex-wrap gap-1.5 mb-3">
                      <PresetButton
                        onClick={() => {
                          setPreviewHead(64);
                          setPreviewBody(65);
                          setPreviewLeg(66);
                        }}
                      >
                        Trái Đất 64/65/66
                      </PresetButton>
                      <PresetButton
                        onClick={() => {
                          setPreviewHead(9);
                          setPreviewBody(10);
                          setPreviewLeg(11);
                        }}
                      >
                        Namek 9/10/11
                      </PresetButton>
                      <PresetButton
                        onClick={() => {
                          setPreviewHead(6);
                          setPreviewBody(7);
                          setPreviewLeg(8);
                        }}
                      >
                        Xayda 6/7/8
                      </PresetButton>
                    </div>

                    <NpcBodyPreview
                      session={session}
                      head={previewHead}
                      body={previewBody}
                      leg={previewLeg}
                      alt={`Preview ${previewHead}/${previewBody}/${previewLeg}`}
                      showTechnicalInfo
                    />
                  </Section>

                  <Section
                    title="Cấu trúc Part Data"
                    subtitle="Thông tin kỹ thuật để tránh nhầm giữa Part ID và SmallImage ID."
                  >
                    <div className="space-y-2 text-[10px]">
                      <InfoRow
                        icon={<Layers3 className="w-3.5 h-3.5 text-pink-500" />}
                        title="Part ID"
                        text="ID logic được NPC/Boss/Item tham chiếu. Ví dụ head #64."
                      />
                      <InfoRow
                        icon={<ImageIcon className="w-3.5 h-3.5 text-blue-500" />}
                        title="SmallImage ID"
                        text="Ảnh PNG thật nằm trong smallimage pack. Một part dùng nhiều SmallImage."
                      />
                      <InfoRow
                        icon={<Sparkles className="w-3.5 h-3.5 text-violet-500" />}
                        title="dx / dy"
                        text="Offset của từng frame; thay sai có thể làm đầu/áo/quần lệch vị trí."
                      />
                      <InfoRow
                        icon={<UserRound className="w-3.5 h-3.5 text-emerald-500" />}
                        title="Preview đứng"
                        text="Ghép theo đúng offset renderer đứng của client a.bV."
                      />
                    </div>
                  </Section>
                </div>
              </div>
            </>
          ) : (
            <div className="h-full rounded-xl border border-zinc-200 bg-white flex items-center justify-center text-sm text-zinc-500">
              Chọn một Part ở cột trái.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <div className="text-[9px] text-zinc-500 font-mono mb-1">{label}</div>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-200 bg-white text-[11px] font-mono text-zinc-900 focus:outline-none focus:border-pink-300 focus:ring-2 focus:ring-pink-100"
      />
    </label>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
      <div className="px-3 py-2.5 border-b border-zinc-200 bg-zinc-50">
        <div className="text-[12px] font-semibold text-zinc-900">{title}</div>
        {subtitle && (
          <div className="text-[9px] text-zinc-500 mt-0.5">{subtitle}</div>
        )}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-2 py-0.5 rounded-full bg-zinc-50 border border-zinc-200 text-zinc-600 text-[10px] font-mono">
      {children}
    </span>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full border text-[10px] whitespace-nowrap cursor-pointer ${
        active
          ? 'bg-pink-50 border-pink-200 text-pink-700 font-semibold'
          : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'
      }`}
    >
      {children}
    </button>
  );
}

function PresetButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2 py-1 rounded-lg border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 text-[9px] text-zinc-600 cursor-pointer"
    >
      {children}
    </button>
  );
}

function InfoRow({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-2.5 flex gap-2">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div>
        <div className="font-semibold text-zinc-800">{title}</div>
        <div className="text-zinc-500 mt-0.5">{text}</div>
      </div>
    </div>
  );
}
