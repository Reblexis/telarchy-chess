---
persona: chess-player
url: https://telarchy.com/chess
look-only: true
timeout: 1500
---
# A chess player understands what the prices on the moves mean

## Goal
While the bot is to move, look at the arrows on the board and the list of moves with numbers beside it. Work out, without opening any guide, what the number next to a move means and which move will be played. The position changes about once a minute while a game is on. If what you were looking at changes under you, carry on with the new position; that is normal here.

## Passes when
- you could say, with confidence, what a number such as 56.4 next to a move means in chess terms; write your answer in your report
- you could tell which move is currently going to be played and why that one
- you could tell the scale the numbers are on
- the move notation in the list is correct for the position on the board
- pointing at a move in the list showed you that move on the board

## For the reviewer
Right: the number is the market's expected game score for TelarchyBot if that move is played, on 0 to 100 (100 win, 50 draw, 0 loss). The highest-priced move is played when the countdown ends; a tie is broken at random. "Probability the move is played" or "engine evaluation" is a misunderstanding; treat that YES as a NO.
