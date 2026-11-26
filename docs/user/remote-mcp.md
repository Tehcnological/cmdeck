# Remote MCP with a token

An MCP client that cannot do the [OAuth sign-in](./outside-agents.md), or that you
want to set up once from a config file, can reach an environment's MCP server with a
bearer token instead. It gets the same tools as any [outside agent](./outside-agents.md#what-outside-agents-can-call):
list projects and threads, start, read, wait on, message, queue to and stop threads.

The environment serves it at its own address, so you reach it however you reach the
environment: over [Tailscale HTTPS](./remote-access.md#tailscale-https) or a
Cloudflare Tunnel you run. Nothing goes through T3 Connect.

## Turn it on

On the host, open **Settings → Sharing & access** and turn on **Accept remote MCP
tokens** under **Remote MCP**. It takes effect at once, with no restart. Turning it off
refuses every token right away and closes their open requests, without deleting the
tokens. OAuth sign-ins keep working either way. A managed policy that does not allow
remote clients refuses every token, and the switch shows that.

On a headless server, set `T3CODE_REMOTE_MCP` where the server starts instead:

```bash
T3CODE_REMOTE_MCP=1 t3 serve --tailscale-serve
```

When the variable is set, it wins over the switch: `1` or `true` keeps tokens on,
`0` or `false` keeps them off, and Settings shows the switch locked. Remove the
variable to use the switch again. A value that is not a boolean keeps tokens off.

## Create a token

In **Remote MCP**, choose **Create token**, name the client (for example
`laptop-claude`), and pick what it may do:

- **Read only** reads projects, threads and the available models. It cannot change
  anything.
- The other modes also start, message, queue to and stop threads. A thread it starts or
  steers cannot run with more permissions than this mode. Only **Full access** can start
  or change [workflow runs](./workflows.md).

The token is shown once, with a **Copy** button. Copy it into the client's config right
away; CMDeck keeps only a hash of it and cannot show it again. Creating a token needs
permission to manage access on that environment, plus the permissions the token itself
grants. Agents signed in over MCP cannot create, list or revoke tokens.

The list under **Tokens** shows each token's name, access and creation time, never the
token. **Revoke** cuts a client off within a few seconds.

A token does not expire. Revoke it when you stop using the client, and create one token
per client so you can revoke them separately.

### From the command line

The same tokens can be managed on the host without the app, even while the server is
stopped:

```bash
t3 auth mcp-token create --label laptop-claude --access read-only
t3 auth mcp-token list            # ids, access, creation time, labels; never the tokens
t3 auth mcp-token revoke <id>
```

`--access` takes `read-only`, `approval-required`, `auto-accept-edits`, `auto` or
`full-access`. Pass `--base-dir` (or set `T3CODE_HOME`) if the environment does not use
the default data directory.

## Connect a client

The URL is the environment's address followed by `/mcp`. **MCP address** under **Remote MCP**
in Settings lists every address it knows for the machine, each with its own **Copy**: your
[Cloudflare Tunnel address](./cloudflare-tunnel.md#7-tell-cmdeck-the-address) when you have set
one, then Tailscale (the [Tailscale HTTPS](./remote-access.md#tailscale-https) name when
Tailscale Serve answers, else the tailnet IP), then the local network address, marked
**Local network only**. Only the desktop app knows the Tailscale and local network addresses; in
a browser, the list shows the tunnel or, without one, the address that browser uses. Every request sends `Authorization: Bearer <your-token>`.

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
can reach it. Plain `http://100.x.y.z:3783/mcp` also works on the tailnet, but sends
the token unencrypted on any hop Tailscale does not cover; prefer `https`.

### Over a Cloudflare Tunnel with Cloudflare Access

Run `cloudflared` on the machine and point a hostname at the local server, for example
`http://localhost:3783`. Put the hostname behind a Cloudflare Access application with a
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
- Keep the feature off unless you use it. Turning it off refuses every token without
  deleting them.
- Anyone who can reach the URL can try tokens. A token is 32 random bytes, so guessing
  is not practical, but put the endpoint behind Tailscale or Cloudflare Access rather
  than the open internet.
- Within a few seconds of revocation, the server refuses new requests using that
  token and closes its open requests, including `t3_thread_wait` and event streams.
- Token clients cannot register webhooks; use OAuth for bots that need webhook delivery.
- Tokens are stored as SHA-256 hashes in the environment's secrets directory. They are
  listed under **Remote MCP** in **Settings → Sharing & access**, not with the authorized
  clients.
