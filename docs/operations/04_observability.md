# Observability

This fork has no tracing or telemetry export: no OTLP exporters, no trace file, and no analytics. Server diagnostics stay on the machine: pretty stdout logs (not persisted, except SSH-managed launches at `~/.t3/ssh-launch/<state>/server.log`), provider event logs under the logs directory, and event-loop stalls (>2 s) appended to `event-loop-stalls.ndjson` in the logs directory. Effect spans from `Effect.fn("Service.operation")` still name operations, but no tracer records or sends them; metrics live only in-process.

Logs directory: `<home>/userdata/logs` in production, `<worktree>/.t3/userdata/logs` for a linked worktree dev run, `~/.t3/dev/logs` otherwise.

## Heap snapshots

On macOS and Linux (not Windows), send `SIGUSR2` to the server PID from `server-runtime.json` (in the server's state dir beside `logs/`) to write `<logsDir>/server-<pid>-<timestamp>.heapsnapshot` for Chrome DevTools Memory tab:

```sh
pid="$(jq .pid "${T3CODE_HOME:-$HOME/.t3}/userdata/server-runtime.json")"
ps -p "$pid" -o command=   # verify it is the T3 server—never signal desktop or launcher
kill -USR2 "$pid"
```

- Writing pauses the server (up to a minute+ on large heaps) and needs roughly as much free RAM as the heap—send once, and avoid on a swapping host.
- Snapshots contain tokens, secrets, and thread content. Never share them publicly, and delete them manually when finished.
