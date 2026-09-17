# Proposed changes from the 2026-09-17 persona run

**Approved by Viktor 2026-09-17** ("ok go ahead regarding 12 do a"): everything
below is to be built except 12, which stays as it is (option a). Status is at
the end. When this was written nothing was built. Ordered by how much each one costs a real
user, highest first. "Doc" names the governing doc whose sentence would
change or already says it (telarchy-app `docs/ui-conventions.md` unless
noted). Source reports are the files beside this one.

## A. Broken, fix first

1. **Between games the floor must still be a chess floor.** Right after a game
   settles, `/chess` shows "No number here yet / Add your first metric" with no
   board and no replay; a reload during the last move does the same
   (bugs-replay, bugs-live-board step 12; screenshot checked). Doc: add one
   sentence to the chess feed section: while no book is open the floor draws
   the last position with "Waiting for the next game" and the replay row, never
   the empty-workspace state. Seen as the owner; check what a visitor gets.
2. **Back from a move page returns to the floor.** Opening a move from the
   list, then Back three times, stays on `/chess/p/N` (bugs-live-board steps
   6 to 9). Likely the floor's auto-reload on a new proposal pushing history
   entries. Doc: "opening an option's world is one history entry; Back returns
   to where it was opened from".
3. **A decided move's page shows its own position, or says it has moved on.**
   `/p/6992` kept the heading "If the move Na7 is made" over the board, list
   and countdown of the next move (trader-sees-a-bet). The spec already says a
   decided proposal marks nothing on the board; add that its page labels the
   board "now: move 32" or draws the ply it belonged to.
4. **The floor links to "How to trade with a bot", and that page names the feed
   URL.** telarchy-chess `docs/chess.md` already says the floor links to
   `trading.md`. The bot author found only the generic agents guide and never
   the `/state` URL (bot-author). Conformance fix, no doc change.

## B. The visitor cannot tell what is going on

5. **Say who decides, at the top.** One line under the title, for example
   "TelarchyBot plays on Lichess. The move with the highest price is played."
   Today it is a paragraph far down and an "i" (visitor-understands).
