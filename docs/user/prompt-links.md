# Prompt links

A prompt link opens CMDeck with a prefilled draft—useful for sharing prompts or adding one-click fixes in pull request comments.

Links **never** auto-send or change your permission mode, branch, or worktree. They only open a draft for you to review and send.

## Create a link

Links point at your host's own web app, at the address you opened CMDeck from in the browser (for example its Tailscale HTTPS name). The desktop window has no web address to share, so it does not offer prompt links; open CMDeck in a browser to copy one.

- **From the composer**: Open the command palette and choose **Copy prompt link** (or **Copy prompt link with repo and model** on GitHub projects).
- **From a sent message**: Click **Copy prompt link**.
- **By hand** (URL-encode the prompt, e.g. with `encodeURIComponent`), with your host's address:

```text
https://machine.tailnet.ts.net/new?prompt=Rate%20my%20swearing
https://machine.tailnet.ts.net/new?prompt=Fix%20the%20build&repo=owner/name&provider=codex&model=gpt-5.5
https://machine.tailnet.ts.net/new?pr=owner/name/123&prompt=Fix%20the%20failing%20check
```

| Parameter  | Description                                                       |
| ---------- | ----------------------------------------------------------------- |
| `prompt`   | Draft text (up to 8,000 characters). Required unless `pr` is set. |
| `repo`     | GitHub repository (`owner/name` or URL).                          |
| `provider` | Provider ID (e.g. `codex`, `claude`).                             |
| `model`    | Model ID or name for that provider.                               |
| `pr`       | GitHub pull request (`owner/name/123` or URL).                    |

## How links open

A link opens in the browser on that host. Older links written for T3's hosted app (`app.t3.codes`) still open as a draft when you click them inside the desktop app.

- **No `repo`**: Opens a no-project draft on your last-used machine.
- **`repo`**: Opens in your most recent project for that repo (or offers **Clone** / **Use without project**).
- **`provider` / `model`**: Applied if configured; otherwise falls back to your default with a notice.
- **`pr`**: Opens the thread linked to that PR, or prepares a new worktree draft on the PR branch after you confirm checkout.
- **Thread prompt link** (`https://<your host>/<environment>/<thread>?prompt=…`): Prefills that thread's composer (asks before overwriting an existing draft).

CMDeck strips invisible characters (such as zero-width and hidden tag characters) and warns you if a prompt contained them.

## Share a thread

**Copy thread** copies a link that pastes into any composer as a thread chip. In a browser it is a web link to the thread on the address you opened CMDeck from (`https://<your host>/threads/<environment>/<thread>`); in the desktop app it is CMDeck's own `t3-thread://` link, which agents and CMDeck messages open. Only someone connected to the machine running that thread can view it.
