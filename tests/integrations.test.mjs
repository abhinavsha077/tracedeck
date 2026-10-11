import test from 'node:test';
import assert from 'node:assert/strict';
import { createExternalIssue } from '../apps/server/lib/integrations.mjs';

const sampleCapture = {
  id: 'cap_int_test',
  title: 'Bug: Payment flow crashed',
  description: 'User clicked pay and got 500 error',
  url: 'https://app.example/pay',
  environment: { browser: 'Chrome 122' },
  events: [
    { type: 'console', level: 'error', data: { message: 'Network error 500' } },
    { type: 'network', data: { method: 'POST', url: 'https://api.example/pay', status: 500 } }
  ]
};

test('Linear adapter creates issue via GraphQL mutation', async () => {
  let capturedReq;
  const mockFetch = async (url, options) => {
    capturedReq = { url, options };
    return new Response(JSON.stringify({
      data: {
        issueCreate: {
          success: true,
          issue: {
            id: 'lin_issue_1',
            identifier: 'ENG-42',
            title: 'Bug: Payment flow crashed',
            url: 'https://linear.app/team/issue/ENG-42'
          }
        }
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const issue = await createExternalIssue('linear', sampleCapture, {
    token: 'lin_api_testtoken123',
    teamId: 'team_eng_1'
  }, {}, 'http://localhost:4177', mockFetch);

  assert.equal(issue.provider, 'linear');
  assert.equal(issue.id, 'ENG-42');
  assert.equal(issue.url, 'https://linear.app/team/issue/ENG-42');
  assert.equal(capturedReq.url, 'https://api.linear.app/graphql');
  assert.equal(capturedReq.options.headers.authorization, 'lin_api_testtoken123');

  const parsedBody = JSON.parse(capturedReq.options.body);
  assert.equal(parsedBody.variables.input.teamId, 'team_eng_1');
  assert.equal(parsedBody.variables.input.title, 'Bug: Payment flow crashed');
  assert.match(parsedBody.variables.input.description, /Network error 500/);
});

test('Linear adapter handles GraphQL errors and missing config', async () => {
  // Missing teamId
  await assert.rejects(
    async () => createExternalIssue('linear', sampleCapture, { token: 'x' }, {}, 'http://localhost:4177'),
    /Linear token and teamId are required/
  );

  // GraphQL error response
  const mockFetchError = async () => new Response(JSON.stringify({
    errors: [{ message: 'Team not found' }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  await assert.rejects(
    async () => createExternalIssue('linear', sampleCapture, { token: 'x', teamId: 'bad_team' }, {}, 'http://localhost:4177', mockFetchError),
    /Team not found/
  );
});

test('Jira adapter creates issue via REST API v3 with ADF format', async () => {
  let capturedReq;
  const mockFetch = async (url, options) => {
    capturedReq = { url, options };
    return new Response(JSON.stringify({
      id: '10042',
      key: 'DEV-1042',
      self: 'https://myteam.atlassian.net/rest/api/3/issue/10042'
    }), { status: 201, headers: { 'content-type': 'application/json' } });
  };

  const issue = await createExternalIssue('jira', sampleCapture, {
    baseUrl: 'myteam.atlassian.net', // Test auto-prefixing https://
    email: 'engineer@example.com',
    token: 'jira_api_token_xyz',
    projectKey: 'DEV'
  }, {}, 'http://localhost:4177', mockFetch);

  assert.equal(issue.provider, 'jira');
  assert.equal(issue.id, 'DEV-1042');
  assert.equal(issue.url, 'https://myteam.atlassian.net/browse/DEV-1042');
  assert.equal(capturedReq.url, 'https://myteam.atlassian.net/rest/api/3/issue');

  const expectedAuth = Buffer.from('engineer@example.com:jira_api_token_xyz').toString('base64');
  assert.equal(capturedReq.options.headers.authorization, `Basic ${expectedAuth}`);

  const parsedBody = JSON.parse(capturedReq.options.body);
  assert.equal(parsedBody.fields.project.key, 'DEV');
  assert.equal(parsedBody.fields.issuetype.name, 'Bug');
  assert.equal(parsedBody.fields.summary, 'Bug: Payment flow crashed');
  assert.equal(parsedBody.fields.description.type, 'doc');
  assert.match(parsedBody.fields.description.content[0].content[0].text, /TraceDeck capture/);
});

test('Jira adapter catches missing credentials cleanly', async () => {
  await assert.rejects(
    async () => createExternalIssue('jira', sampleCapture, {}, {}, 'http://localhost:4177'),
    /Jira baseUrl, email, token and projectKey are required/
  );

  await assert.rejects(
    async () => createExternalIssue('jira', sampleCapture, { baseUrl: 'https://test.atlassian.net', projectKey: 'DEV' }, {}, 'http://localhost:4177'),
    /Jira baseUrl, email, token and projectKey are required/
  );
});

test('Slack adapter posts formatted message to incoming webhook', async () => {
  let capturedReq;
  const mockFetch = async (url, options) => {
    capturedReq = { url, options };
    return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } });
  };

  const issue = await createExternalIssue('slack', sampleCapture, {
    webhookUrl: 'https://hooks.slack.com/services/T00/B00/X00'
  }, {}, 'http://localhost:4177', mockFetch);

  assert.equal(issue.provider, 'slack');
  assert.equal(capturedReq.url, 'https://hooks.slack.com/services/T00/B00/X00');
  const body = JSON.parse(capturedReq.options.body);
  assert.match(body.text, /\*Bug: Payment flow crashed\*/);
  assert(Array.isArray(body.blocks));
  assert.equal(body.blocks[0].type, 'header');
  assert.equal(body.blocks[2].type, 'actions');
});

test('GitHub adapter normalizes full repository URLs cleanly', async () => {
  let capturedReq;
  const mockFetch = async (url, options) => {
    capturedReq = { url, options };
    return new Response(JSON.stringify({ number: 99, html_url: 'https://github.com/acme/app/issues/99', title: 'Issue 99' }), { status: 201, headers: { 'content-type': 'application/json' } });
  };

  const issue = await createExternalIssue('github', sampleCapture, {
    token: 'gh_test_token',
    repo: 'https://github.com/acme/app/'
  }, {}, 'http://localhost:4177', mockFetch);

  assert.equal(issue.id, '99');
  assert.equal(capturedReq.url, 'https://api.github.com/repos/acme/app/issues');
  const parsed = JSON.parse(capturedReq.options.body);
  assert.deepEqual(parsed.labels, ['bug', 'tracedeck']);
});
