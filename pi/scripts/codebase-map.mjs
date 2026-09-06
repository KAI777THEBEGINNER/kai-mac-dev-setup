#!/usr/bin/env node
// codebase-map —— 为项目生成 CODEBASE.md 代码地图（pi 上下文资产）
//
// 用法：node codebase-map.mjs [目标目录]
// 默认目标：当前目录；若在 git 仓库内，以仓库根为项目根。
// 产出：<项目根>/CODEBASE.md（约 3-24KB，符号级摘要，不是源码全文）。
//
// 设计要点：
//   1. 零依赖，只用 node 原生模块
//   2. 确定性输出：同一份代码生成同一份地图，方便 diff
//   3. 篇幅预算 24KB：超了先砍目录树注释、再截断文件清单
//   4. 符号提取用行级正则，覆盖 js/ts、python、swift、go、rust、java、kotlin、c/c++、ruby、shell

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAX_MAP_BYTES = 24 * 1024;
const MAX_FILES = 500; // 源码文件清单上限，超出只列最重要的
const MAX_SYMBOLS_PER_FILE = 15;
const MAX_TREE_ENTRIES = 50;
const MAX_TREE_DEPTH = 5;

const IGNORE_DIRS = new Set([
  ".git", ".hg", ".svn", "node_modules", "bower_components", ".next", ".nuxt", ".turbo",
  "dist", "build", "out", "target", "coverage", ".venv", "venv", "__pycache__",
  ".cache", ".idea", ".vscode", ".xcode", "DerivedData", "Pods", "Carthage", ".swiftpm",
  ".pi", "vendor", ".terraform", ".serverless", "assets", "public", "static", "images",
  ".obsidian", "sessions",
]);
const IGNORE_FILES = new Set([
  ".DS_Store", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb",
  "Cargo.lock", "poetry.lock", "Pipfile.lock", "go.sum", "Podfile.lock",
  ".gitignore", ".gitattributes", ".npmrc", ".nvmrc", ".prettierrc", ".eslintrc*",
]);
const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".icns", ".svg", ".pdf", ".zip",
  ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar", ".dmg", ".app", ".mp3", ".mp4", ".mov",
  ".wav", ".m4a", ".flac", ".woff", ".woff2", ".ttf", ".otf", ".eot", ".wasm", ".bin",
  ".exe", ".dll", ".dylib", ".so", ".a", ".o", ".class", ".jar", ".pyc", ".pyo", ".xcassets",
  ".storyboard", ".xib", ".plist", ".entitlements", ".pbxproj", ".xcworkspace",
]);
const SOURCE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".swift", ".go", ".rs", ".rb",
  ".java", ".kt", ".kts", ".c", ".h", ".cpp", ".hpp", ".cc", ".cs", ".php", ".scala",
  ".lua", ".sh", ".bash", ".zsh", ".sql", ".vue", ".svelte", ".dart", ".ex", ".exs",
  ".ml", ".mli", ".hs", ".clj", ".jl", ".r", ".m", ".mm", ".proto", ".graphql", ".sol",
]);
const DOC_EXTS = new Set([".md", ".markdown", ".rst", ".txt", ".org", ".adoc"]);

