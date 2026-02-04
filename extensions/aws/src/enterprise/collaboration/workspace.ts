/**
 * Workspace & Project Manager
 *
 * Handles workspace and project CRUD operations, membership management,
 * and environment configuration.
 */

import { randomUUID } from 'node:crypto';
import type {
  Workspace,
  WorkspaceSettings,
  WorkspaceMember,
  WorkspaceRole,
  Project,
  ProjectEnvironment,
  ProjectSettings,
  CollaborationResult,
} from './types.js';

// =============================================================================
// Storage Interface
// =============================================================================

export interface WorkspaceStorage {
  // Workspaces
  createWorkspace(workspace: Workspace): Promise<void>;
  getWorkspace(workspaceId: string): Promise<Workspace | null>;
  getWorkspaceBySlug(tenantId: string, slug: string): Promise<Workspace | null>;
  listWorkspaces(tenantId: string, options?: { archived?: boolean }): Promise<Workspace[]>;
  updateWorkspace(workspaceId: string, updates: Partial<Workspace>): Promise<void>;
  deleteWorkspace(workspaceId: string): Promise<void>;
  
  // Workspace Members
  addWorkspaceMember(member: WorkspaceMember): Promise<void>;
  getWorkspaceMember(workspaceId: string, userId: string): Promise<WorkspaceMember | null>;
  listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]>;
  updateWorkspaceMember(workspaceId: string, userId: string, updates: Partial<WorkspaceMember>): Promise<void>;
  removeWorkspaceMember(workspaceId: string, userId: string): Promise<void>;
  getUserWorkspaces(tenantId: string, userId: string): Promise<Workspace[]>;
  
  // Projects
  createProject(project: Project): Promise<void>;
  getProject(projectId: string): Promise<Project | null>;
  getProjectBySlug(workspaceId: string, slug: string): Promise<Project | null>;
  listProjects(workspaceId: string, options?: { status?: string }): Promise<Project[]>;
  updateProject(projectId: string, updates: Partial<Project>): Promise<void>;
  deleteProject(projectId: string): Promise<void>;
}

// =============================================================================
// In-Memory Storage
// =============================================================================

class InMemoryWorkspaceStorage implements WorkspaceStorage {
  private workspaces = new Map<string, Workspace>();
  private members = new Map<string, WorkspaceMember[]>();
  private projects = new Map<string, Project>();

  async createWorkspace(workspace: Workspace): Promise<void> {
    this.workspaces.set(workspace.id, workspace);
    this.members.set(workspace.id, []);
  }

  async getWorkspace(workspaceId: string): Promise<Workspace | null> {
    return this.workspaces.get(workspaceId) ?? null;
  }

  async getWorkspaceBySlug(tenantId: string, slug: string): Promise<Workspace | null> {
    for (const ws of this.workspaces.values()) {
      if (ws.tenantId === tenantId && ws.slug === slug) return ws;
    }
    return null;
  }

  async listWorkspaces(tenantId: string, options?: { archived?: boolean }): Promise<Workspace[]> {
    return Array.from(this.workspaces.values()).filter(ws => {
      if (ws.tenantId !== tenantId) return false;
      if (options?.archived !== undefined && ws.archived !== options.archived) return false;
      return true;
    });
  }

  async updateWorkspace(workspaceId: string, updates: Partial<Workspace>): Promise<void> {
    const ws = this.workspaces.get(workspaceId);
    if (ws) {
      this.workspaces.set(workspaceId, { ...ws, ...updates, updatedAt: new Date().toISOString() });
    }
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    this.workspaces.delete(workspaceId);
    this.members.delete(workspaceId);
  }

  async addWorkspaceMember(member: WorkspaceMember): Promise<void> {
    const members = this.members.get(member.workspaceId) ?? [];
    members.push(member);
    this.members.set(member.workspaceId, members);
  }

  async getWorkspaceMember(workspaceId: string, userId: string): Promise<WorkspaceMember | null> {
    const members = this.members.get(workspaceId) ?? [];
    return members.find(m => m.userId === userId) ?? null;
  }

