NO
The bet went in and the price jumped at once, but after that nothing on the screen ever showed me my position on Na7 or what became of my 10 credits once the move was chosen, and the only "holdings" text I found said I hold nothing.

## What I did

Shots are in `/home/cihalvi/.cache/codex-vm-desktop/20260917-165706-4094568/shots/`.

1. Opened https://telarchy.com/beta/chess in a fresh Chromium window. Already signed in (735k cr shown in the header). The floor shows "What score will I reach this game?", market's call 50.0, a list of candidate moves all at 50.0, a board, and a trade ticket on the right (01, 02).
2. Scrolled a little and found the countdown under the board: "Next move in 0:41" (03). It is below the fold at 1024x768, I did not see it on the first screen.
3. Clicked "Na7" in the move list. The page went to /beta/chess/p/6992, the ticket changed to "#6992 · Na7 · decides 17 Sep, Game 155, move 31", and the question read "If the move Na7 is made, what will Chess's final game score be?" (04).
4. Typed 10 in the ticket amount. It showed "10 cr → 50.3", a payout bar from "-10 cr" at 0.0 through "0 cr" at 50.2 to "+10 cr" at 100.0, and the button "Bet 10 cr on Higher" (05). That told me what I risk and what I can win.
5. Clicked "Bet 10 cr on Higher" once. One second later the button read "✓ Placed", Na7 jumped to first in the list at 50.4 (was 50.0), the strip above showed "NA7 · LEA... 50.4" and the headline "+0.35, Na7 over the next best" (06). About three seconds later the button was back to "Bet 10 cr on Higher", armed for a second bet (07).
6. Scrolled down: "Next move: Na7 in 0:07", pool 1,010, volume 10, and a live line "Viktor36 bought higher, 10 cr, 50.0 → 50.4" at 16:58 (08).
7. Waited for the deadline. The ticket was replaced by "Trading closed at the deadline. The ruling lands in a moment; this page updates on its own." and the line under the board read "Next move: Na7, deciding" (09). A few seconds later: "Trading closed. Decided: approved.", the board had moved on and a new countdown "Next move in 0:39" was running (10).
8. Back at the top of the same page: "CHOSE NA7 · #6992 Game 155, move 31 · chosen 16:58:23 · 1,010 behind it", Na7 at 50.4 marked chosen, every other move struck through with "void, stakes refunded" (11). The board and list lower on that page were already those of move 32 (12).
9. Looked for my position: scrolled the whole page (13, 14: "How this decides" text and a list of past proposals, move 31 shown as "NA7 +0.4, CHOSE NA7"), went "Back to the market" (16), opened the avatar menu (17: only "735k cr to trade, +440k cr earned", account settings, agents and keys), opened the bell (18: only week-old "A proposal was decided" items, none about this), and opened the Sell tab of the floor ticket (19: "You hold nothing on this market yet, so there is nothing to sell."). Placed no other bet.

## Criteria

- The page told you clearly that the bet went through and what it cost: **yes, barely.** "✓ Placed" on the button within a second (06), and the button I pressed said "Bet 10 cr". The confirmation is gone after about three seconds and never restates the cost; the only lasting record is the live line "Viktor36 bought higher, 10 cr, 50.0 → 50.4", which is below the fold (08). The balance in the header reads "735k cr" before and after, so a 10 cr bet is invisible there.
- The price of that move changed within a couple of seconds, without a reload: **yes.** Na7 went 50.0 → 50.4 in the list and in the strip within one second, and moved to the top of the list (06).
- Afterwards you could find your position on that move without hunting: **no.** I hunted and still did not find it. Nowhere did I see "you hold 10 cr Higher on Na7" or anything like it: not on the move's page, not in the list row, not on the board, not in the avatar menu, not in notifications. The live line shows the trade, not a position, and would scroll away with other traders. The one place that talks about holdings (Sell tab on the floor) says "You hold nothing on this market yet" (19), which after betting 10 cr a minute earlier reads like my bet is gone.
- When the move was decided you could tell what had happened to your bet: **no.** I could tell what happened to the move: Na7 chosen, the others void with stakes refunded (11). About my own bet the page said nothing. From the "How this decides" text far down the page ("the chosen one keeps trading until the number itself settles", 13) I can work out that my 10 cr is still riding until the game ends, but that is me deducing it, and the ticket on that page is gone ("Trading closed"), which contradicts "keeps trading" and leaves me no way to see or sell what I hold.

Two of four failed, so NO. I would not put points on the next move until I can see what I already hold.

## Also noticed

- After a bet the button re-arms to "Bet 10 cr on Higher" with the amount still filled in, about three seconds after "✓ Placed". With a one-minute window and an impatient hand that is an easy accidental double bet.
- The header balance is rounded to "735k cr", and the ticket's "735.4k cr, all you have" became "735.5k cr" after I spent 10 cr (05 vs 06). A balance that goes up after a bet, with no explanation, does not build trust.
- The countdown is below the board and off the first screen at 1024x768. I found it only by scrolling.
- Every move is priced 50.0 and the headline says "±0, tied at the top". With 25 options all at the same number there is no information to trade on; my 10 cr alone made Na7 the leader, and it was then the move played. Fun for me, but it means a 10 cr bet picks the bot's move.
- "Market's call 50.0" and the move prices have no unit on the floor. The scale (100 a win, 50 a draw, 0 a loss) is only in the small "What Rookie would do" paragraph far down the page.
- The decided move's page (/p/6992) shows the board, list and countdown of the next move under the old move's heading and question ("If the move Na7 is made...") (12). Confusing: the question and the board do not belong together.
- "How this decides" says the chosen option keeps trading until the number settles, but the chosen Na7 page says "Trading closed" and has no ticket.
- The move page says "decides 17 Sep" with no time, for a market that closes within a minute.
- Staff-only items ("Edit question wording", "Remove", "Choose/Decline") were visible because of the staff account; ignored for the verdict.
