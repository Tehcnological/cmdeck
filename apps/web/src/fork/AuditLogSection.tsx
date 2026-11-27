import { useAtomValue } from "@effect/atom-react";
import {
  type AuditEntry,
  type AuditVerifyResult,
  CMDECK_WS_METHODS,
  type EnvironmentId,
} from "@t3tools/contracts";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { T, useGT } from "gt-react";
import { useState } from "react";

import { SettingsSection } from "../components/settings/settingsLayout";
import { Button } from "../components/ui/button";
import { connectionAtomRuntime } from "../connection/runtime";
import { useAtomCommand } from "../state/use-atom-command";

const auditList = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:audit-list",
  tag: CMDECK_WS_METHODS.auditList,
});

const auditVerify = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:audit-verify",
  tag: CMDECK_WS_METHODS.auditVerify,
});

const PAGE = 50;

/** Settings > Diagnostics: the audit log (WI-1.03). Shown only to clients allowed to read it. */
export function AuditLogSection(props: { readonly environmentId: EnvironmentId | null }) {
  return props.environmentId === null ? null : <AuditLog environmentId={props.environmentId} />;
}

function AuditLog({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const gt = useGT();
  const canRead = useAtomValue(auditList.permissionAtom(environmentId));
  const list = useAtomCommand(auditList, { reportFailure: false });
  const verify = useAtomCommand(auditVerify, { reportFailure: false });
  const [entries, setEntries] = useState<ReadonlyArray<AuditEntry> | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [verified, setVerified] = useState<AuditVerifyResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canRead) return null;

  const load = async (beforeSeq?: number) => {
    setPending(true);
    const result = await list({
      environmentId,
      input: beforeSeq === undefined ? { limit: PAGE } : { beforeSeq, limit: PAGE },
    });
    setPending(false);
    if (result._tag === "Failure") {
      setError(gt("Could not read the audit log."));
      return;
    }
    setError(null);
    setEntries((current) =>
      beforeSeq === undefined
        ? result.value.entries
        : [...(current ?? []), ...result.value.entries],
    );
    setHasMore(result.value.hasMore);
  };

  const check = async () => {
    setPending(true);
    const result = await verify({ environmentId, input: {} });
    setPending(false);
    if (result._tag === "Failure") {
      setError(gt("Could not read the audit log."));
      return;
    }
    setError(null);
    setVerified(result.value);
  };

  const kindLabel = (kind: string) => {
    switch (kind) {
      case "approval.resolved":
        return gt("Approval answered");
      case "device.pairing_approved":
        return gt("Device pairing approved");
      case "mcp_token.created":
        return gt("Remote MCP token created");
      case "mcp_token.used":
        return gt("Remote MCP token used");
      case "mcp_token.revoked":
        return gt("Remote MCP token revoked");
      case "secret.revealed":
        return gt("Secret handed to an agent");
      case "import.run":
        return gt("Data imported");
      case "audit.pruned":
        return gt("Old entries removed");
      default:
        return kind;
    }
  };

  const verdict =
    verified === null
      ? null
      : verified.ok
        ? gt("Intact: {count} entries checked.", { count: verified.checked })
        : gt("Broken at entry {seq}: it or an entry before it was changed or removed.", {
            seq: verified.brokenSeq ?? 0,
          });

  return (
    <SettingsSection
      title={gt("Audit Log")}
      headerAction={
        <div className="flex items-center gap-1.5">
          <Button size="xs" variant="outline" disabled={pending} onClick={() => void check()}>
            <T>Verify chain</T>
          </Button>
          <Button size="xs" variant="outline" disabled={pending} onClick={() => void load()}>
            <T>Show entries</T>
          </Button>
        </div>
      }
    >
      <div className="space-y-2 px-4 py-3 text-xs text-muted-foreground sm:px-5">
        <p>
          <T>
            Approvals, device pairings, remote MCP tokens, secrets handed to agents and imports are
            recorded on this machine. Each entry includes the previous entry's hash, so the log is
            tamper-evident, not tamper-proof: verifying shows an edited or removed entry, but anyone
            who can write this machine's database can rebuild the whole chain.
          </T>
        </p>
        {verdict === null ? null : (
          <p className={verified?.ok ? "text-foreground" : "text-destructive"}>{verdict}</p>
        )}
        {error === null ? null : <p className="text-destructive">{error}</p>}
      </div>
      {entries === null ? null : (
        <div className="border-t border-border/60 px-4 py-2 text-xs sm:px-5">
          {entries.length === 0 ? (
            <p className="py-1 text-muted-foreground">
              <T>No entries yet.</T>
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {entries.map((entry) => (
                <li key={entry.seq} className="flex flex-wrap items-baseline gap-x-3 py-1.5">
                  <span className="tabular-nums text-muted-foreground">#{entry.seq}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {new Date(entry.occurredAt).toLocaleString()}
                  </span>
                  <span className="font-medium text-foreground">{kindLabel(entry.kind)}</span>
                  {entry.subject === null ? null : (
                    <span className="min-w-0 truncate text-muted-foreground">{entry.subject}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {hasMore ? (
            <Button
              size="xs"
              variant="ghost"
              disabled={pending}
              onClick={() => void load(entries.at(-1)?.seq)}
            >
              <T>Show older</T>
            </Button>
          ) : null}
        </div>
      )}
    </SettingsSection>
  );
}