  async listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    return this.members.get(workspaceId) ?? [];
  }

  async updateWorkspaceMember(workspaceId: string, userId: string, updates: Partial<WorkspaceMember>): Promise<void> {
    const members = this.members.get(workspaceId) ?? [];
    const idx = members.findIndex(m => m.userId === userId);
    if (idx >= 0) {
      members[idx] = { ...members[idx], ...updates };
      this.members.set(workspaceId, members);
    }
  }

  async removeWorkspaceMember(workspaceId: string, userId: string): Promise<void> {
    const members = this.members.get(workspaceId) ?? [];
    this.members.set(workspaceId, members.filter(m => m.userId !== userId));
  }

  async getUserWorkspaces(tenantId: string, userId: string): Promise<Workspace[]> {
    const result: Workspace[] = [];
    for (const [wsId, members] of this.members.entries()) {
      if (members.some(m => m.userId === userId)) {
        const ws = this.workspaces.get(wsId);
        if (ws && ws.tenantId === tenantId) result.push(ws);
      }
    }
    return result;
  }

  async createProject(project: Project): Promise<void> {
    this.projects.set(project.id, project);
  }

  async getProject(projectId: string): Promise<Project | null> {
    return this.projects.get(projectId) ?? null;
  }

  async getProjectBySlug(workspaceId: string, slug: string): Promise<Project | null> {
    for (const proj of this.projects.values()) {
      if (proj.workspaceId === workspaceId && proj.slug === slug) return proj;
    }
    return null;
  }

  async listProjects(workspaceId: string, options?: { status?: string }): Promise<Project[]> {
    return Array.from(this.projects.values()).filter(p => {
      if (p.workspaceId !== workspaceId) return false;
      if (options?.status && p.status !== options.status) return false;
      return true;
    });
  }

  async updateProject(projectId: string, updates: Partial<Project>): Promise<void> {
    const proj = this.projects.get(projectId);
    if (proj) {
      this.projects.set(projectId, { ...proj, ...updates, updatedAt: new Date().toISOString() });
    }
  }

  async deleteProject(projectId: string): Promise<void> {
    this.projects.delete(projectId);
  }
}

// =============================================================================
// Workspace Manager
// =============================================================================

export interface WorkspaceManagerConfig {
  defaultSettings?: Partial<WorkspaceSettings>;
}

export class WorkspaceManager {
  private storage: WorkspaceStorage;
  private config: WorkspaceManagerConfig;

  constructor(config?: WorkspaceManagerConfig, storage?: WorkspaceStorage) {
    this.config = config ?? {};
    this.storage = storage ?? new InMemoryWorkspaceStorage();
  }

  // ===========================================================================
  // Workspace Operations
  // ===========================================================================

  async createWorkspace(
    tenantId: string,
    name: string,
    ownerId: string,
    options?: {
      description?: string;
      visibility?: Workspace['visibility'];
      settings?: Partial<WorkspaceSettings>;
    },
  ): Promise<CollaborationResult<Workspace>> {
    const slug = this.generateSlug(name);
    
    // Check slug uniqueness
    const existing = await this.storage.getWorkspaceBySlug(tenantId, slug);
    if (existing) {
      return { success: false, errors: ['Workspace with this name already exists'] };
    }

    const now = new Date().toISOString();
    const workspace: Workspace = {
      id: `ws_${randomUUID()}`,
      tenantId,
      name,
      slug,
      description: options?.description,
      ownerId,
      ownerType: 'user',
      visibility: options?.visibility ?? 'private',
      settings: this.mergeSettings(options?.settings),
      archived: false,
      createdAt: now,
      updatedAt: now,
      createdBy: ownerId,
    };

    await this.storage.createWorkspace(workspace);

    // Add owner as member
    await this.storage.addWorkspaceMember({
      id: `wm_${randomUUID()}`,
      workspaceId: workspace.id,
      userId: ownerId,
      role: 'owner',
      addedAt: now,
      addedBy: ownerId,
    });

    return { success: true, data: workspace };
  }

  async getWorkspace(workspaceId: string): Promise<CollaborationResult<Workspace>> {
    const workspace = await this.storage.getWorkspace(workspaceId);
    if (!workspace) {
      return { success: false, errors: ['Workspace not found'] };
    }
    return { success: true, data: workspace };
  }

  async listWorkspaces(
    tenantId: string,
    userId: string,
    options?: { includeArchived?: boolean },
  ): Promise<CollaborationResult<Workspace[]>> {
    const workspaces = await this.storage.getUserWorkspaces(tenantId, userId);
    const filtered = options?.includeArchived 
      ? workspaces 
      : workspaces.filter(ws => !ws.archived);
    return { success: true, data: filtered };
  }

