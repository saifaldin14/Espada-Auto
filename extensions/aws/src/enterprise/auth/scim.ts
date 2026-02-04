/**
 * SCIM 2.0 Service
 * 
 * Implements SCIM (System for Cross-domain Identity Management) protocol
 * for automated user provisioning and deprovisioning.
 * 
 * Supports:
 * - User CRUD operations
 * - Group CRUD operations
 * - Bulk operations
 * - Filtering and pagination
 * - Schema discovery
 */

import { randomUUID } from 'node:crypto';

// =============================================================================
// SCIM Constants
// =============================================================================

const SCIM_SCHEMAS = {
  user: 'urn:ietf:params:scim:schemas:core:2.0:User',
  group: 'urn:ietf:params:scim:schemas:core:2.0:Group',
  enterprise: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
  error: 'urn:ietf:params:scim:api:messages:2.0:Error',
  listResponse: 'urn:ietf:params:scim:api:messages:2.0:ListResponse',
  bulkRequest: 'urn:ietf:params:scim:api:messages:2.0:BulkRequest',
  bulkResponse: 'urn:ietf:params:scim:api:messages:2.0:BulkResponse',
  patchOp: 'urn:ietf:params:scim:api:messages:2.0:PatchOp',
  serviceProviderConfig: 'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig',
  resourceType: 'urn:ietf:params:scim:schemas:core:2.0:ResourceType',
  schema: 'urn:ietf:params:scim:schemas:core:2.0:Schema',
};

const SCIM_ERROR_TYPES = {
  invalidValue: 'invalidValue',
  uniqueness: 'uniqueness',
  mutability: 'mutability',
  invalidSyntax: 'invalidSyntax',
  invalidPath: 'invalidPath',
  noTarget: 'noTarget',
  invalidFilter: 'invalidFilter',
  tooMany: 'tooMany',
  sensitive: 'sensitive',
};

// =============================================================================
// SCIM Types
// =============================================================================

export interface SCIMUser {
  schemas: string[];
  id: string;
  externalId?: string;
  userName: string;
  name?: {
    formatted?: string;
    familyName?: string;
    givenName?: string;
    middleName?: string;
    honorificPrefix?: string;
    honorificSuffix?: string;
  };
  displayName?: string;
  nickName?: string;
  profileUrl?: string;
  title?: string;
  userType?: string;
  preferredLanguage?: string;
  locale?: string;
  timezone?: string;
  active: boolean;
  emails?: SCIMMultiValuedAttribute[];
  phoneNumbers?: SCIMMultiValuedAttribute[];
  ims?: SCIMMultiValuedAttribute[];
  photos?: SCIMMultiValuedAttribute[];
  addresses?: SCIMAddress[];
  groups?: SCIMGroupMembership[];
  entitlements?: SCIMMultiValuedAttribute[];
  roles?: SCIMMultiValuedAttribute[];
  x509Certificates?: SCIMMultiValuedAttribute[];
  
  // Enterprise extension
  'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'?: SCIMEnterpriseUser;
  
  meta: SCIMMeta;
}

export interface SCIMGroup {
  schemas: string[];
  id: string;
  externalId?: string;
  displayName: string;
  members?: SCIMGroupMember[];
  meta: SCIMMeta;
}

export interface SCIMMultiValuedAttribute {
  value: string;
  display?: string;
  type?: string;
  primary?: boolean;
}

export interface SCIMAddress {
  formatted?: string;
  streetAddress?: string;
  locality?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  type?: string;
  primary?: boolean;
}

export interface SCIMGroupMembership {
  value: string;
  $ref?: string;
  display?: string;
  type?: 'direct' | 'indirect';
}

export interface SCIMGroupMember {
  value: string;
  $ref?: string;
  display?: string;
  type?: 'User' | 'Group';
}

export interface SCIMEnterpriseUser {
  employeeNumber?: string;
  costCenter?: string;
  organization?: string;
  division?: string;
  department?: string;
  manager?: {
    value?: string;
    $ref?: string;
    displayName?: string;
  };
}

export interface SCIMMeta {
  resourceType: 'User' | 'Group';
  created: string;
  lastModified: string;
  location: string;
  version?: string;
}

