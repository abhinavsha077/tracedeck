function captureMarkdown(capture, publicUrl) {
  const errors = capture.events.filter((e) => e.type === 'console' && ['error', 'exception'].includes(e.level || e.data?.level)).slice(0, 10);
  const failed = capture.events.filter((e) => e.type === 'network' && Number(e.data?.status || 0) >= 400).slice(0, 10);
  return [
    capture.description || '',
    '',
    `TraceDeck capture: ${publicUrl}/app/?capture=${encodeURIComponent(capture.id)}`,
    `Source URL: ${capture.url || 'n/a'}`,
    `Environment: ${JSON.stringify(capture.environment || {})}`,
    errors.length ? `\nConsole errors:\n${errors.map((e) => `- ${String(e.data?.message || e.data?.args || 'error').slice(0, 500)}`).join('\n')}` : '',
    failed.length ? `\nFailed requests:\n${failed.map((e) => `- ${e.data?.method || 'GET'} ${e.data?.url || ''} → ${e.data?.status || 'failed'}`).join('\n')}` : ''
  ].filter(Boolean).join('\n');
}

async function expectJson(res) {
  const text = await res.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!res.ok) throw new Error(`Integration request failed (${res.status}): ${text.slice(0, 1000)}`);
  return body;
}

export async function createExternalIssue(provider, capture, options, config, publicUrl, fetchImpl = fetch) {
  const title = options.title || capture.title;
  const description = options.description || captureMarkdown(capture, publicUrl);

  if (provider === 'github') {
    const token = options.token || config.githubToken;
    const repo = options.repo || config.githubRepo;
    if (!token || !repo) throw new Error('GitHub token and owner/repo are required');
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: { 'authorization': `Bearer ${token}`, 'accept': 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'TraceDeck' },
      body: JSON.stringify({ title, body: description, labels: options.labels || [] })
    });
    const body = await expectJson(res);
    return { provider, id: String(body.number), url: body.html_url, title: body.title };
  }

  if (provider === 'linear') {
    const token = options.token || config.linearToken;
    if (!token || !options.teamId) throw new Error('Linear token and teamId are required');
    const authHeader = token.startsWith('Bearer ') ? token : (token.startsWith('lin_oauth_') ? `Bearer ${token}` : token);
    const query = `mutation IssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier title url } } }`;
    const res = await fetchImpl('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { 'authorization': authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { input: { teamId: options.teamId, title, description } } })
    });
    const body = await expectJson(res);
    if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));
    const issue = body.data?.issueCreate?.issue;
    return { provider, id: issue?.identifier || issue?.id, url: issue?.url, title: issue?.title || title };
  }

  if (provider === 'jira') {
    let baseUrl = String(options.baseUrl || config.jiraBaseUrl || '').trim().replace(/\/$/, '');
    if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
      baseUrl = `https://${baseUrl}`;
    }
    const email = options.email || config.jiraEmail;
    const token = options.token || config.jiraToken;
    const projectKey = options.projectKey;
    if (!baseUrl || !email || !token || !projectKey) throw new Error('Jira baseUrl, email, token and projectKey are required');
    const auth = Buffer.from(`${email}:${token}`).toString('base64');
    const res = await fetchImpl(`${baseUrl}/rest/api/3/issue`, {
      method: 'POST',
      headers: { 'authorization': `Basic ${auth}`, 'content-type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify({
        fields: {
          project: { key: projectKey },
          summary: title,
          issuetype: { name: options.issueType || 'Bug' },
          description: {
            type: 'doc', version: 1,
            content: [{ type: 'paragraph', content: [{ type: 'text', text: description.slice(0, 30_000) }] }]
          }
        }
      })
    });
    const body = await expectJson(res);
    return { provider, id: body.key || body.id, url: body.key ? `${baseUrl}/browse/${body.key}` : undefined, title };
  }

  if (provider === 'slack') {
    const webhookUrl = options.webhookUrl || config.slackWebhookUrl;
    if (!webhookUrl) throw new Error('Slack webhook URL is required');
    const res = await fetchImpl(webhookUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: `*${title}*\n${description.slice(0, 3500)}` })
    });
    if (!res.ok) throw new Error(`Slack webhook failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
    return { provider, id: `slack-${Date.now()}`, url: null, title };
  }

  throw new Error(`Unsupported provider: ${provider}`);
}
