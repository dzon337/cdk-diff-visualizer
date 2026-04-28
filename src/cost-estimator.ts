/**
 * Cost estimator for AWS resources.
 *
 * Three-tier estimation strategy:
 *   1. Read the actual CloudFormation template (cdk.out/) to get resource properties
 *   2. Query the AWS Pricing API for real prices using those properties
 *   3. Fall back to the static cost table when API is unavailable
 *
 * Costs are in USD/month.
 */

import {
  readTemplates,
  getEc2InstanceType,
  getRdsInstanceClass,
  getRdsEngine,
  getElastiCacheNodeType,
  getLambdaMemorySize,
  getEcsTaskCpuMemory,
  type ResourceProperties,
} from './template-reader';
import {
  getEc2Price,
  getRdsPrice,
  getElastiCachePrice,
  getNatGatewayPrice,
} from './aws-pricing';

export interface CostEstimate {
  /** Estimated monthly cost in USD */
  monthlyCost: number;
  /** Whether this is a "free-tier eligible" or near-zero cost resource */
  isFreeTier: boolean;
  /** Human-readable pricing note */
  note: string;
  /** Whether this estimate came from live pricing (true) or fallback (false) */
  isLive: boolean;
}

// ─── Static fallback table ──────────────────────────────────────────────────────

