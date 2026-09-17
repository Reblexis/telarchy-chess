---
persona: ux-designer
url: https://telarchy.com/beta/chess
look-only: true
timeout: 1500
setup: the browser is already signed in to telarchy.com with a staff account. Never press anything in the orange BETA bar at the top (above all "Publish this build" and the build selector), never open "Manage metrics", "Manage dates" or any address containing /admin, and stay on the chess floor and the pages it links to; ignore those staff controls when judging the page
---
# The chess floor holds up in a narrow window

## Goal
Make the browser window as narrow as it will go (aim for about 400 pixels wide; drag its edge or use the window manager), then review the chess floor top to bottom with a game on. Then try about 600 pixels. The position changes about once a minute while a game is on. If what you were looking at changes under you, carry on with the new position; that is normal here.

## Passes when
- the page never scrolled sideways at either width
- the board stayed fully visible and square, with pieces still legible
- the move list and the player record moved below the board in a sensible order and stayed readable
- targets you need to press (pieces, rows, replay controls) were large enough to press without mis-hits
- nothing overlapped, was cut off, or was left stranded with a large empty gap
