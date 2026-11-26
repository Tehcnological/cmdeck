# Sources

Audit date: **2026-11-26**. Reproduce any finding by checking out the SHA listed here.

## Primary repositories

| Repo                                                            | Branch / release                  | Audited SHA                                | Commit date | License (verified at SHA)                                     |
| --------------------------------------------------------------- | --------------------------------- | ------------------------------------------ | ----------- | ------------------------------------------------------------- |
| [Tehcnological/cmdeck](https://github.com/Tehcnological/cmdeck) | `main`, release `v3` (3.0.0)      | `4a2f27d5904f18a32b2026f7bf8a90acf8446dbc` | 2026-11-25  | MIT (T3 Tools Inc. + MiaAI-Lab + fork lines)                  |
| [pingdotgg/t3code](https://github.com/pingdotgg/t3code)         | `main`                            | `9b4943f91cf8de7f376b73d4a7299fe74b54d044` | 2026-11-26  | MIT; trademarks excluded ([TRADEMARK.md](../../TRADEMARK.md)) |
| ↳ latest stable                                                 | `v0.1.13`                         | `bc0f04da94f64b5e487c598761a43b4cf06b2ac9` | 2026-11-26  |                                                               |
| ↳ latest nightly                                                | `v0.1.13-nightly.20261126.5305`   | `bc0f04da94` (same commit)                 | 2026-11-26  |                                                               |
| ↳ CMDeck merge base                                             | —                                 | `9ea5044aef27b0b710857d8d1dc13240392cafc6` | 2026-11-25  | upstream 324 commits ahead, CMDeck 339 ahead                  |
| [MiaAI-Lab/m3code](https://github.com/MiaAI-Lab/m3code)         | `main` (fork 1.1.0)               | `6a8f1b0741164252b843da9fad908e30713a6170` | 2026-11-26  | MIT. Merge base with T3 `5d02075446`                          |
| [kirodotdev/KiroCrew](https://github.com/kirodotdev/KiroCrew)   | `main`, prerelease `v0.14.0-rc.5` | `b75544f0dbef43b7340800819b36ae6cf9fbc2bd` | 2026-11-26  | Apache-2.0 with NOTICE and THIRD-PARTY-NOTICES                |

M3 Code was identified from CMDeck's README attribution, its `LICENSE` copyright line and commits
`5631bbe949`, `2615f5e5a0` and PRs #11, #13, #14 and #15.

Open CMDeck PRs at audit time: #23 `fix/settings-copy-and-mcp-button` (fixes the MCP wizard crash in v3).
Every other remote branch is merged or stale. See [research/cmdeck-fork.md](research/cmdeck-fork.md).

## Secondary repositories

Identity, license, HEAD SHA and maintenance status for every other project are recorded in one
place each, so they are not repeated here:

- Competing agent development environments (§7.1, §7.8): [research/competitive-ades.md](research/competitive-ades.md#identity--license)
- Memory, workflow, browser, usage, devtools libraries (§7.2–7.5, §7.7): [research/competitive-libraries.md](research/competitive-libraries.md)
- AWS documentation and AWS-maintained repos (§6, §7.6), with access dates per URL: [AWS_BEDROCK.md](AWS_BEDROCK.md)

## Repositories that moved

Several URLs in the brief now redirect or have been superseded. Use these names:

| Brief URL                                | Current location                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| All-Hands-AI/OpenHands                   | OpenHands/OpenHands (agent runtime: OpenHands/software-agent-sdk)        |
| qodo-ai/pr-agent                         | The-PR-Agent/pr-agent                                                    |
| ryoppippi/ccusage                        | ccusage/ccusage (rewritten in Rust)                                      |
| mediar-ai/screenpipe                     | screenpipe/screenpipe (**now source-available, do not copy code**)       |
| NVIDIA/OpenShell                         | ai-openshell/openshell (CNCF)                                            |
| google/gvisor                            | gvisor/gvisor                                                            |
| letta-ai/letta                           | server retired; current code letta-ai/letta-code                         |
| awslabs/amazon-bedrock-agentcore-samples | awslabs/agentcore-samples                                                |
| strands-agents/sdk-python                | strands-agents/harness-sdk (sdk-typescript archived)                     |
| awslabs/mcp                              | still live; AWS's GA "AWS MCP Server" lives in aws/agent-toolkit-for-aws |

## Method

Read-only clones (blobless or shallow) were kept outside the worktree. Nothing from any audited
repository was installed, built or executed. CMDeck checks were source reads, `git` history
(`log`, `diff`, `merge-tree`) and `gh` queries; no CMDeck tests were run during the audit, so a cited
test file proves a test exists, not that it passes.
