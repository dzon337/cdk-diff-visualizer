/**
 * AWS Pricing API client — fetches real-time on-demand prices for EC2, RDS,
 * ElastiCache, and NAT Gateway resources. Results are cached in-memory per run.
 * The Pricing API is only available in us-east-1 and ap-south-1.
 * @module aws-pricing
 */

import { PricingClient, GetProductsCommand } from '@aws-sdk/client-pricing';

let clientInstance: PricingClient | null = null;
function getClient(): PricingClient {
  if (!clientInstance) clientInstance = new PricingClient({ region: 'us-east-1' });
  return clientInstance;
}

const priceCache = new Map<string, number | null>();

interface PriceFilter { Type: 'TERM_MATCH'; Field: string; Value: string }

async function fetchOnDemandPrice(serviceCode: string, filters: PriceFilter[]): Promise<number | null> {
  const key = [serviceCode, JSON.stringify(filters)].join('::');
  if (priceCache.has(key)) return priceCache.get(key) ?? null;
  try {
    const res = await getClient().send(new GetProductsCommand({ ServiceCode: serviceCode, Filters: filters, MaxResults: 1 }));
    const list = res.PriceList ?? [];
    if (!list.length) { priceCache.set(key, null); return null; }
    const product = typeof list[0] === 'string' ? JSON.parse(list[0]) : list[0];
    const od = product?.terms?.OnDemand;
    if (!od) { priceCache.set(key, null); return null; }
    const dims = od[Object.keys(od)[0]]?.priceDimensions;
    if (!dims) { priceCache.set(key, null); return null; }
    const price = parseFloat(dims[Object.keys(dims)[0]]?.pricePerUnit?.USD ?? '') || null;
    priceCache.set(key, price);
    return price;
  } catch {
    priceCache.set(key, null);
    return null;
  }
}

function toMonthly(hourly: number | null): number | null {
  return hourly && hourly > 0 ? Math.round(hourly * 730 * 100) / 100 : null;
}

/** Fetch monthly on-demand price for an EC2 instance type. */
export async function getEc2Price(instanceType: string, region = 'us-east-1'): Promise<{ monthlyCost: number; note: string } | null> {
  const m = toMonthly(await fetchOnDemandPrice('AmazonEC2', [
    { Type: 'TERM_MATCH', Field: 'instanceType', Value: instanceType },
    { Type: 'TERM_MATCH', Field: 'location', Value: regionToLocation(region) },
    { Type: 'TERM_MATCH', Field: 'operatingSystem', Value: 'Linux' },
    { Type: 'TERM_MATCH', Field: 'tenancy', Value: 'Shared' },
    { Type: 'TERM_MATCH', Field: 'preInstalledSw', Value: 'NA' },
    { Type: 'TERM_MATCH', Field: 'capacitystatus', Value: 'Used' },
  ]));
  return m ? { monthlyCost: m, note: `${instanceType} on-demand (${region})` } : null;
}

/** Fetch monthly on-demand price for an RDS DB instance. */
export async function getRdsPrice(dbInstanceClass: string, engine: string, region = 'us-east-1'): Promise<{ monthlyCost: number; note: string } | null> {
  const engineMap: Record<string, string> = {
    mysql: 'MySQL', postgres: 'PostgreSQL', mariadb: 'MariaDB',
    'oracle-ee': 'Oracle', 'oracle-se2': 'Oracle',
    'sqlserver-ee': 'SQL Server', 'sqlserver-se': 'SQL Server',
    'aurora-mysql': 'Aurora MySQL', 'aurora-postgresql': 'Aurora PostgreSQL',
  };
  const m = toMonthly(await fetchOnDemandPrice('AmazonRDS', [
    { Type: 'TERM_MATCH', Field: 'instanceType', Value: dbInstanceClass },
    { Type: 'TERM_MATCH', Field: 'location', Value: regionToLocation(region) },
    { Type: 'TERM_MATCH', Field: 'databaseEngine', Value: engineMap[engine.toLowerCase()] ?? engine },
    { Type: 'TERM_MATCH', Field: 'deploymentOption', Value: 'Single-AZ' },
  ]));
  return m ? { monthlyCost: m, note: `${dbInstanceClass} ${engine} Single-AZ (${region})` } : null;
}

/** Fetch monthly on-demand price for an ElastiCache node. */
export async function getElastiCachePrice(nodeType: string, engine = 'Redis', region = 'us-east-1'): Promise<{ monthlyCost: number; note: string } | null> {
  const m = toMonthly(await fetchOnDemandPrice('AmazonElastiCache', [
    { Type: 'TERM_MATCH', Field: 'instanceType', Value: nodeType },
    { Type: 'TERM_MATCH', Field: 'location', Value: regionToLocation(region) },
    { Type: 'TERM_MATCH', Field: 'cacheEngine', Value: engine },
  ]));
  return m ? { monthlyCost: m, note: `${nodeType} ${engine} (${region})` } : null;
}

/** Fetch monthly NAT Gateway price (hourly rate only, excludes data). */
export async function getNatGatewayPrice(region = 'us-east-1'): Promise<{ monthlyCost: number; note: string } | null> {
  const m = toMonthly(await fetchOnDemandPrice('AmazonEC2', [
    { Type: 'TERM_MATCH', Field: 'location', Value: regionToLocation(region) },
    { Type: 'TERM_MATCH', Field: 'usagetype', Value: `${regionToPrefix(region)}-NatGateway-Hours` },
  ]));
  return m ? { monthlyCost: m, note: `NAT Gateway (${region}) + data transfer` } : null;
}

/** Clear the in-memory price cache. */
export function clearPriceCache(): void { priceCache.clear(); }

const REGION_LOCATION: Record<string, string> = {
  'us-east-1': 'US East (N. Virginia)', 'us-east-2': 'US East (Ohio)',
  'us-west-1': 'US West (N. California)', 'us-west-2': 'US West (Oregon)',
  'eu-west-1': 'EU (Ireland)', 'eu-west-2': 'EU (London)', 'eu-west-3': 'EU (Paris)',
  'eu-central-1': 'EU (Frankfurt)', 'eu-north-1': 'EU (Stockholm)',
  'ap-southeast-1': 'Asia Pacific (Singapore)', 'ap-southeast-2': 'Asia Pacific (Sydney)',
  'ap-northeast-1': 'Asia Pacific (Tokyo)', 'ap-northeast-2': 'Asia Pacific (Seoul)',
  'ap-south-1': 'Asia Pacific (Mumbai)', 'sa-east-1': 'South America (Sao Paulo)',
  'ca-central-1': 'Canada (Central)',
};
function regionToLocation(r: string): string { return REGION_LOCATION[r] ?? 'US East (N. Virginia)'; }

const REGION_PREFIX: Record<string, string> = {
  'us-east-1': 'USE1', 'us-east-2': 'USE2', 'us-west-1': 'USW1', 'us-west-2': 'USW2',
  'eu-west-1': 'EUW1', 'eu-central-1': 'EUC1', 'ap-southeast-1': 'APS1', 'ap-northeast-1': 'APN1',
};
function regionToPrefix(r: string): string { return REGION_PREFIX[r] ?? 'USE1'; }
