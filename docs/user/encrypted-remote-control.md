# Encrypted remote control

CMDeck can encrypt a remote session end to end, on top of whatever carries it.
A device paired while this is on checks the host's identity key on every
connect and encrypts everything it sends over the session's live connection, so
a proxy, tunnel or network in between sees only ciphertext. It is off by
default.

Two separate host settings live in **Settings → Sharing & access**:

- **End-to-end encryption** encrypts the session itself, whichever way the
  device connects (LAN, Tailscale, SSH, a Cloudflare Tunnel).
- **Private transports only** refuses remote connections that do not arrive over
  this machine, Tailscale, or SSH. Tunnels, reverse proxies and plain LAN
  addresses get an error instead.

## Turn it on

1. On the host, open **Settings → Sharing & access** and turn on **End-to-end
   encryption**. The row shows the host's key fingerprint.
2. Pair each device again with a new link from **Create link**, `cmdeck pair`
   (or `t3 pair`), or the pairing URL `t3 serve` prints. Links made while
   encryption is on carry the host's key, and the device remembers it.

A device paired before you turned encryption on keeps connecting the old way
until you pair it again. Its connection row says **E2EE** once it is pinned.

To check that the link was not tampered with, hover the device's connection
status in **Settings → Environments** on web or desktop: it shows the host key fingerprint the
device pinned, which should match the one in the host's settings. The
fingerprint covers the whole key.

## Turn it off, or re-pair

Turning **End-to-end encryption** off works right away, but devices paired while
it was on refuse to connect: they will not fall back to an unencrypted session.
Pair them again once it is off, or turn it back on.

If a device says the host's identity key changed, either the host's key was
replaced (for example after a reinstall without your data folder) or something
between you and the host is impersonating it. Pair again only if you know which.

## What it protects, and what it does not

Protected: everything sent over the session's connection after pairing, such as
threads, messages, terminal output, settings and approvals. On web and desktop
this also covers attachments: files and images you attach (picked, pasted or
dropped) are uploaded through the encrypted session, and images shown in a
thread, image and app icons in messages, and **Save** or **Copy** on an image
are downloaded through it too.

Not protected by it, so they still rely on the transport (Tailscale, SSH or
TLS):

- **Other files and previews.** Videos and audio, file previews (PDF, HTML and
  other documents), app previews, the browser and simulator panes, and images
  from pull requests still load over plain HTTP requests.
- **The mobile app's attachments.** The mobile app encrypts the session but
  still uploads and shows attachments over plain HTTP requests.
- **Pairing itself.** The pairing link and the first exchange that turns it into
  a session use plain HTTP requests. Send links over a channel you trust.
- **The web app's code.** A browser that loads CMDeck through a tunnel or proxy
  gets its code from there too, so whoever controls that path could change it.
  For an untrusted path, use the desktop app or a browser that loads CMDeck from
  a trusted origin.

## Private transports only

With **Private transports only** on, CMDeck answers remote requests only from
this machine, Tailscale addresses (including Tailscale Serve on this machine),
and SSH port forwards. Cloudflare Tunnel, Tailscale Funnel, reverse proxies and
plain LAN addresses are refused with `REMOTE_TRANSPORT_NOT_ALLOWED`.

Two limits to know:

- A forwarder on this machine that adds no proxy headers of its own (such as
  `socat`, an SSH `-R` reverse forward, or another raw TCP tunnel) looks like a
  local connection. Do not run one in front of CMDeck if you rely on this
  setting.
- Tailscale's IPv4 addresses come from the `100.64.0.0/10` carrier-grade NAT
  range, which other VPNs and some ISPs also use. Addresses in that range count
  as Tailscale.

## The official T3 Code apps

The official T3 Code mobile and web apps do not support this encryption. They
keep connecting as before while encryption is on, without its protection.

The host also has a stricter mode that refuses every remote connection without
end-to-end encryption. It is not in Settings because it locks out the official
apps; set it in the host's `settings.json` only if every device you use is
CMDeck:

```json
{ "e2eeMode": "require" }
```

Connections from this machine itself are still allowed without encryption.
In this mode the host also refuses remote file downloads and uploads over plain
HTTP, so remote devices can no longer play videos or open the previews listed
above.
Change it back to `"prefer"` (on) or `"off"` to let the official apps in again.
