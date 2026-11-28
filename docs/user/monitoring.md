# Monitor loops, quiet turns and health monitoring

## Monitor loops

An agent can watch something for you on its own thread: CI on a branch, a deploy, a long job. Ask it to "keep an eye on CI and tell me when it is green", and it arms a loop with the `monitor_start` tool. The loop wakes the same thread with the agent's own instructions:

- **Every N minutes**, or **after the thread has been quiet for N minutes**. In the quiet mode, any turn in the thread, including one you start, restarts the wait.
- A loop always ends: after its number of wakes (10 unless the agent sets another), at its expiry (24 hours unless set), when the agent replies with its stop word, when it calls `monitor_stop`, or when you archive the thread. Your messages never extend the expiry.
- A wake is skipped while the thread is busy, so wakes never pile up behind a running turn.
- A loop is a scheduled task bound to the thread, so it appears in **Settings > Scheduled tasks** as **Monitor: …** and runs at the thread's own permissions. Pause or delete it there like any task. A loop that ends removes its task.
- Give the task a [check script](./project-settings.md#check-scripts) to wake the agent only when something changed: a wake whose check output is the same as last time is skipped without a model call.

With a [decision model](./decisions.md) set up and consented to, it may also hold back a wake whose check output needs nothing from the agent. It can never end a loop or hide a failing check.

## Quiet turns

When an automated turn (a scheduled task, a monitor loop, an event automation, or another agent's message) finds nothing worth telling you, the agent calls `nothing_to_report`. The turn shows as a compact **Checked, nothing to report** row and sends no notification to your channels. The tool is refused on a turn you started, so the agent still has to answer you.

## Health monitoring

**Settings > General > Health monitoring** watches for things that stop responding. It is off until you turn it on. Once a minute it checks, without any model:

- **Running turns**: a turn that has had no event from its provider for longer than the stall time (15 minutes unless changed) counts as not responding.
- **Linked environments**, when you turn on **Check linked environments**: each one is asked whether it answers, as the Linked environments page does.
- **Probes** you list, one per line as `name = target`: an `http://` or `https://` URL that should answer with a success status, or `host:port` for a TCP port. Each check gets 10 seconds.

Each check alerts once when it stops responding and once when it recovers, through your notification channels and the open app, never once per minute. A stalled turn that ends counts as recovered. The section lists each check's current state.

Probes are the only requests health monitoring makes. With no probes listed and linked environments unchecked, it contacts nothing.
