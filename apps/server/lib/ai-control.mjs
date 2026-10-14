// Integration bridge to Arc - Ai Open Route (AI-Control Plane)
// Transforms TraceDeck bug captures into verifiable autonomous fix capsules

import { triageCapture } from './triage.mjs';
import { generatePlaywright } from './playwright.mjs';

export function buildTaskCapsule(capture) {
  if (!capture) throw new Error('Capture required to build task capsule');

  const triage = triageCapture(capture);
  const playwrightSpec = generatePlaywright(capture);

  const errors = (capture.events || [])
    .filter(e => e.type === 'console' && ['error', 'exception'].includes(e.level || e.data?.level))
    .map(e => e.text || e.message || e.data?.text || '');

  const failedRequests = (capture.events || [])
    .filter(e => e.type === 'network' && (Number(e.status || e.data?.status || 0) >= 400 || e.failed))
    .map(e => ({
      method: e.method || e.data?.method || 'GET',
      url: e.url || e.data?.url || '',
      status: e.status || e.data?.status || 0
    }));

  return {
    taskId: `fix_${capture.id}`,
    task: `Fix bug captured in TraceDeck: ${capture.title}`,
    summary: capture.description || capture.title,
    severity: triage.severity,
    targetUrl: capture.url,
    causalChain: triage.causalChain || triage.chain || [],
    recommendedFix: triage.suggestedFix || triage.fixDirection || 'Inspect reproduction',
    environment: capture.environment || {},
    metadata: capture.metadata || {},
    reproductionSpec: playwrightSpec,
    diagnostics: {
      errors,
      failedRequests,
      w3cTrace: triage.causalChain?.find(c => c.traceparent)?.traceparent || triage.w3cTrace || null
    },
    worktree: {
      suggestedBranch: `fix/td-${capture.id}`,
      isolation: 'git-worktree'
    }
  };
}

export async function dispatchAutoFix(capture, options = {}) {
  const capsule = buildTaskCapsule(capture);
  const aiControlUrl = options.aiControlUrl || process.env.AI_CONTROL_URL || 'http://127.0.0.1:8000';

  let remoteResponse = null;
  try {
    const res = await fetch(`${aiControlUrl}/api/tasks/route`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(capsule),
      signal: AbortSignal.timeout(options.timeoutMs || 3000)
    });
    if (res.ok) {
      remoteResponse = await res.json();
    }
  } catch (err) {
    // Service offline or timeout; fallback to structured local capsule
  }

  return {
    status: remoteResponse ? 'dispatched_to_ai_control' : 'capsule_prepared',
    connectedToControlPlane: Boolean(remoteResponse),
    capsule,
    branch: capsule.worktree.suggestedBranch,
    remoteResult: remoteResponse,
    instructions: `Run verification: npx playwright test ${capsule.worktree.suggestedBranch}`
  };
}
