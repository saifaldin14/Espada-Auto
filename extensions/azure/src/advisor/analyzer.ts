/**
 * Advisor — Project Analyzer
 *
 * Scans a project directory to detect language, framework, architecture,
 * dependencies, and infrastructure signals used by the recommendation engine.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, basename, extname } from "node:path";
import type {
  ProjectAnalysis,
  DetectedLanguage,
  DetectedFramework,
  AppArchetype,
  DetectedDependency,
  DependencySignal,
  AnalyzedConfigFile,
} from "./types.js";

// =============================================================================
// Dependency signal mappings
// =============================================================================

/** Maps npm package names to infrastructure signals. */
const NPM_SIGNALS: Record<string, DependencySignal> = {
  // SQL
  pg: "sql-database",
  "pg-promise": "sql-database",
  mysql2: "sql-database",
  mysql: "sql-database",
  mssql: "sql-database",
  tedious: "sql-database",
  "better-sqlite3": "sql-database",
  sequelize: "orm",
  typeorm: "orm",
  prisma: "orm",
  "@prisma/client": "orm",
  knex: "orm",
  drizzle: "orm",
  "drizzle-orm": "orm",

  // NoSQL
  mongodb: "nosql-database",
  mongoose: "nosql-database",
  "@azure/cosmos": "nosql-database",

  // Redis
  redis: "redis-cache",
  ioredis: "redis-cache",
  "@redis/client": "redis-cache",

  // Messaging
  amqplib: "messaging-queue",
  bullmq: "messaging-queue",
  bull: "messaging-queue",
  "@azure/service-bus": "messaging-queue",
  kafkajs: "messaging-pubsub",
  "@azure/event-hubs": "messaging-pubsub",
  "@azure/event-grid": "messaging-pubsub",

  // Storage
  "@azure/storage-blob": "storage-blob",
  multer: "storage-blob",
  "multer-azure-blob-storage": "storage-blob",

  // Search
  "@azure/search-documents": "search",
  elasticsearch: "search",
  "@elastic/elasticsearch": "search",

  // Auth
  passport: "auth",
  "@azure/identity": "auth",
  jsonwebtoken: "auth",
  "next-auth": "auth",

  // AI/ML
  openai: "ai-ml",
  "@azure/openai": "ai-ml",
  "@azure/cognitiveservices-computervision": "ai-ml",
  langchain: "ai-ml",

  // Monitoring
  "@azure/monitor-opentelemetry": "monitoring",
  applicationinsights: "monitoring",
  "@opentelemetry/sdk-node": "monitoring",

  // Web frameworks
  express: "web-framework",
  fastify: "web-framework",
  "@nestjs/core": "web-framework",
  koa: "web-framework",
  hapi: "web-framework",
  hono: "web-framework",

  // API frameworks
  "@nestjs/graphql": "api-framework",
  "apollo-server": "api-framework",
  "@trpc/server": "api-framework",

  // Static / SSG
  next: "static-site-generator",
  nuxt: "static-site-generator",
  gatsby: "static-site-generator",
  astro: "static-site-generator",
  vuepress: "static-site-generator",
  eleventy: "static-site-generator",
};

/** Maps Python packages to infrastructure signals. */
const PYTHON_SIGNALS: Record<string, DependencySignal> = {
  psycopg2: "sql-database",
  "psycopg2-binary": "sql-database",
  pymysql: "sql-database",
  pyodbc: "sql-database",
  sqlalchemy: "orm",
  "django-orm": "orm",
  pymongo: "nosql-database",
  "azure-cosmos": "nosql-database",
  redis: "redis-cache",
  "azure-servicebus": "messaging-queue",
  celery: "messaging-queue",
  "azure-storage-blob": "storage-blob",
  "azure-search-documents": "search",
  "azure-identity": "auth",
  openai: "ai-ml",
  langchain: "ai-ml",
  "azure-ai-inference": "ai-ml",
  "opencensus-ext-azure": "monitoring",
  "azure-monitor-opentelemetry": "monitoring",
  flask: "web-framework",
  django: "web-framework",
  fastapi: "api-framework",
  uvicorn: "api-framework",
  gunicorn: "web-framework",
  mkdocs: "static-site-generator",
};

