# Futarchy chess

A chess player on Lichess whose every move is chosen by a Telarchy
workspace. When it is the player's turn, one proposal is posted with one
option per legal move, each option priced by its own conditional market on
the player's Lichess rating half an hour on, and the option the market prices highest is played.
Games are public and rated, so the player carries a Lichess rating
anyone can check.

It exists for Viktor's reasons (record:
`viktor-cihal/projects/futarchy/chess-workspace.md`, design notes in the
telarchy umbrella `notes/futarchy-chess-proposal-2026-09-13.md`):

- a fun floor for traders: public games against real opponents,
- a rating attached, to see how high a market-steered player climbs,
- a target for people writing trading agents, the way the snake is.

Everything below is the contract. Internals are free within it.

## The player

- One Lichess BOT account, **TelarchyRookie**, upgraded through the Bot API
  (irreversible, which is why it is the only account). It plays standard
  chess only and **one game at a time**, because every move of a game is a
  market. No engine runs anywhere in this service.
- It never offers a draw, never accepts a draw offer or a takeback, and
  never resigns. When Lichess reports the opponent gone and a win may be
  claimed, it claims it.
- It sends no chat and carries no profile text beyond what Viktor has
  approved word for word.

### Clocks

Games are **real-time**; no correspondence and no unlimited games.
Every book is priced on the player's rating at a clock time ("Books on the half hour", below), never on a game's result.

- **Games the player starts** are **30 minutes plus 20 seconds, rated**,
  colour random. 20 seconds is the largest increment the default
  lichess-bot configuration accepts (`max_increment: 20`, `max_base:
  1800`), which most bots run. 30+20 is Lichess's classical speed, so the
  rating shown is the classical rating.
- **Incoming challenges** are accepted when the player is idle and the
  challenge is standard chess, **rated**, real-time, base 10 to 180 minutes,
  increment 0 to 180 seconds, on a clock Lichess counts as classical (base
  plus 40 increments at least 25 minutes), from a human or a bot: the one
  metric is the classical rating, and a game that cannot move it has no
  move worth pricing.
  Anything else is declined with Lichess's matching reason
  (`timeControl`, `variant`, `rated` for a casual challenge, `later` while a
  game is running).

### The decision window follows the clock

A market needs time and the clock does not wait, so the window of each move
is set from the player's own clock at its turn:

`window = clamp(increment + (clock - 120 s) / 30, 15 s, 50 s)`

A move then spends the window plus a few seconds of posting and playing,
and the clock settles where the window meets the increment instead of
running out. Two exceptions:

- **The first move** of the player in a game gets **20 seconds**: Lichess
  aborts a classical game whose player has not moved within 35 seconds of
  its start (`timeForFirstMove`), and the clock is not running yet.
- **Clock guard.** Under 30 seconds on the clock no proposal is posted: a
  uniformly random legal move is played at once, recorded as `clock`.

### Opponents

When the player has been idle for two minutes and nothing is pending, it
challenges one bot from Lichess's online bots list (`GET /api/bot/online`):
a bot with an established classical rating within 200 points of the
player's own (any established rating while the player's own is
provisional), not one of the last five opponents, picked at random among
those. **When nobody qualifies, the rule loosens in order** (Viktor,
2026-09-14), stopping at the first step that finds someone: first the
last five opponents are allowed again, except the very last one, who is
never challenged twice in a row; then the band widens by 100 points at a
time, to 300 and then 400, still never the very last opponent. Past 400
nobody is challenged, and every empty search is logged with the rating and
the band it tried, so a player that is not finding games says why. A
challenge not accepted in 60 seconds is cancelled, and after a
decline or a cancel the next candidate is tried 30 seconds later. The
player never challenges a human.

## The workspace

