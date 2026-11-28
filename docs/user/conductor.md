# Conductor and work ledger

A conductor is a thread that owns a goal too big for one turn. It splits the goal into work items, starts a [delegated subagent](./subagents.md) (a worker) for each item, reads what the workers report, checks their claims, and tells you when the goal is done. Its items live in a work ledger you can watch from the thread's **Work ledger** tab.

## Start a conductor

1. Open a new or existing thread.
2. Open the command palette and choose **Start conductor**. The **Work ledger** tab opens beside the thread.
3. Tell the thread the goal, such as "Clear the flaky-test backlog" or "Land these three fixes, each with green checks". The conductor replies with a plan before it starts workers, unless you said to go ahead.

**Stop conducting** in the Work ledger tab ends the role. The thread's items stay listed.

## What you see in the work ledger

Each item shows its title, the acceptance condition the conductor will check, its state (open, accepted, rejected or abandoned) and its worker's last report: a status, a short summary, pointers to what it produced, and a pull request number. **Open worker** opens the worker's thread in the side panel.

A worker can write only its own report; it cannot change an item's title, acceptance condition or state. Its report is shown as plain text and the conductor is told to treat it as data, never as instructions.

## When workers finish

A worker that ends its turn wakes the conductor, as any delegated task does. The conductor reads the ledger, checks the work against the acceptance condition, and closes the item or gives the worker its next step.

## Archiving a conductor

When you archive a conductor that still has workers on open items, CMDeck offers to stop them first. A conductor with delegated workers still running cannot be archived until they stop.

## Limits

- The conductor is told not to edit files or run builds itself. Nothing enforces that beyond the thread's [permission mode](./permission-modes.md), and workers can never run with more access than their conductor, so pick a mode that suits both.
- A worker started by a conductor cannot be a conductor itself.
- Workers in a [linked environment](./remote-access.md#link-another-environment) do not report to the ledger.
