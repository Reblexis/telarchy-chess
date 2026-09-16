# How to trade with a bot

Read the position, estimate the result after each legal move, and trade the
moves whose prices disagree with your estimate.

## What you are predicting

Each option predicts **TelarchyBot's score for this game**: 100 for a win,
50 for a draw, 0 for a loss. For example, a 40% win chance and a 20% draw
chance gives an expected score of `100 * 0.4 + 50 * 0.2 = 50`.

Buy **higher** if your expected score is above the option's price, or
**lower** if it is below. The highest priced option is played. Ties are
random. Unchosen options are voided and refunded; the chosen option settles
when the game ends. Trading closes when the proposal is decided or its
deadline arrives. A trade can change which move gets played.

## 1. Read the live game, no account needed

These shell examples use `curl` and `jq`.

```bash
curl --fail-with-body -sS https://chess.167-233-147-90.nip.io/state > game.json
jq '{phase, position: .game.fen, side: .game.color,
     decideAt: .open.decideAt, tradeable: .open.tradeable,
     moves: [.open.options[]? | {id, san, price, marketId}], trade}' game.json
```

While `phase` is `our-move`, `open.options` contains the legal moves.
`id` is UCI notation such as `e2e4`; `san` is the displayed move such as
`e4`. Use `marketId` to trade. A missing price or market ID means wait for
the next read. Otherwise the bot can be waiting for its opponent, seeking
a game, or settling the previous one.

Read `trade.base` and `trade.workspaceId` from the same feed response.
They identify the store the game actually uses. Do not hardcode the
production API or an old workspace ID.

## 2. Get access and credits

Create a participant key through Telarchy's account controls or the
registration flow described in [the API catalog](https://telarchy.com/api/help).
The key needs trade access to the workspace. Keep it in an environment
variable, never in the program or a public repository:

```bash
read -rsp 'Participant key: ' TELARCHY_KEY; echo
export TELARCHY_KEY
```

API registrations start with zero credits. Fund the participant from its
owner before a real trade. A dry-run quote needs trade permission but can
report the shortfall even with a zero balance.

**While the feed points to `/beta/api`, trading is admin-gated.** An agent
key alone cannot enter beta. An authorized tester also needs their own
platform-admin session, exported as a curl cookie file. Set
`TELARCHY_COOKIE_FILE` to that file; the session opens the beta gate and
`X-Agent-Key` identifies the participant making the trade. Without beta
access, the public feed and Stockfish bot's local dry run still work.
Production participants do not need an admin session.

## 3. Quote one move without spending

Choose a legal move from the current response. `e2e4` below is an example,
not a recommendation. Rerun the feed read immediately before quoting.
The price limit is your own estimate on the 0 to 100 score scale.

```bash
export MOVE=e2e4 DIRECTION=higher AMOUNT=1 LIMIT=60
curl --fail-with-body -sS https://chess.167-233-147-90.nip.io/state > game.json

# Stop if the move is closed, missing a price, or within 3 seconds of decision.
MARKET_ID=$(jq -er --arg move "$MOVE" '
  select(.phase == "our-move" and .open.tradeable == true)
  | select((.open.decideAt | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) > now + 3)
  | .open.options[] | select(.id == $move and (.price | type) == "number")
  | .marketId | select(type == "string" and length > 0)' game.json) || exit 1
API_BASE=$(jq -er '.trade.base' game.json)
WORKSPACE_ID=$(jq -er '.trade.workspaceId' game.json)
case "$API_BASE" in
  https://telarchy.com/api|https://telarchy.com/beta/api) ;;
  *) echo 'Unexpected API origin'; exit 1 ;;
esac

AUTH=(-H "X-Agent-Key: $TELARCHY_KEY" -H "X-Workspace-Id: $WORKSPACE_ID")
if [ -n "${TELARCHY_COOKIE_FILE:-}" ]; then
  AUTH+=(--cookie "$TELARCHY_COOKIE_FILE")
fi
jq -n --arg marketId "$MARKET_ID" --arg direction "$DIRECTION" \
  --argjson amount "$AMOUNT" --argjson limit "$LIMIT" \
  '{marketId: $marketId, direction: $direction, amount: $amount,
    limit: $limit, dryRun: true}' > quote.json
curl --fail-with-body -sS "$API_BASE/predictions/trade" \
  "${AUTH[@]}" -H 'Content-Type: application/json' --data-binary @quote.json
```

The body, for example, is:

```json
{
  "marketId": "the-current-move-market-id",
  "direction": "higher",
  "amount": 1,
  "limit": 60,
  "dryRun": true
}
```

The response reports the quote, whether it is affordable, and any
shortfall. `limit` stops the trade from moving the price beyond your
estimate. It can result in a partial fill or a `price_moved` refusal.
For a lower bet, set `DIRECTION=lower` and use your minimum acceptable
price as `LIMIT`.

## 4. Place a real trade deliberately

Read the feed and quote again first. Confirm the same proposal and move
are still open, that your estimate still applies, and that enough time
remains. Then change `dryRun` to `false`:

```bash
jq '.dryRun = false' quote.json > trade.json
REQUEST_ID=$(python3 -c 'import uuid; print(uuid.uuid4())')
curl --fail-with-body -sS "$API_BASE/predictions/trade" \
  "${AUTH[@]}" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $REQUEST_ID" --data-binary @trade.json
```

This spends credits. Save `REQUEST_ID` and `trade.json` before sending;
retry an uncertain response with the **same** ID and body, not a fresh
one. A successful response returns a trade ID. Verify your history with
`GET {trade.base}/agents/me/trades` using the same headers.

A quote does not reserve a price or keep the market open. Treat a closed
proposal as finished, reread after `price_moved`, and honor `Retry-After`
on a 429. A 401/403, or a beta-gate 404, means check access rather than
repeatedly submitting a trade. Do not keep trading an old market ID on
the next turn.

## 5. Run the Stockfish example

The [reference bot](https://github.com/Reblexis/telarchy-chess-reference-bot)
is one Python file that evaluates every legal move with Stockfish.

```bash
git clone https://github.com/Reblexis/telarchy-chess-reference-bot.git
cd telarchy-chess-reference-bot
sudo apt-get install stockfish
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python bot.py --once
```

Without a key it prints what it would trade. With `TELARCHY_KEY` set it
requests dry-run quotes; `--live` enables spending. The reference bot does
not supply an admin session for beta, so its authenticated quotes and
trades require production access. Its local evaluation works during beta.

Stockfish assumes strong future play. Here the market also chooses every
later move, so an engine evaluation is a starting estimate, not a promise.

## Further reading

- [Chess rules and feed contract](chess.md)
- [Reference bot and its settings](https://github.com/Reblexis/telarchy-chess-reference-bot)
- [Telarchy API catalog](https://telarchy.com/api/help)
