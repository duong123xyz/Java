import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  UserRound,
  RefreshCw,
  AlertTriangle,
  Backpack,
  Gauge,
  CheckCircle2,
  RotateCcw,
  HeartPulse,
  Zap,
  Swords,
  Shield,
  Target,
  Coins,
  Gem,
  Sparkles,
  MapPin,
  Package,
  Archive,
  BookOpen,
  ChevronRight,
  Database,
  Info,
  Stars,
} from 'lucide-react';
import { LoadedJarSession } from '../../types/jar';
import {
  analyzeCharacterDefaults,
  CharacterAnalysisSnapshot,
  CharacterDraft,
  CharacterStarterProfile,
  getCharacterDraft,
  getDirtyCharacterCount,
  isCharacterDraftDirty,
  resetCharacterDraft,
  setCharacterDraft,
} from '../../services/characterDataService';
import {
  analyzeDiscipleSchema,
  DiscipleDraft,
  DiscipleFieldGroup,
  DiscipleSchemaSnapshot,
  getDirtyDiscipleCount,
  getDiscipleDraft,
  resetDiscipleDraft,
  setDiscipleDraft,
} from '../../services/characterPatchService';
import { CharacterSpritePreview } from './CharacterSpritePreview';

interface CharacterPanelProps {
  session: LoadedJarSession;
  onDraftsUpdated?: (dirtyCount: number) => void;
}

type CharacterView = 'starter' | 'disciple' | 'save';

export function CharacterPanel({
  session,
  onDraftsUpdated,
}: CharacterPanelProps) {
  const [snapshot, setSnapshot] = useState<CharacterAnalysisSnapshot | null>(null);
  const [selectedPlanet, setSelectedPlanet] = useState<0 | 1 | 2>(0);
  const [view, setView] = useState<CharacterView>('starter');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [discipleDirtyCount, setDiscipleDirtyCount] = useState(0);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await analyzeCharacterDefaults(session);
      setSnapshot(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  };

  const onDraftsUpdatedRef = useRef(onDraftsUpdated);
  onDraftsUpdatedRef.current = onDraftsUpdated;

  useEffect(() => {
    load();
  }, [session]);

  useEffect(() => {
    if (!snapshot) return;
    void revision;
    onDraftsUpdatedRef.current?.(
      getDirtyCharacterCount(session, snapshot.profiles) + discipleDirtyCount
    );
  }, [session, snapshot, revision, discipleDirtyCount]);

  const selectedProfile = useMemo(() => {
    return snapshot?.profiles.find((profile) => profile.planet === selectedPlanet) ?? null;
  }, [snapshot, selectedPlanet]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center rounded-2xl border border-zinc-200 bg-white">
        <div className="text-center space-y-2">
          <RefreshCw className="w-5 h-5 text-indigo-400 animate-spin mx-auto" />
          <div className="text-xs font-mono text-zinc-500">
            Đang đọc player class và schema save...
          </div>
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
            Không đọc được dữ liệu nhân vật
          </div>
          <div className="whitespace-pre-wrap">{error}</div>
          <button
            type="button"
            onClick={load}
            className="mt-3 px-3 py-1.5 rounded-lg bg-red-100 hover:bg-red-200 cursor-pointer"
          >
            Thử lại
          </button>
        </div>
      </div>
    );
  }

  const dirtyCount = getDirtyCharacterCount(session, snapshot.profiles) + discipleDirtyCount;

  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      <div className="shrink-0 rounded-2xl border border-zinc-200 bg-white shadow-sm px-3 sm:px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 w-full sm:w-auto">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-100 to-cyan-100 border border-indigo-200 flex items-center justify-center">
            <UserRound className="w-5 h-5 text-indigo-500" />
          </div>
          <div className="min-w-0">
            <div className="text-base font-bold text-zinc-900">Nhân vật</div>
            <div className="text-[11px] text-zinc-500">
              Xem trực quan nhân vật khởi tạo theo hành tinh và chỉnh nhanh bộ chỉ số mặc định.
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <StatChip text="3 hành tinh" />
              <StatChip text="Sprite preview" />
              <StatChip text="H.p(byte)" />
              <StatChip text="Source-backed" />
              <StatChip text="Save a/a/N" />
              {dirtyCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-violet-50 border border-violet-200 text-violet-600 text-[10px] font-mono">
                  {dirtyCount} nháp
                </span>
              )}
            </div>
          </div>
        </div>

        <div
          className={`self-start sm:self-auto shrink-0 flex items-center gap-1.5 text-[10px] font-mono ${
            snapshot.verified ? 'text-emerald-600' : 'text-amber-600'
          }`}
          title={snapshot.verificationDetail}
        >
          {snapshot.verified ? (
            <CheckCircle2 className="w-3.5 h-3.5" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5" />
          )}
          <span className="hidden 2xl:inline">
            {snapshot.verified ? 'Source-backed + writer READY' : 'Cần kiểm tra cấu trúc'}
          </span>
        </div>
      </div>

      <div className="shrink-0 flex items-center gap-1 p-1 rounded-xl bg-white border border-zinc-200 shadow-sm w-full sm:w-fit overflow-x-auto">
        <ViewButton
          active={view === 'starter'}
          onClick={() => setView('starter')}
          icon={<Sparkles className="w-3 h-3" />}
          label="Nhân vật khởi tạo"
        />
        <ViewButton
          active={view === 'disciple'}
          onClick={() => setView('disciple')}
          icon={<UserRound className="w-3 h-3" />}
          label="Đệ tử"
        />
        <ViewButton
          active={view === 'save'}
          onClick={() => setView('save')}
          icon={<Database className="w-3 h-3" />}
          label="Schema save"
        />
      </div>

      <div className="min-h-0 flex-1">
        {view === 'starter' ? (
          <StarterEditor
            session={session}
            snapshot={snapshot}
            selectedPlanet={selectedPlanet}
            onSelectPlanet={setSelectedPlanet}
            selectedProfile={selectedProfile}
            onChanged={() => setRevision((value) => value + 1)}
          />
        ) : view === 'disciple' ? (
          <DisciplePanel
            session={session}
            onDraftsUpdated={setDiscipleDirtyCount}
          />
        ) : (
          <SaveSchemaView snapshot={snapshot} />
        )}
      </div>
    </div>
  );
}