export interface SCIMListResponse<T> {
  schemas: string[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
}

export interface SCIMError {
  schemas: string[];
  status: string;
  scimType?: string;
  detail?: string;
}

export interface SCIMPatchOperation {
  op: 'add' | 'remove' | 'replace';
  path?: string;
  value?: unknown;
}

export interface SCIMPatchRequest {
  schemas: string[];
  Operations: SCIMPatchOperation[];
}

export interface SCIMBulkOperation {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  bulkId?: string;
  data?: unknown;
}

export interface SCIMBulkRequest {
  schemas: string[];
  Operations: SCIMBulkOperation[];
}

export interface SCIMBulkResponse {
  schemas: string[];
  Operations: {
    method: string;
    bulkId?: string;
    location?: string;
    response?: unknown;
    status: string;
  }[];
}

// =============================================================================
// SCIM Filter Types
// =============================================================================

export interface SCIMFilter {
  attribute: string;
  operator: 'eq' | 'ne' | 'co' | 'sw' | 'ew' | 'pr' | 'gt' | 'ge' | 'lt' | 'le';
  value?: string | boolean | number;
}

export interface SCIMQuery {
  filter?: string;
  sortBy?: string;
  sortOrder?: 'ascending' | 'descending';
  startIndex?: number;
  count?: number;
  attributes?: string[];
  excludedAttributes?: string[];
}

// =============================================================================
// SCIM Storage Interface
// =============================================================================

export interface SCIMStorage {
  // Users
  createUser(tenantId: string, user: Omit<SCIMUser, 'id' | 'meta'>): Promise<SCIMUser>;
  getUser(tenantId: string, userId: string): Promise<SCIMUser | null>;
  getUserByUserName(tenantId: string, userName: string): Promise<SCIMUser | null>;
  getUserByExternalId(tenantId: string, externalId: string): Promise<SCIMUser | null>;
  listUsers(tenantId: string, query: SCIMQuery): Promise<{ users: SCIMUser[]; totalCount: number }>;
  updateUser(tenantId: string, userId: string, user: Partial<SCIMUser>): Promise<SCIMUser | null>;
  deleteUser(tenantId: string, userId: string): Promise<boolean>;
  
  // Groups
  createGroup(tenantId: string, group: Omit<SCIMGroup, 'id' | 'meta'>): Promise<SCIMGroup>;
  getGroup(tenantId: string, groupId: string): Promise<SCIMGroup | null>;
  getGroupByDisplayName(tenantId: string, displayName: string): Promise<SCIMGroup | null>;
  listGroups(tenantId: string, query: SCIMQuery): Promise<{ groups: SCIMGroup[]; totalCount: number }>;
  updateGroup(tenantId: string, groupId: string, group: Partial<SCIMGroup>): Promise<SCIMGroup | null>;
  deleteGroup(tenantId: string, groupId: string): Promise<boolean>;
  
  // Group Membership
  addUserToGroup(tenantId: string, groupId: string, userId: string): Promise<void>;
  removeUserFromGroup(tenantId: string, groupId: string, userId: string): Promise<void>;
  getUserGroups(tenantId: string, userId: string): Promise<SCIMGroup[]>;
}

// =============================================================================
// In-Memory SCIM Storage (for development/testing)
// =============================================================================

class InMemorySCIMStorage implements SCIMStorage {
  private users = new Map<string, Map<string, SCIMUser>>(); // tenantId -> (userId -> user)
  private groups = new Map<string, Map<string, SCIMGroup>>(); // tenantId -> (groupId -> group)
  private baseUrl = 'https://api.example.com/scim/v2';

  private getTenantUsers(tenantId: string): Map<string, SCIMUser> {
    if (!this.users.has(tenantId)) {
      this.users.set(tenantId, new Map());
    }
    return this.users.get(tenantId)!;
  }

  private getTenantGroups(tenantId: string): Map<string, SCIMGroup> {
    if (!this.groups.has(tenantId)) {
      this.groups.set(tenantId, new Map());
    }
    return this.groups.get(tenantId)!;
  }

  async createUser(tenantId: string, user: Omit<SCIMUser, 'id' | 'meta'>): Promise<SCIMUser> {
    const id = `user_${randomUUID()}`;
    const now = new Date().toISOString();
    
    const scimUser: SCIMUser = {
      ...user,
      id,
      meta: {
        resourceType: 'User',
        created: now,
        lastModified: now,
        location: `${this.baseUrl}/Users/${id}`,
      },
    };
    
    this.getTenantUsers(tenantId).set(id, scimUser);
    return scimUser;
  }

  async getUser(tenantId: string, userId: string): Promise<SCIMUser | null> {
    return this.getTenantUsers(tenantId).get(userId) ?? null;
  }

  async getUserByUserName(tenantId: string, userName: string): Promise<SCIMUser | null> {
    for (const user of this.getTenantUsers(tenantId).values()) {
      if (user.userName === userName) return user;
    }
    return null;
  }

  async getUserByExternalId(tenantId: string, externalId: string): Promise<SCIMUser | null> {
    for (const user of this.getTenantUsers(tenantId).values()) {
      if (user.externalId === externalId) return user;
    }
    return null;
  }