6. **"Rookie approved ... choosing g4" reads as the bot picking.** Word the
   decision line as the market's: "The market chose g4 at 50.4"
   (visitor-understands). Doc: the wording rule at line 524 ("Chess configures
   'If the move...'") gets the decided form too.
7. **The next-move line names the side and the opponent always**, not only
   while waiting: "TelarchyBot (Black) moves in 0:27 · vs Randmaster_Bot (705)".
   A visitor could not tell who "I" is or which colour the bot plays
   (visitor-reads-the-next-move-line, visitor-understands).
8. **Mark both moves of a tick.** The opponent's reply and our move often land
   in one refresh and only the last one is tinted, so pieces appear to jump
   (visitor-reads). Tint the last two plies, the older one fainter.
9. **Label the record.** "Won 3, Lost 126" has no owner; head it "TelarchyBot
   on Lichess" (visitor-reads).
10. **Replay says it is a replay wherever you are on the page**, and "chosen
    at 50.0" carries its unit once (visitor-watches-a-replay): a sticky
    "Replay: Game 3, move 6" chip while not LIVE.

## C. The numbers mean nothing yet

11. **Give the price a unit on the floor.** "50.0" appears thirty times with no
    scale; the scale lives in a paragraph far down (player-connects, trader,
    replay). Put "expected score, 0 loss · 50 draw · 100 win" once beside the
    move list header.
12. **All-50.0 is the real problem and it is not a UI one.** Untraded option
    books all open at the main book's value by rule, so the list is a tie, the
    move is random, and the trader's 10 credits alone chose the bot's move.
    Options, for Viktor to pick, none assumed: (a) leave it, the house traders
    are meant to fill this; (b) show "untraded" instead of 50.0 so a tie reads
    as "no one has priced this yet"; (c) get a reference bot trading every
    move on beta so the floor is never flat. I would do (b) now and (c) next.

## D. Betting inside a one-minute window

13. **The countdown belongs in the ticket.** Where the page puts you to bet
    there is no clock; two moves closed under the trader before they knew a
    timer existed (trader-understands). Show "closes in 0:31" on the ticket and
    "decides 17 Sep 16:58:23", not a bare date.
14. **Show what I hold.** After a bet nothing anywhere says "you hold 10 cr
    Higher on Na7", and after the decision nothing says what became of it
    (trader-sees-a-bet). A "Your position" line on the ticket and on the move's
    row; after the decision "kept, settles when the game ends" or "void,
    10 cr refunded".
15. **Do not re-arm the button with the amount filled in.** Three seconds after
    "Placed" the same bet is one click away again; clear the amount or hold the
    confirmation until the pointer leaves.
16. **The balance went up after a bet** (735.4k to 735.5k). Probably rounding of
    two different reads; check it, a balance must never rise on a spend.
17. **"How this decides" contradicts the page**: it says the chosen option keeps
    trading, the chosen page says "Trading closed" with no ticket. One of the
    two sentences is wrong; decide which and fix the other.

## E. Layout

18. **The board above the fold at 1024x768.** Board and countdown are cut off
    on arrival; the designer called the board "small and low" against the
    trading controls (design-floor-desktop, three other reports). Move the
    board up, the question and the 50.0 headline beside or under it.
19. **At about 600 px the record should be under the board.** The spec says
    below 660 px of live-view width the sections stack; at a 600 px window they
    did not (design-floor-narrow). Conformance; check whether the slot is wider
    than the window suggests.
20. **The Otto bubble covers content** at narrow widths and overlaps "Add your
    own trading bot" on arrival. Give the page bottom padding for it, or dock
    it to the header when narrow.
21. **Truncated labels on the move page** ("NA7 · LEA..."): let the strip wrap
    or drop the second label.
22. **Rank and file labels readable, and a "playing Black" tag**, since white at
    the top surprised two testers. The orientation itself is right and stays.
23. **Guide links open at the top.** The build guide opened mid-page; manual
    setup code blocks need sideways scrolling at 1024 px.

## F. The tests themselves

24. `player-makes-a-move-on-the-board` failed on "nothing showed which pieces
    could be picked up", but the tester never rested the pointer on a piece.
    Add to its Goal: "move the pointer over a few pieces first". Not a product
    change.
25. Run the visitor and designer tests signed out once the floor is on
    production; the staff controls were visible in every screenshot.

## Status, 2026-09-17 evening

Built on telarchy-app branch `chess-floor-persona-fixes`, docs and tests first,
2,184 frontend tests green, preview
`https://telarchy.com/beta?branch=br-chess-floor-persona-fixes`. Not merged.

- Done: 1 (floor between games), 2 (Back, plus chess links staying on /beta),
  3 (note under the board on a proposal that is not the open move), 4 (guide
  link under the bot door), 7 and 22 (who plays whom above the board, rank
  labels, bigger coordinates), 8 (both last moves tinted), 9 (record headed),
  10 (replay marker, "of 100"), 11 (scale heading on the move list), 13
  (ticket counts down), part of 15 (a lasting "You bought Higher for 10 cr."
  line; the amount is deliberately left filled in, repeat bettors on the
  snake rely on it), 24 (this suite's hover instruction).
- Left as is by decision: 12.
- Not built yet: 5 and 6 (who decides, "Rookie approved" wording), 14 (your
  position after a bet and after the decision), 16 (balance rose after a
  spend), 17 ("How this decides" contradicts the closed page), 18 to 21
  (board above the fold, 600 px stacking, Otto bubble, truncated labels), 23
  (guides open at the top), 25 (signed-out rerun, waits for production). The
  snake's arrow links have the same missing /beta prefix as chess had.
- Rerun after publish: `vmtest run $(vmtest failing chess) -c claude`.
