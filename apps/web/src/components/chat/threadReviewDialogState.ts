import type { ScopedThreadRef } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "~/rpc/atomRegistry";

/**
 * Which thread has the Review dialog open. The command palette closes as its command runs, so the
 * chat view renders the dialog once.
 */
export const threadReviewDialogThreadAtom = Atom.make<ScopedThreadRef | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("chat:thread-review-dialog"),
);

export function openThreadReviewDialog(threadRef: ScopedThreadRef): void {
  appAtomRegistry.set(threadReviewDialogThreadAtom, threadRef);
}
