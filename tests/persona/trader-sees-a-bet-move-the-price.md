---
persona: market-trader
url: https://telarchy.com/beta/chess
look-only: false
timeout: 1800
setup: the VM browser (profile /tmp/codex-run) is signed in to telarchy.com with an account that may open /beta, and that account has at least 100 credits to trade on the Chess workspace
---
# A trader who places a small bet sees it land and the price move

## Goal
While the bot is to move, place one bet of 10 credits on any move, from the board or the list. Then watch the board and the list. Place exactly one bet, of exactly 10 credits, and nothing else. The position changes about once a minute while a game is on. If what you were looking at changes under you, carry on with the new position; that is normal here.

## Passes when
- the page told you clearly that the bet went through and what it cost
- the price of that move changed on the board or in the list within a couple of seconds of the bet, without a reload
- afterwards you could find your position on that move somewhere without hunting
- when the move was decided you could tell what had happened to your bet
