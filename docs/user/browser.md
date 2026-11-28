# Built-in browser

T3 Code includes a built-in preview browser beside your conversation so you and your agents can inspect local dev servers, annotate UI issues, record flows, and test web apps without leaving the thread.

## Open and navigate

- Open the right panel in a thread and choose **Browser** (or click a running dev server in the thread's **Servers** list).
- **Local vs. remote**: On the desktop app, tabs for your local environment run natively. On web, mobile, or remote environments, tabs stream from the host's headless Chromium (~120 MB one-time download; see [Browser host setup](./remote-access.md#browser-host-setup)). On desktop, tabs you open for a remote environment can also load locally over the [preview tunnel](./remote-access.md#browser-on-a-remote-environment).
- **Find on page**: Press `mod+f` inside a desktop browser tab (or use its **⋮** menu if the page intercepts `mod+f`).
- **Default browser (macOS)**: You can set the desktop app as your [default web browser](./default-browser.md).

## Profiles, viewports, and settings

Configure defaults in **Settings → Browser**:

- **Browser profiles**: Maintain separate cookie/storage profiles and set a **Default browser profile**. Desktop users can copy signed-in cookies from Chrome, Safari, Firefox, Zen, or Helium ([Import browser sessions](./browser-import.md)).
- **Viewport, zoom & appearance**: Set **Default browser viewport** (fill, freeform, or phone/tablet presets with portrait/landscape rotation), **Default browser zoom**, and **Default browser appearance** (system/light/dark).
- **Links & search**: Configure **Open links in** and **Search engine**.

## Pick elements, annotate, and record

- **Element picker & annotations**: Pick elements or annotate regions on the page to attach them directly into the composer as inline context chips.
- **Screen recordings**: Record browser interactions directly from the tab toolbar. Configure **Browser recording frame rate**, **Show key presses in recordings**, and **Show mouse presses in recordings** in **Settings → Browser**.

## Agent browser access

Agents can open tabs, navigate, click, type, inspect accessibility snapshots, and take screenshots using T3 Code's `preview_*` tools.

- Toggle **Settings → Browser → Agent browser access** (per environment or project override; takes effect when the next agent session starts).
- **Floating preview**: By default, agent-opened tabs float over chat (**Settings → Browser → Auto-show floating preview**). Turn this off to open them in the right panel instead.
- **Take control**: Click **Take control** before interacting with an agent's tab, and release control when you want the agent to resume.

## Design critique

Ask an agent to review the design of the page in your preview. It resizes its tab to phone (390px), tablet (768px) and desktop (1280px) widths, checks light and dark, measures text contrast, and reads the page's accessibility tree, then reports a few findings with a screenshot at each width.

- **Start it**: With the preview open in a thread, open the command palette and choose **Critique this preview**. It adds the request to your draft; read it, add anything the agent should focus on, and send.
- **Better results with the skill**: Copy the [`design-critique` skill](https://github.com/Tehcnological/cmdeck/tree/main/skills/design-critique) folder into your agent's skills folder (e.g. `~/.claude/skills/` or `~/.agents/skills/`). The request works without it, but the skill carries the full rubric and severity rules.
- **Your tab stays yours**: If you are driving the preview tab, the agent opens its own tab on the same page instead of resizing yours.
- **Needs agent browser access**, and the page must load in the preview. A sign-in wall stops the review: the agent asks for a way in rather than critiquing the login page.
- It is an expert review, not an accessibility audit or certification.
