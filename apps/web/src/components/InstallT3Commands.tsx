import { T } from "gt-react";
import { DESKTOP_DOWNLOAD_URL } from "~/branding";
import { cn } from "~/lib/utils";

import { CommandBlock } from "./CommandBlock";

/** Setup steps for another computer: install `t3` from a build mirror, then run `command`. */
export function InstallT3Commands({
  command,
  className,
}: {
  readonly command: string;
  readonly className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <p className="text-xs text-muted-foreground">
        <T>
          CMDeck publishes no hosted builds. Install the CMDeck CLI from your own mirror of CMDeck
          builds, as the{" "}
          <a
            href={DESKTOP_DOWNLOAD_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2"
          >
            install guide
          </a>{" "}
          explains. Then run:
        </T>
      </p>
      <CommandBlock command={command} />
      <p className="text-xs text-muted-foreground">
        <T>
          Skip the install if you already have <code className="font-mono">t3</code>. If{" "}
          <code className="font-mono">t3</code> is not found after installing, add the folder the
          installer names to your PATH.
        </T>
      </p>
    </div>
  );
}
