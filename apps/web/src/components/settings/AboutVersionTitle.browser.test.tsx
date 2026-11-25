import { formatAppVersion } from "@t3tools/shared/appIdentity";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { APP_VERSION } from "../../branding";
import { AnchoredToastProvider } from "../ui/toast";
import { AboutVersionTitle } from "./AboutVersionTitle";

it("copies the displayed version without a notification", async () => {
  const version = formatAppVersion(APP_VERSION);
  await using screen = await render(
    <AnchoredToastProvider>
      <AboutVersionTitle />
    </AnchoredToastProvider>,
  );
  using write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);

  await screen.getByRole("button", { name: `Copy version ${version}` }).click();

  expect(write).toHaveBeenCalledWith(version);
  await expect.element(page.getByText(/^Copied!?$/)).not.toBeInTheDocument();
});
