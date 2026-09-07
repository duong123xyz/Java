import React, {FormEvent, useEffect, useState} from 'react';
import {Gamepad2, Loader2, LogOut, ShieldCheck} from 'lucide-react';
import {TestGameTab} from './components/emulator/TestGameTab';
import {loadAndAnalyzeJarSession} from './services/jarService';
import {LoadedJarSession} from './types/jar';

interface Account { id: number; username: string }

async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: {'Content-Type': 'application/json', ...(init?.headers || {})},
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Yêu cầu thất bại.');
  return body;
}

export function PlayerPortal() {
  const [account, setAccount] = useState<Account | null>(null);
  const [session, setSession] = useState<LoadedJarSession | null>(null);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/api/auth/me')
      .then((result) => setAccount(result.user))
      .catch(() => undefined)
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    if (!account) { setSession(null); return; }
    let cancelled = false;
    setBusy(true);
    fetch('/game/NgocRongChay-v1.5.5.jar')
      .then((response) => {
        if (!response.ok) throw new Error('Không tải được game mặc định.');
        return response.blob();
      })
      .then((blob) => new File(
        [blob],
        `NgocRongChay-v1.5.5-user-${account.id}.jar`,
        {type: 'application/java-archive'}
      ))
      .then(loadAndAnalyzeJarSession)
      .then((loaded) => { if (!cancelled) setSession(loaded); })
      .catch((reason) => { if (!cancelled) setError(String(reason?.message || reason)); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [account]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const result = await api(`/api/auth/${mode}`, {
        method: 'POST', body: JSON.stringify({username, password}),
      });
      setAccount(result.user); setPassword('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
  };

  if (!account) return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 grid place-items-center p-5">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-emerald-500/15 text-emerald-400"><Gamepad2 /></div>
          <div><h1 className="text-xl font-bold">Ngọc Rồng Web</h1><p className="text-sm text-zinc-400">Đăng nhập để chơi và giữ tiến trình.</p></div>
        </div>
        <div className="grid grid-cols-2 rounded-lg bg-zinc-950 p-1">
          {(['login', 'register'] as const).map((value) => <button key={value} type="button" onClick={() => setMode(value)} className={`rounded-md py-2 text-sm ${mode === value ? 'bg-emerald-600 font-bold' : 'text-zinc-400'}`}>{value === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}</button>)}
        </div>
        <input required minLength={3} maxLength={24} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Tên tài khoản" autoComplete="username" className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3" />
        <input required minLength={8} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mật khẩu (ít nhất 8 ký tự)" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3" />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button disabled={busy} className="w-full rounded-lg bg-emerald-600 py-3 font-bold disabled:opacity-50">{busy ? 'Đang xử lý...' : mode === 'login' ? 'Đăng nhập & chơi' : 'Tạo tài khoản & chơi'}</button>
        <p className="flex items-center gap-2 text-xs text-zinc-500"><ShieldCheck className="w-4 h-4" /> Mật khẩu được băm, không lưu dạng văn bản.</p>
      </form>
    </main>
  );

  return <main className="min-h-screen bg-zinc-100 text-zinc-900 p-3">
    <header className="mb-3 flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3">
      <div><strong>Ngọc Rồng Web</strong><span className="ml-3 text-sm text-zinc-500">Tài khoản: {account.username}</span></div>
      <button onClick={async () => { await api('/api/auth/logout', {method: 'POST'}); setAccount(null); }} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"><LogOut className="w-4 h-4" /> Đăng xuất</button>
    </header>
    {busy && <div className="grid min-h-[60vh] place-items-center"><Loader2 className="animate-spin" /></div>}
    {error && <div className="rounded-lg bg-red-50 p-4 text-red-700">{error}</div>}
    {session && <TestGameTab session={session} initialSource="ORIGINAL" resetMode="none" />}
  </main>;
}
