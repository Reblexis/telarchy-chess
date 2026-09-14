# Futarchy chess

A chess player on Lichess whose every move is chosen by a Telarchy
workspace. When it is the player's turn, one proposal is posted with one
option per legal move, each option priced by its own conditional market on
the game's score, and the option the market prices highest is played.
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

- One Lichess BOT account, **TelarchyBot**, upgraded through the Bot API
  (irreversible, which is why it is the only account). It plays standard
  chess only and **one game at a time**, because every move of a game is a
  market. No engine runs anywhere in this service.
- It never offers a draw, never accepts a draw offer or a takeback, and
  never resigns. When Lichess reports the opponent gone and a win may be
  claimed, it claims it.
- It sends no chat and carries no profile text beyond what Viktor has
  approved word for word.

### Clocks

Games are **real-time**; no correspondence and no unlimited games, so a
game always ends within the day its book is priced on.

- **Games the player starts** are **30 minutes plus 20 seconds, rated**,
  colour random. 20 seconds is the largest increment the default
  lichess-bot configuration accepts (`max_increment: 20`, `max_base:
  1800`), which most bots run. 30+20 is Lichess's classical speed, so the
  rating shown is the classical rating.
- **Incoming challenges** are accepted when the player is idle and the
  challenge is standard chess, real-time, base 10 to 180 minutes,
  increment 0 to 180 seconds, rated or casual, from a human or a bot.
  Anything else is declined with Lichess's matching reason
  (`timeControl`, `variant`, `later` while a game is running or its
  settlement is still pending).

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
those. A challenge not accepted in 60 seconds is cancelled, and after a
decline or a cancel the next candidate is tried 30 seconds later. The
player never challenges a human.

## The workspace

