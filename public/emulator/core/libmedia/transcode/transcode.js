// Optional transcoder assets are not bundled in this deployment.
// FreeJ2ME reaches this function from Java Player.prefetch() when a media format
// is not handled directly. Blocking here can freeze gameplay on the first SFX.
//
// Fail fast. MP3 still bypasses this function in libmedia.js.

let warned = false;

export async function transcode(_data) {
    if (!warned) {
        warned = true;
        console.warn(
            '[libmedia] Transcoder assets are unavailable; unsupported media ' +
            'is skipped so the game thread never blocks.'
        );
    }
    return null;
}