/** Maps NuGet packages to infrastructure signals. */
const NUGET_SIGNALS: Record<string, DependencySignal> = {
  "Microsoft.EntityFrameworkCore": "orm",
  "Microsoft.EntityFrameworkCore.SqlServer": "sql-database",
  "Npgsql.EntityFrameworkCore.PostgreSQL": "sql-database",
  "Microsoft.Azure.Cosmos": "nosql-database",
  "StackExchange.Redis": "redis-cache",
  "Azure.Messaging.ServiceBus": "messaging-queue",
  "Azure.Storage.Blobs": "storage-blob",
  "Azure.Identity": "auth",
  "Azure.AI.OpenAI": "ai-ml",
  "Microsoft.ApplicationInsights.AspNetCore": "monitoring",
};

// =============================================================================
// Public API
// =============================================================================

/**
 * Analyze a project directory and return a structured description of
 * the detected stack, framework, dependencies, and infrastructure signals.
 */
export function analyzeProject(projectPath: string): ProjectAnalysis {
  const notes: string[] = [];
  const configFiles: AnalyzedConfigFile[] = [];
  const allDeps: DetectedDependency[] = [];
  const envVars: string[] = [];
  let language: DetectedLanguage = "unknown";
  let framework: DetectedFramework = "unknown";
  let entryPoint: string | undefined;
  let port: number | undefined;
  let hasDockerfile = false;
  let hasDockerCompose = false;
  let hasTests = false;
  let packageManager: ProjectAnalysis["packageManager"];

  // -------------------------------------------------------------------------
  // 1. Scan for config files
  // -------------------------------------------------------------------------
  const topFiles = safeReaddir(projectPath);

  // Dockerfile
  if (topFiles.includes("Dockerfile") || topFiles.includes("dockerfile")) {
    hasDockerfile = true;
    configFiles.push({ path: "Dockerfile", type: "Dockerfile" });
    notes.push("Dockerfile detected — container deployment possible");
  }

  // Docker Compose
  for (const n of ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"]) {
    if (topFiles.includes(n)) {
      hasDockerCompose = true;
      configFiles.push({ path: n, type: "docker-compose.yml" });
      notes.push("Docker Compose detected — multi-service architecture");
      break;
    }
  }

  // .env
  for (const n of [".env", ".env.example", ".env.local", ".env.production"]) {
    if (topFiles.includes(n)) {
      configFiles.push({ path: n, type: ".env" });
      const content = safeRead(join(projectPath, n));
      if (content) {
        const parsed = content.split("\n")
          .filter((l) => l.trim() && !l.startsWith("#"))
          .map((l) => l.split("=")[0]?.trim())
          .filter((k): k is string => !!k);
        envVars.push(...parsed);
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2. Detect language and parse deps
  // -------------------------------------------------------------------------

  // --- Node / TypeScript ---
  if (topFiles.includes("package.json")) {
    const pkg = safeParseJson(join(projectPath, "package.json"));
    if (pkg) {
      configFiles.push({ path: "package.json", type: "package.json" });
      const hasTsConfig = topFiles.includes("tsconfig.json");
      if (hasTsConfig) configFiles.push({ path: "tsconfig.json", type: "tsconfig.json" });
      language = hasTsConfig ? "typescript" : "node";

      // Package manager
      if (topFiles.includes("pnpm-lock.yaml")) packageManager = "pnpm";
      else if (topFiles.includes("yarn.lock")) packageManager = "yarn";
      else if (topFiles.includes("bun.lockb") || topFiles.includes("bun.lock")) packageManager = "bun";
      else packageManager = "npm";

      // Parse deps
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) } as Record<string, string>;
      for (const [name, ver] of Object.entries(deps)) {
        const signal = NPM_SIGNALS[name];
        if (signal) {
          allDeps.push({ name, version: ver, signal });
        }
      }

      // Framework detection
      if (deps["@nestjs/core"]) framework = "nestjs";
      else if (deps.next) framework = "nextjs";
      else if (deps.nuxt) framework = "nuxt";
      else if (deps.fastify) framework = "fastify";
      else if (deps.express) framework = "express";
      else if (deps.react && !deps.next) framework = "react";
      else if (deps.vue && !deps.nuxt) framework = "vue";
      else if (deps["@angular/core"]) framework = "angular";
      else if (deps.svelte || deps["@sveltejs/kit"]) framework = "svelte";
      else framework = "none";

      // Entry point detection
      const main = pkg.main as string | undefined;
      if (main) entryPoint = main;
      else if (hasTsConfig) entryPoint = findFile(projectPath, ["src/index.ts", "src/main.ts", "src/server.ts", "src/app.ts", "index.ts"]);
      else entryPoint = findFile(projectPath, ["src/index.js", "src/main.js", "src/server.js", "src/app.js", "index.js"]);

      // Port detection
      const scripts = pkg.scripts as Record<string, string> | undefined;
      if (scripts) {
        const startScript = scripts.start ?? scripts.dev ?? "";
        const portMatch = startScript.match(/(?:--port|PORT=|port\s+)\s*(\d{4,5})/i);
        if (portMatch) port = parseInt(portMatch[1], 10);
      }
      if (!port) port = detectPortFromCode(projectPath, language);

      // Tests
      hasTests = !!(scripts?.test && scripts.test !== "echo \"Error: no test specified\" && exit 1") || !!(deps.vitest || deps.jest || deps.mocha);
    }
  }

  // --- Python ---
  if (language === "unknown" && (topFiles.includes("requirements.txt") || topFiles.includes("pyproject.toml") || topFiles.includes("Pipfile") || topFiles.includes("setup.py"))) {
    language = "python";

    if (topFiles.includes("pyproject.toml")) {
      configFiles.push({ path: "pyproject.toml", type: "pyproject.toml" });
      packageManager = "poetry";
    }
    if (topFiles.includes("Pipfile")) {
      configFiles.push({ path: "Pipfile", type: "Pipfile" });
      packageManager = "pipenv";
    }
    if (topFiles.includes("requirements.txt")) {
      configFiles.push({ path: "requirements.txt", type: "requirements.txt" });
      if (!packageManager) packageManager = "pip";
      const content = safeRead(join(projectPath, "requirements.txt"));
      if (content) {
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const [name, ver] = trimmed.split(/[=<>!~]/);
          const signal = PYTHON_SIGNALS[name?.trim().toLowerCase() ?? ""];
          if (signal) allDeps.push({ name: name.trim(), version: ver?.replace(/[=]/g, ""), signal });
        }
      }
    }

    // Framework
    if (allDeps.some((d) => d.name.toLowerCase() === "fastapi")) framework = "fastapi";
    else if (allDeps.some((d) => d.name.toLowerCase() === "django")) framework = "django";
    else if (allDeps.some((d) => d.name.toLowerCase() === "flask")) framework = "flask";
    else framework = "none";

    // Entry point
    entryPoint = findFile(projectPath, ["app.py", "main.py", "manage.py", "run.py", "server.py", "src/main.py", "src/app.py"]);

    // Port
    port = detectPortFromCode(projectPath, language);

    // Tests
    hasTests = topFiles.includes("tests") || topFiles.includes("test") || allDeps.some((d) => d.name === "pytest");
  }

  // --- .NET ---
  if (language === "unknown") {
    const csproj = topFiles.find((f) => f.endsWith(".csproj"));
    if (csproj) {
      language = "dotnet";
      packageManager = "dotnet";
      configFiles.push({ path: csproj, type: ".csproj" });
      framework = "aspnet";

      const content = safeRead(join(projectPath, csproj));
      if (content) {
        for (const [pkg, signal] of Object.entries(NUGET_SIGNALS)) {
          if (content.includes(pkg)) {
            allDeps.push({ name: pkg, signal });
          }
        }
      }

      entryPoint = findFile(projectPath, ["Program.cs", "Startup.cs"]);
      hasTests = topFiles.some((f) => f.endsWith(".Tests") || f.endsWith(".Test"));
    }
  }

  // --- Java ---
  if (language === "unknown") {
    if (topFiles.includes("pom.xml")) {
      language = "java";
      packageManager = "maven";
      configFiles.push({ path: "pom.xml", type: "pom.xml" });
      framework = "spring-boot";
    } else if (topFiles.includes("build.gradle") || topFiles.includes("build.gradle.kts")) {
      language = "java";
      packageManager = "gradle";
      const gf = topFiles.includes("build.gradle") ? "build.gradle" : "build.gradle.kts";
      configFiles.push({ path: gf, type: "build.gradle" });
      framework = "spring-boot";
    }
    if (language === "java") {
      hasTests = existsSync(join(projectPath, "src/test"));
    }
  }

  // --- Go ---
  if (language === "unknown" && topFiles.includes("go.mod")) {
    language = "go";
    packageManager = "go-mod";
    configFiles.push({ path: "go.mod", type: "go.mod" });
    framework = "none";
    entryPoint = findFile(projectPath, ["main.go", "cmd/main.go", "cmd/server/main.go"]);
    const goMod = safeRead(join(projectPath, "go.mod"));
    if (goMod?.includes("github.com/gin-gonic/gin")) framework = "gin";
  }

  // --- Rust ---
  if (language === "unknown" && topFiles.includes("Cargo.toml")) {
    language = "rust";
    packageManager = "cargo";
    configFiles.push({ path: "Cargo.toml", type: "Cargo.toml" });
    framework = "none";
    entryPoint = findFile(projectPath, ["src/main.rs"]);
  }

  // -------------------------------------------------------------------------
  // 3. Determine archetype
  // -------------------------------------------------------------------------
  const archetype = inferArchetype(language, framework, allDeps, hasDockerCompose, configFiles);

  // -------------------------------------------------------------------------
  // 4. Confidence
  // -------------------------------------------------------------------------
  let confidence = 0.5;
  if (language !== "unknown") confidence += 0.2;
  if (framework !== "unknown" && framework !== "none") confidence += 0.15;
  if (allDeps.length > 0) confidence += 0.1;
  if (entryPoint) confidence += 0.05;
  confidence = Math.min(confidence, 1);

  if (language === "unknown") notes.push("Could not detect project language — ensure the project has standard config files");

  return {
    projectPath,
    language,
    framework,
    archetype,
    entryPoint,
    port,
    dependencies: allDeps,
    hasDockerfile,
    hasDockerCompose,
    packageManager,
    hasTests,
    envVars,
    configFiles,
    confidence,
    notes,
  };
}

