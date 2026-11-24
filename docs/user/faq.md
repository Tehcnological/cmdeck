# FAQ

## Is CMDeck a harness?

No. A harness is what turns an LLM into an agent: it gives the model tools, a way to call them, runs them, and hands the results back. Claude Code is kind of a harness. It is an interface (the TUI, the Code tab in the desktop app) plus a harness underneath (the Anthropic Agent SDK). Codex is the same split: the app plus the Codex App Server. CMDeck uses those harnesses. It is not a harness, and it does not work without one.

Chef = LLM. Kitchen = harness. CMDeck = the restaurant that lets you bring whatever kitchen you want. Our MCP is a cookbook we hand the kitchen, but the chef won't open it unless you tell them to :) I wrote the long version here: [What is a harness?](https://t3.gg/blog/post/what-is-a-harness)

Bring your own: Claude Code, Codex, Cursor, Grok Build, OpenCode, Google Antigravity, Kiro, Pi, Muse Code, or fx. [Provider setup](./install.md#providers)

## Why use CMDeck instead of Claude Code or the Codex app?

We were inspired by the Codex desktop app, Conductor, Claude Desktop, and Cursor Glass, but none met our bar. What you get:

- Bring your own sub. Claude, Codex, and whatever else you already have installed.
- Best in class remote. Run `t3 up` on any box and drive it from anywhere.
- Best in class mobile app.
- Truly 100% open source code (MIT). If we go the wrong direction, fork it under your own branding.

Every harness feels nearly identical in here, so you can stop worrying about harnesses and focus on building :) [Install](./install.md)

## Can I use CMDeck with my Claude Code subscription?

Yes.

## How much does CMDeck cost?

Nothing. There's no way to pay us to use CMDeck. You bring your own sub. The source code is free and open source (MIT). You still pay your provider like you already do. [Install](./install.md)

## Can I fork or redistribute CMDeck?

Yes, for the source code. The [MIT License](../../LICENSE) applies only to the source code, not to the CMDeck name, wordmark, logos, or branding. If you publish a fork or custom build, you must replace CMDeck's branding with your own and make it unmistakably clear that your project is unofficial and not affiliated with T3 Tools, Inc. Using the CMDeck name, wordmark, logo, or branding without being explicitly clear that your project is unofficial, or indicating that an unofficial project is an official version of CMDeck, is unlawful and will be pursued to the full extent of the law. See [TRADEMARK.md](../../TRADEMARK.md).

## Why is my Claude 5-hour limit draining so fast?

It shouldn't anymore. CMDeck drives Claude through Anthropic's Agent SDK, and Anthropic's 5h meter used to charge Agent SDK usage about 1.7x more than using Claude Code directly. Weekly limits were never affected. Since v0.1.7, Claude in CMDeck drains your 5h limit at the same rate as Claude Code. Still seeing it? [Update CMDeck](./updating.md) on the machine that runs your agents. [My post on it](https://x.com/theo/status/2114166439813017873) · [Tracking issue](https://github.com/pingdotgg/t3code/issues/24649)

## How do I use CMDeck remotely?

Your agents run wherever CMDeck runs: your desktop, a server, a VPS. You connect to it from anywhere. I do this constantly. Less than 5% of my prompts run on my laptop. Run `t3 up` on that machine and you get really good remote support. Tailscale is the easy path; LAN pairing and your own Cloudflare Tunnel work too. [Remote access](./remote-access.md)

## How do I use CMDeck on my phone?