// 语言 → 顶层符号正则（每行一个匹配，取第一个捕获组）
const SYMBOL_RULES = [
  {
    id: "js/ts",
    exts: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte"],
    patterns: [
      /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/,
      /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
      /^class\s+([A-Za-z_$][\w$]*)/,
      /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/,
    ],
  },
  {
    id: "python",
    exts: [".py"],
    patterns: [
      /^(?:async\s+)?def\s+(\w+)/,
      /^class\s+(\w+)/,
    ],
  },
  {
    id: "swift",
    exts: [".swift"],
    patterns: [
      /^(?:@\w+(?:\([^)]*\))?\s*)*(?:public|private|internal|fileprivate|open|final|static|indirect|actor)?\s*(?:class|struct|enum|protocol|actor|extension)\s+([A-Za-z_]\w*)/,
      /^(?:@\w+(?:\([^)]*\))?\s*)*(?:public|private|internal|fileprivate|open|final|static|override|mutating|nonmutating|convenience|required|class)?\s*func\s+([A-Za-z_]\w*)/,
    ],
  },
  {
    id: "go",
    exts: [".go"],
    patterns: [
      /^func\s+(?:\([^)]*\)\s+)?(\w+)/,
      /^type\s+(\w+)/,
    ],
  },
  {
    id: "rust",
    exts: [".rs"],
    patterns: [
      /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)/,
      /^(?:pub\s+)?(?:struct|enum|trait|type|const|static|mod)\s+(\w+)/,
    ],
  },
  {
    id: "java",
    exts: [".java"],
    patterns: [
      /^\s*(?:public|private|protected|abstract|final|static|sealed|non-sealed)?\s*(?:class|interface|enum|record|@interface)\s+(\w+)/,
    ],
  },
  {
    id: "kotlin",
    exts: [".kt", ".kts"],
    patterns: [
      /^\s*(?:public|private|protected|internal|open|final|abstract|sealed|data|enum|annotation|companion|object)?\s*(?:class|interface|object|enum)\s+(\w+)/,
      /^\s*(?:suspend\s+)?(?:public|private|protected|internal|override|open|final|inline|operator|infix|tailrec|external)?\s*fun\s+(?:<[^>]*>\s*)?(\w+)/,
    ],
  },
  {
    id: "c/c++",
    exts: [".c", ".h", ".cpp", ".hpp", ".cc", ".m", ".mm"],
    patterns: [
      /^(?:class|struct|enum|union|typedef)\s+(?:class\s+)?(\w+)/,
      /^\s*(?:static\s+|inline\s+|virtual\s+|extern\s+|const\s+)*[\w:<>*&,\s]+?\s(\w+)\s*\([^;{}]*\)\s*(?:const\s*)?(?:noexcept)?\s*\{?$/,
    ],
  },
  {
    id: "ruby",
    exts: [".rb"],
    patterns: [
      /^\s*(?:def|class|module)\s+(?:self\.)?(\w+[!?=]?)/,
    ],
  },
  {
    id: "shell",
    exts: [".sh", ".bash", ".zsh"],
    patterns: [
      /^\s*(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\s*\)\s*\{/,
    ],
  },
  {
    id: "other",
    exts: [".cs", ".php", ".scala", ".lua", ".dart", ".ex", ".exs", ".ml", ".mli", ".hs", ".clj", ".jl", ".r", ".proto", ".sol"],
    patterns: [
      /^(?:pub\s+)?(?:class|interface|enum|struct|trait|module|def|defn|fn|fun|function|type|object|data\s+class|sealed\s+trait|contract)\s+([A-Za-z_]\w*)/,
    ],
  },
];

const ruleFor = (ext) => SYMBOL_RULES.find((r) => r.exts.includes(ext)) ?? null;

// ---------- 工具 ----------

function walk(dir, root, out, depth) {
  let entries;
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return;
  }
  for (const name of entries) {
    if (name.startsWith(".") && name !== ".env" && name !== ".github") {
      if (![".github", ".env", ".env.example", ".env.local"].includes(name)) continue;
    }
    if (IGNORE_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (depth < MAX_TREE_DEPTH) walk(full, root, out, depth + 1);
      else out.dirLeaves.push({ path: relative(root, full), truncated: true });
    } else {
      if (IGNORE_FILES.has(name)) continue;
      const ext = name.includes(".") ? "." + name.split(".").pop().toLowerCase() : "";
      if (BINARY_EXTS.has(ext)) continue;
      const rel = relative(root, full);
      if (SOURCE_EXTS.has(ext)) {
        out.sources.push({ rel, full, ext });
      } else if (DOC_EXTS.has(ext)) {
        if (name !== "CODEBASE.md") out.docs.push({ rel, full });
      } else if (!name.startsWith(".")) {
        out.other.push({ rel, ext });
      }
    }
  }
}

