import { useAtomValue } from "@effect/atom-react";
import {
  type EnvironmentId,
  type KnowledgeSource,
  type KnowledgeSourceKind,
  ProjectId,
} from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { useEffect, useState } from "react";

import { SettingsRow, SettingsSection } from "../../components/settings/settingsLayout";
import { useSettingsScope } from "../../components/settings/SettingsScopeContext";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { useProjects } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { anyIndexing, INDEXING_REFRESH_MS, splitSources } from "./knowledge.logic";
import {
  addKnowledgeSource,
  cancelKnowledgeIndex,
  knowledgeList,
  reindexKnowledgeSource,
  removeKnowledgeSource,
} from "./knowledgeRpc";

const FORM_CLASS = "flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:px-4";

/** Settings > General: each project's knowledge sources and notes folder (WI-2.09). */
export function KnowledgeSection() {
  const { environment } = useSettingsScope();
  return environment === null ? null : (
    <KnowledgeLibrary key={environment.environmentId} environmentId={environment.environmentId} />
  );
}

function KnowledgeLibrary({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const gt = useGT();
  const projects = useProjects().filter(
    (project) => project.environmentId === environmentId && project.isScratch !== true,
  );
  const [chosen, setChosen] = useState<string | null>(null);
  const projectId = chosen ?? projects[0]?.id ?? null;

  return (
    <SettingsSection
      id="knowledge-library"
      title={gt("Knowledge library", { $context: "settings section" })}
    >
      <SettingsRow
        title={gt("Project")}
        description={gt(
          "Folders and files this project's agents can search with knowledge_search. Credential files, .env files, keys and anything the folder's .gitignore lists are never indexed.",
        )}
        control={
          <Select
            value={projectId}
            onValueChange={(value) => setChosen(typeof value === "string" ? value : null)}
          >
            <SelectTrigger size="xs" className="min-w-48" aria-label={gt("Project")}>
              <SelectValue>
                {(value: string | null) =>
                  projects.find((project) => project.id === value)?.title ?? gt("Choose a project")
                }
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.title}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      {projectId === null ? null : (
        <ProjectSources
          key={projectId}
          environmentId={environmentId}
          projectId={ProjectId.make(projectId)}
        />
      )}
    </SettingsSection>
  );
}

function ProjectSources(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}) {
  const gt = useGT();
  const { environmentId, projectId } = props;
  const query = useEnvironmentQuery(knowledgeList({ environmentId, input: { projectId } }));
  const canChange = useAtomValue(addKnowledgeSource.permissionAtom(environmentId));
  const canOperate = useAtomValue(reindexKnowledgeSource.permissionAtom(environmentId));
  const all = query.data ?? [];
  const indexing = anyIndexing(all);
  const { refresh } = query;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- indexing runs on the server; its status is read when the section opens and again while a run is going
  useEffect(() => {
    refresh();
    if (!indexing) return;
    const timer = setInterval(refresh, INDEXING_REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh, indexing]);

  const { notes, sources } = splitSources(all);
  return (
    <>
      {query.error === null ? null : (
        <p className="px-3 py-2 text-destructive text-xs sm:px-4">{query.error}</p>
      )}
      {notes === null ? (
        canChange ? (
          <AddSourceForm
            environmentId={environmentId}
            projectId={projectId}
            kind="notes"
            onAdded={refresh}
          />
        ) : null
      ) : (
        <SourceRow
          environmentId={environmentId}
          source={notes}
          title={gt("Notes folder")}
          canChange={canChange}
          canOperate={canOperate}
          onChanged={refresh}
        />
      )}
      {sources.map((source) => (
        <SourceRow
          key={source.id}
          environmentId={environmentId}
          source={source}
          title={source.path}
          canChange={canChange}
          canOperate={canOperate}
          onChanged={refresh}
        />
      ))}
      {canChange ? (
        <AddSourceForm
          environmentId={environmentId}
          projectId={projectId}
          kind="folder"
          onAdded={refresh}
        />
      ) : null}
    </>
  );
}

function AddSourceForm(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly kind: KnowledgeSourceKind;
  readonly onAdded: () => void;
}) {
  const gt = useGT();
  const add = useAtomCommand(addKnowledgeSource);
  const [path, setPath] = useState(props.kind === "notes" ? "notes" : "");
  const [kind, setKind] = useState<KnowledgeSourceKind>(props.kind);
  const [busy, setBusy] = useState(false);
  const notes = props.kind === "notes";

  const submit = async () => {
    setBusy(true);
    const result = await add({
      environmentId: props.environmentId,
      input: { projectId: props.projectId, kind, path: path.trim() },
    });
    setBusy(false);
    if (result._tag === "Success") {
      if (!notes) setPath("");
      props.onAdded();
    }
  };

  return (
    <div className={FORM_CLASS}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{notes ? <T>Notes folder</T> : <T>Add a source</T>}</p>
        <p className="text-xs text-muted-foreground">
          {notes ? (
            <T>
              A markdown folder inside the project, created if missing. Edit its notes in the file
              editor; they are indexed like any source.
            </T>
          ) : (
            <T>
              A folder or file on the machine running CMDeck, absolute or relative to the project.
              Your home folder, drive roots and system folders are refused.
            </T>
          )}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {notes ? null : (
          <Select
            value={kind}
            onValueChange={(value) => setKind(value === "file" ? "file" : "folder")}
          >
            <SelectTrigger size="xs" aria-label={gt("Source type")}>
              <SelectValue>
                {(value: string) => (value === "file" ? gt("File") : gt("Folder"))}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="folder">{gt("Folder")}</SelectItem>
              <SelectItem value="file">{gt("File")}</SelectItem>
            </SelectPopup>
          </Select>
        )}
        <Input
          size="sm"
          className="w-full sm:w-64"
          value={path}
          placeholder={notes ? "notes" : gt("Path, such as /home/me/docs")}
          aria-label={notes ? gt("Notes folder") : gt("Source path")}
          onChange={(event) => setPath(event.target.value)}
        />
        <Button
          size="xs"
          variant="outline"
          disabled={busy || path.trim() === ""}
          onClick={() => void submit()}
        >
          {notes ? <T>Use folder</T> : <T>Add</T>}
        </Button>
      </div>
    </div>
  );
}

