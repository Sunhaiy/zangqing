import path from 'path';
import type { LLMToolCall } from '../../llm.js';
import type { PlanState } from '../../../src/shared/aiTypes.js';
import type { AgentPlanPhase, TaskRunSummary } from '../../../src/shared/types.js';
import type { AgentArtifact } from '../types.js';

const WINDOWS_LOCAL_PROJECT_PATH_RE = /(?:[A-Za-z]:\\|\\\\)[^\r\n"'`<>|,，。；：、]+(?: [^\r\n"'`<>|,，。；：、]+)*/g;
const POSIX_LOCAL_PROJECT_PATH_RE = /\/(?:Users|home|opt|srv|var|tmp)[^\s\r\n"'`<>|,，。；：、]*/g;

export const CONTINUE_INTENT_RE = /^(?:continue|resume|retry|go on|keep going|继续|继续处理|继续执行|继续部署|接着|接着做|再试一次|重试)\s*[,，。！!?:;；：]*$/i;
export const STATUS_QUERY_RE = /^(?:status|what are you doing|what's the current status|what is the current status|你现在在干什么|现在在做什么|当前在做什么|当前进度|什么进度|啥进度)\s*[?？!！]*$/i;
export const OPTION_SELECTION_RE = /^(?:[ab]|[12]|option\s*[ab12]|方案\s*[ab]|选\s*[ab12])$/i;
export const LOCAL_PROJECT_PATH_RE = process.platform === 'win32'
  ? WINDOWS_LOCAL_PROJECT_PATH_RE
  : POSIX_LOCAL_PROJECT_PATH_RE;
export const GITHUB_PROJECT_URL_RE = /https?:\/\/github\.com\/[^\s"'`<>]+/ig;
export const MAX_GENERIC_TURNS = 48;
export const MAX_AUTONOMOUS_REPAIRS = 5;

const TOOL_LABELS: Record<string, string> = {
  local_list_directory: 'Inspect local directory',
  local_read_file: 'Read local file',
  local_write_file: 'Write local file',
  local_exec: 'Run local command',
  remote_exec: 'Run remote command',
  remote_list_directory: 'Inspect remote directory',
  remote_read_file: 'Read remote file',
  remote_write_file: 'Write remote file',
  remote_upload_file: 'Upload file',
  remote_download_file: 'Download file',
  http_probe: 'Probe HTTP endpoint',
  service_inspect: 'Inspect service',
  service_control: 'Control service',
  task_create: 'Create child task',
  agent_fork: 'Fork child agent',
  todo_write: 'Update todo list',
  todo_read: 'Read todo list',
  git_clone_remote: 'Clone remote repository',
  git_fetch_remote: 'Fetch remote repository',
};

export function now() {
  return Date.now();
}

export function clip(text: string, maxChars = 2000) {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n...[truncated]`;
}

export function createPlanState(goal: string): PlanState {
  return {
    global_goal: goal,
    scratchpad: '',
    plan: [],
  };
}

export function serializeValue(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

export function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function isContinueIntent(input: string) {
  return CONTINUE_INTENT_RE.test(input.trim());
}

export function isStatusQuery(input: string) {
  return STATUS_QUERY_RE.test(input.trim());
}

export function isOptionSelection(input: string) {
  return OPTION_SELECTION_RE.test(input.trim());
}

export function looksLikeSiteFollowUpGoal(input: string) {
  const lowered = input.toLowerCase();
  return (
    /\bhttps?:\/\/[^\s"'`<>]+/.test(lowered)
    || /\b[a-z0-9.-]+\.[a-z]{2,}\b/.test(lowered)
    || /\b(?:https|ssl|certbot|certificate|tls|domain|dns|nginx|server_name|proxy_pass)\b/.test(lowered)
    || /域名|证书|续签|网站|站点|解析|nginx|https|ssl|dns/.test(input)
  );
}

export function cleanDeployCandidate(input: string) {
  return input.trim().replace(/[),.;!?，。；：]+$/, '');
}

export function extractDeploySource(input: string, knownPaths: string[]): string | null {
  const githubMatches = input.match(GITHUB_PROJECT_URL_RE) || [];
  if (githubMatches.length > 0) {
    return cleanDeployCandidate(githubMatches[0] || '');
  }

  const localMatches = input.match(LOCAL_PROJECT_PATH_RE) || [];
  if (localMatches.length > 0) {
    const best = localMatches.sort((a, b) => b.length - a.length)[0];
    return best ? cleanDeployCandidate(best) : null;
  }

  return knownPaths.length > 0 ? knownPaths[knownPaths.length - 1] || null : null;
}

function summarizePrimaryArgument(args: Record<string, unknown>) {
  if (typeof args.command === 'string') return args.command;
  if (typeof args.goal === 'string') return args.goal;
  if (typeof args.path === 'string') return args.path;
  if (typeof args.remotePath === 'string') {
    const localPath = typeof args.localPath === 'string' ? args.localPath : 'local';
    return `${localPath} -> ${args.remotePath}`;
  }
  if (typeof args.repoUrl === 'string') return args.repoUrl;
  if (typeof args.serviceName === 'string') {
    return `${typeof args.action === 'string' ? args.action : ''} ${args.serviceName}`.trim();
  }
  return '';
}

export function toolCallSummary(name: string, args: Record<string, unknown>): string {
  const label = TOOL_LABELS[name] || name;
  const primaryArg = summarizePrimaryArgument(args);
  return primaryArg ? `${label}: ${primaryArg}` : label;
}

export function makeArtifact(title: string, content: string): AgentArtifact {
  const id = `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    title,
    preview: clip(content.replace(/\s+\n/g, '\n').trim(), 1000),
    content,
    createdAt: Date.now(),
  };
}

export function phaseToPlanStatus(run: TaskRunSummary): AgentPlanPhase {
  if (run.status === 'completed') return 'done';
  if (run.status === 'retryable_paused' || run.status === 'paused') return 'paused';
  if (run.status === 'failed') return 'stopped';
  if (run.phase === 'understand' || run.phase === 'inspect' || run.phase === 'hypothesize') return 'generating';
  return 'executing';
}

export function formatElapsed(ms: number) {
  const totalSeconds = Math.max(1, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export function sourceTypeFromLabel(label: string) {
  return /^https?:\/\/github\.com\//i.test(label) ? 'github' : 'local';
}

export function buildTaskRunId() {
  return `task-run-${now()}`;
}

export function summarizeToolCalls(toolCalls: LLMToolCall[] | undefined) {
  if (!toolCalls?.length) return '';
  return toolCalls.map((toolCall) => {
    const args = safeParseArgs(toolCall.function.arguments);
    return toolCallSummary(toolCall.function.name, args);
  }).join('\n');
}

export function normalizePathCandidate(candidate: string) {
  return candidate.includes('\\') ? path.normalize(candidate.trim()) : candidate.trim();
}
