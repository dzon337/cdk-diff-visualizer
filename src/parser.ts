export type ChangeType = 'add' | 'modify' | 'remove';

export interface ResourceChange {
  changeType: ChangeType;
  awsType: string;
  logicalId: string;
  physicalId?: string;
  raw: string;
}

export interface StackDiff {
  stackName: string;
  resources: ResourceChange[];
  hasIamChanges: boolean;
  hasSecurityGroupChanges: boolean;
  noChanges: boolean;
}

export interface ParsedDiff {
  stacks: StackDiff[];
  totalAdded: number;
  totalModified: number;
  totalRemoved: number;
  hasSecurityChanges: boolean;
}

const CHANGE_SYMBOLS: Record<string, ChangeType> = {
  '+': 'add',
  '~': 'modify',
  '!': 'modify',
  '-': 'remove',
};

export function parseCdkDiff(raw: string): ParsedDiff {
  const lines = raw.split('\n');
  const stacks: StackDiff[] = [];

  let current: StackDiff | null = null;
  let inResources = false;
  let inIam = false;

  for (const line of lines) {
    // New stack
    const stackMatch = line.match(/^Stack\s+(.+)$/);
    if (stackMatch) {
      current = {
        stackName: stackMatch[1].trim(),
        resources: [],
        hasIamChanges: false,
        hasSecurityGroupChanges: false,
        noChanges: false,
      };
      stacks.push(current);
      inResources = false;
      inIam = false;
      continue;
    }

    if (!current) continue;

    if (/There were no differences/.test(line)) {
      current.noChanges = true;
      continue;
    }

    if (/IAM Statement Changes/i.test(line)) {
      current.hasIamChanges = true;
      inIam = true;
      continue;
    }

    if (/Security Group Changes/i.test(line)) {
      current.hasSecurityGroupChanges = true;
      continue;
    }

    if (/^Resources$/i.test(line.trim())) {
      inResources = true;
      inIam = false;
      continue;
    }

    if (/^Other Changes$/i.test(line.trim())) {
      inResources = false;
      continue;
    }

    // Resource line: [+] AWS::S3::Bucket MyBucket MyBucketABC123
    const resMatch = line.match(/^\[([+~!\-])\]\s+(\S+)\s+(.+)$/);
    if (resMatch && inResources) {
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
        raw: line.trim(),
      });
    }
  }

  const allResources = stacks.flatMap((s) => s.resources);

  return {
    stacks,
    totalAdded: allResources.filter((r) => r.changeType === 'add').length,
    totalModified: allResources.filter((r) => r.changeType === 'modify').length,
    totalRemoved: allResources.filter((r) => r.changeType === 'remove').length,
    hasSecurityChanges: stacks.some((s) => s.hasIamChanges || s.hasSecurityGroupChanges),
  };
}
