# GitHub streaming GIF experiment

Tests whether an open GitHub PR can display newly generated GIF frames without
editing its comment or refreshing the page.

The Python server sends one UTC clock frame per second in a single chunked GIF
response. Each connection begins at frame zero and lasts up to one hour. There
is no looping replay: every frame contains the server time when it was made.

Install `requirements.txt`, run `python server.py`, and expose port 8765 through
an HTTPS tunnel. Open `/` directly as a control, then embed `/clock.gif` in a PR
comment. Compare the clock with current UTC time and watch for buffering or
disconnects. Try a second browser and a background tab.

The test tunnel is temporary and depends on the host process staying alive.
This is a protocol experiment, not production hosting.

## Versioned clips

Run `python publish_clock.py --base-url https://YOUR-TUNNEL --updates 20 --interval 30`
with authenticated `gh` and the clock server running through an HTTPS tunnel.
It saves 30-second, non-looping clock clips locally outside Git, then edits the
existing PR comment to reference a unique hosted URL for each clip.
The test lasts ten minutes. The temporary host must stay online to serve clips.
Clock times are calculated in advance, not recordings of future execution state.