One public Telarchy workspace named `Chess` (slug `chess`), owned by the
operator account: the participant **`chess-operator`** (nickname `chess`,
its owner Viktor's account), the way `snake-operator` owns the Snake. Every
proposal, reading and settlement on the floor is that account's; no person's
name is on them, **muted** (`notificationsMuted` on) like the snake, with
no charter, and closed to outside proposals (`externalProposalsDisabled`)
where the store supports it.

One metric, **Game score**: TelarchyBot's result in the current game from
its own side, **100 for a win, 50 for a draw, 0 for a loss** (an aborted
game has no result and settles nothing). Range 0 to 100.

**One book per game.** When a game starts, the operator first posts a
reading of 50 (no result yet), so the game's main book, and every option
book anchored to it, opens at the middle and never at the last game's
result. Then it sets the metric's only horizon to the absolute one-minute
cell 24 hours after the game's
start (`customHorizons: ["YYYY-MM-DDTHH:MM"]`) and forces the workspace's
market refresh, which opens that cell's main book. Every proposal of the
game is priced on that cell.

**The end settles it, before anything else starts.** The moment Lichess
reports the game finished, the operator posts the score as the metric's
reading and settles the metric at it (`POST /api/metrics/:id/settle`,
reason `Game G vs <opponent>: <win|draw|loss>`), which settles the main book
and every chosen option's book of that game at once. A refused settlement
is retried every minute, and **no new game is sought or accepted until it
has gone through**: an early settlement settles every open book on the
metric, so it may only run while that game's books are the only ones open.

**Opening prices are Telarchy's rule, unchanged**: every option book opens
at the main book's current value (Viktor, 2026-09-13). The operator never
trades to move them.

**Liquidity.** The metric's credits on the cell: 3,000 for the main book,
1,000 per option book, as the snake's (Viktor, 2026-09-13: "each legal move
should have 1k liquidity just like with snake"), from the owner's proposal
credits (never the proposer's). A move with 35 legal moves puts 35,000
credits out and gets 34,000 back when the other options void; the chosen
book's 1,000 stays out until the game ends. The operator's float must cover
the widest move plus a game's chosen books, and what traders win off those
books is the only thing that draws it down.

## The move

When Lichess says it is TelarchyBot's turn:

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
- **Two seconds before the deadline**, unless a play-now proposal was
  approved first (below), it reads once more and decides. An
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

Every Telarchy call is bounded: a poll read 10 seconds, the decision's own
read 2 seconds (after that the decision falls on the last polled prices), a
write 20 seconds. A Lichess move is bounded at 10 seconds with one retry; a
move Lichess refuses is logged with its answer and the game state is
re-read.

The operator account never trades. Nothing about a move is decided by the
operator except through this rule.

## Play now?

A move does not have to wait for its window to end (Viktor, 2026-09-14: "a
new proposal ... that gets spawned every second with one second deadline,
asking whether the next move should be made right now? defaults to
declined, but if it is approved the move is made immediately, if not, it
waits and the move is made after one minute at the latest"; chess only).

- **One a second, one at a time.** While a move proposal is open and more
  than 3 seconds remain before its decision, the operator posts a
  two-branch proposal titled `Game G, move N: play now?` every second, its
  deadline one second after posting, priced on the game's cell like every
  book. A new one is posted only once the previous one is decided.
- **The rule.** At its deadline the operator reads its two worlds and
  approves it only when the approved world ("play now") is priced strictly
  above the declined world ("wait"); a tie, an unpriced world, a failed
  read or a refused approval declines it with refund. Declined is the
  default.
- **Approved means now.** The move proposal is decided at once by its own
  rule (the option priced highest, a tie random) and the move is played;
  no further play-now proposal is posted for that move.
- **Otherwise nothing changes.** The move proposal still decides two
  seconds before its own deadline, so the longest a move waits is its
  window (above, at most 50 seconds), as before.
- **Read at once, bounded.** The operator reads a play-now proposal right
  after posting it, so both worlds' market ids are on `/state` within the
  second, and again at its deadline to decide. Each play-now call (post,
  read, approve, decline) is bounded at 1 second. A post that has not
  answered posts nothing new until it does, and a proposal it created late
  is declined. The move's own decision never waits for a play-now call: a
  play-now proposal still open when the move decides is declined after the
  move is played.
- **Liquidity.** Each play-now book holds **100 credits**, from the owner
  (the move proposal's option books keep 1,000), and both void and refund
  at the decision except the approved world's, which settles with the
  game.
- **On the feed.** `/state` carries `open.playNow`: `{ proposal: {id,
  number, url}, deadline, tradeable, approved: { price, marketId },
  declined: { price, marketId } }`, or null between them, and
  `recentDecisions` records a move played early as `kind: "market"` with
  `early: true`.

## The feed

Public JSON, `access-control-allow-origin: *`, `cache-control: no-store`,
errors in JSON (`404 { error }`, `405` with `allow`, `OPTIONS` 204), 600
reads a minute per reader counted as the snake counts them. Every field
listed is present; a value not known yet is `null`.

`GET /state`, `schema: 1`:

- `phase`: `our-move` (a proposal is open), `their-move`, `settling` (the
  game is over and its settlement has not gone through), `seeking` (idle,
  looking for a game).
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
- `cell`, `cellEndsAt`: the game's book.
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

**Beta first.** It plays its first games on Lichess against the beta store
(`https://telarchy.com/beta/api`) until a whole game has run end to end,
decisions and settlement included. Production follows on Viktor's word.

## What must hold

- Every move TelarchyBot plays with two or more legal moves available is
  either the chosen option of that move's proposal or a random legal move
  recorded with its kind and reason.
- One proposal per turn, never two open at once, and its options are
  exactly the legal moves of the position.
- At most one play-now proposal open at a time; a move is played before its
  window ends only after its play-now proposal was approved, which happens
  only when the approved world is priced strictly above the declined.
- The option with the highest price is chosen; a tie is random among the
  tied.
- The player is in at most one game at a time, and starts or accepts none
  while a finished game's settlement is pending.
- A finished game settles the metric at 100, 50 or 0, once.
- The operator account never trades, never offers or accepts a draw, never
  resigns.
- The feed never shows a price the workspace did not report.
