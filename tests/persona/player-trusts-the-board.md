---
persona: chess-player
url: https://telarchy.com/chess
look-only: true
timeout: 1500
---
# A chess player finds the board correct and readable at a glance

## Goal
Judge the board as a chessboard. Then open the game on Lichess (there is a link to it somewhere on the page or in the move's description) and compare the position. The position changes about once a minute while a game is on. If what you were looking at changes under you, carry on with the new position; that is normal here.

## Passes when
- the board is the right way round for the side the bot plays, with a dark square in the bottom-left corner as seen by White
- every piece is recognisable instantly, including on dark squares
- you could find the last move played without searching
- the position matched the Lichess game, allowing for a move or two of delay while you switched tabs
- arrows or marks drawn on the board never hid a piece or made the position hard to read
