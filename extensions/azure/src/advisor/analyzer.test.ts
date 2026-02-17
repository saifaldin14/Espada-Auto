/**
 * Advisor — Analyzer tests
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyzeProject } from "./analyzer.js";

// Deterministic temp dir for each test
let root: string;

function dir(...parts: string[]): string {
  const p = join(root, ...parts);
  mkdirSync(p, { recursive: true });
  return p;
}

function file(path: string, content: string): void {
  const full = join(root, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf-8");
}

beforeEach(() => {
  root = join(tmpdir(), `espada-advisor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
});

afterEach(() => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
});

// =============================================================================
// Language detection
// =============================================================================

describe("language detection", () => {
  test("detects Node from package.json", () => {
    file("package.json", JSON.stringify({ name: "test-app", dependencies: {} }));
    const result = analyzeProject(root);
    expect(result.language).toBe("node");
  });

  test("detects TypeScript from package.json + tsconfig", () => {
    file("package.json", JSON.stringify({ name: "test-app", dependencies: {} }));
    file("tsconfig.json", "{}");
    const result = analyzeProject(root);
    expect(result.language).toBe("typescript");
  });

  test("detects Python from requirements.txt", () => {
    file("requirements.txt", "flask==2.3.0\nrequests==2.31.0\n");
    const result = analyzeProject(root);
    expect(result.language).toBe("python");
  });

  test("detects .NET from .csproj", () => {
    file("MyApp.csproj", "<Project><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>");
    const result = analyzeProject(root);
    expect(result.language).toBe("dotnet");
  });

  test("detects Java from pom.xml", () => {
    file("pom.xml", "<project></project>");
    const result = analyzeProject(root);
    expect(result.language).toBe("java");
  });

  test("detects Go from go.mod", () => {
    file("go.mod", "module example.com/myapp\ngo 1.21\n");
    const result = analyzeProject(root);
    expect(result.language).toBe("go");
  });

  test("detects Rust from Cargo.toml", () => {
    file("Cargo.toml", "[package]\nname = \"myapp\"");
    const result = analyzeProject(root);
    expect(result.language).toBe("rust");
  });

  test("returns unknown for empty directory", () => {
    const result = analyzeProject(root);
    expect(result.language).toBe("unknown");
    expect(result.archetype).toBe("unknown");
    expect(result.confidence).toBe(0.5);
  });
});

// =============================================================================
// Framework detection
// =============================================================================

describe("framework detection", () => {
  test("detects Express", () => {
    file("package.json", JSON.stringify({ dependencies: { express: "^4.18.0" } }));
    expect(analyzeProject(root).framework).toBe("express");
  });

  test("detects NestJS", () => {
    file("package.json", JSON.stringify({ dependencies: { "@nestjs/core": "^10.0.0", express: "^4.18" } }));
    expect(analyzeProject(root).framework).toBe("nestjs");
  });

  test("detects Next.js", () => {
    file("package.json", JSON.stringify({ dependencies: { next: "14.0.0", react: "18.2.0" } }));
    expect(analyzeProject(root).framework).toBe("nextjs");
  });

  test("detects FastAPI", () => {
    file("requirements.txt", "fastapi==0.100.0\nuvicorn==0.23.0\n");
    expect(analyzeProject(root).framework).toBe("fastapi");
  });

  test("detects Django", () => {
    file("requirements.txt", "django==4.2.0\n");
    expect(analyzeProject(root).framework).toBe("django");
  });

  test("detects Flask", () => {
    file("requirements.txt", "flask==2.3.0\n");
    expect(analyzeProject(root).framework).toBe("flask");
  });

  test("detects React (frontend only)", () => {
    file("package.json", JSON.stringify({ dependencies: { react: "18.2.0", "react-dom": "18.2.0" } }));
    expect(analyzeProject(root).framework).toBe("react");
  });

  test("detects Vue.js", () => {
    file("package.json", JSON.stringify({ dependencies: { vue: "3.3.0" } }));
    expect(analyzeProject(root).framework).toBe("vue");
  });

  test("detects Angular", () => {
    file("package.json", JSON.stringify({ dependencies: { "@angular/core": "16.0.0" } }));
    expect(analyzeProject(root).framework).toBe("angular");
  });
});

// =============================================================================
// Dependency signals
// =============================================================================

describe("dependency signals", () => {
  test("detects SQL database signals from npm packages", () => {
    file("package.json", JSON.stringify({ dependencies: { pg: "8.11.0", express: "4.18" } }));
    const result = analyzeProject(root);
    const sqlDep = result.dependencies.find((d) => d.name === "pg");
    expect(sqlDep).toBeDefined();
    expect(sqlDep!.signal).toBe("sql-database");
  });

  test("detects Redis signal", () => {
    file("package.json", JSON.stringify({ dependencies: { ioredis: "5.3.0" } }));
    const result = analyzeProject(root);
    expect(result.dependencies.some((d) => d.signal === "redis-cache")).toBe(true);
  });

  test("detects messaging queue signal", () => {
    file("package.json", JSON.stringify({ dependencies: { bullmq: "4.0.0" } }));
    const result = analyzeProject(root);
    expect(result.dependencies.some((d) => d.signal === "messaging-queue")).toBe(true);
  });

  test("detects Python dependency signals", () => {
    file("requirements.txt", "psycopg2-binary==2.9.0\nredis==4.5.0\nazure-storage-blob==12.0.0\n");
    const result = analyzeProject(root);
    expect(result.dependencies.some((d) => d.signal === "sql-database")).toBe(true);
    expect(result.dependencies.some((d) => d.signal === "redis-cache")).toBe(true);
    expect(result.dependencies.some((d) => d.signal === "storage-blob")).toBe(true);
  });

  test("detects NuGet dependency signals from .csproj", () => {
    file(
      "App.csproj",
      `<Project>
        <ItemGroup>
          <PackageReference Include="Microsoft.EntityFrameworkCore.SqlServer" Version="8.0.0" />
          <PackageReference Include="StackExchange.Redis" Version="2.6.0" />
        </ItemGroup>
      </Project>`,
    );
    const result = analyzeProject(root);
    expect(result.dependencies.some((d) => d.signal === "sql-database")).toBe(true);
    expect(result.dependencies.some((d) => d.signal === "redis-cache")).toBe(true);
  });

  test("detects ORM signals", () => {
    file("package.json", JSON.stringify({ dependencies: { prisma: "5.0.0", "@prisma/client": "5.0.0" } }));
    const result = analyzeProject(root);
    expect(result.dependencies.filter((d) => d.signal === "orm").length).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// Archetype inference
// =============================================================================

describe("archetype inference", () => {
  test("infers API for FastAPI project", () => {
    file("requirements.txt", "fastapi==0.100.0\nuvicorn==0.23.0\n");
    expect(analyzeProject(root).archetype).toBe("api");
  });

  test("infers web-app for Express + database", () => {
    file("package.json", JSON.stringify({ dependencies: { express: "4.18", pg: "8.11.0" } }));
    expect(analyzeProject(root).archetype).toBe("web-app");
  });

  test("infers static-site for React without backend deps", () => {
    file("package.json", JSON.stringify({ dependencies: { react: "18.2.0", "react-dom": "18.2.0" } }));
    expect(analyzeProject(root).archetype).toBe("static-site");
  });

  test("infers fullstack for React + database", () => {
    file("package.json", JSON.stringify({ dependencies: { react: "18.2.0", "react-dom": "18.2.0", pg: "8.11" } }));
    expect(analyzeProject(root).archetype).toBe("fullstack");
  });

  test("infers fullstack for Next.js", () => {
    file("package.json", JSON.stringify({ dependencies: { next: "14.0.0", react: "18.2.0" } }));
    expect(analyzeProject(root).archetype).toBe("fullstack");
  });

  test("infers microservices for Docker Compose project", () => {
    file("package.json", JSON.stringify({ dependencies: { express: "4.18" } }));
    file("docker-compose.yml", "version: '3'\nservices:\n  api:\n    build: .");
    expect(analyzeProject(root).archetype).toBe("microservices");
  });

  test("infers worker for messaging-only project", () => {
    file("package.json", JSON.stringify({ dependencies: { bullmq: "4.0.0" } }));
    expect(analyzeProject(root).archetype).toBe("worker");
  });
});

// =============================================================================
// Dockerfile / env / package manager
// =============================================================================

describe("infrastructure signals", () => {
  test("detects Dockerfile", () => {
    file("Dockerfile", "FROM node:18\nWORKDIR /app");
    file("package.json", JSON.stringify({ dependencies: { express: "4.18" } }));
    const result = analyzeProject(root);
    expect(result.hasDockerfile).toBe(true);
  });

  test("detects Docker Compose", () => {
    file("docker-compose.yml", "version: '3'\nservices:\n  app:\n    build: .");
    file("package.json", JSON.stringify({ dependencies: {} }));
    expect(analyzeProject(root).hasDockerCompose).toBe(true);
  });

  test("parses .env variables", () => {
    file("package.json", JSON.stringify({ dependencies: {} }));
    file(".env", "DATABASE_URL=postgres://localhost:5432/db\nAPI_KEY=secret\n# comment\n");
    const result = analyzeProject(root);
    expect(result.envVars).toContain("DATABASE_URL");
    expect(result.envVars).toContain("API_KEY");
    expect(result.envVars).not.toContain("# comment");
  });

  test("detects pnpm package manager", () => {
    file("package.json", JSON.stringify({ dependencies: {} }));
    file("pnpm-lock.yaml", "lockfileVersion: '6.0'");
    expect(analyzeProject(root).packageManager).toBe("pnpm");
  });

  test("detects yarn package manager", () => {
    file("package.json", JSON.stringify({ dependencies: {} }));
    file("yarn.lock", "# yarn lockfile v1");
    expect(analyzeProject(root).packageManager).toBe("yarn");
  });

  test("detects bun package manager", () => {
    file("package.json", JSON.stringify({ dependencies: {} }));
    file("bun.lockb", "");
    expect(analyzeProject(root).packageManager).toBe("bun");
  });
});

// =============================================================================
// Confidence scoring
// =============================================================================

describe("confidence scoring", () => {
  test("full-signal project has high confidence", () => {
    file("package.json", JSON.stringify({ name: "test", dependencies: { express: "4.18", pg: "8.11" } }));
    file("tsconfig.json", "{}");
    file("src/index.ts", 'import express from "express";');
    const result = analyzeProject(root);
    // language=0.2 + framework=0.15 + deps=0.1 + entryPoint=0.05 + base=0.5 = 1.0
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  test("empty project has low confidence", () => {
    expect(analyzeProject(root).confidence).toBe(0.5);
  });

  test("language-only project has medium confidence", () => {
    file("package.json", JSON.stringify({ dependencies: {} }));
    const result = analyzeProject(root);
    // base=0.5 + lang=0.2 = 0.7 (framework = "none" so no +0.15)
    expect(result.confidence).toBeGreaterThanOrEqual(0.65);
    expect(result.confidence).toBeLessThan(0.85);
  });
});

// =============================================================================
// Entry point detection
// =============================================================================

describe("entry point detection", () => {
  test("finds explicit main in package.json", () => {
    file("package.json", JSON.stringify({ main: "dist/server.js", dependencies: {} }));
    expect(analyzeProject(root).entryPoint).toBe("dist/server.js");
  });

  test("finds src/index.ts for TypeScript project", () => {
    file("package.json", JSON.stringify({ dependencies: {} }));
    file("tsconfig.json", "{}");
    file("src/index.ts", "console.log('hello')");
    expect(analyzeProject(root).entryPoint).toBe("src/index.ts");
  });

  test("finds app.py for Python project", () => {
    file("requirements.txt", "flask==2.3.0\n");
    file("app.py", "from flask import Flask");
    expect(analyzeProject(root).entryPoint).toBe("app.py");
  });
});
