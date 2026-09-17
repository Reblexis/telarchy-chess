---
persona: market-trader
url: https://telarchy.com/beta/chess
look-only: true
timeout: 1500
setup: the browser is already signed in to telarchy.com with a staff account. Never press anything in the orange BETA bar at the top (above all "Publish this build" and the build selector), never open "Manage metrics", "Manage dates" or any address containing /admin, and stay on the chess floor and the pages it links to; ignore those staff controls when judging the page
---
# A trader understands what a bet on a move costs, pays and resolves on before placing it

## Goal
While the bot is to move, open one move's market and go as far as the bet ticket with an amount typed in. Stop before confirming. You want the four things you always want: what am I betting on, how does it resolve, what is the price, what do I pay and what can I win. The position changes about once a minute while a game is on. If what you were looking at changes under you, carry on with the new position; that is normal here.

## Passes when
- you could state what the market on a move resolves to, and when
- you could state what happens to your bet if that move is not the one played
- with an amount typed in, the ticket told you what you would pay and what you could win or lose
- you found how long you had left to bet on this move
- you got from the board to a filled-in ticket within one move's window, or the page made it easy to carry on with the next move

## For the reviewer
Right: each move's market is on the Game score (100 win, 50 draw, 0 loss) and settles when the game ends; the markets of moves that were not played are voided and refunded.
