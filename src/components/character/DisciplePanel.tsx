import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Backpack,
  CheckCircle2,
  Database,
  Gauge,
  HeartPulse,
  RefreshCw,
  RotateCcw,
  Shield,
  Sparkles,
  Search,
  Plus,
  Trash2,
  Swords,
  UserRound,
  Zap,
} from 'lucide-react';
import { LoadedJarSession } from '../../types/jar';
import {
  analyzeDiscipleSchema,
  DiscipleDraft,
  DiscipleFieldGroup,
  DiscipleSchemaSnapshot,
  getDirtyDiscipleCount,
  getDiscipleDraft,
  resetDiscipleDraft,
  setDiscipleDraft,
} from '../../services/discipleDataService';
import { analyzeSkills, SkillRecord } from '../../services/skillDataService';

interface DisciplePanelProps {
  session: LoadedJarSession;
  onDraftsUpdated?: (dirtyCount: number) => void;
}

type DiscipleView = 'logic' | 'stats' | 'skills' | 'schema';

const GROUP_LABELS: Record<DiscipleFieldGroup, string> = {
  identity: 'Danh tính & trạng thái',
  progress: 'Sức mạnh & tiến trình',
  combat: 'Chỉ số chiến đấu',
  runtime: 'Chỉ số hiện tại',
  skills: 'Kỹ năng',
  inventory: 'Trang bị & hành trang',
};

