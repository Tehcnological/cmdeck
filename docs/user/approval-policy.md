# Approval policy

The approval policy declines approval requests that break rules you set, usually before you see them, and turns your own approval of such a request into a decline. Use it for things an agent should never do on this machine, whatever reason it gives: reading credential folders, running a command you have banned, or using a tool you do not trust.

Each decline is answered as **Declined**, recorded in the [audit log](./audit-log.md), and announced as an alert in the open app and on notification channels that take alerts. Claude also gets the reason, so it can carry on without the request.

## It only sees approvals the agent asks for

The policy acts on approval requests, so it does nothing in **Full access**, or for anything a provider approves on its own in **Auto** or **Auto-accept edits** (see [Permission modes](./permission-modes.md)). Run threads that need the policy in **Supervised**.

## Set rules

With no rules, nothing changes. Add rules under `cmdeck.approvalPolicy` in the server's `userdata/settings.json`; CMDeck applies a change as soon as the file is saved:

```json
{
  "cmdeck": {
    "approvalPolicy": {
      "protectedPaths": ["~/.ssh", "~/.aws", "~/.gnupg", "~/.kube", "~/.docker", ".env"],
      "denyCommands": ["\\bcurl\\b.*\\|\\s*(ba)?sh\\b"],
      "denyTools": ["WebFetch", "mcp__github__*"],
      "denyWritesOutsideWorkspace": true
    }
  }
}
```

| Rule                         | Declines                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `protectedPaths`             | Any request whose command, file names or tool input names the path, to read or to write. `~` is your home folder. A relative entry such as `.env` matches in any folder. |
| `denyCommands`               | Commands matching a regular expression (case-insensitive). While a pattern is not a valid expression, every command is declined and the reason says so.                  |
| `denyTools`                  | Tools by name, case-insensitive. End a name with `*` to match a prefix.                                                                                                  |
| `denyWritesOutsideWorkspace` | File changes outside the thread's working folder.                                                                                                                        |

Agents cannot change these rules through CMDeck's MCP tools. An agent with a shell could still edit `settings.json`, but only through a command you approve.

To set rules for every user on a machine and stop users from changing them, set each rule in a [managed policy](./managed-policy.md#settings) by its own path with `"locked": true`, for example `"cmdeck.approvalPolicy.protectedPaths": { "value": ["~/.aws"], "locked": true }`. Approving a request in the app does not get past a locked rule.

## Limits

- The rules match the text of a request. A command that builds a path at run time, for example from pieces or an encoded string, does not name it and is not caught. Prefer protecting whole folders such as `~/.aws`, and add a relative entry (`.aws`) to catch paths written relative to the working folder.
- A declined request can show for a moment as waiting before it is answered, and a notification channel may announce it in that moment. Approving it in that moment declines it.
- While any rule is set, **Always allow** answers approve only the request in front of you. Otherwise the provider would approve later requests itself, where the policy cannot see them.
- If CMDeck cannot check a request in the background, it stays with you, and CMDeck checks it again when you answer. An approval CMDeck cannot check is declined.
