import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import type { Publisher, Documentation, PublishMetadata } from "./publisher.js";

export interface FileSystemPublisherConfig {
  outputDir: string;
}

export function createFileSystemPublisher(
  config: FileSystemPublisherConfig
): Publisher {
  const outputDir = config.outputDir ?? "output";

  return {
    async publish(doc, metadata) {
      const pathParts = [outputDir, doc.managedUserId];
      if (metadata.projectSlug) {
        pathParts.push(metadata.projectSlug);
      }
      if (!metadata.isProjectDoc && doc.recipeId != null) {
        pathParts.push(String(doc.recipeId));
      }
      const dir = join(...pathParts);
      await mkdir(dir, { recursive: true });

      const mdPath = join(dir, "README.md");
      const htmlPath = join(dir, "index.html");

      const htmlFull = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(metadata.projectName ?? metadata.recipeName ?? `Documentation`)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; }
    h1, h2, h3 { margin-top: 1.5em; }
    code { background: #f4f4f4; padding: 0.2em 0.4em; border-radius: 4px; }
    pre { overflow-x: auto; background: #f4f4f4; padding: 1em; border-radius: 4px; }
  </style>
</head>
<body>
${doc.contentHtml}
</body>
</html>`;

      await writeFile(mdPath, doc.contentMd, "utf-8");
      await writeFile(htmlPath, htmlFull, "utf-8");
    },
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
