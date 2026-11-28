# Remote access

Drive CMDeck from your phone, browser, or another desktop app while your agents run on a host computer or server. The host must stay awake and running while you work.

## Choose how to reach the host

This build of CMDeck has no T3 Connect: it never contacts T3's hosted relay,
signs in to a T3 account, or runs a tunnel that T3 provides. Every client
connects straight to your host. Pick one of these:

- **[Tailscale](#tailscale-https) (recommended).** Works with the desktop app,
  browsers, and the official iPhone and Android apps. Traffic stays end-to-end
  encrypted inside your tailnet, and nothing is exposed to the internet.
- **[Your own Cloudflare Tunnel](./cloudflare-tunnel.md).** A public HTTPS
  hostname behind Cloudflare Access, for browsers anywhere. You run
  `cloudflared`; enter its address in **Settings → Sharing & access →
  Cloudflare Tunnel** so pairing links and webhook addresses use it, and
  **Check** it from there. The mobile apps cannot sign in to Access, so use
  Tailscale for phones.
- **[The local network](#pair-over-a-lan-or-private-network)** or
  **[SSH](#desktop-managed-ssh)** when the devices can already reach each other.

Whichever route you use, a device gets in only by pairing: someone on the host
creates a one-time pairing link or code, and the device redeems it. Revoke a
device at any time in **Settings → Sharing & access** on the host. Closing the
desktop app's last window stops its local server; use the
[background service](./background-service.md) for unattended access.

`t3 connect`, `t3 up --connect`, and the T3 Connect settings are gone; in their
place, **Settings → Sharing & access** has **Cloudflare Tunnel** for your own
tunnel's address and **[Remote MCP](./remote-mcp.md)** for MCP clients that use a
token. A host
that was linked to T3 Connect before is unlinked on its next start, its managed
tunnel is not started again, and sessions that came through T3 Connect are
revoked. Pair those devices again over one of the routes above.

### Approve new devices

**Require approval for new devices** is on by default. A device that redeems a
pairing link, by scanning its QR code, opening its URL, or entering its code on
an outside agent's sign-in page, waits until someone approves it. Clients
already connected with access management show the request as a notification and
in **Settings → Sharing & access**, with the device's name, what it may do, and
when it asked. After you approve, pair the device again with the same link
within 10 minutes; until then the CMDeck and official T3 apps say the device is
waiting for approval on the host. **Deny** revokes the link, and so does
leaving a request unanswered for 10 minutes.

On a host without a desktop app, answer from its shell:

```bash
t3 auth pairing list-pending
t3 auth pairing approve <id>
t3 auth pairing deny <id>
```

These never wait: this machine's desktop app, sessions from
`t3 auth session issue`, the link `t3 serve` prints when it starts, app approval
and link codes created for an outside agent or linked environment, and
[remote MCP tokens](./remote-mcp.md). Turn the setting off to pair at once.
Create a fresh pairing link for each device, keep links private, and revoke
devices you no longer use.

`t3 auth connect-device list` and `t3 auth connect-device revoke <code>` still
show and revoke devices that were approved through T3 Connect earlier.

### Mobile notifications

Push notifications and Live Activity updates were delivered through T3's relay,
so they are off in this build. The mobile apps still show agent activity while
they are open and connected to the host.

## Pair over a LAN or private network

- **Desktop host**: Enable **Settings → Sharing & access → Network access** (restarts desktop) and create a one-time pairing link.
- **CLI host**: Run `t3 up --lan` (background service) or `t3 serve --lan` (foreground), then run `t3 pair` to generate a QR code / pairing URL (`t3code://pair` opens directly in the desktop app).
- **Direct mesh**: Besides the local network and Tailscale, the desktop app lists an address for each WireGuard or mesh VPN interface on the host (`wg*`, `tun*`, `tap*`, `nebula*`, ZeroTier `zt*`, and macOS `utun*`). On macOS, `utun` also names other VPN clients' tunnels, so pick the one that matches the other device's network. These are plain `http` addresses; only use them over a network you trust.
- **Browser**: Every pairing link opens your host's own web app at the address you picked (LAN, Tailscale IP, or Tailscale HTTPS). CMDeck never sends a device to T3's hosted app (`app.t3.codes`). Phone browsers need the Tailscale HTTPS address for clipboard and other secure-context features. For custom CAs on Android, install the CA certificate in Android security settings.
- **Session lifetime**: Paired devices stay signed in while active; sessions unused for 30 days must re-pair.

### Reach one machine several ways

A host can have multiple routes (LAN, Tailscale, VPN, a public URL such as your own Cloudflare Tunnel, or SSH). CMDeck automatically learns LAN and Tailscale routes when network access is enabled (so pairing once over Tailscale is enough to use the LAN at home), connects over the fastest working route, and switches back to higher-priority routes when you return home. Reorder or add routes in **Settings → Environments** (**Add route**). Each paired route has its own session and may grant different permissions.

### Tailscale HTTPS

Join both devices to a tailnet with [MagicDNS and HTTPS certificates](https://tailscale.com/docs/how-to/set-up-https-certificates) enabled (on Linux, grant [operator permission](https://tailscale.com/docs/reference/troubleshooting/linux/linux-operator-permission)).

- **Desktop**: Enable **Settings → Sharing & access → Tailscale HTTPS**.
- **CLI**: Run `t3 serve --tailscale-serve` or `t3 pair --tailscale` (use `--tailscale-serve-port` if 443 is taken; remove with `tailscale serve --https=443 --set-path=/ off`).
- **Phone**: Install Tailscale and join the same tailnet, then scan the QR code in the app's **Add environment**, or enter the `https://machine.tailnet.ts.net/` address and the pairing code.
- **Any browser on the tailnet**: Create a pairing link and pick **Tailscale HTTPS** ("Opens this machine's web app in a browser"). Scanning its QR code or opening the link loads `https://machine.tailnet.ts.net/pair` and signs that browser in.

### LAN fallback when Tailscale is off

A desktop app paired over Tailscale (plain or Tailscale HTTPS) can keep working when Tailscale is off but both machines are on the same local network.

1. On the host, turn on **Settings → General → LAN fallback → Allow LAN fallback**. It is off by default; while it is off the host opens nothing on the local network.
2. Connect the desktop app over Tailscale once. It learns a **LAN fallback** route in **Settings → Environments**, after the routes you paired.
3. When Tailscale stops answering, the desktop app switches to **LAN fallback**, and switches back once Tailscale answers again. The environment row shows the route in use ("via LAN fallback").

The fallback route is encrypted HTTPS with a certificate the host creates for itself. The desktop app learns that certificate's fingerprint over the Tailscale route and trusts only that certificate at those addresses, so no other machine on the network can stand in for the host. The host listens only on its private local addresses (`10.x`, `172.16.x` to `172.31.x`, `192.168.x`, and IPv6 `fc00::/7`) and closes connections from anywhere else. When its addresses change, connected desktop apps learn the new ones.

Only the desktop app uses this route. Browsers and the mobile app cannot check a pinned certificate, so they keep the routes you paired.

### Balance new threads across machines

On web and desktop with 2+ connected machines, enable **Settings → Environments → Load balancing** (per client) to auto-select a host for new threads in shared projects. Set each machine to **Prefer**, **Normal**, **Less often**, or **Manual only**.

### Choose where new threads start

On web and desktop with 2+ machines, set **Settings → Threads → New threads → Default environment** (per device) to start new threads on that machine whenever their project is there too. While it is offline, new threads start on the current machine and the composer says so. Load balancing, when on, picks the machine instead.

## Desktop-managed SSH

In the desktop app, open **Settings → Environments → Add environment → SSH** and enter a host or SSH alias (e.g. `user@example.com`). CMDeck downloads its runtime to `~/.cmdeck/runtime` on the Linux or Apple Silicon macOS host, starts or reuses a server, and manages port forwarding automatically.

- Provider CLIs must be on a non-interactive login shell's `PATH` (check with `ssh user@example.com 'sh -lc "command -v claude codex"'`).
- For 2FA/Duo hosts on macOS/Linux, enable SSH `ControlMaster` in `~/.ssh/config` and open a terminal SSH session first.
- Revoke unused SSH sessions in **Settings → Sharing & access** or `t3 auth session revoke <id>`.

## Browser on a remote environment

Browser tabs belong to the host environment so you and your agents share them from any device.

- **Streaming & local loading**: Web and mobile stream tabs from the host. In the desktop app, tabs you open for a remote environment load locally while routing `localhost` requests to the host over the **preview tunnel** (so element picker and annotations work locally).
- **Port forwarding (desktop)**: Forward any remote host port to your local `localhost` via the thread's **Servers** list or **Forwarded ports** in the command palette (`Cmd/Ctrl-click` forwards and opens in your browser).
- **Open on this device (mobile)**: Tap **Open on this device** on a streamed `localhost` tab or long-press a `localhost` link in chat for native touch scrolling.
- **Disable preview tunnel**: Turn off **Settings → Sharing & access → Preview tunnel** on the host (or via [managed policy](./managed-policy.md#other-capabilities)) to disable port forwarding and **Open on this device** (streamed tabs continue working).
- **Take control**: Click **Take control** before typing into an agent's tab, and release control when done.
- **Local servers**: CMDeck lists listening ports from your terminals and agents as `http://localhost:<port>` (set a script's **Preview URL** for HTTPS or subpaths). Disable discovery with `T3CODE_PORT_DISCOVERY=0`.

### Browser host setup

The first server browser tab downloads ~120 MB headless Chromium (shared with [HTML renders](./html-renders.md)). On Ubuntu 23.10+ or minimal Linux containers, run the one-time setup command on the host:

```sh
sudo t3 browser setup
```

This installs an AppArmor profile for Chrome's sandbox plus missing libraries and fonts. Never run the T3 server as root (Chrome's sandbox rejects root); if sandboxing is impossible on your host, set `T3CODE_SERVER_BROWSER_SANDBOX=0` in the server environment and restart.

## Link another environment

Link two CMDeck machines (beta) so agents on one can launch, message, delegate to, and manage threads on the other.

1. Enable **Settings → Labs → Linked environments** on **both** machines (or `"linkedEnvironmentsEnabled": true` in `userdata/settings.json`).
2. On the source machine, open **Settings → Environments → Linked environments → Link** (or drag from one machine's `+` to another on the Environments map, or run `t3 environment link <address> --pairing-code <code> --access <mode>`). Use **Link several…** or `--from <file>` for batch linking.
3. Links are one-way (tick **Also link … back** for two-way) and do not chain. Links expire after 30 days of inactivity and can be revoked in **Settings → Sharing & access** or **Forget**.

- **Access boundary**: Agents never get more permissions on the target than the link's access level or their own thread mode. Below Full access, linked agents can only modify threads they started and skip project setup scripts.
- **Delegation**: Agents can target a linked machine with `delegate_task`, or ask you to link an unlinked machine via an in-thread approval card.

### Read a linked machine's threads

Open a delegated task or thread link on a linked machine to follow it live (read-only) in the right panel without pairing your client directly. Click **Connect to interact** to pair and take action (one-click if the link has Full access and you can manage access). Files, images, and HTML renders stay on the remote machine until you connect directly.

## Manage or revoke access

Manage pairing links and active client sessions in **Settings → Sharing & access** or via `t3 auth --help`.

- **Scoped tokens**: Pass `--scope <scope>` (repeatable) to `t3 pair`, `t3 auth pairing create`, or `t3 auth session issue` to restrict permissions (e.g. `orchestration:read`, `source-control:write`, `filesystem:read`, `filesystem:write`, `terminal:operate`). Re-pair with a fresh link to change an existing client's scopes. The `relay:*` permissions belonged to T3 Connect and grant nothing in this build.
- Treat pairing URLs and codes as passwords—never paste them into logs or screenshots.

## Desktop app as a remote only

Switch off **Settings → Environments → Local environment** in the desktop app to run with no local server, WSL backend, or incoming connections while continuing to drive remote hosts through pairing or SSH (if a local background service uses the same CMDeck data folder, **Open in** still works locally).

## Troubleshooting

See [Outside agents](./outside-agents.md) for MCP connections, [Cloudflare Tunnel](./cloudflare-tunnel.md) for your own tunnel, and [T3 Connect troubleshooting](./t3-connect-troubleshooting.md) only for saved T3 Connect routes from an older install.
