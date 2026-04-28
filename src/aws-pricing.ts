/**
 * AWS Pricing API client for fetching real-time resource pricing.
 *
 * Uses the AWS Pricing API (us-east-1) to look up on-demand prices for
 * specific resource configurations (instance types, DB classes, etc.).
 *
 * The Pricing API is only available in us-east-1 and ap-south-1.
 */

import { PricingClient, GetProductsCommand } from '@aws-sdk/client-pricing';

let clientInstance: PricingClient | null = null;

function getClient(): PricingClient {
  if (!clientInstance) {
    clientInstance = new PricingClient({ region: 'us-east-1' });
  }
  return clientInstance;
}

// ─── In-memory cache to avoid repeated API calls within a single run ────────────

const priceCache = new Map<string, number | null>();

function cacheKey(...parts: string[]): string {
  return parts.join('::');
}

// ─── Generic price fetcher ──────────────────────────────────────────────────────

interface PriceFilter {
  Type: 'TERM_MATCH';
  Field: string;
  Value: string;
}

/**
 * Query the AWS Pricing API for on-demand pricing.
 * Returns the first matching hourly USD price, or null if not found.
 */
async function fetchOnDemandPrice(
  serviceCode: string,
  filters: PriceFilter[],
): Promise<number | null> {
  const key = cacheKey(serviceCode, JSON.stringify(filters));
  if (priceCache.has(key)) return priceCache.get(key) ?? null;

  try {
    const client = getClient();
    const response = await client.send(
      new GetProductsCommand({
        ServiceCode: serviceCode,
        Filters: filters,
        MaxResults: 1,
      }),
    );

    const priceList = response.PriceList ?? [];
    if (priceList.length === 0) {
      priceCache.set(key, null);
      return null;
    }

    const product = typeof priceList[0] === 'string'
      ? JSON.parse(priceList[0])
      : priceList[0];

    // Navigate the pricing JSON: terms.OnDemand.*.priceDimensions.*.pricePerUnit.USD
    const onDemandTerms = product?.terms?.OnDemand;
    if (!onDemandTerms) {
      priceCache.set(key, null);
      return null;
    }

    const termKey = Object.keys(onDemandTerms)[0];
    const priceDimensions = onDemandTerms[termKey]?.priceDimensions;
    if (!priceDimensions) {
      priceCache.set(key, null);
      return null;
    }

    const dimKey = Object.keys(priceDimensions)[0];
    const priceStr = priceDimensions[dimKey]?.pricePerUnit?.USD;
    const hourlyPrice = priceStr ? parseFloat(priceStr) : null;

    priceCache.set(key, hourlyPrice);
    return hourlyPrice;
  } catch {
    // API unavailable, auth issue, etc. — return null silently
    priceCache.set(key, null);
    return null;
  }
}

// ─── Service-specific price lookups ─────────────────────────────────────────────

/**
 * Get the monthly on-demand price for an EC2 instance type.
 */
export async function getEc2Price(
  instanceType: string,
  region = 'us-east-1',
): Promise<{ monthlyCost: number; note: string } | null> {
  const hourly = await fetchOnDemandPrice('AmazonEC2', [
    { Type: 'TERM_MATCH', Field: 'instanceType', Value: instanceType },
    { Type: 'TERM_MATCH', Field: 'location', Value: regionToLocation(region) },
    { Type: 'TERM_MATCH', Field: 'operatingSystem', Value: 'Linux' },
    { Type: 'TERM_MATCH', Field: 'tenancy', Value: 'Shared' },
    { Type: 'TERM_MATCH', Field: 'preInstalledSw', Value: 'NA' },
    { Type: 'TERM_MATCH', Field: 'capacitystatus', Value: 'Used' },
  ]);

  if (hourly === null || hourly === 0) return null;
  const monthly = hourly * 730; // ~730 hours/month
  return {
    monthlyCost: Math.round(monthly * 100) / 100,
    note: `${instanceType} on-demand (${region})`,
  };
}

/**
 * Get the monthly on-demand price for an RDS DB instance.
 */