  async listUsers(tenantId: string, query: SCIMQuery): Promise<{ users: SCIMUser[]; totalCount: number }> {
    let users = Array.from(this.getTenantUsers(tenantId).values());
    
    // Apply filter (simplified)
    if (query.filter) {
      const parsed = this.parseSimpleFilter(query.filter);
      if (parsed) {
        users = users.filter(u => this.matchesFilter(u as unknown as Record<string, unknown>, parsed));
      }
    }
    
    const totalCount = users.length;
    
    // Apply sorting
    if (query.sortBy) {
      users.sort((a, b) => {
        const aVal = this.getNestedValue(a as unknown as Record<string, unknown>, query.sortBy!) ?? '';
        const bVal = this.getNestedValue(b as unknown as Record<string, unknown>, query.sortBy!) ?? '';
        const cmp = String(aVal).localeCompare(String(bVal));
        return query.sortOrder === 'descending' ? -cmp : cmp;
      });
    }
    
    // Apply pagination
    const startIndex = Math.max(1, query.startIndex ?? 1);
    const count = Math.min(100, query.count ?? 100);
    users = users.slice(startIndex - 1, startIndex - 1 + count);
    
    return { users, totalCount };
  }

  async updateUser(tenantId: string, userId: string, updates: Partial<SCIMUser>): Promise<SCIMUser | null> {
    const existing = this.getTenantUsers(tenantId).get(userId);
    if (!existing) return null;
    
    const updated: SCIMUser = {
      ...existing,
      ...updates,
      id: existing.id,
      meta: {
        ...existing.meta,
        lastModified: new Date().toISOString(),
      },
    };
    
    this.getTenantUsers(tenantId).set(userId, updated);
    return updated;
  }

  async deleteUser(tenantId: string, userId: string): Promise<boolean> {
    return this.getTenantUsers(tenantId).delete(userId);
  }

  async createGroup(tenantId: string, group: Omit<SCIMGroup, 'id' | 'meta'>): Promise<SCIMGroup> {
    const id = `group_${randomUUID()}`;
    const now = new Date().toISOString();
    
    const scimGroup: SCIMGroup = {
      ...group,
      id,
      meta: {
        resourceType: 'Group',
        created: now,
        lastModified: now,
        location: `${this.baseUrl}/Groups/${id}`,
      },
    };
    
    this.getTenantGroups(tenantId).set(id, scimGroup);
    return scimGroup;
  }

  async getGroup(tenantId: string, groupId: string): Promise<SCIMGroup | null> {
    return this.getTenantGroups(tenantId).get(groupId) ?? null;
  }

  async getGroupByDisplayName(tenantId: string, displayName: string): Promise<SCIMGroup | null> {
    for (const group of this.getTenantGroups(tenantId).values()) {
      if (group.displayName === displayName) return group;
    }
    return null;
  }

  async listGroups(tenantId: string, query: SCIMQuery): Promise<{ groups: SCIMGroup[]; totalCount: number }> {
    let groups = Array.from(this.getTenantGroups(tenantId).values());
    
    if (query.filter) {
      const parsed = this.parseSimpleFilter(query.filter);
      if (parsed) {
        groups = groups.filter(g => this.matchesFilter(g as unknown as Record<string, unknown>, parsed));
      }
    }
    
    const totalCount = groups.length;
    
    if (query.sortBy) {
      groups.sort((a, b) => {
        const aVal = this.getNestedValue(a as unknown as Record<string, unknown>, query.sortBy!) ?? '';
        const bVal = this.getNestedValue(b as unknown as Record<string, unknown>, query.sortBy!) ?? '';
        const cmp = String(aVal).localeCompare(String(bVal));
        return query.sortOrder === 'descending' ? -cmp : cmp;
      });
    }
    
    const startIndex = Math.max(1, query.startIndex ?? 1);
    const count = Math.min(100, query.count ?? 100);
    groups = groups.slice(startIndex - 1, startIndex - 1 + count);
    
    return { groups, totalCount };
  }

  async updateGroup(tenantId: string, groupId: string, updates: Partial<SCIMGroup>): Promise<SCIMGroup | null> {
    const existing = this.getTenantGroups(tenantId).get(groupId);
    if (!existing) return null;
    
    const updated: SCIMGroup = {
      ...existing,
      ...updates,
      id: existing.id,
      meta: {
        ...existing.meta,
        lastModified: new Date().toISOString(),
      },
    };
    
    this.getTenantGroups(tenantId).set(groupId, updated);
    return updated;
  }

  async deleteGroup(tenantId: string, groupId: string): Promise<boolean> {
    return this.getTenantGroups(tenantId).delete(groupId);
  }

