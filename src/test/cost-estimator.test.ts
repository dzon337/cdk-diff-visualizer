import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateResourceCost,
  calculateCostImpact,
  formatCost,
  formatCostWithSign,
} from '../cost-estimator';

describe('estimateResourceCost', () => {
  test('returns estimate for known resource type', () => {
    const est = estimateResourceCost('AWS::S3::Bucket');
    assert.ok(est !== null);
    assert.equal(typeof est!.monthlyCost, 'number');
    assert.equal(typeof est!.note, 'string');
    assert.equal(typeof est!.isFreeTier, 'boolean');
  });

  test('returns null for unknown resource type', () => {
    const est = estimateResourceCost('AWS::Custom::SomethingWeird');
    assert.equal(est, null);
  });

  test('S3 bucket is free-tier eligible', () => {
    const est = estimateResourceCost('AWS::S3::Bucket');
    assert.ok(est!.isFreeTier);
  });

  test('RDS instance has non-zero cost', () => {
    const est = estimateResourceCost('AWS::RDS::DBInstance');
    assert.ok(est!.monthlyCost > 0);
  });

  test('IAM Role is free', () => {
    const est = estimateResourceCost('AWS::IAM::Role');
    assert.equal(est!.monthlyCost, 0);
    assert.ok(est!.isFreeTier);
  });

  test('NAT Gateway has significant cost', () => {
    const est = estimateResourceCost('AWS::EC2::NatGateway');
    assert.ok(est!.monthlyCost > 30);
  });
});

describe('calculateCostImpact', () => {
  test('adds cost for added resources', () => {
    const impact = calculateCostImpact([
      { changeType: 'add', awsType: 'AWS::EC2::NatGateway' },
      { changeType: 'add', awsType: 'AWS::S3::Bucket' },
    ]);
    assert.ok(impact.addedCost > 0);
    assert.equal(impact.removedCost, 0);
    assert.ok(impact.netCost > 0);
  });

  test('subtracts cost for removed resources', () => {
    const impact = calculateCostImpact([
      { changeType: 'remove', awsType: 'AWS::RDS::DBInstance' },
    ]);
    assert.equal(impact.addedCost, 0);
    assert.ok(impact.removedCost > 0);
    assert.ok(impact.netCost < 0);
  });

  test('modified resources do not affect cost', () => {
    const impact = calculateCostImpact([
      { changeType: 'modify', awsType: 'AWS::RDS::DBInstance' },
    ]);
    assert.equal(impact.addedCost, 0);
    assert.equal(impact.removedCost, 0);
    assert.equal(impact.netCost, 0);
  });

  test('unknown resources are counted', () => {
    const impact = calculateCostImpact([
      { changeType: 'add', awsType: 'AWS::Custom::Unknown' },
      { changeType: 'add', awsType: 'AWS::S3::Bucket' },
    ]);
    assert.equal(impact.unknownResources, 1);
    assert.equal(impact.knownResources, 1);
  });

  test('net cost is addedCost minus removedCost', () => {
    const impact = calculateCostImpact([
      { changeType: 'add', awsType: 'AWS::EC2::NatGateway' },
      { changeType: 'remove', awsType: 'AWS::EC2::NatGateway' },
    ]);
    assert.equal(impact.netCost, 0);
    assert.ok(impact.addedCost > 0);
    assert.ok(impact.removedCost > 0);
  });

  test('empty resources returns zero impact', () => {
    const impact = calculateCostImpact([]);
    assert.equal(impact.addedCost, 0);
    assert.equal(impact.removedCost, 0);
    assert.equal(impact.netCost, 0);
    assert.equal(impact.knownResources, 0);
    assert.equal(impact.unknownResources, 0);
  });
});

describe('formatCost', () => {
  test('formats zero as $0', () => {
    assert.equal(formatCost(0), '$0');
  });

  test('formats small amounts with 3 decimals', () => {
    assert.equal(formatCost(0.023), '$0.023');
  });

  test('formats medium amounts with 2 decimals', () => {
    assert.equal(formatCost(3.50), '$3.50');
  });

  test('formats large amounts with 2 decimals', () => {
    assert.equal(formatCost(62.05), '$62.05');
  });
});

describe('formatCostWithSign', () => {
  test('formats zero as $0', () => {
    assert.equal(formatCostWithSign(0), '$0');
  });

  test('formats positive with + prefix', () => {
    assert.ok(formatCostWithSign(10).startsWith('+'));
  });

  test('formats negative with - prefix', () => {
    assert.ok(formatCostWithSign(-10).startsWith('-'));
  });
});
