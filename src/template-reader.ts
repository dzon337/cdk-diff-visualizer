/**
 * Reads synthesized CloudFormation templates from cdk.out/ to extract
 * resource properties needed for accurate cost estimation.
 */

import fs from 'fs';
import path from 'path';

export interface ResourceProperties {
  logicalId: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface TemplateResources {
  /** Map of logicalId → resource properties from all templates */
  resources: Map<string, ResourceProperties>;
}

/**
 * Read all CloudFormation templates from the cdk.out/ directory and extract
 * resource definitions with their properties.
 */
export function readTemplates(cwd: string): TemplateResources {
  const resources = new Map<string, ResourceProperties>();

  const cdkOutDir = path.join(cwd, 'cdk.out');
  if (!fs.existsSync(cdkOutDir)) {
    return { resources };
  }

  const files = fs.readdirSync(cdkOutDir).filter((f) => f.endsWith('.template.json'));

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(cdkOutDir, file), 'utf-8');
      const template = JSON.parse(raw) as {
        Resources?: Record<string, { Type: string; Properties?: Record<string, unknown> }>;
      };

      if (!template.Resources) continue;

      for (const [logicalId, resource] of Object.entries(template.Resources)) {
        resources.set(logicalId, {
          logicalId,
          type: resource.Type,
          properties: resource.Properties ?? {},
        });
      }
    } catch {
      // Skip malformed templates
    }
  }

  return { resources };
}

// ─── Property extractors per resource type ──────────────────────────────────────

/**
 * Extract the instance type from an EC2 instance resource.
 */
export function getEc2InstanceType(props: Record<string, unknown>): string {
  return (props['InstanceType'] as string) ?? 't3.medium';
}

/**
 * Extract the DB instance class from an RDS resource.
 */
export function getRdsInstanceClass(props: Record<string, unknown>): string {
  return (props['DBInstanceClass'] as string) ?? 'db.t3.medium';
}

/**
 * Extract the RDS engine (mysql, postgres, aurora-mysql, etc.).
 */
export function getRdsEngine(props: Record<string, unknown>): string {
  return (props['Engine'] as string) ?? 'mysql';
}

/**
 * Extract the cache node type from an ElastiCache resource.
 */
export function getElastiCacheNodeType(props: Record<string, unknown>): string {
  return (props['CacheNodeType'] as string) ?? 'cache.t3.medium';
}

/**
 * Extract the Lambda memory size.
 */
export function getLambdaMemorySize(props: Record<string, unknown>): number {
  return (props['MemorySize'] as number) ?? 128;
}

/**
 * Extract ECS task definition CPU/memory.
 */
export function getEcsTaskCpuMemory(props: Record<string, unknown>): { cpu: string; memory: string } {
  return {
    cpu: (props['Cpu'] as string) ?? '256',
    memory: (props['Memory'] as string) ?? '512',
  };
}

/**
 * Extract EKS node group instance types.
 */
export function getEksNodeInstanceTypes(props: Record<string, unknown>): string[] {
  return (props['InstanceTypes'] as string[]) ?? ['t3.medium'];
}

/**
 * Extract allocated storage for RDS.
 */
export function getRdsAllocatedStorage(props: Record<string, unknown>): number {
  return (props['AllocatedStorage'] as number) ?? 20;
}
