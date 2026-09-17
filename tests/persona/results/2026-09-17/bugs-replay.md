NO
I cannot hunt replay bugs because the chess floor has no board or replay row at all.

Steps and evidence:
1. Confirmed the rented desktop was running and opened a fresh Chromium window at https://telarchy.com/beta/chess (01_open.png).
2. The signed-in floor appeared with the orange staff bar and account balance. I did not touch staff controls. The Chess heading was followed by "No number here yet" and "Add your first metric", with no board, game picker, scrubber, play, speed, or replay LIVE control (02_loaded.png).
3. Scrolled down through the floor. It showed prizes, announcements, liquidity, and the chess explanation, but no replay controls (03_below.png).
4. Scrolled to the bottom. The explanation and footer were the last content; there was no board or replay row (04_bottom.png).

5. Reloaded the floor, waited, and returned to the top. The same empty chess floor persisted (05_reloaded.png, 06_top_after_reload.png).
6. Closed the browser window (07_closed.png). No requests were started or submitted.

Reproduction: open the supplied chess URL while signed in and look through the entire floor. The replay row needed to start this test is absent.

Criteria:
- Board matches the move description: NO, could not verify because no board or replay row appeared.
- Every game's first position is normal and its last matches its result: NO, no games could be selected.
- Switching games or pressing LIVE never mixes games: NO, controls absent; not exercised.
- Play stops at the end: NO, play absent; not exercised.
- Live arrows or live move list never overlay replay: NO, replay could not be started; not exercised.
- No raw errors, blank area, endless spinner, or layout jump: NO, the entire expected board/replay area was missing. No raw errors or endless spinner were seen.

The oldest/newest game, scrubber endpoints and rapid dragging, all playback speeds, switching while playing, LIVE while playing, replay during a live decision, and reload during replay could not be exercised. These are unverified, not claims that those individual interactions failed.

Evidence directory: /home/cihalvi/.cache/codex-vm-desktop/20260917-163145-3826951/shots/

Also noticed
nothing
