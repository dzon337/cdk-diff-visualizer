/**
 * Cost estimator for AWS resources. Uses a three-tier strategy:
 *   1. Read CloudFormation template (cdk.out/) for actual resource properties
 *   2. Query the AWS Pricing API for real on-demand prices
 *   3. Fall back to a static cost table (us-east-1 defaults, USD/month)
 * @module cost-estimator
 */

import { readTemplates, getEc2InstanceType, getRdsInstanceClass, getRdsEngine, getElastiCacheNodeType, getLambdaMemorySize, getEcsTaskCpuMemory, type ResourceProperties } from './template-reader';
import { getEc2Price, getRdsPrice, getElastiCachePrice, getNatGatewayPrice } from './aws-pricing';

export interface CostEstimate {
  monthlyCost: number;
  isFreeTier: boolean;
  note: string;
  isLive: boolean;
}

export interface CostImpact {
  addedCost: number;
  removedCost: number;
  netCost: number;
  knownResources: number;
  unknownResources: number;
  liveResources: number;
}

const COST_TABLE: Record<string, { cost: number; note: string; freeTier?: boolean }> = {
  'AWS::EC2::Instance':                { cost: 62.05,  note: 't3.medium on-demand' },
  'AWS::EC2::NatGateway':              { cost: 32.40,  note: '$0.045/hr + data' },
  'AWS::EC2::LaunchTemplate':          { cost: 0,      note: 'no direct cost', freeTier: true },
  'AWS::AutoScaling::AutoScalingGroup':{ cost: 0,      note: 'cost depends on instances' },
  'AWS::AutoScaling::LaunchConfiguration': { cost: 0,  note: 'no direct cost', freeTier: true },
  'AWS::ECS::Cluster':                 { cost: 0,      note: 'no direct cost', freeTier: true },
  'AWS::ECS::Service':                 { cost: 36.50,  note: '0.5 vCPU / 1 GB Fargate' },
  'AWS::ECS::TaskDefinition':          { cost: 0,      note: 'no direct cost', freeTier: true },
  'AWS::EKS::Cluster':                 { cost: 73.00,  note: '$0.10/hr cluster fee' },
  'AWS::EKS::Nodegroup':              { cost: 124.10, note: '2× t3.medium nodes' },
  'AWS::Lambda::Function':             { cost: 0.20,   note: '1M req/mo, 128MB', freeTier: true },
  'AWS::Lambda::EventSourceMapping':   { cost: 0,      note: 'no direct cost', freeTier: true },
  'AWS::Lambda::Permission':           { cost: 0,      note: 'no direct cost', freeTier: true },
  'AWS::Lambda::LayerVersion':         { cost: 0,      note: 'no direct cost', freeTier: true },
  'AWS::S3::Bucket':                   { cost: 0.023,  note: 'per GB Standard', freeTier: true },
  'AWS::S3::BucketPolicy':            { cost: 0,      note: 'no direct cost', freeTier: true },
  'AWS::EFS::FileSystem':              { cost: 6.00,   note: '20 GB Standard' },
  'AWS::EFS::MountTarget':             { cost: 0,      note: 'no direct cost', freeTier: true },
  'AWS::RDS::DBInstance':              { cost: 49.64,  note: 'db.t3.medium Single-AZ' },
  'AWS::RDS::DBCluster':              { cost: 87.60,  note: 'Aurora Serverless v2 min' },
  'AWS::RDS::DBSubnetGroup':          { cost: 0,      note: 'no direct cost', freeTier: true },
  'AWS::DynamoDB::Table':              { cost: 1.25,   note: '5 RCU/WCU on-demand', freeTier: true },
  'AWS::DynamoDB::GlobalTable':        { cost: 2.50,   note: '2 regions, 5 RCU/WCU' },
  'AWS::ElastiCache::CacheCluster':    { cost: 36.50,  note: 'cache.t3.medium' },
  'AWS::ElastiCache::ReplicationGroup': { cost: 73.00, note: '2× cache.t3.medium' },
  'AWS::EC2::VPC':                     { cost: 0,      note: 'no direct cost', freeTier: true },
  'AWS::EC2::Subnet':                  { cost: 0,      note: 'no direct cost', freeTier: true },
  'AWS::EC2::InternetGateway':         { cost: 0,      note: 'no direct cost', freeTier: true },
  'AWS::EC2::RouteTable':              { cost: 0,      note: 'no direct cost', freeTier: true },
  'AWS::EC2::Route':                   { cost: 0,      note: 'no direct cost', freeTier: true },
  'AWS::EC2::SecurityGroup':           { cost: 0,      note: 'no direct cost', freeTier: true },
  'AWS::EC2::SubnetRouteTableAssociation': { cost: 0,  note: 'no direct cost', freeTier: true },
  'AWS::EC2::VPCGatewayAttachment':    { cost: 0,      note: 'no direct cost', freeTier: true },
  'AWS::EC2::EIP':                     { cost: 3.65,   note: '$0.005/hr' },
  'AWS::ElasticLoadBalancingV2::LoadBalancer': { cost: 22.27, note: 'ALB base + LCU' },
  'AWS::ElasticLoadBalancingV2::TargetGroup':  { cost: 0,    note: 'no direct cost', freeTier: true },
  'AWS::ElasticLoadBalancingV2::Listener':     { cost: 0,    note: 'no direct cost', freeTier: true },
  'AWS::ElasticLoadBalancingV2::ListenerRule':  { cost: 0,   note: 'no direct cost', freeTier: true },
  'AWS::Route53::HostedZone':          { cost: 0.50,   note: '$0.50/zone/mo' },
  'AWS::Route53::RecordSet':           { cost: 0,      note: 'no direct cost', freeTier: true },
  'AWS::CloudFront::Distribution':     { cost: 1.00,   note: 'min + per-request', freeTier: true },
  'AWS::ApiGateway::RestApi':          { cost: 3.50,   note: '1M req/mo' },
  'AWS::ApiGatewayV2::Api':            { cost: 1.00,   note: 'HTTP API, 1M req/mo' },
  'AWS::SQS::Queue':                   { cost: 0.40,   note: '1M req/mo', freeTier: true },
  'AWS::SQS::QueuePolicy':            { cost: 0,      note: 'no direct cost', freeTier: true },
  'AWS::SNS::Topic':                   { cost: 0.50,   note: '1M publishes/mo', freeTier: true },
  'AWS::SNS::Subscription':           { cost: 0,      note: 'no direct cost', freeTier: true },
  'AWS::Events::Rule':                 { cost: 1.00,   note: '$1/M events' },
  'AWS::StepFunctions::StateMachine':  { cost: 2.50,   note: '100K transitions' },
  'AWS::Kinesis::Stream':              { cost: 10.95,  note: '1 shard on-demand' },
  'AWS::IAM::Role':                    { cost: 0,      note: 'no direct cost', freeTier: true },
  'AWS::IAM::Policy':                  { cost: 0,      note: 'no direct cost', freeTier: true },
  'AWS::IAM::ManagedPolicy':          { cost: 0,      note: 'no direct cost', freeTier: true },
  'AWS::IAM::InstanceProfile':        { cost: 0,      note: 'no direct cost', freeTier: true },
  'AWS::IAM::User':                    { cost: 0,      note: 'no direct cost', freeTier: true },
  'AWS::IAM::Group':                   { cost: 0,      note: 'no direct cost', freeTier: true },
  'AWS::KMS::Key':                     { cost: 1.00,   note: '$1/key/mo' },
  'AWS::KMS::Alias':                   { cost: 0,      note: 'no direct cost', freeTier: true },
  'AWS::SecretsManager::Secret':       { cost: 0.40,   note: '$0.40/secret/mo' },
  'AWS::SSM::Parameter':              { cost: 0,      note: 'Standard free', freeTier: true },
  'AWS::CertificateManager::Certificate': { cost: 0,  note: 'free with AWS', freeTier: true },
  'AWS::WAFv2::WebACL':               { cost: 5.00,   note: '$5/ACL/mo' },
  'AWS::CodeBuild::Project':           { cost: 1.50,   note: 'small, 100 min' },
  'AWS::CodePipeline::Pipeline':       { cost: 1.00,   note: '$1/pipeline/mo' },
  'AWS::CloudFormation::Stack':        { cost: 0,      note: 'no direct cost', freeTier: true },
  'AWS::CloudFormation::CustomResource': { cost: 0,    note: 'no direct cost', freeTier: true },
  'AWS::CloudWatch::Alarm':            { cost: 0.10,   note: '$0.10/alarm/mo' },
  'AWS::CloudWatch::Dashboard':        { cost: 3.00,   note: '$3/dashboard/mo' },
  'AWS::Logs::LogGroup':               { cost: 0.50,   note: '$0.50/GB ingested' },
  'AWS::Logs::LogStream':              { cost: 0,      note: 'no direct cost', freeTier: true },
  'AWS::Cognito::UserPool':            { cost: 0,      note: '50K MAU free', freeTier: true },
  'AWS::Cognito::UserPoolClient':     { cost: 0,      note: 'no direct cost', freeTier: true },
  'AWS::AppSync::GraphQLApi':          { cost: 2.00,   note: '$4/M query' },
};

