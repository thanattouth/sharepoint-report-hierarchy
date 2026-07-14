import type { DeltaState } from "../domain/types";
import {
  hierarchyAssignments,
  hierarchyNodes,
  hierarchySiteMappings,
  inventoryItems,
  scanRuns,
  sharePointSites,
} from "../fixtures/data";
import type {
  DeltaStateStore,
  HierarchyStore,
  InventoryStore,
  ScanRunStore,
} from "./contracts";

export class FixtureHierarchyStore implements HierarchyStore {
  async getNodes() {
    return structuredClone(hierarchyNodes);
  }

  async getAssignments() {
    return structuredClone(hierarchyAssignments);
  }

  async getSites() {
    return structuredClone(sharePointSites);
  }

  async getSiteMappings() {
    return structuredClone(hierarchySiteMappings);
  }
}

export class FixtureInventoryStore implements InventoryStore {
  async listCurrentBySiteIds(siteIds: string[]) {
    const allowed = new Set(siteIds);
    return structuredClone(
      inventoryItems.filter((item) => allowed.has(item.siteId) && !item.deletedAt),
    );
  }

  async applyChanges(): Promise<void> {
    // Deterministic fixture store is intentionally immutable in P0-P3.
  }
}

export class FixtureScanRunStore implements ScanRunStore {
  async listRecent() {
    return structuredClone(scanRuns);
  }

  async save(): Promise<void> {
    // Queue/run persistence is simulated by the scanner service.
  }
}

export class FixtureDeltaStateStore implements DeltaStateStore {
  private readonly states = new Map<string, DeltaState>();

  async get(driveId: string) {
    return this.states.get(driveId) ?? null;
  }

  async save(state: DeltaState) {
    this.states.set(state.driveId, structuredClone(state));
  }
}
