import { describe, it, expect } from "vitest";
import {
  listTemplates,
  searchTemplates,
  searchTemplatesByTags,
  getTemplate,
  applyTemplate,
  getCategories,
  INFRASTRUCTURE_CATALOG,
} from "./templates.js";

describe("Infrastructure Catalog", () => {
  it("has templates in the catalog", () => {
    expect(INFRASTRUCTURE_CATALOG.length).toBeGreaterThan(0);
  });

  it("lists all templates", () => {
    const templates = listTemplates();
    expect(templates.length).toBe(INFRASTRUCTURE_CATALOG.length);
  });

  it("lists templates by category", () => {
    const cats = getCategories();
    expect(cats.length).toBeGreaterThan(0);
    for (const cat of cats) {
      const templates = listTemplates(cat);
      expect(templates.length).toBeGreaterThan(0);
      for (const t of templates) {
        expect(t.category).toBe(cat);
      }
    }
  });

  it("gets a template by ID", () => {
    const first = INFRASTRUCTURE_CATALOG[0];
    const found = getTemplate(first.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(first.id);
    expect(found!.name).toBe(first.name);
  });

  it("returns undefined for unknown template", () => {
    const found = getTemplate("nonexistent-template-id");
    expect(found).toBeUndefined();
  });

  it("searches templates by text", () => {
    const results = searchTemplates("web");
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      const text = `${r.name} ${r.description} ${r.tags.join(" ")}`.toLowerCase();
      expect(text).toContain("web");
    }
  });

  it("returns empty for unmatched search", () => {
    const results = searchTemplates("xyznonexistent123");
    expect(results).toHaveLength(0);
  });

  it("searches templates by tags", () => {
    // Grab a tag from the first template
    const sampleTag = INFRASTRUCTURE_CATALOG[0].tags[0];
    const results = searchTemplatesByTags([sampleTag]);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.tags).toContain(sampleTag);
    }
  });

  it("gets categories", () => {
    const cats = getCategories();
    expect(cats.length).toBeGreaterThan(0);
    // All categories should be unique
    expect(new Set(cats).size).toBe(cats.length);
  });

  it("applies a template with parameters", () => {
    const first = INFRASTRUCTURE_CATALOG[0];
    const params: Record<string, unknown> = {};
    for (const p of first.requiredParameters) {
      // Use valid environment value for the environment parameter
      params[p] = p === "environment" ? "production" : `test-${p}`;
    }
    const intent = applyTemplate(first.id, params as { name: string; environment: string });
    expect(intent).toBeDefined();
    expect(intent!.name).toBeTruthy();
    expect(intent!.environment).toBeTruthy();
  });

  it("returns null for invalid environment", () => {
    const first = INFRASTRUCTURE_CATALOG[0];
    const params: Record<string, unknown> = {};
    for (const p of first.requiredParameters) {
      params[p] = `test-${p}`;
    }
    // "test-environment" is not a valid environment
    const intent = applyTemplate(first.id, params as { name: string; environment: string });
    expect(intent).toBeNull();
  });

  it("returns null when applying nonexistent template", () => {
    expect(applyTemplate("nonexistent", {} as never)).toBeNull();
  });

  it("template has required fields", () => {
    for (const t of INFRASTRUCTURE_CATALOG) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.category).toBeTruthy();
      expect(t.version).toBeTruthy();
      expect(t.intentTemplate).toBeDefined();
      expect(t.tags.length).toBeGreaterThan(0);
      expect(t.costRangeUsd.min).toBeLessThanOrEqual(t.costRangeUsd.max);
      expect(["basic", "intermediate", "advanced"]).toContain(t.complexity);
    }
  });

  it("all template IDs are unique", () => {
    const ids = INFRASTRUCTURE_CATALOG.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
