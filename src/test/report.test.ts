import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseCdkDiff } from '../parser';
import { generateMarkdownComment, generateHtml } from '../report';

const DIFF_WITH_IAM = `
Stack PipelineStack
IAM Statement Changes
┌───┬──────────────────┬────────┬──────────────────┐
│ + │ arn:aws:iam::123 │ Allow  │ sts:AssumeRole   │
└───┴──────────────────┴────────┴──────────────────┘
Resources
[+] AWS::IAM::Role MyRole MyRoleABC
[~] AWS::Lambda::Function MyFn MyFnDEF
[-] AWS::SQS::Queue OldQueue OldQueueGHI

Stack CleanStack
Resources
[+] AWS::S3::Bucket NewBucket NewBucketXYZ
`;

describe('generateMarkdownComment', () => {
  const diff = parseCdkDiff(DIFF_WITH_IAM);
  const PR_URL = 'https://bitbucket.org/acme/repo/pull-requests/99';

  test('contains report heading', () => {
    const md = generateMarkdownComment(diff, PR_URL);
    assert.ok(md.includes('## 🚀 CDK Diff Report'));
  });

  test('contains summary table with correct counts', () => {
    const md = generateMarkdownComment(diff, PR_URL);
    assert.ok(md.includes('| 2 |'));   // 2 added
    assert.ok(md.includes('| 1 |'));   // 1 modified, 1 removed, 1 IAM stack
  });

  test('includes security warning when IAM changes present', () => {
    const md = generateMarkdownComment(diff, PR_URL);
    assert.ok(md.includes('Security-sensitive changes detected'));
  });

  test('does not include security warning when no IAM changes', () => {
    const cleanDiff = parseCdkDiff(`
Stack MyStack
Resources
[+] AWS::S3::Bucket MyBucket
    `);
    const md = generateMarkdownComment(cleanDiff);
    assert.ok(!md.includes('Security-sensitive'));
  });

  test('contains stack names in details blocks', () => {
    const md = generateMarkdownComment(diff, PR_URL);
    assert.ok(md.includes('PipelineStack'));
    assert.ok(md.includes('CleanStack'));
  });

  test('includes resource logical IDs', () => {
    const md = generateMarkdownComment(diff, PR_URL);
    assert.ok(md.includes('MyRole'));
    assert.ok(md.includes('MyFn'));
    assert.ok(md.includes('OldQueue'));
  });

  test('includes PR URL when provided', () => {
    const md = generateMarkdownComment(diff, PR_URL);
    assert.ok(md.includes(PR_URL));
  });

  test('omits PR link when no URL provided', () => {
    const md = generateMarkdownComment(diff);
    assert.ok(!md.includes('bitbucket.org'));
  });

  test('includes cdk-diff-report attribution', () => {
    const md = generateMarkdownComment(diff);
    assert.ok(md.includes('cdk-diff-report'));
  });
});

describe('generateHtml', () => {
  const diff = parseCdkDiff(DIFF_WITH_IAM);

  test('produces valid HTML structure', () => {
    const html = generateHtml(diff);
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('</html>'));
  });

  test('includes stack names', () => {
    const html = generateHtml(diff);
    assert.ok(html.includes('PipelineStack'));
    assert.ok(html.includes('CleanStack'));
  });

  test('includes summary counts', () => {
    const html = generateHtml(diff);
    assert.ok(html.includes('Resources added'));
    assert.ok(html.includes('Resources modified'));
    assert.ok(html.includes('Resources removed'));
  });

  test('includes PR link when URL provided', () => {
    const html = generateHtml(diff, 'https://bitbucket.org/acme/repo/pull-requests/99');
    assert.ok(html.includes('View Pull Request'));
  });

  test('includes security banner for IAM changes', () => {
    const html = generateHtml(diff);
    assert.ok(html.includes('security-banner'));
  });

  test('includes raw diff in details block when provided', () => {
    const html = generateHtml(diff, undefined, 'raw output here');
    assert.ok(html.includes('Raw cdk diff output'));
    assert.ok(html.includes('raw output here'));
  });
});
