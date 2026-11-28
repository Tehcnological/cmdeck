# Session state card

Long-running work, such as a scheduled task that checks CI every hour or an agent working through a multi-step change, loses detail when the conversation is compacted. The session state card keeps the essentials outside the conversation: the goal, the current phase, the next step, and approaches the agent already tried and rejected.

## How it works

- The agent writes the card itself with the `session_state_record` tool and reads it with `session_state_read`. Ask it to ("keep a state card while you work on this") or let it decide for unattended work.
- Each thread has one card. Fields the agent leaves out keep their values; tried approaches are appended (the last 10 are kept).
- CMDeck adds the card to the agent's prompt on scheduled, interval and webhook runs, and on the first turn after the conversation is compacted (Claude and Codex report compactions). Ordinary messages you send do not carry it.
- When the agent sets the phase to `done` or `abandoned`, the card stays but is no longer added to prompts.
- The card is stored on the server and survives restarts.

## See or clear the card

Choose **Show session state card** in the command palette to open the right panel's CMDeck tab on **State card**. It shows the card, when it was last updated, and when the agent last saw it. **Clear** deletes it. The tab refreshes when you open it or come back to the window.

## Good to know

- Only the first few hundred characters of each field reach the prompt, and the card's part of the prompt is capped at 1,600 characters. The most recent tried approaches come first.
- The card is written by an agent, so CMDeck shows it to the agent as notes, not instructions, and masks anything that looks like a secret when it is saved.
- An agent can write another thread's card only if its own permissions are at least as broad as that thread's.