const COST_TABLE: Record<string, { cost: number; note: string; freeTier?: boolean }> = {
  // ─── Compute ──────────────────────────────────────────────────────────────────
  'AWS::EC2::Instance':                { cost: 62.05,   note: 't3.medium on-demand' },
  'AWS::EC2::NatGateway':              { cost: 32.40,   note: '$0.045/hr + data' },
  'AWS::EC2::LaunchTemplate':          { cost: 0,       note: 'no direct cost', freeTier: true },
  'AWS::AutoScaling::AutoScalingGroup':{ cost: 0,       note: 'cost depends on instances' },
  'AWS::AutoScaling::LaunchConfiguration': { cost: 0,   note: 'no direct cost', freeTier: true },

  // ─── Containers ───────────────────────────────────────────────────────────────
  'AWS::ECS::Cluster':                 { cost: 0,       note: 'no direct cost', freeTier: true },
  'AWS::ECS::Service':                 { cost: 36.50,   note: '0.5 vCPU / 1 GB Fargate' },
  'AWS::ECS::TaskDefinition':          { cost: 0,       note: 'no direct cost', freeTier: true },
  'AWS::EKS::Cluster':                 { cost: 73.00,   note: '$0.10/hr cluster fee' },
  'AWS::EKS::Nodegroup':              { cost: 124.10,  note: '2× t3.medium nodes' },

  // ─── Lambda ───────────────────────────────────────────────────────────────────
  'AWS::Lambda::Function':             { cost: 0.20,    note: '1M requests/mo, 128MB', freeTier: true },
  'AWS::Lambda::EventSourceMapping':   { cost: 0,       note: 'no direct cost', freeTier: true },
  'AWS::Lambda::Permission':           { cost: 0,       note: 'no direct cost', freeTier: true },
  'AWS::Lambda::LayerVersion':         { cost: 0,       note: 'no direct cost', freeTier: true },

  // ─── Storage ──────────────────────────────────────────────────────────────────
  'AWS::S3::Bucket':                   { cost: 0.023,   note: 'per GB Standard storage', freeTier: true },
  'AWS::S3::BucketPolicy':            { cost: 0,       note: 'no direct cost', freeTier: true },
  'AWS::EFS::FileSystem':              { cost: 6.00,    note: '20 GB Standard' },
  'AWS::EFS::MountTarget':             { cost: 0,       note: 'no direct cost', freeTier: true },

  // ─── Databases ────────────────────────────────────────────────────────────────
  'AWS::RDS::DBInstance':              { cost: 49.64,   note: 'db.t3.medium Single-AZ' },
  'AWS::RDS::DBCluster':              { cost: 87.60,   note: 'Aurora Serverless v2 (0.5 ACU min)' },
  'AWS::RDS::DBSubnetGroup':          { cost: 0,       note: 'no direct cost', freeTier: true },
  'AWS::DynamoDB::Table':              { cost: 1.25,    note: '5 RCU / 5 WCU on-demand', freeTier: true },
  'AWS::DynamoDB::GlobalTable':        { cost: 2.50,    note: '2 regions, 5 RCU / 5 WCU' },
  'AWS::ElastiCache::CacheCluster':    { cost: 36.50,   note: 'cache.t3.medium' },
  'AWS::ElastiCache::ReplicationGroup': { cost: 73.00,  note: '2× cache.t3.medium' },

  // ─── Networking ───────────────────────────────────────────────────────────────
  'AWS::EC2::VPC':                     { cost: 0,       note: 'no direct cost', freeTier: true },
  'AWS::EC2::Subnet':                  { cost: 0,       note: 'no direct cost', freeTier: true },
  'AWS::EC2::InternetGateway':         { cost: 0,       note: 'no direct cost', freeTier: true },
  'AWS::EC2::RouteTable':              { cost: 0,       note: 'no direct cost', freeTier: true },
  'AWS::EC2::Route':                   { cost: 0,       note: 'no direct cost', freeTier: true },
  'AWS::EC2::SecurityGroup':           { cost: 0,       note: 'no direct cost', freeTier: true },
  'AWS::EC2::SubnetRouteTableAssociation': { cost: 0,   note: 'no direct cost', freeTier: true },
  'AWS::EC2::VPCGatewayAttachment':    { cost: 0,       note: 'no direct cost', freeTier: true },
  'AWS::EC2::EIP':                     { cost: 3.65,    note: '$0.005/hr (free if attached)' },
  'AWS::ElasticLoadBalancingV2::LoadBalancer': { cost: 22.27, note: 'ALB base cost + LCU' },
  'AWS::ElasticLoadBalancingV2::TargetGroup':  { cost: 0,    note: 'no direct cost', freeTier: true },
  'AWS::ElasticLoadBalancingV2::Listener':     { cost: 0,    note: 'no direct cost', freeTier: true },
  'AWS::ElasticLoadBalancingV2::ListenerRule':  { cost: 0,   note: 'no direct cost', freeTier: true },
  'AWS::Route53::HostedZone':          { cost: 0.50,    note: '$0.50/hosted zone/mo' },
  'AWS::Route53::RecordSet':           { cost: 0,       note: 'no direct cost', freeTier: true },
  'AWS::CloudFront::Distribution':     { cost: 1.00,    note: 'minimum + per-request', freeTier: true },
  'AWS::ApiGateway::RestApi':          { cost: 3.50,    note: '1M requests/mo' },
  'AWS::ApiGatewayV2::Api':            { cost: 1.00,    note: 'HTTP API, 1M requests/mo' },

  // ─── Messaging ────────────────────────────────────────────────────────────────
  'AWS::SQS::Queue':                   { cost: 0.40,    note: '1M requests/mo', freeTier: true },
  'AWS::SQS::QueuePolicy':            { cost: 0,       note: 'no direct cost', freeTier: true },
  'AWS::SNS::Topic':                   { cost: 0.50,    note: '1M publishes/mo', freeTier: true },
  'AWS::SNS::Subscription':           { cost: 0,       note: 'no direct cost', freeTier: true },
  'AWS::Events::Rule':                 { cost: 1.00,    note: '$1/M custom events' },
  'AWS::StepFunctions::StateMachine':  { cost: 2.50,    note: '100K state transitions' },
  'AWS::Kinesis::Stream':              { cost: 10.95,   note: '1 shard on-demand' },

  // ─── IAM / Security ───────────────────────────────────────────────────────────
  'AWS::IAM::Role':                    { cost: 0,       note: 'no direct cost', freeTier: true },
  'AWS::IAM::Policy':                  { cost: 0,       note: 'no direct cost', freeTier: true },
  'AWS::IAM::ManagedPolicy':          { cost: 0,       note: 'no direct cost', freeTier: true },
  'AWS::IAM::InstanceProfile':        { cost: 0,       note: 'no direct cost', freeTier: true },
  'AWS::IAM::User':                    { cost: 0,       note: 'no direct cost', freeTier: true },
  'AWS::IAM::Group':                   { cost: 0,       note: 'no direct cost', freeTier: true },
  'AWS::KMS::Key':                     { cost: 1.00,    note: '$1/key/mo + API calls' },
  'AWS::KMS::Alias':                   { cost: 0,       note: 'no direct cost', freeTier: true },
  'AWS::SecretsManager::Secret':       { cost: 0.40,    note: '$0.40/secret/mo' },
  'AWS::SSM::Parameter':              { cost: 0,       note: 'Standard tier free', freeTier: true },
  'AWS::CertificateManager::Certificate': { cost: 0,   note: 'free with AWS services', freeTier: true },
  'AWS::WAFv2::WebACL':               { cost: 5.00,    note: '$5/ACL/mo + rules' },

  // ─── CI/CD / Management ───────────────────────────────────────────────────────
  'AWS::CodeBuild::Project':           { cost: 1.50,    note: 'build.general1.small, 100 min' },
  'AWS::CodePipeline::Pipeline':       { cost: 1.00,    note: '$1/active pipeline/mo' },
  'AWS::CloudFormation::Stack':        { cost: 0,       note: 'no direct cost', freeTier: true },
  'AWS::CloudFormation::CustomResource': { cost: 0,     note: 'no direct cost', freeTier: true },
  'AWS::CloudWatch::Alarm':            { cost: 0.10,    note: '$0.10/alarm/mo' },
  'AWS::CloudWatch::Dashboard':        { cost: 3.00,    note: '$3/dashboard/mo' },
  'AWS::Logs::LogGroup':               { cost: 0.50,    note: '$0.50/GB ingested' },
  'AWS::Logs::LogStream':              { cost: 0,       note: 'no direct cost', freeTier: true },

  // ─── Cognito / AppSync ────────────────────────────────────────────────────────
  'AWS::Cognito::UserPool':            { cost: 0,       note: 'first 50K MAU free', freeTier: true },
  'AWS::Cognito::UserPoolClient':     { cost: 0,       note: 'no direct cost', freeTier: true },
  'AWS::AppSync::GraphQLApi':          { cost: 2.00,    note: '$4/M query + data' },
};

