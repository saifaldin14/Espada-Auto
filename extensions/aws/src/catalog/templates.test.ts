/**
 * Infrastructure Catalog (Templates) Tests
 *
 * Validates template data integrity, indexing, search, and application.
 */

import { describe, it, expect } from "vitest";
import {
  INFRASTRUCTURE_CATALOG,
  getTemplate,
  getTemplatesByCategory,
  searchTemplates,
  searchTemplatesByTags,
  applyTemplate,
  listTemplates,
  getCategories,
} from "./templates.js";

// =============================================================================
// Catalog data integrity
// =============================================================================

describe("INFRASTRUCTURE_CATALOG", () => {
  it("should contain at least 5 templates", () => {
    expect(INFRASTRUCTURE_CATALOG.length).toBeGreaterThanOrEqual(5);
  });

  it("should have unique IDs for every template", () => {
    const ids = INFRASTRUCTURE_CATALOG.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("each template should have required fields", () => {
    for (const t of INFRASTRUCTURE_CATALOG) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.category).toBeTruthy();
      expect(t.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(t.requiredParameters.length).toBeGreaterThan(0);
      expect(Array.isArray(t.optionalParameters)).toBe(true);
      expect(Array.isArray(t.tags)).toBe(true);
      expect(t.costRangeUsd).toHaveLength(2);
      expect(t.costRangeUsd[0]).toBeLessThanOrEqual(t.costRangeUsd[1]);
    }
  });

  it("every required parameter should have a name and type", () => {
    for (const t of INFRASTRUCTURE_CATALOG) {
      for (const param of t.requiredParameters) {
        expect(param.name).toBeTruthy();
        expect(param.type).toBeTruthy();
      }
    }
  });
});

// =============================================================================
// Index / lookup
// =============================================================================

describe("getTemplate", () => {
  it("should return a template by ID", () => {
    const t = getTemplate("three-tier-web-app");
    expect(t).toBeDefined();
    expect(t!.id).toBe("three-tier-web-app");
  });

  it("should return undefined for unknown ID", () => {
    expect(getTemplate("does-not-exist")).toBeUndefined();
  });
});

describe("getTemplatesByCategory", () => {
  it("should return templates in the web-application category", () => {
    const webApps = getTemplatesByCategory("web-application");
    expect(webApps.length).toBeGreaterThan(0);
    webApps.forEach((t) => expect(t.category).toBe("web-application"));
  });

  it("should return empty array for unknown category", () => {
    expect(getTemplatesByCategory("unknown-cat")).toHaveLength(0);
  });
});

// =============================================================================
// Search
// =============================================================================

describe("searchTemplates", () => {
  it("should find templates matching 'serverless'", () => {
    const results = searchTemplates("serverless");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((t) => t.id === "serverless-api")).toBe(true);
  });

  it("should be case-insensitive", () => {
    const upper = searchTemplates("SERVERLESS");
    const lower = searchTemplates("serverless");
    expect(upper.length).toBe(lower.length);
  });

  it("should return empty for nonsense query", () => {
    expect(searchTemplates("zzznonexistentzz")).toHaveLength(0);
  });
});

describe("searchTemplatesByTags", () => {
  it("should find templates by tag", () => {
    const results = searchTemplatesByTags(["web"]);
    expect(results.length).toBeGreaterThan(0);
  });

  it("should match multiple tags (OR logic)", () => {
    const results = searchTemplatesByTags(["serverless", "containers"]);
    expect(results.length).toBeGreaterThanOrEqual(2);
  });
});

// =============================================================================
// Template application
// =============================================================================

describe("applyTemplate", () => {
  it("should return a partial ApplicationIntent for valid params", () => {
    const result = applyTemplate("three-tier-web-app", {
      name: "my-app",
      environment: "production",
      monthlyBudget: 500,
      primaryRegion: "us-east-1",
    });
    expect(result).not.toBeNull();
    expect(result!.name).toBe("my-app");
    expect(result!.tags?.Template).toBe("three-tier-web-app");
  });

  it("should throw when required parameters are missing", () => {
    expect(() =>
      applyTemplate("three-tier-web-app", { name: "my-app" }),
    ).toThrow(/Missing required parameters/);
  });

  it("should return null for unknown template", () => {
    const result = applyTemplate("nonexistent", { name: "x" });
    expect(result).toBeNull();
  });
});

// =============================================================================
// Listing helpers
// =============================================================================

describe("listTemplates", () => {
  it("should return metadata for every template", () => {
    const list = listTemplates();
    expect(list.length).toBe(INFRASTRUCTURE_CATALOG.length);
    for (const item of list) {
      expect(item).toHaveProperty("id");
      expect(item).toHaveProperty("name");
      expect(item).toHaveProperty("description");
      expect(item).toHaveProperty("category");
      expect(item).toHaveProperty("costRange");
      expect(item).toHaveProperty("tags");
    }
  });
});

describe("getCategories", () => {
  it("should return unique categories", () => {
    const cats = getCategories();
    expect(cats.length).toBeGreaterThan(0);
    expect(new Set(cats).size).toBe(cats.length);
  });
});
