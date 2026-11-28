# Memory search by meaning

With memory on (`cmdeck.memoryEnabled`), CMDeck finds the saved facts that fit each turn by their words (full-text search).
It can also search by meaning, so "how do I add a dependency?" finds "Use pnpm, not npm". That needs
an embedding model on one of your own inference servers.

## Turn it on

1. Add your model server under **Settings → Inference** (see [Local models](./local-models.md)) and
   load an embedding model on it, such as `nomic-embed-text`, `bge-small` or `qwen3-embedding`.
2. In **Settings → General → Memory search**, pick that server and model under **Search by
   meaning**.

CMDeck never downloads a model. It sends memory only to a server on this machine, your local
network or your tailnet; a server anywhere else is refused. With **Keywords only** selected,
memory search makes no network request at all.

Saved items are embedded in the background as turns search them, and again after you edit one or
switch to another model. The section shows how many items are embedded so far.

## When the model is unreachable

Search falls back to keywords, and the section says **Unavailable, so search uses keywords** with
the reason. CMDeck tries the model again a minute later.

## How results are ranked

A match scores 70% on meaning and 30% on keywords. A match by meaning alone needs a reasonable
score to count; a keyword match always counts. Facts then fade with age: a fact last changed 30
days ago ranks at half the weight of one changed today. Fading only changes the order; nothing is
deleted or hidden. Rules never fade.
