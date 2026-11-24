import type { SVGProps } from "react";

// CMDeck placeholder mark (a terminal prompt), not the trademarked T3 wordmark.
export const CMDECK_MARK_PATH = "M4 4H11L29 20L11 36H4L22 20Z M32 29H58V36H32Z";

export function T3Wordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 62 40" xmlns="http://www.w3.org/2000/svg">
      <path d={CMDECK_MARK_PATH} fill="currentColor" />
    </svg>
  );
}