function extractSymbols(filePath, rule) {
  let text;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return { symbols: [], header: "" };
  }
  const lines = text.split("\n");
  const symbols = [];
  const seen = new Set();
  for (const line of lines) {
    for (const re of rule.patterns) {
      const m = re.exec(line);
      if (m && m[1] && !seen.has(m[1])) {
        seen.add(m[1]);
        symbols.push(m[1]);
        break;
      }
    }
    if (symbols.length >= MAX_SYMBOLS_PER_FILE) break;
  }
  // 文件头注释作职责线索（第一个注释块，压成一行）
  let header = "";
  let inBlock = false;
  let blockLines = [];
  for (const raw of lines.slice(0, 40)) {
    const line = raw.trim();
    if (line.startsWith("#!")) continue; // shebang 不是注释
    if (line.startsWith("//") || line.startsWith("#") || line.startsWith(";;") || line.startsWith("--")) {
      const c = line.replace(/^\/{2,}\s?/, "").replace(/^#\s?/, "").replace(/^;+\s?/, "").replace(/^--\s?/, "");
      if (c && !/^(eslint|tslint|noinspection|pyright|mypy|prettier|import|@flow|MARK|@ts-nocheck|@ts-ignore|@ts-expect-error|config options)/i.test(c)) {
        blockLines.push(c);
        continue;
      }
    } else if (line.startsWith("/*") || line.startsWith("/**") || line.startsWith('"""')) {
      inBlock = true;
      const c = line.replace(/^\/\*+\s?/, "").replace(/^"""\s?/, "").replace(/\*\/\s*$/, "");
      if (c && c !== "*/") blockLines.push(c);
      continue;
    } else if (inBlock) {
      if (line.includes("*/") || line.endsWith('"""')) {
        inBlock = false;
      } else if (line.startsWith("*")) {
        const c = line.replace(/^\*\s?/, "");
        if (c) blockLines.push(c);
        continue;
      }
    }
    if (blockLines.length) break;
  }
  header = blockLines.join(" ").replace(/\s+/g, " ").slice(0, 140);
  return { symbols, header };
}

// 入口文件启发式：名字像入口 / 被 package.json 指定
function detectEntry(files, root) {
  const entryNames = ["main", "index", "app", "cli", "server", "入口"];
  const candidates = files.filter((f) => {
    const base = basename(f.rel).split(".")[0].toLowerCase();
    return entryNames.some((n) => base === n || base.startsWith(n));
  });
  if (candidates.length) return candidates[0].rel;
  // package.json main / bin
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const entry = pkg.main || (pkg.bin && Object.values(pkg.bin)[0]);
    if (entry && files.some((f) => f.rel === entry || f.rel === entry + ".js" || f.rel === entry + ".ts")) {
      return entry;
    }
  } catch {}
  // 兜底：根目录文件优先，排除配置类文件
  const isConfigLike = (f) =>
    /^(eslint|next|tailwind|postcss|vitest|jest|tsconfig|vite|webpack|babel|prettier)[.\-]|\.config\./i.test(basename(f.rel));
  return (
    files.find((f) => dirname(f.rel) === "." && !isConfigLike(f))?.rel ??
    files.find((f) => !isConfigLike(f))?.rel ??
    files[0]?.rel ??
    ""
  );
}

function detectStack(files, root) {
  const counts = {};
  for (const f of files) counts[f.ext] = (counts[f.ext] || 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([e]) => e).join("/");
  const markers = [
    ["Node", join(root, "package.json")],
    ["Swift", join(root, "Package.swift")],
    ["Go", join(root, "go.mod")],
    ["Rust", join(root, "Cargo.toml")],
    ["Python", join(root, "pyproject.toml")],
    ["Xcode", files.some((f) => f.rel.endsWith(".xcodeproj")) ? join(root, ".") : ""],
  ];
  const hits = markers.filter(([, p]) => p && statSyncSafe(p)).map(([n]) => n);
  return hits.length ? hits.join(" + ") : (top || "未知");
}

