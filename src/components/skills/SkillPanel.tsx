import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Coins,
  Crosshair,
  Dumbbell,
  Gauge,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Swords,
  Target,
  Zap,
} from 'lucide-react';
import { LoadedJarSession } from '../../types/jar';
import { SmallImagePreview } from '../game-data/SmallImagePreview';
import {
  analyzeSkills,
  getDirtySkillCount,
  getSkillDraft,
  getSkillPlanetName,
  isSkillDraftDirty,
  resetSkillDraft,
  setSkillDraft,
  SkillDataSnapshot,
  SkillDraft,
  SkillLevelRecord,
  SkillRecord,
} from '../../services/skillDataService';

interface SkillPanelProps {
  session: LoadedJarSession;
  onDraftsUpdated?: (count: number) => void;
}

type PlanetFilter = 'all' | 0 | 1 | 2;

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString('vi-VN') : '0';
}

function formatCooldown(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)} s`;
  return `${(ms / 60_000).toFixed(ms % 60_000 === 0 ? 0 : 1)} phút`;
}

export function SkillPanel({ session, onDraftsUpdated }: SkillPanelProps) {
  const [snapshot, setSnapshot] = useState<SkillDataSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [planetFilter, setPlanetFilter] = useState<PlanetFilter>('all');
  const [dirtyOnly, setDirtyOnly] = useState(false);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await analyzeSkills(session);
      setSnapshot(result);
      setSelectedRow((current) => current ?? result.skills[0]?.rowIndex ?? null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [session]);

  useEffect(() => {
    if (!snapshot) return;
    void revision;
    onDraftsUpdated?.(getDirtySkillCount(session, snapshot.skills));
  }, [session, snapshot, revision, onDraftsUpdated]);

  const visibleSkills = useMemo(() => {
    if (!snapshot) return [];
    const q = query.trim().toLowerCase();
    return snapshot.skills.filter((skill) => {
      if (planetFilter !== 'all' && skill.nclassId !== planetFilter) return false;
      if (dirtyOnly && !isSkillDraftDirty(skill, getSkillDraft(session, skill))) {
        return false;
      }
      if (!q) return true;
      const levelIds = skill.levels.map((level) => level.id).join(' ');
      return (
        skill.name.toLowerCase().includes(q) ||
        String(skill.id).includes(q) ||
        String(skill.iconId).includes(q) ||
        levelIds.includes(q) ||
        skill.damageInfo.toLowerCase().includes(q)
      );
    });
  }, [snapshot, query, planetFilter, dirtyOnly, revision, session]);

  const selectedSkill = useMemo(() => {
    if (!snapshot) return null;
    return (
      snapshot.skills.find((skill) => skill.rowIndex === selectedRow) ??
      visibleSkills[0] ??
      snapshot.skills[0] ??
      null
    );
  }, [snapshot, selectedRow, visibleSkills]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center rounded-2xl border border-zinc-200 bg-white">
        <div className="text-center space-y-2">
          <Loader2 className="w-6 h-6 animate-spin mx-auto text-fuchsia-500" />
          <div className="text-xs font-mono text-zinc-500">Đang đọc bảng kỹ năng a/a/a/W...</div>
        </div>
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="h-full flex items-center justify-center rounded-2xl border border-red-200 bg-red-50">
        <div className="max-w-xl p-4 text-red-700 text-xs font-mono">
          <div className="flex items-center gap-2 font-bold mb-2">
            <AlertTriangle className="w-4 h-4" />
            Không đọc được bảng kỹ năng
          </div>
          <div className="whitespace-pre-wrap">{error}</div>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 px-3 py-1.5 rounded-lg bg-red-100 hover:bg-red-200 cursor-pointer"
          >
            Thử lại
          </button>
        </div>
      </div>
    );
  }

  const dirtyCount = getDirtySkillCount(session, snapshot.skills);

  return (
    <div className="h-full min-h-0 flex flex-col gap-2">
      <div className="shrink-0 rounded-xl border border-zinc-200 bg-white shadow-sm px-3 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-fuchsia-50 border border-fuchsia-200 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-fuchsia-600" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-zinc-900">Kỹ năng</span>
              <Chip>{snapshot.skills.length} skill template</Chip>
              <Chip>{snapshot.levelCount} cấp skill</Chip>
              <Chip>a/a/a/W.u</Chip>
              {dirtyCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-fuchsia-50 border border-fuchsia-200 text-fuchsia-700 text-[10px] font-mono">
                  {dirtyCount} nháp
                </span>
              )}
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">
              Sửa damage, KI, cooldown, tầm đánh, yêu cầu sức mạnh và chi phí theo từng cấp. Có writer cho Test nháp.
            </div>
          </div>
        </div>
        <div className="hidden xl:flex items-center gap-1.5 text-[10px] text-emerald-600 font-mono">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Static table writer
        </div>
      </div>

      <div className="min-h-0 flex-1 grid grid-cols-1 xl:grid-cols-[330px_minmax(0,1fr)] gap-2">
        <aside className="min-h-0 rounded-xl border border-zinc-200 bg-white shadow-sm overflow-hidden flex flex-col">
          <div className="shrink-0 p-2.5 border-b border-zinc-200 space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Tìm tên, skill ID, level ID..."
                className="w-full pl-8 pr-3 py-2 rounded-lg border border-zinc-200 bg-zinc-50 text-[11px] text-zinc-900 focus:outline-none focus:border-fuchsia-300 focus:ring-2 focus:ring-fuchsia-100"
              />
            </div>

            <div className="flex items-center gap-1 overflow-x-auto">
              <FilterButton active={planetFilter === 'all'} onClick={() => setPlanetFilter('all')}>Tất cả</FilterButton>
              <FilterButton active={planetFilter === 0} onClick={() => setPlanetFilter(0)}>Trái Đất</FilterButton>
              <FilterButton active={planetFilter === 1} onClick={() => setPlanetFilter(1)}>Namek</FilterButton>
              <FilterButton active={planetFilter === 2} onClick={() => setPlanetFilter(2)}>Xayda</FilterButton>
              <FilterButton active={dirtyOnly} onClick={() => setDirtyOnly((value) => !value)}>Có nháp</FilterButton>
            </div>
          </div>

          <div className="shrink-0 h-8 px-3 flex items-center justify-between border-b border-zinc-200 bg-zinc-50 text-[9px] text-zinc-500 font-mono">
            <span>Danh sách kỹ năng</span>
            <span>{visibleSkills.length}/{snapshot.skills.length}</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1.5 space-y-1">
            {visibleSkills.map((skill) => {
              const draft = getSkillDraft(session, skill);
              const dirty = isSkillDraftDirty(skill, draft);
              const selected = selectedSkill?.rowIndex === skill.rowIndex;
              const first = draft.levels[0];
              const last = draft.levels[draft.levels.length - 1];

              return (
                <button
                  key={skill.rowIndex}
                  type="button"
                  onClick={() => setSelectedRow(skill.rowIndex)}
                  className={`w-full p-2 rounded-lg border text-left transition-all cursor-pointer ${
                    selected
                      ? 'border-fuchsia-300 bg-fuchsia-50'
                      : 'border-transparent hover:border-zinc-200 hover:bg-zinc-50'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <SmallImagePreview
                      session={session}
                      imageId={draft.iconId}
                      alt={draft.name}
                      variant="icon"
                      className="shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[11px] font-bold text-zinc-900">{draft.name}</span>
                        {dirty && <span className="w-1.5 h-1.5 rounded-full bg-fuchsia-500 shrink-0" />}
                      </div>
                      <div className="text-[9px] text-zinc-500 mt-0.5">
                        {getSkillPlanetName(skill.nclassId)} · ID {skill.id} · slot {draft.slot}
                      </div>
                      <div className="text-[9px] text-zinc-500 font-mono mt-1">
                        {draft.levels.length} cấp · dmg {first?.damage ?? 0}→{last?.damage ?? 0}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}

            {visibleSkills.length === 0 && (
              <div className="p-6 text-center text-[11px] text-zinc-500">Không có kỹ năng phù hợp bộ lọc.</div>
            )}
          </div>
        </aside>

        <section className="min-h-0">
          {selectedSkill ? (
            <SkillEditor
              key={`${selectedSkill.rowIndex}-${revision}`}
              session={session}
              skill={selectedSkill}
              onChanged={() => setRevision((value) => value + 1)}
            />
          ) : (
            <div className="h-full rounded-xl border border-zinc-200 bg-white flex items-center justify-center text-zinc-500 text-sm">
              Chọn một kỹ năng.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function SkillEditor({
  session,
  skill,
  onChanged,
}: {
  session: LoadedJarSession;
  skill: SkillRecord;
  onChanged: () => void;
}) {
  const [draft, setDraftState] = useState<SkillDraft>(() => getSkillDraft(session, skill));
  const [selectedLevel, setSelectedLevel] = useState(0);

  useEffect(() => {
    setDraftState(getSkillDraft(session, skill));
    setSelectedLevel(0);
  }, [session, skill.rowIndex]);

  const dirty = isSkillDraftDirty(skill, draft);
  const level = draft.levels[selectedLevel] ?? draft.levels[0];
  const originalLevel = skill.levels[selectedLevel] ?? skill.levels[0];

  const save = (next: SkillDraft) => {
    setSkillDraft(session, skill, next);
    setDraftState(getSkillDraft(session, skill));
    onChanged();
  };

  const patch = (value: Partial<SkillDraft>) => save({ ...draft, ...value });

  const patchLevel = (value: Partial<SkillLevelRecord>) => {
    const levels = draft.levels.map((candidate, index) =>
      index === selectedLevel ? { ...candidate, ...value } : candidate
    );
    save({ ...draft, levels });
  };

  const reset = () => {
    setDraftState(resetSkillDraft(session, skill));
    setSelectedLevel(0);
    onChanged();
  };

  const resetLevel = () => {
    if (!originalLevel) return;
    const levels = draft.levels.map((candidate, index) =>
      index === selectedLevel ? { ...originalLevel } : candidate
    );
    save({ ...draft, levels });
  };

  const copyPrevious = () => {
    if (selectedLevel <= 0) return;
    const previous = draft.levels[selectedLevel - 1];
    const current = draft.levels[selectedLevel];
    const levels = draft.levels.map((candidate, index) =>
      index === selectedLevel
        ? {
            ...previous,
            id: current.id,
            point: current.point,
          }
        : candidate
    );
    save({ ...draft, levels });
  };

  const multiplyAll = (
    field: 'damage' | 'manaUse' | 'coolDown',
    multiplier: number
  ) => {
    const levels = draft.levels.map((candidate, index) => {
      const original = skill.levels[index] ?? candidate;
      return {
        ...candidate,
        [field]: Math.max(0, Math.round(original[field] * multiplier)),
      };
    });
    save({ ...draft, levels });
  };

  const first = draft.levels[0];
  const last = draft.levels[draft.levels.length - 1];

  return (
    <div className="h-full min-h-0 rounded-xl border border-zinc-200 bg-white shadow-sm overflow-hidden flex flex-col">
      <div className="shrink-0 px-3 py-2.5 border-b border-zinc-200 bg-gradient-to-r from-fuchsia-50 via-white to-indigo-50 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <SmallImagePreview session={session} imageId={draft.iconId} alt={draft.name} variant="medium" className="shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-zinc-900 truncate">{draft.name}</h2>
              {dirty && (
                <span className="px-2 py-0.5 rounded-full border border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 text-[9px] font-mono">nháp</span>
              )}
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">
              {getSkillPlanetName(skill.nclassId)} · template ID {skill.id} · row {skill.rowIndex} · SmallImage #{draft.iconId}
            </div>
            <div className="text-[10px] text-zinc-600 mt-1">{draft.damageInfo}</div>
          </div>
        </div>

        <button
          type="button"
          onClick={reset}
          disabled={!dirty}
          className="px-3 py-1.5 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed text-[10px] text-zinc-600 font-medium flex items-center gap-1 cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Hoàn tác skill
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <SummaryCard icon={<Swords className="w-4 h-4 text-orange-500" />} label="Damage" value={`${formatNumber(first?.damage ?? 0)} → ${formatNumber(last?.damage ?? 0)}`} />
          <SummaryCard icon={<Zap className="w-4 h-4 text-cyan-500" />} label="KI dùng" value={`${formatNumber(first?.manaUse ?? 0)} → ${formatNumber(last?.manaUse ?? 0)}`} />
          <SummaryCard icon={<Clock3 className="w-4 h-4 text-violet-500" />} label="Cooldown" value={`${formatCooldown(first?.coolDown ?? 0)} → ${formatCooldown(last?.coolDown ?? 0)}`} />
          <SummaryCard icon={<Dumbbell className="w-4 h-4 text-emerald-500" />} label="Yêu cầu sức mạnh" value={`${formatNumber(first?.powerRequire ?? 0)} → ${formatNumber(last?.powerRequire ?? 0)}`} />
        </div>

        <Section title="Thông tin skill template" icon={<Sparkles className="w-4 h-4 text-fuchsia-500" />}>
          <div className="grid grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7 gap-2.5">
            <TextEditor label="Tên kỹ năng" technical="NAME" value={draft.name} onChange={(name) => patch({ name })} />
            <NumberEditor label="Max point" technical="max_point" value={draft.maxPoint} min={1} onChange={(maxPoint) => patch({ maxPoint })} />
            <NumberEditor label="Kiểu dùng KI" technical="mana_use_type" value={draft.manaUseType} min={0} onChange={(manaUseType) => patch({ manaUseType })} />
            <NumberEditor label="Type" technical="TYPE" value={draft.type} min={0} onChange={(type) => patch({ type })} />
            <NumberEditor label="Icon ID" technical="icon_id" value={draft.iconId} min={0} onChange={(iconId) => patch({ iconId })} />
            <NumberEditor label="Slot" technical="slot" value={draft.slot} min={0} onChange={(slot) => patch({ slot })} />
            <ReadOnlyField label="Template ID" technical="id" value={String(skill.id)} />
          </div>
          <div className="mt-2.5">
            <TextEditor label="Mô tả hiệu ứng" technical="dam_info" value={draft.damageInfo} onChange={(damageInfo) => patch({ damageInfo })} />
          </div>
        </Section>

        <Section title="Chỉnh nhanh toàn bộ cấp" icon={<Gauge className="w-4 h-4 text-indigo-500" />}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <QuickGroup label="Damage" buttons={[
              ['Gốc', 1], ['x0.5', 0.5], ['x2', 2], ['x5', 5], ['x10', 10],
            ]} onClick={(value) => multiplyAll('damage', value)} />
            <QuickGroup label="KI sử dụng" buttons={[
              ['Gốc', 1], ['x0.5', 0.5], ['x2', 2], ['x5', 5], ['x10', 10],
            ]} onClick={(value) => multiplyAll('manaUse', value)} />
            <QuickGroup label="Cooldown" buttons={[
              ['Gốc', 1], ['Nhanh x2', 0.5], ['Nhanh x5', 0.2], ['Chậm x2', 2],
            ]} onClick={(value) => multiplyAll('coolDown', value)} />
          </div>
        </Section>

        <Section title="Cấp kỹ năng" icon={<Target className="w-4 h-4 text-rose-500" />}>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-2">
            {draft.levels.map((candidate, index) => {
              const changed = JSON.stringify(candidate) !== JSON.stringify(skill.levels[index]);
              return (
                <button
                  key={`${candidate.id}-${index}`}
                  type="button"
                  onClick={() => setSelectedLevel(index)}
                  className={`min-w-[62px] px-2 py-1.5 rounded-lg border text-[10px] font-mono cursor-pointer ${
                    selectedLevel === index
                      ? 'bg-rose-50 border-rose-300 text-rose-700'
                      : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'
                  }`}
                >
                  <div className="font-bold">Cấp {candidate.point}</div>
                  <div className="text-[8px] mt-0.5">ID {candidate.id}{changed ? ' •' : ''}</div>
                </button>
              );
            })}
          </div>

          {level && (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 overflow-hidden">
              <div className="px-3 py-2 border-b border-zinc-200 bg-white flex items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] font-bold text-zinc-900">Cấp {level.point} · level ID {level.id}</div>
                  <div className="text-[9px] text-zinc-500 font-mono">Identity ID/point được khóa để tránh phá tham chiếu runtime.</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={copyPrevious} disabled={selectedLevel === 0} className="px-2 py-1 rounded-lg border border-zinc-200 bg-white disabled:opacity-40 text-[9px] cursor-pointer">Lấy thông số cấp trước</button>
                  <button type="button" onClick={resetLevel} className="px-2 py-1 rounded-lg border border-zinc-200 bg-white text-[9px] cursor-pointer">Khôi phục cấp</button>
                </div>
              </div>

              <div className="p-3 grid grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8 gap-2.5">
                <NumberEditor label="Sức mạnh yêu cầu" technical="power_require" value={level.powerRequire} min={0} onChange={(powerRequire) => patchLevel({ powerRequire })} />
                <NumberEditor label="Damage" technical="damage" value={level.damage} onChange={(damage) => patchLevel({ damage })} />
                <NumberEditor label="Tầm X" technical="dx" value={level.dx} onChange={(dx) => patchLevel({ dx })} />
                <NumberEditor label="Tầm Y" technical="dy" value={level.dy} onChange={(dy) => patchLevel({ dy })} />
                <NumberEditor label="Giá nâng" technical="price" value={level.price} min={0} onChange={(price) => patchLevel({ price })} />
                <NumberEditor label="Max target" technical="max_fight" value={level.maxFight} min={0} onChange={(maxFight) => patchLevel({ maxFight })} />
                <NumberEditor label="KI sử dụng" technical="mana_use" value={level.manaUse} min={0} onChange={(manaUse) => patchLevel({ manaUse })} />
                <NumberEditor label="Cooldown (ms)" technical="cool_down" value={level.coolDown} min={0} onChange={(coolDown) => patchLevel({ coolDown })} />
              </div>
              <div className="px-3 pb-3">
                <TextEditor label="Thông tin / nơi học" technical="info" value={level.info} onChange={(info) => patchLevel({ info })} />
              </div>
            </div>
          )}
        </Section>

        <Section title="So sánh toàn bộ cấp" icon={<Crosshair className="w-4 h-4 text-blue-500" />}>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
            <table className="w-full min-w-[900px] text-[10px]">
              <thead className="bg-zinc-50 text-zinc-500 font-mono">
                <tr>
                  <Th>Cấp</Th><Th>ID</Th><Th>Power yêu cầu</Th><Th>Damage</Th><Th>KI</Th><Th>Cooldown</Th><Th>Tầm X/Y</Th><Th>Giá</Th><Th>Target</Th>
                </tr>
              </thead>
              <tbody>
                {draft.levels.map((candidate, index) => {
                  const changed = JSON.stringify(candidate) !== JSON.stringify(skill.levels[index]);
                  return (
                    <tr
                      key={candidate.id}
                      onClick={() => setSelectedLevel(index)}
                      className={`border-t border-zinc-100 cursor-pointer hover:bg-zinc-50 ${selectedLevel === index ? 'bg-rose-50/60' : ''}`}
                    >
                      <Td><span className={changed ? 'text-fuchsia-600 font-bold' : ''}>{candidate.point}</span></Td>
                      <Td>{candidate.id}</Td>
                      <Td>{formatNumber(candidate.powerRequire)}</Td>
                      <Td>{formatNumber(candidate.damage)}</Td>
                      <Td>{formatNumber(candidate.manaUse)}</Td>
                      <Td>{formatCooldown(candidate.coolDown)}</Td>
                      <Td>{candidate.dx} / {candidate.dy}</Td>
                      <Td>{formatNumber(candidate.price)}</Td>
                      <Td>{candidate.maxFight}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>

        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[10px] text-emerald-800 leading-relaxed">
          <CheckCircle2 className="w-3.5 h-3.5 inline mr-1.5 align-[-2px]" />
          Các thay đổi ở panel này được serialize lại đúng cột <code>skills</code> của <code>a/a/a/W.u</code> và có thể đi qua static-table writer của <strong>Test nháp</strong>.
        </div>
      </div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 overflow-hidden">
      <div className="h-9 px-3 border-b border-zinc-200 bg-white flex items-center gap-2">
        {icon}<span className="text-[11px] font-bold text-zinc-900">{title}</span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-2.5">
      <div className="flex items-center gap-1.5 text-[9px] uppercase text-zinc-500 font-mono">{icon}{label}</div>
      <div className="mt-1.5 text-sm font-bold text-zinc-900 truncate" title={value}>{value}</div>
    </div>
  );
}

function TextEditor({ label, technical, value, onChange }: { label: string; technical: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block space-y-1">
      <span className="flex items-center justify-between gap-1 text-[8px] uppercase text-zinc-500 font-mono"><span>{label}</span><span className="text-zinc-400">{technical}</span></span>
      <input value={value} onChange={(event) => onChange(event.target.value)} className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-200 bg-white text-[10px] text-zinc-900 focus:outline-none focus:border-fuchsia-300 focus:ring-2 focus:ring-fuchsia-100" />
    </label>
  );
}

function NumberEditor({ label, technical, value, onChange, min, max }: { label: string; technical: string; value: number; onChange: (value: number) => void; min?: number; max?: number }) {
  return (
    <label className="block space-y-1">
      <span className="flex items-center justify-between gap-1 text-[8px] uppercase text-zinc-500 font-mono"><span>{label}</span><span className="text-zinc-400">{technical}</span></span>
      <input type="number" value={value} min={min} max={max} onChange={(event) => onChange(Number(event.target.value))} className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-200 bg-white text-[10px] text-zinc-900 font-mono focus:outline-none focus:border-fuchsia-300 focus:ring-2 focus:ring-fuchsia-100" />
    </label>
  );
}

function ReadOnlyField({ label, technical, value }: { label: string; technical: string; value: string }) {
  return (
    <div className="space-y-1">
      <span className="flex items-center justify-between gap-1 text-[8px] uppercase text-zinc-500 font-mono"><span>{label}</span><span className="text-zinc-400">{technical}</span></span>
      <div className="px-2.5 py-1.5 rounded-lg border border-zinc-200 bg-zinc-100 text-[10px] text-zinc-600 font-mono">{value}</div>
    </div>
  );
}

function QuickGroup({ label, buttons, onClick }: { label: string; buttons: Array<[string, number]>; onClick: (value: number) => void }) {
  return (
    <div>
      <div className="text-[9px] text-zinc-500 font-mono mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1">
        {buttons.map(([name, value]) => (
          <button key={`${name}-${value}`} type="button" onClick={() => onClick(value)} className="px-2 py-1 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 text-[9px] text-zinc-600 cursor-pointer">{name}</button>
        ))}
      </div>
    </div>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`px-2 py-1 rounded-lg border text-[9px] whitespace-nowrap cursor-pointer ${active ? 'bg-fuchsia-50 border-fuchsia-200 text-fuchsia-700' : 'bg-white border-zinc-200 text-zinc-500 hover:bg-zinc-50'}`}>{children}</button>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="hidden lg:inline px-1.5 py-0.5 rounded-full bg-zinc-100 border border-zinc-200 text-[9px] text-zinc-500 font-mono whitespace-nowrap">{children}</span>;
}

function Th({ children }: { children: React.ReactNode }) { return <th className="px-2 py-2 text-left font-medium whitespace-nowrap">{children}</th>; }
function Td({ children }: { children: React.ReactNode }) { return <td className="px-2 py-2 text-zinc-700 font-mono whitespace-nowrap">{children}</td>; }
