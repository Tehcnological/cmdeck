import { useAtomValue } from "@effect/atom-react";
import {
  CMDECK_WS_METHODS,
  type EnvironmentId,
  type PendingWorkflowFile,
  WORKFLOW_NEEDS_APPROVAL,
} from "@t3tools/contracts";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { T, useGT } from "gt-react";
import { ShieldAlertIcon } from "lucide-react";
import { useState } from "react";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";

const pendingFiles = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:workflow-trust-pending",
  tag: CMDECK_WS_METHODS.workflowTrustPending,
});

const approveFile = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:workflow-trust-approve",
  tag: CMDECK_WS_METHODS.workflowTrustApprove,
});

/** The workflows page's "Needs approval" state (WI-1.06): files the server holds back until approved. */
export function WorkflowApprovals({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const gt = useGT();
  const definitions = useEnvironmentQuery(
    serverEnvironment.workflowDefinition({ environmentId, input: {} }),
  );
  const canApprove = useAtomValue(approveFile.permissionAtom(environmentId));
  const list = useAtomCommand(pendingFiles, { reportFailure: false });
  const approve = useAtomCommand(approveFile, { reportFailure: false });
  const [files, setFiles] = useState<ReadonlyArray<PendingWorkflowFile> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const waiting =
    definitions.data?.files.filter((file) =>
      file.problems.some((problem) => problem.message === WORKFLOW_NEEDS_APPROVAL),
    ) ?? [];
  if (waiting.length === 0) return null;

  const review = async () => {
    setBusy(true);
    const result = await list({ environmentId, input: {} });
    setBusy(false);
    if (result._tag === "Failure") return setError(gt("Could not read the files to approve."));
    setError(null);
    setFiles(result.value.files);
  };

  const approveOne = async (file: PendingWorkflowFile) => {
    setBusy(true);
    const result = await approve({
      environmentId,
      input: { path: file.path, sha256: file.sha256 },
    });
    setBusy(false);
    if (result._tag === "Failure") {
      // Most often the file changed after it was shown: show it again as it is now.
      await review();
      return setError(gt("Not approved. The file may have changed: review it again."));
    }
    setError(null);
    setFiles((current) => current?.filter((entry) => entry.path !== file.path) ?? null);
  };

  return (
    <div className="border-b px-4 py-3 sm:px-6">
      <Alert variant="warning">
        <ShieldAlertIcon />
        <AlertTitle>
          {gt(
            "{count, plural, one {{count} workflow file needs approval} other {{count} workflow files need approval}}",
            { count: waiting.length },
          )}
        </AlertTitle>
        <AlertDescription>
          <T>
            New or changed workflow files run with this server's full access, so they wait until you
            read and approve them. Changing an approved file needs approval again.
          </T>
          {canApprove ? null : (
            <p>
              <T>Approving needs terminal access to this server.</T>
            </p>
          )}
          {error === null ? null : <p className="text-destructive">{error}</p>}
        </AlertDescription>
        {canApprove ? (
          <AlertAction>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void review()}>
              <T context="read a workflow file before approving it">Review</T>
            </Button>
          </AlertAction>
        ) : null}
      </Alert>
      {files === null ? null : (
        <ul className="mt-3 space-y-3">
          {files.map((file) => (
            <li key={file.path} className="rounded-lg border">
              <div className="flex items-center gap-2 border-b px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-sm">{file.name}</span>
                <Button size="sm" disabled={busy} onClick={() => void approveOne(file)}>
                  <T>Approve</T>
                </Button>
              </div>
              <pre className="max-h-80 overflow-auto px-3 py-2 font-mono text-xs">
                {file.source}
              </pre>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
