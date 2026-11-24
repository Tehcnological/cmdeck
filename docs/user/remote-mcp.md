# Remote MCP with a token

An MCP client that cannot do the [OAuth sign-in](./outside-agents.md), or that you
want to set up once from a config file, can reach an environment's MCP server with a
bearer token instead. It gets the same tools as any [outside agent](./outside-agents.md#what-outside-agents-can-call):
list projects and threads, start, read, wait on, message, queue to and stop threads.

The environment serves it at its own address, so you reach it however you reach the
environment: over [Tailscale HTTPS](./remote-access.md#tailscale-https) or a
Cloudflare Tunnel you run. Nothing goes through T3 Connect.

## Turn it on

Tokens are refused until the server starts with `T3CODE_REMOTE_MCP=1` in its
environment:

```bash
T3CODE_REMOTE_MCP=1 t3 serve --tailscale-serve
```

For the background service or the desktop app, set the variable where that process
starts. Without it, every token gets `401`, and OAuth sign-ins keep working as before.
A managed policy that does not allow remote clients also refuses every token.

## Create a token

On the machine that runs the environment:

```bash
t3 auth mcp-token create --label laptop-claude --access read-only
```

The token is printed once. Copy it into the client's config right away; T3 Code keeps
only a hash of it and cannot show it again. `--access` is required:

- `read-only` reads projects, threads and the available models. It cannot change
  anything.
- `approval-required`, `auto-accept-edits`, `auto` or `full-access` also start,
  message, queue to and stop threads. A thread it starts or steers cannot run with more
  permissions than this mode. Only `full-access` can start or change
  [workflow runs](./workflows.md).

```bash
t3 auth mcp-token list            # ids, access, creation time, labels; never the tokens
t3 auth mcp-token revoke <id>
```

A token does not expire. Revoke it when you stop using the client, and create one
token per client so you can revoke them separately. Pass `--base-dir` (or set
`T3CODE_HOME`) if the environment does not use the default data directory.

## Connect a client

The URL is the environment's `https` address followed by `/mcp`. Every request sends
`Authorization: Bearer <your-token>`.

### Claude Code

```bash
claude mcp add --transport http t3 https://<machine>.<tailnet>.ts.net/mcp \
  --header "Authorization: Bearer <your-token>"
```

### Claude Desktop and other config-file clients

Claude Desktop's own remote connectors only sign in with OAuth and connect from
Anthropic's servers, which cannot reach your tailnet. Use a local bridge such as
`mcp-remote` instead, in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "t3": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://<machine>.<tailnet>.ts.net/mcp",
        "--header",
        "Authorization:${T3_MCP_AUTH}"
      ],
      "env": { "T3_MCP_AUTH": "Bearer <your-token>" }
    }
  }
}
```

The value goes through `env` because some clients split arguments on spaces. Any other
client that supports remote MCP over HTTP with custom headers works the same way.

### Over Tailscale

Use the `https://<machine>.<tailnet>.ts.net/mcp` address from
[Tailscale HTTPS](./remote-access.md#tailscale-https). Only devices on your tailnet
can reach it. Plain `http://100.x.y.z:3773/mcp` also works on the tailnet, but sends
the token unencrypted on any hop Tailscale does not cover; prefer `https`.

### Over a Cloudflare Tunnel with Cloudflare Access

Run `cloudflared` on the machine and point a hostname at the local server, for example
`http://localhost:3773`. Put the hostname behind a Cloudflare Access application with a
**Service Auth** policy, and create a service token for the client. The client then sends
three headers:

```bash
claude mcp add --transport http t3 https://t3-mcp.<your-domain>/mcp \
  --header "CF-Access-Client-Id: <access-client-id>" \
  --header "CF-Access-Client-Secret: <access-client-secret>" \
  --header "Authorization: Bearer <your-token>"
```

With `mcp-remote`, repeat `--header` for each one. Cloudflare Access stops anyone
without the service token at Cloudflare's edge, and the environment still checks the
bearer token.

### What a proxy must do

- Terminate TLS and send `X-Forwarded-Proto: https`, so links and upload URLs the tools
  return use `https`. Tailscale Serve and `cloudflared` do this.
- Keep the original `Host` header, or set it to the public hostname. Returned links use
  it.
- Pass `Authorization` through, and add no `Origin` header. `/mcp` refuses any request
  with an `Origin` header, since a browser page must not drive it.
- Stream responses without buffering; `t3_thread_wait` and event streams hold a request
  open.

## Security notes

- A token with a runtime mode can make agents run commands on this machine as your OS
  user. Treat it like an SSH key: keep it out of shared config, chat and source control,
  and prefer `read-only` when that is enough.
- Keep the feature off unless you use it. Turning off `T3CODE_REMOTE_MCP` refuses every
  token without deleting them.
- Anyone who can reach the URL can try tokens. A token is 32 random bytes, so guessing
  is not practical, but put the endpoint behind Tailscale or Cloudflare Access rather
  than the open internet.
- Within a few seconds of revocation, the server refuses new requests using that
  token and closes its open requests, including `t3_thread_wait` and event streams.
- Token clients cannot register webhooks; use OAuth for bots that need webhook delivery.
- Tokens are stored as SHA-256 hashes in the environment's secrets directory. They do
  not appear in **Settings → Sharing & access**; use `t3 auth mcp-token list`.
