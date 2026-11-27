/** Fork panels shown as right panel tabs. Append an id here and its entry in `panels.tsx`. */
const CMDECK_PANEL_IDS = ["work-ledger"] as const;
export type CmdeckPanelId = (typeof CMDECK_PANEL_IDS)[number];

/** One tab per fork panel and thread, so opening it again focuses it. */
export type CmdeckSurface = { id: `cmdeck:${CmdeckPanelId}`; kind: "cmdeck"; panel: CmdeckPanelId };

export function cmdeckSurface(panel: CmdeckPanelId): CmdeckSurface {
  return { id: `cmdeck:${panel}`, kind: "cmdeck", panel };
}

/** A saved fork surface, or none when this build has no such panel. */
export function decodeCmdeckSurface(surface: object): ReadonlyArray<CmdeckSurface> {
  const { panel } = surface as Record<string, unknown>;
  return (CMDECK_PANEL_IDS as ReadonlyArray<unknown>).includes(panel)
    ? [cmdeckSurface(panel as CmdeckPanelId)]
    : [];
}
