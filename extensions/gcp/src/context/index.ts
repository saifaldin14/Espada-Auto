/**
 * GCP Context Manager
 *
 * Tracks operational context across GCP operations — active project,
 * region preferences, recent operations, resource bookmarks, and
 * session state. Provides a centralized context store for the
 * conversational AI layer.
 */

// =============================================================================
// Types
// =============================================================================

export type OperationRecord = {
  id: string;
  action: string;
  resourceType: string;
  resourceName: string;
  projectId: string;
  region?: string;
  timestamp: string;
  status: "success" | "failure" | "pending";
  duration?: number;
  error?: string;
  metadata?: Record<string, unknown>;
};

export type ResourceBookmark = {
  name: string;
  resourceType: string;
  projectId: string;
  region?: string;
  alias?: string;
  createdAt: string;
  notes?: string;
};

export type ContextPreferences = {
  defaultProject: string;
  defaultRegion: string;
  defaultZone?: string;
  outputFormat: "text" | "json" | "table";
  confirmDestructive: boolean;
  maxResults: number;
  verboseErrors: boolean;
};

export type SessionState = {
  sessionId: string;
  startedAt: string;
  lastActivityAt: string;
  operationCount: number;
  activeProject: string;
  activeRegion: string;
  breadcrumbs: string[];
};

export type ContextSnapshot = {
  preferences: ContextPreferences;
  session: SessionState;
  recentOperations: OperationRecord[];
  bookmarks: ResourceBookmark[];
};

// =============================================================================
// Defaults
// =============================================================================

const DEFAULT_PREFERENCES: ContextPreferences = {
  defaultProject: "",
  defaultRegion: "us-central1",
  outputFormat: "text",
  confirmDestructive: true,
  maxResults: 50,
  verboseErrors: false,
};

// =============================================================================
// Manager
// =============================================================================

export class GcpContextManager {
  private preferences: ContextPreferences;
  private session: SessionState;
  private operations: OperationRecord[] = [];
  private bookmarks: Map<string, ResourceBookmark> = new Map();
  private maxOperationHistory: number;

  constructor(
    projectId: string,
    preferences?: Partial<ContextPreferences>,
    maxHistory?: number,
  ) {
    this.maxOperationHistory = maxHistory ?? 200;
    this.preferences = {
      ...DEFAULT_PREFERENCES,
      defaultProject: projectId,
      ...preferences,
    };
    this.session = {
      sessionId: this.generateId(),
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      operationCount: 0,
      activeProject: projectId,
      activeRegion: this.preferences.defaultRegion,
      breadcrumbs: [],
    };
  }

  // ---------------------------------------------------------------------------
  // Preferences
  // ---------------------------------------------------------------------------

  getPreferences(): ContextPreferences {
    return { ...this.preferences };
  }

  updatePreferences(updates: Partial<ContextPreferences>): void {
    Object.assign(this.preferences, updates);
    if (updates.defaultProject) {
      this.session.activeProject = updates.defaultProject;
    }
    if (updates.defaultRegion) {
      this.session.activeRegion = updates.defaultRegion;
    }
    this.touch();
  }

  // ---------------------------------------------------------------------------
  // Session
  // ---------------------------------------------------------------------------

  getSession(): SessionState {
    return { ...this.session };
  }

  setActiveProject(projectId: string): void {
    this.session.activeProject = projectId;
    this.addBreadcrumb(`Switch project → ${projectId}`);
    this.touch();
  }

  setActiveRegion(region: string): void {
    this.session.activeRegion = region;
    this.addBreadcrumb(`Switch region → ${region}`);
    this.touch();
  }

  getActiveProject(): string {
    return this.session.activeProject;
  }

  getActiveRegion(): string {
    return this.session.activeRegion;
  }

  // ---------------------------------------------------------------------------
  // Operations
  // ---------------------------------------------------------------------------

  recordOperation(op: Omit<OperationRecord, "id" | "timestamp">): OperationRecord {
    const record: OperationRecord = {
      ...op,
      id: this.generateId(),
      timestamp: new Date().toISOString(),
    };

    this.operations.push(record);
    this.session.operationCount++;
    this.addBreadcrumb(`${op.action} ${op.resourceType}/${op.resourceName}`);
    this.touch();

    if (this.operations.length > this.maxOperationHistory) {
      this.operations = this.operations.slice(-this.maxOperationHistory);
    }

    return record;
  }

