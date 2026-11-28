import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import {
  CHECK_SKIP_EXIT_CODE,
  CMDECK_WS_METHODS,
  type CheckInterpreter,
  type EnvironmentId,
  type ScheduledTask,
  type ScheduledTaskCheckState,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { T, useGT } from "gt-react";
import { ShieldAlertIcon, SquareTerminalIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { Textarea } from "../components/ui/textarea";
import { connectionAtomRuntime } from "../connection/runtime";
import { useAtomCommand } from "../state/use-atom-command";
import {
  CHECK_INTERPRETERS,
  type CheckDraft,
  checkDraftFrom,
  checkFromDraft,
  checkStatus,
  draftMatches,
} from "./scheduledTaskCheck.logic";

const checkList = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:cmdeck:check-scripts",
  tag: CMDECK_WS_METHODS.checkScriptsList,
  staleTimeMs: 0,
});

const setCheck = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:check-script-set",
  tag: CMDECK_WS_METHODS.checkScriptsSet,
});

const approveCheck = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:check-script-approve",
  tag: CMDECK_WS_METHODS.checkScriptsApprove,
});

/** A scheduled task row's check script button (WI-2.11), warning while one waits for approval. */
export function ScheduledTaskCheckControl({
  environmentId,
  task,
}: {
  readonly environmentId: EnvironmentId;
  readonly task: ScheduledTask;
}) {
  const gt = useGT();
  const list = checkList({ environmentId, input: {} });
  const checks = AsyncResult.getOrElse(useAtomValue(list), () => ({ checks: [] })).checks;
  const refresh = useAtomRefresh(list);
  const canChange = useAtomValue(setCheck.permissionAtom(environmentId));
  const [open, setOpen] = useState(false);
  const state = checks.find((check) => check.taskId === task.id);
  const status = checkStatus(state);
  if (!canChange && status === "none") return null;

  const label =
    status === "pending"
      ? gt("Check script needs approval")
      : status === "approved"
        ? gt("Check script")
        : gt("Add a check script");
  return (
    <>
      <Button
        size="icon-sm"
        variant={
          status === "pending" ? "warning-outline" : status === "none" ? "ghost-muted" : "ghost"
        }
        aria-label={label}
        title={label}
        onClick={() => setOpen(true)}
      >
        {status === "pending" ? <ShieldAlertIcon /> : <SquareTerminalIcon />}
      </Button>
      {open ? (
        <CheckScriptDialog
          environmentId={environmentId}
          task={task}
          state={state}
          canChange={canChange}
          onClose={() => {
            setOpen(false);
            refresh();
          }}
        />
      ) : null}
    </>
  );
}

function CheckScriptDialog({
  environmentId,
  task,
  state,
  canChange,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly task: ScheduledTask;
  readonly state: ScheduledTaskCheckState | undefined;
  readonly canChange: boolean;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const save = useAtomCommand(setCheck, { reportFailure: false });
  const approve = useAtomCommand(approveCheck, { reportFailure: false });
  const [draft, setDraft] = useState<CheckDraft>(() => checkDraftFrom(state));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = checkStatus(state) === "pending";
  const approving = pending && draftMatches(draft, state);
  const parsed = checkFromDraft(draft);
  const problem =
    "problem" in parsed
      ? parsed.problem === "empty"
        ? null
        : parsed.problem === "tooLong"
          ? gt("The script is too long.")
          : gt("Use a timeout from 5 to 1800 seconds.")
      : null;
  const update = (patch: Partial<CheckDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const submit = async (check: "draft" | null) => {
    setBusy(true);
    const result =
      approving && check === "draft"
        ? await approve({ environmentId, input: { taskId: task.id, sha256: state!.sha256 } })
        : await save({
            environmentId,
            input: {
              taskId: task.id,
              check: check === null || "problem" in parsed ? null : parsed.check,
            },
          });
    setBusy(false);
    if (result._tag === "Failure") {
      return setError(gt("Not saved. The script may have changed: close and open it again."));
    }
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{gt("Check script for {title}", { title: task.title })}</DialogTitle>
          <DialogDescription>
            {gt(
              "Runs before each run, in the project folder. Exit 0 wakes the agent with the script's output; exit {skip} skips the run with no turn; any other exit fails it.",
              { skip: CHECK_SKIP_EXIT_CODE },
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-4">
            {pending ? (
              <p className="flex gap-2 text-sm text-warning-foreground">
                <ShieldAlertIcon className="mt-0.5 size-4 shrink-0" />
                <T>
                  An agent wrote or changed this script. It runs with this server's full access, so
                  it does not run until you read and approve it.
                </T>
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-[10rem_8rem_1fr] sm:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="check-script-interpreter">
                  <T>Interpreter</T>
                </Label>
                <Select
                  value={draft.interpreter}
                  disabled={!canChange}
                  onValueChange={(value) => update({ interpreter: value as CheckInterpreter })}
                >
                  <SelectTrigger size="sm" id="check-script-interpreter">
                    <SelectValue>{draft.interpreter}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {CHECK_INTERPRETERS.map((interpreter) => (
                      <SelectItem key={interpreter} value={interpreter}>
                        {interpreter}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="check-script-timeout">
                  <T>Timeout (s)</T>
                </Label>
                <Input
                  id="check-script-timeout"
                  size="sm"
                  inputMode="numeric"
                  value={draft.timeoutSeconds}
                  disabled={!canChange}
                  onChange={(event) => update({ timeoutSeconds: event.target.value })}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={draft.reportOnly}
                  disabled={!canChange}
                  onCheckedChange={(reportOnly) => update({ reportOnly })}
                />
                <T>Notify only, never wake the agent</T>
              </label>
            </div>
            <Textarea
              aria-label={gt("Script")}
              size="sm"
              rows={10}
              spellCheck={false}
              value={draft.script}
              disabled={!canChange}
              onChange={(event) => update({ script: event.target.value })}
            />
            {problem === null ? null : <p className="text-sm text-destructive">{problem}</p>}
            {error === null ? null : <p className="text-sm text-destructive">{error}</p>}
          </div>
        </DialogPanel>
        <DialogFooter>
          {state !== undefined && canChange ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void submit(null)}>
              <T>Remove</T>
            </Button>
          ) : null}
          <DialogClose render={<Button variant="outline" size="sm" />}>
            <T>Cancel</T>
          </DialogClose>
          {canChange ? (
            <Button
              size="sm"
              disabled={busy || "problem" in parsed}
              onClick={() => void submit("draft")}
            >
              {approving ? <T>Approve</T> : <T>Save</T>}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
