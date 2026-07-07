#!/usr/bin/env node
import { mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const [, , inputArg, outputArg, diagramDirArg, ...rest] = process.argv;

if (!inputArg || !outputArg || !diagramDirArg) {
  console.error(
    "usage: render-mermaid.mjs <input.md> <output.md> <diagram-dir> [--blog-dir path] [--background white|transparent]",
  );
  process.exit(2);
}

let blogDir = "";
let background = process.env.MERMAID_BACKGROUND || "white";
for (let i = 0; i < rest.length; i += 1) {
  if (rest[i] === "--blog-dir") {
    blogDir = rest[i + 1] || "";
    i += 1;
  } else if (rest[i] === "--background") {
    background = rest[i + 1] || background;
    i += 1;
  } else {
    console.error(`unknown argument: ${rest[i]}`);
    process.exit(2);
  }
}

const input = path.resolve(inputArg);
const output = path.resolve(outputArg);
const diagramDir = path.resolve(diagramDirArg);
const resolvedBlogDir = blogDir ? path.resolve(blogDir) : "";
const defaultPuppeteerConfig = path.join(path.dirname(input), "puppeteer-config.json");
const puppeteerConfig = process.env.MERMAID_PUPPETEER || defaultPuppeteerConfig;
const mmdc = process.env.MMDC || "mmdc";

rmSync(diagramDir, { recursive: true, force: true });
mkdirSync(diagramDir, { recursive: true });
if (resolvedBlogDir) {
  rmSync(resolvedBlogDir, { recursive: true, force: true });
  mkdirSync(resolvedBlogDir, { recursive: true });
}

const renderMermaid = (src, png) => {
  const args = ["-i", src, "-o", png, "-b", background, "-s", "2"];
  if (puppeteerConfig) args.push("-p", puppeteerConfig);
  const result = spawnSync(mmdc, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${mmdc} failed for ${src}`);
  }
};

const source = readFileSync(input, "utf8");
let index = 0;
const rendered = source.replace(/```mermaid\n([\s\S]*?)\n```/g, (_match, body) => {
  index += 1;
  const stem = `diagram-${String(index).padStart(2, "0")}`;
  const mmd = path.join(diagramDir, `${stem}.mmd`);
  const png = path.join(diagramDir, `${stem}.png`);
  writeFileSync(mmd, `${body.trim()}\n`);
  renderMermaid(mmd, png);
  if (resolvedBlogDir) {
    copyFileSync(mmd, path.join(resolvedBlogDir, `${stem}.mmd`));
    copyFileSync(png, path.join(resolvedBlogDir, `${stem}.png`));
  }
  return `![Diagram ${index}](diagrams/${stem}.png)`;
});

mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, rendered);
console.log(`Rendered ${index} Mermaid diagram(s) -> ${diagramDir}`);
if (resolvedBlogDir) console.log(`Mirrored diagrams -> ${resolvedBlogDir}`);