/** Look up static fallback cost for an AWS resource type. Returns null if unknown. */
export function estimateResourceCost(awsType: string): CostEstimate | null {
  const e = COST_TABLE[awsType];
  if (!e) return null;
  return { monthlyCost: e.cost, isFreeTier: e.freeTier ?? false, note: e.note, isLive: false };
}

/** Get a cost estimate using CloudFormation template props + AWS Pricing API, with static fallback. */
export async function estimateResourceCostLive(
  awsType: string, _logicalId: string, templateProps: ResourceProperties | undefined, region: string,
): Promise<CostEstimate | null> {
  if (templateProps) {
    const p = templateProps.properties;
    try {
      switch (awsType) {
        case 'AWS::EC2::Instance': {
          const r = await getEc2Price(getEc2InstanceType(p), region);
          if (r) return { ...r, isFreeTier: false, isLive: true };
          break;
        }
        case 'AWS::RDS::DBInstance': {
          const r = await getRdsPrice(getRdsInstanceClass(p), getRdsEngine(p), region);
          if (r) return { ...r, isFreeTier: false, isLive: true };
          break;
        }
        case 'AWS::ElastiCache::CacheCluster': {
          const r = await getElastiCachePrice(getElastiCacheNodeType(p), 'Redis', region);
          if (r) return { ...r, isFreeTier: false, isLive: true };
          break;
        }
        case 'AWS::EC2::NatGateway': {
          const r = await getNatGatewayPrice(region);
          if (r) return { ...r, isFreeTier: false, isLive: true };
          break;
        }
        case 'AWS::Lambda::Function': {
          const mem = getLambdaMemorySize(p);
          const gb = (mem / 1024) * 0.2 * 1_000_000;
          const cost = Math.round((gb * 0.0000166667 + 0.20) * 100) / 100;
          return { monthlyCost: cost, isFreeTier: true, note: `${mem}MB, 1M req/mo, 200ms avg`, isLive: true };
        }
        case 'AWS::ECS::Service':
        case 'AWS::ECS::TaskDefinition': {
          const { cpu, memory } = getEcsTaskCpuMemory(p);
          if (awsType === 'AWS::ECS::TaskDefinition') return { monthlyCost: 0, isFreeTier: true, note: 'no direct cost', isLive: true };
          const h = (parseInt(cpu) / 1024 * 0.04048) + (parseInt(memory) / 1024 * 0.004445);
          return { monthlyCost: Math.round(h * 730 * 100) / 100, isFreeTier: false, note: `${parseInt(cpu) / 1024} vCPU / ${parseInt(memory) / 1024} GB Fargate (${region})`, isLive: true };
        }
      }
    } catch { /* live pricing failed, fall back */ }
  }
  return estimateResourceCost(awsType);
}

