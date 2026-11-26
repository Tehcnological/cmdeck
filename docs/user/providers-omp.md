# Oh My Pi (OMP)

[Oh My Pi](https://github.com/can1357/oh-my-pi) is a fork of the Pi coding agent. CMDeck runs it
through the same integration as [Pi](./providers-pi.md), so models, auth, extensions, launch
arguments, and CMDeck tools behave as described there. OMP keeps its own state in `~/.omp/agent`.

## Set Up OMP

1. Install OMP on the machine running the CMDeck server by one of the methods in its README,
   for example `bun install -g @oh-my-pi/pi-coding-agent`.
2. Run `omp` in a terminal and sign in to your model provider.
3. Open CMDeck Settings, enable OMP, and refresh the provider.

OMP is off until you enable it, even when `omp` is on the server's `PATH`. If `omp` is not on the
`PATH`, set OMP's binary path to the executable.

## Differences from Pi

- The usage view does not count OMP sessions.
- CMDeck has no minimum OMP version. If an OMP release changes its RPC mode, use Pi until CMDeck
  supports it.
