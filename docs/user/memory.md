# Memory

CMDeck can remember rules and facts across threads and give them to agents at the start of each turn. Memory is off until you turn it on, and it stays on the server it was saved on.

## Turn it on

Open **Settings → Memory** and turn on **Remember across threads**. While it is off, nothing is given to agents, nothing is saved, and agents' memory tools refuse.

## Save something

- Type `/remember` followed by the text in a thread's composer, for example `/remember use pnpm, never npm`. It is saved as a rule for the thread's project and used from the next turn. The confirmation has **Undo**.
- Agents can propose items with their memory tools. A proposal is not used until you accept it.

A **rule** is given to every turn it applies to. A **fact** is given only when it matches what the turn is about.

## Review and edit

**Settings → Memory** lists what is saved. Filter by status (active, proposed, retired) and scope (everywhere, one project, every checkout of a repository, a bot, one thread).

- **Accept** a proposal to start using it.
- **Edit** changes the text or whether it is a rule or a fact. Scope and source stay as they are.
- **Retire** stops an item being used; **Restore** brings it back with the status it had, so a rejected proposal comes back as a proposal.
- **History** shows every change. **Restore this version** saves that version again as a new change.
- Select several items to accept, retire, restore or replace text in all of them. You see a preview of what changes before you apply it. If an item changed since you selected it, nothing is applied until you refresh.

Every change is kept, so every action can be undone.

## Lessons

CMDeck can learn from your chats: when you correct an agent ("no, use pnpm here"), it proposes that correction as a fact for the project. Lessons are off for every project.

1. Set a [decision model](./decisions.md#using-a-model). Lessons are read by that model, never by a hosted service.
2. In **Settings → Memory → Lessons**, choose a project's setting. **Local model only** reads the project's chats only while the decision model is on this machine, your local network or your tailnet. **Any model** allows whichever decision model you set.

A thread is read after it has been quiet for three hours, or sooner once 30 new messages have built up. Only what you typed and what the agent answered is read. Tool output, command and monitor output, messages from other threads, scheduled and webhook prompts are never read, so text an agent came across cannot become a lesson. Incognito and temporary threads are never read.

Each lesson arrives as a proposed fact for the project. Accept it to start using it, or edit it into a rule first if it should apply to every turn. Turning a project off stops any further reading; lessons you accepted stay until you retire them.

## Memory modes

The memory chip in the composer shows the thread's mode:

| Mode       | Uses saved memory | Saves new memory |
| ---------- | ----------------- | ---------------- |
| Persistent | Yes               | Yes              |
| Incognito  | Yes               | No               |
| Temporary  | No                | No               |

Choose **Promote to persistent** to go back. An agent can make its thread more private when you ask, but only you can make it less private. A forked thread, subagent or side chat starts with its parent's mode.

Memory kept by a provider itself, such as Claude Code project memory or Codex memories, is outside CMDeck's control and follows the provider's own settings.

## See what a thread was given

Choose **Memory used here** from the memory chip. The panel lists the items each turn received, newest first. The items are added to what the provider receives, never to the thread's messages, so they do not show in the transcript.
