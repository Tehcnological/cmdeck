import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  type MemoryBulkOperation,
  type MemoryItem,
  type MemoryKind,
  type MemoryProvenance,
  type MemoryScopeKind,
  type MemoryStatus,
} from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { useState } from "react";

import { RelativeTime } from "../../components/RelativeTime";
import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "../../components/settings/settingsLayout";
import { useSettingsScope } from "../../components/settings/SettingsScopeContext";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { Textarea } from "../../components/ui/textarea";
import { Toggle, ToggleGroup } from "../../components/ui/toggle-group";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useProjects } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  availableBulkOperations,
  bulkPreviewSummary,
  canRestoreRevision,
  describeRevision,
  type MemoryBulkOperationType,
  selectedItems,
  splitScope,
  toggleAllSelected,
  toggleSelected,
} from "./memorySettings.logic";
import { LessonsSection } from "./LessonsSection";
import {
  applyMemoryEdit,
  editMemory,
  memoryList,
  memoryEditPreview,
  memoryRevisions,
  revertMemory,
} from "./memoryRpc";

// Kiro shows 25 changed rows per preview page; a longer preview says how many more.
const PREVIEW_ROWS = 25;

const failureText = (result: {
  readonly cause: Parameters<typeof squashAtomCommandFailure>[0]["cause"];
}) => {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : null;
};

/** Settings > Memory (WI-2.05): what CMDeck remembers on this server, and every change to it. */
export function MemorySettings() {
  const { environment } = useSettingsScope();
  return (
    <SettingsPageContainer>
      {environment === null ? null : (
        <MemoryEnvironment
          key={environment.environmentId}
          environmentId={environment.environmentId}
        />
      )}
    </SettingsPageContainer>
  );
}

function MemoryEnvironment({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const gt = useGT();
  const enabled = useEnvironmentSettings(
    environmentId,
    (settings) => settings.cmdeck.memoryEnabled,
  );
  const canWrite = useAtomValue(serverEnvironment.updateSettings.permissionAtom(environmentId));
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings);
  return (
    <>
      <SettingsSection
        id="memory"
        title={gt("Memory", { $context: "what CMDeck remembers for agents" })}
      >
        <SettingsRow
          title={gt("Remember across threads")}
          description={gt(
            "Rules and facts you save are given to agents at the start of each turn, on this server only. Agents can only propose items; nothing they propose is used until you accept it here.",
          )}
          control={
            <Switch
              checked={enabled}
              disabled={!canWrite}
              aria-label={gt("Remember across threads")}
              onCheckedChange={(checked) =>
                void updateSettings({
                  environmentId,
                  input: { patch: { cmdeck: { memoryEnabled: Boolean(checked) } } },
                })
              }
            />
          }
        />
      </SettingsSection>
      {enabled ? (
        <>
          <MemoryItems environmentId={environmentId} />
          <LessonsSection environmentId={environmentId} />
        </>
      ) : null}
    </>
  );
}

type StatusFilter = MemoryStatus | "all";
type ScopeFilter = MemoryScopeKind | "all";

