/**
 * Parses raw `cdk diff` stdout into structured resource change data.
 * @module parser
 */

import { estimateResourceCost, calculateCostImpact, CostEstimate, CostImpact } from './cost-estimator';

export type ChangeType = 'add' | 'modify' | 'remove';

export interface ResourceChange {
  changeType: ChangeType;
  awsType: string;
  logicalId: string;
  physicalId?: string;
  raw: string;
  estimatedCost: CostEstimate | null;
}

export interface StackDiff {
  stackName: string;
  resources: ResourceChange[];
  hasIamChanges: boolean;
  hasSecurityGroupChanges: boolean;
  noChanges: boolean;
  costImpact: CostImpact;
}

export interface ParsedDiff {
  stacks: StackDiff[];
  totalAdded: number;
  totalModified: number;
  totalRemoved: number;
  hasSecurityChanges: boolean;
  costImpact: CostImpact;
}

const CHANGE_SYMBOLS: Record<string, ChangeType> = { '+': 'add', '~': 'modify', '!': 'modify', '-': 'remove' };
const ZERO_IMPACT: CostImpact = { addedCost: 0, removedCost: 0, netCost: 0, knownResources: 0, unknownResources: 0, liveResources: 0 };

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

/** Parse raw `cdk diff` output into structured diff data with cost estimates. */
export function parseCdkDiff(raw: string): ParsedDiff {
  const lines = stripAnsi(raw).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const stacks: StackDiff[] = [];
  let current: StackDiff | null = null;
  let inResources = false;

  for (const line of lines) {
    const t = line.trim();

    const stackMatch = t.match(/^Stack\s+(.+)$/);
    if (stackMatch) {
      current = { stackName: stackMatch[1].trim(), resources: [], hasIamChanges: false, hasSecurityGroupChanges: false, noChanges: false, costImpact: { ...ZERO_IMPACT } };
      stacks.push(current);
      inResources = false;
      continue;
    }

    if (!current) continue;
    if (/There were no differences/.test(t)) { current.noChanges = true; continue; }
    if (/IAM Statement Changes|IAM Policy Changes/i.test(t)) { current.hasIamChanges = true; inResources = false; continue; }
    if (/Security Group Changes/i.test(t)) { current.hasSecurityGroupChanges = true; inResources = false; continue; }
    if (/^Resources$/i.test(t)) { inResources = true; continue; }
    if (/^(Parameters|Outputs|Other Changes|Conditions)$/i.test(t)) { inResources = false; continue; }
    if (!inResources) continue;

    const m = t.match(/^\[([+~!\-])\]\s+(\S+)\s+(.+)$/);
    if (m) {
      const rest = m[3].trim().split(/\s+/);
      current.resources.push({
        changeType: CHANGE_SYMBOLS[m[1]] ?? 'modify',
        awsType: m[2],
        logicalId: rest[0],
        physicalId: rest.slice(1).join(' ') || undefined,
        raw: t,
        estimatedCost: estimateResourceCost(m[2]),
      });
    }
  }

  for (const s of stacks) s.costImpact = calculateCostImpact(s.resources);
  const all = stacks.flatMap((s) => s.resources);

  return {
    stacks,
    totalAdded: all.filter((r) => r.changeType === 'add').length,
    totalModified: all.filter((r) => r.changeType === 'modify').length,
    totalRemoved: all.filter((r) => r.changeType === 'remove').length,
    hasSecurityChanges: stacks.some((s) => s.hasIamChanges || s.hasSecurityGroupChanges),
    costImpact: calculateCostImpact(all),
  };
}