One public Telarchy workspace named `Chess` (slug `chess`), owned by the
operator account: the participant **`chess-operator`** (nickname **`Rookie`**,
the bot's name on Telarchy, where every proposal shows it as the proposer;
its owner Viktor's account), the way `snake-operator` owns the Snake. The
workspace keeps the name `Chess`, and the Lichess account stays
TelarchyRookie. Every
proposal, reading and settlement on the floor is that account's; no person's
name is on them, **muted** (`notificationsMuted` on) like the snake, with
no charter, and closed to outside proposals (`externalProposalsDisabled`)
where the store supports it.

One metric, **Lichess rating**: TelarchyRookie's classical rating as
Lichess publishes it. Market range 1200 to 2000. It is the only metric: a
move is judged by what it does to the rating, not by the game it belongs
to. The metric carries no `marketTitle` and no `opensAt`, so a book's
question names its own time and a book opens at the metric's value, which
is the rating now: the right price for a book nobody has traded.

**Provisioning removes the platform's starter proposal** (the one every new
workspace is created with, named by `starterProposalId` in the creation
answer): the floor carries move proposals and nothing else.

**The move question and the floor's text are set at provisioning**, so a
floor made again reads the same. The workspace's option question
(`optionQuestionTemplate`), verbatim: **"If the move {option} is made, what
will my {metric} be {date}?"**, never the platform default "With
{option}, ...", which reads a move as a noun phrase. The workspace's about
text (`subjectAbout`): who plays and where (the Lichess account, linked), one
proposal a turn with every legal move an option, the rating each option is
priced on and when it is read, the highest price played two seconds before the deadline with the
rest voided and refunded, a tie random, every book settled on the rating at its time,
then a link to [How to trade with a bot](trading.md).

**Books on the half hour.** Every book, the main one and each move's, is
priced on the rating at a **mark**: a minute cell on the half-hour grid
(`YYYY-MM-DDTHH:00` or `HH:30`, UTC). The **target** at any moment is the
first mark at least 30 minutes away, so a move posted at 12:10 is priced on
the rating at 13:00 and one posted at 12:40 on the rating at 13:30: between
30 and 60 minutes on. A game lasts about five minutes, so a move's game and
the few after it are over by its mark. The target is the metric's only
horizon, titled `at HH:MM UTC`
(`horizonTitles: { "<cell>": "at 13:00 UTC" }`). On every tick, game or no
game, the operator compares the target with the horizon it last wrote; when
they differ it writes the new one and forces the workspace's market
refresh, so the main book of a mark is open from the moment it becomes the
target. A refusal is logged and tried again on the next tick. The mark that
stopped being the target keeps its books: Telarchy leaves a traded main
book open until its time and returns an untraded one's credits, and a
chosen move's book settles on its own date either way.

**The rating at a mark** is the last rating the operator recorded at or
before the mark's first instant. The operator records the rating, with the
time it read it, whenever the account read shows a number different from
the last one recorded (the account is read once a minute and right after a
game ends); the record is kept in the saved state, the last 200 entries. A
game still running at the mark has not moved the rating, so the mark reads
the rating from before it.

**A mark settles when it arrives.** On the first tick at or after a mark
that was a target, once the account has been read after the mark's
instant, the operator posts the rating at the mark as the metric's reading
stamped at the mark's first instant (`asOf`, which is what places it
inside the minute cell) and calls `POST /api/predictions/resolve`, which
settles the mark's main book and every chosen move's book on it at once. A
failure is retried on every tick until it goes through, after a restart
too (Telarchy gives up on a cell only after 24 hours), and the reading is
always the rating at the mark, never the rating at the retry. Marks
wait in the saved state until settled; one still unsettled 24 hours after
its instant is dropped and said, Telarchy having given up on it. **The operator never calls the
metric's early settlement**: it settles every open book on the metric, and
here books of two marks are open at once. A game's end settles nothing: it
moves the rating, and the rating is read at the marks. The operator posts
no other reading: one stamped later inside a mark's minute would replace
the mark's own.

**Opening prices are Telarchy's rule, unchanged**: every option book opens
at the main book's current value (Viktor, 2026-09-13). The operator never
trades to move them.

**Liquidity.** The metric's credits on the target cell: 6,000 for the main
book, 2,000 per option book, from the owner's proposal credits (never the
proposer's). A move with 35 legal moves puts 70,000 credits out and gets
68,000 back when the other options void; the chosen book's 2,000 stays out
until its mark, at most an hour. The operator's float must cover the widest
move (218 legal moves, 436,000) plus an hour's chosen books, and what
traders win off those books is the only thing that draws it down. The
operator writes these with every horizon it writes.

