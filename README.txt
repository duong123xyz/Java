NRO Studio - PATCHED SOURCE FIX (actual source replacement)
============================================================

This ZIP contains a real source file at the exact project path:

  src/components/emulator/TestGameTab.tsx

Replace/overwrite ONLY that file in your current project.
Do NOT replace your current j2meSessionService.ts or public/emulator/index.html,
because those contain the Fresh JVM/Fresh RMS fixes that are already working locally.

Why this fixes the current bug
------------------------------
The GitHub repo currently hard-codes TestGameTab to ORIGINAL:

  const [source] = useState<EmulatorSourceType>('ORIGINAL');

and loadActiveJar always calls:

  sess.loadJar(session.originalFile, ...)

while App.tsx correctly passes initialSource='PATCHED' from ChangesPanel.
So the patched candidate is built correctly but the Test Game screen ignores it.

This replacement:
- honors initialSource from App.tsx;
- loads session.candidateOutput.blob when source === PATCHED;
- NEVER silently falls back to original when PATCHED is requested;
- logs exact active source, candidate filename, byte length and SHA-256 prefix;
- keeps Original/Patched source buttons available;
- uses the existing DefaultJ2meTestSession, so your Fresh JVM/Fresh RMS runner remains untouched.

After replacing
---------------
1. Ctrl+Shift+R.
2. Edit an item.
3. Build Rewrite Preview.
4. Build Patched JAR until VALIDATED.
5. Click Test Patched JAR.
6. On Test Game, ACTIVE SOURCE must show PATCHED.
7. Click Run Patched JAR.
8. Runtime Console MUST contain:

   [Source: PATCHED] Loading EXACT candidate: <..._patched.jar> (... bytes, sha256:...)

If it says [Source: ORIGINAL], the replacement file is not active.
