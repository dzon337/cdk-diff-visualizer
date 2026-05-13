/**
 * Reads synthesized CloudFormation templates from cdk.out/ to extract
 * resource properties (instance types, memory sizes, etc.) for cost estimation.
 * @module template-reader
 */

import fs from 'fs';
import path from 'path';

export interface ResourceProperties {
  logicalId: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface TemplateResources {
  resources: Map<string, ResourceProperties>;
}

export function readTemplates(cwd: string): TemplateResources {
  const resources = new Map<string, ResourceProperties>();
  const cdkOutDir = path.join(cwd, 'cdk.out');
  if (!fs.existsSync(cdkOutDir)) return { resources };

  for (const file of fs.readdirSync(cdkOutDir).filter((f) => f.endsWith('.template.json'))) {
    try {
      const template = JSON.parse(fs.readFileSync(path.join(cdkOutDir, file), 'utf-8')) as {
        Resources?: Record<string, { Type: string; Properties?: Record<string, unknown> }>;
      };
      if (!template.Resources) continue;
      for (const [id, res] of Object.entries(template.Resources)) {
        resources.set(id, { logicalId: id, type: res.Type, properties: res.Properties ?? {} });
      }
    } catch (error) {
      console.error(`Failed to read template from ${file}:`, error);
    }
  }
  return { resources };
}

export function getEc2InstanceType(p: Record<string, unknown>): string { return (p['InstanceType'] as string) ?? 't3.medium'; }
export function getRdsInstanceClass(p: Record<string, unknown>): string { return (p['DBInstanceClass'] as string) ?? 'db.t3.medium'; }
export function getRdsEngine(p: Record<string, unknown>): string { return (p['Engine'] as string) ?? 'mysql'; }
export function getElastiCacheNodeType(p: Record<string, unknown>): string { return (p['CacheNodeType'] as string) ?? 'cache.t3.medium'; }
export function getLambdaMemorySize(p: Record<string, unknown>): number { return (p['MemorySize'] as number) ?? 128; }
export function getRdsAllocatedStorage(p: Record<string, unknown>): number { return (p['AllocatedStorage'] as number) ?? 20; }
export function getEksNodeInstanceTypes(p: Record<string, unknown>): string[] { return (p['InstanceTypes'] as string[]) ?? ['t3.medium']; }
export function getEcsTaskCpuMemory(p: Record<string, unknown>): { cpu: string; memory: string } {
  return { cpu: (p['Cpu'] as string) ?? '256', memory: (p['Memory'] as string) ?? '512' };
}
