import type { EnvironmentId } from "@t3tools/contracts";
import type { AssetBytes } from "@t3tools/client-runtime/state/assets";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { msg } from "gt-react";
import { useSyncExternalStore } from "react";

import { m } from "~/i18n/messages";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { assetEnvironment } from "~/state/assets";
import { usePreparedConnection } from "~/state/session";

/**
 * Images on a pinned E2EE session are read through the encrypted RPC socket and shown from
 * memory, since `<img src>` would fetch them over plain HTTP(S) past any TLS-terminating hop.
 */
const MAX_UNUSED_ENTRIES = 48;

type Entry = {
  state: { readonly src: string | null; readonly failed: boolean };
  readonly listeners: Set<() => void>;
  objectUrl: string | null;
  users: number;
};

/** Insertion order is recency: a read moves an entry to the end. */
const entries = new Map<string, Entry>();

type Reader = (target: {
  readonly environmentId: EnvironmentId;
  readonly relativeUrl: string;
}) => Promise<AssetBytes | null>;

const readOverRpc: Reader = async ({ environmentId, relativeUrl }) => {
  const result = await runAtomCommand(
    appAtomRegistry,
    assetEnvironment.read,
    { environmentId, input: { relativeUrl } },
    { reportFailure: false },
  );
  return result._tag === "Success" ? result.value : null;
};
let read = readOverRpc;

/** Test seam: replaces the RPC read. */
export function setEncryptedAssetReaderForTest(reader: Reader): Disposable {
  const reset = () => {
    for (const entry of entries.values()) {
      if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
    }
    entries.clear();
  };
  reset();
  read = reader;
  return {
    [Symbol.dispose]: () => {
      read = readOverRpc;
      reset();
    },
  };
}

function relativeUrlOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * A short-lived in-memory URL for a download or copy, read through the encrypted socket. The
 * caller only fetches it or hands it to `<a download>`, never navigates to it.
 */
export async function encryptedAssetActionUrl(
  environmentId: EnvironmentId,
  url: string,
): Promise<string> {
  const bytes = await read({ environmentId, relativeUrl: relativeUrlOf(url) });
  if (!bytes) throw new Error(m(msg("Could not read this file over the encrypted connection.")));
  const objectUrl = URL.createObjectURL(
    new Blob(bytes.chunks as Array<Uint8Array<ArrayBuffer>>, { type: bytes.contentType }),
  );
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  return objectUrl;
}

function displayUrl(bytes: AssetBytes): string | Promise<string> {
  const blob = new Blob(bytes.chunks as Array<Uint8Array<ArrayBuffer>>, {
    type: bytes.contentType,
  });
  // A blob: SVG opened on its own would run script in the app's origin; a data: URL cannot be.
  if (!/^image\/svg\+xml\b/i.test(bytes.contentType)) return URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function evictUnused(): void {
  let unused = 0;
  for (const entry of entries.values()) if (entry.users === 0) unused++;
  for (const [key, entry] of entries) {
    if (unused <= MAX_UNUSED_ENTRIES) return;
    if (entry.users > 0 || (entry.state.src === null && !entry.state.failed)) continue;
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
    entries.delete(key);
    unused--;
  }
}

function load(key: string, environmentId: EnvironmentId, url: string): Entry {
  const existing = entries.get(key);
  if (existing) {
    entries.delete(key);
    entries.set(key, existing);
    return existing;
  }
  const entry: Entry = {
    state: { src: null, failed: false },
    listeners: new Set(),
    objectUrl: null,
    users: 0,
  };
  entries.set(key, entry);
  const settle = (state: Entry["state"]) => {
    entry.state = state;
    for (const listener of entry.listeners) listener();
    evictUnused();
  };
  void read({ environmentId, relativeUrl: relativeUrlOf(url) })
    .then((bytes) => (bytes ? displayUrl(bytes) : null))
    .then(
      (src) => {
        if (src === null) return settle({ src: null, failed: true });
        if (src.startsWith("blob:")) {
          // Evicted while loading: nobody can be holding it.
          if (entries.get(key) !== entry) return URL.revokeObjectURL(src);
          entry.objectUrl = src;
        }
        settle({ src, failed: false });
      },
      () => settle({ src: null, failed: true }),
    );
  return entry;
}

type EncryptedAssetSrc = { readonly src: string | null; readonly failed: boolean };
const LOADING: EncryptedAssetSrc = { src: null, failed: false };

/**
 * Each `url` unchanged when the environment is not pinned to E2EE. Otherwise the image's bytes
 * from the encrypted socket as an in-memory URL, null while it loads. `key` names the bytes, so
 * re-signed URLs for the same file reuse them; include a revision for files that can change.
 */
export function useEncryptedAssetSrcs(
  environmentId: EnvironmentId | null,
  items: ReadonlyArray<{ readonly key: string; readonly url: string | null }>,
): ReadonlyArray<EncryptedAssetSrc> {
  const connection = usePreparedConnection(environmentId);
  const encrypted =
    environmentId !== null &&
    connection._tag === "Some" &&
    connection.value.e2eeServerIdentityKey !== undefined;
  const wanted = encrypted
    ? items.flatMap((item) =>
        item.url === null ? [] : [{ key: `${environmentId}\u0000${item.key}`, url: item.url }],
      )
    : [];
  const wantedKey = JSON.stringify(wanted);
  // Reads the string key, not `wanted`, so the compiler keeps one subscription per image set.
  const subscribe = (onChange: () => void) => {
    if (environmentId === null) return () => {};
    const held = (JSON.parse(wantedKey) as typeof wanted).map(({ key, url }) => {
      const entry = load(key, environmentId, url);
      entry.users++;
      entry.listeners.add(onChange);
      return entry;
    });
    return () => {
      for (const entry of held) {
        entry.listeners.delete(onChange);
        entry.users--;
      }
      evictUnused();
    };
  };
  // A string snapshot compares by value, so unchanged states do not re-render.
  const snapshot = useSyncExternalStore(subscribe, () =>
    JSON.stringify(wanted.map(({ key }) => entries.get(key)?.state ?? LOADING)),
  );
  if (!encrypted) return items.map((item) => ({ src: item.url, failed: false }));
  const states = JSON.parse(snapshot) as Array<EncryptedAssetSrc>;
  return items.map((item) => (item.url === null ? LOADING : (states.shift() ?? LOADING)));
}

export function useEncryptedAssetSrc(
  environmentId: EnvironmentId | null,
  key: string,
  url: string | null,
): EncryptedAssetSrc {
  return useEncryptedAssetSrcs(environmentId, [{ key, url }])[0] ?? LOADING;
}
