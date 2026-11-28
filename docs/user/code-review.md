# Code Review

The Code Review is a ready-made [workflow](./workflows.md) that reviews pull requests and drafts the review for you:

1. It reads the pull request and works out what to review: the whole change the first time, and only the new commits after that. A force push that rewrote the reviewed commits is reviewed whole again.
2. It rates the change from the diff alone, without a model: sensitive paths (auth, sessions, secrets, migrations, infrastructure), CI configuration, lockfiles, binary files, very large files, removed guard checks and new imports.
3. An agent reviews the change in its own checkout of the pull request's head. It runs with the most restrictive permission mode, so it asks before running a command or changing a file. When checks fail, it reads their logs, which can ask for your approval first.
4. You get a question under **Needs you** with the review exactly as it would be posted. Choose **post** to add it to the pull request as one comment, or **discard**. Nothing is posted until you choose **post**, unless you turn on auto-post. A review with no findings is not posted or asked about.

## Add it

Open the command palette and choose **Add the Code Review workflow**. It adds `code-review.ts` to the workflows folder of your primary server, already approved, and opens it. This needs terminal access to that server.

## Review one pull request

Start a run from a terminal on the server, or ask an agent to start one:

```sh
t3 workflow start code-review --key app-pr-7 --input '{
  "project": "/home/user/app",
  "url": "https://github.com/acme/app/pull/7",
  "reviewers": [{ "instanceId": "codex", "model": "gpt-6.1-terra" }]
}'
```

| Input       | Meaning                                                                                                                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project`   | The project's folder, or its id. The pull request's repository must be checked out there with an `origin` remote the head can be fetched from.                                                                       |
| `url`       | The pull request's web address.                                                                                                                                                                                      |
| `reviewers` | Optional. Review models in order of preference. The first one from another provider than the one the pull request names as its writer (in its branch or description) is used. Without it, the default model reviews. |
| `autoPost`  | Optional. `true` posts the review without asking. Off unless you set it.                                                                                                                                             |

## Review a project's pull requests automatically

Tell the workflow which projects to follow. Each project is one entry in the workflow store, under a name of your choice after `code-review/project/`:

```sh
t3 workflow store set code-review/project/app '{
  "project": "/home/user/app",
  "reviewers": [{ "instanceId": "codex", "model": "gpt-6.1-terra" }],
  "autoPost": false
}'
```

Every 5 minutes the `code-review-sweep` run lists the project's open pull requests and starts a review for each new head commit of:

- pull requests opened after the project was added, and
- pull requests reviewed before, such as one you started by hand.

Draft pull requests are skipped unless the entry has `"drafts": true`. With no project entries, the sweep asks the host nothing. To stop following a project, delete its entry with `t3 workflow store delete code-review/project/app`, or ask an agent to.

## Auto-post

Auto-post is off unless an entry or a run's input says `"autoPost": true`. Runs with it on are titled **(auto-post)** and tagged `auto-post`, so `t3 workflow list --tag auto-post` shows them. Mentions of people in a posted review are broken so nobody is pinged by it.

## Good to know

- The pull request's title, description, diff and check logs are treated as untrusted: they are fenced, cut to size, and mentions that would trigger skills, files or commands are broken before the agent sees them.
- The review is posted as one comment that lists every finding with its file and line, not as separate line comments.
- The workflow fetches the head and base branches from `origin` into the project's checkout. It does not check anything out there.
- Which head was reviewed last is kept per pull request in the workflow store, under `code-review/reviewed/<url>`.
