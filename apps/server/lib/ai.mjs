function heuristic(capture) {
  const consoleErrors = capture.events.filter((e) => e.type === 'console' && ['error', 'exception'].includes(e.level || e.data?.level));
  const failedRequests = capture.events.filter((e) => e.type === 'network' && (Number(e.data?.status || 0) >= 400 || e.data?.failed));
  const actions = capture.events.filter((e) => e.type === 'action');
  const lastActions = actions.slice(-5).map((e) => e.data?.label || e.data?.action || e.data?.target).filter(Boolean);
  const firstError = consoleErrors[0];
  const firstFailed = failedRequests[0];
  let likely = 'No obvious exception or failed HTTP request was captured.';
  if (firstError) likely = `The first captured console error is: ${String(firstError.data?.message || firstError.data?.args || 'unknown error').slice(0, 800)}`;
  else if (firstFailed) likely = `A failing request appears central to the issue: ${firstFailed.data?.method || 'GET'} ${firstFailed.data?.url || ''} returned ${firstFailed.data?.status || 'a network failure'}.`;
  return {
    provider: 'local-heuristic',
    summary: `${capture.title}. ${consoleErrors.length} console error(s), ${failedRequests.length} failed request(s), and ${actions.length} user action(s) were captured.`,
    reproductionSteps: lastActions.length ? lastActions.map((a, i) => `${i + 1}. ${a}`).join('\n') : 'Use the capture timeline to reproduce the recorded interaction.',
    likelyCause: likely,
    evidence: {
      consoleErrors: consoleErrors.slice(0, 5),
      failedRequests: failedRequests.slice(0, 5),
      lastActions: actions.slice(-10)
    }
  };
}

export async function analyzeCapture(capture, config, fetchImpl = fetch) {
  if (!config.baseUrl || !config.apiKey || !config.model) return heuristic(capture);
  const evidence = {
    title: capture.title,
    description: capture.description,
    url: capture.url,
    environment: capture.environment,
    metadata: capture.metadata,
    console: capture.events.filter((e) => e.type === 'console').slice(-40),
    networkFailures: capture.events.filter((e) => e.type === 'network' && (Number(e.data?.status || 0) >= 400 || e.data?.failed)).slice(-30),
    actions: capture.events.filter((e) => e.type === 'action').slice(-40)
  };
  const endpoint = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'authorization': `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: 'You analyze software bug captures. Return strict JSON with keys summary, reproductionSteps, likelyCause, evidenceNotes. Do not invent facts.' },
        { role: 'user', content: JSON.stringify(evidence) }
      ],
      response_format: { type: 'json_object' }
    })
  });
  if (!res.ok) throw new Error(`AI provider returned ${res.status}: ${(await res.text()).slice(0, 1000)}`);
  const body = await res.json();
  const content = body.choices?.[0]?.message?.content || '{}';
  let parsed;
  try { parsed = JSON.parse(content); } catch { parsed = { summary: content }; }
  return { provider: config.model, ...parsed };
}
