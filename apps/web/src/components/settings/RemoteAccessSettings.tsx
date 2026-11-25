import { useAtomValue } from "@effect/atom-react";
import { managedCapabilityDenial } from "@t3tools/client-runtime/contract-labels";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  type AuthMcpClientAccess,
  type EnvironmentId,
  type PublicAddressCheckResult,
  REMOTE_MCP_TOKEN_LABEL_MAX_LENGTH,
  type RemoteMcpToken,
  type RemoteMcpTokenCreateInput,
  type RemoteMcpTokenCreateResult,
  type ServerConfig,
} from "@t3tools/contracts";
import { CopyIcon, PlusIcon } from "lucide-react";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import { useId, useState } from "react";

import { requestConfirmDialog } from "~/confirmDialog";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useClientSettings, useUpdateEnvironmentSettings } from "~/hooks/useSettings";
import { m as resolveMessage } from "~/i18n/messages";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatDateTimeTimestamp } from "~/timestampFormat";
import { accessConfig } from "../auth/ConnectAgentSurface";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { ITEM_ROW_CLASSNAME, ITEM_ROW_INNER_CLASSNAME } from "./itemRows";
import { LinkAccessPicker } from "./LinkAccessPicker";
import {
  CLOUDFLARE_TUNNEL_GUIDE_URL,
  REMOTE_MCP_GUIDE_URL,
  publicAddressCheckLabel,
  publicBaseUrlProblemLabel,
  remoteMcpEndpointUrl,
  remoteMcpSwitchState,
} from "./RemoteAccessSettings.logic";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

const TUNNEL_ADDRESS_EXAMPLE = "https://cmdeck.example.com";
const TOKEN_NAME_EXAMPLE = "laptop-claude";

const CHECK_TONE_CLASSNAME = {
  success: "text-success-foreground",
  warning: "text-warning-foreground",
  error: "text-destructive",
} as const;

const failureToast = (title: string, error: unknown, fallback: string) =>
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description:
        (error instanceof Error ? thrownErrorMessage(error, resolveMessage) : null) ?? fallback,
    }),
  );

function GuideLink({ href }: { readonly href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
      <T>Setup guide</T>
    </a>
  );
}

/** The address of a Cloudflare Tunnel the user runs; CMDeck never starts or configures one. */
export function CloudflareTunnelSettings({
  environmentId,
  publicBaseUrl,
  canWrite,
}: {
  readonly environmentId: EnvironmentId;
  readonly publicBaseUrl: string;
  readonly canWrite: boolean;
}) {
  const gt = useGT();
  const m = useMessages();
  const setting = useSearchableSetting()("cloudflare-tunnel");
  const inputId = useId();
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const checkAddress = useAtomCommand(serverEnvironment.checkPublicAddress, {
    label: "check tunnel address",
    reportFailure: false,
  });
  const [draft, setDraft] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<{
    readonly url: string;
    readonly result: PublicAddressCheckResult;
  } | null>(null);
  const value = draft ?? publicBaseUrl;
  const address = value.trim();
  const problem = publicBaseUrlProblemLabel(address, m);
  const changed = address !== publicBaseUrl;
  const shownCheck =
    checked !== null && checked.url === address ? publicAddressCheckLabel(checked.result, m) : null;

  const save = () => {
    if (!canWrite || problem !== null || !changed) return;
    updateSettings({ publicBaseUrl: address }, { onSaved: () => setDraft(null) });
  };
  const check = async () => {
    if (!canWrite || address === "" || problem !== null) return;
    setChecking(true);
    const result = await checkAddress({ environmentId, input: { url: address } });
    setChecking(false);
    if (result._tag === "Success") {
      setChecked({ url: address, result: result.value });
    } else if (!isAtomCommandInterrupted(result)) {
      failureToast(
        gt("Could not check the address"),
        squashAtomCommandFailure(result),
        gt("Try again."),
      );
    }
  };

  return (
    <SettingsSection id={setting.id} title={setting.title}>
      <div className="space-y-3 px-3 py-3 sm:px-4">
        <p className="text-xs text-muted-foreground">
          <T>
            Run your own Cloudflare Tunnel to this machine with <code>cloudflared</code>, put a
            Cloudflare Access application in front of its hostname, then enter the hostname here.
            Pairing links and webhook addresses use it. CMDeck does not start the tunnel or sign in
            to Cloudflare.
          </T>{" "}
          <GuideLink href={CLOUDFLARE_TUNNEL_GUIDE_URL} />
        </p>
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-start"
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <div className="min-w-0 flex-1 space-y-1">
            <label htmlFor={inputId} className="sr-only">
              <T>Tunnel address</T>
            </label>
            <Input
              id={inputId}
              type="url"
              inputMode="url"
              spellCheck={false}
              placeholder={TUNNEL_ADDRESS_EXAMPLE}
              value={value}
              disabled={!canWrite}
              aria-invalid={problem !== null}
              onChange={(event) => setDraft(event.target.value)}
            />
            {problem !== null ? <p className="text-xs text-destructive">{problem}</p> : null}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button type="submit" size="sm" disabled={!canWrite || !changed || problem !== null}>
              {address === "" && publicBaseUrl !== "" ? (
                <T>Clear</T>
              ) : (
                gt("Save", { $context: "verb, saves the tunnel address" })
              )}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canWrite || checking || address === "" || problem !== null}
              onClick={() => void check()}
            >
              {checking ? <T>Checking…</T> : gt("Check", { $context: "verb, tests an address" })}
            </Button>
          </div>
        </form>
        {shownCheck !== null ? (
          <p role="status" className={`text-xs ${CHECK_TONE_CLASSNAME[shownCheck.tone]}`}>
            {shownCheck.text}
          </p>
        ) : null}
      </div>
    </SettingsSection>
  );
}

