NO
The terms and the payout are all there and I ended up understanding them, but where the page drops me to bet there is no clock and no rules on screen, so two moves closed under me before I even knew a timer existed.

## What I did

1. Opened https://telarchy.com/beta/chess, already signed in (shot 01). Saw a board, a list of moves each priced 50.0, a headline "What score will I reach this game?", "Market's call, settles when the game ends, 50.0", and a ticket on the right for "Game score" (the whole game, not a move). No countdown anywhere on this screen.
2. Clicked the first move, b3 (shot 02). The page went to /p/6996 and landed scrolled part of the way down: I saw the move tiles, "If the move b3 is made, what will Chess's final game score be?", and on the right not a ticket but "Trading closed at the deadline. The ruling lands in a moment". I scrolled up (shot 03): "Game 155, move 35", "CHOSE NG8", every other move tile struck through with "void, stakes refunded". The move had closed the second I clicked it. Nothing had warned me.
3. "Back to the market" (shot 04), clicked c3 (shot 05). This time a ticket: "#6997, c3, decides 17 Sep, Game 155, move 36", Lower / Higher "up to 1k cr", amount 0 cr, 50.0. Typed 100 (shot 06): "100 cr -> 53.3", a payoff bar reading -100 cr at 0.0, -35 cr at 33.3, 0 cr at 51.7, +29 cr at 66.7, +94 cr at 100.0, and a button "Bet 100 cr on Higher". Did not press it. Still no clock anywhere in view.
4. Scrolled up to look for a clock (shot 07): already closed, "CHOSE D3", c3 void, stakes refunded. Second move lost without ever seeing a timer.
5. Back again (shot 08), clicked b3 and scrolled to the top straight away (shot 09): there it is, small orange text in the grey meta line under the title: "decides in 0:21". Typed 100 into the ticket (shot 10): same payoff bar, clock now "decides in 0:12", both visible together only because I had scrolled up. Did not confirm.
6. Clicked the (i) next to "Chess" (shot 11): "A Lichess player whose every move is chosen by this market: on its turn every legal move is an option, and the one priced highest is played." Clock at 0:03.
7. Scrolled down (shots 12, 13), a screen and a half below the ticket: "Each option is priced on my score in this game (100 a win, 50 a draw, 0 a loss); the option priced highest two seconds before the deadline is played, a tie is random, no price plays a random legal move." and under "How this decides": "every other option is voided and every credit in it is refunded at what it cost, while the chosen one keeps trading until the number itself settles."
8. Closed the browser. Nothing was submitted, nothing to cancel.

## Criteria

- Could state what the market on a move resolves to, and when: yes. The bot's final score in this game, 100 win, 50 draw, 0 loss, settled when the game ends (shots 09, 13). But the 100/50/0 scale is only written far below the ticket; at the ticket itself "50.0" and "0.00 to 100" carry no unit.
- Could state what happens if that move is not the one played: yes. Voided, stake refunded at cost (shots 03, 07, 13). I actually learned it from watching two moves close on me.
- With an amount typed in, the ticket told me what I pay and what I could win or lose: yes. 100 cr in, price moves 50.0 to 53.3, from -100 cr at score 0 to +94 cr at score 100, break-even 51.7 (shots 06, 10).
- Found how long I had left: only on the third move, and only by scrolling up. The clock is one small line at the top of the move page ("decides in 0:21", shot 09); clicking a move lands me scrolled past it (shots 02, 05), the floor with the board has no clock at all (shots 01, 04, 08), and the ticket itself says only "decides 17 Sep". For me that is a countdown I could not find when I needed it: no.
- Board to filled-in ticket within one window, or easy to carry on: the clicks themselves are quick (click move, type amount, done, shots 05 to 06 and 09 to 10), and "Back to the market" plus one click gets me onto the next move. But when a move closes the ticket silently turns into "Trading closed" and my typed amount is gone, and I had to go back and re-pick each time. Workable, not effortless: weak yes.

Verdict as the trader: I would not have traded the next move without thinking about the interface, because I would be betting blind on the time left unless I scroll up every single move.

## Also noticed

- The floor page's own ticket is for "Game score" of the whole game; nothing on it says that clicking a move in the list opens a different, per-move market.
- All 30-odd move prices were exactly 50.0 on every move I saw, with "0 pool, 0 volume", and the headline showed "±0 ... tied at the top". With everything tied, the rules say the move is picked at random, so there was no price signal to trade against.
- "decides 17 Sep" in the ticket header is a date for something that decides within a minute.
- After a decision the closed page shows "chosen 17:01:24" but does not link to or offer the next move; you must use "Back to the market".
- Meta line shows "1,000 behind it" on closed moves and "31,000 behind it" on the open one, with no unit or explanation (the event log below says "funded with 31000 cr of liquidity").
- "no payment asked" in the meta line meant nothing to me.
- "Edit question wording" and a "Remove" button are visible on the move page (probably staff controls; I did not touch them).