export function DisciplePanel({ session, onDraftsUpdated }: DisciplePanelProps) {
  const [snapshot, setSnapshot] = useState<DiscipleSchemaSnapshot | null>(null);
  const [draft, setDraftState] = useState<DiscipleDraft | null>(null);
  const [view, setView] = useState<DiscipleView>('logic');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [skillCatalog, setSkillCatalog] = useState<SkillRecord[]>([]);
  const [skillCatalogError, setSkillCatalogError] = useState<string | null>(null);
  const [skillQuery, setSkillQuery] = useState('');
  const [skillPlanet, setSkillPlanet] = useState<'all' | 0 | 1 | 2>('all');
  const [activeSkillSlot, setActiveSkillSlot] = useState(0);
  const [visibleSkillSlots, setVisibleSkillSlots] = useState(1);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const result = await analyzeDiscipleSchema(session);
        if (!active) return;
        const nextDraft = getDiscipleDraft(session, result);
        setSnapshot(result);
        setDraftState(nextDraft);
        const lastUsed = nextDraft.skills.reduce((last, skill, index) => skill.id >= 0 ? index : last, -1);
        setVisibleSkillSlots(Math.max(1, lastUsed + 1));
        setActiveSkillSlot(Math.max(0, Math.min(lastUsed < 0 ? 0 : lastUsed, result.skillSlots - 1)));
        onDraftsUpdated?.(getDirtyDiscipleCount(session));

        try {
          const skillSnapshot = await analyzeSkills(session);
          if (!active) return;
          setSkillCatalog(skillSnapshot.skills.slice().sort((a, b) => a.id - b.id));
          setSkillCatalogError(null);
        } catch (skillErr: unknown) {
          if (!active) return;
          setSkillCatalog([]);
          setSkillCatalogError(skillErr instanceof Error ? skillErr.message : String(skillErr));
        }
      } catch (err: unknown) {
        if (active) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [session, onDraftsUpdated]);

  const grouped = useMemo(() => {
    const result = new Map<DiscipleFieldGroup, DiscipleSchemaSnapshot['fields']>();
    if (!snapshot) return result;
    for (const field of snapshot.fields) {
      const list = result.get(field.group) ?? [];
      list.push(field);
      result.set(field.group, list);
    }
    return result;
  }, [snapshot]);

  const skillById = useMemo(() => {
    const map = new Map<number, SkillRecord>();
    for (const skill of skillCatalog) map.set(skill.id, skill);
    return map;
  }, [skillCatalog]);

  const filteredSkillCatalog = useMemo(() => {
    const query = skillQuery.trim().toLowerCase();
    return skillCatalog.filter((skill) => {
      if (skillPlanet !== 'all' && skill.nclassId !== skillPlanet) return false;
      if (!query) return true;
      return (
        skill.name.toLowerCase().includes(query) ||
        String(skill.id).includes(query) ||
        skill.damageInfo.toLowerCase().includes(query)
      );
    });
  }, [skillCatalog, skillPlanet, skillQuery]);

  if (loading) {
    return (
      <div className="min-h-[260px] xl:h-full flex items-center justify-center rounded-2xl border border-zinc-200 bg-white">
        <div className="text-center space-y-2 text-zinc-500 text-xs font-mono">
          <RefreshCw className="w-5 h-5 animate-spin mx-auto text-cyan-500" />
          <div>Đang đọc logic RNG + schema Đệ tử...</div>
        </div>
      </div>
    );
  }

  if (error || !snapshot || !draft) {
    return (
      <div className="min-h-[260px] xl:h-full flex items-center justify-center rounded-2xl border border-red-200 bg-red-50 p-4 text-xs text-red-700">
        <AlertTriangle className="w-4 h-4 mr-2" />
        {error || 'Không đọc được schema Đệ tử.'}
      </div>
    );
  }

  const dirty = getDirtyDiscipleCount(session) > 0;
  const baseline = snapshot.fixedDefaults;

  const save = (next: DiscipleDraft) => {
    const normalized = setDiscipleDraft(session, next);
    setDraftState(normalized);
    onDraftsUpdated?.(getDirtyDiscipleCount(session));
  };

  const patch = (value: Partial<DiscipleDraft>) => save({ ...draft, ...value });

  const patchSkill = (index: number, value: Partial<DiscipleDraft['skills'][number]>) => {
    const skills = draft.skills.map((skill, skillIndex) =>
      skillIndex === index ? { ...skill, ...value } : skill
    );
    patch({ skills });
  };

  const assignSkillToSlot = (slotIndex: number, skillId: number) => {
    const nextLevel = skillId < 0 ? 0 : Math.max(1, draft.skills[slotIndex]?.level || 1);
    patchSkill(slotIndex, { id: skillId, level: nextLevel });
    setActiveSkillSlot(slotIndex);
    setVisibleSkillSlots((current) => Math.max(current, slotIndex + 1));
  };

  const addSkillSlot = () => {
    if (visibleSkillSlots >= snapshot.skillSlots) return;
    const nextSlot = visibleSkillSlots;
    setVisibleSkillSlots(nextSlot + 1);
    setActiveSkillSlot(nextSlot);
  };

  const removeSkillSlot = (slotIndex: number) => {
    const skills = draft.skills.map((skill, index) =>
      index === slotIndex ? { id: -1, level: 0 } : skill
    );
    patch({ skills });
    if (slotIndex === visibleSkillSlots - 1 && visibleSkillSlots > 1) {
      let nextVisible = visibleSkillSlots - 1;
      while (nextVisible > 1 && skills[nextVisible - 1]?.id < 0) nextVisible--;
      setVisibleSkillSlots(nextVisible);
      setActiveSkillSlot(Math.min(activeSkillSlot, nextVisible - 1));
    }
  };

  const reset = () => {
    setDraftState(resetDiscipleDraft(session, snapshot));
    onDraftsUpdated?.(0);
  };

  const syncCurrent = () => patch({ hp: draft.baseHp, ki: draft.baseKi });
  const fullStamina = () => patch({ stamina: draft.maxStamina });
  const clearSkills = () => {
    patch({
      skills: Array.from({ length: snapshot.skillSlots }, () => ({ id: -1, level: 0 })),
    });
    setVisibleSkillSlots(1);
    setActiveSkillSlot(0);
  };

  return (
    <div className="nro-disciple-panel w-full min-w-0 flex flex-col gap-2 sm:gap-3 xl:h-full xl:min-h-0">
      <div className="shrink-0 rounded-2xl border border-zinc-200 bg-white shadow-sm p-3 sm:p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 min-w-0">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-gradient-to-br from-cyan-100 to-indigo-100 border border-cyan-200 flex items-center justify-center shrink-0">
            <UserRound className="w-5 h-5 text-cyan-600" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-base font-bold text-zinc-900">Đệ tử</div>
              <span
                className={`px-2 py-0.5 rounded-full border text-[9px] font-mono ${
                  draft.overrideCreation
                    ? 'bg-rose-50 border-rose-200 text-rose-700'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                }`}
              >
                {draft.overrideCreation ? 'FIXED OVERRIDE' : 'RANDOM GỐC'}
              </span>
              {dirty && (
                <span className="px-2 py-0.5 rounded-full bg-violet-50 border border-violet-200 text-violet-700 text-[9px] font-mono">
                  1 nháp
                </span>
              )}
            </div>
            <div className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">
              JAR tạo Đệ tử ở <code>a/a/l.a(H,BB)</code> bằng RNG. Panel mặc định giữ nguyên random;
              chỉ khi bật override mới ghi bộ chỉ số cố định sau logic tạo gốc.
            </div>
            <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5 sm:flex-wrap scrollbar-none touch-auto">
              <Chip text="RNG verified" />
              <Chip text={`${snapshot.skillSlots} skill`} />
              <Chip text={`${snapshot.equipmentSlots} trang bị`} />
              <Chip text="save a/a/N giữ nguyên" />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
          <div
            className={`flex items-center gap-1.5 text-[10px] font-mono ${snapshot.verified ? 'text-emerald-600' : 'text-amber-600'}`}
            title={snapshot.verificationDetail}
          >
            {snapshot.verified ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            {snapshot.verified ? 'Verified' : 'Cần kiểm tra'}
          </div>
          <button
            type="button"
            onClick={reset}
            disabled={!dirty}
            className="h-9 px-3 rounded-xl bg-zinc-100 hover:bg-zinc-200 border border-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] text-zinc-700 font-medium flex items-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Hoàn tác
          </button>
        </div>
      </div>

      <div
        className={`shrink-0 rounded-2xl border p-3 sm:p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
          draft.overrideCreation
            ? 'border-rose-200 bg-rose-50'
            : 'border-emerald-200 bg-emerald-50'
        }`}
      >
        <div className="min-w-0">
          <div className={`text-xs font-bold ${draft.overrideCreation ? 'text-rose-800' : 'text-emerald-800'}`}>
            {draft.overrideCreation ? 'Đang ghi đè chỉ số tạo Đệ tử' : 'Đang giữ nguyên logic random của game'}
          </div>
          <div className={`text-[10px] mt-1 leading-relaxed ${draft.overrideCreation ? 'text-rose-700' : 'text-emerald-700'}`}>
            {draft.overrideCreation
              ? 'RNG gốc vẫn chạy trước, sau đó helper áp các giá trị bên dưới. Type / hành tinh / trạng thái AI không bị ép.'
              : 'HP, KI, damage, giáp, chí mạng và skill đầu vẫn được game random theo đúng bytecode gốc.'}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={draft.overrideCreation}
          onClick={() => patch({ overrideCreation: !draft.overrideCreation })}
          className={`shrink-0 min-h-10 px-4 rounded-xl border text-xs font-bold cursor-pointer transition-colors ${
            draft.overrideCreation
              ? 'bg-white border-rose-300 text-rose-700 hover:bg-rose-100'
              : 'bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-500'
          }`}
        >
          {draft.overrideCreation ? 'Tắt override · dùng random' : 'Bật chỉ số cố định'}
        </button>
      </div>

      <div className="shrink-0 flex items-center gap-1 p-1 rounded-xl bg-white border border-zinc-200 shadow-sm w-full sm:w-fit overflow-x-auto scrollbar-none touch-auto">
        <SectionButton active={view === 'logic'} onClick={() => setView('logic')} icon={<Gauge className="w-3.5 h-3.5" />} label="Logic thật" />
        <SectionButton active={view === 'stats'} onClick={() => setView('stats')} icon={<HeartPulse className="w-3.5 h-3.5" />} label="Chỉ số" />
        <SectionButton active={view === 'skills'} onClick={() => setView('skills')} icon={<Sparkles className="w-3.5 h-3.5" />} label="Kỹ năng" />
        <SectionButton active={view === 'schema'} onClick={() => setView('schema')} icon={<Database className="w-3.5 h-3.5" />} label="Schema" />
      </div>

      <div className="min-w-0 pb-2 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:pr-1">
        {view === 'logic' ? (
          <LogicView snapshot={snapshot} />
        ) : view === 'stats' ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
              <SummaryCard icon={<HeartPulse className="w-4 h-4 text-rose-500" />} label="HP gốc" value={draft.baseHp} original={baseline.baseHp} field="yq" />
              <SummaryCard icon={<Zap className="w-4 h-4 text-cyan-500" />} label="KI gốc" value={draft.baseKi} original={baseline.baseKi} field="yr" />
              <SummaryCard icon={<Swords className="w-4 h-4 text-orange-500" />} label="Sức đánh" value={draft.baseDamage} original={baseline.baseDamage} field="ys" />
              <SummaryCard icon={<Sparkles className="w-4 h-4 text-violet-500" />} label="Sức mạnh" value={draft.power} original={baseline.power} field="cj" />
            </div>

            <EditorSection
              title="Danh tính logic — giữ nguyên game"
              subtitle="Writer không ép aZ / ba / bb vì đây là tham số tạo và trạng thái AI runtime."
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <ReadOnlyLogic label="Loại Đệ tử" technical="aZ" value="Theo tham số type của flow tạo" />
                <ReadOnlyLogic label="Hành tinh" technical="ba" value="Random 0..2 / theo flow gọi" />
                <ReadOnlyLogic label="Trạng thái AI" technical="bb" value="Do AI runtime quản lý" />
              </div>
            </EditorSection>

            {!draft.overrideCreation && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800 leading-relaxed">
                <AlertTriangle className="w-4 h-4 inline mr-1.5 align-[-2px]" />
                Các ô dưới đang khóa vì <strong>Random gốc</strong> đang bật. Bấm “Bật chỉ số cố định” ở phía trên nếu muốn writer ghi đè kết quả tạo Đệ tử.
              </div>
            )}

            <fieldset disabled={!draft.overrideCreation} className="space-y-3 disabled:opacity-60">
              <EditorSection title="Sức mạnh & tiến trình">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <NumberEditor label="Sức mạnh" technical="cj" value={draft.power} min={0} max={1_000_000_000_000} onChange={(power) => patch({ power })} />
                  <NumberEditor label="Tiềm năng" technical="ck" value={draft.potential} min={0} max={1_000_000_000_000} onChange={(potential) => patch({ potential })} />
                </div>
              </EditorSection>

              <EditorSection title="Chỉ số chiến đấu">
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
                  <NumberEditor label="HP gốc" technical="yq" value={draft.baseHp} min={1} onChange={(baseHp) => patch({ baseHp })} />
                  <NumberEditor label="KI gốc" technical="yr" value={draft.baseKi} min={1} onChange={(baseKi) => patch({ baseKi })} />
                  <NumberEditor label="Sức đánh" technical="ys" value={draft.baseDamage} min={1} onChange={(baseDamage) => patch({ baseDamage })} />
                  <NumberEditor label="Giáp" technical="yt" value={draft.armor} min={0} onChange={(armor) => patch({ armor })} />
                  <NumberEditor label="Chí mạng %" technical="yu" value={draft.critical} min={0} max={100} onChange={(critical) => patch({ critical })} />
                </div>
              </EditorSection>

              <EditorSection title="HP / KI / thể lực hiện tại">
                <div className="flex gap-2 overflow-x-auto mb-3 pb-0.5 scrollbar-none touch-auto">
                  <QuickButton label="HP/KI hiện tại = gốc" onClick={syncCurrent} />
                  <QuickButton label="Hồi đầy thể lực" onClick={fullStamina} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                  <NumberEditor label="HP hiện tại" technical="yv" value={draft.hp} min={0} onChange={(hp) => patch({ hp })} />
                  <NumberEditor label="KI hiện tại" technical="yw" value={draft.ki} min={0} onChange={(ki) => patch({ ki })} />
                  <NumberEditor label="Thể lực" technical="yx" value={draft.stamina} min={0} onChange={(stamina) => patch({ stamina })} />
                  <NumberEditor label="Thể lực tối đa" technical="yy" value={draft.maxStamina} min={1} onChange={(maxStamina) => patch({ maxStamina })} />
                </div>
              </EditorSection>
            </fieldset>

            <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-3 text-[11px] text-cyan-800 leading-relaxed">
              <CheckCircle2 className="w-4 h-4 inline mr-1.5 align-[-2px]" />
              Writer mới target <code>a/a/l.a(H,BB)</code> <strong>sau toàn bộ RNG tạo Đệ tử</strong>.
              Không còn hook <code>H.gf()</code> vì method tạo thật ghi đè các field ngay sau lời gọi <code>gf()</code>.
            </div>
          </div>
        ) : view === 'skills' ? (
          <div className="space-y-3">
            {!draft.overrideCreation && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-[11px] text-emerald-800 leading-relaxed">
                Random skill gốc đang được giữ. Bật “chỉ số cố định” để gán skill custom vào Đệ tử.
              </div>
            )}

            <fieldset disabled={!draft.overrideCreation} className="disabled:opacity-60 space-y-3">
              <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
                <div className="px-3 sm:px-4 py-3 border-b border-zinc-200 flex flex-col gap-3">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold text-zinc-900">Ô kỹ năng Đệ tử</div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">cV = ID kỹ năng · cW = cấp kỹ năng · tối đa {snapshot.skillSlots} slot thật</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={addSkillSlot}
                        disabled={visibleSkillSlots >= snapshot.skillSlots}
                        className="h-9 px-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 border border-cyan-600 text-white disabled:opacity-40 disabled:cursor-not-allowed text-[11px] font-bold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Thêm ô ({visibleSkillSlots}/{snapshot.skillSlots})
                      </button>
                      <button type="button" onClick={clearSkills} className="h-9 px-3 rounded-xl border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 text-[11px] text-zinc-700 cursor-pointer disabled:cursor-not-allowed">
                        Xóa tất cả
                      </button>
                    </div>
                  </div>
                  {visibleSkillSlots >= snapshot.skillSlots && (
                    <div className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
                      Đã dùng đủ {snapshot.skillSlots} slot thật của cV/cW. Panel không tạo slot giả vượt giới hạn runtime.
                    </div>
                  )}
                </div>

                <div className="p-3 sm:p-4 grid grid-cols-1 xl:grid-cols-2 gap-2 sm:gap-3">
                  {draft.skills.slice(0, visibleSkillSlots).map((skill, index) => {
                    const meta = skillById.get(skill.id);
                    const duplicateSlots = draft.skills
                      .map((candidate, candidateIndex) => candidate.id === skill.id && skill.id >= 0 && candidateIndex !== index ? candidateIndex + 1 : null)
                      .filter((value): value is number => value !== null);
                    return (
                      <div
                        key={index}
                        onClick={() => setActiveSkillSlot(index)}
                        className={`rounded-2xl border p-3 min-w-0 cursor-pointer transition-colors ${
                          activeSkillSlot === index
                            ? 'border-cyan-300 bg-cyan-50 ring-1 ring-cyan-200'
                            : 'border-zinc-200 bg-zinc-50 hover:bg-zinc-100'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <strong className="text-xs text-zinc-900">Slot {index + 1}</strong>
                              {activeSkillSlot === index && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-cyan-100 text-cyan-700 border border-cyan-200">đang chọn</span>}
                            </div>
                            <div className="text-[9px] text-zinc-500 font-mono mt-0.5">cV[{index}] / cW[{index}]</div>
                          </div>
                          <button
                            type="button"
                            onClick={(event) => { event.stopPropagation(); removeSkillSlot(index); }}
                            className="w-8 h-8 rounded-lg border border-red-200 bg-white hover:bg-red-50 text-red-600 flex items-center justify-center cursor-pointer"
                            title="Xóa skill khỏi slot"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <label className="block space-y-1.5">
                          <span className="text-[9px] uppercase text-zinc-500 font-mono">Kỹ năng</span>
                          <select
                            value={skill.id}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => assignSkillToSlot(index, Number(event.target.value))}
                            className="w-full min-h-11 bg-white border border-zinc-300 rounded-xl px-3 py-2 text-[14px] sm:text-[13px] text-zinc-900 focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                          >
                            <option value={-1}>— Chưa gán skill —</option>
                            {skillCatalog.map((catalogSkill) => (
                              <option key={`${catalogSkill.rowIndex}-${catalogSkill.id}`} value={catalogSkill.id}>
                                #{catalogSkill.id} · {catalogSkill.name} · {planetLabel(catalogSkill.nclassId)}
                              </option>
                            ))}
                          </select>
                        </label>

                        <div className="mt-2 grid grid-cols-1 min-[420px]:grid-cols-[minmax(0,1fr)_120px] gap-2">
                          <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 min-w-0">
                            <div className="text-[9px] text-zinc-500 font-mono">Đang gán</div>
                            <div className="text-[12px] font-bold text-zinc-900 truncate mt-0.5">{meta?.name ?? (skill.id >= 0 ? `Skill #${skill.id}` : 'Trống')}</div>
                            {meta && <div className="text-[9px] text-zinc-500 mt-0.5 truncate">ID {meta.id} · {planetLabel(meta.nclassId)} · max {meta.maxPoint}</div>}
                          </div>
                          <NumberEditor compact label="Cấp" technical="LV" value={skill.level} min={0} max={10_000} onChange={(level) => patchSkill(index, { level })} />
                        </div>

                        {duplicateSlots.length > 0 && (
                          <div className="mt-2 text-[9px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                            Skill này đang trùng với slot {duplicateSlots.join(', ')}.
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
                <div className="p-3 sm:p-4 border-b border-zinc-200 bg-zinc-50 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold text-zinc-900">Danh sách skill thật</div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">Đọc trực tiếp từ a/a/a/W.u · bấm Gán để đưa vào Slot {activeSkillSlot + 1}</div>
                    </div>
                    <div className="relative w-full sm:w-72">
                      <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="search"
                        value={skillQuery}
                        onChange={(event) => setSkillQuery(event.target.value)}
                        placeholder="Tìm tên hoặc ID skill..."
                        className="w-full min-h-11 pl-9 pr-3 rounded-xl border border-zinc-300 bg-white text-[16px] sm:text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                      />
                    </div>
                  </div>
                  <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
                    <SkillFilterButton active={skillPlanet === 'all'} onClick={() => setSkillPlanet('all')} label={`Tất cả (${skillCatalog.length})`} />
                    <SkillFilterButton active={skillPlanet === 0} onClick={() => setSkillPlanet(0)} label={`Trái Đất (${skillCatalog.filter((skill) => skill.nclassId === 0).length})`} />
                    <SkillFilterButton active={skillPlanet === 1} onClick={() => setSkillPlanet(1)} label={`Namek (${skillCatalog.filter((skill) => skill.nclassId === 1).length})`} />
                    <SkillFilterButton active={skillPlanet === 2} onClick={() => setSkillPlanet(2)} label={`Xayda (${skillCatalog.filter((skill) => skill.nclassId === 2).length})`} />
                  </div>
                </div>

                {skillCatalogError ? (
                  <div className="m-3 sm:m-4 rounded-xl border border-red-200 bg-red-50 p-3 text-[10px] text-red-700">
                    Không đọc được bảng skill: {skillCatalogError}
                  </div>
                ) : filteredSkillCatalog.length === 0 ? (
                  <div className="p-6 text-center text-[11px] text-zinc-500">Không có skill phù hợp.</div>
                ) : (
                  <div className="p-3 sm:p-4 grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-2">
                    {filteredSkillCatalog.map((catalogSkill) => {
                      const usedAt = draft.skills
                        .map((skill, index) => skill.id === catalogSkill.id ? index + 1 : null)
                        .filter((value): value is number => value !== null);
                      return (
                        <div key={`${catalogSkill.rowIndex}-${catalogSkill.id}`} className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-[12px] font-bold text-zinc-900 truncate" title={catalogSkill.name}>{catalogSkill.name}</div>
                              <div className="text-[9px] text-zinc-500 font-mono mt-0.5">ID {catalogSkill.id} · {planetLabel(catalogSkill.nclassId)}</div>
                            </div>
                            <span className="shrink-0 px-1.5 py-0.5 rounded bg-white border border-zinc-200 text-[9px] text-zinc-600 font-mono">max {catalogSkill.maxPoint}</span>
                          </div>
                          <div className="text-[10px] text-zinc-500 mt-2 line-clamp-2 min-h-[28px]">{catalogSkill.damageInfo || `type ${catalogSkill.type} · slot ${catalogSkill.slot}`}</div>
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <div className="text-[9px] text-zinc-500 min-w-0 truncate">
                              {usedAt.length > 0 ? `Đang dùng: slot ${usedAt.join(', ')}` : `${catalogSkill.levels.length} cấp dữ liệu`}
                            </div>
                            <button
                              type="button"
                              onClick={() => assignSkillToSlot(activeSkillSlot, catalogSkill.id)}
                              className="shrink-0 h-8 px-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-[10px] font-bold cursor-pointer"
                            >
                              Gán → Slot {activeSkillSlot + 1}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </fieldset>
          </div>
        ) : (
          <SchemaView snapshot={snapshot} grouped={grouped} />
        )}
      </div>
    </div>
  );
}

function LogicView({ snapshot }: { snapshot: DiscipleSchemaSnapshot }) {
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-3 sm:p-4">
        <div className="text-sm font-bold text-indigo-900">RNG thật của JAR</div>
        <div className="text-[10px] text-indigo-700 mt-1 font-mono break-words leading-relaxed">
          {snapshot.creationClass}.{snapshot.rngMethod}: {snapshot.rngAlgorithm}
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
        <div className="px-3 sm:px-4 py-3 border-b border-zinc-200 bg-zinc-50">
          <div className="text-sm font-bold text-zinc-900">Công thức tạo Đệ tử</div>
          <div className="text-[10px] text-zinc-500 mt-0.5">Đọc trực tiếp từ {snapshot.creationClass}.{snapshot.creationMethod}</div>
        </div>
        <div className="p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {snapshot.creationRules.map((rule) => (
            <div key={rule.key} className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <strong className="text-[11px] text-zinc-900">{rule.label}</strong>
                <code className="text-[8px] text-zinc-400 shrink-0">{rule.source}</code>
              </div>
              <div className="text-[11px] font-mono text-indigo-700 mt-2 break-words">{rule.formula}</div>
              <div className="text-[10px] text-zinc-500 mt-1">Kết quả: {rule.range}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
        <div className="px-3 sm:px-4 py-3 border-b border-zinc-200 bg-zinc-50">
          <div className="text-sm font-bold text-zinc-900">Random mở kỹ năng theo sức mạnh</div>
          <div className="text-[10px] text-zinc-500 mt-0.5">Method h(H) gọi bộ chọn J(slot) khi slot còn trống.</div>
        </div>
        <div className="divide-y divide-zinc-100">
          {snapshot.skillUnlocks.map((rule) => (
            <div key={rule.slot} className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <div className="sm:w-44 shrink-0">
                <div className="text-xs font-bold text-zinc-900">Slot {rule.slot + 1}</div>
                <div className="text-[10px] text-zinc-500">Power ≥ {rule.power.toLocaleString('vi-VN')}</div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {rule.choices.map((choice) => (
                  <span key={choice.id} className="px-2 py-1 rounded-lg bg-violet-50 border border-violet-200 text-[10px] text-violet-700 font-mono">
                    ID {choice.id} · {choice.chance}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <NoteList title="TNSM / sức mạnh Đệ tử" notes={snapshot.rewardNotes} tone="amber" />
      <NoteList title="Cách game tính chỉ số thực chiến" notes={snapshot.statNotes} tone="cyan" />
    </div>
  );
}

function NoteList({ title, notes, tone }: { title: string; notes: string[]; tone: 'amber' | 'cyan' }) {
  const classes = tone === 'amber'
    ? 'border-amber-200 bg-amber-50 text-amber-900'
    : 'border-cyan-200 bg-cyan-50 text-cyan-900';
  return (
    <div className={`rounded-2xl border p-3 sm:p-4 ${classes}`}>
      <div className="text-sm font-bold">{title}</div>
      <div className="mt-2 space-y-2">
        {notes.map((note, index) => (
          <div key={`${index}-${note}`} className="text-[10px] sm:text-[11px] leading-relaxed flex gap-2">
            <span className="font-mono shrink-0">{index + 1}.</span>
            <span>{note}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SchemaView({
  snapshot,
  grouped,
}: {
  snapshot: DiscipleSchemaSnapshot;
  grouped: Map<DiscipleFieldGroup, DiscipleSchemaSnapshot['fields']>;
}) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-3">
      <div className="space-y-3 min-w-0">
        {(['identity', 'progress', 'combat', 'runtime', 'skills', 'inventory'] as DiscipleFieldGroup[]).map((group) => {
          const fields = grouped.get(group) ?? [];
          return (
            <div key={group} className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden min-w-0">
              <div className="h-10 px-3 sm:px-4 border-b border-zinc-200 bg-zinc-50 flex items-center justify-between">
                <strong className="text-xs text-zinc-900">{GROUP_LABELS[group]}</strong>
                <span className="text-[9px] text-zinc-500 font-mono">{fields.length} field</span>
              </div>
              <div className="divide-y divide-zinc-100">
                {fields.map((field) => (
                  <div key={field.field} className="px-3 sm:px-4 py-3 grid grid-cols-[46px_minmax(0,1fr)_70px] sm:grid-cols-[58px_minmax(0,1fr)_92px_auto] gap-2 items-center min-w-0">
                    <code className="text-[10px] text-indigo-600 font-bold">{field.field}</code>
                    <div className="min-w-0">
                      <div className="text-[11px] sm:text-[12px] text-zinc-800 break-words">{field.label}</div>
                      {field.note && <div className="text-[9px] text-zinc-500 mt-0.5 leading-relaxed break-words">{field.note}</div>}
                    </div>
                    <span className="text-[9px] sm:text-[10px] text-zinc-500 font-mono text-right break-all">{field.type}</span>
                    <span className={`hidden sm:inline-flex justify-self-end px-1.5 py-0.5 rounded-full border text-[9px] font-mono ${field.editable ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-zinc-50 border-zinc-200 text-zinc-500'}`}>
                      {field.editable ? 'fixed mode' : 'read-only'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <aside className="space-y-3 min-w-0">
        <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
          <div className="h-10 px-4 border-b border-zinc-200 bg-gradient-to-r from-cyan-50 to-white flex items-center gap-2">
            <Database className="w-4 h-4 text-cyan-600" />
            <strong className="text-xs text-zinc-900">Nguồn bytecode</strong>
          </div>
          <div className="p-3 space-y-2 text-[10px] font-mono">
            <SourceRow label="Player" value={snapshot.sourceClass} />
            <SourceRow label="Save codec" value={snapshot.codecClass} />
            <SourceRow label="Reset" value={`${snapshot.sourceClass}.${snapshot.resetMethod}`} />
            <SourceRow label="Create" value={`${snapshot.creationClass}.${snapshot.creationMethod}`} />
            <SourceRow label="RNG" value={`${snapshot.creationClass}.${snapshot.rngMethod}`} />
            <SourceRow label="Helper" value={snapshot.helperClass} />
            <SourceRow label="Presence" value={snapshot.presenceField} />
          </div>
        </div>

        <div className="grid grid-cols-2 xl:grid-cols-1 gap-2">
          <Capacity icon={<Shield className="w-4 h-4 text-blue-500" />} label="Trang bị" value={snapshot.equipmentSlots} field="b" />
          <Capacity icon={<Backpack className="w-4 h-4 text-emerald-500" />} label="Hành trang" value={snapshot.bagSlots} field="c" />
        </div>
      </aside>
    </div>
  );
}

function planetLabel(planet: number): string {
  return planet === 1 ? 'Namek' : planet === 2 ? 'Xayda' : 'Trái Đất';
}

function SkillFilterButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 h-8 px-2.5 rounded-lg border text-[10px] font-medium cursor-pointer whitespace-nowrap ${
        active
          ? 'bg-cyan-50 border-cyan-300 text-cyan-700'
          : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'
      }`}
    >
      {label}
    </button>
  );
}

function Chip({ text }: { text: string }) {
  return <span className="shrink-0 px-2 py-0.5 rounded-full bg-zinc-100 border border-zinc-200 text-[9px] text-zinc-600 font-mono whitespace-nowrap">{text}</span>;
}

function SummaryCard({ icon, label, value, original, field }: { icon: React.ReactNode; label: string; value: number; original: number; field: string }) {
  const changed = value !== original;
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm p-3 min-w-0">
      <div className="flex items-center justify-between">{icon}<code className="text-[9px] text-zinc-400">{field}</code></div>
      <div className={`text-lg sm:text-xl font-bold mt-2 truncate ${changed ? 'text-violet-600' : 'text-zinc-900'}`} title={String(value)}>{value.toLocaleString('vi-VN')}</div>
      <div className="text-[10px] text-zinc-500 truncate">{label}</div>
    </div>
  );
}

function EditorSection({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden min-w-0">
      <div className="px-3 sm:px-4 py-3 border-b border-zinc-200 bg-zinc-50">
        <div className="text-xs sm:text-sm font-bold text-zinc-900">{title}</div>
        {subtitle && <div className="text-[10px] text-zinc-500 mt-0.5 leading-relaxed">{subtitle}</div>}
      </div>
      <div className="p-3 sm:p-4 min-w-0">{children}</div>
    </div>
  );
}

function NumberEditor({ label, technical, value, min, max, onChange, compact = false }: { label: string; technical: string; value: number; min?: number; max?: number; onChange: (value: number) => void; compact?: boolean }) {
  return (
    <label className="block space-y-1.5 min-w-0">
      <span className="flex items-center justify-between gap-1 text-[9px] sm:text-[10px] uppercase text-zinc-500 font-mono">
        <span className="truncate">{label}</span><span className="text-zinc-400 shrink-0">{technical}</span>
      </span>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(Number(event.target.value))}
        className={`w-full min-w-0 bg-white border border-zinc-300 rounded-xl px-3 ${compact ? 'py-2' : 'py-2.5'} text-[12px] sm:text-[13px] text-zinc-900 font-mono placeholder:text-zinc-400 focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100 disabled:bg-zinc-100 disabled:text-zinc-500 disabled:cursor-not-allowed`}
      />
    </label>
  );
}

function ReadOnlyLogic({ label, technical, value }: { label: string; technical: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2 text-[9px] sm:text-[10px] uppercase text-zinc-500 font-mono">
        <span>{label}</span><span className="text-zinc-400">{technical}</span>
      </div>
      <div className="mt-1.5 min-h-10 px-3 py-2.5 rounded-xl border border-zinc-200 bg-zinc-100 text-[11px] text-zinc-700 leading-relaxed break-words">
        {value}
      </div>
    </div>
  );
}

function QuickButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="shrink-0 h-9 px-3 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-[10px] sm:text-[11px] text-zinc-700 font-medium cursor-pointer whitespace-nowrap disabled:bg-zinc-100 disabled:text-zinc-400 disabled:cursor-not-allowed">{label}</button>;
}

function SectionButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick} className={`shrink-0 h-9 px-3 rounded-lg text-[11px] font-medium flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${active ? 'bg-cyan-50 border border-cyan-200 text-cyan-700' : 'border border-transparent text-zinc-600 hover:bg-zinc-50'}`}>
      {icon}{label}
    </button>
  );
}

function SourceRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-2 rounded-lg bg-zinc-50 border border-zinc-200 px-2.5 py-2 min-w-0"><span className="text-zinc-500 shrink-0">{label}</span><code className="text-indigo-600 text-right break-all min-w-0">{value}</code></div>;
}

function Capacity({ icon, label, value, field }: { icon: React.ReactNode; label: string; value: number; field: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm p-3 min-w-0">
      <div className="flex items-center justify-between">{icon}<code className="text-[9px] text-zinc-400">{field}</code></div>
      <div className="text-2xl font-bold text-zinc-900 mt-2">{value}</div>
      <div className="text-[10px] text-zinc-500">{label}</div>
    </div>
  );
}
