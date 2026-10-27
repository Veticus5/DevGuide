---
name: devguide
description: Start a DevGuide task. Guides the work (investigate, plan, implement, verify, explain) and records findings in the DevGuide task log as you go.
argument-hint: <task description>
disable-model-invocation: true
---

You are running in DevGuide mode. DevGuide records your tool calls through hooks, but it cannot see what you think. The user reads a preview built from what you record with `node process/cli.ts record …`. Record findings as you work, at the moments named below, not only at the end.

Start your first reply with exactly this sentence, then continue on a new line. Start your final report with the same sentence:

DevGuide mode is active.

Task description given by the user:

$ARGUMENTS

If the task description above is empty, ask the user for one sentence describing the task and stop.

## 1. Investigate

Reproduce the problem or look at the starting state before changing anything. Record what you saw, with a concrete example when you have one:

```bash
node process/cli.ts record observation --text "<what you observed, plain language>" --files "<path>,<path>" --material "example=<the data or output you saw>"
```

When you guess a cause, record the guess before testing it, and resolve it after:

```bash
node process/cli.ts record hypothesis --text "<what you suspect>"
node process/cli.ts record hypothesis_resolved --hypothesis <id printed above> --outcome confirmed|rejected --text "<what showed it>"
```

## 2. Plan

For a change that touches more than one file, or when there is more than one reasonable way, record the proposal first:

```bash
node process/cli.ts record proposal --text "<what you intend to change and why>"
```

When you need the user's answer, ask one question and wait. After the user answers, record the decision with the user's exact words before acting on it:

```bash
node process/cli.ts record decision --question "<your question>" --quote "<the user's exact words>" --reading "<what you take it to mean>"
```

## 3. Implement

Change files only with the Write and Edit tools. Never change a file with `sed`, `printf`, `cat >`, `echo >` or any other shell redirection: DevGuide records the before and after of Write and Edit, and nothing of a shell edit.

After each logical fix (one idea, one or more files), record what it is for and how it works:

```bash
node process/cli.ts record change_explained --title "<name of the fix>" --purpose "<what it is for>" --mechanism "<how it works>" --assumptions "<what it assumes or does not cover>" --files "<path>,<path>" --material "example=<input -> output, or before -> after>"
```

Give `--files` as paths relative to the repository root with `/` separators, exactly as the preview shows them.

## 4. Verify

Run a command that checks the behaviour or the result of the change (a test, the program, reading the changed file back). Then record the check with the very same command text and a quote from its output:

```bash
node process/cli.ts record check --what "<what this checks, plain language>" --expected "<what you expected to see>" --command "<the exact command you ran>" --evidence "<text copied from its output>" --claimed passed|failed|inconclusive --limits "<one short sentence: what this check does not cover>"
```

Every text the user will read (`--text`, `--what`, `--expected`, `--purpose`, `--mechanism`, `--assumptions`, `--limits`, `--title`) is one or two short sentences in plain words, in the language of the task description. No jargon, no lists inside a field.

Rules DevGuide enforces and you must respect:

- Run the command with the Bash tool in this session before recording it. DevGuide matches the check against its own record of your Bash calls; a check for a command you did not actually run is stored as unverified and shown to the user as a bare claim.
- `--command` must be the exact text of the command you ran, or the check is recorded as unverified.
- `--evidence` must be text that appears in that command's output. Without it the check is recorded as unverified. Never claim `passed` without a quote.
- Read the line the record command prints. `status=passed execution=<id>` means the run was found. `status=unverified` means it was not: run the command (again) with Bash, then record the check again with the same text. Do not report a check as passed when the log says unverified.
- Do not record a check for a command that only prints text (`echo done` proves that text was printed, nothing else). A check needs a subject, an expectation and an observed result.

## 5. Explain

In your final report, after the confirmation sentence, say in plain language: what you observed, what you changed and why, which checks confirm it, what remains unverified or assumed, and any refusal or tool error you met. Do not describe a refused or failed step as done.

## Never

- Never record a result you did not observe, or an explanation for a change you did not make.
- Never skip recording because the task is small: a one-word replacement still gets one explanation and one check.
- Never hide a refusal, a failed command or an error; report it as it happened.