/** Calculate aggregate cost impact from a set of resource changes. */
export function calculateCostImpact(
  resources: Array<{ changeType: string; awsType: string; estimatedCost?: CostEstimate | null }>
): CostImpact {
  let addedCost = 0, removedCost = 0, knownResources = 0, unknownResources = 0, liveResources = 0;
  for (const r of resources) {
    const est = r.estimatedCost ?? estimateResourceCost(r.awsType);
    if (!est) { unknownResources++; continue; }
    knownResources++;
    if (est.isLive) liveResources++;
    if (r.changeType === 'add') addedCost += est.monthlyCost;
    else if (r.changeType === 'remove') removedCost += est.monthlyCost;
  }
  return { addedCost, removedCost, netCost: addedCost - removedCost, knownResources, unknownResources, liveResources };
}

/** Format a dollar amount for display. */
export function formatCost(amount: number): string {
  if (amount === 0) return '$0';
  if (Math.abs(amount) < 1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(2)}`;
}

/** Format cost with a sign prefix (+$X or -$X). */
export function formatCostWithSign(amount: number): string {
  if (amount === 0) return '$0';
  return `${amount > 0 ? '+' : '-'}${formatCost(Math.abs(amount))}`;
}

/** Enrich resource changes with live pricing. Mutates resources in-place. */
export async function enrichWithLivePricing(
  resources: Array<{ logicalId: string; awsType: string; estimatedCost: CostEstimate | null }>,
  cwd: string,
): Promise<{ liveCount: number; fallbackCount: number }> {
  let liveCount = 0, fallbackCount = 0;
  const region = process.env['AWS_DEFAULT_REGION'] ?? process.env['AWS_REGION'] ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1';
  const { resources: tpl } = readTemplates(cwd);

  await Promise.all(resources.map(async (r) => {
    const props = tpl.get(r.logicalId) ?? findByPrefix(tpl, r.logicalId);
    const est = await estimateResourceCostLive(r.awsType, r.logicalId, props, region);
    if (est) { r.estimatedCost = est; est.isLive ? liveCount++ : fallbackCount++; }
    else fallbackCount++;
  }));
  return { liveCount, fallbackCount };
}

function findByPrefix(m: Map<string, ResourceProperties>, id: string): ResourceProperties | undefined {
  for (const [k, v] of m) { if (k.startsWith(id)) return v; }
  return undefined;
}