  async addUserToGroup(tenantId: string, groupId: string, userId: string): Promise<void> {
    const group = this.getTenantGroups(tenantId).get(groupId);
    const user = this.getTenantUsers(tenantId).get(userId);
    if (!group || !user) return;
    
    if (!group.members) group.members = [];
    if (!group.members.find(m => m.value === userId)) {
      group.members.push({
        value: userId,
        $ref: `${this.baseUrl}/Users/${userId}`,
        display: user.displayName ?? user.userName,
        type: 'User',
      });
    }
    
    if (!user.groups) user.groups = [];
    if (!user.groups.find(g => g.value === groupId)) {
      user.groups.push({
        value: groupId,
        $ref: `${this.baseUrl}/Groups/${groupId}`,
        display: group.displayName,
        type: 'direct',
      });
    }
  }

  async removeUserFromGroup(tenantId: string, groupId: string, userId: string): Promise<void> {
    const group = this.getTenantGroups(tenantId).get(groupId);
    const user = this.getTenantUsers(tenantId).get(userId);
    
    if (group?.members) {
      group.members = group.members.filter(m => m.value !== userId);
    }
    
    if (user?.groups) {
      user.groups = user.groups.filter(g => g.value !== groupId);
    }
  }

  async getUserGroups(tenantId: string, userId: string): Promise<SCIMGroup[]> {
    const user = this.getTenantUsers(tenantId).get(userId);
    if (!user?.groups) return [];
    
    const groups: SCIMGroup[] = [];
    for (const membership of user.groups) {
      const group = this.getTenantGroups(tenantId).get(membership.value);
      if (group) groups.push(group);
    }
    return groups;
  }

  private parseSimpleFilter(filter: string): SCIMFilter | null {
    // Simple filter parsing: "attribute op value"
    const match = filter.match(/^(\w+(?:\.\w+)*)\s+(eq|ne|co|sw|ew|pr|gt|ge|lt|le)\s*"?([^"]*)"?$/i);
    if (!match) return null;
    
    return {
      attribute: match[1],
      operator: match[2].toLowerCase() as SCIMFilter['operator'],
      value: match[3] || undefined,
    };
  }

  private matchesFilter(resource: Record<string, unknown>, filter: SCIMFilter): boolean {
    const value = this.getNestedValue(resource, filter.attribute);
    const filterValue = filter.value;
    
    switch (filter.operator) {
      case 'eq': return String(value) === String(filterValue);
      case 'ne': return String(value) !== String(filterValue);
      case 'co': return String(value).includes(String(filterValue));
      case 'sw': return String(value).startsWith(String(filterValue));
      case 'ew': return String(value).endsWith(String(filterValue));
      case 'pr': return value !== undefined && value !== null;
      case 'gt': return Number(value) > Number(filterValue);
      case 'ge': return Number(value) >= Number(filterValue);
      case 'lt': return Number(value) < Number(filterValue);
      case 'le': return Number(value) <= Number(filterValue);
      default: return false;
    }
  }

  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
  }
}

// =============================================================================
// SCIM Result Type
// =============================================================================

interface SCIMResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: SCIMError;
  statusCode?: number;
}

// =============================================================================
// SCIM Service Configuration
// =============================================================================

export interface SCIMServiceConfig {
  baseUrl: string;
  maxPageSize: number; // default: 100
  supportedFilters: string[]; // e.g., ['userName', 'email', 'displayName']
  supportsBulk: boolean;
  supportsPatch: boolean;
  supportsChangePassword: boolean;
  supportsSort: boolean;
  supportsETag: boolean;
  authenticationSchemes: ('oauth' | 'bearer')[];
}

// =============================================================================
// SCIM Service Implementation
// =============================================================================

export class SCIMService {
  private config: SCIMServiceConfig;
  private storage: SCIMStorage;

  constructor(config: Partial<SCIMServiceConfig> & Pick<SCIMServiceConfig, 'baseUrl'>, storage?: SCIMStorage) {
    this.config = {
      maxPageSize: 100,
      supportedFilters: ['userName', 'email', 'displayName', 'externalId', 'active'],
      supportsBulk: true,
      supportsPatch: true,
      supportsChangePassword: false,
      supportsSort: true,
      supportsETag: false,
      authenticationSchemes: ['bearer'],
      ...config,
    };
    this.storage = storage ?? new InMemorySCIMStorage();
  }

  // ===========================================================================
  // User Operations
  // ===========================================================================

