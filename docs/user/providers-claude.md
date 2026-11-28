# Claude

CMDeck drives your Claude Code installation, login, skills, and plugins. See [provider setup](./install.md#providers) for initial installation.

## Multiple accounts and presets

Isolate separate Claude accounts or router presets with distinct `CLAUDE_CONFIG_DIR` directories:

```bash
mkdir -p ~/.claude_personal
CLAUDE_CONFIG_DIR=~/.claude_personal claude auth login
```

Add a second Claude instance in **Settings → Providers** (or **Add Claude account** on mobile) pointing **CLAUDE_CONFIG_DIR path** to `~/.claude_personal` (leave empty for the default directory). Always use `CLAUDE_CONFIG_DIR` rather than `HOME` so system keychain paths stay intact.

- Existing threads can only switch between Claude instances sharing the same config directory.
- Put API keys and endpoint overrides in **Environment variables** (not **Launch arguments**).
- Paths in `--settings` and `--append-system-prompt-file` expand `~` to the server's home directory; other relative paths resolve from the thread's workspace.

## Compact long conversations

- **Auto-compact threshold**: Set **Auto-compact after** (`100000`–`1000000` tokens) in the Claude instance settings to trigger summarization earlier without changing the model's context window.
- **Manual compaction**: Send `/compact` in chat.
- **Idle compaction (>200k tokens)**: Configure **Settings → Providers → Advanced → Compact idle threads** (overridable per instance):
  - **When you return** (default): Shows a **Compact** chip next to Send once Claude's prompt cache expires (~1 hour on subscriptions, 5 min on API/Bedrock/Vertex). Click it to switch to **Keep** if you want full history.
  - **Before the cache expires (beta)**: Automatically sends `/compact` shortly before the cache expires while history is still cached (falls back to **When you return** if missed).
  - **Never**: Disables idle compaction prompts.

## Steering, usage limits, and tasks

- **Steering**: Steered messages wait until Claude finishes its active tool calls, then enter the same turn (or queue for the next turn if Claude exits or drops them).
- **Usage limits**: Mid-turn limit hits display the window and reset time; Claude holds the turn until reset, or you can stop and resume later.
- **Task lists**: Add `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` in the instance's **Environment → Variables** to show Claude's task list progress in web and desktop threads.
- **Auto mode**: Uses Claude Code's native auto mode (disabled if `disableAutoMode` is set in Claude's managed, user, or project settings). See [Permission modes](./permission-modes.md).

## Skills and MCP sign-in

- **Skills**: Loaded from `<CLAUDE_CONFIG_DIR>/skills`, the project's `.claude/skills` (config dir wins on name collisions), and enabled Claude plugins (e.g. `plugin:review`). Invoke via `$`. Send `disable-model-invocation` skills one per message.
- **MCP OAuth**: When a Claude MCP server needs sign-in, click **Sign in** on the thread notice, approve in your browser, and paste the final redirect URL into CMDeck (**Finish sign-in**). Connectors added on `claude.ai` authenticate there instead.

## Claude in Chrome

To use the [Claude in Chrome extension](https://code.claude.com/docs/en/chrome) in CMDeck threads, add `--chrome` to **Launch arguments** in the Claude instance settings (applies to new sessions). Requires a direct Anthropic `/login` plan—not supported with API keys, `setup-token`, Bedrock/Vertex, or WSL.

## Amazon Bedrock

Claude Code talks to Bedrock itself; CMDeck only passes it the settings below. CMDeck never reads your AWS files or calls AWS.

1. Sign in with the AWS CLI using a named profile, preferably IAM Identity Center (SSO) or `aws login`, with an [inference-only role](./aws.md#give-agents-an-inference-only-role).
2. In **Settings → Providers**, add a Claude instance and click **Use Amazon Bedrock** on its configuration step. It fills these variables:

| Variable                         | Value                                                               |
| -------------------------------- | ------------------------------------------------------------------- |
| `CLAUDE_CODE_USE_BEDROCK`        | `1`                                                                 |
| `AWS_PROFILE`                    | Your profile name                                                   |
| `AWS_REGION`                     | The Bedrock Region, such as `us-east-1`                             |
| `ANTHROPIC_DEFAULT_OPUS_MODEL`   | Optional: the Bedrock model or inference profile ID to use for Opus |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | Optional: the same for Sonnet                                       |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL`  | Optional: the same for Haiku                                        |

Rows you leave empty are not saved, and Claude Code uses its own default for them. Without `AWS_REGION`, Claude Code tries `AWS_DEFAULT_REGION`, then the profile's Region, then `us-east-1`.

- **Pin model IDs** so a new Claude Code release does not move you to another model. A cross-Region ID starts with a prefix such as `us.`, `eu.`, `apac.` or `global.`; `global.` models may be processed in any commercial Region.
- **Expiring sign-ins**: set `awsAuthRefresh` in Claude Code's settings to a command such as `aws sso login --profile <name>` and Claude Code runs it when the credentials expire.
- **Bedrock API keys** work too: put a short-term key in `AWS_BEARER_TOKEN_BEDROCK` and mark it **Sensitive**. Short-term keys last up to 12 hours and work in one Region.
- **More options**, such as application inference profiles, service tiers and Guardrails, are set the same way; see [Claude Code on Amazon Bedrock](https://code.claude.com/docs/en/amazon-bedrock). Its `/setup-bedrock` wizard also works.
- **Keep AWS out of other agents**: agents inherit the environment CMDeck was started with, so don't export AWS credentials or `AWS_PROFILE` in that shell. Give AWS settings only to the instances that need them.

The instance's status then shows **Amazon Bedrock**. For AWS tools, costs and remote machines, see [AWS](./aws.md).

## OpenRouter and local routers

Create a separate Claude instance with its own config directory (e.g. `~/.claude_openrouter`, after running `/logout` if it had a cached Anthropic login) and set **Environment variables**:

| Variable               | Value                                    |
| ---------------------- | ---------------------------------------- |
| `ANTHROPIC_BASE_URL`   | `https://openrouter.ai/api`              |
| `ANTHROPIC_AUTH_TOKEN` | Your OpenRouter API key (mark Sensitive) |
| `ANTHROPIC_API_KEY`    | Explicitly empty                         |

Add unlisted OpenRouter models via **Add custom model** in the instance settings. See the [OpenRouter Claude Code guide](https://openrouter.ai/docs/cookbook/coding-agents/claude-code-integration) or [Claude Code Router](https://github.com/musistudio/claude-code-router) for local router setup.
