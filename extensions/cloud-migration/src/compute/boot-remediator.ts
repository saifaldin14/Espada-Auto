/**
 * Compute Pipeline — Boot Remediator
 *
 * After format conversion, VMs need driver and init-system adjustments
 * to boot on the target cloud. This module generates the remediation
 * scripts/commands for each target provider.
 */

import type { BootRemediationRecipe } from "./types.js";

// =============================================================================
// Remediation Recipes
// =============================================================================

const RECIPES: Record<string, BootRemediationRecipe> = {
  aws: {
    targetProvider: "aws",
    installPackages: [
      "cloud-init",
      "aws-cfn-bootstrap",
    ],
    removePackages: [
      "walinuxagent",
      "WALinuxAgent",
      "google-guest-agent",
      "google-compute-engine-oslogin",
    ],
    enableServices: ["cloud-init", "cloud-init-local", "cloud-config", "cloud-final"],
    disableServices: ["waagent", "google-guest-agent"],
    kernelModules: ["ena", "nvme"],
    grubFixes: [
      "sed -i 's/console=ttyS0/console=ttyS0,115200n8/' /etc/default/grub",
      "update-grub || grub2-mkconfig -o /boot/grub2/grub.cfg",
    ],
    description: "AWS EC2 boot remediation: Install cloud-init, ENA/NVMe drivers, remove Azure/GCP agents",
  },
  azure: {
    targetProvider: "azure",
    installPackages: [
      "walinuxagent",
    ],
    removePackages: [
      "cloud-init",
      "aws-cfn-bootstrap",
      "google-guest-agent",
      "google-compute-engine-oslogin",
    ],
    enableServices: ["waagent"],
    disableServices: ["cloud-init", "google-guest-agent"],
    kernelModules: ["hv_vmbus", "hv_storvsc", "hv_netvsc", "hv_utils"],
    grubFixes: [
      "sed -i 's/GRUB_CMDLINE_LINUX_DEFAULT=.*/GRUB_CMDLINE_LINUX_DEFAULT=\"console=ttyS0 earlyprintk=ttyS0 rootdelay=300\"/' /etc/default/grub",
      "update-grub || grub2-mkconfig -o /boot/grub2/grub.cfg",
    ],
    description: "Azure boot remediation: Install walinuxagent, Hyper-V drivers, remove AWS/GCP agents",
  },
  gcp: {
    targetProvider: "gcp",
    installPackages: [
      "google-guest-agent",
      "google-compute-engine-oslogin",
    ],
    removePackages: [
      "walinuxagent",
      "WALinuxAgent",
      "cloud-init",
      "aws-cfn-bootstrap",
    ],
    enableServices: ["google-guest-agent", "google-oslogin-cache"],
    disableServices: ["waagent", "cloud-init"],
    kernelModules: ["virtio_blk", "virtio_net", "virtio_scsi", "virtio_pci"],
    grubFixes: [
      "sed -i 's/GRUB_CMDLINE_LINUX_DEFAULT=.*/GRUB_CMDLINE_LINUX_DEFAULT=\"console=ttyS0\"/' /etc/default/grub",
      "update-grub || grub2-mkconfig -o /boot/grub2/grub.cfg",
    ],
    description: "GCP boot remediation: Install google-guest-agent, virtio drivers, remove AWS/Azure agents",
  },
  "on-premises": {
    targetProvider: "on-premises",
    installPackages: [
      "qemu-guest-agent",
    ],
    removePackages: [
      "walinuxagent",
      "google-guest-agent",
      "aws-cfn-bootstrap",
    ],
    enableServices: ["qemu-guest-agent"],
    disableServices: ["waagent", "google-guest-agent", "cloud-init"],
    kernelModules: ["virtio_blk", "virtio_net"],
    grubFixes: [],
    description: "On-premises boot remediation: Install qemu-guest-agent, remove all cloud agents",
  },
  vmware: {
    targetProvider: "vmware",
    installPackages: [
      "open-vm-tools",
    ],
    removePackages: [
      "walinuxagent",
      "google-guest-agent",
      "aws-cfn-bootstrap",
      "qemu-guest-agent",
    ],
    enableServices: ["vmtoolsd"],
    disableServices: ["waagent", "google-guest-agent", "cloud-init", "qemu-guest-agent"],
    kernelModules: ["vmw_pvscsi", "vmxnet3"],
    grubFixes: [],
    description: "VMware boot remediation: Install open-vm-tools, VMware drivers, remove cloud agents",
  },
};

