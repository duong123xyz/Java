NRO Studio — Fresh JVM + Fresh RMS Test Fix
============================================

Replace ONLY these files in your current AI Studio project:

1) public/emulator/index.html
2) src/services/j2meSessionService.ts

Do NOT replace App.tsx with this ZIP. Keep the App.tsx / one-click test code you already have working.

What this fixes
---------------
A new CheerpJ/JVM tab is NOT a clean game install by itself.
CheerpJ's /files filesystem is backed by IndexedDB and persists across runner/JVM restarts.
FreeJ2ME stores each MIDlet under its appId and RMS under:

  <appId>/rms/*

For this JAR, appId comes from MIDlet-1 (DragonBoy).
Before every test launch this runner now:

- mounts the exact newest JAR bytes;
- logs the JAR SHA-256;
- resolves the FreeJ2ME appId using MIDletLoader itself;
- calls LauncherUtil.wipeAppData(appId);
- verifies <appId>/rms no longer exists;
- only then starts FreeJ2ME.main(...).

Result: each Test Latest Changes run starts without the previous RMS/login/game cache.
You should be sent back through the game's fresh login flow instead of reusing the old account session.

Query mode used by j2meSessionService:
  reset=rms   (default/recommended)

Optional manual modes:
  reset=none  preserve RMS
  reset=full  remove the entire FreeJ2ME app folder (config + app.jar + RMS)

After replacing
---------------
1. Ctrl+Shift+R the AI Studio preview.
2. Edit an item.
3. Test Latest Changes / Build + Test.
4. In Runtime Console verify lines similar to:

   [handoff] ... SHA-256=...
   [fresh-data] Resolved FreeJ2ME appId: DragonBoy
   [fresh-data] RMS RESET complete: DragonBoy/rms removed.
   [fresh-data] Verify DragonBoy/rms exists after reset: NO

5. The game should start without the previous RMS login/save state.