  /**
   * Create a new user
   */
  async createUser(tenantId: string, user: Partial<SCIMUser>): Promise<SCIMResult<SCIMUser>> {
    try {
      // Validate required fields
      if (!user.userName) {
        return this.errorResponse(400, SCIM_ERROR_TYPES.invalidValue, 'userName is required');
      }

      // Check uniqueness
      const existing = await this.storage.getUserByUserName(tenantId, user.userName);
      if (existing) {
        return this.errorResponse(409, SCIM_ERROR_TYPES.uniqueness, 'userName already exists');
      }

      if (user.externalId) {
        const existingByExtId = await this.storage.getUserByExternalId(tenantId, user.externalId);
        if (existingByExtId) {
          return this.errorResponse(409, SCIM_ERROR_TYPES.uniqueness, 'externalId already exists');
        }
      }

      const schemas = [SCIM_SCHEMAS.user];
      if (user['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User']) {
        schemas.push(SCIM_SCHEMAS.enterprise);
      }

      const newUser = await this.storage.createUser(tenantId, {
        schemas,
        userName: user.userName,
        name: user.name,
        displayName: user.displayName,
        nickName: user.nickName,
        profileUrl: user.profileUrl,
        title: user.title,
        userType: user.userType,
        preferredLanguage: user.preferredLanguage,
        locale: user.locale,
        timezone: user.timezone,
        active: user.active ?? true,
        emails: user.emails,
        phoneNumbers: user.phoneNumbers,
        addresses: user.addresses,
        externalId: user.externalId,
        'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': user['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'],
      } as Omit<SCIMUser, 'id' | 'meta'>);

      return { success: true, data: newUser, statusCode: 201 };
    } catch (error) {
      return this.errorResponse(500, undefined, error instanceof Error ? error.message : 'Internal error');
    }
  }

  /**
   * Get a user by ID
   */
  async getUser(tenantId: string, userId: string): Promise<SCIMResult<SCIMUser>> {
    try {
      const user = await this.storage.getUser(tenantId, userId);
      if (!user) {
        return this.errorResponse(404, SCIM_ERROR_TYPES.noTarget, 'User not found');
      }
      return { success: true, data: user, statusCode: 200 };
    } catch (error) {
      return this.errorResponse(500, undefined, error instanceof Error ? error.message : 'Internal error');
    }
  }

  /**
   * List users with filtering and pagination
   */
  async listUsers(tenantId: string, query: SCIMQuery): Promise<SCIMResult<SCIMListResponse<SCIMUser>>> {
    try {
      const { users, totalCount } = await this.storage.listUsers(tenantId, {
        ...query,
        count: Math.min(query.count ?? this.config.maxPageSize, this.config.maxPageSize),
      });

      const response: SCIMListResponse<SCIMUser> = {
        schemas: [SCIM_SCHEMAS.listResponse],
        totalResults: totalCount,
        startIndex: query.startIndex ?? 1,
        itemsPerPage: users.length,
        Resources: users,
      };

      return { success: true, data: response, statusCode: 200 };
    } catch (error) {
      return this.errorResponse(500, undefined, error instanceof Error ? error.message : 'Internal error');
    }
  }

  /**
   * Update a user (PUT - full replace)
   */
  async updateUser(tenantId: string, userId: string, user: Partial<SCIMUser>): Promise<SCIMResult<SCIMUser>> {
    try {
      const existing = await this.storage.getUser(tenantId, userId);
      if (!existing) {
        return this.errorResponse(404, SCIM_ERROR_TYPES.noTarget, 'User not found');
      }

      // Check userName uniqueness if changed
      if (user.userName && user.userName !== existing.userName) {
        const byUsername = await this.storage.getUserByUserName(tenantId, user.userName);
        if (byUsername && byUsername.id !== userId) {
          return this.errorResponse(409, SCIM_ERROR_TYPES.uniqueness, 'userName already exists');
        }
      }

      const updated = await this.storage.updateUser(tenantId, userId, user);
      if (!updated) {
        return this.errorResponse(404, SCIM_ERROR_TYPES.noTarget, 'User not found');
      }

      return { success: true, data: updated, statusCode: 200 };
    } catch (error) {
      return this.errorResponse(500, undefined, error instanceof Error ? error.message : 'Internal error');
    }
  }

  /**
   * Patch a user (partial update)
   */
  async patchUser(tenantId: string, userId: string, patch: SCIMPatchRequest): Promise<SCIMResult<SCIMUser>> {
    if (!this.config.supportsPatch) {
      return this.errorResponse(501, undefined, 'PATCH not supported');
    }

    try {
      const existing = await this.storage.getUser(tenantId, userId);
      if (!existing) {
        return this.errorResponse(404, SCIM_ERROR_TYPES.noTarget, 'User not found');
      }

      const updates: Partial<SCIMUser> = {};

      for (const op of patch.Operations) {
        this.applyPatchOperation(existing, updates, op);
      }

      const updated = await this.storage.updateUser(tenantId, userId, updates);
      if (!updated) {
        return this.errorResponse(404, SCIM_ERROR_TYPES.noTarget, 'User not found');
      }

      return { success: true, data: updated, statusCode: 200 };
    } catch (error) {
      return this.errorResponse(500, undefined, error instanceof Error ? error.message : 'Internal error');
    }
  }

