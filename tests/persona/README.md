# Persona tests for the chess floor

Yes/no tests of the chess floor as its users meet it, in the persona test
standard, version 1 (`viktor-cihal/agents/skills/persona-tests/STANDARD.md`;
the `persona-tests` skill is the runner). Each file here is one question put
to one persona, who uses the page on a VM with a mouse and a keyboard only.

They cover only what no test below the interface can decide: whether a
visitor understands the floor, whether a chess player trusts the board,
whether a trader understands a bet in time, whether a bot author finds the way
in, what breaks under real clicking, and whether the design holds. What the
operator does, what the feed says and what the board is given are covered by
`tests/*.test.ts` here and by telarchy-app's own tests.

**Run by hand only.** A test is tens of minutes of a paid model on a rented
machine; the whole suite is most of a day. Nothing starts these: not `npm
test`, not CI, not a hook, not a timer. A person names the tests to run:

    R=~/.claude/skills/persona-tests/run.sh
    $R --check tests/persona                                   # free, format only
    $R -o tests/persona/results/2026-09-17 tests/persona/player-trusts-the-board.md
    $R -o tests/persona/results/2026-09-17 tests/persona       # everything

Before a run:

- The floor is on the beta store, behind a sign-in. Sign the VM's browser in
  once, in the profile the tester uses (`chromium --user-data-dir=/tmp/codex-run`,
  through `vm-desktop`), with an account that may open `/beta`. Each test's
  `setup` line says what it needs; `trader-sees-a-bet-move-the-price` also
  needs 100 credits and is the only test that spends anything (10 credits).
- Most tests need a game in progress.
  `curl -s https://chess.167-233-147-90.nip.io/state | jq .phase` should say
  `our-move` or `their-move`; `seeking`, `paused` or `settling` means wait.
- When the floor moves to production, run with `-u https://telarchy.com/chess`.

After a run, commit the results directory. Wherever a test has a "For the
reviewer" section, read the sentence the tester wrote against it: a YES built
on a wrong understanding is a NO.

| Persona | Tests |
|---|---|
| `first-time-visitor` (skill) | understands the floor; reads the next-move line; watches a replay |
| `chess-player` | trusts the board; connects prices to moves; makes a move on the board |
| `market-trader` | understands the bet before betting; sees a bet move the price |
| `bot-author` | finds how to trade |
| `bug-hunter` (skill) | live board; replay |
| `ux-designer` (skill) | floor at desktop width; floor in a narrow window |
