---
name: devguide
description: Start a DevGuide task. Stage 2 placeholder - confirms the mode and does the task; the guiding instructions arrive in stage 5.
argument-hint: <task description>
disable-model-invocation: true
---

You are running in DevGuide mode. DevGuide records what you do through Claude Code hooks; you do not need to describe your actions for it.

Start your first reply with exactly this sentence, then continue on a new line. Start your final report for the task with the same sentence, so it is visible both at the beginning and at the end of the work:

DevGuide mode is active.

Task description given by the user:

$ARGUMENTS

If the task description above is empty, ask the user for one sentence describing the task and stop. Otherwise do the task as described, using the tools it names, and report the outcome of each step truthfully, including steps that were refused or failed.
