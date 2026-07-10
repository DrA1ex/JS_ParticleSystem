import * as esbuild from "esbuild";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, ".pages");
const BUILD_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const TEXT_FETCH_RE = /await\s+fetch\(\s*new\s+URL\(\s*(["'])([^"']+)\1\s*,\s*import\.meta\.url\s*\)\s*\)\s*\.then\(\s*([A-Za-z_$][\w$]*)\s*=>\s*\3\.text\(\)\s*\)/g;

function inlineTextFetchPlugin() {
  return {
    name: "inline-text-fetch",
    setup(build) {
      build.onLoad({ filter: /\.js$/ }, async (args) => {
        let source = await fs.readFile(args.path, "utf8");
        const replacements = [];

        for (const match of source.matchAll(TEXT_FETCH_RE)) {
          const [fullMatch, , relativePath] = match;
          const assetPath = path.resolve(path.dirname(args.path), relativePath);
          const text = await fs.readFile(assetPath, "utf8");
          replacements.push([fullMatch, `await Promise.resolve(${JSON.stringify(text)})`]);
        }

        for (const [from, to] of replacements) {
          source = source.replace(from, to);
        }

        return {
          contents: source,
          loader: "js",
        };
      });
    },
  };
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function copyIfExists(from, to) {
  if (!(await exists(from))) {
    return;
  }
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.cp(from, to, { recursive: true });
}

async function readIfExists(file) {
  if (!(await exists(file))) {
    return null;
  }
  return fs.readFile(file, "utf8");
}

async function writeText(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}

async function transformCss(from, to) {
  if (!(await exists(from))) {
    return;
  }
  const source = await fs.readFile(from, "utf8");
  const result = await esbuild.transform(source, {
    loader: "css",
    minify: true,
    legalComments: "none",
  });
  await writeText(to, result.code);
}

async function bundleJs(entryPoint, outfile) {
  if (!(await exists(entryPoint))) {
    console.warn(`Skip missing entry: ${path.relative(ROOT, entryPoint)}`);
    return;
  }

  await esbuild.build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    minify: true,
    treeShaking: true,
    sourcemap: false,
    legalComments: "none",
    charset: "utf8",
    absWorkingDir: ROOT,
    plugins: [inlineTextFetchPlugin()],
    define: {
      __NBODY_BUILD_ID__: JSON.stringify(BUILD_ID),
    },
    loader: {
      ".html": "text",
      ".glsl": "text",
    },
  });
}

function replaceModuleScript(html, src) {
  const script = `<script src="${src}" type="module"></script>`;
  if (/<script\s+[^>]*type=["']module["'][^>]*><\/script>/i.test(html)) {
    return html.replace(/<script\s+[^>]*type=["']module["'][^>]*><\/script>/i, script);
  }
  return `${html}\n${script}\n`;
}

function replaceStylesheet(html, fromHref, toHref) {
  return html.replace(
    new RegExp(`(<link\\s+[^>]*href=["'])${escapeRegExp(fromHref)}(["'][^>]*>)`, "g"),
    `$1${toHref}$2`,
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function buildRootPages() {
  for (const file of ["index.html", "README.md", "settings.md", "LICENSE", ".nojekyll"]) {
    await copyIfExists(path.join(ROOT, file), path.join(OUT_DIR, file));
  }
  await copyIfExists(path.join(ROOT, "static"), path.join(OUT_DIR, "static"));
}

async function buildOneBody() {
  const sourceDir = path.join(ROOT, "1_body");
  const targetDir = path.join(OUT_DIR, "1_body");

  if (!(await exists(sourceDir))) {
    return;
  }

  await copyNonJsAssets(sourceDir, targetDir, new Set(["index.html"]));
  await bundleJs(path.join(sourceDir, "index.js"), path.join(targetDir, "assets", "index.js"));

  const html = await readIfExists(path.join(sourceDir, "index.html"));
  if (html !== null) {
    await writeText(path.join(targetDir, "index.html"), replaceModuleScript(html, "./assets/index.js"));
  }
}

async function buildNBody() {
  const sourceDir = path.join(ROOT, "n_body");
  const targetDir = path.join(OUT_DIR, "n_body");

  if (!(await exists(sourceDir))) {
    return;
  }

  await fs.mkdir(targetDir, { recursive: true });
  await copyIfExists(path.join(sourceDir, "favicon.png"), path.join(targetDir, "favicon.png"));
  await copyIfExists(path.join(sourceDir, "coi-serviceworker.js"), path.join(targetDir, "coi-serviceworker.js"));

  await transformCss(path.join(sourceDir, "global.css"), path.join(targetDir, "assets", "global.css"));
  await transformCss(path.join(sourceDir, "player", "player.css"), path.join(targetDir, "assets", "player.css"));

  await bundleJs(path.join(sourceDir, "index.js"), path.join(targetDir, "assets", "index.js"));
  await bundleJs(path.join(sourceDir, "backend", "worker.js"), path.join(targetDir, "backend", "worker.js"));
  await bundleJs(path.join(sourceDir, "backend", "worker_mt.js"), path.join(targetDir, "backend", "worker_mt.js"));
  await bundleJs(path.join(sourceDir, "backend", "worker_mt_task.js"), path.join(targetDir, "backend", "worker_mt_task.js"));
  await bundleJs(path.join(sourceDir, "backend", "gpgpu.js"), path.join(targetDir, "backend", "gpgpu.js"));
  await bundleJs(path.join(sourceDir, "player", "index.js"), path.join(targetDir, "player", "assets", "index.js"));

  // GPGPU worker still fetches shader paths stored in runtime config strings.
  // Keep those files next to the bundled worker so existing URLs continue to work.
  await copyIfExists(
    path.join(sourceDir, "backend", "gpgpu", "shaders"),
    path.join(targetDir, "backend", "gpgpu", "shaders"),
  );

  const indexHtml = await readIfExists(path.join(sourceDir, "index.html"));
  if (indexHtml !== null) {
    let html = replaceModuleScript(indexHtml, "./assets/index.js");
    html = replaceStylesheet(html, "global.css", "./assets/global.css");
    await writeText(path.join(targetDir, "index.html"), html);
  }

  const playerHtml = await readIfExists(path.join(sourceDir, "player", "index.html"));
  if (playerHtml !== null) {
    let html = replaceModuleScript(playerHtml, "./assets/index.js");
    html = replaceStylesheet(html, "../global.css", "../assets/global.css");
    html = replaceStylesheet(html, "player.css", "../assets/player.css");
    await writeText(path.join(targetDir, "player", "index.html"), html);
  }
}

async function copyNonJsAssets(sourceDir, targetDir, skipNames = new Set()) {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (skipNames.has(entry.name)) {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyNonJsAssets(sourcePath, targetPath, skipNames);
      continue;
    }

    if (entry.name.endsWith(".js")) {
      continue;
    }

    await copyIfExists(sourcePath, targetPath);
  }
}

async function writeJekyllConfig() {
  const configPath = path.join(OUT_DIR, "_config.yml");
  if (await exists(configPath)) {
    return;
  }
  await writeText(configPath, "exclude:\n  - node_modules\n  - package.json\n  - package-lock.json\n");
}

async function main() {
  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  await buildRootPages();
  await buildOneBody();
  await buildNBody();
  await writeJekyllConfig();

  console.log(`Built bundled Pages source: ${path.relative(ROOT, OUT_DIR)} (build ${BUILD_ID})`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