## The move

When Lichess says it is TelarchyRookie's turn:

- **One legal move**: it is played at once, no proposal, recorded as
  `forced`.
- **Otherwise** the operator posts one proposal titled `Game G, move N`
  (G the game number on this floor, N the player's own move number in the
  game, starting at 1) with **one option per legal move**: id the move in
  UCI (`e2e4`, `e7e8q`), label the move in SAN (`Nf3`, `O-O`, `exd8=Q+`),
  ordered by id ascending. A position can have up to 218 legal moves, so
  Telarchy accepts that many options on one proposal
  (telarchy-app `docs/guides/proposals.md`, "More than two options").
- The deadline (`decideBy`) is the window (above) after posting. The
  description is first person, one short paragraph: the colour, the
  opponent and their rating, the move number, the opponent's last move in
  SAN, both clocks, the position as FEN, the Lichess game link, and the
  rule in one clause.
- The operator reads the proposal at once after posting it, so every
  option's market id is on `/state` within a second of the proposal, then
  every 5 seconds, publishing each option's price, lead and market id. The
  floor draws the live prices from Telarchy's own once-a-second prices read,
  not from these.
- **Two seconds before the deadline** it reads once more and decides. An
  option's score is its **price**, the consensus of its own book:
  - the option with the highest price is **chosen**: the operator approves
    the proposal naming it (`POST /api/proposals/:id/approve { option }`),
    Telarchy voids and refunds the rest, and the move is played on Lichess;
  - a **tie** at the top (prices within a billionth) is broken uniformly at
    random among the tied options, and the record keeps how many tied;
  - **no price at all**, an unreadable proposal, or a refused approval:
    a uniformly random legal move is played, the proposal is declined with
    refund, and the record says why (`undecidedReason`).
- If posting the proposal fails, a random legal move is played at once,
  recorded as `undecided` with the error.

A game already running cannot pause: the opponent's clock runs, so the
random move above is what a platform fault costs mid-game (Viktor,
2026-09-16: "okay current random move then"). What pauses is the search.

### The search pauses while the platform cannot price a game

The games pause when they cannot reach the server or trades are not
working (owner decision 2026-09-16, the telarchy umbrella's
`notes/snake-through-publishes-2026-09-16.md`). For chess that means:
**no new game is sought or accepted while the platform cannot price
one.** The operator marks the platform down the moment a move goes
`undecided` for a platform reason (a proposal that could not be posted,
no price on any option, an unreadable proposal, a refused approval) and
keeps the reason and the instant. The clock guard and a forced move are
not platform faults and mark nothing. While marked down:

- the player challenges nobody, and an incoming challenge is declined
  with `later`, like during a game;