  async updateWorkspace(
    workspaceId: string,
    updates: {
      name?: string;
      description?: string;
      visibility?: Workspace['visibility'];
      settings?: Partial<WorkspaceSettings>;
    },
  ): Promise<CollaborationResult<Workspace>> {
    const workspace = await this.storage.getWorkspace(workspaceId);
    if (!workspace) {
      return { success: false, errors: ['Workspace not found'] };
    }

    const updatedSettings = updates.settings 
      ? { ...workspace.settings, ...updates.settings }
      : workspace.settings;

    await this.storage.updateWorkspace(workspaceId, {
      name: updates.name ?? workspace.name,
      description: updates.description ?? workspace.description,
      visibility: updates.visibility ?? workspace.visibility,
      settings: updatedSettings,
    });

    const updated = await this.storage.getWorkspace(workspaceId);
    return { success: true, data: updated! };
  }

  async archiveWorkspace(workspaceId: string, userId: string): Promise<CollaborationResult> {
    const workspace = await this.storage.getWorkspace(workspaceId);
    if (!workspace) {
      return { success: false, errors: ['Workspace not found'] };
    }

    await this.storage.updateWorkspace(workspaceId, {
      archived: true,
      archivedAt: new Date().toISOString(),
      archivedBy: userId,
    });

    return { success: true, message: 'Workspace archived' };
  }

  async deleteWorkspace(workspaceId: string): Promise<CollaborationResult> {
    const workspace = await this.storage.getWorkspace(workspaceId);
    if (!workspace) {
      return { success: false, errors: ['Workspace not found'] };
    }

    // Check no active projects
    const projects = await this.storage.listProjects(workspaceId, { status: 'active' });
    if (projects.length > 0) {
      return { success: false, errors: ['Cannot delete workspace with active projects'] };
    }

    await this.storage.deleteWorkspace(workspaceId);
    return { success: true, message: 'Workspace deleted' };
  }

  // ===========================================================================
  // Member Operations
  // ===========================================================================

  async addMember(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
    addedBy: string,
  ): Promise<CollaborationResult<WorkspaceMember>> {
    const workspace = await this.storage.getWorkspace(workspaceId);
    if (!workspace) {
      return { success: false, errors: ['Workspace not found'] };
    }

    const existing = await this.storage.getWorkspaceMember(workspaceId, userId);
    if (existing) {
      return { success: false, errors: ['User is already a member'] };
    }

    const member: WorkspaceMember = {
      id: `wm_${randomUUID()}`,
      workspaceId,
      userId,
      role,
      addedAt: new Date().toISOString(),
      addedBy,
    };

    await this.storage.addWorkspaceMember(member);
    return { success: true, data: member };
  }

  async updateMemberRole(
    workspaceId: string,
    userId: string,
    newRole: WorkspaceRole,
  ): Promise<CollaborationResult<WorkspaceMember>> {
    const member = await this.storage.getWorkspaceMember(workspaceId, userId);
    if (!member) {
      return { success: false, errors: ['Member not found'] };
    }

    // Can't change owner role directly
    if (member.role === 'owner') {
      return { success: false, errors: ['Cannot change owner role. Transfer ownership instead.'] };
    }

    await this.storage.updateWorkspaceMember(workspaceId, userId, { role: newRole });
    const updated = await this.storage.getWorkspaceMember(workspaceId, userId);
    return { success: true, data: updated! };
  }

  async removeMember(workspaceId: string, userId: string): Promise<CollaborationResult> {
    const member = await this.storage.getWorkspaceMember(workspaceId, userId);
    if (!member) {
      return { success: false, errors: ['Member not found'] };
    }

    if (member.role === 'owner') {
      return { success: false, errors: ['Cannot remove owner. Transfer ownership first.'] };
    }

    await this.storage.removeWorkspaceMember(workspaceId, userId);
    return { success: true, message: 'Member removed' };
  }

  async listMembers(workspaceId: string): Promise<CollaborationResult<WorkspaceMember[]>> {
    const members = await this.storage.listWorkspaceMembers(workspaceId);
    return { success: true, data: members };
  }

  async transferOwnership(
    workspaceId: string,
    currentOwnerId: string,
    newOwnerId: string,
  ): Promise<CollaborationResult> {
    const workspace = await this.storage.getWorkspace(workspaceId);
    if (!workspace) {
      return { success: false, errors: ['Workspace not found'] };
    }

    if (workspace.ownerId !== currentOwnerId) {
      return { success: false, errors: ['Only the owner can transfer ownership'] };
    }

    const newOwnerMember = await this.storage.getWorkspaceMember(workspaceId, newOwnerId);
    if (!newOwnerMember) {
      return { success: false, errors: ['New owner must be a member of the workspace'] };
    }

    // Update workspace owner
    await this.storage.updateWorkspace(workspaceId, { ownerId: newOwnerId });
    
    // Update member roles
    await this.storage.updateWorkspaceMember(workspaceId, currentOwnerId, { role: 'admin' });
    await this.storage.updateWorkspaceMember(workspaceId, newOwnerId, { role: 'owner' });

    return { success: true, message: 'Ownership transferred' };
  }