function StarterEditor({
  session,
  snapshot,
  selectedPlanet,
  onSelectPlanet,
  selectedProfile,
  onChanged,
}: {
  session: LoadedJarSession;
  snapshot: CharacterAnalysisSnapshot;
  selectedPlanet: 0 | 1 | 2;
  onSelectPlanet: (planet: 0 | 1 | 2) => void;
  selectedProfile: CharacterStarterProfile | null;
  onChanged: () => void;
}) {
  if (!selectedProfile) return null;

  const [draft, setDraftState] = useState<CharacterDraft>(() =>
    getCharacterDraft(session, selectedProfile)
  );

  useEffect(() => {
    setDraftState(getCharacterDraft(session, selectedProfile));
  }, [session, selectedProfile.planet]);

  const dirty = isCharacterDraftDirty(selectedProfile, draft);

  const save = (next: CharacterDraft) => {
    setCharacterDraft(session, selectedProfile, next);
    setDraftState(getCharacterDraft(session, selectedProfile));
    onChanged();
  };

  const patch = (value: Partial<CharacterDraft>) => save({ ...draft, ...value });

  const reset = () => {
    setDraftState(resetCharacterDraft(session, selectedProfile));
    onChanged();
  };

  const multiplyCombat = (multiplier: number) => {
    patch({
      baseHp: Math.max(1, Math.round(selectedProfile.baseHp * multiplier)),
      baseKi: Math.max(1, Math.round(selectedProfile.baseKi * multiplier)),
      baseDamage: Math.max(1, Math.round(selectedProfile.baseDamage * multiplier)),
    });
  };

  const multiplyProgress = (multiplier: number) => {
    patch({
      power: Math.max(0, Math.round(selectedProfile.power * multiplier)),
      potential: Math.max(0, Math.round(selectedProfile.potential * multiplier)),
    });
  };

  return (
    <div className="h-full min-h-0 grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-3">
      <aside className="min-h-0 rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-zinc-200 bg-gradient-to-r from-indigo-50 to-cyan-50">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-mono">
            Chọn mẫu nhân vật
          </div>
          <div className="text-sm font-bold text-zinc-900 mt-1">Hiển thị trực quan theo hành tinh</div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
          {snapshot.profiles.map((profile) => {
            const profileDraft = getCharacterDraft(session, profile);
            const profileDirty = isCharacterDraftDirty(profile, profileDraft);
            const selected = profile.planet === selectedPlanet;

            return (
              <button
                key={profile.planet}
                type="button"
                onClick={() => onSelectPlanet(profile.planet)}
                className={`w-full rounded-2xl border text-left overflow-hidden cursor-pointer transition-all ${
                  selected
                    ? 'border-indigo-300 bg-indigo-50 shadow-sm'
                    : 'border-zinc-200 bg-white hover:bg-zinc-50'
                }`}
              >
                <div className="p-3 flex items-center gap-3">
                  <div className="w-[92px] shrink-0">
                    <CharacterSpritePreview
                      session={session}
                      head={profile.previewHead}
                      body={profile.previewBody}
                      leg={profile.previewLeg}
                      name={profile.planetName}
                      compact
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-zinc-900">{profile.planetName}</span>
                      {profileDirty && (
                        <span className="px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[9px] font-mono">
                          nháp
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-zinc-500 mt-1">{profile.archetype}</div>
                    <div className="mt-2 grid grid-cols-3 gap-1.5 text-[10px]">
                      <MiniBadge label="HP" value={profileDraft.baseHp} />
                      <MiniBadge label="KI" value={profileDraft.baseKi} />
                      <MiniBadge label="ATK" value={profileDraft.baseDamage} />
                    </div>
                    <div className="text-[10px] text-zinc-500 font-mono mt-2">
                      map {profileDraft.mapId} · skill {profileDraft.selectedSkill}
                    </div>
                  </div>

                  <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="min-h-0 rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden flex flex-col">
        <div className="shrink-0 px-4 py-3 border-b border-zinc-200 bg-gradient-to-r from-white via-indigo-50/40 to-cyan-50/60 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <PlanetPill planet={selectedProfile.planet} />
            <div className="min-w-0">
              <div className="text-lg font-bold text-zinc-900">{selectedProfile.planetName}</div>
              <div className="text-[11px] text-zinc-500">
                {selectedProfile.archetype} · source: a/a/H.p({selectedProfile.planet})
              </div>
            </div>
            {dirty && (
              <span className="px-2 py-0.5 rounded-full bg-violet-50 border border-violet-200 text-violet-600 text-[10px] font-mono">
                đang sửa
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={reset}
            disabled={!dirty}
            className="px-3 py-1.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 border border-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] text-zinc-700 font-medium flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Hoàn tác
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-1 2xl:grid-cols-[320px_minmax(0,1fr)] gap-4">
            <CharacterSpritePreview
              session={session}
              head={selectedProfile.previewHead}
              body={selectedProfile.previewBody}
              leg={selectedProfile.previewLeg}
              name={selectedProfile.planetName}
              subtitle="Preview trực quan cho panel nhân vật"
              showTechnicalInfo
            />

            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <HeroStat
                icon={<HeartPulse className="w-4 h-4 text-rose-500" />}
                label="HP gốc"
                value={draft.baseHp}
                original={selectedProfile.baseHp}
              />
              <HeroStat
                icon={<Zap className="w-4 h-4 text-cyan-500" />}
                label="KI gốc"
                value={draft.baseKi}
                original={selectedProfile.baseKi}
              />
              <HeroStat
                icon={<Swords className="w-4 h-4 text-orange-500" />}
                label="Sức đánh"
                value={draft.baseDamage}
                original={selectedProfile.baseDamage}
              />
              <HeroStat
                icon={<Coins className="w-4 h-4 text-amber-500" />}
                label="Vàng"
                value={draft.gold}
                original={selectedProfile.gold}
              />
              <HeroStat
                icon={<Gem className="w-4 h-4 text-emerald-500" />}
                label="Ngọc"
                value={draft.gems}
                original={selectedProfile.gems}
              />
              <HeroStat
                icon={<Stars className="w-4 h-4 text-violet-500" />}
                label="Tiềm năng"
                value={draft.potential}
                original={selectedProfile.potential}
              />
              <HeroStat
                icon={<Sparkles className="w-4 h-4 text-indigo-500" />}
                label="Sức mạnh"
                value={draft.power}
                original={selectedProfile.power}
              />
              <HeroStat
                icon={<MapPin className="w-4 h-4 text-sky-500" />}
                label="Map khởi đầu"
                value={draft.mapId}
                original={selectedProfile.mapId}
              />
              <HeroStat
                icon={<Target className="w-4 h-4 text-fuchsia-500" />}
                label="Skill chọn"
                value={draft.selectedSkill}
                original={selectedProfile.selectedSkill}
              />
            </div>
          </div>

          <EditorSection title="Chỉ số chiến đấu" icon={<Swords className="w-4 h-4 text-orange-500" />}>
            <div className="flex flex-wrap gap-2 mb-3">
              <QuickButton label="Khôi phục gốc" onClick={() => multiplyCombat(1)} />
              <QuickButton label="HP/KI/ATK x2" onClick={() => multiplyCombat(2)} />
              <QuickButton label="HP/KI/ATK x5" onClick={() => multiplyCombat(5)} />
              <QuickButton label="HP/KI/ATK x10" onClick={() => multiplyCombat(10)} />
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-3">
              <NumberEditor label="HP gốc" technical="xx" value={draft.baseHp} min={1} onChange={(baseHp) => patch({ baseHp })} />
              <NumberEditor label="KI gốc" technical="xy" value={draft.baseKi} min={1} onChange={(baseKi) => patch({ baseKi })} />
              <NumberEditor label="Sức đánh gốc" technical="xz" value={draft.baseDamage} min={1} onChange={(baseDamage) => patch({ baseDamage })} />
              <NumberEditor label="Giáp gốc" technical="xA" value={draft.baseArmor} min={0} onChange={(baseArmor) => patch({ baseArmor })} />
              <NumberEditor label="Chí mạng %" technical="xB" value={draft.baseCritical} min={0} max={100} onChange={(baseCritical) => patch({ baseCritical })} />
              <NumberEditor label="Tốc độ" technical="xC" value={draft.speed} min={1} onChange={(speed) => patch({ speed })} />
            </div>
          </EditorSection>

          <EditorSection title="Kinh tế & tiến trình" icon={<Coins className="w-4 h-4 text-amber-500" />}>
            <div className="flex flex-wrap gap-2 mb-3">
              <QuickButton label="Tiến trình gốc" onClick={() => multiplyProgress(1)} />
              <QuickButton label="Power/Potential x2" onClick={() => multiplyProgress(2)} />
              <QuickButton label="Power/Potential x5" onClick={() => multiplyProgress(5)} />
              <QuickButton label="Power/Potential x10" onClick={() => multiplyProgress(10)} />
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-3">
              <NumberEditor label="Vàng" technical="bS" value={draft.gold} min={0} onChange={(gold) => patch({ gold })} />
              <NumberEditor label="Ngọc" technical="xv" value={draft.gems} min={0} onChange={(gems) => patch({ gems })} />
              <NumberEditor label="Hồng ngọc" technical="xw" value={draft.ruby} min={0} onChange={(ruby) => patch({ ruby })} />
              <NumberEditor label="Sức mạnh" technical="bT" value={draft.power} min={0} onChange={(power) => patch({ power })} />
              <NumberEditor label="Tiềm năng" technical="bU" value={draft.potential} min={0} onChange={(potential) => patch({ potential })} />
              <NumberEditor label="Cấp" technical="vO" value={draft.level} min={1} onChange={(level) => patch({ level })} />
            </div>
          </EditorSection>

          <EditorSection title="Vị trí & trạng thái khởi tạo" icon={<MapPin className="w-4 h-4 text-sky-500" />}>
            <div className="grid grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8 gap-3">
              <NumberEditor label="Map" technical="vP" value={draft.mapId} min={0} onChange={(mapId) => patch({ mapId })} />
              <NumberEditor label="X" technical="cp" value={draft.spawnX} min={0} onChange={(spawnX) => patch({ spawnX })} />
              <NumberEditor label="Y" technical="cq" value={draft.spawnY} min={0} onChange={(spawnY) => patch({ spawnY })} />
              <NumberEditor label="Điểm kỹ năng" technical="yf" value={draft.skillPoints} min={0} onChange={(skillPoints) => patch({ skillPoints })} />
              <NumberEditor label="Thể lực" technical="yg" value={draft.stamina} min={0} onChange={(stamina) => patch({ stamina })} />
              <NumberEditor label="Thể lực max" technical="yh" value={draft.maxStamina} min={1} onChange={(maxStamina) => patch({ maxStamina })} />
              <NumberEditor label="Skill đang chọn" technical="yi" value={draft.selectedSkill} min={-1} onChange={(selectedSkill) => patch({ selectedSkill })} />
              <ReadOnlyField label="Hành tinh" technical="aX" value={`${draft.planet} · ${draft.planetName}`} />
            </div>
          </EditorSection>

          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-[11px] text-emerald-700 leading-relaxed">
            <CheckCircle2 className="w-4 h-4 inline mr-1.5 align-[-2px]" />
            Các giá trị trên được <strong>đọc trực tiếp từ bytecode H.p(byte)</strong> và đã có writer cho Test Workspace.
            Những producer dùng chung trong game (vàng/ngọc/power/X/Y..., HP Namek-Xayda, KI Earth-Xayda, damage Earth-Namek)
            sẽ tự đồng bộ đúng phạm vi khi sửa. Map giữ công thức <code>baseMap + planet</code>; thể lực và thể lực max dùng chung một producer.
          </div>
        </div>
      </section>
    </div>
  );
}

function SaveSchemaView({ snapshot }: { snapshot: CharacterAnalysisSnapshot }) {
  const structure = snapshot.structure;

  return (
    <div className="h-full min-h-0 overflow-y-auto space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-3">
        <CapacityCard icon={<Shield className="w-4 h-4 text-blue-500" />} label="Trang bị" value={structure.equipmentSlots} field="d" />
        <CapacityCard icon={<Package className="w-4 h-4 text-emerald-500" />} label="Hành trang" value={structure.bagSlots} field="e" />
        <CapacityCard icon={<Archive className="w-4 h-4 text-violet-500" />} label="Rương đồ" value={structure.chestSlots} field="f" />
        <CapacityCard icon={<Coins className="w-4 h-4 text-amber-500" />} label="Đồ đã bán" value={structure.saleSlots} field="g" />
        <CapacityCard icon={<UserRound className="w-4 h-4 text-cyan-500" />} label="Đệ tử: trang bị" value={structure.discipleEquipmentSlots} field="b" />
        <CapacityCard icon={<BookOpen className="w-4 h-4 text-rose-500" />} label="Slot kỹ năng" value={structure.skillSlots} field="y" />
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
        <div className="h-11 px-4 border-b border-zinc-200 bg-gradient-to-r from-indigo-50 to-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-indigo-500" />
            <span className="text-sm font-bold text-zinc-900">Field nhân vật trong save</span>
          </div>
          <span className="text-[10px] text-zinc-500 font-mono">a/a/N → a/a/H</span>
        </div>

        <div className="grid grid-cols-1 2xl:grid-cols-2">
          {snapshot.saveFields.map((field) => (
            <div
              key={field.field}
              className="px-4 py-3 border-b border-r border-zinc-200 grid grid-cols-[56px_minmax(0,1fr)_98px_auto] gap-2 items-center"
            >
              <code className="text-[10px] text-indigo-600 font-bold">{field.field}</code>
              <span className="text-[12px] text-zinc-700">{field.label}</span>
              <span className="text-[10px] text-zinc-500 font-mono">{field.type}</span>
              <span
                className={`px-1.5 py-0.5 rounded-full border text-[9px] font-mono ${
                  field.editableInStarter
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                    : 'bg-zinc-50 border-zinc-200 text-zinc-500'
                }`}
              >
                {field.editableInStarter ? 'khởi tạo' : 'save'}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-3 text-[11px] text-cyan-700 leading-relaxed">
        Schema này đã đối chiếu với reader <code>a/a/N.a(byte[], int)</code>: tên, hành tinh,
        map, tọa độ, vàng/ngọc, sức mạnh-tiềm năng, chỉ số gốc, cấp, kỹ năng, nhiệm vụ,
        trang bị, hành trang và rương đều nằm trong save nhân vật.
      </div>
    </div>
  );
}

function MiniBadge({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1">
      <div className="text-[9px] text-zinc-500 font-mono">{label}</div>
      <div className="text-[11px] font-bold text-zinc-800">{value}</div>
    </div>
  );
}

function HeroStat({
  icon,
  label,
  value,
  original,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  original: string | number;
}) {
  const changed = String(value) !== String(original);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-mono">{label}</span>
      </div>
      <div className={`mt-2 text-2xl font-bold ${changed ? 'text-violet-600' : 'text-zinc-900'}`}>
        {value}
      </div>
      <div className="mt-1 text-[10px] text-zinc-500 font-mono">
        {changed ? `gốc ${original}` : 'đang giữ mặc định'}
      </div>
    </div>
  );
}

function PlanetPill({ planet }: { planet: 0 | 1 | 2 }) {
  const config =
    planet === 0
      ? { text: 'Trái Đất', className: 'bg-blue-50 border-blue-200 text-blue-700' }
      : planet === 1
      ? { text: 'Namek', className: 'bg-emerald-50 border-emerald-200 text-emerald-700' }
      : { text: 'Xayda', className: 'bg-rose-50 border-rose-200 text-rose-700' };

  return (
    <div className={`px-3 py-1.5 rounded-xl border text-xs font-bold ${config.className}`}>
      {config.text}
    </div>
  );
}

function EditorSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 overflow-hidden">
      <div className="h-11 px-4 border-b border-zinc-200 bg-white flex items-center gap-2">
        {icon}
        <span className="text-sm font-bold text-zinc-900">{title}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function NumberEditor({
  label,
  technical,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  technical: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center justify-between gap-1 text-[10px] uppercase text-zinc-500 font-mono">
        <span>{label}</span>
        <span className="text-zinc-400">{technical}</span>
      </span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-[12px] text-zinc-900 font-mono focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
      />
    </label>
  );
}

function ReadOnlyField({
  label,
  technical,
  value,
}: {
  label: string;
  technical: string;
  value: string;
}) {
  return (
    <div className="space-y-1.5">
      <span className="flex items-center justify-between gap-1 text-[10px] uppercase text-zinc-500 font-mono">
        <span>{label}</span>
        <span className="text-zinc-400">{technical}</span>
      </span>
      <div className="px-3 py-2 rounded-xl border border-zinc-200 bg-zinc-100 text-[12px] text-zinc-700 font-mono">
        {value}
      </div>
    </div>
  );
}

function QuickButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1.5 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-[11px] text-zinc-700 font-medium cursor-pointer"
    >
      {label}
    </button>
  );
}

function CapacityCard({
  icon,
  label,
  value,
  field,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  field: string;
}) {
  return (
    <div className="p-3 rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between">
        {icon}
        <code className="text-[9px] text-zinc-500">{field}</code>
      </div>
      <div className="mt-2 text-2xl font-bold text-zinc-900">{value}</div>
      <div className="text-[10px] text-zinc-500 font-mono">{label}</div>
    </div>
  );
}

function StatChip({ text }: { text: string }) {
  return (
    <span className="px-2 py-0.5 rounded-full bg-zinc-100 border border-zinc-200 text-[10px] text-zinc-600 font-mono whitespace-nowrap">
      {text}
    </span>
  );
}

function ViewButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg text-[11px] font-medium flex items-center gap-1.5 cursor-pointer ${
        active
          ? 'bg-indigo-50 border border-indigo-200 text-indigo-600'
          : 'text-zinc-600 hover:text-zinc-800'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ---- Đệ tử: inlined into existing CharacterPanel (no new component source file) ----
interface DisciplePanelProps {
  session: LoadedJarSession;
  onDraftsUpdated?: (dirtyCount: number) => void;
}

type DiscipleView = 'stats' | 'skills' | 'schema';

const GROUP_LABELS: Record<DiscipleFieldGroup, string> = {
  identity: 'Danh tính & trạng thái',
  progress: 'Sức mạnh & tiến trình',
  combat: 'Chỉ số chiến đấu',
  runtime: 'Chỉ số hiện tại',
  skills: 'Kỹ năng',
  inventory: 'Trang bị & hành trang',
};

const PLANET_LABELS = ['Trái Đất', 'Namek', 'Xayda'];

function DisciplePanel({ session, onDraftsUpdated }: DisciplePanelProps) {
  const [snapshot, setSnapshot] = useState<DiscipleSchemaSnapshot | null>(null);
  const [draft, setDraftState] = useState<DiscipleDraft | null>(null);
  const [view, setView] = useState<DiscipleView>('stats');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void analyzeDiscipleSchema(session)
      .then((result) => {
        if (!active) return;
        setSnapshot(result);
        setDraftState(getDiscipleDraft(session, result));
        onDraftsUpdated?.(getDirtyDiscipleCount(session));
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
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

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center rounded-2xl border border-zinc-200 bg-white">
        <div className="text-center space-y-2 text-zinc-500 text-xs font-mono">
          <RefreshCw className="w-5 h-5 animate-spin mx-auto text-cyan-500" />
          <div>Đang đọc schema + writer Đệ tử...</div>
        </div>
      </div>
    );
  }

  if (error || !snapshot || !draft) {
    return (
      <div className="h-full flex items-center justify-center rounded-2xl border border-red-200 bg-red-50 p-4 text-xs text-red-700">
        <AlertTriangle className="w-4 h-4 mr-2" />
        {error || 'Không đọc được schema Đệ tử.'}
      </div>
    );
  }

  const dirty = getDirtyDiscipleCount(session) > 0;
  const baseline = snapshot.resetDefaults;

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

  const reset = () => {
    setDraftState(resetDiscipleDraft(session, snapshot));
    onDraftsUpdated?.(0);
  };

  const syncCurrent = () => patch({ hp: draft.baseHp, ki: draft.baseKi });
  const fullStamina = () => patch({ stamina: draft.maxStamina });
  const clearSkills = () => patch({
    skills: Array.from({ length: snapshot.skillSlots }, () => ({ id: -1, level: 0 })),
  });

  return (
    <div className="h-full min-h-0 flex flex-col gap-2 sm:gap-3">
      <div className="shrink-0 rounded-2xl border border-zinc-200 bg-white shadow-sm p-3 sm:p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-gradient-to-br from-cyan-100 to-indigo-100 border border-cyan-200 flex items-center justify-center shrink-0">
            <UserRound className="w-5 h-5 text-cyan-600" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-base font-bold text-zinc-900">Đệ tử</div>
              {dirty && (
                <span className="px-2 py-0.5 rounded-full bg-violet-50 border border-violet-200 text-violet-700 text-[9px] font-mono">
                  đang sửa
                </span>
              )}
            </div>
            <div className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">
              Chỉnh default/reset thật trong <code>a/a/H.gf()</code>. Save codec <code>a/a/N</code> giữ nguyên.
            </div>
            <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5 sm:flex-wrap">
              <DiscipleChip text="writer READY" />
              <DiscipleChip text={`${snapshot.skillSlots} skill`} />
              <DiscipleChip text={`${snapshot.equipmentSlots} trang bị`} />
              <DiscipleChip text={`${snapshot.bagSlots} hành trang`} />
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

      <div className="shrink-0 flex items-center gap-1 p-1 rounded-xl bg-white border border-zinc-200 shadow-sm w-full sm:w-fit overflow-x-auto">
        <DiscipleSectionButton active={view === 'stats'} onClick={() => setView('stats')} icon={<Gauge className="w-3.5 h-3.5" />} label="Chỉ số" />
        <DiscipleSectionButton active={view === 'skills'} onClick={() => setView('skills')} icon={<Sparkles className="w-3.5 h-3.5" />} label="Kỹ năng" />
        <DiscipleSectionButton active={view === 'schema'} onClick={() => setView('schema')} icon={<Database className="w-3.5 h-3.5" />} label="Schema" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-0 sm:pr-1 pb-2">
        {view === 'stats' ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
              <DiscipleSummaryCard icon={<HeartPulse className="w-4 h-4 text-rose-500" />} label="HP gốc" value={draft.baseHp} original={baseline.baseHp} field="yq" />
              <DiscipleSummaryCard icon={<Zap className="w-4 h-4 text-cyan-500" />} label="KI gốc" value={draft.baseKi} original={baseline.baseKi} field="yr" />
              <DiscipleSummaryCard icon={<Swords className="w-4 h-4 text-orange-500" />} label="Sức đánh" value={draft.baseDamage} original={baseline.baseDamage} field="ys" />
              <DiscipleSummaryCard icon={<Sparkles className="w-4 h-4 text-violet-500" />} label="Sức mạnh" value={draft.power} original={baseline.power} field="cj" />
            </div>

            <DiscipleEditorSection title="Danh tính logic" subtitle="Giữ gN/tên do game quản lý; chỉ chỉnh các byte đã được save validator xác minh.">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <DiscipleNumberEditor label="Loại đệ tử" technical="aZ" value={draft.type} min={0} max={1} onChange={(type) => patch({ type })} />
                <DiscipleSelectEditor
                  label="Hành tinh"
                  technical="ba"
                  value={draft.planet}
                  options={PLANET_LABELS.map((label, value) => ({ value, label: `${value} · ${label}` }))}
                  onChange={(planet) => patch({ planet })}
                />
                <DiscipleNumberEditor label="Trạng thái" technical="bb" value={draft.status} min={0} max={4} onChange={(status) => patch({ status })} />
              </div>
            </DiscipleEditorSection>

            <DiscipleEditorSection title="Sức mạnh & tiến trình">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <DiscipleNumberEditor label="Sức mạnh" technical="cj" value={draft.power} min={0} max={1_000_000_000_000} onChange={(power) => patch({ power })} />
                <DiscipleNumberEditor label="Tiềm năng" technical="ck" value={draft.potential} min={0} max={1_000_000_000_000} onChange={(potential) => patch({ potential })} />
              </div>
            </DiscipleEditorSection>

            <DiscipleEditorSection title="Chỉ số chiến đấu">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
                <DiscipleNumberEditor label="HP gốc" technical="yq" value={draft.baseHp} min={0} onChange={(baseHp) => patch({ baseHp })} />
                <DiscipleNumberEditor label="KI gốc" technical="yr" value={draft.baseKi} min={0} onChange={(baseKi) => patch({ baseKi })} />
                <DiscipleNumberEditor label="Sức đánh" technical="ys" value={draft.baseDamage} min={0} onChange={(baseDamage) => patch({ baseDamage })} />
                <DiscipleNumberEditor label="Giáp" technical="yt" value={draft.armor} min={0} onChange={(armor) => patch({ armor })} />
                <DiscipleNumberEditor label="Chí mạng %" technical="yu" value={draft.critical} min={0} max={100} onChange={(critical) => patch({ critical })} />
              </div>
            </DiscipleEditorSection>

            <DiscipleEditorSection title="HP / KI / thể lực hiện tại">
              <div className="flex gap-2 overflow-x-auto mb-3 pb-0.5">
                <DiscipleQuickButton label="HP/KI hiện tại = gốc" onClick={syncCurrent} />
                <DiscipleQuickButton label="Hồi đầy thể lực" onClick={fullStamina} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                <DiscipleNumberEditor label="HP hiện tại" technical="yv" value={draft.hp} min={0} onChange={(hp) => patch({ hp })} />
                <DiscipleNumberEditor label="KI hiện tại" technical="yw" value={draft.ki} min={0} onChange={(ki) => patch({ ki })} />
                <DiscipleNumberEditor label="Thể lực" technical="yx" value={draft.stamina} min={0} onChange={(stamina) => patch({ stamina })} />
                <DiscipleNumberEditor label="Thể lực tối đa" technical="yy" value={draft.maxStamina} min={0} onChange={(maxStamina) => patch({ maxStamina })} />
              </div>
            </DiscipleEditorSection>

            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-[11px] text-emerald-800 leading-relaxed">
              <CheckCircle2 className="w-4 h-4 inline mr-1.5 align-[-2px]" />
              <strong>Writer thật đã bật.</strong> Test Workspace sẽ hook <code>a/a/H.gf()</code> sang helper major 47 và ghi các default trên. Logic save hiện tại không bị thay đổi.
            </div>
          </div>
        ) : view === 'skills' ? (
          <div className="space-y-3">
            <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
              <div className="px-3 sm:px-4 py-3 border-b border-zinc-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <div className="text-sm font-bold text-zinc-900">7 ô kỹ năng Đệ tử</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">cV = ID kỹ năng · cW = cấp kỹ năng</div>
                </div>
                <button type="button" onClick={clearSkills} className="self-start sm:self-auto h-9 px-3 rounded-xl border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 text-[11px] text-zinc-700 cursor-pointer">
                  Reset 7 skill
                </button>
              </div>
              <div className="p-3 sm:p-4 grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-3">
                {draft.skills.map((skill, index) => (
                  <div key={index} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <strong className="text-xs text-zinc-800">Slot {index + 1}</strong>
                      <span className="text-[9px] text-zinc-500 font-mono">cV[{index}] / cW[{index}]</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <DiscipleNumberEditor compact label="Skill ID" technical="ID" value={skill.id} min={-1} onChange={(id) => patchSkill(index, { id })} />
                      <DiscipleNumberEditor compact label="Cấp" technical="LV" value={skill.level} min={0} max={10_000} onChange={(level) => patchSkill(index, { level })} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <DiscipleSchemaView snapshot={snapshot} grouped={grouped} />
        )}
      </div>
    </div>
  );
}

function DiscipleSchemaView({
  snapshot,
  grouped,
}: {
  snapshot: DiscipleSchemaSnapshot;
  grouped: Map<DiscipleFieldGroup, DiscipleSchemaSnapshot['fields']>;
}) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-3">
      <div className="space-y-3">
        {(['identity', 'progress', 'combat', 'runtime', 'skills', 'inventory'] as DiscipleFieldGroup[]).map((group) => {
          const fields = grouped.get(group) ?? [];
          return (
            <div key={group} className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
              <div className="h-10 px-3 sm:px-4 border-b border-zinc-200 bg-zinc-50 flex items-center justify-between">
                <strong className="text-xs text-zinc-900">{GROUP_LABELS[group]}</strong>
                <span className="text-[9px] text-zinc-500 font-mono">{fields.length} field</span>
              </div>
              <div className="divide-y divide-zinc-100">
                {fields.map((field) => (
                  <div key={field.field} className="px-3 sm:px-4 py-3 grid grid-cols-[46px_minmax(0,1fr)_70px] sm:grid-cols-[58px_minmax(0,1fr)_92px_auto] gap-2 items-center">
                    <code className="text-[10px] text-indigo-600 font-bold">{field.field}</code>
                    <div className="min-w-0">
                      <div className="text-[11px] sm:text-[12px] text-zinc-800">{field.label}</div>
                      {field.note && <div className="text-[9px] text-zinc-500 mt-0.5 leading-relaxed">{field.note}</div>}
                    </div>
                    <span className="text-[9px] sm:text-[10px] text-zinc-500 font-mono text-right">{field.type}</span>
                    <span className={`hidden sm:inline-flex justify-self-end px-1.5 py-0.5 rounded-full border text-[9px] font-mono ${field.editable ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-zinc-50 border-zinc-200 text-zinc-500'}`}>
                      {field.editable ? 'editable' : 'read-only'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <aside className="space-y-3">
        <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
          <div className="h-10 px-4 border-b border-zinc-200 bg-gradient-to-r from-cyan-50 to-white flex items-center gap-2">
            <Database className="w-4 h-4 text-cyan-600" />
            <strong className="text-xs text-zinc-900">Nguồn bytecode</strong>
          </div>
          <div className="p-3 space-y-2 text-[10px] font-mono">
            <DiscipleSourceRow label="Player" value={snapshot.sourceClass} />
            <DiscipleSourceRow label="Save codec" value={snapshot.codecClass} />
            <DiscipleSourceRow label="Reset" value={`${snapshot.sourceClass}.${snapshot.resetMethod}`} />
            <DiscipleSourceRow label="Helper" value={snapshot.helperClass} />
            <DiscipleSourceRow label="Presence" value={snapshot.presenceField} />
          </div>
        </div>

        <div className="grid grid-cols-2 xl:grid-cols-1 gap-2">
          <DiscipleCapacity icon={<Shield className="w-4 h-4 text-blue-500" />} label="Trang bị" value={snapshot.equipmentSlots} field="b" />
          <DiscipleCapacity icon={<Backpack className="w-4 h-4 text-emerald-500" />} label="Hành trang" value={snapshot.bagSlots} field="c" />
        </div>
      </aside>
    </div>
  );
}

function DiscipleChip({ text }: { text: string }) {
  return <span className="shrink-0 px-2 py-0.5 rounded-full bg-zinc-100 border border-zinc-200 text-[9px] text-zinc-600 font-mono whitespace-nowrap">{text}</span>;
}

function DiscipleSummaryCard({ icon, label, value, original, field }: { icon: React.ReactNode; label: string; value: number; original: number; field: string }) {
  const changed = value !== original;
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm p-3 min-w-0">
      <div className="flex items-center justify-between">{icon}<code className="text-[9px] text-zinc-400">{field}</code></div>
      <div className={`text-lg sm:text-xl font-bold mt-2 truncate ${changed ? 'text-violet-600' : 'text-zinc-900'}`} title={String(value)}>{value.toLocaleString('vi-VN')}</div>
      <div className="text-[10px] text-zinc-500 truncate">{label}</div>
    </div>
  );
}

function DiscipleEditorSection({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
      <div className="px-3 sm:px-4 py-3 border-b border-zinc-200 bg-zinc-50">
        <div className="text-xs sm:text-sm font-bold text-zinc-900">{title}</div>
        {subtitle && <div className="text-[10px] text-zinc-500 mt-0.5 leading-relaxed">{subtitle}</div>}
      </div>
      <div className="p-3 sm:p-4">{children}</div>
    </div>
  );
}

function DiscipleNumberEditor({ label, technical, value, min, max, onChange, compact = false }: { label: string; technical: string; value: number; min?: number; max?: number; onChange: (value: number) => void; compact?: boolean }) {
  return (
    <label className="block space-y-1.5 min-w-0">
      <span className="flex items-center justify-between gap-1 text-[9px] sm:text-[10px] uppercase text-zinc-500 font-mono">
        <span className="truncate">{label}</span><span className="text-zinc-400 shrink-0">{technical}</span>
      </span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        inputMode="numeric"
        onChange={(event) => onChange(Number(event.target.value))}
        className={`w-full min-w-0 bg-white border border-zinc-300 rounded-xl px-3 ${compact ? 'py-2' : 'py-2.5'} text-[12px] sm:text-[13px] text-zinc-900 font-mono placeholder:text-zinc-400 focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100 disabled:bg-zinc-100 disabled:text-zinc-500`}
      />
    </label>
  );
}

function DiscipleSelectEditor({ label, technical, value, options, onChange }: { label: string; technical: string; value: number; options: Array<{ value: number; label: string }>; onChange: (value: number) => void }) {
  return (
    <label className="block space-y-1.5 min-w-0">
      <span className="flex items-center justify-between gap-1 text-[9px] sm:text-[10px] uppercase text-zinc-500 font-mono">
        <span>{label}</span><span className="text-zinc-400">{technical}</span>
      </span>
      <select value={value} onChange={(event) => onChange(Number(event.target.value))} className="w-full bg-white border border-zinc-300 rounded-xl px-3 py-2.5 text-[12px] sm:text-[13px] text-zinc-900 focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100">
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function DiscipleQuickButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="shrink-0 h-9 px-3 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-[10px] sm:text-[11px] text-zinc-700 font-medium cursor-pointer whitespace-nowrap">{label}</button>;
}

function DiscipleSectionButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick} className={`shrink-0 h-9 px-3 rounded-lg text-[11px] font-medium flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${active ? 'bg-cyan-50 border border-cyan-200 text-cyan-700' : 'border border-transparent text-zinc-600 hover:bg-zinc-50'}`}>
      {icon}{label}
    </button>
  );
}

function DiscipleSourceRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-2 rounded-lg bg-zinc-50 border border-zinc-200 px-2.5 py-2"><span className="text-zinc-500">{label}</span><code className="text-indigo-600 text-right break-all">{value}</code></div>;
}

function DiscipleCapacity({ icon, label, value, field }: { icon: React.ReactNode; label: string; value: number; field: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm p-3">
      <div className="flex items-center justify-between">{icon}<code className="text-[9px] text-zinc-400">{field}</code></div>
      <div className="text-2xl font-bold text-zinc-900 mt-2">{value}</div>
      <div className="text-[10px] text-zinc-500">{label}</div>
    </div>
  );
}

