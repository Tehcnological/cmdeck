# Bots

A bot is an agent that keeps going: one thread it always works in, standing instructions, memory
only it can see, and optional schedules. Use one for recurring work that benefits from remembering
the last run, such as watching for releases or triaging new issues each morning.

## Create a bot

Open **Settings → Threads → Bots** and choose **New bot**, or run **New bot** from the command
palette. Give it a name, a project and instructions. The bot uses the project's default model; if
the project has none, set one first.

Creating a bot:

- starts a thread named after the bot in the project's folder and pins it in the sidebar, marked
  with a bot icon;
- adds the instructions to every turn in that thread (they are not added to the transcript);
- gives the bot a private memory. When memory is on, anything saved from the bot's thread goes there
  by default, and no other thread can read it.

Instructions are limited to 2,000 characters so they always fit beside the thread's memory.

Agents can also manage bots with the `bot_list`, `bot_create`, `bot_update` and `bot_schedule` MCP
tools. A bot an agent creates shows up in the same list, with its instructions, so you can check
what it was told.

## Schedules and Wake now

**Add schedule** creates an ordinary scheduled task that sends a prompt to the bot's own thread:
every hour, every day or weekday at 09:00 server time, or a cron expression. Each run continues the
same conversation. The task also appears in **Settings → Scheduled tasks**, where you can pause or
edit it.

**Wake now** runs the bot's first schedule immediately. A bot with no schedule has nothing to wake;
type in its thread instead.

## Delete and restore

**Delete** archives the bot's thread, pauses its schedules and retires its private memory. Nothing
is erased: **Restore** unarchives the thread, resumes the schedules it paused and brings each memory
item back as it was. A new bot with the same name starts empty.

## On the mobile app

The official mobile app shows a bot as an ordinary pinned thread. You can read and reply there; the
bot list and its settings are in the desktop and web app.