/**
 * Look up the estimated monthly cost from the static fallback table.
 * Returns `null` if the resource type is not in the cost table.
 */
export function estimateResourceCost(awsType: string): CostEstimate | null {
  const entry = COST_TABLE[awsType];
  if (!entry) return null;

  return {
    monthlyCost: entry.cost,
    isFreeTier: entry.freeTier ?? false,
    note: entry.note,
    isLive: false,
  };
}

// ─── Live pricing for specific resource types ───────────────────────────────────

/**
 * Get an accurate cost estimate using the CloudFormation template and AWS Pricing API.
 * Falls back to the static table if live pricing fails or is unavailable.
 */
export async function estimateResourceCostLive(
  awsType: string,
  logicalId: string,
  templateProps: ResourceProperties | undefined,
  region: string,
): Promise<CostEstimate | null> {
  // Only attempt live pricing for resource types where it's meaningful
  if (templateProps) {
    const props = templateProps.properties;

    try {
      switch (awsType) {
        case 'AWS::EC2::Instance': {
          const instanceType = getEc2InstanceType(props);
          const result = await getEc2Price(instanceType, region);
          if (result) {
            return { ...result, isFreeTier: false, isLive: true };
          }
          break;
        }

        case 'AWS::RDS::DBInstance': {
          const dbClass = getRdsInstanceClass(props);
          const engine = getRdsEngine(props);
          const result = await getRdsPrice(dbClass, engine, region);
          if (result) {
            return { ...result, isFreeTier: false, isLive: true };
          }
          break;
        }

        case 'AWS::ElastiCache::CacheCluster': {
          const nodeType = getElastiCacheNodeType(props);
          const result = await getElastiCachePrice(nodeType, 'Redis', region);
          if (result) {
            return { ...result, isFreeTier: false, isLive: true };
          }
          break;
        }

        case 'AWS::EC2::NatGateway': {
          const result = await getNatGatewayPrice(region);
          if (result) {
            return { ...result, isFreeTier: false, isLive: true };
          }
          break;
        }

        case 'AWS::Lambda::Function': {
          const memMb = getLambdaMemorySize(props);
          // Lambda pricing: $0.0000166667 per GB-second
          // Assume 1M invocations/mo, 200ms avg duration
          const gbSeconds = (memMb / 1024) * 0.2 * 1_000_000;
          const computeCost = gbSeconds * 0.0000166667;
          const requestCost = 1_000_000 * 0.0000002; // $0.20 per 1M requests
          const total = Math.round((computeCost + requestCost) * 100) / 100;
          return {
            monthlyCost: total,
            isFreeTier: true,
            note: `${memMb}MB, 1M req/mo, 200ms avg`,
            isLive: true,
          };
        }

        case 'AWS::ECS::Service':
        case 'AWS::ECS::TaskDefinition': {
          const { cpu, memory } = getEcsTaskCpuMemory(props);
          const cpuVal = parseInt(cpu, 10) / 1024; // vCPU
          const memVal = parseInt(memory, 10) / 1024; // GB
          // Fargate pricing (us-east-1): $0.04048/vCPU/hr + $0.004445/GB/hr
          const hourly = (cpuVal * 0.04048) + (memVal * 0.004445);
          const monthly = Math.round(hourly * 730 * 100) / 100;
          if (awsType === 'AWS::ECS::TaskDefinition') {
            return { monthlyCost: 0, isFreeTier: true, note: 'no direct cost (see Service)', isLive: true };
          }
          return {
            monthlyCost: monthly,
            isFreeTier: false,
            note: `${cpuVal} vCPU / ${memVal} GB Fargate (${region})`,
            isLive: true,
          };
        }
      }
    } catch {
      // Live pricing failed, fall back
    }
  }

  // Fall back to static table
  return estimateResourceCost(awsType);
}