/**
 * Creates one token and shows its secret once. The secret lives only in this component's state,
 * so closing the dialog drops it for good.
 */
export function RemoteMcpTokenCreator({
  create,
  onDone,
}: {
  readonly create: (
    input: RemoteMcpTokenCreateInput,
  ) => Promise<RemoteMcpTokenCreateResult | null>;
  readonly onDone: () => void;
}) {
  const gt = useGT();
  const formId = useId();
  const labelId = useId();
  const [label, setLabel] = useState("");
  const [access, setAccess] = useState<AuthMcpClientAccess>("read-only");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<RemoteMcpTokenCreateResult | null>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: {
      target: "remote MCP token",
      unavailableMessage: msg("Clipboard API is unavailable while copying the token."),
      failureMessage: msg("Failed to copy the token to the clipboard."),
    },
  });
  const trimmed = label.trim();

  const submit = async () => {
    if (busy || trimmed === "") return;
    setBusy(true);
    const result = await create({ label: trimmed, access });
    setBusy(false);
    if (result !== null) setCreated(result);
  };

  if (created !== null) {
    return (
      <>
        <DialogPanel>
          <div className="space-y-3">
            <p className="text-sm">
              <T>
                Copy the token for <Var>{created.token.label}</Var> now. It is not shown again;
                CMDeck keeps only a hash of it.
              </T>
            </p>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                aria-label={gt("Remote MCP token")}
                value={created.secret}
                spellCheck={false}
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => copyToClipboard(created.secret, undefined)}
              >
                <CopyIcon />
                {isCopied ? gt("Copied") : gt("Copy")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              <T>
                Clients send it as <code>Authorization: Bearer</code> on every request to the MCP
                address.
              </T>
            </p>
          </div>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button type="button" onClick={onDone}>
            <T>Done</T>
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogPanel>
        <form
          id={formId}
          className="space-y-4"
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1.5">
            <label id={labelId} className="block text-xs font-medium">
              <T>Name</T>
            </label>
            <Input
              aria-labelledby={labelId}
              placeholder={TOKEN_NAME_EXAMPLE}
              maxLength={REMOTE_MCP_TOKEN_LABEL_MAX_LENGTH}
              value={label}
              disabled={busy}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          <LinkAccessPicker
            value={access}
            onChange={setAccess}
            disabled={busy}
            label={<T>What a client with this token may do</T>}
            footnote={
              <T>
                Threads it starts or steers run at this mode at most. Revoke the token to cut it
                off.
              </T>
            }
          />
        </form>
      </DialogPanel>
      <DialogFooter variant="bare">
        <DialogClose disabled={busy} render={<Button variant="outline" type="button" />}>
          <T>Cancel</T>
        </DialogClose>
        <Button form={formId} type="submit" disabled={busy || trimmed === ""}>
          {busy ? <T>Creating…</T> : <T>Create token</T>}
        </Button>
      </DialogFooter>
    </>
  );
}

