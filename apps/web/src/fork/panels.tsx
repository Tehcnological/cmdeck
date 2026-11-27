import type { ScopedThreadRef } from "@t3tools/contracts";
import { msg } from "gt-react";
import { ListChecksIcon } from "lucide-react";
import type { ComponentType } from "react";

import { m, type MessageResolver } from "../i18n/messages";
import type { CmdeckPanelId, CmdeckSurface } from "./panelSurface";
import { WorkLedgerPanel } from "./WorkLedgerPanel";

interface ForkPanel {
  /** A `msg()` descriptor, resolved where the tab renders. */
  readonly title: string;
  readonly Icon: ComponentType<{ readonly className?: string }>;
  readonly Content: ComponentType<{ readonly threadRef: ScopedThreadRef }>;
}

/** The fork panel registry: each fork panel's tab title, icon and content. Append entries. */
const FORK_PANELS: Record<CmdeckPanelId, ForkPanel> = {
  "work-ledger": { title: msg("Work ledger"), Icon: ListChecksIcon, Content: WorkLedgerPanel },
};

export function cmdeckPanelTitle(surface: CmdeckSurface, resolve: MessageResolver = m): string {
  return resolve(FORK_PANELS[surface.panel].title);
}

export function CmdeckPanelIcon({ surface }: { readonly surface: CmdeckSurface }) {
  const { Icon } = FORK_PANELS[surface.panel];
  return <Icon className="size-3 shrink-0" />;
}

export function CmdeckPanelContent(props: {
  readonly surface: CmdeckSurface;
  readonly threadRef: ScopedThreadRef;
}) {
  const { Content } = FORK_PANELS[props.surface.panel];
  return <Content threadRef={props.threadRef} />;
}
