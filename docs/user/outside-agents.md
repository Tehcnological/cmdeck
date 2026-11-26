# Outside agents

Connect external agents (Claude Code or Codex in your terminal, ChatGPT, or any OAuth-capable MCP client) to your CMDeck environment over MCP to read projects/threads, launch and message threads, and monitor events.

## Quick setup

Open the command palette (`Cmd/Ctrl+K`) and run **Use CMDeck in another app (MCP)** (or open **Settings → Sharing & access**), pick your app, choose what it may do, and follow the prompts.

- The wizard gives the app the environment's own address followed by `/mcp`: the address this device is connected over, or this computer's when the environment runs here. Nothing goes through T3 Connect.
- Cloud assistants (like ChatGPT, Poke, or Claude) can only use it if that address is reachable from the internet, for example through a [Cloudflare Tunnel](./cloudflare-tunnel.md) you run. A Tailscale address only works from your own tailnet.
- When the app opens the sign-in page, paste the code the wizard gives you. A code works once, for 5 minutes, and approves only the level you picked.
- Clients without OAuth support can use a [remote MCP token](./remote-mcp.md) from **Settings → Sharing & access** or `cmdeck auth mcp-token create` instead.
- To copy the raw MCP endpoint (`https://<environment-address>/mcp`), open an environment's menu in **Settings → Environments → Copy MCP URL**. OAuth requires `https://` or `localhost` (plain `http://` LAN/Tailscale addresses such as `http://100.x.y.z:3783` cannot complete OAuth).

### CLI clients and ChatGPT

- **Claude Code**:
  ```sh
  claude mcp add --transport http t3 https://<environment-address>/mcp
  claude mcp login t3   # add --no-browser on headless hosts
  ```
- **Codex**:
  ```sh
  codex mcp add t3 --url https://<environment-address>/mcp
  codex mcp login t3    # add --no-browser on headless hosts
  ```
- **ChatGPT / other OAuth MCP clients**: Add a custom remote MCP server pointing to `https://<environment-address>/mcp` (a public `https` address, such as your Cloudflare Tunnel) with **OAuth** authentication (no client ID or secret needed).

## Approve access and permissions

The first time an outside agent connects, approve its sign-in page (via an already-authorized browser, or a one-time code from **Use CMDeck in another app (MCP)**, **Settings → Sharing & access**, or `t3 auth pairing create`).

- **Read only**: Inspect projects, threads, providers, and models.
- **Supervised → Full access**: Also launch, message, and stop threads up to the granted permission mode. Managing [workflow runs](./workflows.md) or using approval-skipping agent modes requires **Full access** (or your policy's maximum mode).
- Sign-ins last **30 days**; revoke anytime in **Settings → Sharing & access**.

## Available tools and limits

Tools that act as a running T3 thread (`delegate_task`, `create_threads`, `request_secret`, `html_render`, `preview_*`, `device_*`, `t3_worktree_handoff`) only work for agents running **inside** CMDeck.

- Use `t3_thread_launch` + `t3_thread_wait` / `t3_thread_read` to run and follow work.
- Pass `projectId` or `threadId` explicitly (or `allProjects: true` on `t3_thread_list`).
- **MCP Events (`io.modelcontextprotocol/events`)**: Bots can poll, stream, or subscribe via HTTPS webhooks (up to 1-hour leases; latest 1,000 milestones buffered in memory) for turn, approval, guest, PR watch, and workflow events. For local webhook testing, set `T3CODE_MCP_WEBHOOK_ALLOWED_HOSTS=localhost,127.0.0.1` on the server.

## Host scripts (`t3 thread`)

On the server machine itself, drive threads directly without OAuth:

```sh
id=$(t3 thread start . "Find why the tests are slow")
t3 thread send "$id" "Now fix it" --wait
t3 thread show "$id"
t3 thread list
```

- Pass `--worktree <base-branch>`, `--title` / `--generate-title`, `--provider <id> --model <slug>`, `--option id=value` (e.g. `reasoningEffort=high` for Codex, `effort=high` for Claude), or `-` to read the prompt from stdin.
- `--wait` prints the reply and exits `1` on failure/stop or `2` when waiting for user input. Add `--json` for structured output including the thread ID.