  /**
   * Delete a user
   */
  async deleteUser(tenantId: string, userId: string): Promise<SCIMResult> {
    try {
      const deleted = await this.storage.deleteUser(tenantId, userId);
      if (!deleted) {
        return this.errorResponse(404, SCIM_ERROR_TYPES.noTarget, 'User not found');
      }
      return { success: true, statusCode: 204 };
    } catch (error) {
      return this.errorResponse(500, undefined, error instanceof Error ? error.message : 'Internal error');
    }
  }

  // ===========================================================================
  // Group Operations
  // ===========================================================================

  /**
   * Create a new group
   */
  async createGroup(tenantId: string, group: Partial<SCIMGroup>): Promise<SCIMResult<SCIMGroup>> {
    try {
      if (!group.displayName) {
        return this.errorResponse(400, SCIM_ERROR_TYPES.invalidValue, 'displayName is required');
      }

      const existing = await this.storage.getGroupByDisplayName(tenantId, group.displayName);
      if (existing) {
        return this.errorResponse(409, SCIM_ERROR_TYPES.uniqueness, 'displayName already exists');
      }

      const newGroup = await this.storage.createGroup(tenantId, {
        schemas: [SCIM_SCHEMAS.group],
        displayName: group.displayName,
        externalId: group.externalId,
        members: group.members,
      } as Omit<SCIMGroup, 'id' | 'meta'>);

      // Add members to group
      if (group.members) {
        for (const member of group.members) {
          if (member.type === 'User' || !member.type) {
            await this.storage.addUserToGroup(tenantId, newGroup.id, member.value);
          }
        }
      }

      return { success: true, data: newGroup, statusCode: 201 };
    } catch (error) {
      return this.errorResponse(500, undefined, error instanceof Error ? error.message : 'Internal error');
    }
  }

  /**
   * Get a group by ID
   */
  async getGroup(tenantId: string, groupId: string): Promise<SCIMResult<SCIMGroup>> {
    try {
      const group = await this.storage.getGroup(tenantId, groupId);
      if (!group) {
        return this.errorResponse(404, SCIM_ERROR_TYPES.noTarget, 'Group not found');
      }
      return { success: true, data: group, statusCode: 200 };
    } catch (error) {
      return this.errorResponse(500, undefined, error instanceof Error ? error.message : 'Internal error');
    }
  }

  /**
   * List groups with filtering and pagination
   */
  async listGroups(tenantId: string, query: SCIMQuery): Promise<SCIMResult<SCIMListResponse<SCIMGroup>>> {
    try {
      const { groups, totalCount } = await this.storage.listGroups(tenantId, {
        ...query,
        count: Math.min(query.count ?? this.config.maxPageSize, this.config.maxPageSize),
      });

      const response: SCIMListResponse<SCIMGroup> = {
        schemas: [SCIM_SCHEMAS.listResponse],
        totalResults: totalCount,
        startIndex: query.startIndex ?? 1,
        itemsPerPage: groups.length,
        Resources: groups,
      };

      return { success: true, data: response, statusCode: 200 };
    } catch (error) {
      return this.errorResponse(500, undefined, error instanceof Error ? error.message : 'Internal error');
    }
  }

  /**
   * Update a group (PUT - full replace)
   */
  async updateGroup(tenantId: string, groupId: string, group: Partial<SCIMGroup>): Promise<SCIMResult<SCIMGroup>> {
    try {
      const existing = await this.storage.getGroup(tenantId, groupId);
      if (!existing) {
        return this.errorResponse(404, SCIM_ERROR_TYPES.noTarget, 'Group not found');
      }

      const updated = await this.storage.updateGroup(tenantId, groupId, group);
      if (!updated) {
        return this.errorResponse(404, SCIM_ERROR_TYPES.noTarget, 'Group not found');
      }

      return { success: true, data: updated, statusCode: 200 };
    } catch (error) {
      return this.errorResponse(500, undefined, error instanceof Error ? error.message : 'Internal error');
    }
  }

  /**
   * Patch a group (partial update)
   */
  async patchGroup(tenantId: string, groupId: string, patch: SCIMPatchRequest): Promise<SCIMResult<SCIMGroup>> {
    if (!this.config.supportsPatch) {
      return this.errorResponse(501, undefined, 'PATCH not supported');
    }

    try {
      const existing = await this.storage.getGroup(tenantId, groupId);
      if (!existing) {
        return this.errorResponse(404, SCIM_ERROR_TYPES.noTarget, 'Group not found');
      }

      for (const op of patch.Operations) {
        await this.applyGroupPatchOperation(tenantId, groupId, existing, op);
      }

      const updated = await this.storage.getGroup(tenantId, groupId);
      return { success: true, data: updated!, statusCode: 200 };
    } catch (error) {
      return this.errorResponse(500, undefined, error instanceof Error ? error.message : 'Internal error');
    }
  }