function MemoryItems({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const gt = useGT();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [scopeKind, setScopeKind] = useState<ScopeFilter>("all");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [bulk, setBulk] = useState<MemoryBulkOperationType | null>(null);
  const [editing, setEditing] = useState<MemoryItem | null>(null);
  const [history, setHistory] = useState<MemoryItem | null>(null);
  const query = useEnvironmentQuery(
    memoryList({
      environmentId,
      input: {
        ...(status === "all" ? {} : { status }),
        ...(scopeKind === "all" ? {} : { scopeKind }),
      },
    }),
  );
  const pendingQuery = useEnvironmentQuery(
    memoryList({ environmentId, input: { status: "pending" } }),
  );
  const canEdit = useAtomValue(applyMemoryEdit.permissionAtom(environmentId));
  const apply = useAtomCommand(applyMemoryEdit);
  const items = query.data ?? [];
  const selected = selectedItems(items, selectedIds);
  const pendingCount = pendingQuery.data?.length ?? 0;

  const refresh = () => {
    query.refresh();
    pendingQuery.refresh();
  };
  const applyOne = async (item: MemoryItem, type: "accept" | "retire" | "restore") => {
    await apply({ environmentId, input: { items: [item], operation: { type } } });
    refresh();
  };

  const statusLabels = {
    all: gt("All statuses"),
    active: gt("Active", { $context: "memory item status" }),
    pending: gt("Proposed", { $context: "memory item status" }),
    retired: gt("Retired", { $context: "memory item status" }),
  } satisfies Record<StatusFilter, string>;
  const scopeLabels = {
    all: gt("All scopes"),
    global: gt("Everywhere", { $context: "memory scope" }),
    project: gt("Project", { $context: "memory scope" }),
    repo: gt("Repository", { $context: "memory scope" }),
    bot: gt("Bot", { $context: "memory scope" }),
    thread: gt("Thread", { $context: "memory scope" }),
  } satisfies Record<ScopeFilter, string>;
  const bulkLabels = {
    accept: gt("Accept", { $context: "accept proposed memory" }),
    retire: gt("Retire", { $context: "retire memory items" }),
    restore: gt("Restore", { $context: "restore retired memory items" }),
    replace_text: gt("Replace text"),
  } satisfies Record<MemoryBulkOperationType, string>;

  return (
    <SettingsSection
      id="memory-items"
      title={gt("Saved memory")}
      headerAction={
        <Button size="xs" variant="ghost" onClick={refresh}>
          <T>Refresh</T>
        </Button>
      }
    >
      {pendingCount > 0 && status !== "pending" ? (
        <SettingsRow
          title={gt(
            "{count, plural, one {{count} proposal waits for you} other {{count} proposals wait for you}}",
            { count: pendingCount },
          )}
          description={gt("Agents proposed these. Review and accept the ones you want used.")}
          control={
            <Button size="sm" variant="outline" onClick={() => setStatus("pending")}>
              <T>Review proposals</T>
            </Button>
          }
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:px-4">
        <Select
          value={status}
          onValueChange={(next: StatusFilter | null) => {
            if (next !== null) setStatus(next);
          }}
        >
          <SelectTrigger size="sm" className="w-40" aria-label={gt("Status")}>
            <SelectValue>{(value: StatusFilter) => statusLabels[value]}</SelectValue>
          </SelectTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            {(["all", "active", "pending", "retired"] as const).map((value) => (
              <SelectItem key={value} hideIndicator value={value}>
                {statusLabels[value]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Select
          value={scopeKind}
          onValueChange={(next: ScopeFilter | null) => {
            if (next !== null) setScopeKind(next);
          }}
        >
          <SelectTrigger size="sm" className="w-40" aria-label={gt("Scope")}>
            <SelectValue>{(value: ScopeFilter) => scopeLabels[value]}</SelectValue>
          </SelectTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            {(["all", "global", "project", "repo", "bot", "thread"] as const).map((value) => (
              <SelectItem key={value} hideIndicator value={value}>
                {scopeLabels[value]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        {canEdit && items.length > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelectedIds(toggleAllSelected(items, selectedIds))}
          >
            {items.every((item) => selectedIds.has(item.id)) ? (
              <T>Clear selection</T>
            ) : (
              <T>Select all</T>
            )}
          </Button>
        ) : null}
      </div>
      {selected.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2.5 sm:px-4">
          <span className="text-muted-foreground text-sm">
            {gt("{count, plural, one {{count} selected} other {{count} selected}}", {
              count: selected.length,
            })}
          </span>
          {availableBulkOperations(selected).map((type) => (
            <Button key={type} size="sm" variant="outline" onClick={() => setBulk(type)}>
              {bulkLabels[type]}
            </Button>
          ))}
        </div>
      ) : null}
      {query.error !== null ? (
        <p className="border-t px-3 py-3 text-destructive text-sm sm:px-4">{query.error}</p>
      ) : items.length === 0 ? (
        <p className="border-t px-3 py-3 text-muted-foreground text-sm sm:px-4">
          <T>Nothing saved matches these filters.</T>
        </p>
      ) : (
        <ul>
          {items.map((item) => (
            <MemoryItemRow
              key={item.id}
              item={item}
              canEdit={canEdit}
              selected={selectedIds.has(item.id)}
              onToggle={() => setSelectedIds(toggleSelected(selectedIds, item.id))}
              onEdit={() => setEditing(item)}
              onHistory={() => setHistory(item)}
              onAction={(type) => void applyOne(item, type)}
            />
          ))}
        </ul>
      )}
      {bulk === null ? null : (
        <BulkEditDialog
          environmentId={environmentId}
          type={bulk}
          title={bulkLabels[bulk]}
          items={selected}
          onClose={(applied) => {
            setBulk(null);
            if (applied) {
              setSelectedIds(new Set());
              refresh();
            }
          }}
        />
      )}
      {editing === null ? null : (
        <EditDialog
          environmentId={environmentId}
          item={editing}
          onClose={(saved) => {
            setEditing(null);
            if (saved) refresh();
          }}
        />
      )}
      {history === null ? null : (
        <HistoryDialog
          environmentId={environmentId}
          item={history}
          canEdit={canEdit}
          onClose={(restored) => {
            setHistory(null);
            if (restored) refresh();
          }}
        />
      )}
    </SettingsSection>
  );
}

function useScopeLabel() {
  const gt = useGT();
  const projects = useProjects();
  return (scope: string) => {
    const { kind, target } = splitScope(scope);
    switch (kind) {
      case "global":
        return gt("Everywhere", { $context: "memory scope" });
      case "project": {
        const title = projects.find((project) => project.id === target)?.title ?? target ?? "";
        return gt("Project: {name}", { name: title });
      }
      case "repo":
        return gt("Repository: {name}", { name: target ?? "" });
      case "bot":
        return gt("Bot: {name}", { name: target ?? "" });
      case "thread":
        return gt("One thread");
    }
  };
}

function useStatusLabel() {
  const gt = useGT();
  return (status: MemoryStatus) => {
    switch (status) {
      case "active":
        return gt("Active", { $context: "memory item status" });
      case "pending":
        return gt("Proposed", { $context: "memory item status" });
      case "retired":
        return gt("Retired", { $context: "memory item status" });
    }
  };
}

function useProvenanceLabel() {
  const gt = useGT();
  return (provenance: MemoryProvenance) => {
    switch (provenance) {
      case "user_explicit":
        return gt("Saved by you");
      case "user_confirmed":
        return gt("Accepted by you");
      case "agent_inferred":
        return gt("Proposed by an agent");
      case "imported":
        return gt("Imported");
    }
  };
}

function MemoryItemRow(props: {
  readonly item: MemoryItem;
  readonly canEdit: boolean;
  readonly selected: boolean;
  readonly onToggle: () => void;
  readonly onEdit: () => void;
  readonly onHistory: () => void;
  readonly onAction: (type: "accept" | "retire" | "restore") => void;
}) {
  const gt = useGT();
  const scopeLabel = useScopeLabel();
  const provenanceLabel = useProvenanceLabel();
  const { item } = props;
  return (
    <li className="flex items-start gap-3 border-t px-3 py-3 sm:px-4">
      {props.canEdit ? (
        <Checkbox
          className="mt-0.5"
          checked={props.selected}
          onCheckedChange={props.onToggle}
          aria-label={gt("Select this item")}
        />
      ) : null}
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="whitespace-pre-wrap break-words text-sm">{item.content}</p>
        <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
          <Badge size="sm" variant="secondary">
            {item.kind === "rule"
              ? gt("Rule", { $context: "memory item kind" })
              : gt("Fact", { $context: "memory item kind" })}
          </Badge>
          {item.status === "pending" ? (
            <Badge size="sm" variant="info">
              {gt("Proposed", { $context: "memory item status" })}
            </Badge>
          ) : item.status === "retired" ? (
            <Badge size="sm" variant="warning">
              {gt("Retired", { $context: "memory item status" })}
            </Badge>
          ) : null}
          <span>{scopeLabel(item.scope)}</span>
          <span aria-hidden="true">·</span>
          <span>{provenanceLabel(item.provenance)}</span>
          <span aria-hidden="true">·</span>
          <RelativeTime timestamp={item.updatedAt} />
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-1">
        {props.canEdit && item.status === "pending" ? (
          <Button size="xs" variant="outline" onClick={() => props.onAction("accept")}>
            {gt("Accept", { $context: "accept proposed memory" })}
          </Button>
        ) : null}
        {props.canEdit ? (
          <Button size="xs" variant="ghost" onClick={props.onEdit}>
            {gt("Edit", { $context: "edit a memory item" })}
          </Button>
        ) : null}
        <Button size="xs" variant="ghost" onClick={props.onHistory}>
          <T>History</T>
        </Button>
        {props.canEdit ? (
          item.status === "retired" ? (
            <Button size="xs" variant="ghost" onClick={() => props.onAction("restore")}>
              {gt("Restore", { $context: "restore retired memory items" })}
            </Button>
          ) : (
            <Button size="xs" variant="ghost-destructive" onClick={() => props.onAction("retire")}>
              {gt("Retire", { $context: "retire memory items" })}
            </Button>
          )
        ) : null}
      </div>
    </li>
  );
}

function BulkEditDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly type: MemoryBulkOperationType;
  readonly title: string;
  readonly items: ReadonlyArray<MemoryItem>;
  readonly onClose: (applied: boolean) => void;
}) {
  const gt = useGT();
  const statusLabel = useStatusLabel();
  const replacing = props.type === "replace_text";
  const apply = useAtomCommand(applyMemoryEdit, { reportFailure: false });
  const [find, setFind] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  // Accept, retire and restore need no input, so their preview shows at once.
  const [previewed, setPreviewed] = useState<MemoryBulkOperation | null>(
    props.type === "replace_text" ? null : { type: props.type },
  );
  const [applyError, setApplyError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const preview = useEnvironmentQuery(
    previewed === null
      ? null
      : memoryEditPreview({
          environmentId: props.environmentId,
          input: { items: props.items, operation: previewed },
        }),
  );
  const result = preview.data;
  const error = applyError ?? preview.error;
  const changeReplace = (update: () => void) => {
    update();
    setPreviewed(null);
  };

  const runApply = async () => {
    if (previewed === null) return;
    setBusy(true);
    const outcome = await apply({
      environmentId: props.environmentId,
      input: { items: props.items, operation: previewed },
    });
    setBusy(false);
    if (outcome._tag === "Failure") return setApplyError(failureText(outcome));
    props.onClose(true);
  };

  const summary = result === null ? null : bulkPreviewSummary(result);
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose(false))}>
      <DialogPopup className="max-h-[85dvh] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>
            <T>
              Preview what changes, then apply it. Each change is saved as a revision you can undo
              from the item&apos;s history.
            </T>
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-3">
            {replacing ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  value={find}
                  placeholder={gt("Find")}
                  aria-label={gt("Find")}
                  onChange={(event) => changeReplace(() => setFind(event.target.value))}
                />
                <Input
                  value={replacement}
                  placeholder={gt("Replace with")}
                  aria-label={gt("Replace with")}
                  onChange={(event) => changeReplace(() => setReplacement(event.target.value))}
                />
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={matchCase}
                    onCheckedChange={(checked) =>
                      changeReplace(() => setMatchCase(Boolean(checked)))
                    }
                  />
                  <T>Match case</T>
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={find === ""}
                  onClick={() =>
                    setPreviewed({ type: "replace_text", find, replacement, matchCase })
                  }
                >
                  <T>Preview</T>
                </Button>
              </div>
            ) : null}
            {error === null ? null : <p className="text-destructive text-sm">{error}</p>}
            {summary === null || result === null ? null : (
              <>
                <p className="text-sm">
                  {gt(
                    "{changed, plural, one {{changed} item changes} other {{changed} items change}}; {unchanged, plural, one {{unchanged} stays as it is} other {{unchanged} stay as they are}}.",
                    { changed: summary.changed, unchanged: summary.unchanged },
                  )}
                </p>
                <ul className="space-y-2">
                  {result.changes.slice(0, PREVIEW_ROWS).map(({ before, after }) => (
                    <li key={before.id} className="rounded-md border px-3 py-2 text-sm">
                      {before.content === after.content ? (
                        <p className="whitespace-pre-wrap break-words">{after.content}</p>
                      ) : (
                        <>
                          <p className="whitespace-pre-wrap break-words text-muted-foreground line-through">
                            {before.content}
                          </p>
                          <p className="whitespace-pre-wrap break-words">{after.content}</p>
                        </>
                      )}
                      {before.status === after.status ? null : (
                        <p className="mt-1 text-muted-foreground text-xs">
                          {gt("Status: {before} → {after}", {
                            before: statusLabel(before.status),
                            after: statusLabel(after.status),
                          })}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
                {result.changes.length > PREVIEW_ROWS ? (
                  <p className="text-muted-foreground text-xs">
                    {gt("And {count} more.", { count: result.changes.length - PREVIEW_ROWS })}
                  </p>
                ) : null}
              </>
            )}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={() => props.onClose(false)}>
            <T>Cancel</T>
          </Button>
          <Button
            disabled={busy || previewed === null || result === null || result.changes.length === 0}
            onClick={() => void runApply()}
          >
            <T>Apply</T>
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function EditDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly item: MemoryItem;
  readonly onClose: (saved: boolean) => void;
}) {
  const gt = useGT();
  const edit = useAtomCommand(editMemory, { reportFailure: false });
  const [content, setContent] = useState(props.item.content);
  const [kind, setKind] = useState<MemoryKind>(props.item.kind);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const outcome = await edit({
      environmentId: props.environmentId,
      input: { itemId: props.item.id, content, kind },
    });
    setBusy(false);
    if (outcome._tag === "Failure") return setError(failureText(outcome));
    props.onClose(true);
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose(false))}>
      <DialogPopup className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            <T>Edit memory</T>
          </DialogTitle>
          <DialogDescription>
            <T>
              Scope and source stay as they are. Saving keeps the old version in the item&apos;s
              history.
            </T>
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-3">
            <Textarea
              value={content}
              aria-label={gt("Content")}
              onChange={(event) => setContent(event.target.value)}
            />
            <ToggleGroup
              value={[kind]}
              onValueChange={(value: ReadonlyArray<string>) => {
                const [next] = value;
                if (next === "rule" || next === "fact") setKind(next);
              }}
            >
              <Toggle value="rule">{gt("Rule: used every turn")}</Toggle>
              <Toggle value="fact">{gt("Fact: used when relevant")}</Toggle>
            </ToggleGroup>
            {error === null ? null : <p className="text-destructive text-sm">{error}</p>}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={() => props.onClose(false)}>
            <T>Cancel</T>
          </Button>
          <Button disabled={busy || content.trim() === ""} onClick={() => void save()}>
            <T>Save</T>
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function HistoryDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly item: MemoryItem;
  readonly canEdit: boolean;
  readonly onClose: (restored: boolean) => void;
}) {
  const gt = useGT();
  const query = useEnvironmentQuery(
    memoryRevisions({ environmentId: props.environmentId, input: { itemId: props.item.id } }),
  );
  const revert = useAtomCommand(revertMemory, { reportFailure: false });
  const [error, setError] = useState<string | null>(null);
  const revisions = (query.data ?? []).toReversed();
  const current = revisions[0]?.after ?? props.item;
  const changeLabels = {
    created: gt("Created"),
    accepted: gt("Accepted", { $context: "memory revision" }),
    retired: gt("Retired", { $context: "memory revision" }),
    restored: gt("Restored", { $context: "memory revision" }),
    edited: gt("Edited", { $context: "memory revision" }),
  } as const;

  const restore = async (revision: number) => {
    const outcome = await revert({
      environmentId: props.environmentId,
      input: { itemId: props.item.id, revision },
    });
    if (outcome._tag === "Failure") return setError(failureText(outcome));
    props.onClose(true);
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose(false))}>
      <DialogPopup className="max-h-[85dvh] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            <T>Revision history</T>
          </DialogTitle>
          <DialogDescription>
            <T>Every change is kept. Restoring a version saves it as a new revision.</T>
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {error === null ? null : <p className="mb-2 text-destructive text-sm">{error}</p>}
          <ol className="space-y-2">
            {revisions.map((revision) => (
              <li key={revision.revision} className="rounded-md border px-3 py-2 text-sm">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
                  <span>{gt("Revision {number}", { number: revision.revision })}</span>
                  <span>{changeLabels[describeRevision(revision)]}</span>
                  <span>{revision.actor === "user" ? gt("by you") : gt("by an agent")}</span>
                  <RelativeTime timestamp={revision.createdAt} />
                  {props.canEdit && canRestoreRevision(revision, current) ? (
                    <Button
                      size="xs"
                      variant="outline"
                      className="ms-auto"
                      onClick={() => void restore(revision.revision)}
                    >
                      <T>Restore this version</T>
                    </Button>
                  ) : null}
                </div>
                <p className="whitespace-pre-wrap break-words">{revision.after.content}</p>
              </li>
            ))}
          </ol>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
