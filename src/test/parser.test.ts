import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseCdkDiff } from '../parser';

const FULL_DIFF = `
Stack AdminMsNgPipelineStack
IAM Statement Changes
┌───┬────────────────────────────────┬────────┬──────────────────┐
│ + │ arn:aws:iam::123:role/DeployR   │ Allow  │ sts:AssumeRole  │
└───┴────────────────────────────────┴────────┴──────────────────┘
Resources
[+] AWS::IAM::Role DeploymentRole DeploymentRoleABC123
[+] AWS::CodeBuild::Project BuildProject BuildProjectDEF456
[~] AWS::CodePipeline::Pipeline MainPipeline MainPipelineGHI789
[-] AWS::CloudFormation::Stack OldStack OldStackMNO345

Stack EcsResources
Resources
[+] AWS::ECS::Cluster AppCluster AppClusterPQR678
[+] AWS::ECS::TaskDefinition AppTask AppTaskSTU901
[~] AWS::EC2::SecurityGroup OpsSg OpsSgBCD890
[-] AWS::ECS::Service OldService OldServiceHIJ456

Stack MonitoringStack
There were no differences
`;

const NO_CHANGES_DIFF = `
Stack MyStack
There were no differences
`;

const SINGLE_STACK = `
Stack MyStack
Resources
[+] AWS::S3::Bucket MyBucket MyBucketXYZ
[~] AWS::Lambda::Function MyFn MyFnABC
`;

describe('parseCdkDiff', () => {
  describe('full multi-stack diff', () => {
    const result = parseCdkDiff(FULL_DIFF);

    test('parses correct number of stacks', () => {
      assert.equal(result.stacks.length, 3);
    });

    test('counts totals correctly', () => {
      assert.equal(result.totalAdded, 4);
      assert.equal(result.totalModified, 2);
      assert.equal(result.totalRemoved, 2);
    });

    test('detects IAM changes on correct stack', () => {
      const pipeline = result.stacks.find((s) => s.stackName === 'AdminMsNgPipelineStack');
      assert.ok(pipeline);
      assert.equal(pipeline.hasIamChanges, true);
    });

    test('does not flag IAM on stack without it', () => {
      const ecs = result.stacks.find((s) => s.stackName === 'EcsResources');
      assert.ok(ecs);
      assert.equal(ecs.hasIamChanges, false);
    });

    test('hasSecurityChanges is true when any stack has IAM', () => {
      assert.equal(result.hasSecurityChanges, true);
    });

    test('parses resource logical IDs correctly', () => {
      const pipeline = result.stacks.find((s) => s.stackName === 'AdminMsNgPipelineStack')!;
      const ids = pipeline.resources.map((r) => r.logicalId);
      assert.deepEqual(ids, ['DeploymentRole', 'BuildProject', 'MainPipeline', 'OldStack']);
    });

    test('parses AWS types correctly', () => {
      const pipeline = result.stacks.find((s) => s.stackName === 'AdminMsNgPipelineStack')!;
      assert.equal(pipeline.resources[0].awsType, 'AWS::IAM::Role');
      assert.equal(pipeline.resources[1].awsType, 'AWS::CodeBuild::Project');
    });

    test('parses change types correctly', () => {
      const pipeline = result.stacks.find((s) => s.stackName === 'AdminMsNgPipelineStack')!;
      assert.equal(pipeline.resources[0].changeType, 'add');
      assert.equal(pipeline.resources[2].changeType, 'modify');
      assert.equal(pipeline.resources[3].changeType, 'remove');
    });

    test('marks no-changes stack correctly', () => {
      const monitoring = result.stacks.find((s) => s.stackName === 'MonitoringStack')!;
      assert.equal(monitoring.noChanges, true);
      assert.equal(monitoring.resources.length, 0);
    });

    test('parses physical IDs', () => {
      const pipeline = result.stacks.find((s) => s.stackName === 'AdminMsNgPipelineStack')!;
      assert.equal(pipeline.resources[0].physicalId, 'DeploymentRoleABC123');
    });
  });

  describe('no changes diff', () => {
    const result = parseCdkDiff(NO_CHANGES_DIFF);

    test('parses one stack', () => {
      assert.equal(result.stacks.length, 1);
    });

    test('all totals are zero', () => {
      assert.equal(result.totalAdded, 0);
      assert.equal(result.totalModified, 0);
      assert.equal(result.totalRemoved, 0);
    });

    test('no security changes', () => {
      assert.equal(result.hasSecurityChanges, false);
    });
  });

  describe('single stack diff', () => {
    const result = parseCdkDiff(SINGLE_STACK);

    test('totals match', () => {
      assert.equal(result.totalAdded, 1);
      assert.equal(result.totalModified, 1);
      assert.equal(result.totalRemoved, 0);
    });
  });

  describe('empty input', () => {
    test('returns empty result', () => {
      const result = parseCdkDiff('');
      assert.equal(result.stacks.length, 0);
      assert.equal(result.totalAdded, 0);
    });
  });
});
