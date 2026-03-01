/**
 * Terraform — CLI Agent Tools
 *
 * 14 tools wrapping cli-wrapper.ts functions for agent execution.
 *
 * Safety guards:
 * - Destructive operations (apply, destroy, import, state rm, state mv) require
 *   a `confirm` field set to `"yes"` to proceed.
 * - `tf_exec_apply` and `tf_exec_destroy` run a plan first (dry-run) unless
 *   `skipPlanCheck` is explicitly set.
 * - All output is truncated to prevent context overflow.
 */

import { Type } from "@sinclair/typebox";
import {
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
  isTerraformInstalled,
  type TfCliOptions,
  type TfCliResult,
} from "./cli-wrapper.js";

// ─── Helpers ────────────────────────────────────────────────────

const MAX_OUTPUT_CHARS = 30_000;

/** Truncate long CLI output to stay within context limits. */
function truncate(text: string, max = MAX_OUTPUT_CHARS): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n\n… (truncated — ${text.length - max} chars omitted)`;
}

/** Build a text response from a TfCliResult. */
function formatResult(result: TfCliResult, label: string): { content: Array<{ type: "text"; text: string }> } {
  const status = result.success ? "✅ Success" : "❌ Failed";
  const parts = [`${label} — ${status} (exit ${result.exitCode})`];
  if (result.stdout) parts.push("── stdout ──\n" + truncate(result.stdout));
  if (result.stderr) parts.push("── stderr ──\n" + truncate(result.stderr));
  if (result.json) parts.push("── parsed JSON ──\n" + truncate(JSON.stringify(result.json, null, 2)));
  return { content: [{ type: "text" as const, text: parts.join("\n\n") }] };
}

/** Build TfCliOptions from common input fields. */
function buildOpts(input: { cwd: string; terraformBin?: string; timeout?: number }): TfCliOptions {
  return {
    cwd: input.cwd,
    terraformBin: input.terraformBin,
    timeout: input.timeout,
  };
}

/** Check terraform availability before running a command. */
async function ensureTerraform(bin?: string): Promise<string | null> {
  const check = await isTerraformInstalled(bin);
  if (!check.installed) return "terraform binary not found in PATH. Install Terraform first.";
  return null;
}

/** Reject destructive operations that lack confirmation. */
function requireConfirm(confirm: string | undefined, action: string): string | null {
  if (confirm !== "yes") {
    return (
      `⛔ ${action} is a destructive operation.\n` +
      `To proceed, set confirm to "yes".\n` +
      `This is a safety guard — please review the plan output before confirming.`
    );
  }
  return null;
}

// ─── Tool Definitions ───────────────────────────────────────────

export function createTerraformCliTools() {
  return [
    // ── tf_exec_version ────────────────────────────────────────
    {
      name: "tf_exec_version",
      description: "Check Terraform version and installation status.",
      inputSchema: Type.Object({
        terraformBin: Type.Optional(Type.String({ description: "Path to terraform binary (default: 'terraform')" })),
      }),
      execute: async (input: { terraformBin?: string }) => {
        const result = await tfVersion({ cwd: ".", terraformBin: input.terraformBin });
        return formatResult(result, "terraform version");
      },
    },

    // ── tf_exec_init ───────────────────────────────────────────
    {
      name: "tf_exec_init",
      description:
        "Run `terraform init` to initialize providers, modules, and backend. " +
        "Safe to run — does not modify infrastructure.",
      inputSchema: Type.Object({
        cwd: Type.String({ description: "Working directory containing .tf files" }),
        upgrade: Type.Optional(Type.Boolean({ description: "Upgrade provider versions (-upgrade)" })),
        reconfigure: Type.Optional(Type.Boolean({ description: "Reconfigure backend (-reconfigure)" })),
        backendConfig: Type.Optional(Type.Array(Type.String(), { description: "Backend config key=value pairs" })),
        terraformBin: Type.Optional(Type.String({ description: "Path to terraform binary" })),
        timeout: Type.Optional(Type.Number({ description: "Timeout in ms (default: 300000)" })),
      }),
      execute: async (input: {
        cwd: string; upgrade?: boolean; reconfigure?: boolean;
        backendConfig?: string[]; terraformBin?: string; timeout?: number;
      }) => {
        const err = await ensureTerraform(input.terraformBin);
        if (err) return { content: [{ type: "text" as const, text: err }] };
        const result = await tfInit(buildOpts(input), {
          upgrade: input.upgrade,
          reconfigure: input.reconfigure,
          backendConfig: input.backendConfig,
        });
        return formatResult(result, "terraform init");
      },
    },

    // ── tf_exec_validate ───────────────────────────────────────
    {
      name: "tf_exec_validate",
      description:
        "Run `terraform validate` to check configuration syntax. " +
        "Read-only — does not modify state or infrastructure.",
      inputSchema: Type.Object({
        cwd: Type.String({ description: "Working directory containing .tf files" }),
        terraformBin: Type.Optional(Type.String({ description: "Path to terraform binary" })),
        timeout: Type.Optional(Type.Number({ description: "Timeout in ms" })),
      }),
      execute: async (input: { cwd: string; terraformBin?: string; timeout?: number }) => {
        const err = await ensureTerraform(input.terraformBin);
        if (err) return { content: [{ type: "text" as const, text: err }] };
        const result = await tfValidate(buildOpts(input));
        return formatResult(result, "terraform validate");
      },
    },

    // ── tf_exec_plan ───────────────────────────────────────────
    {
      name: "tf_exec_plan",
      description:
        "Run `terraform plan` to preview infrastructure changes (dry-run). " +
        "Read-only — does not modify infrastructure. Use this before apply or destroy.",
      inputSchema: Type.Object({
        cwd: Type.String({ description: "Working directory containing .tf files" }),
        destroy: Type.Optional(Type.Boolean({ description: "Generate a destroy plan" })),
        target: Type.Optional(Type.Array(Type.String(), { description: "Target specific resources (e.g. 'aws_instance.web')" })),
        varFile: Type.Optional(Type.String({ description: "Path to .tfvars file" })),
        json: Type.Optional(Type.Boolean({ description: "Return plan output as parsed JSON (default: false)" })),
        terraformBin: Type.Optional(Type.String({ description: "Path to terraform binary" })),
        timeout: Type.Optional(Type.Number({ description: "Timeout in ms" })),
      }),
      execute: async (input: {
        cwd: string; destroy?: boolean; target?: string[];
        varFile?: string; json?: boolean; terraformBin?: string; timeout?: number;
      }) => {
        const err = await ensureTerraform(input.terraformBin);
        if (err) return { content: [{ type: "text" as const, text: err }] };

        if (input.json) {
          const result = await tfPlanJson(buildOpts(input), {
            destroy: input.destroy,
            target: input.target,
            varFile: input.varFile,
          });
          return formatResult(result, "terraform plan (JSON)");
        }

        const result = await tfPlan(buildOpts(input), {
          destroy: input.destroy,
          target: input.target,
          varFile: input.varFile,
        });
        return formatResult(result, "terraform plan");
      },
    },

    // ── tf_exec_apply ──────────────────────────────────────────
    {
      name: "tf_exec_apply",
      description:
        "Run `terraform apply` to create/update infrastructure. " +
        "⚠ DESTRUCTIVE — modifies real infrastructure. " +
        "Requires confirm set to \"yes\". " +
        "By default, runs a plan first and includes the plan output for review.",
      inputSchema: Type.Object({
        cwd: Type.String({ description: "Working directory containing .tf files" }),
        confirm: Type.String({ description: "Must be set to \"yes\" to proceed. Safety guard for destructive operation." }),
        target: Type.Optional(Type.Array(Type.String(), { description: "Target specific resources" })),
        varFile: Type.Optional(Type.String({ description: "Path to .tfvars file" })),
        skipPlanCheck: Type.Optional(Type.Boolean({ description: "Skip the pre-apply plan check (default: false)" })),
        terraformBin: Type.Optional(Type.String({ description: "Path to terraform binary" })),
        timeout: Type.Optional(Type.Number({ description: "Timeout in ms" })),
      }),
      execute: async (input: {
        cwd: string; confirm: string; target?: string[];
        varFile?: string; skipPlanCheck?: boolean; terraformBin?: string; timeout?: number;
      }) => {
        const guard = requireConfirm(input.confirm, "terraform apply");
        if (guard) return { content: [{ type: "text" as const, text: guard }] };

        const err = await ensureTerraform(input.terraformBin);
        if (err) return { content: [{ type: "text" as const, text: err }] };

        const opts = buildOpts(input);

        // Dry-run plan first unless skipped
        if (!input.skipPlanCheck) {
          const planResult = await tfPlan(opts, {
            target: input.target,
            varFile: input.varFile,
          });
          if (!planResult.success) {
            return formatResult(planResult, "terraform plan (pre-apply check FAILED — apply aborted)");
          }
        }

        const result = await tfApply(opts, {
          autoApprove: true,
          target: input.target,
          varFile: input.varFile,
        });
        return formatResult(result, "terraform apply");
      },
    },

    // ── tf_exec_destroy ────────────────────────────────────────
    {
      name: "tf_exec_destroy",
      description:
        "Run `terraform destroy` to tear down infrastructure. " +
        "⚠ HIGHLY DESTRUCTIVE — permanently removes resources. " +
        "Requires confirm set to \"yes\". " +
        "Runs a destroy-plan first by default.",
      inputSchema: Type.Object({
        cwd: Type.String({ description: "Working directory containing .tf files" }),
        confirm: Type.String({ description: "Must be set to \"yes\" to proceed. Safety guard for destructive operation." }),
        target: Type.Optional(Type.Array(Type.String(), { description: "Target specific resources to destroy" })),
        varFile: Type.Optional(Type.String({ description: "Path to .tfvars file" })),
        skipPlanCheck: Type.Optional(Type.Boolean({ description: "Skip the pre-destroy plan check (default: false)" })),
        terraformBin: Type.Optional(Type.String({ description: "Path to terraform binary" })),
        timeout: Type.Optional(Type.Number({ description: "Timeout in ms" })),
      }),
      execute: async (input: {
        cwd: string; confirm: string; target?: string[];
        varFile?: string; skipPlanCheck?: boolean; terraformBin?: string; timeout?: number;
      }) => {
        const guard = requireConfirm(input.confirm, "terraform destroy");
        if (guard) return { content: [{ type: "text" as const, text: guard }] };

        const err = await ensureTerraform(input.terraformBin);
        if (err) return { content: [{ type: "text" as const, text: err }] };

        const opts = buildOpts(input);

        // Dry-run destroy plan first unless skipped
        if (!input.skipPlanCheck) {
          const planResult = await tfPlan(opts, {
            destroy: true,
            target: input.target,
            varFile: input.varFile,
          });
          if (!planResult.success) {
            return formatResult(planResult, "terraform plan -destroy (pre-destroy check FAILED — destroy aborted)");
          }
        }

        const result = await tfDestroy(opts, {
          autoApprove: true,
          target: input.target,
          varFile: input.varFile,
        });
        return formatResult(result, "terraform destroy");
      },
    },

    // ── tf_exec_show ───────────────────────────────────────────
    {
      name: "tf_exec_show",
      description:
        "Run `terraform show` to inspect current state or a saved plan file. " +
        "Read-only — does not modify infrastructure.",
      inputSchema: Type.Object({
        cwd: Type.String({ description: "Working directory containing .tf files" }),
        planFile: Type.Optional(Type.String({ description: "Path to a saved plan file to inspect" })),
        json: Type.Optional(Type.Boolean({ description: "Output as JSON (default: false)" })),
        terraformBin: Type.Optional(Type.String({ description: "Path to terraform binary" })),
        timeout: Type.Optional(Type.Number({ description: "Timeout in ms" })),
      }),
      execute: async (input: {
        cwd: string; planFile?: string; json?: boolean;
        terraformBin?: string; timeout?: number;
      }) => {
        const err = await ensureTerraform(input.terraformBin);
        if (err) return { content: [{ type: "text" as const, text: err }] };
        const result = await tfShow(buildOpts(input), {
          planFile: input.planFile,
          json: input.json,
        });
        return formatResult(result, "terraform show");
      },
    },

    // ── tf_exec_import ─────────────────────────────────────────
    {
      name: "tf_exec_import",
      description:
        "Run `terraform import` to bring existing infrastructure under Terraform management. " +
        "⚠ MUTATING — modifies state file. Requires confirm set to \"yes\".",
      inputSchema: Type.Object({
        cwd: Type.String({ description: "Working directory containing .tf files" }),
        address: Type.String({ description: "Terraform resource address (e.g. 'aws_instance.web')" }),
        id: Type.String({ description: "Cloud resource ID to import (e.g. 'i-1234567890abcdef0')" }),
        confirm: Type.String({ description: "Must be set to \"yes\" to proceed." }),
        terraformBin: Type.Optional(Type.String({ description: "Path to terraform binary" })),
        timeout: Type.Optional(Type.Number({ description: "Timeout in ms" })),
      }),
      execute: async (input: {
        cwd: string; address: string; id: string; confirm: string;
        terraformBin?: string; timeout?: number;
      }) => {
        const guard = requireConfirm(input.confirm, "terraform import");
        if (guard) return { content: [{ type: "text" as const, text: guard }] };

        const err = await ensureTerraform(input.terraformBin);
        if (err) return { content: [{ type: "text" as const, text: err }] };
        const result = await tfImport(buildOpts(input), input.address, input.id);
        return formatResult(result, `terraform import ${input.address}`);
      },
    },

    // ── tf_exec_state_list ─────────────────────────────────────
    {
      name: "tf_exec_state_list",
      description:
        "Run `terraform state list` to enumerate all resources tracked in state. " +
        "Read-only — does not modify state.",
      inputSchema: Type.Object({
        cwd: Type.String({ description: "Working directory containing .tf files" }),
        terraformBin: Type.Optional(Type.String({ description: "Path to terraform binary" })),
        timeout: Type.Optional(Type.Number({ description: "Timeout in ms" })),
      }),
      execute: async (input: { cwd: string; terraformBin?: string; timeout?: number }) => {
        const err = await ensureTerraform(input.terraformBin);
        if (err) return { content: [{ type: "text" as const, text: err }] };
        const result = await tfStateList(buildOpts(input));
        return formatResult(result, "terraform state list");
      },
    },

    // ── tf_exec_state_pull ─────────────────────────────────────
    {
      name: "tf_exec_state_pull",
      description:
        "Run `terraform state pull` to retrieve the full state as JSON. " +
        "Read-only — does not modify state.",
      inputSchema: Type.Object({
        cwd: Type.String({ description: "Working directory containing .tf files" }),
        terraformBin: Type.Optional(Type.String({ description: "Path to terraform binary" })),
        timeout: Type.Optional(Type.Number({ description: "Timeout in ms" })),
      }),
      execute: async (input: { cwd: string; terraformBin?: string; timeout?: number }) => {
        const err = await ensureTerraform(input.terraformBin);
        if (err) return { content: [{ type: "text" as const, text: err }] };
        const result = await tfStatePull(buildOpts(input));
        return formatResult(result, "terraform state pull");
      },
    },

    // ── tf_exec_state_rm ───────────────────────────────────────
    {
      name: "tf_exec_state_rm",
      description:
        "Run `terraform state rm` to remove a resource from state WITHOUT destroying it. " +
        "⚠ DESTRUCTIVE — modifies state file. Requires confirm set to \"yes\".",
      inputSchema: Type.Object({
        cwd: Type.String({ description: "Working directory containing .tf files" }),
        address: Type.String({ description: "Resource address to remove (e.g. 'aws_instance.web')" }),
        confirm: Type.String({ description: "Must be set to \"yes\" to proceed." }),
        terraformBin: Type.Optional(Type.String({ description: "Path to terraform binary" })),
        timeout: Type.Optional(Type.Number({ description: "Timeout in ms" })),
      }),
      execute: async (input: {
        cwd: string; address: string; confirm: string;
        terraformBin?: string; timeout?: number;
      }) => {
        const guard = requireConfirm(input.confirm, "terraform state rm");
        if (guard) return { content: [{ type: "text" as const, text: guard }] };

        const err = await ensureTerraform(input.terraformBin);
        if (err) return { content: [{ type: "text" as const, text: err }] };
        const result = await tfStateRm(buildOpts(input), input.address);
        return formatResult(result, `terraform state rm ${input.address}`);
      },
    },

    // ── tf_exec_state_mv ───────────────────────────────────────
    {
      name: "tf_exec_state_mv",
      description:
        "Run `terraform state mv` to move/rename a resource in state. " +
        "⚠ MUTATING — modifies state file. Requires confirm set to \"yes\".",
      inputSchema: Type.Object({
        cwd: Type.String({ description: "Working directory containing .tf files" }),
        source: Type.String({ description: "Source resource address" }),
        destination: Type.String({ description: "Destination resource address" }),
        confirm: Type.String({ description: "Must be set to \"yes\" to proceed." }),
        terraformBin: Type.Optional(Type.String({ description: "Path to terraform binary" })),
        timeout: Type.Optional(Type.Number({ description: "Timeout in ms" })),
      }),
      execute: async (input: {
        cwd: string; source: string; destination: string; confirm: string;
        terraformBin?: string; timeout?: number;
      }) => {
        const guard = requireConfirm(input.confirm, "terraform state mv");
        if (guard) return { content: [{ type: "text" as const, text: guard }] };

        const err = await ensureTerraform(input.terraformBin);
        if (err) return { content: [{ type: "text" as const, text: err }] };
        const result = await tfStateMv(buildOpts(input), input.source, input.destination);
        return formatResult(result, `terraform state mv ${input.source} → ${input.destination}`);
      },
    },

    // ── tf_exec_output ─────────────────────────────────────────
    {
      name: "tf_exec_output",
      description:
        "Run `terraform output` to read output values from state. " +
        "Read-only — does not modify state.",
      inputSchema: Type.Object({
        cwd: Type.String({ description: "Working directory containing .tf files" }),
        name: Type.Optional(Type.String({ description: "Specific output name to read" })),
        json: Type.Optional(Type.Boolean({ description: "Return output as JSON (default: false)" })),
        terraformBin: Type.Optional(Type.String({ description: "Path to terraform binary" })),
        timeout: Type.Optional(Type.Number({ description: "Timeout in ms" })),
      }),
      execute: async (input: {
        cwd: string; name?: string; json?: boolean;
        terraformBin?: string; timeout?: number;
      }) => {
        const err = await ensureTerraform(input.terraformBin);
        if (err) return { content: [{ type: "text" as const, text: err }] };
        const result = await tfOutput(buildOpts(input), {
          json: input.json,
          name: input.name,
        });
        return formatResult(result, input.name ? `terraform output ${input.name}` : "terraform output");
      },
    },

    // ── tf_exec_fmt ────────────────────────────────────────────
    {
      name: "tf_exec_fmt",
      description:
        "Run `terraform fmt` to format .tf files to canonical style. " +
        "Modifies files in-place unless --check is used.",
      inputSchema: Type.Object({
        cwd: Type.String({ description: "Working directory containing .tf files" }),
        check: Type.Optional(Type.Boolean({ description: "Check only, don't modify files (default: false)" })),
        recursive: Type.Optional(Type.Boolean({ description: "Format recursively (default: false)" })),
        terraformBin: Type.Optional(Type.String({ description: "Path to terraform binary" })),
        timeout: Type.Optional(Type.Number({ description: "Timeout in ms" })),
      }),
      execute: async (input: {
        cwd: string; check?: boolean; recursive?: boolean;
        terraformBin?: string; timeout?: number;
      }) => {
        const err = await ensureTerraform(input.terraformBin);
        if (err) return { content: [{ type: "text" as const, text: err }] };
        const result = await tfFmt(buildOpts(input), {
          check: input.check,
          recursive: input.recursive,
        });
        return formatResult(result, input.check ? "terraform fmt --check" : "terraform fmt");
      },
    },
  ];
}
