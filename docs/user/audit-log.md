# Audit log

CMDeck keeps a local record of security-relevant actions on each machine:

- approvals an agent asked for, once answered or expired
- device pairing approvals
- remote MCP tokens created, revoked or used (use is recorded at most once an hour per token)
- secrets handed to an agent, as a one-use reference's value or a file
- imports with `cmdeck import`

Entries hold ids, labels and kinds, never secret values; text that looks like a token or key is redacted before it is stored. Nothing leaves the machine. Entries older than 180 days are removed once a day.

## View and verify

Open **Settings → Maintenance → Diagnostics → Audit Log** and choose **Show entries** or **Verify chain**. Viewing needs access permission on the environment.

From a terminal, on the machine itself:

```sh
cmdeck audit verify
```

It reports how many entries it checked, or the first entry that is broken, and exits with an error then. It only reads the database, so it works while CMDeck runs.

## What verification proves

Each entry stores the hash of the one before it, so changing or deleting a stored entry breaks the chain at that point. Removing old entries keeps the chain checkable: CMDeck records the last removed entry's hash and continues from it.

Approvals are recorded from CMDeck's live event feed. If the server is overwhelmed by a burst of activity, an approval can be missed without breaking the chain, so the log shows approvals that happened, not every one.

The log is **tamper-evident, not tamper-proof**. Anyone who can write this machine's database can rewrite the whole chain consistently, and removing the newest entries leaves no trace. Treat a passing check as "nothing was edited by accident or by a careless hand", not as proof against someone with access to your account.