// =============================================================================
// Public API
// =============================================================================

/**
 * Get the remediation recipe for a target provider.
 */
export function getRemediationRecipe(targetProvider: string): BootRemediationRecipe {
  const recipe = RECIPES[targetProvider];
  if (!recipe) {
    // Default: minimal recipe
    return {
      targetProvider,
      installPackages: [],
      removePackages: [],
      enableServices: [],
      disableServices: [],
      kernelModules: [],
      grubFixes: [],
      description: `No specific remediation recipe for ${targetProvider}`,
    };
  }
  return recipe;
}

/**
 * Generate a bash remediation script for Linux VMs.
 */
export function generateLinuxRemediationScript(recipe: BootRemediationRecipe): string {
  const lines: string[] = [
    "#!/bin/bash",
    `# Boot remediation for ${recipe.targetProvider}`,
    `# ${recipe.description}`,
    "set -euo pipefail",
    "",
  ];

  // Detect package manager
  lines.push(
    "if command -v apt-get &>/dev/null; then",
    "  PKG_MGR='apt-get'",
    "  PKG_INSTALL='apt-get install -y'",
    "  PKG_REMOVE='apt-get purge -y'",
    "elif command -v yum &>/dev/null; then",
    "  PKG_MGR='yum'",
    "  PKG_INSTALL='yum install -y'",
    "  PKG_REMOVE='yum remove -y'",
    "elif command -v dnf &>/dev/null; then",
    "  PKG_MGR='dnf'",
    "  PKG_INSTALL='dnf install -y'",
    "  PKG_REMOVE='dnf remove -y'",
    "fi",
    "",
  );

  // Remove packages
  if (recipe.removePackages.length > 0) {
    lines.push("# Remove incompatible packages");
    for (const pkg of recipe.removePackages) {
      lines.push(`$PKG_REMOVE ${pkg} 2>/dev/null || true`);
    }
    lines.push("");
  }

  // Install packages
  if (recipe.installPackages.length > 0) {
    lines.push("# Install required packages");
    for (const pkg of recipe.installPackages) {
      lines.push(`$PKG_INSTALL ${pkg}`);
    }
    lines.push("");
  }

  // Kernel modules
  if (recipe.kernelModules.length > 0) {
    lines.push("# Ensure kernel modules are loaded");
    for (const mod of recipe.kernelModules) {
      lines.push(`modprobe ${mod} 2>/dev/null || true`);
      lines.push(`echo "${mod}" >> /etc/modules-load.d/${recipe.targetProvider}.conf`);
    }
    lines.push("");
  }

  // Enable services
  if (recipe.enableServices.length > 0) {
    lines.push("# Enable services");
    for (const svc of recipe.enableServices) {
      lines.push(`systemctl enable ${svc} 2>/dev/null || true`);
    }
    lines.push("");
  }

  // Disable services
  if (recipe.disableServices.length > 0) {
    lines.push("# Disable incompatible services");
    for (const svc of recipe.disableServices) {
      lines.push(`systemctl disable ${svc} 2>/dev/null || true`);
    }
    lines.push("");
  }

  // GRUB fixes
  if (recipe.grubFixes.length > 0) {
    lines.push("# Fix GRUB configuration");
    for (const fix of recipe.grubFixes) {
      lines.push(fix);
    }
    lines.push("");
  }

  lines.push('echo "Boot remediation complete for ${recipe.targetProvider}"');

  return lines.join("\n");
}

/**
 * Check if remediation is needed for a migration path.
 */
export function needsRemediation(sourceProvider: string, targetProvider: string): boolean {
  return sourceProvider !== targetProvider;
}

/**
 * Get a summary of what remediation will do.
 */
export function getRemediationSummary(targetProvider: string): {
  description: string;
  installCount: number;
  removeCount: number;
  moduleCount: number;
} {
  const recipe = getRemediationRecipe(targetProvider);
  return {
    description: recipe.description,
    installCount: recipe.installPackages.length,
    removeCount: recipe.removePackages.length,
    moduleCount: recipe.kernelModules.length,
  };
}