  /**
   * Delete a group
   */
  async deleteGroup(tenantId: string, groupId: string): Promise<SCIMResult> {
    try {
      const deleted = await this.storage.deleteGroup(tenantId, groupId);
      if (!deleted) {
        return this.errorResponse(404, SCIM_ERROR_TYPES.noTarget, 'Group not found');
      }
      return { success: true, statusCode: 204 };
    } catch (error) {
      return this.errorResponse(500, undefined, error instanceof Error ? error.message : 'Internal error');
    }
  }

  // ===========================================================================
  // Bulk Operations
  // ===========================================================================

  /**
   * Process bulk operations
   */
  async processBulk(tenantId: string, request: SCIMBulkRequest): Promise<SCIMResult<SCIMBulkResponse>> {
    if (!this.config.supportsBulk) {
      return this.errorResponse(501, undefined, 'Bulk operations not supported');
    }

    const results: SCIMBulkResponse['Operations'] = [];
    const bulkIdMap = new Map<string, string>(); // bulkId -> created resource ID

    for (const op of request.Operations) {
      const result = await this.processBulkOperation(tenantId, op, bulkIdMap);
      results.push(result);
    }

    return {
      success: true,
      data: {
        schemas: [SCIM_SCHEMAS.bulkResponse],
        Operations: results,
      },
      statusCode: 200,
    };
  }

  private async processBulkOperation(
    tenantId: string,
    op: SCIMBulkOperation,
    bulkIdMap: Map<string, string>,
  ): Promise<SCIMBulkResponse['Operations'][0]> {
    const pathMatch = op.path.match(/^\/(Users|Groups)(?:\/(.+))?$/);
    if (!pathMatch) {
      return { method: op.method, bulkId: op.bulkId, status: '400' };
    }

    const resourceType = pathMatch[1];
    let resourceId = pathMatch[2];

    // Resolve bulkId references
    if (resourceId?.startsWith('bulkId:')) {
      const bulkId = resourceId.replace('bulkId:', '');
      const resolvedId = bulkIdMap.get(bulkId);
      if (!resolvedId) {
        return { method: op.method, bulkId: op.bulkId, status: '400' };
      }
      resourceId = resolvedId;
    }

    try {
      if (resourceType === 'Users') {
        return await this.processBulkUserOperation(tenantId, op, resourceId, bulkIdMap);
      } else {
        return await this.processBulkGroupOperation(tenantId, op, resourceId, bulkIdMap);
      }
    } catch (error) {
      return { method: op.method, bulkId: op.bulkId, status: '500' };
    }
  }

  private async processBulkUserOperation(
    tenantId: string,
    op: SCIMBulkOperation,
    resourceId: string | undefined,
    bulkIdMap: Map<string, string>,
  ): Promise<SCIMBulkResponse['Operations'][0]> {
    switch (op.method) {
      case 'POST': {
        const result = await this.createUser(tenantId, op.data as Partial<SCIMUser>);
        if (result.success && result.data && op.bulkId) {
          bulkIdMap.set(op.bulkId, result.data.id);
        }
        return {
          method: op.method,
          bulkId: op.bulkId,
          location: result.data?.meta.location,
          status: String(result.statusCode),
        };
      }
      case 'PUT': {
        if (!resourceId) return { method: op.method, bulkId: op.bulkId, status: '400' };
        const result = await this.updateUser(tenantId, resourceId, op.data as Partial<SCIMUser>);
        return {
          method: op.method,
          bulkId: op.bulkId,
          location: result.data?.meta.location,
          status: String(result.statusCode),
        };
      }
      case 'PATCH': {
        if (!resourceId) return { method: op.method, bulkId: op.bulkId, status: '400' };
        const result = await this.patchUser(tenantId, resourceId, op.data as SCIMPatchRequest);
        return {
          method: op.method,
          bulkId: op.bulkId,
          location: result.data?.meta.location,
          status: String(result.statusCode),
        };
      }
      case 'DELETE': {
        if (!resourceId) return { method: op.method, bulkId: op.bulkId, status: '400' };
        const result = await this.deleteUser(tenantId, resourceId);
        return { method: op.method, bulkId: op.bulkId, status: String(result.statusCode) };
      }
      default:
        return { method: op.method, bulkId: op.bulkId, status: '405' };
    }
  }