Get the [iOS](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824) or [Android](https://play.google.com/store/apps/details?id=com.t3tools.t3code) app, then connect it to your computer with a pairing link over Tailscale. The phone is a remote. Your computer does the work and needs to stay on. [Mobile setup](./install.md#mobile-app) · [Remote access](./remote-access.md)

## Where did T3 Connect go?

This build removes T3 Connect and never contacts T3's relay. Reach your machine with Tailscale (works with the phone apps) or your own Cloudflare Tunnel behind Cloudflare Access (browsers). [Remote access](./remote-access.md#choose-how-to-reach-the-host) · [Cloudflare Tunnel](./cloudflare-tunnel.md)

## Will I get banned for using my subscription?

No. We work with all of the labs and CMDeck is within the TOS of Claude Code, Codex, and Google Antigravity. We worked directly with [SpaceXAI](https://x.com/SpaceXSI/status/2070195830192320600) to collaborate on the Grok Build and Cursor integrations. Everything else uses official ACP bindings.

If it works in CMDeck, you can trust it is safe.

## Can I add a bunch of accounts for one provider?

I don't think CMDeck is the right place to manage a pile of accounts. If we add an auto-switcher, we are risking TOS bans for our users.

A separate work account is fine. Setup for two: [Codex](./providers-codex.md#use-multiple-accounts) · [Claude](./providers-claude.md#separate-accounts-or-configurations). For a bigger pool, manage them outside CMDeck with a self-hosted proxy like [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI). I walked through how I use 6 Claude subs and 3 Codex subs in [this video](https://www.youtube.com/watch?v=D8PikZ1KhUo), and wrote up the setup in [this guide](https://gist.github.com/t3dotgg/59a521d2ee8d70aaf90e280c175072af). Hand it to your agent and it will walk you through it. Early apologies if it gets you banned 💀 After you set up a hub, CMDeck can show its pooled limits under Usage. [Connect a hub](./usage.md#connect-a-cliproxyapi-hub)

## Can I use an API key or OpenRouter instead of a subscription?

Yes. Add another provider instance in Settings and give it its own keys and endpoint. Claude has a full OpenRouter recipe. Your subscription setup stays untouched. [OpenRouter](./providers-claude.md#openrouter) · [Provider instances](./install.md#providers)

## Does CMDeck support local models?

Yes, and this build puts them first. Point Pi, OpenCode, Claude, or Codex at Ollama, LM Studio, llama.cpp, vLLM, SGLang, or any OpenAI- or Anthropic-compatible server, then mark the instance as running local models. Local instances lead the model picker and write your thread titles and commit messages, and background writing never falls back to the cloud on its own. [Local models](./local-models.md)

## Does my code go to T3 servers?

No. Your code and prompts go from your machine to your provider (Anthropic, OpenAI, etc.), not to us. With T3 Connect, traffic rides a Cloudflare tunnel (`cloudflared` on your machine). Our relay sets up the link. It does not proxy your HTTP or WebSocket sessions. CMDeck sends no telemetry: no usage events, crash reports, or traces, on Tailscale, LAN, or T3 Connect. [Telemetry and network calls](./telemetry.md) lists the calls CMDeck does make, such as model catalog and update checks.

## Worktrees are eating my disk. How do I clean them up?

Open **Settings → Worktrees → Cleanup** and turn on automatic worktree cleanup. You can also run it now from there. Worktrees add up fast. One user cleared 500 GB. [Storage cleanup](./project-settings.md#storage-cleanup)

## Is there voice input?

Yes. On iPhone and Android, dictation uses on-device speech by default, with the option to use a paired environment. On macOS 26 or later, desktop users can choose Apple Speech directly under **On this Mac** or choose an environment. Web and other desktop users can enable dictation by choosing an environment. The transcript goes into your draft for review. See [Voice input](./voice-input.md).

## Does it work on Windows, Mac, and Linux?

Yes, all three. Desktop app, CLI, the works. One catch: there is no `t3` binary for Intel Macs, so use the desktop app there. Windows folks can also run agents inside WSL. [Install](./install.md)

## Why is my provider not showing up?

Almost always, the CLI is not installed or not on the `PATH` of the machine that runs the server. (Not your phone. The computer.) Log in on that machine first, like `codex login` or `claude auth login`. Still missing? Point **Binary path** at it in provider settings. Version managers love to cause this one. [Provider setup](./install.md#providers)
