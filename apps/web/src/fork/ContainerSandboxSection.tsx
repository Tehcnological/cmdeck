import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import {
  CMDECK_WS_METHODS,
  type EnvironmentId,
  type SandboxConfigureInput,
  type SandboxRuntimeKind,
  type SandboxStatus,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { T, useGT } from "gt-react";
import { useState } from "react";

import { SettingsRow, SettingsSection } from "../components/settings/settingsLayout";
import { useSettingsScope } from "../components/settings/SettingsScopeContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
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
import { useProjects } from "../state/entities";
import { useAtomCommand } from "../state/use-atom-command";
import {
  formFromRecipe,
  optionalOciRuntimes,
  type RecipeForm,
  recipeFromForm,
} from "./containerSandbox.logic";

export const sandboxStatus = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:cmdeck:sandbox-status",
  tag: CMDECK_WS_METHODS.sandboxStatus,
  staleTimeMs: 0,
});

export const configureSandbox = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:sandbox-configure",
  tag: CMDECK_WS_METHODS.sandboxConfigure,
});

// Product names stay English in every language.
const RUNTIME_NAMES: Record<SandboxRuntimeKind, string> = {
  docker: "Docker",
  apple: "Apple container",
};

/** Settings > General: the container recipe and which projects run in it (WI-2.18). */
export function ContainerSandboxSection() {
  const { environment } = useSettingsScope();
  return environment === null ? null : (
    <ContainerSandbox key={environment.environmentId} environmentId={environment.environmentId} />
  );
}

