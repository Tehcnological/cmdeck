# Close to tray and launch at login

The desktop app can keep running after you close its window, so agents and the
server on this computer keep working and other devices stay connected.

## Close to tray

**Settings → General → Desktop app → Close to tray** is on by default. Closing
the window then hides T3 Code to the system tray on Windows, the menu bar on
macOS, or the tray on Linux. The first time this happens on Windows or Linux, a
notification says T3 Code is still running.

The tray menu has:

- **Open T3 Code** brings the window back. On Windows and Linux, clicking the
  tray icon does the same. Opening T3 Code again from the Start menu, Dock, or
  app launcher also brings it back.
- **Server** shows whether this app's server is running, starting, or stopped.
  It reads "managed outside this app" when **Local environment** is turned off
  in Settings → Connections, for example while a
  [background service](./background-service.md) runs your agents.
- **Quit T3 Code** stops the server and every running agent, like quitting from
  the app menu.

Turn the setting off to make closing the window quit T3 Code again, as it did
before (on macOS the app keeps running in the Dock either way, as macOS apps do).

On Linux the tray needs a desktop that shows StatusNotifier icons. KDE and most
other desktops do; stock GNOME needs the AppIndicator extension. Without one,
the setting is unavailable and closing the window quits.

## Launch at login

**Launch at login** (off by default, installed app only) starts T3 Code when you
log in. With close to tray on, it starts in the tray without opening a window;
its server starts as usual. Turning the setting off removes T3 Code from the apps
that open at login. On Linux this writes an entry in `~/.config/autostart`. On
macOS 13 and later, macOS no longer tells apps they were opened at login, so the
window opens.
