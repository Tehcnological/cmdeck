# Task Runner

The Task Runner is a ready-made [workflow](./workflows.md) that turns a goal into a reviewed change:

1. An agent reads the project and writes a spec and a task list. It changes nothing.
2. You approve the plan, ask for changes (with a note the agent revises from), or stop.
3. Each task runs in its own thread. The first one makes a worktree, and later tasks and the review work in that worktree.
4. After each task, your check command runs in the worktree. A task whose check fails goes back to its agent with the output, up to the number of tries you set. Then the run asks you to retry, skip the task, or stop.
5. A model you pick, ideally from another provider, reviews the finished change against the spec.
6. The run ends with the spec, what each task did, how many tries it took, and the review.

Set `stopAfterSpec` to stop after step 2. That is the **Spec Builder**: the run ends with the approved spec and starts no task.

## Add it

Open the command palette and choose **Add the Task Runner workflow**. It adds `task-runner.ts` to the workflows folder of your primary server, already approved, and opens it. This needs terminal access to that server.

## Start a run

Start it from a terminal on the server, or ask an agent to start it for you:

```sh
t3 workflow start task-runner --key greeting-1 --input '{
  "project": "/home/user/app",
  "goal": "Add a --greeting flag to the CLI",
  "verify": "npm test",
  "review": { "instanceId": "codex", "model": "<a Codex model>" }
}'
```

| Input           | Meaning                                                                                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project`       | The project's folder, or its id.                                                                                                                                                                                          |
| `goal`          | What you want built.                                                                                                                                                                                                      |
| `verify`        | Optional. A shell command that must exit with 0 after each task. Without it, a task passes when its agent finishes.                                                                                                       |
| `review`        | The model that reviews the work: `instanceId` is the provider (such as `codex` or `claude`, or the id of an extra instance you added), `model` its model id. Required unless `stopAfterSpec` is set. There is no default. |
| `baseRef`       | Optional. What the worktree starts from. `HEAD` by default.                                                                                                                                                               |
| `attempts`      | Optional. Tries per task before the run asks you. 3 by default.                                                                                                                                                           |
| `stopAfterSpec` | Optional. `true` ends the run with the approved spec.                                                                                                                                                                     |

Plan approvals and stuck tasks show up as questions on the Workflows page and in the mobile app. The run's threads are ordinary threads, so you can open one to see or steer its agent.

## Good to know

- **The check command runs as the server's user**, with that user's full access, in the run's worktree. The approval question shows the exact command before anything runs. Use only commands you would run yourself.
- Work stays uncommitted in the worktree. Commit, push or open a pull request from there when you are happy with it.
- The run survives a server restart. Finished tasks and checks are not run again.
