import * as Modules from "./settingsSectionModules";

type Section = (typeof Modules)[keyof typeof Modules]["settingsSection"];

const SECTIONS = Object.entries(Modules)
  .map(([key, module]) => ({ key, ...module.settingsSection }))
  .toSorted((a, b) => a.order - b.order);

/**
 * Fork sections at the end of a Settings page, one line in upstream's panel. Each module's section
 * (listed in `settingsSectionModules.ts`) exports `settingsSection` naming its page and order.
 */
export function ForkSettingsSections({ page }: { readonly page: Section["page"] }) {
  return SECTIONS.filter((section) => section.page === page).map(({ key, Component }) => (
    <Component key={key} />
  ));
}
