import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  Network,
  Play,
  Radio,
  RefreshCw,
  Server,
  Users,
  Wifi,
  XCircle,
} from 'lucide-react';
import { CandidateOutputJar, LoadedJarSession } from '../../types/jar';
import {
  auditMultiplayerCompatibility,
  MultiplayerCompatibilityAudit,
  MultiplayerLiteConfig,
} from '../../services/multiplayerPatchService';
import { setMultiplayerWorkspaceOperation } from '../../services/patchWorkspaceStateService';
import { buildUnifiedWorkspaceCandidate } from '../../services/unifiedCandidateService';

interface MultiplayerPanelProps {
  session: LoadedJarSession;
  onCandidateBuilt?: (candidate: CandidateOutputJar) => void;
  onWorkspaceUpdated?: () => void;
}

interface ServerPlayer {
  id: number;
  name: string;
  map: number;
  x: number;
  y: number;
  dir: number;
  lastSeen: number;
}

interface ServerStatus {
  ok: boolean;
  protocol: number;
  tcpHost: string;
  tcpPort: number;
  httpPort: number;
  online: number;
  players: ServerPlayer[];
}

const STORAGE_KEY = 'nro-multiplayer-lite-config-v1';

const DEFAULT_CONFIG: MultiplayerLiteConfig = {
  enabled: true,
  host: '127.0.0.1',
  port: 14445,
  name: '',
};

