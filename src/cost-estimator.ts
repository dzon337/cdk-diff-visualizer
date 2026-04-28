/**
 * Cost estimator for AWS resources.
 *
 * Provides approximate monthly cost estimates based on AWS resource type.
 * These are ballpark figures based on us-east-1 pricing for typical/default
 * configurations. Actual costs depend on region, usage, instance size, etc.
 *
 * Costs are in USD/month.
 */

export interface CostEstimate {
  /** Estimated monthly cost in USD */
  monthlyCost: number;
  /** Whether this is a "free-tier eligible" or near-zero cost resource */
  isFreeTier: boolean;
  /** Human-readable pricing note */
  note: string;
}

/**
 * Approximate monthly costs for common AWS resource types.
 * Based on us-east-1 on-demand pricing with typical/default configurations.
 *
 * Resources not in this map get a `null` estimate (unknown).
 */
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
 * Look up the estimated monthly cost for a given AWS resource type.
 * Returns `null` if the resource type is not in the cost table.
 */
export function estimateResourceCost(awsType: string): CostEstimate | null {
  const entry = COST_TABLE[awsType];
  if (!entry) return null;

  return {
    monthlyCost: entry.cost,
    isFreeTier: entry.freeTier ?? false,
    note: entry.note,
  };
}

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
}

/**
 * Calculate the aggregate cost impact of a set of resource changes.
 */
export function calculateCostImpact(
  resources: Array<{ changeType: string; awsType: string }>
): CostImpact {
  let addedCost = 0;
  let removedCost = 0;
  let knownResources = 0;
  let unknownResources = 0;

  for (const r of resources) {
    const estimate = estimateResourceCost(r.awsType);

    if (estimate === null) {
      unknownResources++;
      continue;
    }

    knownResources++;

    if (r.changeType === 'add') {
      addedCost += estimate.monthlyCost;
    } else if (r.changeType === 'remove') {
      removedCost += estimate.monthlyCost;
    }
    // 'modify' — cost change unknown without details, skip
  }

  return {
    addedCost,
    removedCost,
    netCost: addedCost - removedCost,
    knownResources,
    unknownResources,
  };
}

/**
 * Format a dollar amount for display. Shows 2 decimals for small amounts,
 * 0 decimals for larger amounts.
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
