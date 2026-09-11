import React, { useState, useRef, useEffect } from 'react';
import {
  LayoutDashboard,
  Database,
  MapPinned,
  UserRound,
  Sparkles,
  Bug,
  Crown,
  SlidersHorizontal,
  Compass,
  Package,
  Network,
  Gamepad2,
  PlayCircle,
  Loader2,
  Grid,
  Search,
  X,
  CheckCircle2,
  Layers,
  ChevronRight,
  Sliders,
  FileCode2,
} from 'lucide-react';
import { LoadedJarSession } from '../../types/jar';
import { DraftTestProgress } from '../../services/draftTestService';

export type AppTabKey =
  | 'overview'
  | 'game-data'
  | 'items'
  | 'maps'
  | 'mobs'
  | 'characters'
  | 'skills'
  | 'bosses'
  | 'mechanics'
  | 'multiplayer'
  | 'explorer'
  | 'test';

export type TabCategoryKey = 'game' | 'system' | 'test';

interface TabItemDef {
  key: AppTabKey;
  label: string;
  shortLabel: string;
  description: string;
  category: TabCategoryKey;
  icon: React.ComponentType<{ className?: string }>;
  colorClass: string;
  activeBgClass: string;
  badgeCount?: number;
  extraBadge?: string;
  isReady?: boolean;
}

interface AppTabNavigationProps {
  session: LoadedJarSession;
  activeTab: AppTabKey;
  onTabChange: (tab: AppTabKey) => void;
  dirtyCounts: {
    items: number;
    npcs: number;
    maps: number;
    mobs: number;
    characters: number;
    skills: number;
    bosses: number;
    mechanics: number;
  };
  totalDirtyDrafts: number;
  workspaceOperationCount: number;
  isBuildingDraftTest: boolean;
  draftTestProgress: DraftTestProgress | null;
  onTestDraft: () => void;
}

