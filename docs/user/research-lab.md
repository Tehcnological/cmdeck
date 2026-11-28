# Research Lab

The Research Lab is a ready-made [workflow](./workflows.md) that researches a question in rounds and ends with a report:

1. An agent splits your question into a few focused sub-questions. It changes nothing.
2. You approve the list, ask for changes, or stop. To change it, choose **change** and say what you want, such as "drop the second one and add one about cost". The agent revises the list and you are asked again.
3. Each cycle runs several agents side by side, one per open question. Each reports what it found, with sources, and may suggest follow-up questions, which join the list.
4. Research stops when no questions are left, when a number of cycles in a row find nothing new, or at the cycle limit.
5. A last agent always writes the report, whichever way the research stopped. Its thread is the run's last one, and the report is in it.

## Add it

Open the command palette and choose **Add the Research Lab workflow**. It adds `research-lab.ts` to the workflows folder of your primary server, already approved, and opens it. This needs terminal access to that server.

## Start a run

Start it from a terminal on the server, or ask an agent to start it for you:

```sh
t3 workflow start research-lab --key sqlite-sync-1 --input '{
  "project": "/home/user/app",
  "question": "Which approach to syncing SQLite between devices fits this app best?"
}'
```

| Input        | Meaning                                                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project`    | The project's folder, or its id. The agents work there.                                                                                                  |
| `question`   | What you want answered.                                                                                                                                  |
| `questions`  | Optional. Your own sub-questions. The run uses them as given and does not ask you first, which suits scheduled runs.                                     |
| `cycles`     | Optional. Research cycles at most. 5 by default.                                                                                                         |
| `parallel`   | Optional. Agents per cycle. 3 by default. Research Lab runs on one server share this many places, so two runs at once do not double it.                  |
| `stagnation` | Optional. Stop after this many cycles in a row find nothing new. 2 by default.                                                                           |
| `format`     | Optional. `markdown` (the default) makes the report the last agent's reply. `html` shows it as a [visual reply](./html-renders.md) with a short summary. |

The run's result also holds the report, every finding with its sources, the questions still open, and why the research stopped.

## Good to know

- **Agents can read and run things.** "Change no file" is in their instructions, not enforced. Use a provider mode you are comfortable leaving unattended.
- Research reaches the web only through the agent's own tools. An agent without web access researches the project's files and what it already knows.
- An investigation that fails counts as finding nothing. The run carries on.
- Stopping at the list question ends the run without research or a report. Cancelling a run later ends it without a report.
- The run survives a server restart. Finished investigations are not run again.
