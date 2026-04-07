import { WebContents } from 'electron';
import { LLMProfile } from '../llm.js';
import type { AgentSessionRuntime } from '../../src/shared/types.js';
import { SSHManager } from '../ssh/sshManager.js';
import type { AgentRuntimeMessage } from './types.js';
import { AgentEventBus } from './runtime/eventBus.js';
import { AgentSessionStore } from './state/sessionStore.js';
import { AgentQueryRuntime } from './runtime/queryRuntime.js';
import { isStatusQuery, now } from './runtime/helpers.js';

interface StartAgentInput {
  sessionId: string;
  connectionId?: string;
  goal: string;
  profile: LLMProfile;
  sshHost?: string;
  threadMessages?: AgentRuntimeMessage[];
  restoredRuntime?: AgentSessionRuntime | null;
}

interface ResumeAgentInput {
  sessionId: string;
  connectionId?: string;
  userInput: string;
  profile: LLMProfile;
  sshHost?: string;
  threadMessages?: AgentRuntimeMessage[];
  restoredRuntime?: AgentSessionRuntime | null;
}

export class AgentManager {
  private events = new AgentEventBus();
  private store: AgentSessionStore;
  private runtimes = new Map<string, AgentQueryRuntime>();

  constructor(private sshMgr: SSHManager) {
    this.store = new AgentSessionStore(sshMgr, this.events);
  }

  startPlan(sessionId: string, input: StartAgentInput, webContents: WebContents) {
    this.runEntry(sessionId, {
      connectionId: input.connectionId || sessionId,
      goal: input.goal,
      profile: input.profile,
      sshHost: input.sshHost,
      webContents,
      threadMessages: input.threadMessages,
      restoredRuntime: input.restoredRuntime,
      resetPlan: true,
    }).catch((error) => this.handleFatalError(sessionId, error, false));
  }

  resume(sessionId: string, input: ResumeAgentInput, webContents: WebContents) {
    this.runEntry(sessionId, {
      connectionId: input.connectionId || this.store.get(sessionId)?.connectionId || sessionId,
      goal: input.userInput,
      profile: input.profile,
      sshHost: input.sshHost,
      webContents,
      threadMessages: input.threadMessages,
      restoredRuntime: input.restoredRuntime,
      resetPlan: false,
    }).catch((error) => this.handleFatalError(sessionId, error, true));
  }

  stop(sessionId: string) {
    this.store.stop(sessionId);
  }

  cleanup(sessionId: string) {
    this.store.cleanup(sessionId);
    this.runtimes.delete(sessionId);
  }

  private async runEntry(
    sessionId: string,
    options: {
      connectionId: string;
      goal: string;
      profile: LLMProfile;
      sshHost?: string;
      webContents: WebContents;
      threadMessages?: AgentRuntimeMessage[];
      restoredRuntime?: AgentSessionRuntime | null;
      resetPlan: boolean;
    },
  ) {
    if (!options.profile?.baseUrl || !options.profile?.model) {
      throw new Error('AI profile is incomplete');
    }

    const session = await this.store.ensureSession(sessionId, options);
    session.webContents = options.webContents;
    session.profile = options.profile;

    if (isStatusQuery(options.goal) && session.activeTaskRun && !session.running) {
      const run = session.activeTaskRun;
      const route = run.activeHypothesisId
        ? run.hypotheses.find((item) => item.id === run.activeHypothesisId)?.kind
        : undefined;
      const recentFailure = run.failureHistory[run.failureHistory.length - 1];
      const lines = [
        `Current task: ${run.goal}`,
        `Phase: ${run.phase} / Status: ${run.status}`,
        route ? `Current route: ${route}` : '',
        run.currentAction ? `Current action: ${run.currentAction}` : '',
        recentFailure ? `Recent failure: ${recentFailure.failureClass}: ${recentFailure.message}` : '',
        run.checkpoint.nextAction ? `Next step: ${run.checkpoint.nextAction}` : '',
      ].filter(Boolean);
      this.events.emitAssistantMessage(session, {
        id: `task-status-${Date.now()}`,
        role: 'assistant',
        content: lines.join('\n'),
        timestamp: now(),
      });
      return;
    }

    const runtime = this.getRuntime(sessionId);
    await runtime.run(session, {
      goal: options.goal,
      resetPlan: options.resetPlan,
      threadMessages: options.threadMessages,
    });
  }

  private handleFatalError(sessionId: string, error: unknown, fromResume: boolean) {
    const session = this.store.get(sessionId);
    if (!session) return;
    session.running = false;
    this.store.pushFatalMessage(session, error instanceof Error ? error.message : String(error), fromResume);
  }

  private getRuntime(sessionId: string) {
    const existing = this.runtimes.get(sessionId);
    if (existing) return existing;
    const runtime = new AgentQueryRuntime(sessionId, this.sshMgr, this.store, this.events);
    this.runtimes.set(sessionId, runtime);
    return runtime;
  }
}