export async function getRdsPrice(
  dbInstanceClass: string,
  engine: string,
  region = 'us-east-1',
): Promise<{ monthlyCost: number; note: string } | null> {
  // Map CDK engine names to Pricing API values
  const engineMap: Record<string, string> = {
    'mysql': 'MySQL',
    'postgres': 'PostgreSQL',
    'mariadb': 'MariaDB',
    'oracle-ee': 'Oracle',
    'oracle-se2': 'Oracle',
    'sqlserver-ee': 'SQL Server',
    'sqlserver-se': 'SQL Server',
    'aurora-mysql': 'Aurora MySQL',
    'aurora-postgresql': 'Aurora PostgreSQL',
  };
  const dbEngine = engineMap[engine.toLowerCase()] ?? engine;

  const hourly = await fetchOnDemandPrice('AmazonRDS', [
    { Type: 'TERM_MATCH', Field: 'instanceType', Value: dbInstanceClass },
    { Type: 'TERM_MATCH', Field: 'location', Value: regionToLocation(region) },
    { Type: 'TERM_MATCH', Field: 'databaseEngine', Value: dbEngine },
    { Type: 'TERM_MATCH', Field: 'deploymentOption', Value: 'Single-AZ' },
  ]);

  if (hourly === null || hourly === 0) return null;
  const monthly = hourly * 730;
  return {
    monthlyCost: Math.round(monthly * 100) / 100,
    note: `${dbInstanceClass} ${engine} Single-AZ (${region})`,
  };
}

/**
 * Get the monthly on-demand price for an ElastiCache node.
 */
export async function getElastiCachePrice(
  nodeType: string,
  engine = 'Redis',
  region = 'us-east-1',
): Promise<{ monthlyCost: number; note: string } | null> {
  const hourly = await fetchOnDemandPrice('AmazonElastiCache', [
    { Type: 'TERM_MATCH', Field: 'instanceType', Value: nodeType },
    { Type: 'TERM_MATCH', Field: 'location', Value: regionToLocation(region) },
    { Type: 'TERM_MATCH', Field: 'cacheEngine', Value: engine },
  ]);

  if (hourly === null || hourly === 0) return null;
  const monthly = hourly * 730;
  return {
    monthlyCost: Math.round(monthly * 100) / 100,
    note: `${nodeType} ${engine} (${region})`,
  };
}

/**
 * Get the monthly cost for a NAT Gateway (fixed hourly rate, no data charges).
 */
export async function getNatGatewayPrice(
  region = 'us-east-1',
): Promise<{ monthlyCost: number; note: string } | null> {
  const hourly = await fetchOnDemandPrice('AmazonEC2', [
    { Type: 'TERM_MATCH', Field: 'location', Value: regionToLocation(region) },
    { Type: 'TERM_MATCH', Field: 'usagetype', Value: `${regionToPrefix(region)}-NatGateway-Hours` },
  ]);

  if (hourly === null || hourly === 0) return null;
  const monthly = hourly * 730;
  return {
    monthlyCost: Math.round(monthly * 100) / 100,
    note: `NAT Gateway (${region}) + data transfer`,
  };
}

// ─── Region mapping ─────────────────────────────────────────────────────────────

const REGION_LOCATION: Record<string, string> = {
  'us-east-1': 'US East (N. Virginia)',
  'us-east-2': 'US East (Ohio)',
  'us-west-1': 'US West (N. California)',
  'us-west-2': 'US West (Oregon)',
  'eu-west-1': 'EU (Ireland)',
  'eu-west-2': 'EU (London)',
  'eu-west-3': 'EU (Paris)',
  'eu-central-1': 'EU (Frankfurt)',
  'eu-north-1': 'EU (Stockholm)',
  'ap-southeast-1': 'Asia Pacific (Singapore)',
  'ap-southeast-2': 'Asia Pacific (Sydney)',
  'ap-northeast-1': 'Asia Pacific (Tokyo)',
  'ap-northeast-2': 'Asia Pacific (Seoul)',
  'ap-south-1': 'Asia Pacific (Mumbai)',
  'sa-east-1': 'South America (Sao Paulo)',
  'ca-central-1': 'Canada (Central)',
};

function regionToLocation(region: string): string {
  return REGION_LOCATION[region] ?? 'US East (N. Virginia)';
}

const REGION_PREFIX: Record<string, string> = {
  'us-east-1': 'USE1',
  'us-east-2': 'USE2',
  'us-west-1': 'USW1',
  'us-west-2': 'USW2',
  'eu-west-1': 'EUW1',
  'eu-central-1': 'EUC1',
  'ap-southeast-1': 'APS1',
  'ap-northeast-1': 'APN1',
};

function regionToPrefix(region: string): string {
  return REGION_PREFIX[region] ?? 'USE1';
}

/**
 * Clear the price cache (useful for testing).
 */
export function clearPriceCache(): void {
  priceCache.clear();
}