export const AppTabNavigation: React.FC<AppTabNavigationProps> = ({
  session,
  activeTab,
  onTabChange,
  dirtyCounts,
  totalDirtyDrafts,
  workspaceOperationCount,
  isBuildingDraftTest,
  draftTestProgress,
  onTestDraft,
}) => {
  const [showAllTabsSheet, setShowAllTabsSheet] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  // Desktop view mode: 'grouped' (shows category segments + sub-tabs) or 'all' (shows all 12 tabs in one strip)
  const [desktopViewMode, setDesktopViewMode] = useState<'grouped' | 'all'>('grouped');
  const [lastGameTab, setLastGameTab] = useState<AppTabKey>('items');
  const [lastSystemTab, setLastSystemTab] = useState<AppTabKey>('overview');

  const subTabScrollRef = useRef<HTMLDivElement>(null);
  const allTabScrollRef = useRef<HTMLDivElement>(null);

  // Tab definitions
  const tabs: TabItemDef[] = [
    // Game Content Category
    {
      key: 'items',
      label: 'Vật phẩm',
      shortLabel: 'Item',
      description: 'Chỉnh sửa template item, icon, chỉ số trang bị và tạo item mới',
      category: 'game',
      icon: Package,
      colorClass: 'text-amber-500',
      activeBgClass: 'bg-amber-50 text-amber-900 border-amber-300 ring-1 ring-amber-400/40',
      badgeCount: dirtyCounts.items,
      extraBadge:
        dirtyCounts.items === 0 && session.itemAnalysis
          ? `${session.itemAnalysis.items.length}`
          : undefined,
    },
    {
      key: 'bosses',
      label: 'Boss',
      shortLabel: 'Boss',
      description: 'Quản lý boss, chỉ số chiến đấu, kỹ năng và tạo boss mới',
      category: 'game',
      icon: Crown,
      colorClass: 'text-rose-500',
      activeBgClass: 'bg-rose-50 text-rose-900 border-rose-300 ring-1 ring-rose-400/40',
      badgeCount: dirtyCounts.bosses,
    },
    {
      key: 'mobs',
      label: 'Quái vật',
      shortLabel: 'Quái',
      description: 'Chỉnh sửa quái vật, HP, level, template và vị trí xuất hiện',
      category: 'game',
      icon: Bug,
      colorClass: 'text-emerald-600',
      activeBgClass: 'bg-emerald-50 text-emerald-900 border-emerald-300 ring-1 ring-emerald-400/40',
      badgeCount: dirtyCounts.mobs,
    },
    {
      key: 'maps',
      label: 'Bản đồ',
      shortLabel: 'Map',
      description: 'Quản lý danh sách map, tọa độ spawn nhân vật và tile map',
      category: 'game',
      icon: MapPinned,
      colorClass: 'text-blue-500',
      activeBgClass: 'bg-blue-50 text-blue-900 border-blue-300 ring-1 ring-blue-400/40',
      badgeCount: dirtyCounts.maps,
    },
    {
      key: 'game-data',
      label: 'Dữ liệu NPC',
      shortLabel: 'Dữ liệu',
      description: 'Danh sách NPC, hội thoại thoại, menu tương tác và bảng dữ liệu game',
      category: 'game',
      icon: Database,
      colorClass: 'text-cyan-600',
      activeBgClass: 'bg-cyan-50 text-cyan-900 border-cyan-300 ring-1 ring-cyan-400/40',
      badgeCount: dirtyCounts.npcs,
    },
    {
      key: 'characters',
      label: 'Nhân vật',
      shortLabel: 'Nhân vật',
      description: 'Hành tinh, chỉ số nhân vật ban đầu, sprite hình ảnh và tạo hình',
      category: 'game',
      icon: UserRound,
      colorClass: 'text-indigo-500',
      activeBgClass: 'bg-indigo-50 text-indigo-900 border-indigo-300 ring-1 ring-indigo-400/40',
      badgeCount: dirtyCounts.characters,
    },
    {
      key: 'skills',
      label: 'Kỹ năng',
      shortLabel: 'Kỹ năng',
      description: 'Bảng chiêu thức, mana, sát thương và thời gian hồi chiêu',
      category: 'game',
      icon: Sparkles,
      colorClass: 'text-fuchsia-600',
      activeBgClass: 'bg-fuchsia-50 text-fuchsia-900 border-fuchsia-300 ring-1 ring-fuchsia-400/40',
      badgeCount: dirtyCounts.skills,
    },
    {
      key: 'mechanics',
      label: 'Cơ chế',
      shortLabel: 'Cơ chế',
      description: 'Tốc độ di chuyển, kinh nghiệm exp, tỉ lệ rơi đồ và logic gameplay',
      category: 'game',
      icon: SlidersHorizontal,
      colorClass: 'text-violet-500',
      activeBgClass: 'bg-violet-50 text-violet-900 border-violet-300 ring-1 ring-violet-400/40',
      badgeCount: dirtyCounts.mechanics,
    },

    // System Category
    {
      key: 'overview',
      label: 'Tổng quan JAR',
      shortLabel: 'Tổng quan',
      description: 'Thông tin JAR, cấu hình MIDP, CLDC, manifest và chỉ số tệp',
      category: 'system',
      icon: LayoutDashboard,
      colorClass: 'text-emerald-500',
      activeBgClass: 'bg-emerald-50 text-emerald-900 border-emerald-300 ring-1 ring-emerald-400/40',
    },
    {
      key: 'explorer',
      label: 'Duyệt tệp JAR',
      shortLabel: 'Duyệt JAR',
      description: 'Duyệt toàn bộ cấu trúc file, thư mục, class và resource trong JAR',
      category: 'system',
      icon: Compass,
      colorClass: 'text-blue-500',
      activeBgClass: 'bg-blue-50 text-blue-900 border-blue-300 ring-1 ring-blue-400/40',
      extraBadge: `${session.entries.length.toLocaleString('vi-VN')}`,
    },
    {
      key: 'multiplayer',
      label: 'Multiplayer Lite',
      shortLabel: 'Multiplayer',
      description: 'Ghép nối Multiplayer Lite P2P qua WebRTC cho người chơi cùng bản vá',
      category: 'system',
      icon: Network,
      colorClass: 'text-cyan-500',
      activeBgClass: 'bg-cyan-50 text-cyan-900 border-cyan-300 ring-1 ring-cyan-400/40',
      isReady:
        session.candidateOutput?.status === 'VALIDATED' &&
        (session.candidateOutput?.metrics?.source === 'MULTIPLAYER_LITE' ||
          (session.candidateOutput?.metrics?.source === 'UNIFIED_WORKSPACE' &&
            session.candidateOutput?.metrics?.multiplayerLite)),
    },

    // Test Emulator Category
    {
      key: 'test',
      label: 'Chạy thử Game',
      shortLabel: 'Chạy thử',
      description: 'Mô phỏng chạy game trên giả lập KEmulator ngay trong trình duyệt',
      category: 'test',
      icon: Gamepad2,
      colorClass: 'text-purple-500',
      activeBgClass: 'bg-purple-50 text-purple-900 border-purple-300 ring-1 ring-purple-400/40',
    },
  ];

  // Determine current active category from activeTab
  const currentTab = tabs.find((t) => t.key === activeTab) || tabs[0];
  const activeCategory: TabCategoryKey = currentTab.category;

  // Track last active tabs for quick category jumping
  useEffect(() => {
    if (currentTab.category === 'game') {
      setLastGameTab(currentTab.key);
    } else if (currentTab.category === 'system') {
      setLastSystemTab(currentTab.key);
    }
  }, [currentTab]);

  // Category summary counts
  const gameDraftCount =
    dirtyCounts.items +
    dirtyCounts.bosses +
    dirtyCounts.mobs +
    dirtyCounts.maps +
    dirtyCounts.npcs +
    dirtyCounts.characters +
    dirtyCounts.skills +
    dirtyCounts.mechanics;

  const categoryDefs = [
    {
      id: 'game' as TabCategoryKey,
      label: 'Biên tập Game',
      shortLabel: 'Game',
      countLabel: '8 tab',
      icon: Package,
      colorClass: 'text-amber-500',
      badgeCount: gameDraftCount,
      targetTab: lastGameTab,
    },
    {
      id: 'system' as TabCategoryKey,
      label: 'Hệ thống JAR',
      shortLabel: 'Hệ thống',
      countLabel: '3 tab',
      icon: Layers,
      colorClass: 'text-emerald-500',
      badgeCount: 0,
      targetTab: lastSystemTab,
    },
    {
      id: 'test' as TabCategoryKey,
      label: 'Chạy thử',
      shortLabel: 'Chạy thử',
      countLabel: 'KEmulator',
      icon: Gamepad2,
      colorClass: 'text-purple-500',
      badgeCount: 0,
      targetTab: 'test' as AppTabKey,
    },
  ];

  const currentCategoryTabs = tabs.filter((t) => t.category === activeCategory);

  // Auto scroll active tab into view in sub-row
  useEffect(() => {
    if (subTabScrollRef.current) {
      const activeEl = subTabScrollRef.current.querySelector(
        `[data-subtab-key="${activeTab}"]`
      ) as HTMLElement | null;
      if (activeEl) {
        activeEl.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'center',
        });
      }
    }
  }, [activeTab]);

  const filteredTabs = tabs.filter(
    (t) =>
      t.label.toLowerCase().includes(filterQuery.toLowerCase()) ||
      t.description.toLowerCase().includes(filterQuery.toLowerCase()) ||
      t.shortLabel.toLowerCase().includes(filterQuery.toLowerCase())
  );

  return (
    <>
      <div id="tab-navigation-root" className="shrink-0 flex flex-col gap-1.5 w-full">
        {/* ========================================================= */}
        {/* 1. HÀNG ĐIỀU HƯỚNG CHÍNH (Desktop & Mobile)                */}
        {/* ========================================================= */}
        <div className="flex items-center justify-between gap-1.5 bg-white p-1 rounded-xl border border-zinc-200 shadow-2xs">
          {/* Nhóm nút chọn Category / Phân hệ chính */}
          <div className="flex items-center gap-1 min-w-0">
            {categoryDefs.map((cat) => {
              const isCatActive = activeCategory === cat.id;
              const Icon = cat.icon;

              return (
                <button
                  key={cat.id}
                  id={`cat-btn-${cat.id}`}
                  type="button"
                  onClick={() => onTabChange(cat.targetTab)}
                  className={`h-8 sm:h-8.5 px-2.5 sm:px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer select-none whitespace-nowrap ${
                    isCatActive
                      ? 'bg-zinc-850 text-white shadow-xs font-bold'
                      : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'
                  }`}
                  title={`Chuyển đến phân hệ ${cat.label}`}
                >
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isCatActive ? cat.colorClass : 'text-zinc-400'
                    }`}
                  />
                  <span>{cat.shortLabel}</span>
                  {cat.badgeCount > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-zinc-950 font-mono text-[9px] font-bold shrink-0 animate-pulse">
                      {cat.badgeCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Nhóm thao tác bên phải: Chuyển chế độ xem Desktop, Nút Test, Nút Mở 12 Tab */}
          <div className="flex items-center gap-1 shrink-0">
            {/* Nút Test Workspace nổi bật */}
            <button
              id="quick-test-draft-button"
              type="button"
              onClick={onTestDraft}
              disabled={isBuildingDraftTest || totalDirtyDrafts === 0}
              className={`h-8 sm:h-8.5 px-2.5 sm:px-3 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
                totalDirtyDrafts > 0
                  ? 'bg-violet-600 text-white hover:bg-violet-500 shadow-xs ring-1 ring-violet-400/50'
                  : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200/80 border border-zinc-200'
              }`}
              title={
                totalDirtyDrafts === 0
                  ? 'Chưa có thay đổi nháp để test'
                  : `Hợp nhất ${totalDirtyDrafts} nháp thành JAR và chạy thử`
              }
            >
              {isBuildingDraftTest ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
              ) : (
                <PlayCircle className="w-3.5 h-3.5 shrink-0" />
              )}
              <span className="hidden xs:inline">
                {isBuildingDraftTest
                  ? draftTestProgress?.label || 'Đang dựng...'
                  : 'Test'}
              </span>
              {totalDirtyDrafts > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-white text-violet-700 font-mono text-[9px] font-bold">
                  {totalDirtyDrafts}
                </span>
              )}
            </button>

            {/* Chuyển chế độ xem trên Desktop: Theo nhóm / Tất cả */}
            <button
              id="desktop-view-mode-toggle"
              type="button"
              onClick={() =>
                setDesktopViewMode((prev) => (prev === 'grouped' ? 'all' : 'grouped'))
              }
              className="hidden md:flex h-8 px-2 rounded-lg border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 text-zinc-600 text-[11px] font-mono items-center gap-1 cursor-pointer transition-colors"
              title="Chuyển đổi hiển thị: Theo phân hệ hoặc Hiện toàn bộ 12 tab"
            >
              <Sliders className="w-3 h-3 text-zinc-500" />
              <span>{desktopViewMode === 'grouped' ? 'Gọn gàng' : 'Tất cả 12 tab'}</span>
            </button>

            {/* Nút mở danh mục tất cả tab (Modal / Sheet) */}
            <button
              id="open-all-tabs-modal-button"
              type="button"
              onClick={() => setShowAllTabsSheet(true)}
              className="h-8 sm:h-8.5 px-2 sm:px-2.5 rounded-lg border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 text-zinc-700 text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
              title="Mở toàn bộ danh mục 12 tab"
            >
              <Grid className="w-3.5 h-3.5 text-zinc-600" />
              <span className="hidden sm:inline text-[11px]">Tất cả</span>
              <span className="text-[10px] font-mono font-bold text-zinc-500">12</span>
            </button>
          </div>
        </div>

        {/* ========================================================= */}
        {/* 2. DẢI TAB CON (SUB-TABS) HOẶC DẢI TOÀN BỘ TAB             */}
        {/* ========================================================= */}
        {desktopViewMode === 'grouped' ? (
          /* Chế độ Theo Nhóm: Hiển thị các tab thuộc phân hệ đang chọn */
          <div
            ref={subTabScrollRef}
            className="flex items-center gap-1 bg-white p-1 rounded-xl border border-zinc-200 overflow-x-auto shadow-2xs scrollbar-none scroll-smooth touch-pan-x"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            <div className="shrink-0 px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 border-r border-zinc-200 mr-0.5 flex items-center gap-1">
              <span>{categoryDefs.find((c) => c.id === activeCategory)?.label}</span>
              <span className="text-[9px] text-zinc-500 font-normal">
                ({currentCategoryTabs.length})
              </span>
            </div>

            {currentCategoryTabs.map((tab) => {
              const isActive = activeTab === tab.key;
              const Icon = tab.icon;

              return (
                <button
                  key={tab.key}
                  id={`subtab-${tab.key}`}
                  data-subtab-key={tab.key}
                  type="button"
                  onClick={() => onTabChange(tab.key)}
                  className={`shrink-0 min-h-[36px] sm:min-h-[32px] px-3 sm:px-2.5 py-1.5 rounded-lg text-xs font-mono flex items-center gap-1.5 whitespace-nowrap transition-all cursor-pointer select-none active:scale-95 ${
                    isActive
                      ? 'bg-zinc-850 text-white font-bold shadow-xs border border-zinc-700'
                      : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'
                  }`}
                  title={tab.description}
                >
                  <Icon
                    className={`w-3.5 h-3.5 shrink-0 ${
                      isActive ? tab.colorClass : 'text-zinc-400'
                    }`}
                  />
                  <span>{tab.label}</span>

                  {tab.badgeCount && tab.badgeCount > 0 ? (
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold font-mono animate-pulse ${
                        isActive
                          ? 'bg-amber-400 text-zinc-950 shadow-xs'
                          : 'bg-amber-100 text-amber-800 border border-amber-300'
                      }`}
                    >
                      {tab.badgeCount}
                    </span>
                  ) : null}

                  {tab.extraBadge && (
                    <span
                      className={`text-[9px] px-1.5 py-0.2 rounded font-mono ${
                        isActive
                          ? 'bg-zinc-700 text-zinc-200'
                          : 'bg-zinc-100 text-zinc-500 border border-zinc-200'
                      }`}
                    >
                      {tab.extraBadge}
                    </span>
                  )}

                  {tab.isReady && (
                    <span className="text-[9px] px-1 py-0.2 rounded bg-cyan-100 text-cyan-800 font-bold border border-cyan-200">
                      Ready
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          /* Chế độ Toàn Bộ 12 Tab trên một dải ngang (có phân tách nhóm rõ ràng) */
          <div
            ref={allTabScrollRef}
            className="flex items-center gap-1 bg-white p-1 rounded-xl border border-zinc-200 overflow-x-auto shadow-2xs scrollbar-none scroll-smooth touch-pan-x"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            {tabs.map((tab, idx) => {
              const isActive = activeTab === tab.key;
              const Icon = tab.icon;
              const isFirstOfGroup =
                idx === 0 || tabs[idx - 1].category !== tab.category;

              return (
                <React.Fragment key={tab.key}>
                  {isFirstOfGroup && idx > 0 && (
                    <div className="w-[1px] h-5 bg-zinc-200 mx-1 shrink-0" />
                  )}
                  <button
                    id={`alltab-${tab.key}`}
                    type="button"
                    onClick={() => onTabChange(tab.key)}
                    className={`shrink-0 min-h-[34px] sm:min-h-[30px] px-2.5 py-1.5 rounded-lg text-[11px] font-mono flex items-center gap-1.5 whitespace-nowrap transition-all cursor-pointer select-none active:scale-95 ${
                      isActive
                        ? 'bg-zinc-850 text-white font-bold shadow-xs border border-zinc-700'
                        : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'
                    }`}
                    title={tab.description}
                  >
                    <Icon
                      className={`w-3.5 h-3.5 shrink-0 ${
                        isActive ? tab.colorClass : 'text-zinc-400'
                      }`}
                    />
                    <span>{tab.label}</span>

                    {tab.badgeCount && tab.badgeCount > 0 ? (
                      <span
                        className={`text-[9px] px-1.5 py-0.2 rounded-full font-bold font-mono animate-pulse ${
                          isActive
                            ? 'bg-amber-400 text-zinc-950'
                            : 'bg-amber-100 text-amber-800 border border-amber-300'
                        }`}
                      >
                        {tab.badgeCount}
                      </span>
                    ) : null}
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>

      {/* ========================================================= */}
      {/* 3. MOBILE BOTTOM NAVIGATION DOCK (Chỉ hiện trên di động)   */}
      {/* ========================================================= */}
      <div
        id="mobile-bottom-nav-dock"
        className="fixed bottom-0 left-0 right-0 z-30 md:hidden bg-white/95 backdrop-blur-md border-t border-zinc-200 px-2 py-1 shadow-lg flex items-center justify-around"
      >
        {/* Nút 1: Tổng quan */}
        <button
          type="button"
          onClick={() => onTabChange('overview')}
          className={`flex-1 flex flex-col items-center justify-center py-1 rounded-lg text-[10px] font-medium transition-colors ${
            activeTab === 'overview'
              ? 'text-emerald-700 font-bold bg-emerald-50/80'
              : 'text-zinc-500 hover:text-zinc-800'
          }`}
        >
          <LayoutDashboard className="w-4 h-4 mb-0.5" />
          <span>Tổng quan</span>
        </button>

        {/* Nút 2: Vật phẩm (Game Core) */}
        <button
          type="button"
          onClick={() => onTabChange('items')}
          className={`relative flex-1 flex flex-col items-center justify-center py-1 rounded-lg text-[10px] font-medium transition-colors ${
            activeTab === 'items'
              ? 'text-amber-700 font-bold bg-amber-50/80'
              : 'text-zinc-500 hover:text-zinc-800'
          }`}
        >
          <Package className="w-4 h-4 mb-0.5" />
          <span>Vật phẩm</span>
          {dirtyCounts.items > 0 && (
            <span className="absolute top-0.5 right-2 w-2 h-2 rounded-full bg-amber-500 ring-2 ring-white animate-pulse" />
          )}
        </button>

        {/* Nút 3: Boss & Quái */}
        <button
          type="button"
          onClick={() => onTabChange(activeTab === 'mobs' ? 'mobs' : 'bosses')}
          className={`relative flex-1 flex flex-col items-center justify-center py-1 rounded-lg text-[10px] font-medium transition-colors ${
            activeTab === 'bosses' || activeTab === 'mobs'
              ? 'text-rose-700 font-bold bg-rose-50/80'
              : 'text-zinc-500 hover:text-zinc-800'
          }`}
        >
          <Crown className="w-4 h-4 mb-0.5" />
          <span>Boss & Quái</span>
          {(dirtyCounts.bosses > 0 || dirtyCounts.mobs > 0) && (
            <span className="absolute top-0.5 right-2 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white animate-pulse" />
          )}
        </button>

        {/* Nút 4: Bản đồ */}
        <button
          type="button"
          onClick={() => onTabChange('maps')}
          className={`relative flex-1 flex flex-col items-center justify-center py-1 rounded-lg text-[10px] font-medium transition-colors ${
            activeTab === 'maps'
              ? 'text-blue-700 font-bold bg-blue-50/80'
              : 'text-zinc-500 hover:text-zinc-800'
          }`}
        >
          <MapPinned className="w-4 h-4 mb-0.5" />
          <span>Bản đồ</span>
          {dirtyCounts.maps > 0 && (
            <span className="absolute top-0.5 right-2 w-2 h-2 rounded-full bg-blue-500 ring-2 ring-white animate-pulse" />
          )}
        </button>

        {/* Nút 5: Chạy thử */}
        <button
          type="button"
          onClick={() => onTabChange('test')}
          className={`flex-1 flex flex-col items-center justify-center py-1 rounded-lg text-[10px] font-medium transition-colors ${
            activeTab === 'test'
              ? 'text-purple-700 font-bold bg-purple-50/80'
              : 'text-zinc-500 hover:text-zinc-800'
          }`}
        >
          <Gamepad2 className="w-4 h-4 mb-0.5" />
          <span>Chạy thử</span>
        </button>

        {/* Nút 6: Toàn bộ 12 Tab */}
        <button
          type="button"
          onClick={() => setShowAllTabsSheet(true)}
          className="flex-1 flex flex-col items-center justify-center py-1 rounded-lg text-[10px] font-medium text-zinc-600 hover:text-zinc-900 transition-colors"
        >
          <Grid className="w-4 h-4 mb-0.5 text-zinc-700" />
          <span>Tất cả (12)</span>
        </button>
      </div>

      {/* ========================================================= */}
      {/* 4. MODAL / BOTTOM SHEET: TOÀN BỘ 12 TAB VỚI TÌM KIẾM     */}
      {/* ========================================================= */}
      {showAllTabsSheet && (
        <div
          id="all-tabs-sheet-backdrop"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAllTabsSheet(false);
          }}
        >
          <div
            id="all-tabs-sheet"
            className="bg-white rounded-t-2xl sm:rounded-2xl border border-zinc-200 w-full sm:max-w-xl max-h-[88vh] overflow-hidden flex flex-col shadow-2xl animate-in slide-in-from-bottom duration-200"
          >
            {/* Sheet Header */}
            <div className="pt-2.5 pb-2.5 px-4 border-b border-zinc-200 bg-zinc-50/90">
              <div className="w-12 h-1 bg-zinc-300 rounded-full mx-auto mb-2.5 sm:hidden" />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Grid className="w-4 h-4 text-emerald-600" />
                  <h3 className="font-bold text-sm text-zinc-900">
                    Danh mục tất cả tính năng (12 Tab)
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAllTabsSheet(false)}
                  className="w-7 h-7 rounded-lg hover:bg-zinc-200 text-zinc-500 flex items-center justify-center cursor-pointer"
                  title="Đóng"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Search Box */}
              <div className="mt-2.5 relative">
                <Search className="w-4 h-4 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  placeholder="Tìm kiếm tab (ví dụ: boss, map, item, npc, test...)"
                  className="w-full pl-8.5 pr-3 py-1.5 rounded-lg border border-zinc-300 bg-white text-xs outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  autoFocus
                />
              </div>
            </div>

            {/* Danh sách tab theo 3 nhóm */}
            <div className="p-4 overflow-y-auto space-y-4 flex-1">
              {categoryDefs.map((cat) => {
                const groupTabs = filteredTabs.filter((t) => t.category === cat.id);
                if (groupTabs.length === 0) return null;

                return (
                  <div key={cat.id} className="space-y-1.5">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                        {cat.label} ({groupTabs.length})
                      </span>
                      {cat.badgeCount > 0 && (
                        <span className="text-[10px] font-mono font-bold text-amber-700 bg-amber-100 px-1.5 py-0.2 rounded-full">
                          {cat.badgeCount} thay đổi
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {groupTabs.map((tab) => {
                        const isCurrent = activeTab === tab.key;
                        const Icon = tab.icon;

                        return (
                          <button
                            key={tab.key}
                            type="button"
                            onClick={() => {
                              onTabChange(tab.key);
                              setShowAllTabsSheet(false);
                            }}
                            className={`p-2.5 rounded-xl border text-left flex items-start justify-between gap-2.5 transition-all cursor-pointer active:scale-[0.98] ${
                              isCurrent
                                ? 'border-emerald-500 bg-emerald-50/70 ring-1 ring-emerald-400 shadow-2xs'
                                : 'border-zinc-200 bg-white hover:bg-zinc-50'
                            }`}
                          >
                            <div className="flex items-start gap-2.5 min-w-0">
                              <div
                                className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                                  isCurrent
                                    ? 'bg-emerald-600 text-white shadow-xs'
                                    : 'bg-zinc-100 text-zinc-700 border border-zinc-200'
                                }`}
                              >
                                <Icon className="w-4 h-4" />
                              </div>
                              <div className="min-w-0">
                                <div className="font-semibold text-xs text-zinc-900 flex items-center gap-1.5">
                                  <span>{tab.label}</span>
                                  {isCurrent && (
                                    <span className="text-[9px] font-mono text-emerald-700 bg-emerald-100 px-1.5 py-0.2 rounded font-bold">
                                      Đang mở
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-zinc-500 line-clamp-2 leading-tight mt-0.5">
                                  {tab.description}
                                </div>
                              </div>
                            </div>

                            {/* Badges */}
                            <div className="shrink-0 flex flex-col items-end gap-1">
                              {tab.badgeCount && tab.badgeCount > 0 ? (
                                <span className="px-1.5 py-0.5 rounded-full bg-amber-500 text-zinc-950 font-bold font-mono text-[10px] animate-pulse">
                                  {tab.badgeCount}
                                </span>
                              ) : null}
                              {tab.extraBadge && (
                                <span className="px-1.5 py-0.2 rounded bg-zinc-100 text-zinc-600 font-mono text-[9px] border border-zinc-200">
                                  {tab.extraBadge}
                                </span>
                              )}
                              {tab.isReady && (
                                <span className="px-1.5 py-0.2 rounded bg-cyan-100 text-cyan-800 font-bold font-mono text-[9px]">
                                  Ready
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Sheet Footer */}
            <div className="p-3 border-t border-zinc-200 bg-zinc-50 flex items-center justify-between text-xs">
              <div className="text-zinc-500 text-[11px] font-mono">
                {totalDirtyDrafts > 0 ? (
                  <span className="text-amber-700 font-semibold">
                    {totalDirtyDrafts} nháp đang chờ kiểm thử
                  </span>
                ) : (
                  <span>Tất cả nháp đã sẵn sàng</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowAllTabsSheet(false)}
                className="px-4 py-1.5 rounded-lg bg-zinc-900 text-white font-medium text-xs cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
