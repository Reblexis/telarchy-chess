NO
Opening a move trapped me on its page: neither repeated Alt+Left nor the browser Back button returned me to the chess floor.

## Steps and evidence

Screenshots are in `/home/cihalvi/.cache/codex-vm-desktop/20260917-162654-3775968/shots/`.

1. Opened a fresh Chromium window at https://telarchy.com/beta/chess. The signed-in account and staff controls were visible (01_open.png). Left staff controls untouched.
2. Scrolled to the live board (02_board.png, 03_live.png), then reduced browser zoom twice to fit the board and countdown (04_fit.png).
3. Clicked the black knight on a4. Legal-target dots and 50.0 labels appeared inside the board (05_select.png).
4. Clicked the same knight again around the countdown rollover. The position changed and the list briefly displayed "open" (06_repeat_zero.png). Moved the pointer away; dots disappeared, prices returned, and the timer was running at 0:14 (07_after_rollover.png).
5. Hovered the fourth move-list row, Nc5, at 0:05. Its highlighted arrow pointed from a4 to c5 (08_row_hover.png).
6. Clicked that row. The move page opened at /chess/p/6957, showing Game 154, move 78 and Nc5 (09_move_open.png).
7. Pressed Alt+Left. The address became /beta/chess/p/6957 but the same move page remained (10_back.png).
8. Pressed Alt+Left again. Still on the move page, which had now settled (11_back_again.png).
9. Clicked the browser Back button directly. Still on /beta/chess/p/6957 (12_back_button.png). Expected to return to the live chess floor where I opened the move.

10. Returned to the floor by entering its address. Screenshot 13_return_floor.png records an unsubmitted typing mistake, corrected before navigation; 14_floor.png shows loading and 15_live_return.png shows the recovered live board.
11. Clicked the black rook on a5. Its dots and prices stayed within their target squares while the countdown read "Next move, deciding" (16_rook_select.png).
12. Reloaded with Ctrl+R. The board disappeared, leaving lower floor content (17_reload.png). Ctrl+Home showed "No number here yet" and "Add your first metric", plus a Game score settled-at-0 entry (18_reload_top.png). I did not press those controls.
13. Closed the browser window with Alt+F4. No half-filled request existed.

The verdict was already NO after step 9. I did not complete target clicks, arrow clicks, move-list scrolling, narrow-window testing, or keyboard activation of moves. The player record stayed internally consistent in the observed live views: 3 won + 125 lost + 25 drawn = 153 played, rating 696.

## Pass criteria

- Selection/tint/dot cleanup: yes in the limited sequence observed. Moving away after rollover removed the target dots. Did not establish every selection state.
- Arrows/dots/prices stay on correct squares: yes in the observed previews. No off-board marks seen.
- Move list and arrows agree on the leader: yes in the observed tied-price list; the leading Nb2 arrow and row agreed. Nc5 hover preview agreed with its target.
- Countdown: yes in the sampled observations; saw 0:18, 0:08, a new interval, and 0:05. Did not continuously observe zero or rule out all timing faults.
- Back and reload return to a sane current page: no. Back failed repeatedly as reproduced above. Reload also failed to show a current position: after reloading with a rook selected, the board disappeared and the floor said "No number here yet. The market starts the moment you add one." (17_reload.png, 18_reload_top.png). A settled-at-0 entry was visible; I cannot establish whether the game ended during reload.
- No raw errors, blank areas, endless spinner or layout jumps: no. Reload removed the entire live view and left me scrolled into lower floor content (17_reload.png); Ctrl+Home exposed a setup prompt instead of the board (18_reload_top.png). No raw error or endless spinner seen.

## Also noticed

Nothing outside the tested area confirmed as a bug. No bets placed and no forms submitted.
