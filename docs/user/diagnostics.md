# Maintenance, power, and diagnostics

Control how aggressively CMDeck runs background checks, keep your computer awake while agents work, and inspect server health.

## Background activity and power

Configure under **Settings → Maintenance** (per environment):

- **Background activity**: Choose **Balanced**, **Performance**, or **Battery saver**—or expand **Advanced** to customize pausing on host lock / low-power / battery, **Git fetch interval**, and provider health check intervals.
- **Keep awake while agents work**: Prevents the host OS from sleeping while an agent turn is running.
- **Continue threads after restarts**: Automatically resumes supported active threads after an update, crash, or reboot ([details](./updating.md#continue-threads-after-restarts)).
- **Provider update checks**: Enables checking for newer provider CLIs and updated model catalogs.
- **Artifacts and logs / Delete now**: Manage disk cleanup ([Storage cleanup](./project-settings.md#storage-cleanup)) and database compaction ([Reclaim database space](./background-service.md#reclaim-database-space)).

## Diagnostics view

Open **Settings → Maintenance → Diagnostics** (select an environment) to inspect:

- Live server logs and recent failures
- CPU/memory resource history
- Running child processes (with controls to signal or stop them)

On mobile, startup crashes from the last 7 days are recorded on the device under **Settings → Diagnostics** for bug reports. Nothing is sent anywhere.

CMDeck has no trace export or `t3 trace` command; see [Telemetry](./telemetry.md).