  // ===========================================================================
  // Project Operations
  // ===========================================================================

  async createProject(
    workspaceId: string,
    name: string,
    createdBy: string,
    options?: {
      description?: string;
      settings?: Partial<ProjectSettings>;
      environments?: Partial<ProjectEnvironment>[];
      tags?: string[];
    },
  ): Promise<CollaborationResult<Project>> {
    const workspace = await this.storage.getWorkspace(workspaceId);
    if (!workspace) {
      return { success: false, errors: ['Workspace not found'] };
    }

    const slug = this.generateSlug(name);
    const existing = await this.storage.getProjectBySlug(workspaceId, slug);
    if (existing) {
      return { success: false, errors: ['Project with this name already exists'] };
    }

    const now = new Date().toISOString();
    const defaultEnvironments: ProjectEnvironment[] = options?.environments?.map((env, i) => ({
      id: `env_${randomUUID()}`,
      name: env.name ?? `environment-${i}`,
      slug: this.generateSlug(env.name ?? `environment-${i}`),
      awsRegion: env.awsRegion ?? 'us-east-1',
      requiresApproval: env.requiresApproval ?? false,
      requiredApprovers: env.requiredApprovers ?? 1,
      protectionRules: env.protectionRules ?? [],
      variables: env.variables ?? [],
      locked: false,
    })) ?? [
      {
        id: `env_${randomUUID()}`,
        name: 'development',
        slug: 'development',
        awsRegion: 'us-east-1',
        requiresApproval: false,
        requiredApprovers: 0,
        protectionRules: [],
        variables: [],
        locked: false,
      },
      {
        id: `env_${randomUUID()}`,
        name: 'staging',
        slug: 'staging',
        awsRegion: 'us-east-1',
        requiresApproval: true,
        requiredApprovers: 1,
        protectionRules: [],
        variables: [],
        locked: false,
      },
      {
        id: `env_${randomUUID()}`,
        name: 'production',
        slug: 'production',
        awsRegion: 'us-east-1',
        requiresApproval: true,
        requiredApprovers: 2,
        protectionRules: [],
        variables: [],
        locked: false,
      },
    ];

    const project: Project = {
      id: `proj_${randomUUID()}`,
      workspaceId,
      tenantId: workspace.tenantId,
      name,
      slug,
      description: options?.description,
      environments: defaultEnvironments,
      settings: {
        iacFormat: options?.settings?.iacFormat ?? 'terraform',
        autoPlanOnPR: options?.settings?.autoPlanOnPR ?? true,
        requirePlanBeforeApply: options?.settings?.requirePlanBeforeApply ?? true,
        enableCostEstimation: options?.settings?.enableCostEstimation ?? true,
        enableDriftDetection: options?.settings?.enableDriftDetection ?? false,
        notifyOnDrift: options?.settings?.notifyOnDrift ?? true,
      },
      tags: options?.tags ?? [],
      status: 'active',
      deploymentCount: 0,
      createdAt: now,
      updatedAt: now,
      createdBy,
    };

    await this.storage.createProject(project);
    return { success: true, data: project };
  }

  async getProject(projectId: string): Promise<CollaborationResult<Project>> {
    const project = await this.storage.getProject(projectId);
    if (!project) {
      return { success: false, errors: ['Project not found'] };
    }
    return { success: true, data: project };
  }

  async listProjects(
    workspaceId: string,
    options?: { status?: string },
  ): Promise<CollaborationResult<Project[]>> {
    const projects = await this.storage.listProjects(workspaceId, options);
    return { success: true, data: projects };
  }

  async updateProject(
    projectId: string,
    updates: Partial<Pick<Project, 'name' | 'description' | 'settings' | 'tags' | 'repository'>>,
  ): Promise<CollaborationResult<Project>> {
    const project = await this.storage.getProject(projectId);
    if (!project) {
      return { success: false, errors: ['Project not found'] };
    }

    await this.storage.updateProject(projectId, updates);
    const updated = await this.storage.getProject(projectId);
    return { success: true, data: updated! };
  }

