import { promises as fs } from "node:fs";
import path from "node:path";
import { transform } from "esbuild";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, ".pages");

const COPY_ENTRIES = [
  "index.html",
  "README.md",
  "settings.md",
  "LICENSE",
  "static",
  "1_body",
  "n_body",
];

const EXCLUDED_DIRS = new Set([
  ".git",
  ".github",
  ".pages",
  "_site",
  "node_modules",
  ".bundle",
  ".jekyll-cache",
]);

const JS_TARGET = "es2022";

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function removeAndCreate(dir) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

async function copyEntry(name) {
  const src = path.join(ROOT, name);
  const dest = path.join(OUT_DIR, name);

  if (!(await exists(src))) {
    console.warn(`[build-pages] skip missing ${name}`);
    return;
  }

  await fs.cp(src, dest, {
    recursive: true,
    force: true,
    filter: (item) => {
      const base = path.basename(item);
      return !EXCLUDED_DIRS.has(base);
    },
  });
}

async function walk(dir, visit) {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await walk(fullPath, visit);
    } else if (entry.isFile()) {
      await visit(fullPath);
    }
  }
}

async function minifyJs(filePath) {
  const source = await fs.readFile(filePath, "utf8");
  const result = await transform(source, {
    loader: "js",
    format: "esm",
    target: JS_TARGET,
    minify: true,
    sourcemap: false,
    legalComments: "none",
  });
  await fs.writeFile(filePath, result.code);
}

async function minifyCss(filePath) {
  const source = await fs.readFile(filePath, "utf8");
  const result = await transform(source, {
    loader: "css",
    minify: true,
    sourcemap: false,
    legalComments: "none",
  });
  await fs.writeFile(filePath, result.code);
}

async function minifySupportedAssets() {
  await walk(OUT_DIR, async (filePath) => {
    if (filePath.endsWith(".js")) {
      await minifyJs(filePath);
      return;
    }

    if (filePath.endsWith(".css")) {
      await minifyCss(filePath);
    }
  });
}

async function writeJekyllFiles() {
  // Disable extra Jekyll plugins and keep the staging tree predictable.
  await fs.writeFile(path.join(OUT_DIR, "_config.yml"), "plugins: []\n");
}

async function main() {
  await removeAndCreate(OUT_DIR);

  for (const entry of COPY_ENTRIES) {
    await copyEntry(entry);
  }

  await minifySupportedAssets();
  await writeJekyllFiles();

  console.log(`[build-pages] staged site in ${path.relative(ROOT, OUT_DIR)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