  getOperations(limit?: number, filter?: { status?: string; resourceType?: string }): OperationRecord[] {
    let results = [...this.operations];
    if (filter?.status) {
      results = results.filter((op) => op.status === filter.status);
    }
    if (filter?.resourceType) {
      results = results.filter((op) => op.resourceType === filter.resourceType);
    }
    results.reverse();
    return limit ? results.slice(0, limit) : results;
  }

  getLastOperation(): OperationRecord | undefined {
    return this.operations[this.operations.length - 1];
  }

  getFailedOperations(limit?: number): OperationRecord[] {
    return this.getOperations(limit, { status: "failure" });
  }

  // ---------------------------------------------------------------------------
  // Bookmarks
  // ---------------------------------------------------------------------------

  addBookmark(bookmark: Omit<ResourceBookmark, "createdAt">): ResourceBookmark {
    const entry: ResourceBookmark = {
      ...bookmark,
      createdAt: new Date().toISOString(),
    };
    const key = bookmark.alias ?? bookmark.name;
    this.bookmarks.set(key, entry);
    this.touch();
    return entry;
  }

  removeBookmark(nameOrAlias: string): boolean {
    return this.bookmarks.delete(nameOrAlias);
  }

  getBookmark(nameOrAlias: string): ResourceBookmark | undefined {
    return this.bookmarks.get(nameOrAlias);
  }

  listBookmarks(resourceType?: string): ResourceBookmark[] {
    const all = Array.from(this.bookmarks.values());
    return resourceType ? all.filter((b) => b.resourceType === resourceType) : all;
  }

  resolveBookmark(nameOrAlias: string): string | undefined {
    const bookmark = this.bookmarks.get(nameOrAlias);
    return bookmark?.name;
  }

  // ---------------------------------------------------------------------------
  // Breadcrumbs
  // ---------------------------------------------------------------------------

  getBreadcrumbs(limit?: number): string[] {
    const crumbs = [...this.session.breadcrumbs];
    return limit ? crumbs.slice(-limit) : crumbs;
  }

  clearBreadcrumbs(): void {
    this.session.breadcrumbs = [];
  }

  // ---------------------------------------------------------------------------
  // Snapshot
  // ---------------------------------------------------------------------------

  snapshot(): ContextSnapshot {
    return {
      preferences: this.getPreferences(),
      session: this.getSession(),
      recentOperations: this.getOperations(20),
      bookmarks: this.listBookmarks(),
    };
  }

  restore(snap: ContextSnapshot): void {
    this.preferences = { ...snap.preferences };
    this.session = { ...snap.session };
    this.session.lastActivityAt = new Date().toISOString();
    for (const bm of snap.bookmarks) {
      this.bookmarks.set(bm.alias ?? bm.name, bm);
    }
    this.operations = snap.recentOperations.reverse();
  }

  // ---------------------------------------------------------------------------
  // Reset
  // ---------------------------------------------------------------------------

  reset(keepPreferences?: boolean): void {
    if (!keepPreferences) {
      this.preferences = { ...DEFAULT_PREFERENCES };
    }
    this.session = {
      sessionId: this.generateId(),
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      operationCount: 0,
      activeProject: this.preferences.defaultProject,
      activeRegion: this.preferences.defaultRegion,
      breadcrumbs: [],
    };
    this.operations = [];
    this.bookmarks.clear();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private touch(): void {
    this.session.lastActivityAt = new Date().toISOString();
  }

  private addBreadcrumb(text: string): void {
    this.session.breadcrumbs.push(text);
    if (this.session.breadcrumbs.length > 50) {
      this.session.breadcrumbs = this.session.breadcrumbs.slice(-50);
    }
  }

  private generateId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createContextManager(
  projectId: string,
  preferences?: Partial<ContextPreferences>,
  maxHistory?: number,
): GcpContextManager {
  return new GcpContextManager(projectId, preferences, maxHistory);
}
