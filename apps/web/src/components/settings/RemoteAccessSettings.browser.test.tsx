import type { RemoteMcpTokenCreateInput, RemoteMcpTokenCreateResult } from "@t3tools/contracts";
import { useState } from "react";
import { page, userEvent } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { Button } from "../ui/button";
import { Dialog, DialogPopup } from "../ui/dialog";
import { RemoteMcpTokenCreator } from "./RemoteAccessSettings";

const SECRET = `t3mcp_${"A".repeat(43)}`;

type Create = (input: RemoteMcpTokenCreateInput) => Promise<RemoteMcpTokenCreateResult | null>;

const created = (input: RemoteMcpTokenCreateInput): RemoteMcpTokenCreateResult => ({
  token: { id: "token-1", createdAt: "2026-11-24T00:00:00.000Z", ...input },
  secret: SECRET,
});

function Owner({ create }: { readonly create: Create }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" aria-label="open token dialog" onClick={() => setOpen(true)} />
      <DialogPopup>
        {open ? <RemoteMcpTokenCreator create={create} onDone={() => setOpen(false)} /> : null}
      </DialogPopup>
    </Dialog>
  );
}

// Dialog footers sit below the fold of the default phone-sized test viewport.
async function desktopViewport(): Promise<AsyncDisposable> {
  const { innerWidth: width, innerHeight: height } = window;
  await page.viewport(1280, 800);
  return { [Symbol.asyncDispose]: () => page.viewport(width, height) };
}

const secretField = () => page.getByRole("textbox", { name: "Remote MCP token" });
const nameField = () => page.getByPlaceholder("laptop-claude");

async function createToken(name: string) {
  await userEvent.click(page.getByRole("button", { name: "open token dialog" }));
  await userEvent.fill(nameField(), name);
  await userEvent.keyboard("{Enter}");
}

describe("RemoteMcpTokenCreator", () => {
  it("shows a new token once and drops it when the dialog closes", async () => {
    const create = vi.fn<Create>(async (input) => created(input));
    await using _viewport = await desktopViewport();
    await using _screen = await render(<Owner create={create} />);

    await createToken("  laptop  ");
    expect(create).toHaveBeenCalledExactlyOnceWith({ label: "laptop", access: "read-only" });
    await expect.element(secretField()).toHaveValue(SECRET);
    await expect.element(page.getByRole("button", { name: "Copy" })).toBeInTheDocument();

    await userEvent.click(page.getByRole("button", { name: "Done" }));
    await expect.element(secretField()).not.toBeInTheDocument();

    await userEvent.click(page.getByRole("button", { name: "open token dialog" }));
    await expect.element(nameField()).toHaveValue("");
    await expect.element(secretField()).not.toBeInTheDocument();
    await expect.element(page.getByText(SECRET)).not.toBeInTheDocument();
  });

  it("keeps the form and shows no token when creation fails", async () => {
    const create = vi.fn<Create>(async () => null);
    await using _viewport = await desktopViewport();
    await using _screen = await render(<Owner create={create} />);

    await createToken("laptop");
    expect(create).toHaveBeenCalledOnce();
    await expect.element(nameField()).toHaveValue("laptop");
    await expect.element(secretField()).not.toBeInTheDocument();
  });
});
