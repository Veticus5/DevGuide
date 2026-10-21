// Checks that every relative link in the repository's Markdown files points
// at a file or directory that exists. Links with a scheme (https:, mailto:),
// links to an anchor in the same file, and anything inside code spans or
// fenced code blocks are ignored. No network access.
//
// Usage: node scripts/check-links.ts [root]
// Exit code 0 when every link resolves, 1 when at least one is broken.

import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export interface BrokenLink {
  /** Markdown file that contains the link, relative to the root, with `/` separators. */
  file: string;
  /** Link target as written in the file. */
  target: string;
  /** 1-based line number of the link. */
  line: number;
}

const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git"]);
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const LINK_PATTERN = /\[[^\]]*\]\((?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\)/g;

export async function findBrokenLinks(root: string): Promise<BrokenLink[]> {
  const absoluteRoot = resolve(root);
  const broken: BrokenLink[] = [];
  for (const file of await listMarkdownFiles(absoluteRoot)) {
    const text = await readFile(file, "utf8");
    for (const { target, line } of extractLinks(text)) {
      if (!(await targetExists(file, absoluteRoot, target))) {
        broken.push({ file: toPosix(relative(absoluteRoot, file)), target, line });
      }
    }
  }
  return broken;
}

/** Extracts link targets from Markdown, skipping fenced code blocks and inline code. */
export function extractLinks(markdown: string): Array<{ target: string; line: number }> {
  const links: Array<{ target: string; line: number }> = [];
  let inFence = false;
  const lines = markdown.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    if (/^\s*(```|~~~)/.test(rawLine)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const line = rawLine.replace(/`[^`]*`/g, "");
    for (const match of line.matchAll(LINK_PATTERN)) {
      const target = match[1] ?? match[2];
      if (target !== undefined && isRelativeFileLink(target)) {
        links.push({ target, line: index + 1 });
      }
    }
  }
  return links;
}

function isRelativeFileLink(target: string): boolean {
  if (target.startsWith("#")) return false;
  if (SCHEME_PATTERN.test(target)) return false;
  if (target.startsWith("//")) return false;
  return true;
}

async function targetExists(file: string, root: string, target: string): Promise<boolean> {
  const withoutAnchor = target.split("#")[0]?.split("?")[0] ?? "";
  if (withoutAnchor === "") return true;
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutAnchor);
  } catch {
    decoded = withoutAnchor;
  }
  const candidate = decoded.startsWith("/") ? join(root, decoded) : resolve(dirname(file), decoded);
  try {
    await stat(candidate);
    return true;
  } catch {
    return false;
  }
}

async function listMarkdownFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) files.push(...(await listMarkdownFiles(path)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(path);
    }
  }
  return files.sort();
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

export async function main(argv: string[]): Promise<number> {
  const root = argv[0] ?? process.cwd();
  const broken = await findBrokenLinks(root);
  for (const link of broken) {
    console.error(`${link.file}:${link.line} -> ${link.target}`);
  }
  if (broken.length > 0) {
    console.error(`check-links: ${broken.length} broken relative link(s)`);
    return 1;
  }
  console.log("check-links: all relative links resolve");
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  process.exitCode = await main(process.argv.slice(2));
}
