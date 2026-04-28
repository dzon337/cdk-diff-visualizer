import { estimateResourceCost, calculateCostImpact, CostEstimate, CostImpact } from './cost-estimator';

export type ChangeType = 'add' | 'modify' | 'remove';

export interface ResourceChange {
  changeType: ChangeType;
  awsType: string;
  logicalId: string;
  physicalId?: string;
  raw: string;
  /** Estimated monthly cost for this resource type (null if unknown) */
  estimatedCost: CostEstimate | null;
}

export interface StackDiff {
  stackName: string;
  resources: ResourceChange[];
  hasIamChanges: boolean;
  hasSecurityGroupChanges: boolean;
  noChanges: boolean;
  /** Aggregate cost impact of changes in this stack */
  costImpact: CostImpact;
}

export interface ParsedDiff {
  stacks: StackDiff[];
  totalAdded: number;
  totalModified: number;
  totalRemoved: number;
  hasSecurityChanges: boolean;
  /** Aggregate cost impact across all stacks */
  costImpact: CostImpact;
}

const CHANGE_SYMBOLS: Record<string, ChangeType> = {
  '+': 'add',
  '~': 'modify',
  '!': 'modify',
  '-': 'remove',
};

// Strip ANSI escape codes emitted by cdk diff (colors, bold, cursor moves)
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

export function parseCdkDiff(raw: string): ParsedDiff {
  const cleaned = stripAnsi(raw);
  console.log("STARTED PARSING")
  // DEBUG: log every line that contains a bracket change marker
  cleaned.split('\n').forEach((line, i) => {
    if (/^\[.?\]/.test(line.trim())) {
      console.error(`[DEBUG line ${i}]: ${JSON.stringify(line.trim())}`);
    }
  });
  const lines = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n'); const stacks: StackDiff[] = [];

  let current: StackDiff | null = null;
  let inResources = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // New stack block
    const stackMatch = trimmed.match(/^Stack\s+(.+)$/);
    if (stackMatch) {
      current = {
        stackName: stackMatch[1].trim(),
        resources: [],
        hasIamChanges: false,
        hasSecurityGroupChanges: false,
        noChanges: false,
        costImpact: { addedCost: 0, removedCost: 0, netCost: 0, knownResources: 0, unknownResources: 0 },
      };
      stacks.push(current);
      inResources = false;
      continue;
    }

    if (!current) continue;

    if (/There were no differences/.test(trimmed)) {
      current.noChanges = true;
      continue;
    }

    // IAM / Security section headers — flag the stack but stop resource parsing
    if (/IAM Statement Changes|IAM Policy Changes/i.test(trimmed)) {
      current.hasIamChanges = true;
      inResources = false;
      continue;
    }

    if (/Security Group Changes/i.test(trimmed)) {
      current.hasSecurityGroupChanges = true;
      inResources = false;
      continue;
    }

    // Resources section — start parsing
    if (/^Resources$/i.test(trimmed)) {
      inResources = true;
      continue;
    }

    // Any other top-level section — stop parsing resources
    if (/^(Parameters|Outputs|Other Changes|Conditions)$/i.test(trimmed)) {
      inResources = false;
      continue;
    }

    if (!inResources) continue;

    // Resource line: [+] AWS::S3::Bucket LogicalId PhysicalId
    const resMatch = trimmed.match(/^\[([+~!\-])\]\s+(\S+)\s+(.+)$/);
    if (resMatch) {
      const sym = resMatch[1];
      const changeType = CHANGE_SYMBOLS[sym] ?? 'modify';
      const awsType = resMatch[2];
      const rest = resMatch[3].trim().split(/\s+/);
      const logicalId = rest[0];
      const physicalId = rest.slice(1).join(' ') || undefined;

      current.resources.push({
        changeType,
        awsType,
        logicalId,
        physicalId,
        raw: trimmed,
        estimatedCost: estimateResourceCost(awsType),
      });
    }
  }

  // Calculate per-stack cost impact
  for (const stack of stacks) {
    stack.costImpact = calculateCostImpact(stack.resources);
  }

  const allResources = stacks.flatMap((s) => s.resources);
  const totalCostImpact = calculateCostImpact(allResources);

  return {
    stacks,
    totalAdded: allResources.filter((r) => r.changeType === 'add').length,
    totalModified: allResources.filter((r) => r.changeType === 'modify').length,
    totalRemoved: allResources.filter((r) => r.changeType === 'remove').length,
    hasSecurityChanges: stacks.some((s) => s.hasIamChanges || s.hasSecurityGroupChanges),
    costImpact: totalCostImpact,
  };
}
