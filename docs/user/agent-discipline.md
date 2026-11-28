# Agent discipline

CMDeck asks coding agents to work in a measure, test, decide loop instead of fanning out
subagents and leaning on a PR review bot to catch problems. It is on by default. Change it in
**Settings → Providers → Agent discipline**.

## What agents are asked to do

Each turn, CMDeck tells Claude Code, Codex, Cursor, OpenCode and Grok Build agents to:

- Name one measurable **done-check** before the first edit (a test command, benchmark, typecheck or
  repro), and run it before changing anything and after every change.
- Keep a short per-change log: the change, the check before and after, and whether it was kept or
  reverted.
- Prefer small sequential edits, and do the work themselves.
- Review their own diff against the done-check before saying they are done.
- Pass tests, lint, typecheck and the done-check before opening a PR or marking one ready, and put
  the results in the PR body.
- Report progress during long runs, and stop and report when the done-check has not improved in
  several changes in a row.

Antigravity and other ACP agents get none of this.

## What CMDeck enforces

- **Subagent budget.** A thread runs at most 2 subagents at once by default. Past that, Claude
  Code's `Agent` tool and `delegate_task` are refused unless the subagent's prompt starts with
  `Budget justification:` followed by what earlier subagents found that needs another one. Codex
  and other agents are told about the budget, but CMDeck cannot stop their own subagents.
- **Review rounds.** On a PR the agent watches, each review a bot account submits (Codex, or any
  other review bot) counts as a round. After 2 rounds the watch ends and the agent lists the
  remaining findings for you instead of fixing them. Projects without a review bot never count a
  round.

The thread header shows both counts: subagents running against the cap, and review rounds once
there is one. Open the counter to give one thread its own subagent cap, or no cap.

## Settings

| Setting                                     | Default | Meaning                                                     |
| ------------------------------------------- | ------- | ----------------------------------------------------------- |
| Agent discipline                            | On      | Turns all of this on or off.                                |
| Subagents at once                           | 2       | Concurrent subagents per thread. 0 allows none unjustified. |
| Review rounds                               | 2       | Review bot rounds before the hand-off. 0 is no cap.         |
| Minutes between progress reports            | 20      | 0 turns progress reports off.                               |
| Changes without improvement before stopping | 3       | 0 is no limit.                                              |

These are server settings, so each CMDeck host keeps its own. Without the desktop app, set them in
`userdata/settings.json` in the CMDeck data folder (`~/.cmdeck` by default):

```json
{
  "cmdeck": {
    "agentDiscipline": {
      "enabled": true,
      "subagentCap": 2,
      "reviewRoundCap": 2,
      "checkpointMinutes": 20,
      "stallLimit": 3
    }
  }
}
```

Leave out any field to keep its default.

## On another host

The defaults ship with CMDeck, so another host (a Mac mini, for example) gets them as soon as it
runs a build that includes this feature. Nothing needs copying. To use different values there,
change them in that host's **Settings → Providers**, or edit its `settings.json` as above.