function statSyncSafe(p) {
  try {
    return statSync(p).isFile() || statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function buildCommands(root) {
  const cmds = [];
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    if (pkg.scripts) {
      for (const [name, cmd] of Object.entries(pkg.scripts).slice(0, 6)) {
        if (["dev", "build", "test", "lint", "start"].includes(name)) cmds.push(`npm run ${name}`);
      }
    }
  } catch {}
  if (statSyncSafe(join(root, "scripts", "build.sh"))) cmds.push("bash scripts/build.sh");
  if (statSyncSafe(join(root, "Makefile"))) cmds.push("make");
  if (statSyncSafe(join(root, "Cargo.toml"))) cmds.push("cargo build", "cargo test");
  if (statSyncSafe(join(root, "go.mod"))) cmds.push("go build ./...", "go test ./...");
  if (statSyncSafe(join(root, "Package.swift"))) cmds.push("swift build", "swift test");
  return [...new Set(cmds)].slice(0, 6);
}

// 目录树：只列目录，叶子标注文件数
function buildTree(root, allFiles) {
  const tree = new Map(); // path -> { dirs: Set, files: number, fileNames: [] }
  for (const f of allFiles) {
    let d = dirname(f.rel);
    while (d && d !== ".") {
      if (!tree.has(d)) tree.set(d, { dirs: new Set(), files: 0, fileNames: [] });
      tree.get(d).files++;
      const parent = dirname(d);
      if (parent !== d) {
        if (!tree.has(parent)) tree.set(parent, { dirs: new Set(), files: 0, fileNames: [] });
        tree.get(parent).dirs.add(d);
      }
      d = parent;
    }
  }
  const lines = [];
  const render = (d, prefix, isLast, depth) => {
    if (depth > MAX_TREE_DEPTH) return;
    const node = tree.get(d);
    const name = basename(d);
    const count = node ? node.files : 0;
    const branch = isLast ? "└── " : "├── ";
    lines.push(`${prefix}${branch}${name}/  (${count} files)`);
    const children = node ? [...node.dirs].sort() : [];
    const shown = children.slice(0, MAX_TREE_ENTRIES);
    for (let i = 0; i < shown.length; i++) {
      render(children[i], prefix + (isLast ? "    " : "│   "), i === shown.length - 1 && children.length === shown.length, depth + 1);
    }
    if (children.length > shown.length) {
      lines.push(`${prefix}${isLast ? "    " : "│   "}└── …（${children.length - shown.length} 个子目录未展开）`);
    }
  };
  const roots = new Set();
  for (const f of allFiles) {
    const d = dirname(f.rel);
    const top = d === "." ? "." : d.split("/")[0];
    roots.add(top);
  }
  const sortedRoots = [...roots].sort();
  sortedRoots.forEach((r, i) => {
    const isLast = i === sortedRoots.length - 1;
    if (r === ".") {
      lines.push(`${isLast ? "└── " : "├── "}./  (${allFiles.filter((f) => dirname(f.rel) === ".").length} files at root)`);
    } else {
      render(r, "", isLast, 0);
    }
  });
  return lines;
}

function buildFileList(files, root) {
  // 按目录分组，目录内按符号数量降序
  const byDir = new Map();
  for (const f of files) {
    const d = dirname(f.rel) === "." ? "(root)" : dirname(f.rel);
    if (!byDir.has(d)) byDir.set(d, []);
    byDir.get(d).push(f);
  }
  for (const list of byDir.values()) list.sort((a, b) => b.symbols.length - a.symbols.length);
  const lines = [];
  for (const [dir, list] of [...byDir.entries()].sort()) {
    lines.push(`### ${dir}/`);
    for (const f of list) {
      const sym = f.symbols.length ? `（符号：${f.symbols.join("、")}）` : "";
      const desc = f.header ? ` —— ${f.header}` : "";
      lines.push(`- \`${basename(f.rel)}\`${desc} ${sym}`.trimEnd());
    }
    lines.push("");
  }
  return lines;
}

// ---------- 主流程 ----------

function findProjectRoot(startDir) {
  let dir = resolve(startDir);
  while (true) {
    if (statSyncSafe(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(startDir);
    dir = parent;
  }
}

function main() {
  const targetArg = process.argv[2] || ".";
  const target = resolve(targetArg);
  if (!statSyncSafe(target)) {
    console.error(`目标目录不存在：${target}`);
    process.exit(1);
  }
  const root = findProjectRoot(target);
  const out = { sources: [], docs: [], other: [], dirLeaves: [] };
  walk(root, root, out, 0);

  // 源码文件去重 + 排序（入口优先，其余按目录/文件名）
  const entryRel = detectEntry(out.sources, root);
  out.sources.sort((a, b) => {
    const ea = a.rel === entryRel ? 0 : 1;
    const eb = b.rel === entryRel ? 0 : 1;
    return ea - eb || a.rel.localeCompare(b.rel);
  });

  // 提取符号（最多 MAX_FILES 个文件）
  let skipped = 0;
  const parsed = [];
  for (const f of out.sources) {
    if (parsed.length >= MAX_FILES) {
      skipped++;
      continue;
    }
    const rule = ruleFor(f.ext);
    const { symbols, header } = rule ? extractSymbols(f.full, rule) : { symbols: [], header: "" };
    parsed.push({ ...f, symbols, header });
  }

  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const stack = detectStack(out.sources, root);
  const cmds = buildCommands(root);
  const projectName = basename(root);

  const sections = [];
  sections.push(`# CODEBASE.md —— ${projectName} 代码地图`);
  sections.push("");
  sections.push(`> 自动生成于 ${stamp}（pi codebase-map）。改动代码后运行 \`/map\` 刷新。`);
  sections.push(`> 用法：先读本图建立全局认知，再按需 read 具体文件；不要每次全量扫仓库。`);
  sections.push("");
  sections.push("## 总览");
  sections.push("");
  sections.push(`- 技术栈：${stack}`);
  sections.push(`- 源码文件：${out.sources.length} 个${skipped ? `（地图列出 ${parsed.length} 个，其余略）` : ""}`);
  if (entryRel) sections.push(`- 入口：\`${entryRel}\``);
  if (cmds.length) sections.push(`- 常用命令：${cmds.join("；")}`);
  sections.push("");
  sections.push("## 目录结构");
  sections.push("");
  sections.push("```");
  sections.push(...buildTree(root, out.sources));
  sections.push("```");
  sections.push("");
  if (out.docs.length) {
    sections.push("## 文档");
    sections.push("");
    for (const d of out.docs.slice(0, 30)) sections.push(`- \`${d.rel}\``);
    sections.push("");
  }
  if (parsed.length) {
    sections.push("## 源码地图");
    sections.push("");
    sections.push(...buildFileList(parsed, root));
  } else {
    sections.push("## 源码地图");
    sections.push("");
    sections.push("（未发现可识别的源码文件。）");
    sections.push("");
  }
  if (out.other.length) {
    sections.push("## 其他文件");
    sections.push("");
    const names = out.other.map((o) => "`" + o.rel + "`").slice(0, 40).join("、");
    sections.push(`${names}${out.other.length > 40 ? `（共 ${out.other.length} 个，仅列前 40）` : ""}`);
    sections.push("");
  }
  if (skipped) {
    sections.push(`> 源码文件过多（> ${MAX_FILES}），已跳过 ${skipped} 个。需要全量时用 read / find 查具体目录。`);
  }

  let body = sections.join("\n");
  if (Buffer.byteLength(body, "utf8") > MAX_MAP_BYTES) {
    const notice = `> 地图超出 ${MAX_MAP_BYTES} 字节预算，已截断文件清单。剩余部分用 read 直接查看源码。\n\n`;
    body = body.slice(0, MAX_MAP_BYTES - Buffer.byteLength(notice, "utf8")) + "\n\n" + notice;
  }
  body = body.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";

  const outPath = join(root, "CODEBASE.md");
  writeFileSync(outPath, body, "utf8");
  console.log(`已生成 ${outPath}`);
  console.log(`  ${out.sources.length} 个源码文件，地图 ${(Buffer.byteLength(body) / 1024).toFixed(1)} KB`);
  if (entryRel) console.log(`  入口：${entryRel}`);
}

main();