  private async processBulkGroupOperation(
    tenantId: string,
    op: SCIMBulkOperation,
    resourceId: string | undefined,
    bulkIdMap: Map<string, string>,
  ): Promise<SCIMBulkResponse['Operations'][0]> {
    switch (op.method) {
      case 'POST': {
        const result = await this.createGroup(tenantId, op.data as Partial<SCIMGroup>);
        if (result.success && result.data && op.bulkId) {
          bulkIdMap.set(op.bulkId, result.data.id);
        }
        return {
          method: op.method,
          bulkId: op.bulkId,
          location: result.data?.meta.location,
          status: String(result.statusCode),
        };
      }
      case 'DELETE': {
        if (!resourceId) return { method: op.method, bulkId: op.bulkId, status: '400' };
        const result = await this.deleteGroup(tenantId, resourceId);
        return { method: op.method, bulkId: op.bulkId, status: String(result.statusCode) };
      }
      default:
        return { method: op.method, bulkId: op.bulkId, status: '405' };
    }
  }

  // ===========================================================================
  // Schema and Discovery
  // ===========================================================================

  /**
   * Get service provider configuration
   */
  getServiceProviderConfig(): Record<string, unknown> {
    return {
      schemas: [SCIM_SCHEMAS.serviceProviderConfig],
      patch: { supported: this.config.supportsPatch },
      bulk: {
        supported: this.config.supportsBulk,
        maxOperations: 1000,
        maxPayloadSize: 1048576,
      },
      filter: {
        supported: true,
        maxResults: this.config.maxPageSize,
      },
      changePassword: { supported: this.config.supportsChangePassword },
      sort: { supported: this.config.supportsSort },
      etag: { supported: this.config.supportsETag },
      authenticationSchemes: this.config.authenticationSchemes.map(scheme => ({
        type: scheme,
        name: scheme === 'bearer' ? 'Bearer Token' : 'OAuth 2.0',
        description: scheme === 'bearer' 
          ? 'Authentication using Bearer tokens'
          : 'OAuth 2.0 Bearer Token',
      })),
    };
  }

  /**
   * Get resource types
   */
  getResourceTypes(): Record<string, unknown>[] {
    return [
      {
        schemas: [SCIM_SCHEMAS.resourceType],
        id: 'User',
        name: 'User',
        endpoint: '/Users',
        schema: SCIM_SCHEMAS.user,
        schemaExtensions: [
          {
            schema: SCIM_SCHEMAS.enterprise,
            required: false,
          },
        ],
      },
      {
        schemas: [SCIM_SCHEMAS.resourceType],
        id: 'Group',
        name: 'Group',
        endpoint: '/Groups',
        schema: SCIM_SCHEMAS.group,
      },
    ];
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  private applyPatchOperation(
    existing: SCIMUser,
    updates: Partial<SCIMUser>,
    op: SCIMPatchOperation,
  ): void {
    if (!op.path) {
      // If no path, value is an object to merge
      if (op.op === 'add' || op.op === 'replace') {
        Object.assign(updates, op.value);
      }
      return;
    }

    const pathParts = op.path.split('.');
    const attr = pathParts[0] as keyof SCIMUser;

    switch (op.op) {
      case 'add':
      case 'replace':
        (updates as Record<string, unknown>)[attr] = op.value;
        break;
      case 'remove':
        (updates as Record<string, unknown>)[attr] = undefined;
        break;
    }
  }

  private async applyGroupPatchOperation(
    tenantId: string,
    groupId: string,
    _existing: SCIMGroup,
    op: SCIMPatchOperation,
  ): Promise<void> {
    // Handle members operations
    if (op.path === 'members' || op.path?.startsWith('members[')) {
      const members = Array.isArray(op.value) ? op.value : [op.value];
      
      for (const member of members) {
        const memberId = (member as SCIMGroupMember).value;
        if (op.op === 'add') {
          await this.storage.addUserToGroup(tenantId, groupId, memberId);
        } else if (op.op === 'remove') {
          await this.storage.removeUserFromGroup(tenantId, groupId, memberId);
        }
      }
      return;
    }

    // Handle other attributes
    const updates: Partial<SCIMGroup> = {};
    if (op.path === 'displayName') {
      updates.displayName = op.value as string;
    }
    
    if (Object.keys(updates).length > 0) {
      await this.storage.updateGroup(tenantId, groupId, updates);
    }
  }

  private errorResponse<T = unknown>(status: number, scimType?: string, detail?: string): SCIMResult<T> {
    return {
      success: false,
      error: {
        schemas: [SCIM_SCHEMAS.error],
        status: String(status),
        scimType,
        detail,
      },
      statusCode: status,
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createSCIMService(
  config: Partial<SCIMServiceConfig> & Pick<SCIMServiceConfig, 'baseUrl'>,
  storage?: SCIMStorage,
): SCIMService {
  return new SCIMService(config, storage);
}
