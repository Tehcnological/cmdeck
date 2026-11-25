import { CMDECK_MARK_PATH } from "./T3Wordmark";

// CMDeck placeholder app icon, the same artwork as assets/prod/logo.svg.
export function T3AppIcon(props: { readonly className?: string }) {
  return (
    <svg viewBox="0 0 128 128" className={props.className} aria-hidden>
      <rect width="128" height="128" rx="28" fill="var(--color-zinc-900)" />
      <path
        d={CMDECK_MARK_PATH}
        fill="var(--color-zinc-25)"
        transform="translate(21 36) scale(1.4)"
      />
    </svg>
  );
}
