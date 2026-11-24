# Cloudflare Tunnel

Reach CMDeck from a browser anywhere through a Cloudflare Tunnel you run
yourself, with Cloudflare Access in front of it. Everything here works on
Cloudflare's free plans. CMDeck does not create, start, or manage the tunnel;
you run `cloudflared` and own the Cloudflare account.

For the T3 Code mobile apps, use [Tailscale](./remote-access.md#tailscale-https)
instead. Access signs people in with a browser cookie that the apps cannot
send, so the apps cannot get past Access. See [Phones and other apps](#phones-and-other-apps).

## Before you start

- A domain whose DNS is on Cloudflare (the free plan is enough), such as
  `example.com`. The tunnel gets a hostname under it, such as `t3.example.com`.
- CMDeck running on the host as a [background service](./background-service.md)
  or with `t3 serve`.
- Cloudflare ends TLS at its edge, so Cloudflare can see the traffic between
  your browser and CMDeck. Tailscale is end-to-end encrypted. Choose
  Tailscale if that matters to you.

### Pin the port

The tunnel forwards to a fixed local port. The background service picks a free
port when it starts, so set one in `~/.cmdeck/service.env`:

```dotenv
T3CODE_PORT=3783
```

Then run `t3 service restart`. For `t3 serve`, pass `--port 3783`.

Keep CMDeck on loopback (the default without `t3 up --lan`). `cloudflared`
connects to `localhost`, so nothing else on your network needs to reach the
port.

## 1. Install cloudflared

- macOS: `brew install cloudflared`
- Windows: `winget install --id Cloudflare.cloudflared`
- Debian or Ubuntu: add Cloudflare's package repository, then
  `sudo apt install cloudflared`. See
  [Cloudflare's downloads page](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
  for other systems.

## 2. Create the tunnel

Sign in once. This opens a browser, asks you to pick the domain, and saves a
certificate under `~/.cloudflared/`:

```sh
cloudflared tunnel login
```

Create a named tunnel. This prints the tunnel's ID and writes its credentials to
`~/.cloudflared/<tunnel-id>.json`:

```sh
cloudflared tunnel create t3code
```

Treat that credentials file like a password: anyone who has it can run your
tunnel.

## 3. Point the tunnel at CMDeck

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: <tunnel-id>
credentials-file: /home/you/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: t3.example.com
    service: http://localhost:3783
  - service: http_status:404
```

Use your own tunnel ID, home directory, hostname, and port. The last rule
answers anything else with 404.

## 4. Add the DNS route

```sh
cloudflared tunnel route dns t3code t3.example.com
```

This creates a proxied `CNAME` record for `t3.example.com` that points at the
tunnel. You can see it in the Cloudflare dashboard under your domain's **DNS**.

## 5. Put Cloudflare Access in front

Do this before you start the tunnel, so the hostname is never open without
sign-in.

1. Open [Cloudflare One](https://one.dash.cloudflare.com/) (Zero Trust). The
   first time, choose a team name and the **Free** plan (up to 50 users).
   Cloudflare may ask for a payment method; the Free plan is not charged.
2. Go to **Access → Applications → Add an application → Self-hosted**.
3. Name it, and set **Application domain** to `t3.example.com` with no path.
4. Add a policy with **Action: Allow**. Under **Include**, choose **Emails** and
   enter your address. Add anyone else who should reach CMDeck.
5. Choose login methods. **One-time PIN** emails a code and needs no setup. To
   use GitHub, first add it under **Settings → Authentication → Login methods**
   with a GitHub OAuth app, then select it for the application.
6. Save the application.

Access then asks every browser to sign in before any request reaches CMDeck.

## 6. Run the tunnel

Try it in a terminal:

```sh
cloudflared tunnel run t3code
```

To keep it running, install it as a system service. On Linux this reads
`/etc/cloudflared/config.yml`, so copy your config and credentials file there
and update `credentials-file` first:

```sh
sudo cloudflared service install
```

On macOS, `sudo cloudflared service install` installs a launch daemon that reads
`/etc/cloudflared/config.yml` as well. On Windows, run
`cloudflared service install` from an administrator terminal and see
[Cloudflare's service guide](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/local-management/as-a-service/).

## 7. Pair a browser

Access lets you reach the address; CMDeck still asks for its own pairing,
because Access sign-in is not a CMDeck login.

1. On the host, run `t3 pair`. It prints a URL such as
   `http://127.0.0.1:3783/pair#token=ABCD…`.
2. Replace the start of that URL with your hostname:
   `https://t3.example.com/pair#token=ABCD…`.
3. Open it in your browser. Sign in to Access, then CMDeck pairs the browser.

The pairing code works once and expires after 5 minutes (`t3 pair --ttl 15m`
for longer). To pair from a desktop app or another CMDeck client, use
**Add environment** with `https://t3.example.com` as the host and the code from
`t3 pair`; the client must be able to pass Access, which in practice means a
browser.

Revoke a browser in **Settings → Sharing & access** on the host, as for any
other device.

## Phones and other apps

The T3 Code iPhone and Android apps cannot sign in to Access, so requests from
them stop at Cloudflare. Use [Tailscale](./remote-access.md#tailscale-https)
for phones. Do not add an Access **Bypass** policy for the whole hostname to make
the apps work: that leaves only CMDeck's pairing between the internet and
your machine.

Scripts and other non-browser clients can pass Access with a service token:

1. In Cloudflare One, go to **Access → Service credentials → Service Tokens**
   and create a token. Copy the **Client ID** and **Client Secret**; the secret
   is shown once.
2. In your Access application, add a policy with **Action: Service Auth** that
   includes that service token.
3. Send both headers on every request:

   ```sh
   curl -H "CF-Access-Client-Id: <client-id>" \
        -H "CF-Access-Client-Secret: <client-secret>" \
        https://t3.example.com/...
   ```

The client still needs a CMDeck credential, such as a session from
`t3 auth session issue`.

## Webhooks

Scheduled-task webhooks are called at your server's own address, for example
`https://t3.example.com/api/hooks/<task>/<token>`. Webhook senders such as
GitHub cannot sign in to Access. To let them through, add a second Access
application for the path `t3.example.com/api/hooks` with a single **Bypass**
policy that includes **Everyone**. Requests there still need the secret token in
the URL, and the task's signing secret if you set one. Rotate the URL in the task
if it leaks.

## Free-plan notes

- Tunnels, DNS, and Access for up to 50 users are free. You do not need R2,
  Workers, Spectrum, or any paid add-on.
- Cloudflare limits request bodies on the free plan (100 MB), which caps large
  uploads through the tunnel.
- WebSockets work through the tunnel and Access without extra settings.
- Access sessions last 24 hours by default; change **Session Duration** on the
  application.

## Troubleshooting

- **502 or "Bad gateway"**: CMDeck is not listening on the port in
  `config.yml`. Check `t3 status` and `T3CODE_PORT`.
- **Redirect loop or blank page after sign-in**: make sure the application
  domain matches the tunnel hostname exactly.
- **Pairing says the code is invalid**: codes work once and expire. Run
  `t3 pair` again.
- **The app cannot connect**: expected behind Access. Use Tailscale for the
  apps.
