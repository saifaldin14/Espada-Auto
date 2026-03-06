/**
 * Infrastructure Knowledge Graph — In-Memory Contract Store
 *
 * Simple Map-backed store for infrastructure contracts.
 * Suitable for single-process usage and tests. For persistence,
 * wrap or replace with a storage-backed implementation.
 */

import type {
  ContractStore,
  ContractFilter,
  InfraContract,
} from "./types.js";

export class InMemoryContractStore implements ContractStore {
  private contracts = new Map<string, InfraContract>();

  upsert(contract: InfraContract): void {
    this.contracts.set(contract.id, { ...contract, updatedAt: new Date().toISOString() });
  }

  get(id: string): InfraContract | undefined {
    return this.contracts.get(id);
  }

  remove(id: string): boolean {
    return this.contracts.delete(id);
  }

  list(filter?: ContractFilter): InfraContract[] {
    let result = Array.from(this.contracts.values());

    if (filter?.owner) {
      result = result.filter((c) => c.owner === filter.owner);
    }
    if (filter?.enabled !== undefined) {
      result = result.filter((c) => c.enabled === filter.enabled);
    }
    if (filter?.tags) {
      const reqTags = filter.tags;
      result = result.filter((c) =>
        Object.entries(reqTags).every(([k, v]) => c.tags[k] === v),
      );
    }

    return result;
  }

  listByDependency(nodeId: string): InfraContract[] {
    return Array.from(this.contracts.values()).filter(
      (c) => c.dependencies.includes(nodeId),
    );
  }

  listByOwner(owner: string): InfraContract[] {
    return Array.from(this.contracts.values()).filter(
      (c) => c.owner === owner,
    );
  }

  /** Total number of stored contracts. */
  get size(): number {
    return this.contracts.size;
  }

  /** Clear all contracts. */
  clear(): void {
    this.contracts.clear();
  }
}