- `phase` is `paused` and `/state` carries `paused: { since, reason }`;
- once a minute while idle (a running game's moves speak for themselves)
  the operator probes the platform with the refresh call a move needs
  (`refreshBooks`), the first probe a minute after the mark; the first
  probe that succeeds, or the first move the market prices, clears the
  mark and the search resumes
  from the idle rule as usual. A probe that fails keeps the mark and is
  logged with its error.

The mark survives a restart, so a restart into a broken platform does
not start a game.

Every Telarchy call is bounded: a poll read 10 seconds, the decision's own
read 2 seconds (after that the decision falls on the last polled prices), a
write 20 seconds. A Lichess move is bounded at 10 seconds with one retry; a
move Lichess refuses is logged with its answer and the game state is
re-read.

The operator account never trades. Nothing about a move is decided by the
operator except through this rule.

## Recovery and trading instructions

A failed decline is retained in the saved state and retried once a minute,
including after restart. It never becomes a retrospective approval. Until
all abandoned proposals are closed, no new game starts. An already closed proposal completes cleanup;
an unavailable endpoint or unknown proposal stays queued for retry.
Each tick processes at most one queued closure, after its current move.

The floor links to [How to trade with a bot](trading.md), which includes
read-only examples, an explicit dry-run trade, the switch to a real trade,
beta access requirements, and the Stockfish reference bot. Examples obtain
the API base and workspace from the feed instead of hardcoding a store.

## The feed

Public JSON, `access-control-allow-origin: *`, `cache-control: no-store`,
errors in JSON (`404 { error }`, `405` with `allow`, `OPTIONS` 204), 600
reads a minute per reader counted as the snake counts them. Every field
listed is present; a value not known yet is `null`.

`GET /state`, `schema: 1`:

- `phase`: `our-move` (a proposal is open), `their-move`, `paused` (idle,
  the platform cannot price a game; "The search pauses" above),
  `seeking` (idle, looking for a game).
- `paused`: null, or `{ since, reason }` while the search is paused.
- `player`: `{ username, url, rating, provisional, games: { played, won,
  lost, drawn } }` as Lichess last reported the account: `rating` the
  classical rating, `provisional` Lichess's own flag, `games` its counts of
  all, won, lost and drawn games. Read once a minute and again right after a
  game ends, so the record moves with the result; `null` until the first
  read.
- `game`: the current or last game, `{ number, id, url, color, opponent: {
  name, title, rating }, rated, clock: { initial, increment }, fen, moves
  (UCI, oldest first), turn, clocks: { white, black } (milliseconds),
  status, result (100 | 50 | 0 | null), startedAt, endedAt }`.
- `open`: the open move or null, `{ move, proposal: { id, number, url },
  openedAt, decideAt, deadline, tradeable, quotesAt, options: [{ id, san,
  price, lead, marketId, reason? }] }`, options in proposal order, `reason`
  saying why a price is missing (`not polled yet` before the first poll).
- `cell`, `cellEndsAt`: the target mark new books are priced on, as the
  minute cell (`2026-09-19T13:00`) and the instant that minute ends.
- `marksPending`: the marks that were targets and have not settled yet,
  oldest first.
- `call`: the target mark's main book, `{ marketId, value, history: [{ at, value }]
  }`: the book's consensus now and after each trade,
  oldest first, at most 300 points; null before the first read.
- `recentTrades`: the last 20 trades on this game's books, newest first,
  `{ id, at, handle, side: "buy" | "sell", direction: "higher" | "lower",
  credits, book: "game" | "move", san, move, price }`: `san` and `move` name
  the option's move and its number when `book` is `move` (null for the main
  book), `price` is that book's consensus after the trade. A trade on a book
  the operator no longer knows (a move opened before a restart) is left out.
  Both come from Telarchy's public reads (the actions log and the market's
  history), read every 5 seconds while a game runs, on their own timer: a
  slow or failed read keeps the last values and can never delay a move's
  decision.
- `recentDecisions`: the last 20, newest first, `{ game, move, at, chosen,
  san, price, tied, kind: "market" | "undecided" | "forced" | "clock",
  undecidedReason }`.
- `rules`: `{ windowSeconds: { min: 15, max: 50, firstMove: 20 },
  decideBeforeDeadlineSeconds: 2, tieBreak: "random", noPrice: "random
  legal move", clockGuardSeconds: 30 }` and `rule`, the same in one
  sentence.
- `trade`: `{ base, endpoint: "POST /api/predictions/trade", auth:
  "X-Agent-Key", workspaceHeader: "X-Workspace-Id", workspaceId,
  rangeMin: 0, rangeMax: 100 }`.

`GET /games`: every game on this floor, oldest first, `{ games: [{ number,
id, url, color, opponent, rated, result, startedAt, endedAt, plies }] }`.

`GET /history?game=N|current`: one game's record, `{ game, plies: [{ ply,
at, by: "us" | "them", uci, san, fen, kind?, price?, tied? }] }`, our plies
carrying the decision's `kind`, the chosen option's `price` and `tied`.

A new field does not raise `schema`; a field that changes meaning or
leaves does.

## The stream

The game rendered as a 1280 by 720 frame in-process (`@napi-rs/canvas`, no
browser) and pushed to Twitch at 5 frames a second through ffmpeg, from the
chess server. The channel is https://www.twitch.tv/telarchy, the one the
snake used (credentials and the stream key in the keyring,
`telarchy/twitch.env`). A channel takes one stream, so while chess streams
the snake's stream unit is stopped and its watchdog does not start it again
(telarchy-snake `docs/snake.md`, "The stream").

**The stream never dies of one bad read.** It polls `/state` once a second.
A read that fails, or a payload that is not an object with a string
`phase`, is not drawn: the last good frame stays on screen and the read is
logged. A payload with `game: null` is a real state (no game yet) and is
drawn. A frame that throws is skipped, not fatal. A stream that exits comes
back after a restart delay.

**The frame is the snake stream's dark frame with a chessboard in it**, so
the two read as one channel. Ground `#101013`, text in Inter, Fraunces and
JetBrains Mono, pieces in Noto Sans Symbols 2, every face and the Telarchy
lockup bundled in the repo (`fonts/` with their OFL licences, `assets/`);
the frame reads nothing from the system or the network. Every line is
readable at 720p and no text runs past the frame or out of its column.