// =============================================================================
// Internal helpers
// =============================================================================

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir, { encoding: "utf-8" });
  } catch {
    return [];
  }
}

function safeRead(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function safeParseJson(path: string): Record<string, any> | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function findFile(root: string, candidates: string[]): string | undefined {
  for (const c of candidates) {
    if (existsSync(join(root, c))) return c;
  }
  return undefined;
}

/** Detect port from common patterns in source code. */
function detectPortFromCode(root: string, lang: DetectedLanguage): number | undefined {
  const candidates: string[] = [];
  if (lang === "node" || lang === "typescript") {
    candidates.push("src/index.ts", "src/server.ts", "src/app.ts", "src/main.ts", "index.ts", "index.js", "src/index.js", "server.js", "app.js");
  } else if (lang === "python") {
    candidates.push("app.py", "main.py", "run.py", "manage.py");
  }

  for (const c of candidates) {
    const content = safeRead(join(root, c));
    if (!content) continue;
    // Match .listen(PORT) or port=PORT or --port PORT
    const m = content.match(/\.listen\(\s*(\d{4,5})/);
    if (m) return parseInt(m[1], 10);
    const m2 = content.match(/port\s*[=:]\s*(\d{4,5})/i);
    if (m2) return parseInt(m2[1], 10);
  }
  return undefined;
}

/** Infer the application archetype from detected signals. */
function inferArchetype(
  lang: DetectedLanguage,
  framework: DetectedFramework,
  deps: DetectedDependency[],
  hasCompose: boolean,
  configs: AnalyzedConfigFile[],
): AppArchetype {
  const signals = new Set(deps.map((d) => d.signal));

  // Next.js / Nuxt are fullstack by default (check before static-site-generator signal)
  if (framework === "nextjs" || framework === "nuxt") return "fullstack";

  // Static site
  if (
    framework === "react" || framework === "vue" || framework === "angular" || framework === "svelte" ||
    deps.some((d) => d.signal === "static-site-generator")
  ) {
    // If it also has API / database deps, it's fullstack
    if (signals.has("sql-database") || signals.has("nosql-database") || signals.has("web-framework") || signals.has("api-framework")) {
      return "fullstack";
    }
    return "static-site";
  }

  // Microservices
  if (hasCompose) return "microservices";

  // API
  if (
    framework === "fastapi" || framework === "nestjs" || framework === "gin" ||
    deps.some((d) => d.signal === "api-framework")
  ) {
    return "api";
  }

  // Web app with DB
  if (
    (framework === "express" || framework === "fastify" || framework === "flask" || framework === "django" || framework === "aspnet" || framework === "spring-boot" || framework === "rails" || framework === "laravel") &&
    (signals.has("sql-database") || signals.has("nosql-database") || signals.has("orm"))
  ) {
    return "web-app";
  }

  // Web app without DB
  if (framework === "express" || framework === "fastify" || framework === "flask" || framework === "django" || framework === "aspnet" || framework === "spring-boot") {
    return "api";
  }

  // Worker
  if (signals.has("messaging-queue") && !signals.has("web-framework") && !signals.has("api-framework")) {
    return "worker";
  }

  // Data pipeline
  if (signals.has("nosql-database") && signals.has("storage-blob") && !signals.has("web-framework")) {
    return "data-pipeline";
  }

  return "unknown";
}