// ─── Aggregate cost impact ──────────────────────────────────────────────────────

export interface CostImpact {
  /** Total estimated cost increase from added resources ($/mo) */
  addedCost: number;
  /** Total estimated cost decrease from removed resources ($/mo) */
  removedCost: number;
  /** Net monthly cost change (positive = more expensive) */
  netCost: number;
  /** Number of resources with known cost estimates */
  knownResources: number;
  /** Number of resources with unknown costs */
  unknownResources: number;
  /** Number of resources priced via live API */
  liveResources: number;
}

/**
 * Calculate the aggregate cost impact of a set of resource changes (sync version).
 */
export function calculateCostImpact(
  resources: Array<{ changeType: string; awsType: string; estimatedCost?: CostEstimate | null }>
): CostImpact {
  let addedCost = 0;
  let removedCost = 0;
  let knownResources = 0;
  let unknownResources = 0;
  let liveResources = 0;

  for (const r of resources) {
    const estimate = r.estimatedCost ?? estimateResourceCost(r.awsType);

    if (estimate === null) {
      unknownResources++;
      continue;
    }

    knownResources++;
    if (estimate.isLive) liveResources++;

    if (r.changeType === 'add') {
      addedCost += estimate.monthlyCost;
    } else if (r.changeType === 'remove') {
      removedCost += estimate.monthlyCost;
    }
  }

  return {
    addedCost,
    removedCost,
    netCost: addedCost - removedCost,
    knownResources,
    unknownResources,
    liveResources,
  };
}

// ─── Formatting ─────────────────────────────────────────────────────────────────

/**
 * Format a dollar amount for display.
 */
export function formatCost(amount: number): string {
  if (amount === 0) return '$0';
  if (Math.abs(amount) < 1) return `$${amount.toFixed(3)}`;
  if (Math.abs(amount) < 10) return `$${amount.toFixed(2)}`;
  return `$${amount.toFixed(2)}`;
}

/**
 * Format cost with a sign prefix for display.
 */
export function formatCostWithSign(amount: number): string {
  if (amount === 0) return '$0';
  const sign = amount > 0 ? '+' : '-';
  return `${sign}${formatCost(Math.abs(amount))}`;
}

// ─── Orchestration ──────────────────────────────────────────────────────────────

/**
 * Enrich resource changes with live pricing from the AWS Pricing API.
 * Reads the CloudFormation template from cdk.out/ and queries the Pricing API
 * for each resource that supports live pricing.
 *
 * Mutates the resources in-place, updating their `estimatedCost` field.
 */
export async function enrichWithLivePricing(
  resources: Array<{ logicalId: string; awsType: string; estimatedCost: CostEstimate | null }>,
  cwd: string,
): Promise<{ liveCount: number; fallbackCount: number }> {
  let liveCount = 0;
  let fallbackCount = 0;

  const region = process.env['AWS_DEFAULT_REGION'] ?? process.env['AWS_REGION'] ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1';

  // Read CloudFormation templates
  const { resources: templateResources } = readTemplates(cwd);

  // Enrich each resource with live pricing
  const promises = resources.map(async (r) => {
    // Find matching template resource by logicalId
    // CDK appends a hash to logical IDs, so we try both exact and prefix match
    const templateProps = templateResources.get(r.logicalId)
      ?? findByPrefix(templateResources, r.logicalId);

    const liveEstimate = await estimateResourceCostLive(
      r.awsType,
      r.logicalId,
      templateProps,
      region,
    );

    if (liveEstimate) {
      r.estimatedCost = liveEstimate;
      if (liveEstimate.isLive) liveCount++;
      else fallbackCount++;
    } else {
      fallbackCount++;
    }
  });

  await Promise.all(promises);

  return { liveCount, fallbackCount };
}

/**
 * Find a template resource by logical ID prefix match.
 * CDK generates logical IDs like "TestBucket560B80BC" from construct ID "TestBucket".
 */
function findByPrefix(
  resources: Map<string, ResourceProperties>,
  logicalId: string,
): ResourceProperties | undefined {
  for (const [key, value] of resources) {
    if (key.startsWith(logicalId)) return value;
  }
  return undefined;
}