function loadStoredConfig(): MultiplayerLiteConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw);
    return {
      enabled: parsed.enabled !== false,
      host: String(parsed.host || DEFAULT_CONFIG.host),
      port: Number(parsed.port || DEFAULT_CONFIG.port),
      name: String(parsed.name || ''),
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function MultiplayerPanel({
  session,
  onCandidateBuilt,
  onWorkspaceUpdated,
}: MultiplayerPanelProps) {
  const [config, setConfig] = useState<MultiplayerLiteConfig>(() => loadStoredConfig());
  const [adminPort, setAdminPort] = useState(14446);
  const [audit, setAudit] = useState<MultiplayerCompatibilityAudit | null>(null);
  const [auditLoading, setAuditLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<CandidateOutputJar | null>(null);
  const [checkingServer, setCheckingServer] = useState(false);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setAuditLoading(true);
    setAudit(null);

    auditMultiplayerCompatibility(session)
      .then((result) => {
        if (active) setAudit(result);
      })
      .catch((error) => {
        if (active) {
          setAudit({
            compatible: false,
            hookCount: 0,
            checks: [
              {
                label: 'Audit',
                ok: false,
                detail: error instanceof Error ? error.message : String(error),
              },
            ],
          });
        }
      })
      .finally(() => {
        if (active) setAuditLoading(false);
      });

    return () => {
      active = false;
    };
  }, [session]);

  useEffect(() => {
    if (!serverStatus?.ok) return;

    const timer = window.setInterval(() => {
      void checkServer(false);
    }, 2500);

    return () => window.clearInterval(timer);
  }, [serverStatus?.ok, config.host, adminPort]);

  const isLocalhost = useMemo(
    () =>
      config.host === '127.0.0.1' ||
      config.host === 'localhost' ||
      config.host === '::1',
    [config.host]
  );

  const saveConfig = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  };

  const checkServer = async (showSpinner = true) => {
    if (showSpinner) setCheckingServer(true);
    setServerError(null);

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 4000);

    try {
      const url = `http://${config.host}:${adminPort}/status`;
      const response = await fetch(url, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const status = (await response.json()) as ServerStatus;
      if (!status?.ok) throw new Error('Server trả status không hợp lệ.');
      setServerStatus(status);
    } catch (error) {
      setServerStatus(null);
      setServerError(
        error instanceof Error
          ? error.name === 'AbortError'
            ? 'Timeout 4 giây. Kiểm tra server/firewall/IP.'
            : error.message
          : String(error)
      );
    } finally {
      window.clearTimeout(timer);
      if (showSpinner) setCheckingServer(false);
    }
  };

  const build = async () => {
    setBuildError(null);
    setBuilding(true);

    try {
      saveConfig();
      setMultiplayerWorkspaceOperation(session, config);
      onWorkspaceUpdated?.();

      const result = await buildUnifiedWorkspaceCandidate(session);
      if (result.status !== 'VALIDATED' || !result.candidate) {
        const detail = result.blockers.length
          ? result.blockers.map((blocker) => `${blocker.area}: ${blocker.message}`).join('\n')
          : result.errorMessage || `Unified Workspace trả trạng thái ${result.status}.`;
        throw new Error(detail);
      }

      session.candidateOutput = result.candidate;
      setCandidate(result.candidate);
      onCandidateBuilt?.(result.candidate);
    } catch (error) {
      setBuildError(error instanceof Error ? error.message : String(error));
    } finally {
      setBuilding(false);
    }
  };

  const downloadCandidate = () => {
    if (!candidate) return;
    const url = URL.createObjectURL(candidate.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = candidate.fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="h-full min-h-0 overflow-auto space-y-3">
      <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm p-4 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-2xl bg-cyan-50 border border-cyan-200 flex items-center justify-center shrink-0">
            <Network className="w-5 h-5 text-cyan-600" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-bold text-zinc-900">Multiplayer Lite</h2>
              <Chip>Phase 1</Chip>
              <Chip>TCP</Chip>
              <Chip>2–10 người</Chip>
            </div>
            <div className="mt-1 text-[11px] text-zinc-500 leading-relaxed max-w-3xl">
              Thêm một <strong>side-channel multiplayer</strong> vào JAR offline hiện tại:
              đồng bộ map, X/Y, hướng và tên. Remote player phase này được vẽ bằng placeholder đơn giản,
              chưa phải sprite/skill/combat thật.
            </div>
          </div>
        </div>

        <div className={`shrink-0 px-2.5 py-1.5 rounded-xl border text-[10px] font-mono flex items-center gap-1.5 ${
          audit?.compatible
            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
            : 'bg-amber-50 border-amber-200 text-amber-700'
        }`}>
          {auditLoading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : audit?.compatible ? (
            <CheckCircle2 className="w-3.5 h-3.5" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5" />
          )}
          {auditLoading ? 'Đang audit...' : audit?.compatible ? 'JAR tương thích' : 'Cần kiểm tra'}
        </div>
      </div>

      <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_420px] gap-3">
        <div className="space-y-3">
          <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-200 bg-zinc-50 flex items-center gap-2">
              <Server className="w-4 h-4 text-cyan-600" />
              <div>
                <div className="text-sm font-bold text-zinc-900">Kết nối mini server</div>
                <div className="text-[10px] text-zinc-500">TCP game mặc định 14445 · HTTP status mặc định 14446</div>
              </div>
            </div>

            <div className="p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_140px_140px] gap-3">
                <Field label="Host / IP server">
                  <input
                    value={config.host}
                    onChange={(event) => setConfig((current) => ({ ...current, host: event.target.value.trim() }))}
                    placeholder="192.168.1.10"
                    className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-zinc-50 text-[12px] font-mono focus:outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                  />
                </Field>
                <Field label="TCP port">
                  <input
                    type="number"
                    value={config.port}
                    onChange={(event) => setConfig((current) => ({ ...current, port: Number(event.target.value) }))}
                    className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-zinc-50 text-[12px] font-mono focus:outline-none focus:border-cyan-300"
                  />
                </Field>
                <Field label="HTTP status port">
                  <input
                    type="number"
                    value={adminPort}
                    onChange={(event) => setAdminPort(Number(event.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-zinc-50 text-[12px] font-mono focus:outline-none focus:border-cyan-300"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_160px] gap-3">
                <Field label="Tên hiển thị (để trống = tên nhân vật)">
                  <input
                    value={config.name}
                    onChange={(event) => setConfig((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Ví dụ: Richard"
                    maxLength={40}
                    className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-zinc-50 text-[12px] focus:outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                  />
                </Field>
                <Field label="Multiplayer">
                  <button
                    type="button"
                    onClick={() => setConfig((current) => ({ ...current, enabled: !current.enabled }))}
                    className={`w-full px-3 py-2 rounded-xl border text-[11px] font-semibold cursor-pointer ${
                      config.enabled
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                        : 'bg-zinc-50 border-zinc-200 text-zinc-500'
                    }`}
                  >
                    {config.enabled ? 'Đang bật' : 'Đang tắt'}
                  </button>
                </Field>
              </div>

              {isLocalhost && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-[11px] text-blue-700 leading-relaxed">
                  <strong>127.0.0.1 chỉ dùng khi server và game chạy cùng một máy.</strong>{' '}
                  Để bạn bè cùng Wi-Fi chơi, đổi Host thành IP LAN máy chạy server, ví dụ <code>192.168.1.10</code>.
                </div>
              )}

              {location.protocol === 'https:' && !isLocalhost && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] text-amber-700">
                  Web hiện tại là HTTPS nên browser có thể chặn nút <strong>Test server</strong> tới HTTP LAN.
                  Điều này không có nghĩa TCP trong JAR bị chặn; có thể kiểm tra status trực tiếp trên máy host.
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={saveConfig}
                  className="px-3 py-2 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-[11px] font-medium cursor-pointer"
                >
                  Lưu cấu hình
                </button>
                <button
                  type="button"
                  onClick={() => void checkServer(true)}
                  disabled={checkingServer}
                  className="px-3 py-2 rounded-xl border border-cyan-200 bg-cyan-50 hover:bg-cyan-100 text-cyan-700 text-[11px] font-semibold flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {checkingServer ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Radio className="w-3.5 h-3.5" />}
                  Test server
                </button>
              </div>

              {serverError && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-[10px] text-red-700 font-mono">
                  <XCircle className="w-3.5 h-3.5 inline mr-1.5 align-[-2px]" />
                  {serverError}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-200 bg-zinc-50 flex items-center gap-2">
              <Wifi className="w-4 h-4 text-violet-600" />
              <div>
                <div className="text-sm font-bold text-zinc-900">Build JAR hợp nhất + Multiplayer</div>
                <div className="text-[10px] text-zinc-500">
                  Multiplayer được ghi thành operation và áp cuối cùng lên JAR đã chứa Item / nháp / Cơ chế hiện tại.
                </div>
              </div>
            </div>

            <div className="p-4 space-y-3">
              <button
                type="button"
                onClick={() => void build()}
                disabled={building || !audit?.compatible}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-[12px] font-bold flex items-center justify-center gap-2 cursor-pointer"
              >
                {building ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
                {building ? 'Đang hợp nhất & verify...' : 'Đưa Multiplayer vào Workspace & chạy thử'}
              </button>

              {buildError && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-[10px] text-red-700 font-mono whitespace-pre-wrap">
                  {buildError}
                </div>
              )}

              {candidate && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-bold text-emerald-800">VALIDATED</div>
                    <div className="text-[10px] text-emerald-700 font-mono mt-0.5">{candidate.fileName}</div>
                  </div>
                  <button
                    type="button"
                    onClick={downloadCandidate}
                    className="px-3 py-2 rounded-xl bg-white border border-emerald-200 text-emerald-700 text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Tải JAR
                  </button>
                </div>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-200 bg-zinc-50 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <div className="text-sm font-bold text-zinc-900">Phạm vi Phase 1</div>
            </div>
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
              <Feature ok text="TCP side-channel riêng" />
              <Feature ok text="Đồng bộ map" />
              <Feature ok text="Đồng bộ X / Y / hướng" />
              <Feature ok text="Tên người chơi" />
              <Feature ok text="Placeholder người chơi khác" />
              <Feature ok text="Chat bubble từ admin HTTP" />
              <Feature text="Sprite head/body/leg thật" />
              <Feature text="Skill / damage realtime" />
              <Feature text="Mob / boss / drop chung" />
            </div>
          </section>
        </div>

        <div className="space-y-3">
          <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-200 bg-zinc-50 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-cyan-600" />
                <div>
                  <div className="text-sm font-bold text-zinc-900">Người chơi online</div>
                  <div className="text-[10px] text-zinc-500">Đọc từ mini server HTTP status</div>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-cyan-50 border border-cyan-200 text-cyan-700 text-[10px] font-mono">
                {serverStatus?.online ?? 0}
              </span>
            </div>

            <div className="p-3">
              {!serverStatus ? (
                <div className="py-8 text-center text-[11px] text-zinc-500">
                  Bấm <strong>Test server</strong> để xem player online.
                </div>
              ) : serverStatus.players.length === 0 ? (
                <div className="py-8 text-center text-[11px] text-zinc-500">
                  Server online nhưng chưa có JAR multiplayer nào kết nối.
                </div>
              ) : (
                <div className="space-y-2">
                  {serverStatus.players.map((player) => (
                    <div key={player.id} className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[12px] font-semibold text-zinc-900 truncate">
                          #{player.id} · {player.name}
                        </div>
                        <span className="text-[9px] font-mono text-emerald-600">online</span>
                      </div>
                      <div className="mt-1 text-[10px] text-zinc-500 font-mono">
                        map {player.map} · X {player.x} · Y {player.y} · dir {player.dir}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-200 bg-zinc-50 flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-zinc-500" />
              <div className="text-sm font-bold text-zinc-900">Compatibility audit</div>
            </div>
            <div className="p-3 space-y-1.5">
              {auditLoading ? (
                <div className="py-8 flex items-center justify-center gap-2 text-[11px] text-zinc-500">
                  <Loader2 className="w-4 h-4 animate-spin" /> Đang đọc class...
                </div>
              ) : (
                audit?.checks.map((check) => (
                  <div
                    key={check.label}
                    className={`rounded-xl border p-2.5 ${
                      check.ok
                        ? 'border-emerald-200 bg-emerald-50'
                        : 'border-red-200 bg-red-50'
                    }`}
                  >
                    <div className={`text-[10px] font-bold flex items-center gap-1.5 ${
                      check.ok ? 'text-emerald-700' : 'text-red-700'
                    }`}>
                      {check.ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                      {check.label}
                    </div>
                    <div className="text-[9px] text-zinc-600 font-mono mt-1">{check.detail}</div>
                  </div>
                ))
              )}
            </div>
          </section>

          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-[10px] text-amber-800 leading-relaxed">
            <AlertTriangle className="w-3.5 h-3.5 inline mr-1.5 align-[-2px]" />
            Đây là prototype network đầu tiên. Server hiện <strong>không authoritative combat</strong>.
            Đừng dùng phase này để quyết định damage/drop/PvP; mục tiêu là xác minh 2–10 client có nhìn thấy nhau và đổi map cùng nhau.
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] text-zinc-500 font-mono mb-1">{label}</div>
      {children}
    </label>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-2 py-0.5 rounded-full bg-zinc-50 border border-zinc-200 text-[10px] text-zinc-600 font-mono">
      {children}
    </span>
  );
}

function Feature({ ok = false, text }: { ok?: boolean; text: string }) {
  return (
    <div className={`rounded-xl border p-2.5 flex items-center gap-2 ${
      ok ? 'border-emerald-200 bg-emerald-50' : 'border-zinc-200 bg-zinc-50'
    }`}>
      {ok ? (
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
      ) : (
        <XCircle className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
      )}
      <span className={`text-[10px] ${ok ? 'text-emerald-700' : 'text-zinc-500'}`}>{text}</span>
    </div>
  );
}
