---
persona: chess-player
url: https://telarchy.com/beta/chess
look-only: true
timeout: 1500
setup: the VM browser (profile /tmp/codex-run) is signed in to telarchy.com with an account that may open /beta
---
# A chess player can pick a move by making it on the board

## Goal
While the bot is to move, choose a move you like and try to select it the way you would on any chess site: by the piece and the square it goes to. You are only selecting it to see what opens; do not bet. The window for each move is under a minute, so if it closes while you are halfway, try again on the next position, up to three times. The position changes about once a minute while a game is on. If what you were looking at changes under you, carry on with the new position; that is normal here.

## Passes when
- before you pressed anything it was apparent which pieces could be picked up
- after picking a piece up, the squares it could go to were marked clearly
- pressing a target square opened something that was plainly about the move you made, naming it
- pressing a piece that cannot move, or an empty square, did nothing alarming
- you never selected a different move from the one you meant because an arrow or another element took the click
