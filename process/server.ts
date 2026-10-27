// The local preview server: serves the page from ui/, hands it the task as
// JSON and tells it when something changed. One process, localhost only,
// no state beyond what is on disk. Changes are detected by polling the size
// and mtime of `current-task` and of the watched task's events file.
//
// Usage:
//   node process/server.ts [--port <n>] [--task <id>]
//
// Environment: DEVGUIDE_DIR (default ./.devguide), DEVGUIDE_PORT (default 4310).

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { DEFAULT_DATA_DIRECTORY, currentTaskFile, resolveDataDir, taskEventsFile } from "./paths.ts";
import { buildPreviewModel } from "./preview-model.ts";
import { summarize } from "./replay.ts";
import { currentTask, readEvents, readTask, type OpenTask } from "./task-log.ts";

export const DEFAULT_PORT = 4310;
export const POLL_MS = 500;
const PING_MS = 15_000;

const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "ui");

/** Files the server is willing to serve from ui/, by URL path. */
const UI_FILES: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/ui/preview.css": { file: "preview.css", type: "text/css; charset=utf-8" },
  "/ui/preview.js": { file: "preview.js", type: "text/javascript; charset=utf-8" },
};

export interface PreviewServerOptions {
  dataDir: string;
  /** 0 picks a free port. */
  port?: number;
  host?: string;
  /** Pin the preview to one task instead of following `current-task`. */
  taskId?: string | null;
  pollMs?: number;
  uiDir?: string;
}

export interface PreviewServer {
  port: number;
  url: string;
  close: () => Promise<void>;
}

export async function startPreviewServer(options: PreviewServerOptions): Promise<PreviewServer> {
  const host = options.host ?? "127.0.0.1";
  const uiDir = options.uiDir ?? UI_DIR;
  const pinned = options.taskId ?? null;
  const dataDir = options.dataDir;

  const clients = new Set<ServerResponse>();
  const repo = repoName(dataDir);
  let version = 0;
  let fingerprint = snapshot();

  function resolveTask(): OpenTask | null {
    return pinned ? readTask(dataDir, pinned) : currentTask(dataDir);
  }

  function snapshot(): string {
    const parts: string[] = [];
    if (!pinned) parts.push(stamp(currentTaskFile(dataDir)));
    const task = resolveTask();
    parts.push(task ? `${task.record.id}:${stamp(taskEventsFile(dataDir, task.record.id))}` : "none");
    return parts.join("|");
  }

  function broadcast(): void {
    const task = resolveTask();
    const payload = JSON.stringify({ task_id: task ? task.record.id : null, version });
    for (const client of clients) client.write(`event: update\ndata: ${payload}\n\n`);
  }

  function poll(): void {
    let next: string;
    try {
      next = snapshot();
    } catch {
      return;
    }
    if (next !== fingerprint) {
      fingerprint = next;
      version += 1;
      broadcast();
    }
  }

  const server: Server = createServer((req, res) => {
    try {
      handle(req, res);
    } catch (error) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      res.end(`error: ${(error as Error).message}\n`);
    }
  });

  function handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method !== "GET") {
      res.writeHead(405, { "Cache-Control": "no-store" });
      res.end();
      return;
    }
    if (url.pathname === "/api/preview") {
      const task = resolveTask();
      const body = task
        ? (() => {
            const events = readEvents(task);
            return { task: task.record, repo, events, summary: summarize(task.record, events), model: buildPreviewModel(task.record, events, { repo }), version, pinned: pinned !== null };
          })()
        : { task: null, repo, data_dir: dataDir, version, pinned: pinned !== null };
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(body));
      return;
    }
    if (url.pathname === "/api/updates") {
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive" });
      res.write(":ok\n\n");
      clients.add(res);
      const task = resolveTask();
      res.write(`event: update\ndata: ${JSON.stringify({ task_id: task ? task.record.id : null, version })}\n\n`);
      req.on("close", () => clients.delete(res));
      return;
    }
    const asset = UI_FILES[url.pathname];
    if (asset) {
      res.writeHead(200, { "Content-Type": asset.type, "Cache-Control": "no-store" });
      res.end(readFileSync(join(uiDir, asset.file)));
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end("not found\n");
  }

  const timer = setInterval(poll, options.pollMs ?? POLL_MS);
  const ping = setInterval(() => {
    for (const client of clients) client.write(`event: ping\ndata: {}\n\n`);
  }, PING_MS);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? DEFAULT_PORT, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : (options.port ?? DEFAULT_PORT);

  return {
    port,
    url: `http://localhost:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(timer);
        clearInterval(ping);
        for (const client of clients) client.end();
        clients.clear();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/** Name of the repository a data directory belongs to: the directory above `.devguide`, or the data directory itself. */
export function repoName(dataDir: string): string {
  const parts = resolve(dataDir).split(/[\\/]+/).filter((part) => part.length > 0);
  const at = parts.lastIndexOf(DEFAULT_DATA_DIRECTORY);
  const kept = at > 0 ? parts.slice(0, at) : parts;
  return kept.at(-1) ?? dataDir;
}

/** Size and mtime of a file, or "missing"; enough to notice an append or a rewrite. */
function stamp(path: string): string {
  try {
    const stats = statSync(path);
    return `${stats.size}:${stats.mtimeMs}`;
  } catch {
    return "missing";
  }
}

export async function main(argv: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { port: { type: "string" }, task: { type: "string" } }, strict: true });
  const port = Number(values.port ?? env["DEVGUIDE_PORT"] ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    process.stderr.write(`error: port must be a number between 0 and 65535, got "${values.port ?? env["DEVGUIDE_PORT"]}"\n`);
    return 2;
  }
  const dataDir = resolveDataDir(env, cwd);
  try {
    const server = await startPreviewServer({ dataDir, port, taskId: values.task ?? null });
    const task = values.task ? readTask(dataDir, values.task) : currentTask(dataDir);
    process.stdout.write(`Podgląd DevGuide: ${server.url}\n`);
    process.stdout.write(`Katalog danych: ${dataDir}\n`);
    process.stdout.write(task ? `Zadanie: ${task.record.id} - ${task.record.description}\n` : "Nie ma jeszcze zadania; strona zaktualizuje się, gdy rozpoczniesz je przez /devguide w Claude Code.\n");
    process.stdout.write("Zatrzymaj przez Ctrl+C.\n");
    await new Promise<void>((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
    await server.close();
    return 0;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EADDRINUSE") {
      process.stderr.write(`error: port ${port} is already in use; pick another with --port <n> or DEVGUIDE_PORT\n`);
      return 1;
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env, process.cwd()).then((code) => {
    process.exitCode = code;
  });
}