**The board** fills the frame's height on the left (x 24, y 24, 84 px
squares), seen from TelarchyRookie's side: white at the bottom when
`game.color` is white, black otherwise. a1 is a dark square. The squares
use the floor's tones (light `#efe8d6`, dark `#d6ccb2`; the two squares of
the last move in `game.moves` tinted `#e6d28a` light, `#d2bb6a` dark), file
letters in the bottom row's corners and rank numbers in the left column's,
mono, `#6b6b7a`. The pieces are the position in `game.fen`, white filled
`#fbf9f4` outlined `#17171c`, black filled `#17171c`. With no game the start
position is drawn.

**The top three moves are arrows on the board** while `phase` is
`our-move`: the three highest-priced options (ties in proposal order),
drawn from square centre to square centre in the accent `#f59e0b`, shaded
as the floor shades them (the highest price at 0.9, the lowest of the three
at 0.3, all at 0.55 when fewer than two are priced or all tie), each with a
small dark tag on its target square carrying its price to one decimal. An
unpriced option draws no arrow. A move is the **leader** only when its price
is strictly the highest; its tag is green (`#4ade80`). With a tie at the top
nothing is green, because the tie is broken at random.

**The right column** (from x 736, 520 px wide), top to bottom:

1. the Telarchy lockup, 18 px tall at its own aspect ratio;
2. "Chess" in Fraunces 700 with the question "What will my Lichess rating be
   in half an hour?" beside it on the same line in Fraunces
   500, muted;
3. three cells between hairlines, each a small mono uppercase label over a
   large mono value: the player's name and rating over its clock, the
   opponent's name and rating over theirs (a name too long for its cell is
   cut with an ellipsis), and the state of the move:
   - `our-move`: `NEXT MOVE` over the countdown to `open.decideAt` in the
     accent, "deciding" once it has run out;
   - `their-move`: `THEIR MOVE` over "thinking", muted;
   - a game with a `result`: `GAME OVER` over "won" in
     green, "lost" in red (`#f87171`) or "drawn";
   - `seeking` with no result to show: `NEXT GAME` over "seeking", muted.

   Clocks read `m:ss`, `h:mm:ss` from an hour, never below `0:00`. The
   clock of the side to move counts down by the second from the moment the
   feed's clocks were last true: `open.openedAt` for TelarchyRookie's clock
   while a move is open, the newest `recentDecisions` entry of this game for
   the opponent's while they think. Without that moment (the opponent's
   first move before we have moved) and once the game has ended, both clocks
   stand still;
4. the player's record, one muted mono line: `RATING 1415? · PLAYED 10 ·
   WON 0 · LOST 10 · DRAWN 0` (`?` while provisional), absent while
   `player` is null;
5. **the market's call**: the label `MARKET'S CALL` with the call now at
   the right in the accent (a whole number), over a graph of `call.history`
   ending at `call.value`: the line in the accent over a faint fill of it, a
   dot on the newest point. The vertical scale is 80 rating points tall,
   centred on the player's rating rounded to the nearest ten (on
   `call.value` while `player` is null), with hairlines at the centre and 20
   above and below it, the centre the brighter, their values in small mono
   at the right; a point outside the scale is drawn on its edge.
   Fewer than two points draw the level as a flat line. With no `call` the
   graph is empty and the value reads `-`;
