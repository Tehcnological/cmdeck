# FAQ

## Is CMDeck a harness?

No. A harness turns an LLM into an agent (tools, execution loop, and results)—like Claude Code's Agent SDK or Codex App Server. CMDeck drives those harnesses through one fast interface; it does not work without at least one installed agent.

Bring your own: Claude Code, Codex, Cursor, Grok Build, OpenCode, Google Antigravity, Kiro, Pi, Muse Code, fx, or any [ACP agent](./providers-acp.md). See [Provider setup](./install.md#providers). (Longer read: [What is a harness?](https://t3.gg/blog/post/what-is-a-harness))

## Why use CMDeck instead of Claude Code or the Codex app?

- **Bring your own subscription**: Use Claude, Codex, and every other agent you already have installed in one place.
- **Remote-first**: Run `t3 up` on any box and drive it from anywhere.
- **Native mobile app**: Approve steps, review PRs, and steer threads from iOS and Android.
- **Open source (MIT)**: Fork the source code under your own branding if you ever want something different.

## Can I use CMDeck with my Claude Code subscription?

Yes.

## How much does CMDeck cost?

Nothing. There's no way to pay us to use CMDeck. You pay your own model/agent providers, and the source code is free and open source (MIT). See [Install](./install.md).

## Can I fork or redistribute CMDeck?

Yes, for the source code. The [MIT License](../../LICENSE) covers source code only—not CMDeck's trademarks, name, wordmark, logos, or icons. Any public fork or build must use its own branding and clearly state that it is unofficial and not affiliated with T3 Tools, Inc. See [TRADEMARK.md](../../TRADEMARK.md).

## Why is my Claude 5-hour limit draining so fast?

Since v0.1.7, Claude in CMDeck drains your 5-hour limit at the same rate as Claude Code directly (an earlier Anthropic Agent SDK discrepancy has been resolved). If you still see it, [update CMDeck](./updating.md) on the machine running your agents.

## How do I use CMDeck remotely?

Your agents run wherever the CMDeck server runs (desktop, server, or VPS). Run `t3 up` on that machine and connect via Tailscale, LAN pairing, or your own Cloudflare Tunnel. See [Remote access](./remote-access.md).

## How do I use CMDeck on my phone?

Install the [iOS](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824) or [Android](https://play.google.com/store/apps/details?id=com.t3tools.t3code) app and connect it to your computer with a pairing link over Tailscale. The phone is a remote control—your host computer runs the agents and must stay on. See [Mobile app](./install.md#mobile-app) and [Remote access](./remote-access.md).

## Where did T3 Connect go?

This build removes T3 Connect and never contacts T3's relay. Reach your machine with Tailscale (works with the phone apps) or your own Cloudflare Tunnel behind Cloudflare Access (browsers). [Remote access](./remote-access.md#choose-how-to-reach-the-host) · [Cloudflare Tunnel](./cloudflare-tunnel.md)

## Will I get banned for using my subscription?

No. CMDeck stays within the TOS of Claude Code, Codex, Google Antigravity, Grok Build, Cursor, and official ACP bindings.

## Can I add a bunch of accounts for one provider?

CMDeck intentionally does not include an automatic multi-account switcher to avoid risking provider TOS bans. Adding a separate work/personal account is supported ([Codex](./providers-codex.md#use-multiple-accounts), [Claude](./providers-claude.md#multiple-accounts-and-presets)). For larger pools managed externally (e.g. via [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)), CMDeck can display pooled limits under Usage ([Connect a hub](./usage.md#connect-a-cliproxyapi-hub)).

## Can I use an API key or OpenRouter instead of a subscription?

Yes. Add another provider instance in **Settings → Providers** with its own environment variables and endpoint (your subscription setup stays untouched). See [OpenRouter for Claude](./providers-claude.md#openrouter-and-local-routers) and [Providers](./install.md#providers).

## Does CMDeck support local models?

Yes, and this build puts them first. Point Pi, OpenCode, Claude, or Codex at Ollama, LM Studio, llama.cpp, vLLM, SGLang, or any OpenAI- or Anthropic-compatible server, then mark the instance as running local models. Local instances lead the model picker and write your thread titles and commit messages, and background writing never falls back to the cloud on its own. [Local models](./local-models.md)

## Does my code go to T3 servers?

No. Your code and prompts go from your machine to your provider (Anthropic, OpenAI, etc.), not to us. With T3 Connect, traffic rides a Cloudflare tunnel (`cloudflared` on your machine). Our relay sets up the link. It does not proxy your HTTP or WebSocket sessions. CMDeck sends no telemetry: no usage events, crash reports, or traces, on Tailscale, LAN, or T3 Connect. [Telemetry and network calls](./telemetry.md) lists the calls CMDeck does make, such as model catalog and update checks.

## Worktrees are eating my disk. How do I clean them up?

Enable automatic cleanup or run **Delete now** in **Settings → Worktrees → Cleanup**. See [Storage cleanup](./project-settings.md#storage-cleanup).

## Is there voice input?

Yes—on-device speech on iOS, Android, and macOS 26+ desktop, or via a paired environment on web/desktop/mobile. See [Voice input](./voice-input.md).

## Does it work on Windows, Mac, and Linux?

Yes, all three (desktop app and CLI). Note: there is no standalone `t3` binary for Intel Macs (use the desktop app there), and Windows users can also run agents inside WSL. See [Install](./install.md).

## Why is my provider not showing up?

Usually the provider CLI is not installed, not signed in, or not on the `PATH` of the **server machine** (especially with version managers). Authenticate on the server machine first (e.g. `codex login` or `claude auth login`) and set **Binary path** in **Settings → Providers** if needed.