  async archiveProject(projectId: string, userId: string): Promise<CollaborationResult> {
    const project = await this.storage.getProject(projectId);
    if (!project) {
      return { success: false, errors: ['Project not found'] };
    }

    await this.storage.updateProject(projectId, {
      status: 'archived',
      archivedAt: new Date().toISOString(),
      archivedBy: userId,
    });

    return { success: true, message: 'Project archived' };
  }

  // ===========================================================================
  // Environment Operations
  // ===========================================================================

  async addEnvironment(
    projectId: string,
    environment: Partial<ProjectEnvironment> & { name: string; awsRegion: string },
  ): Promise<CollaborationResult<ProjectEnvironment>> {
    const project = await this.storage.getProject(projectId);
    if (!project) {
      return { success: false, errors: ['Project not found'] };
    }

    const slug = this.generateSlug(environment.name);
    if (project.environments.some(e => e.slug === slug)) {
      return { success: false, errors: ['Environment with this name already exists'] };
    }

    const newEnv: ProjectEnvironment = {
      id: `env_${randomUUID()}`,
      name: environment.name,
      slug,
      awsRegion: environment.awsRegion,
      awsAccountId: environment.awsAccountId,
      requiresApproval: environment.requiresApproval ?? false,
      requiredApprovers: environment.requiredApprovers ?? 1,
      approverGroups: environment.approverGroups,
      protectionRules: environment.protectionRules ?? [],
      variables: environment.variables ?? [],
      locked: false,
    };

    project.environments.push(newEnv);
    await this.storage.updateProject(projectId, { environments: project.environments });

    return { success: true, data: newEnv };
  }

  async updateEnvironment(
    projectId: string,
    environmentId: string,
    updates: Partial<Omit<ProjectEnvironment, 'id'>>,
  ): Promise<CollaborationResult<ProjectEnvironment>> {
    const project = await this.storage.getProject(projectId);
    if (!project) {
      return { success: false, errors: ['Project not found'] };
    }

    const envIndex = project.environments.findIndex(e => e.id === environmentId);
    if (envIndex < 0) {
      return { success: false, errors: ['Environment not found'] };
    }

    project.environments[envIndex] = { ...project.environments[envIndex], ...updates };
    await this.storage.updateProject(projectId, { environments: project.environments });

    return { success: true, data: project.environments[envIndex] };
  }

  async lockEnvironment(
    projectId: string,
    environmentId: string,
    userId: string,
    reason?: string,
  ): Promise<CollaborationResult> {
    const project = await this.storage.getProject(projectId);
    if (!project) {
      return { success: false, errors: ['Project not found'] };
    }

    const env = project.environments.find(e => e.id === environmentId);
    if (!env) {
      return { success: false, errors: ['Environment not found'] };
    }

    env.locked = true;
    env.lockedBy = userId;
    env.lockedAt = new Date().toISOString();
    env.lockReason = reason;

    await this.storage.updateProject(projectId, { environments: project.environments });
    return { success: true, message: 'Environment locked' };
  }

  async unlockEnvironment(projectId: string, environmentId: string): Promise<CollaborationResult> {
    const project = await this.storage.getProject(projectId);
    if (!project) {
      return { success: false, errors: ['Project not found'] };
    }

    const env = project.environments.find(e => e.id === environmentId);
    if (!env) {
      return { success: false, errors: ['Environment not found'] };
    }

    env.locked = false;
    env.lockedBy = undefined;
    env.lockedAt = undefined;
    env.lockReason = undefined;

    await this.storage.updateProject(projectId, { environments: project.environments });
    return { success: true, message: 'Environment unlocked' };
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private mergeSettings(partial?: Partial<WorkspaceSettings>): WorkspaceSettings {
    const defaults: WorkspaceSettings = {
      requireApprovals: true,
      autoArchiveDays: 0,
      notifications: {
        deploymentStarted: true,
        deploymentCompleted: true,
        deploymentFailed: true,
        approvalRequired: true,
        approvalCompleted: true,
        commentAdded: true,
        memberJoined: true,
        budgetAlert: true,
      },
      integrations: {},
      ...this.config.defaultSettings,
    };

    return { ...defaults, ...partial };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createWorkspaceManager(
  config?: WorkspaceManagerConfig,
  storage?: WorkspaceStorage,
): WorkspaceManager {
  return new WorkspaceManager(config, storage);
}