6. **the leading moves**, three rows between hairlines:
   - while a move is open, `LEADING MOVES` with the number of legal moves at
     the right: the three highest-priced options (ties in proposal order,
     unpriced last), each its rank, its SAN, a bar whose length is its price
     within the three rows' range (the lowest a short stub, the highest the
     full track), and its price. The leader's SAN, bar and price are green;
     with a tie at the top nothing is green;
   - otherwise `LAST DECISION`: the newest decision of this game as "Move 6:
     O-O, chosen at 56.4" ("chosen at random" when its kind is not
     `market` or it has no price), and under it who is thought about:
     "Waiting for OppBot (2171) to reply", "Game over" once it has a result,
     or, with no decision yet in this game, "Waiting for the first move";
7. **the trades**, `TRADES` over up to five rows from `recentTrades`, newest
   first: a small triangle (up and green when the trade pushed its book's
   price up: a buy of higher or a sale of lower; down and red otherwise),
   the handle, the move's SAN (or "game" in muted for the main book), the
   credits as "120 cr" (rounded to a whole credit, "<1 cr" below one), and
   the price after it in the triangle's colour. Older rows fade. A handle
   too long for its cell is cut with an ellipsis. With none: "No trades yet
   this game", muted;
8. at the foot the link alone: `telarchy.com/chess` in a slim bone
   (`#f2ecdc`) pill, Inter 600. No other words invite the viewer anywhere.

With no game yet the column's cells read `-` and the leading-moves panel
says "Waiting for the first game".

## Operation

One Node process: the Lichess event stream, the game stream, the operator,
the feed. Its state (the current game, the decisions, the games list) is
written to a JSON file after every change, so a restart resumes: on start
it reopens the event stream, which replays the current game, declines any
proposal left open with refund, and posts a fresh one if it is the
player's turn.

It runs on the snake's server (Hetzner `telarchy-snake`, 167.233.147.90)
as the `systemd --user` unit `telarchy-chess.service`, port 8803, Caddy
serving `chess.167-233-147-90.nip.io` (and `chess.telarchy.com` once its A
record exists). It is a light process: no engine, a few reads a minute.

Configuration by environment: the Telarchy base URL, the operator's key
(`chess-operator`, the only identity it acts as), on the admin-gated beta
also an admin session that only opens the gate (a request carrying a
participant key acts as that participant whatever session rides with it),
the workspace and metric ids, the Lichess token (scopes `bot:play`, `challenge:read`,
`challenge:write`), the port, the state file, and `SEEK` (off disables
challenging bots, so the player only answers challenges).

**It runs on production** (`https://telarchy.com/api`, the floor at
`https://telarchy.com/chess`), with the operator's key alone: production has
no gate, so no session and no branch are configured. Game numbers on the
floor start at 1 with the production floor. The beta store
(`https://telarchy.com/beta/api`, admin session and branch as above) is where
a change to the operator is tried for a whole game, decisions and settlement
included, before it reaches production.

## Persona tests

What only a person at the screen can judge (a visitor understands the floor,
a chess player trusts the board, a trader understands a bet within a move's
window, a bot author finds the way in, nothing breaks under real clicking, the
design holds) is tested by the suite in `tests/persona/`, in the persona test
standard: one yes/no question per file, answered by a persona using the page
on a VM with mouse and keyboard only. Its `README.md` says how to run it.
These tests are started by a person and by nothing else: they are not part of
`npm test`, CI, a hook or a timer.

## What must hold

- Every move TelarchyRookie plays with two or more legal moves available is
  either the chosen option of that move's proposal or a random legal move
  recorded with its kind and reason.
- One proposal per turn, never two open at once, and its options are
  exactly the legal moves of the position.
- The option with the highest price is chosen; a tie is random among the
  tied.
- The player is in at most one game at a time.
- No new game is sought or accepted while the platform cannot price one.
- Every book is priced on a mark at least 30 minutes after it opens.
- A mark settles on the rating at its first instant, once, and the
  operator never settles the metric early.
- The operator account never trades, never offers or accepts a draw, never
  resigns.
- The feed never shows a price the workspace did not report.
