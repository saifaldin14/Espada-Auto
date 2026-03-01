/**
 * Terraform CLI Agent Tools — Tests
 *
 * Tests the 14 agent tools defined in cli-tools.ts.
 * All CLI wrapper functions are mocked — no real terraform binary needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the CLI wrapper module before import
vi.mock("./cli-wrapper.js", () => ({
  isTerraformInstalled: vi.fn(),
  tfInit: vi.fn(),
  tfValidate: vi.fn(),
  tfPlan: vi.fn(),
  tfPlanJson: vi.fn(),
  tfApply: vi.fn(),
  tfDestroy: vi.fn(),
  tfShow: vi.fn(),
  tfImport: vi.fn(),
  tfStateList: vi.fn(),
  tfStatePull: vi.fn(),
  tfStateRm: vi.fn(),
  tfStateMv: vi.fn(),
  tfOutput: vi.fn(),
  tfFmt: vi.fn(),
  tfVersion: vi.fn(),
}));

import { createTerraformCliTools } from "./cli-tools.js";
import {
  isTerraformInstalled,
  tfInit,
  tfValidate,
  tfPlan,
  tfPlanJson,
  tfApply,
  tfDestroy,
  tfShow,
  tfImport,
  tfStateList,
  tfStatePull,
  tfStateRm,
  tfStateMv,
  tfOutput,
  tfFmt,
  tfVersion,
} from "./cli-wrapper.js";

const mocks = {
  isTerraformInstalled: vi.mocked(isTerraformInstalled),
  tfInit: vi.mocked(tfInit),
  tfValidate: vi.mocked(tfValidate),
  tfPlan: vi.mocked(tfPlan),
  tfPlanJson: vi.mocked(tfPlanJson),
  tfApply: vi.mocked(tfApply),
  tfDestroy: vi.mocked(tfDestroy),
  tfShow: vi.mocked(tfShow),
  tfImport: vi.mocked(tfImport),
  tfStateList: vi.mocked(tfStateList),
  tfStatePull: vi.mocked(tfStatePull),
  tfStateRm: vi.mocked(tfStateRm),
  tfStateMv: vi.mocked(tfStateMv),
  tfOutput: vi.mocked(tfOutput),
  tfFmt: vi.mocked(tfFmt),
  tfVersion: vi.mocked(tfVersion),
};

function ok(stdout = ""): { success: true; stdout: string; stderr: string; exitCode: 0 } {
  return { success: true, stdout, stderr: "", exitCode: 0 };
}
function fail(stderr = "error"): { success: false; stdout: string; stderr: string; exitCode: 1 } {
  return { success: false, stdout: "", stderr, exitCode: 1 };
}

function findTool(tools: ReturnType<typeof createTerraformCliTools>, name: string) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  // Widen execute signature — union of all tool types requires intersection of params otherwise
  return tool as { name: string; description: string; inputSchema: unknown; execute: (input: any) => Promise<{ content: Array<{ type: "text"; text: string }> }> };
}

describe("Terraform CLI Agent Tools", () => {
  let tools: ReturnType<typeof createTerraformCliTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: terraform is installed
    mocks.isTerraformInstalled.mockResolvedValue({ installed: true, version: "1.6.0" });
    tools = createTerraformCliTools();
  });

  it("creates 14 tools", () => {
    expect(tools).toHaveLength(14);
    const names = tools.map((t) => t.name);
    expect(names).toContain("tf_exec_version");
    expect(names).toContain("tf_exec_init");
    expect(names).toContain("tf_exec_validate");
    expect(names).toContain("tf_exec_plan");
    expect(names).toContain("tf_exec_apply");
    expect(names).toContain("tf_exec_destroy");
    expect(names).toContain("tf_exec_show");
    expect(names).toContain("tf_exec_import");
    expect(names).toContain("tf_exec_state_list");
    expect(names).toContain("tf_exec_state_pull");
    expect(names).toContain("tf_exec_state_rm");
    expect(names).toContain("tf_exec_state_mv");
    expect(names).toContain("tf_exec_output");
    expect(names).toContain("tf_exec_fmt");
  });

  // ── tf_exec_version ────────────────────────────────────────

  describe("tf_exec_version", () => {
    it("returns terraform version", async () => {
      mocks.tfVersion.mockResolvedValue({ ...ok(), json: { terraform_version: "1.6.0" } });
      const result = await findTool(tools, "tf_exec_version").execute({});
      expect(result.content[0].text).toContain("✅ Success");
      expect(mocks.tfVersion).toHaveBeenCalled();
    });
  });

  // ── tf_exec_init ───────────────────────────────────────────

  describe("tf_exec_init", () => {
    it("runs terraform init", async () => {
      mocks.tfInit.mockResolvedValue(ok("Terraform has been successfully initialized!"));
      const result = await findTool(tools, "tf_exec_init").execute({ cwd: "/project" });
      expect(result.content[0].text).toContain("✅ Success");
      expect(mocks.tfInit).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: "/project" }),
        expect.objectContaining({}),
      );
    });

    it("passes upgrade and reconfigure flags", async () => {
      mocks.tfInit.mockResolvedValue(ok());
      await findTool(tools, "tf_exec_init").execute({
        cwd: "/project", upgrade: true, reconfigure: true, backendConfig: ["key=value"],
      });
      expect(mocks.tfInit).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: "/project" }),
        expect.objectContaining({ upgrade: true, reconfigure: true, backendConfig: ["key=value"] }),
      );
    });

    it("returns error when terraform not installed", async () => {
      mocks.isTerraformInstalled.mockResolvedValue({ installed: false });
      const result = await findTool(tools, "tf_exec_init").execute({ cwd: "/project" });
      expect(result.content[0].text).toContain("terraform binary not found");
      expect(mocks.tfInit).not.toHaveBeenCalled();
    });
  });

  // ── tf_exec_validate ───────────────────────────────────────

  describe("tf_exec_validate", () => {
    it("runs terraform validate", async () => {
      mocks.tfValidate.mockResolvedValue({
        ...ok(), json: { valid: true, warning_count: 0, error_count: 0 },
      });
      const result = await findTool(tools, "tf_exec_validate").execute({ cwd: "/project" });
      expect(result.content[0].text).toContain("✅ Success");
    });
  });

  // ── tf_exec_plan ───────────────────────────────────────────

  describe("tf_exec_plan", () => {
    it("runs terraform plan", async () => {
      mocks.tfPlan.mockResolvedValue(ok("Plan: 2 to add, 0 to change, 0 to destroy."));
      const result = await findTool(tools, "tf_exec_plan").execute({ cwd: "/project" });
      expect(result.content[0].text).toContain("Plan: 2 to add");
      expect(mocks.tfPlan).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: "/project" }),
        expect.objectContaining({}),
      );
    });

    it("passes destroy and target flags", async () => {
      mocks.tfPlan.mockResolvedValue(ok());
      await findTool(tools, "tf_exec_plan").execute({
        cwd: "/project", destroy: true, target: ["aws_instance.web"],
      });
      expect(mocks.tfPlan).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ destroy: true, target: ["aws_instance.web"] }),
      );
    });

    it("uses tfPlanJson when json flag is set", async () => {
      mocks.tfPlanJson.mockResolvedValue({ ...ok(), json: { resource_changes: [] } });
      const result = await findTool(tools, "tf_exec_plan").execute({
        cwd: "/project", json: true,
      });
      expect(result.content[0].text).toContain("terraform plan (JSON)");
      expect(mocks.tfPlanJson).toHaveBeenCalled();
      expect(mocks.tfPlan).not.toHaveBeenCalled();
    });
  });

  // ── tf_exec_apply ──────────────────────────────────────────

  describe("tf_exec_apply", () => {
    it("rejects without confirmation", async () => {
      const result = await findTool(tools, "tf_exec_apply").execute({
        cwd: "/project", confirm: "no",
      });
      expect(result.content[0].text).toContain("⛔");
      expect(result.content[0].text).toContain("destructive operation");
      expect(mocks.tfApply).not.toHaveBeenCalled();
    });

    it("rejects with empty confirmation", async () => {
      const result = await findTool(tools, "tf_exec_apply").execute({
        cwd: "/project", confirm: "",
      });
      expect(result.content[0].text).toContain("⛔");
      expect(mocks.tfApply).not.toHaveBeenCalled();
    });

    it("runs plan first then apply when confirmed", async () => {
      mocks.tfPlan.mockResolvedValue(ok("Plan: 1 to add"));
      mocks.tfApply.mockResolvedValue(ok("Apply complete! Resources: 1 added"));
      const result = await findTool(tools, "tf_exec_apply").execute({
        cwd: "/project", confirm: "yes",
      });
      expect(result.content[0].text).toContain("✅ Success");
      expect(mocks.tfPlan).toHaveBeenCalledTimes(1);
      expect(mocks.tfApply).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: "/project" }),
        expect.objectContaining({ autoApprove: true }),
      );
    });

    it("aborts apply when pre-plan fails", async () => {
      mocks.tfPlan.mockResolvedValue(fail("Error: Invalid configuration"));
      const result = await findTool(tools, "tf_exec_apply").execute({
        cwd: "/project", confirm: "yes",
      });
      expect(result.content[0].text).toContain("pre-apply check FAILED");
      expect(result.content[0].text).toContain("apply aborted");
      expect(mocks.tfApply).not.toHaveBeenCalled();
    });

    it("skips plan check when skipPlanCheck is true", async () => {
      mocks.tfApply.mockResolvedValue(ok("Apply complete!"));
      await findTool(tools, "tf_exec_apply").execute({
        cwd: "/project", confirm: "yes", skipPlanCheck: true,
      });
      expect(mocks.tfPlan).not.toHaveBeenCalled();
      expect(mocks.tfApply).toHaveBeenCalled();
    });

    it("passes target and varFile to both plan and apply", async () => {
      mocks.tfPlan.mockResolvedValue(ok());
      mocks.tfApply.mockResolvedValue(ok());
      await findTool(tools, "tf_exec_apply").execute({
        cwd: "/project", confirm: "yes",
        target: ["aws_s3_bucket.data"], varFile: "prod.tfvars",
      });
      expect(mocks.tfPlan).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ target: ["aws_s3_bucket.data"], varFile: "prod.tfvars" }),
      );
      expect(mocks.tfApply).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ target: ["aws_s3_bucket.data"], varFile: "prod.tfvars" }),
      );
    });
  });

  // ── tf_exec_destroy ────────────────────────────────────────

  describe("tf_exec_destroy", () => {
    it("rejects without confirmation", async () => {
      const result = await findTool(tools, "tf_exec_destroy").execute({
        cwd: "/project", confirm: "nope",
      });
      expect(result.content[0].text).toContain("⛔");
      expect(mocks.tfDestroy).not.toHaveBeenCalled();
    });

    it("runs destroy-plan first then destroy when confirmed", async () => {
      mocks.tfPlan.mockResolvedValue(ok("Plan: 3 to destroy"));
      mocks.tfDestroy.mockResolvedValue(ok("Destroy complete! Resources: 3 destroyed"));
      const result = await findTool(tools, "tf_exec_destroy").execute({
        cwd: "/project", confirm: "yes",
      });
      expect(result.content[0].text).toContain("✅ Success");
      expect(mocks.tfPlan).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ destroy: true }),
      );
      expect(mocks.tfDestroy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ autoApprove: true }),
      );
    });

    it("aborts destroy when pre-plan fails", async () => {
      mocks.tfPlan.mockResolvedValue(fail("Error"));
      const result = await findTool(tools, "tf_exec_destroy").execute({
        cwd: "/project", confirm: "yes",
      });
      expect(result.content[0].text).toContain("pre-destroy check FAILED");
      expect(result.content[0].text).toContain("destroy aborted");
      expect(mocks.tfDestroy).not.toHaveBeenCalled();
    });

    it("skips plan check when skipPlanCheck is true", async () => {
      mocks.tfDestroy.mockResolvedValue(ok());
      await findTool(tools, "tf_exec_destroy").execute({
        cwd: "/project", confirm: "yes", skipPlanCheck: true,
      });
      expect(mocks.tfPlan).not.toHaveBeenCalled();
      expect(mocks.tfDestroy).toHaveBeenCalled();
    });
  });

  // ── tf_exec_show ───────────────────────────────────────────

  describe("tf_exec_show", () => {
    it("runs terraform show", async () => {
      mocks.tfShow.mockResolvedValue(ok("# aws_instance.web:"));
      const result = await findTool(tools, "tf_exec_show").execute({ cwd: "/project" });
      expect(result.content[0].text).toContain("✅ Success");
      expect(mocks.tfShow).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: "/project" }),
        expect.objectContaining({}),
      );
    });

    it("passes json and planFile flags", async () => {
      mocks.tfShow.mockResolvedValue({ ...ok(), json: { values: {} } });
      await findTool(tools, "tf_exec_show").execute({
        cwd: "/project", json: true, planFile: "plan.out",
      });
      expect(mocks.tfShow).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ json: true, planFile: "plan.out" }),
      );
    });
  });

  // ── tf_exec_import ─────────────────────────────────────────

  describe("tf_exec_import", () => {
    it("rejects without confirmation", async () => {
      const result = await findTool(tools, "tf_exec_import").execute({
        cwd: "/project", address: "aws_instance.web", id: "i-123", confirm: "no",
      });
      expect(result.content[0].text).toContain("⛔");
      expect(mocks.tfImport).not.toHaveBeenCalled();
    });

    it("runs import when confirmed", async () => {
      mocks.tfImport.mockResolvedValue(ok("Import successful!"));
      const result = await findTool(tools, "tf_exec_import").execute({
        cwd: "/project", address: "aws_instance.web", id: "i-123", confirm: "yes",
      });
      expect(result.content[0].text).toContain("✅ Success");
      expect(mocks.tfImport).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: "/project" }),
        "aws_instance.web",
        "i-123",
      );
    });
  });

  // ── tf_exec_state_list ─────────────────────────────────────

  describe("tf_exec_state_list", () => {
    it("lists resources in state", async () => {
      mocks.tfStateList.mockResolvedValue(ok("aws_instance.web\naws_s3_bucket.data"));
      const result = await findTool(tools, "tf_exec_state_list").execute({ cwd: "/project" });
      expect(result.content[0].text).toContain("aws_instance.web");
      expect(result.content[0].text).toContain("aws_s3_bucket.data");
    });
  });

  // ── tf_exec_state_pull ─────────────────────────────────────

  describe("tf_exec_state_pull", () => {
    it("pulls state as JSON", async () => {
      mocks.tfStatePull.mockResolvedValue({
        ...ok(), json: { version: 4, resources: [] },
      });
      const result = await findTool(tools, "tf_exec_state_pull").execute({ cwd: "/project" });
      expect(result.content[0].text).toContain("✅ Success");
    });
  });

  // ── tf_exec_state_rm ───────────────────────────────────────

  describe("tf_exec_state_rm", () => {
    it("rejects without confirmation", async () => {
      const result = await findTool(tools, "tf_exec_state_rm").execute({
        cwd: "/project", address: "aws_instance.web", confirm: "no",
      });
      expect(result.content[0].text).toContain("⛔");
      expect(mocks.tfStateRm).not.toHaveBeenCalled();
    });

    it("removes resource from state when confirmed", async () => {
      mocks.tfStateRm.mockResolvedValue(ok("Removed aws_instance.web"));
      const result = await findTool(tools, "tf_exec_state_rm").execute({
        cwd: "/project", address: "aws_instance.web", confirm: "yes",
      });
      expect(result.content[0].text).toContain("✅ Success");
      expect(mocks.tfStateRm).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: "/project" }),
        "aws_instance.web",
      );
    });
  });

  // ── tf_exec_state_mv ───────────────────────────────────────

  describe("tf_exec_state_mv", () => {
    it("rejects without confirmation", async () => {
      const result = await findTool(tools, "tf_exec_state_mv").execute({
        cwd: "/project", source: "aws_instance.old", destination: "aws_instance.new", confirm: "no",
      });
      expect(result.content[0].text).toContain("⛔");
      expect(mocks.tfStateMv).not.toHaveBeenCalled();
    });

    it("moves resource in state when confirmed", async () => {
      mocks.tfStateMv.mockResolvedValue(ok("Move successful"));
      const result = await findTool(tools, "tf_exec_state_mv").execute({
        cwd: "/project", source: "aws_instance.old", destination: "aws_instance.new", confirm: "yes",
      });
      expect(result.content[0].text).toContain("✅ Success");
      expect(mocks.tfStateMv).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: "/project" }),
        "aws_instance.old",
        "aws_instance.new",
      );
    });
  });

  // ── tf_exec_output ─────────────────────────────────────────

  describe("tf_exec_output", () => {
    it("reads all outputs", async () => {
      mocks.tfOutput.mockResolvedValue(ok("bucket_name = my-bucket"));
      const result = await findTool(tools, "tf_exec_output").execute({ cwd: "/project" });
      expect(result.content[0].text).toContain("bucket_name");
    });

    it("reads a specific output", async () => {
      mocks.tfOutput.mockResolvedValue(ok("my-bucket"));
      const result = await findTool(tools, "tf_exec_output").execute({
        cwd: "/project", name: "bucket_name",
      });
      expect(result.content[0].text).toContain("terraform output bucket_name");
    });
  });

  // ── tf_exec_fmt ────────────────────────────────────────────

  describe("tf_exec_fmt", () => {
    it("formats files", async () => {
      mocks.tfFmt.mockResolvedValue(ok("main.tf"));
      const result = await findTool(tools, "tf_exec_fmt").execute({ cwd: "/project" });
      expect(result.content[0].text).toContain("✅ Success");
      expect(mocks.tfFmt).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: "/project" }),
        expect.objectContaining({}),
      );
    });

    it("check-only mode", async () => {
      mocks.tfFmt.mockResolvedValue(ok());
      const result = await findTool(tools, "tf_exec_fmt").execute({
        cwd: "/project", check: true, recursive: true,
      });
      expect(result.content[0].text).toContain("terraform fmt --check");
      expect(mocks.tfFmt).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ check: true, recursive: true }),
      );
    });
  });

  // ── Cross-cutting: terraform not installed ─────────────────

  describe("terraform not installed guard", () => {
    beforeEach(() => {
      mocks.isTerraformInstalled.mockResolvedValue({ installed: false });
    });

    const readOnlyTools = [
      { name: "tf_exec_init", input: { cwd: "/x" } },
      { name: "tf_exec_validate", input: { cwd: "/x" } },
      { name: "tf_exec_plan", input: { cwd: "/x" } },
      { name: "tf_exec_show", input: { cwd: "/x" } },
      { name: "tf_exec_state_list", input: { cwd: "/x" } },
      { name: "tf_exec_state_pull", input: { cwd: "/x" } },
      { name: "tf_exec_output", input: { cwd: "/x" } },
      { name: "tf_exec_fmt", input: { cwd: "/x" } },
    ];

    for (const { name, input } of readOnlyTools) {
      it(`${name} returns error when terraform not installed`, async () => {
        const result = await findTool(tools, name).execute(input as any);
        expect(result.content[0].text).toContain("terraform binary not found");
      });
    }

    it("tf_exec_apply checks terraform after confirm check", async () => {
      const result = await findTool(tools, "tf_exec_apply").execute({
        cwd: "/x", confirm: "yes",
      } as any);
      expect(result.content[0].text).toContain("terraform binary not found");
    });

    it("tf_exec_destroy checks terraform after confirm check", async () => {
      const result = await findTool(tools, "tf_exec_destroy").execute({
        cwd: "/x", confirm: "yes",
      } as any);
      expect(result.content[0].text).toContain("terraform binary not found");
    });
  });

  // ── Output truncation ─────────────────────────────────────

  describe("output truncation", () => {
    it("truncates very long stdout", async () => {
      const longOutput = "x".repeat(50_000);
      mocks.tfPlan.mockResolvedValue(ok(longOutput));
      const result = await findTool(tools, "tf_exec_plan").execute({ cwd: "/project" });
      expect(result.content[0].text.length).toBeLessThan(longOutput.length);
      expect(result.content[0].text).toContain("truncated");
    });
  });
});
