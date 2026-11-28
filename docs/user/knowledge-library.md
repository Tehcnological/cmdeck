# Knowledge library and notes

A project's knowledge library is a set of folders and files on the machine running CMDeck that the
project's agents can search with the `knowledge_search` tool: runbooks, references, exported docs,
and your own notes. Results come back as excerpts with the file path and line they start on.

## Add sources

In **Settings → General → Knowledge library**, choose the project, then:

- **Notes folder:** type a folder inside the project, such as `notes`, and click **Use folder**. It
  is created if it does not exist. Open and edit its markdown files in the file editor like any
  project file; they are indexed like any other source. A project has one notes folder.
- **Add a source:** pick **Folder** or **File**, type its path (absolute, or relative to the project)
  and click **Add**.

Each source shows its status: indexing, how many files and chunks it holds, how many files were
skipped, or why indexing failed. **Reindex** reads the source again, **Stop** ends a run, and
**Remove** drops the source's index. Removing never touches the files.

## What is never indexed

- Credential and key files and folders: `.ssh`, `.aws`, `.gnupg`, `.docker`, `.kube`, `.env*`,
  `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_*`, `*credentials*`, `*secret*`, `.npmrc`, `.netrc` and
  similar.
- Password-manager databases and exports, such as `*.kdbx`, `*.1pux` and Bitwarden exports.
- Generated folders: `.git`, `node_modules`, `dist`, `build`, `out`, `target`, virtual environments.
- Anything the source folder's `.gitignore` lists. A `.gitignore` cannot bring back the files above.
- Symbolic links and junctions, which are never followed.
- Binary files, files over 1 MB, and anything past 5,000 files or 100 MB in one source.

Your home folder itself, drive roots and system folders cannot be sources. Choose the folder you
mean instead, such as `~/Documents/runbooks`.

## Keeping it current

Indexing runs in the background. Only files whose size, date or content changed are read again, and
deleted files leave the index. A search refreshes a source indexed more than five minutes ago, and
an agent can ask for a refresh with `knowledge_reindex`, for example right after you edit notes.

## Search by meaning

When [memory search by meaning](./memory-search.md) is set up, the knowledge library uses the same
embedding model, so a question finds passages worded differently. Without it, search uses keywords
and makes no network request.

## For agents

Agents search only their own project's library. Excerpts are fenced and treated as file content,
not instructions.
