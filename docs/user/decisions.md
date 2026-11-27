# Decision service

CMDeck answers a few small questions on its own: which model a scheduled task's new thread starts
on, and which saved memory facts are worth a place in a turn's prompt. Each question has a fixed
rule that needs no model. A model is asked only when you have set one up **and** allowed it for
that question; anything it gets wrong, slow or unanswered falls back to the rule.

The decision service is advisory. It never approves, denies or hides anything a policy decides.

## Scheduled tasks pick a model that can run

When a scheduled task (or a webhook-triggered one) starts a new thread, CMDeck checks usage
limits before it starts:

- If the task's model has hit a usage limit, or is at 90% or more of one, the thread starts on the
  project's **fallback model** instead. Unattended runs leave that last 10% for your own turns.
- If no candidate can run, the task keeps its model and waits for the limit to reset, as before.
- Continuing an existing thread never changes its model.

You can also pin a model per difficulty tier in `settings.json`. CMDeck rates each task's prompt
as `simple`, `medium` or `complex` from its wording, and a pinned tier's model is tried first:

```json
{
  "cmdeck": {
    "routingTierModels": {
      "simple": { "instanceId": "codex", "model": "gpt-5.4-mini" }
    }
  }
}
```

A tier you leave unset keeps the task's own model.

## Memory facts

With memory on (`cmdeck.memoryEnabled`), every ranked fact reaches the turn by default. A model
you allow for this question can drop facts that do not help with the message. It can never add
one, reorder them, or touch your rules.

## Using a model

Decisions use a [text generator](./text-generation.md). Name it in `settings.json`:

```json
{ "cmdeck": { "decisionModel": { "instanceId": "my-ollama", "model": "qwen3:4b" } } }
```

Nothing is sent until a question also has your consent. Consent is per question:

- **Local**: allowed for every project, and only reaches a text generator whose address is on
  this machine, your local network or your tailnet.
- **Remote**: any configured text generator, allowed one project at a time.

Each consent is recorded with its time, and granting or withdrawing one is written to the
[audit log](./audit-log.md). There is no screen for consent yet, so until there is, every
question uses its rule. CMDeck never calls a hosted decision service and never downloads a model.
