# Lessons

Checks the lesson consolidation prompt (`apps/server/src/fork/lessons/prompt.ts`) on synthetic chats run through the real input builder. A correction the user makes must come back as a lesson; a rule the agent quoted from a file, an instruction inside a log the user pasted, and a one-off request must not. The control chat has no corrections and must propose nothing.

Lessons run on a text generator, local by default, so the eval calls one directly:

```sh
cd evals
pnpm lessons --model qwen3:4b --out runs/lessons
pnpm lessons --model qwen3:4b --out runs/lessons-new --baseline runs/lessons/results.json
pnpm lessons --kind anthropic --base-url https://api.anthropic.com --model <model> --out runs/lessons-hosted
```

`--base-url` defaults to Ollama on this machine. A hosted API reads its key from `LESSONS_EVAL_API_KEY` in the repo root `.env`. Each case runs three times (`--samples`); a case fails when half or more of its samples fail. `--case <id> --samples 1` is a smoke run. Five cases at three samples is fifteen short calls; a local model costs nothing, and a hosted one costs what fifteen small prompts cost on it. Results list each sample's lessons; read them for wording as well as the automated result.

Add a case to `cases.ts` when a real chat produces a wrong lesson or misses a right one.
