import { describe, expect, it } from "vite-plus/test";

import {
  cliArchiveTarCommand,
  cliReleaseAssetUrl,
  cliReleaseDownloadBaseUrl,
  desktopTrackOffers,
  desktopUpdateChannelOf,
  newestCliReleaseVersion,
  parseChecksums,
} from "./cliRelease.ts";

describe("cliRelease", () => {
  it("parses sha256sum output including binary-mode markers", () => {
    const checksums = parseChecksums(
      [
        `${"a".repeat(64)}  t3-1.2.3-linux-x64.tar.gz`,
        `${"B".repeat(64)} *t3-1.2.3-win32-x64.zip`,
        "not a checksum line",
        "",
      ].join("\n"),
    );
    expect(checksums.get("t3-1.2.3-linux-x64.tar.gz")).toBe("a".repeat(64));
    expect(checksums.get("t3-1.2.3-win32-x64.zip")).toBe("b".repeat(64));
    expect(checksums.size).toBe(2);
  });

  it("extracts with the System32 bsdtar on Windows and plain tar elsewhere", () => {
    expect(cliArchiveTarCommand("linux", {})).toBe("tar");
    expect(cliArchiveTarCommand("win32", { SystemRoot: "D:\\Win" })).toBe(
      "D:\\Win\\System32\\tar.exe",
    );
    expect(cliArchiveTarCommand("win32", {})).toBe("C:\\Windows\\System32\\tar.exe");
  });

  it("downloads from CMDeck's GitHub release tags unless a mirror is set", () => {
    const github = "https://github.com/Tehcnological/cmdeck/releases/download";
    expect(cliReleaseAssetUrl("2.0.0", "SHA256SUMS")).toBe(`${github}/v2/SHA256SUMS`);
    expect(cliReleaseAssetUrl("3.0.0-beta.1", "t3-3.0.0-beta.1-linux-x64.tar.gz", " ")).toBe(
      `${github}/v3-beta.1/t3-3.0.0-beta.1-linux-x64.tar.gz`,
    );
    expect(cliReleaseDownloadBaseUrl("2.0.0")).toBe(`${github}/v2`);
    expect(cliReleaseDownloadBaseUrl("2.0.0", "https://mirror.example/cmdeck/")).toBe(
      "https://mirror.example/cmdeck/v2.0.0",
    );
    expect(cliReleaseAssetUrl("2.0.0", "SHA256SUMS", "https://mirror.example/c?token=x")).toBe(
      "https://mirror.example/c/v2.0.0/SHA256SUMS?token=x",
    );
  });

  it("picks the newest non-draft release on the requested channel", () => {
    const releases = [
      { tag_name: "v1.2.4-preview.20260912.9", draft: true },
      { tag_name: "v1.2.4-preview.20260912.8" },
      { tag_name: "v1.2.4-nightly.20260912.7" },
      { tag_name: "desktop-preview" },
      { tag_name: "v1.2.3" },
      { tag_name: "v1.2.3-nightly.20260911.2" },
    ];
    expect(newestCliReleaseVersion(releases, "preview")).toBe("1.2.4-preview.20260912.8");
    expect(newestCliReleaseVersion(releases, "nightly")).toBe("1.2.4-nightly.20260912.7");
    expect(newestCliReleaseVersion(releases, "stable")).toBe("1.2.3");
    expect(newestCliReleaseVersion([{ tag_name: "v1.2.3" }], "preview")).toBeUndefined();
    expect(newestCliReleaseVersion([{ tag_name: "v3-beta.1" }, { tag_name: "v2" }], "stable")).toBe(
      "2.0.0",
    );
  });

  it("puts betas on the Beta track, stored as nightly", () => {
    expect(desktopUpdateChannelOf("3.0.0-beta.1")).toBe("nightly");
    expect(desktopUpdateChannelOf("3.0.0")).toBe("latest");
    expect(desktopUpdateChannelOf("3.0.0-nightly.20261125.1")).toBe("nightly");
    expect(desktopUpdateChannelOf("3.0.0-preview.20261125.1")).toBe("latest");
  });

  it("offers Stable only stable releases and Beta every release", () => {
    expect(desktopTrackOffers("latest", "3.0.0")).toBe(true);
    expect(desktopTrackOffers("latest", "3.0.0-beta.2")).toBe(false);
    expect(desktopTrackOffers("nightly", "3.0.0-beta.2")).toBe(true);
    expect(desktopTrackOffers("nightly", "3.0.0")).toBe(true);
    expect(desktopTrackOffers("nightly", "3.0.0-preview.20261125.1")).toBe(false);
  });
});