function ContainerSandbox({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const gt = useGT();
  // Read afresh each time Settings opens; the server probes Docker only once an image is set.
  // "Check again" switches to a query that probes the runtimes afresh.
  const [probe, setProbe] = useState(false);
  const statusAtom = sandboxStatus({ environmentId, input: probe ? { refresh: true } : {} });
  const result = useAtomValue(statusAtom);
  const refresh = useAtomRefresh(statusAtom);
  const canChange = useAtomValue(configureSandbox.permissionAtom(environmentId));
  const configure = useAtomCommand(configureSandbox, { reportFailure: false });
  const projects = useProjects().filter(
    (project) => project.environmentId === environmentId && project.isScratch !== true,
  );
  const status = AsyncResult.getOrElse(result, () => null);
  const [form, setForm] = useState<RecipeForm | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (status === null) return null;
  const current = form ?? formFromRecipe(status.recipe);
  const edit = (patch: Partial<RecipeForm>) => setForm({ ...current, ...patch });
  const ociRuntimes = optionalOciRuntimes(status);
  const selected = status.runtimes.find((runtime) => runtime.kind === current.runtime);

  const apply = async (input: SandboxConfigureInput) => {
    const applied = await configure({ environmentId, input });
    if (applied._tag === "Failure") {
      const error = Cause.squash(applied.cause);
      setMessage(
        gt("Could not save: {error}", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return;
    }
    setMessage(null);
    setForm(null);
    refresh();
  };

  return (
    <SettingsSection
      id="containers"
      title={gt("Containers")}
      headerAction={
        <Button size="xs" variant="outline" onClick={() => (probe ? refresh() : setProbe(true))}>
          <T>Check again</T>
        </Button>
      }
    >
      <div className="space-y-2 px-4 py-3 text-xs text-muted-foreground sm:px-5">
        <p>
          <T>
            Run a thread's agent and terminals in a container that sees only its worktree and the
            paths you add. A container is not a virtual machine: it shares this computer's kernel.
            Changes apply the next time the agent or a terminal starts. Only Claude can run in a
            container for now.
          </T>
        </p>
        <ReadinessLine status={status} />
        {message === null ? null : <p className="text-destructive">{message}</p>}
      </div>

      <SettingsRow
        title={gt("Runtime")}
        description={
          selected?.available === false && selected.reason !== null ? selected.reason : undefined
        }
        control={
          <Select
            value={current.runtime}
            disabled={!canChange}
            onValueChange={(value) => {
              if (value === "docker" || value === "apple") edit({ runtime: value });
            }}
          >
            <SelectTrigger aria-label={gt("Runtime")} className="min-w-40" size="xs">
              <SelectValue>{RUNTIME_NAMES[current.runtime]}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {status.runtimes.map((runtime) => (
                <SelectItem key={runtime.kind} value={runtime.kind}>
                  {RUNTIME_NAMES[runtime.kind]}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      {current.runtime === "docker" && ociRuntimes.length > 0 ? (
        <SettingsRow
          title={gt("OCI runtime")}
          control={
            <Select
              value={current.ociRuntime}
              disabled={!canChange}
              onValueChange={(value) => edit({ ociRuntime: value ?? "" })}
            >
              <SelectTrigger aria-label={gt("OCI runtime")} className="min-w-40" size="xs">
                <SelectValue>
                  {current.ociRuntime === "" ? gt("Docker's default") : current.ociRuntime}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="">{gt("Docker's default")}</SelectItem>
                {ociRuntimes.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      ) : null}

      <div className="grid gap-3 px-4 py-3 sm:grid-cols-2 sm:px-5">
        <Field label={gt("Image")}>
          <Input
            value={current.image}
            disabled={!canChange}
            onChange={(event) => edit({ image: event.target.value })}
          />
        </Field>
        <Field
          label={gt("Network")}
          hint={gt(
            "none turns networking off, so the agent cannot reach its model API either. Name a network to allow it.",
          )}
        >
          <Input
            value={current.network}
            disabled={!canChange}
            onChange={(event) => edit({ network: event.target.value })}
          />
        </Field>
        <Field label={gt("CPUs")}>
          <Input
            value={current.cpus}
            disabled={!canChange}
            onChange={(event) => edit({ cpus: event.target.value })}
          />
        </Field>
        <Field label={gt("Memory")}>
          <Input
            value={current.memory}
            disabled={!canChange}
            onChange={(event) => edit({ memory: event.target.value })}
          />
        </Field>
        <Field
          label={gt("Extra mounts")}
          hint={gt(
            "One host path per line, mounted at the same path. End a line with :ro for read-only. ~/.ssh and ~/.aws are never mounted unless listed here.",
          )}
        >
          <Textarea
            value={current.mounts}
            disabled={!canChange}
            onChange={(event) => edit({ mounts: event.target.value })}
          />
        </Field>
        <Field
          label={gt("Environment variables")}
          hint={gt("Names passed into the container, besides provider credentials.")}
        >
          <Input
            value={current.env}
            disabled={!canChange}
            onChange={(event) => edit({ env: event.target.value })}
          />
        </Field>
      </div>
      <div className="flex justify-end px-4 pb-3 sm:px-5">
        <Button
          size="xs"
          disabled={!canChange || form === null}
          onClick={() => void apply({ recipe: recipeFromForm(current) })}
        >
          <T>Save</T>
        </Button>
      </div>

      {projects.map((project) => {
        const on = status.projects.some(
          (entry) => entry.projectId === project.id && entry.mode === "on",
        );
        return (
          <SettingsRow
            key={project.id}
            title={project.title}
            description={project.workspaceRoot}
            control={
              <Switch
                checked={on}
                disabled={!canChange}
                aria-label={gt("Run {project} in a container", { project: project.title })}
                onCheckedChange={(checked) =>
                  void apply({
                    project: { projectId: project.id, mode: checked ? "on" : "off" },
                  })
                }
              />
            }
          />
        );
      })}
    </SettingsSection>
  );
}

function ReadinessLine({ status }: { readonly status: SandboxStatus }) {
  if (status.ready) {
    return (
      <p className="text-foreground">
        <T>Ready to start containers.</T>
      </p>
    );
  }
  if (status.recipe.image === "") {
    return (
      <p>
        <T>Choose an image to turn containers on.</T>
      </p>
    );
  }
  const runtime = status.runtimes.find((entry) => entry.kind === status.recipe.runtime);
  return <p className="text-destructive">{runtime?.reason ?? null}</p>;
}

function Field(props: {
  readonly label: string;
  readonly hint?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium text-foreground">{props.label}</span>
      {props.children}
      {props.hint === undefined ? null : (
        <span className="text-muted-foreground">{props.hint}</span>
      )}
    </label>
  );
}
