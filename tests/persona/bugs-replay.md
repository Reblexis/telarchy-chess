---
persona: bug-hunter
url: https://telarchy.com/beta/chess
look-only: true
timeout: 1500
setup: the browser is already signed in to telarchy.com with a staff account. Never press anything in the orange BETA bar at the top (above all "Publish this build" and the build selector), never open "Manage metrics", "Manage dates" or any address containing /admin, and stay on the chess floor and the pages it links to; ignore those staff controls when judging the page
---
# The replay controls survive a bug hunt

## Goal
Area under test: the replay row only (game picker, scrubber, play, speed, LIVE). Pick the oldest and the newest game, drag the scrubber to both ends and quickly back and forth, play at every speed, switch game while playing, press LIVE while playing, start a replay while a live move is being decided, reload during a replay.

## Passes when
- the board always showed the position that matches the move the line describes
- the first position of every game was the normal starting position and the last matched the stated result
- switching games or pressing LIVE never left the board showing a mix of two games
- play always stopped at the end of the game and never ran past it
- live arrows or the live move list never appeared over a replayed position
- you saw no raw error text, blank area, endless spinner or layout jump
