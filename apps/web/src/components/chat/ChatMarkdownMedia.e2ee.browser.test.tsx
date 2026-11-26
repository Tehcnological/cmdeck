import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { setEncryptedAssetReaderForTest } from "../../assets/encryptedAssetSrc";
import { ChatMarkdownAssetImage } from "./ChatMarkdownMedia";

const connection = vi.hoisted(() => ({ pinned: true }));
vi.mock(import("~/state/assets"), async (original) => {
  const { AsyncResult, Atom } = await import("effect/reactivity");
  const createUrl = Atom.family((_key: string) =>
    Atom.make(() =>
      AsyncResult.success({
        relativeUrl: "/api/assets/signed.token/shot.gif",
        expiresAt: Number.MAX_SAFE_INTEGER,
      }),
    ).pipe(Atom.keepAlive),
  );
  const actual = await original();
  return {
    ...actual,
    assetEnvironment: {
      ...actual.assetEnvironment,
      createUrl: (target: { readonly input: unknown }) => createUrl(JSON.stringify(target.input)),
    },
  };
});
vi.mock(import("~/state/session"), async (original) => {
  const { Option } = await import("effect");
  const { PrimaryConnectionTarget } = await import("@t3tools/client-runtime/connection");
  const { EnvironmentId } = await import("@t3tools/contracts");
  const target = new PrimaryConnectionTarget({
    environmentId: EnvironmentId.make("environment-1"),
    label: "Remote",
    httpBaseUrl: "http://remote.invalid",
    wsBaseUrl: "ws://remote.invalid",
  });
  const prepared: PreparedConnection = {
    environmentId: target.environmentId,
    label: target.label,
    httpBaseUrl: target.httpBaseUrl,
    socketUrl: target.wsBaseUrl,
    httpAuthorization: null,
    target,
  };
  return {
    ...(await original()),
    usePreparedConnection: () =>
      Option.some(
        connection.pinned ? { ...prepared, e2eeServerIdentityKey: "pinned-key" } : prepared,
      ),
  };
});

// A 1x1 GIF.
const GIF = Uint8Array.from(
  atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"),
  (character) => character.charCodeAt(0),
);

const image = (
  <ChatMarkdownAssetImage
    environmentId={EnvironmentId.make("environment-1")}
    resource={{ _tag: "attachment", attachmentId: "pending-shot", mimeType: "image/gif" }}
    alt="shot"
  />
);

describe("ChatMarkdownAssetImage on an E2EE session", () => {
  it("shows the image from bytes read over the session and reuses them on remount", async () => {
    connection.pinned = true;
    const reads: Array<string> = [];
    using _reader = setEncryptedAssetReaderForTest(async ({ relativeUrl }) => {
      reads.push(relativeUrl);
      return { contentType: "image/gif", chunks: [GIF.subarray(0, 10), GIF.subarray(10)] };
    });
    {
      await using screen = await render(image);
      const img = screen.getByRole("img", { name: "shot" });
      await expect.element(img).toBeInTheDocument();
      expect(img.element().getAttribute("src")).toMatch(/^blob:/);
    }
    await using screen = await render(<ChatMarkdownAssetImage {...image.props} />);
    await expect.element(screen.getByRole("img", { name: "shot" })).toBeInTheDocument();
    expect(reads).toEqual(["/api/assets/signed.token/shot.gif"]);
  });

  it("never falls back to the plain URL when the encrypted read fails", async () => {
    connection.pinned = true;
    using _reader = setEncryptedAssetReaderForTest(async () => null);
    await using screen = await render(image);
    await expect.element(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.container.querySelector("img[src^='http']")).toBeNull();
  });

  it("keeps plain URLs for an environment that is not pinned", async () => {
    connection.pinned = false;
    const reads: Array<string> = [];
    using _reader = setEncryptedAssetReaderForTest(async ({ relativeUrl }) => {
      reads.push(relativeUrl);
      return null;
    });
    await using screen = await render(image);
    await vi.waitFor(() =>
      expect(screen.container.querySelector("img")?.getAttribute("src")).toBe(
        "http://remote.invalid/api/assets/signed.token/shot.gif",
      ),
    );
    expect(reads).toEqual([]);
  });
});