function SourceRow(props: {
  readonly environmentId: EnvironmentId;
  readonly source: KnowledgeSource;
  readonly title: string;
  readonly canChange: boolean;
  readonly canOperate: boolean;
  readonly onChanged: () => void;
}) {
  const gt = useGT();
  const { environmentId, source } = props;
  const reindex = useAtomCommand(reindexKnowledgeSource);
  const cancel = useAtomCommand(cancelKnowledgeIndex);
  const remove = useAtomCommand(removeKnowledgeSource);
  const [busy, setBusy] = useState(false);
  const input = { environmentId, input: { sourceId: source.id } };
  const run = async (action: () => Promise<{ readonly _tag: string }>) => {
    setBusy(true);
    await action();
    setBusy(false);
    props.onChanged();
  };

  const counts = gt(
    "{files, plural, one {{files} file} other {{files} files}}, {chunks, plural, one {{chunks} chunk} other {{chunks} chunks}}",
    { files: source.files, chunks: source.chunks },
  );
  const skipped =
    source.skipped === 0
      ? ""
      : ` · ${gt("{count, plural, one {{count} file skipped} other {{count} files skipped}} (too large or not text)", { count: source.skipped })}`;
  const status =
    source.state === "indexing"
      ? `${gt("Indexing…")} ${counts}`
      : source.state === "pending"
        ? gt("Waiting to index")
        : source.state === "error"
          ? (source.message ?? gt("Indexing failed"))
          : `${counts}${skipped}`;

  return (
    <SettingsRow
      title={props.title}
      description={
        <>
          {props.title === source.path ? null : (
            <span className="block break-all">{source.path}</span>
          )}
          <span className="block">{status}</span>
        </>
      }
      control={
        <div className="flex flex-wrap items-center gap-2">
          {props.canOperate ? (
            source.state === "indexing" ? (
              <Button
                size="xs"
                variant="outline"
                disabled={busy}
                onClick={() => void run(() => cancel(input))}
              >
                <T>Stop</T>
              </Button>
            ) : (
              <Button
                size="xs"
                variant="outline"
                disabled={busy}
                onClick={() => void run(() => reindex(input))}
              >
                <T>Reindex</T>
              </Button>
            )
          ) : null}
          {props.canChange ? (
            <Button
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() => void run(() => remove(input))}
            >
              {gt("Remove", { $context: "verb, stops indexing a knowledge source" })}
            </Button>
          ) : null}
        </div>
      }
    />
  );
}

export const settingsSection = {
  page: "general",
  order: 25,
  Component: KnowledgeSection,
} as const;
