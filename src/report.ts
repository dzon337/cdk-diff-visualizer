import { ParsedDiff, StackDiff, ResourceChange } from './parser';

const CHANGE_EMOJI: Record<string, string> = {
  add: '✅',
  modify: '⚠️',
  remove: '❌',
};

const CHANGE_LABEL: Record<string, string> = {
  add: 'Added',
  modify: 'Modified',
  remove: 'Removed',
};

function renderResourceRow(r: ResourceChange): string {
  const emoji = CHANGE_EMOJI[r.changeType];
  const label = CHANGE_LABEL[r.changeType];
  const shortType = r.awsType.replace('AWS::', '').replace('::', ' › ');
  return `
    <tr class="change-row change-${r.changeType}">
      <td class="change-type">${emoji} ${label}</td>
      <td class="logical-id"><code>${r.logicalId}</code></td>
      <td class="aws-type">${shortType}</td>
      ${r.physicalId ? `<td class="physical-id"><code class="physical">${r.physicalId.substring(0, 60)}${r.physicalId.length > 60 ? '…' : ''}</code></td>` : '<td></td>'}
    </tr>`;
}

function renderStack(stack: StackDiff): string {
  const added = stack.resources.filter((r) => r.changeType === 'add').length;
  const modified = stack.resources.filter((r) => r.changeType === 'modify').length;
  const removed = stack.resources.filter((r) => r.changeType === 'remove').length;

  const badges = [
    added ? `<span class="badge badge-add">+${added} added</span>` : '',
    modified ? `<span class="badge badge-modify">~${modified} modified</span>` : '',
    removed ? `<span class="badge badge-remove">-${removed} removed</span>` : '',
    stack.hasIamChanges ? `<span class="badge badge-iam">🔐 IAM</span>` : '',
    stack.hasSecurityGroupChanges ? `<span class="badge badge-iam">🛡 SG</span>` : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (stack.noChanges && stack.resources.length === 0) {
    return `
      <div class="stack-block">
        <div class="stack-header">
          <span class="stack-name">${stack.stackName}</span>
          <span class="badge badge-nochange">No changes</span>
        </div>
      </div>`;
  }

  const iamWarning =
    stack.hasIamChanges || stack.hasSecurityGroupChanges
      ? `<tr class="iam-warning-row">
          <td colspan="4">🔐 This stack contains IAM / Security Group changes — review carefully before merging.</td>
        </tr>`
      : '';

  return `
    <div class="stack-block">
      <div class="stack-header">
        <span class="stack-name">${stack.stackName}</span>
        <span class="badges">${badges}</span>
      </div>
      <table class="resource-table">
        <thead>
          <tr>
            <th>Change</th>
            <th>Logical ID</th>
            <th>Type</th>
            <th>Physical ID</th>
          </tr>
        </thead>
        <tbody>
          ${iamWarning}
          ${stack.resources.map(renderResourceRow).join('')}
        </tbody>
      </table>
    </div>`;
}

export function generateHtml(diff: ParsedDiff, prUrl?: string, rawDiff?: string): string {
  const prLink = prUrl
    ? `<a class="pr-link" href="${prUrl}">🔗 View Pull Request</a>`
    : '';

  const securityBanner = diff.hasSecurityChanges
    ? `<div class="security-banner">⚠️ Security-sensitive changes detected (IAM / Security Groups). Review before merging.</div>`
    : '';

  const rawSection = rawDiff
    ? `<details class="raw-details">
        <summary>Raw cdk diff output</summary>
        <pre class="raw-diff">${rawDiff.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
      </details>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CDK Diff Report</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; color: #1a1a1a; background: #f5f5f5; padding: 2rem; }
    .container { max-width: 960px; margin: 0 auto; }
    .report-header { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 1.5rem 2rem; margin-bottom: 1.5rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem; }
    .report-title { font-size: 20px; font-weight: 600; }
    .report-meta { font-size: 13px; color: #666; margin-top: 4px; }
    .pr-link { display: inline-block; background: #0052cc; color: #fff; text-decoration: none; padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 500; }
    .pr-link:hover { background: #0043a6; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 1.5rem; }
    .stat-card { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 1rem 1.25rem; }
    .stat-num { font-size: 28px; font-weight: 600; line-height: 1; }
    .stat-label { font-size: 12px; color: #666; margin-top: 4px; }
    .stat-add .stat-num { color: #1a7f37; }
    .stat-modify .stat-num { color: #9a6700; }
    .stat-remove .stat-num { color: #cf222e; }
    .stat-security .stat-num { color: #0550ae; }
    .security-banner { background: #fff8c5; border: 1px solid #d4a72c; border-radius: 8px; padding: 12px 16px; margin-bottom: 1.5rem; font-size: 13px; color: #6e4f00; font-weight: 500; }
    .stack-block { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; margin-bottom: 1rem; overflow: hidden; }
    .stack-header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #e0e0e0; background: #fafafa; flex-wrap: wrap; }
    .stack-name { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 14px; font-weight: 600; }
    .badges { display: flex; gap: 6px; flex-wrap: wrap; margin-left: auto; }
    .badge { font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 4px; }
    .badge-add { background: #dafbe1; color: #1a7f37; }
    .badge-modify { background: #fff8c5; color: #9a6700; }
    .badge-remove { background: #ffebe9; color: #cf222e; }
    .badge-iam { background: #ddf4ff; color: #0550ae; }
    .badge-nochange { background: #f0f0f0; color: #666; }
    .resource-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .resource-table thead th { text-align: left; padding: 8px 16px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #666; font-weight: 600; border-bottom: 1px solid #e0e0e0; background: #fafafa; }
    .resource-table tbody tr { border-bottom: 1px solid #f0f0f0; }
    .resource-table tbody tr:last-child { border-bottom: none; }
    .resource-table td { padding: 9px 16px; vertical-align: middle; }
    .change-row.change-add { border-left: 3px solid #1a7f37; }
    .change-row.change-modify { border-left: 3px solid #d4a72c; }
    .change-row.change-remove { border-left: 3px solid #cf222e; }
    .change-type { font-size: 12px; font-weight: 600; white-space: nowrap; }
    .logical-id code { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; background: #f5f5f5; padding: 2px 6px; border-radius: 4px; }
    .aws-type { color: #444; }
    .physical { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 11px; color: #888; }
    .iam-warning-row td { background: #fff8c5; color: #6e4f00; font-size: 12px; font-weight: 500; padding: 8px 16px; border-left: 3px solid #d4a72c; }
    .raw-details { margin-top: 1.5rem; background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; }
    .raw-details summary { padding: 12px 16px; cursor: pointer; font-size: 13px; font-weight: 500; color: #444; background: #fafafa; border-bottom: 1px solid #e0e0e0; }
    .raw-diff { padding: 1rem 1.25rem; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; line-height: 1.6; overflow-x: auto; white-space: pre; color: #333; }
    .footer { margin-top: 1.5rem; font-size: 12px; color: #999; text-align: center; }
    @media (max-width: 600px) { .summary-grid { grid-template-columns: repeat(2, 1fr); } }
  </style>
</head>
<body>
  <div class="container">
    <div class="report-header">
      <div>
        <div class="report-title">🚀 CDK Diff Report</div>
        <div class="report-meta">Generated at ${new Date().toISOString()} · ${diff.stacks.length} stack(s)</div>
      </div>
      ${prLink}
    </div>

    <div class="summary-grid">
      <div class="stat-card stat-add"><div class="stat-num">${diff.totalAdded}</div><div class="stat-label">Resources added</div></div>
      <div class="stat-card stat-modify"><div class="stat-num">${diff.totalModified}</div><div class="stat-label">Resources modified</div></div>
      <div class="stat-card stat-remove"><div class="stat-num">${diff.totalRemoved}</div><div class="stat-label">Resources removed</div></div>
      <div class="stat-card stat-security"><div class="stat-num">${diff.stacks.filter((s) => s.hasIamChanges || s.hasSecurityGroupChanges).length}</div><div class="stat-label">Stacks with IAM changes</div></div>
    </div>

    ${securityBanner}
    ${diff.stacks.map(renderStack).join('')}
    ${rawSection}

    <div class="footer">Generated by cdk-diff-report</div>
  </div>
</body>
</html>`;
}

export function generateMarkdownComment(diff: ParsedDiff, prUrl?: string, htmlReportUrl?: string): string {
  const lines: string[] = [];

  lines.push('## 🚀 CDK Diff Report');
  lines.push('');

  if (diff.hasSecurityChanges) {
    lines.push('> ⚠️ **Security-sensitive changes detected** (IAM / Security Groups). Review carefully before merging.');
    lines.push('');
  }

  // Summary table
  lines.push('| ✅ Added | ⚠️ Modified | ❌ Removed | 🔐 IAM stacks |');
  lines.push('|---------|------------|-----------|--------------|');
  const iamCount = diff.stacks.filter((s) => s.hasIamChanges || s.hasSecurityGroupChanges).length;
  lines.push(`| ${diff.totalAdded} | ${diff.totalModified} | ${diff.totalRemoved} | ${iamCount} |`);
  lines.push('');

  // Per-stack breakdown
  for (const stack of diff.stacks) {
    const added = stack.resources.filter((r) => r.changeType === 'add').length;
    const modified = stack.resources.filter((r) => r.changeType === 'modify').length;
    const removed = stack.resources.filter((r) => r.changeType === 'remove').length;

    const badges = [
      added ? `+${added}` : '',
      modified ? `~${modified}` : '',
      removed ? `-${removed}` : '',
      stack.hasIamChanges ? '🔐 IAM' : '',
    ]
      .filter(Boolean)
      .join(' · ');

    lines.push(`<details>`);
    lines.push(`<summary><strong>${stack.stackName}</strong>${badges ? ` — ${badges}` : ''}</summary>`);
    lines.push('');

    if (stack.noChanges && stack.resources.length === 0) {
      lines.push('No changes in this stack.');
    } else {
      if (stack.hasIamChanges || stack.hasSecurityGroupChanges) {
        lines.push('> 🔐 IAM / Security Group changes — check the full diff before approving.');
        lines.push('');
      }
      lines.push('| Change | Logical ID | Type |');
      lines.push('|--------|-----------|------|');
      for (const r of stack.resources) {
        const emoji = CHANGE_EMOJI[r.changeType];
        const label = CHANGE_LABEL[r.changeType];
        const shortType = r.awsType.replace('AWS::', '').replace('::', ' › ');
        lines.push(`| ${emoji} ${label} | \`${r.logicalId}\` | ${shortType} |`);
      }
    }

    lines.push('');
    lines.push('</details>');
    lines.push('');
  }

  if (prUrl) {
    lines.push(`🔗 [View Pull Request](${prUrl})`);
    lines.push('');
  }

  if (htmlReportUrl) {
    lines.push(`📄 [View full HTML report](${htmlReportUrl})`);
    lines.push('');
  }

  lines.push('---');
  lines.push('*Generated by [cdk-diff-report](https://www.npmjs.com/package/cdk-diff-report)*');

  return lines.join('\n');
}
