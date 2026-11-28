# Containers

CMDeck can run a thread's agent and its terminals in a container. Inside, the agent sees its
worktree (read-write) and the paths you add, and nothing else on the computer: your home folder,
other projects, `~/.ssh` and `~/.aws` stay out unless you list them.

**A container is not a virtual machine.** It shares the host's kernel, so a kernel bug can let
code escape it. Docker Desktop (Windows, macOS) and Apple `container` (macOS) run containers
inside a VM of their own, which isolates more strongly; on Linux, Docker can use gVisor (`runsc`)
for a stronger boundary.

## Set it up

1. Install Docker (or, on a Mac with Apple silicon and macOS 26, Apple's `container` CLI) on the
   machine that runs CMDeck's server. CMDeck uses the local engine only; if `DOCKER_HOST` or the
   current Docker context points at another machine, containers stay off and Settings says why.
2. Build an image that has the agent's CLI and a shell. For Claude:

   ```dockerfile
   FROM node:22-slim
   RUN npm install -g @anthropic-ai/claude-code
   ```

3. Give the agent a credential it can use inside: set `CLAUDE_CODE_OAUTH_TOKEN` (from
   `claude setup-token`) or `ANTHROPIC_API_KEY` in the server's environment or the Claude
   provider's environment. Both pass into the container by name.
4. In **Settings → General → Containers**, enter the image, then turn containers on for a project.
   To change one thread, open the command palette in that thread and choose **Run this thread in
   a container** or **Run this thread on the host**.

Changes apply the next time the agent or a terminal starts. Turning a container off is recorded
in the audit log (**Settings → Diagnostics**). Agents can turn a container on for their own thread,
never off, and never for a whole project.

## What runs inside

- **Claude** runs inside. Codex shares one process across all its threads, and other agents start
  outside CMDeck's launcher, so a thread set to a container refuses to start on them instead of
  running on the host.
- **Terminals** of that thread open a login shell in the image.
- Checkpoints, diffs and Git operations in the app still run on the host.

## The recipe

| Field                 | Meaning                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime               | Docker, or Apple `container`. An option that cannot run here is disabled with the reason.                                                                                                                                                                                                                                                                                                                  |
| OCI runtime           | Shown when Docker lists one besides its default, such as `runsc` (gVisor).                                                                                                                                                                                                                                                                                                                                 |
| Image                 | The image every sandboxed thread starts from.                                                                                                                                                                                                                                                                                                                                                              |
| Network               | `none` (default) turns networking off. That also stops the agent reaching its model API, so name a Docker network (for example `bridge`) for agents that call a cloud API. Every change to a network other than `none` is recorded in the audit log. The host's network (`host`) and another container's (`container:<name>`) are refused: they reach CMDeck and every service on this machine's loopback. |
| CPUs, Memory          | Passed to `--cpus` and `-m`.                                                                                                                                                                                                                                                                                                                                                                               |
| Extra mounts          | One host path per line, mounted at the same path; end a line with `:ro` for read-only.                                                                                                                                                                                                                                                                                                                     |
| Environment variables | Names passed into the container. Provider credentials (`ANTHROPIC_*`, `CLAUDE_CODE_*`, `OPENAI_*`) pass by name; values never appear on a command line.                                                                                                                                                                                                                                                    |

The worktree is mounted at the same path it has on the host (on Windows, `C:\work\app` becomes
`/c/work/app`). The repository's `.git/config`, `config.worktree` and `hooks` are mounted
read-only, so code in the container cannot plant a hook that your next `git` command on the host
would run. Apple `container` cannot mount read-only: the container gets copies of those files, and
its changes to them are thrown away.

## Limits

- A thread in a container gets no MCP servers: neither CMDeck's own tools nor ones you set up for Claude. An agent that holds CMDeck's credential could start or steer threads that run on the host, and a named network can still reach this machine (Docker Desktop's `host.docker.internal`, for one).
- Agent settings that point at host paths (a Codex home, a Claude settings file) work only if you
  mount them.
- Containers are labelled with their thread. Archiving a thread removes its containers, and
  CMDeck removes any left behind when it starts again.
