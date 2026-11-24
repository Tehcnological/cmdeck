import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { ModelSelection, ProviderInstanceId, ScopedThreadRef } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { msg, T, useGT } from "gt-react";
import { useState } from "react";

import { m } from "~/i18n/messages";
import {
  updateClientSettings,
  useClientSettings,
  useEnvironmentSettings,
} from "~/hooks/useSettings";
import { getAppModelOptionsForInstance } from "~/modelSelection";
import { providerInstanceEntriesFor } from "~/providerInstances";
import { useRightPanelStore } from "~/rightPanelStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useThreadShell, waitForThreadShell } from "~/state/entities";
import { useEnvironmentProviders } from "~/state/environments";
import { EMPTY_SERVER_PROVIDERS } from "~/state/server";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { threadReviewDialogThreadAtom } from "./threadReviewDialogState";

export function ThreadReviewDialogHost() {
  const threadRef = useAtomValue(threadReviewDialogThreadAtom);
  if (threadRef === null) return null;
  return (
    <ThreadReviewDialog
      key={`${threadRef.environmentId}:${threadRef.threadId}`}
      threadRef={threadRef}
      onClose={() => appAtomRegistry.set(threadReviewDialogThreadAtom, null)}
    />
  );
}

function ThreadReviewDialog(props: {
  readonly threadRef: ScopedThreadRef;
  readonly onClose: () => void;
}) {
  const { threadRef } = props;
  const gt = useGT();
  const thread = useThreadShell(threadRef);
  const settings = useEnvironmentSettings(threadRef.environmentId);
  const providers =
    useEnvironmentProviders().get(threadRef.environmentId) ?? EMPTY_SERVER_PROVIDERS;
  const rememberedByEnvironment = useClientSettings((current) => current.reviewerModelSelections);
  const canStart = useAtomValue(
    threadEnvironment.startReview.permissionAtom(threadRef.environmentId),
  );
  const startReview = useAtomCommand(threadEnvironment.startReview, { reportFailure: false });
  const [picked, setPicked] = useState<ModelSelection | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A remembered reviewer that is gone or unusable here is not offered, so the user picks again.
  const entries = providerInstanceEntriesFor(providers, settings, thread?.projectId ?? null).filter(
    (entry) => entry.enabled && entry.isAvailable,
  );
  const remembered = rememberedByEnvironment[threadRef.environmentId] ?? null;
  const selection =
    picked ??
    (remembered !== null && entries.some((entry) => entry.instanceId === remembered.instanceId)
      ? remembered
      : null);
  const modelOptionsByInstance = new Map(
    entries.map((entry) => [
      entry.instanceId,
      getAppModelOptionsForInstance(
        settings,
        entry,
        entry.instanceId === selection?.instanceId ? selection.model : null,
      ),
    ]),
  );
  const firstInstanceId = entries[0]?.instanceId;

  const choose = (instanceId: ProviderInstanceId, model: string) => {
    setError(null);
    setPicked(createModelSelection(instanceId, model));
  };

  const start = async () => {
    if (selection === null || pending) return;
    setPending(true);
    setError(null);
    const result = await startReview({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, modelSelection: selection },
    });
    if (result._tag === "Failure") {
      setPending(false);
      setError(
        thrownErrorMessage(squashAtomCommandFailure(result), m) ??
          m(msg("Could not start the review.")),
      );
      return;
    }
    void updateClientSettings({
      reviewerModelSelections: {
        ...rememberedByEnvironment,
        [threadRef.environmentId]: selection,
      },
    });
    props.onClose();
    const reviewRef = scopeThreadRef(threadRef.environmentId, result.value.reviewThreadId);
    if (await waitForThreadShell(reviewRef)) {
      useRightPanelStore.getState().openThread(threadRef, reviewRef.threadId);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open || pending ? undefined : props.onClose())}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <T>Review with another model</T>
          </DialogTitle>
          <DialogDescription>
            <T>
              A second agent reads this thread's changes without editing anything and reports its
              findings here. You decide whether the agent sees them.
            </T>
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-3">
            {firstInstanceId === undefined ? (
              <p className="text-sm text-muted-foreground">
                <T>No provider on this environment can review right now.</T>
              </p>
            ) : (
              <ProviderModelPicker
                environmentId={threadRef.environmentId}
                activeInstanceId={selection?.instanceId ?? firstInstanceId}
                model={selection?.model ?? ""}
                lockedProvider={null}
                instanceEntries={entries}
                modelOptionsByInstance={modelOptionsByInstance}
                triggerAriaLabel={gt("Reviewer model")}
                {...(selection === null ? { triggerLabel: gt("Choose a reviewer") } : {})}
                onInstanceModelChange={choose}
              />
            )}
            {error === null ? null : (
              <p role="alert" className="text-sm text-destructive-foreground">
                {error}
              </p>
            )}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" disabled={pending} onClick={props.onClose}>
            <T>Cancel</T>
          </Button>
          <Button
            disabled={selection === null || pending || !canStart}
            onClick={() => void start()}
          >
            {pending ? <T>Starting…</T> : <T>Start review</T>}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