function RemoteMcpTokenRow({
  environmentId,
  token,
  canWrite,
}: {
  readonly environmentId: EnvironmentId;
  readonly token: RemoteMcpToken;
  readonly canWrite: boolean;
}) {
  const gt = useGT();
  const m = useMessages();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const revoke = useAtomCommand(serverEnvironment.revokeRemoteMcpToken, {
    label: "revoke remote MCP token",
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  const revokeToken = async () => {
    const question = gt("Revoke {label}? Clients using it lose access within a few seconds.", {
      label: token.label,
    });
    const confirmed =
      (await requestConfirmDialog(question, { variant: "destructive" })) ??
      window.confirm(question);
    if (!confirmed) return;
    setBusy(true);
    const result = await revoke({ environmentId, input: { id: token.id } });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      failureToast(
        gt("Could not revoke the token"),
        squashAtomCommandFailure(result),
        gt("Try again."),
      );
    }
  };
  return (
    <div className={ITEM_ROW_CLASSNAME}>
      <div className={ITEM_ROW_INNER_CLASSNAME}>
        <div className="min-w-0 space-y-0.5">
          <p className="truncate text-sm font-medium">{token.label}</p>
          <p className="text-xs text-muted-foreground">
            {gt("{access} · Created {created}", {
              access: m(accessConfig[token.access].label),
              created: formatDateTimeTimestamp(token.createdAt, timestampFormat),
            })}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="destructive-outline"
          disabled={!canWrite || busy}
          onClick={() => void revokeToken()}
        >
          {gt("Revoke", { $context: "verb, revokes a token" })}
        </Button>
      </div>
    </div>
  );
}

/** Bearer tokens on `/mcp` for MCP clients that cannot do the OAuth sign-in. */
export function RemoteMcpSettings({
  environmentId,
  serverConfig,
  externalBaseUrl,
  canRead,
  canWrite,
}: {
  readonly environmentId: EnvironmentId;
  readonly serverConfig: ServerConfig | null;
  /** The tunnel's address when set, else the address this client uses. */
  readonly externalBaseUrl: string | null;
  readonly canRead: boolean;
  readonly canWrite: boolean;
}) {
  const gt = useGT();
  const m = useMessages();
  const setting = useSearchableSetting()("remote-mcp");
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const status = useEnvironmentQuery(
    canRead ? serverEnvironment.remoteMcpStatus({ environmentId, input: {} }) : null,
    m,
  );
  const create = useAtomCommand(serverEnvironment.createRemoteMcpToken, {
    label: "create remote MCP token",
    reportFailure: false,
  });
  const canCreate = useAtomValue(
    serverEnvironment.createRemoteMcpToken.permissionAtom(environmentId),
  );
  const [creating, setCreating] = useState(false);
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: {
      target: "MCP address",
      unavailableMessage: msg("Clipboard API is unavailable while copying the MCP address."),
      failureMessage: msg("Failed to copy the MCP address to the clipboard."),
    },
  });
  const switchState = remoteMcpSwitchState(
    status.data?.envOverride,
    serverConfig?.settings.remoteMcpEnabled ?? false,
  );
  const denial = managedCapabilityDenial(serverConfig?.managedPolicy, "remoteClients", m);
  const endpoint = remoteMcpEndpointUrl(externalBaseUrl);
  const tokens = status.data?.tokens ?? [];

  const createToken = async (input: RemoteMcpTokenCreateInput) => {
    const result = await create({ environmentId, input });
    if (result._tag === "Success") return result.value;
    if (!isAtomCommandInterrupted(result)) {
      failureToast(
        gt("Could not create the token"),
        squashAtomCommandFailure(result),
        gt("Try again."),
      );
    }
    return null;
  };

  return (
    <SettingsSection id={setting.id} title={setting.title}>
      <SettingsRow
        title={gt("Accept remote MCP tokens")}
        description={
          switchState.lockedByEnv ? (
            <T>
              Set by <code>T3CODE_REMOTE_MCP</code> on this server. Remove it to use this switch.
            </T>
          ) : (
            <>
              <T>
                Lets MCP clients that reach this machine over Tailscale or your own tunnel use a
                token from the list below. Takes effect at once.
              </T>{" "}
              <GuideLink href={REMOTE_MCP_GUIDE_URL} />
            </>
          )
        }
        managed={denial}
        control={
          <Switch
            checked={switchState.enabled}
            disabled={!canWrite || switchState.lockedByEnv || denial !== undefined}
            aria-label={gt("Accept remote MCP tokens")}
            onCheckedChange={(enabled) => updateSettings({ remoteMcpEnabled: enabled })}
          />
        }
      />
      <SettingsRow
        title={gt("MCP address")}
        description={
          endpoint === null ? (
            <T>Set your tunnel address above, or connect over Tailscale, to see it.</T>
          ) : (
            <code className="break-all">{endpoint}</code>
          )
        }
        control={
          endpoint === null ? undefined : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => copyToClipboard(endpoint, undefined)}
            >
              <CopyIcon />
              {isCopied ? gt("Copied") : gt("Copy")}
            </Button>
          )
        }
      />
      <SettingsRow
        title={gt("Tokens")}
        description={
          canRead ? (
            status.error !== null ? (
              <span className="text-destructive">{status.error}</span>
            ) : tokens.length === 0 ? (
              <T>No tokens yet.</T>
            ) : (
              gt("{count, plural, one {{count} token} other {{count} tokens}}", {
                count: tokens.length,
              })
            )
          ) : (
            <T>This connection cannot view remote MCP tokens.</T>
          )
        }
        control={
          <Dialog open={creating} onOpenChange={setCreating}>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canCreate}
              onClick={() => setCreating(true)}
            >
              <PlusIcon />
              <T>Create token</T>
            </Button>
            <DialogPopup className="max-w-md">
              <DialogHeader>
                <DialogTitle>
                  <T>Create a remote MCP token</T>
                </DialogTitle>
                <DialogDescription>
                  <T>
                    For an MCP client that reaches this machine over Tailscale or your own tunnel.
                  </T>
                </DialogDescription>
              </DialogHeader>
              {creating ? (
                <RemoteMcpTokenCreator create={createToken} onDone={() => setCreating(false)} />
              ) : null}
            </DialogPopup>
          </Dialog>
        }
      />
      {tokens.map((token) => (
        <RemoteMcpTokenRow
          key={token.id}
          environmentId={environmentId}
          token={token}
          canWrite={canWrite}
        />
      ))}
    </SettingsSection>
  );
}
