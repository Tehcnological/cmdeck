# Second-model review

Ask a different model to review what a thread changed before you accept it. Start a review from
the command palette (**Review with another model**) or from the review button in the diff panel.

You choose the reviewer's provider and model every time. The dialog starts on the reviewer you used
last on that environment; if that provider is gone or turned off, pick again. CMDeck never picks
or swaps a reviewer for you.

## What the reviewer sees and may do

The reviewer gets the thread's whole diff, the same changes the diff panel shows for all turns. It
starts fresh, without the thread's conversation, so it judges the changes rather than the reasoning
that produced them. It can read files in the thread's checkout for context.

The reviewer runs in the most restrictive permission mode its provider offers, never with full
access. If it asks to run a command or change a file, the request waits for your approval in the
review.

## Findings

Each review appears above the composer, named for its reviewer, while it runs and after it ends.
Open it to read the findings in a side chat beside the thread. Findings never reach the thread's
agent on their own: choose **Send to agent** to give them to the agent with your next message, or
discard the review.

You can stop a running review. A failed or stopped review stays visible with its state until you
discard it.

A thread with no completed changes has nothing to review yet.
