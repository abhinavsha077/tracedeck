import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));

export const config = {
  root,
  host: process.env.TRACEDECK_HOST || '127.0.0.1',
  port: Number(process.env.TRACEDECK_PORT || 4177),
  publicUrl: process.env.TRACEDECK_PUBLIC_URL || `http://localhost:${process.env.TRACEDECK_PORT || 4177}`,
  dataDir: path.resolve(root, process.env.TRACEDECK_DATA_DIR || 'data'),
  maxUploadBytes: Number(process.env.TRACEDECK_MAX_UPLOAD_MB || 200) * 1024 * 1024,
  signingSecret: process.env.TRACEDECK_SIGNING_SECRET || 'dev-only-change-me',
  ai: {
    baseUrl: process.env.TRACEDECK_AI_BASE_URL || '',
    apiKey: process.env.TRACEDECK_AI_API_KEY || '',
    model: process.env.TRACEDECK_AI_MODEL || ''
  },
  integrations: {
    githubToken: process.env.TRACEDECK_GITHUB_TOKEN || '',
    githubRepo: process.env.TRACEDECK_GITHUB_REPO || '',
    linearToken: process.env.TRACEDECK_LINEAR_TOKEN || '',
    jiraBaseUrl: process.env.TRACEDECK_JIRA_BASE_URL || '',
    jiraEmail: process.env.TRACEDECK_JIRA_EMAIL || '',
    jiraToken: process.env.TRACEDECK_JIRA_TOKEN || '',
    slackWebhookUrl: process.env.TRACEDECK_SLACK_WEBHOOK_URL || ''
  }
};
