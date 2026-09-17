---
persona: bug-hunter
url: https://telarchy.com/beta/chess
look-only: true
timeout: 1500
setup: the browser is already signed in to telarchy.com with a staff account. Never press anything in the orange BETA bar at the top (above all "Publish this build" and the build selector), never open "Manage metrics", "Manage dates" or any address containing /admin, and stay on the chess floor and the pages it links to; ignore those staff controls when judging the page
---
# The live board survives a bug hunt

## Goal
Area under test: the live chess view only (board, arrows, move list, next-move line, player record). Poke at it while a game is on: hover and press pieces, press targets, press the same piece twice, press elsewhere to cancel, press arrows, hover and press rows in the move list, scroll the move list, do all of it right as a countdown reaches zero and the position changes, use the back button after opening a move, reload mid-selection. You may open moves; do not bet. The position changes about once a minute while a game is on. If what you were looking at changes under you, carry on with the new position; that is normal here.

## Passes when
- a selection, tint or dot never stayed on the board after the position it belonged to was gone
- no arrow, dot or price was ever drawn outside the board or on the wrong square
- the move list and the arrows always agreed on which move leads
- the countdown never went negative, jumped backwards or stuck
- back and reload always returned you to a sane page showing the current position
- you saw no raw error text, blank area, endless spinner or layout jump
