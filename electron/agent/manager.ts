import { WebContents } from 'electron';
import { LLMProfile } from '../llm.js';
import type { AgentPlanPhase, AgentSessionRuntime } from '../../src/shared/types.js';
import { SSHManager } from '../ssh/sshManager.js';
import type { AgentRuntimeMessage } from './types.js';
import { AgentEventBus } from './runtime/eventBus.js';
import { AgentSessionStore } from './state/sessionStore.js';
import { AgentQueryRuntime } from './runtime/queryRuntime.js';
import { isStatusQuery, MAX_AUTO_RESUME_ATTEMPTS, now } from './runtime/helpers.js';

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
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private sshMgr: SSHManager, private persistenceStore?: { get: (key: string) => unknown; set: (key: string, value: unknown) => void }) {
    this.store = new AgentSessionStore(sshMgr, this.events);
    this.events.onPlanUpdate((session, planPhase) => this.persistRuntime(session, planPhase));
    this.events.onMessage((session, message) => this.persistMessage(session, message));
  }

  startPlan(sessionId: string, input: StartAgentInput, webContents: WebContents) {
    this.clearRetryTimer(sessionId);
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
    this.clearRetryTimer(sessionId);
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
    this.clearRetryTimer(sessionId);
    this.store.stop(sessionId);
  }

  cleanup(sessionId: string) {
    this.clearRetryTimer(sessionId);
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

    this.clearRetryTimer(sessionId);

    const session = await this.store.ensureSession(sessionId, options);
    session.webContents = options.webContents;
    session.profile = options.profile;
    if (!isStatusQuery(options.goal) && session.activeTaskRun?.status === 'retryable_paused' && session.activeTaskRun.nextAutoRetryAt) {
      this.store.upsertTaskRun(session, {
        nextAutoRetryAt: undefined,
      });
    }

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
        run.watchdogState ? `Watchdog: ${run.watchdogState} (alerts=${run.watchdogAlerts || 0}, replays=${run.checkpointReplayCount || run.checkpoint.replayCount || 0})` : '',
        run.checkpoint.lastProgressNote ? `Last progress: ${run.checkpoint.lastProgressNote}` : '',
        run.blockingReason ? `Blocked on: ${run.blockingReason}` : '',
        run.nextAutoRetryAt ? `Next automatic retry: ${new Date(run.nextAutoRetryAt).toLocaleTimeString()}` : '',
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
    this.scheduleAutoResumeIfNeeded(sessionId, session);
  }

  private handleFatalError(sessionId: string, error: unknown, fromResume: boolean) {
    this.clearRetryTimer(sessionId);
    const session = this.store.get(sessionId);
    if (!session) return;
    session.running = false;
    this.store.pushFatalMessage(session, error instanceof Error ? error.message : String(error), fromResume);
  }

  private clearRetryTimer(sessionId: string) {
    const timer = this.retryTimers.get(sessionId);
    if (!timer) return;
    clearTimeout(timer);
    this.retryTimers.delete(sessionId);
  }

  private scheduleAutoResumeIfNeeded(sessionId: string, session: ReturnType<AgentSessionStore['get']>) {
    if (!session || session.aborted || session.running) return;
    const run = session.activeTaskRun;
    if (!run || run.status !== 'retryable_paused') return;

    const nextAttempt = (run.autoRetryCount || 0) + 1;
    if (nextAttempt > MAX_AUTO_RESUME_ATTEMPTS) {
      this.store.upsertTaskRun(session, {
        status: 'paused',
        phase: 'paused',
        nextAutoRetryAt: undefined,
        currentAction: 'AI service stayed busy after automatic retries. Waiting for a manual continue request or a different model.',
      }, {
        phase: 'paused',
        nextAction: 'Send continue to retry manually or switch to another model/profile',
      });
      this.events.emitAssistantMessage(session, {
        id: `auto-resume-exhausted-${Date.now()}`,
        role: 'assistant',
        content: 'The AI service is still busy after several automatic retries. Reply with continue to retry manually, or switch to another model/profile.',
        timestamp: now(),
        isError: true,
      });
      return;
    }

    const waitMs = Math.min(60000, 8000 * (2 ** (nextAttempt - 1)));
    const retryAt = Date.now() + waitMs;
    this.store.upsertTaskRun(session, {
      autoRetryCount: nextAttempt,
      nextAutoRetryAt: retryAt,
      currentAction: `AI service is busy. Automatic retry ${nextAttempt}/${MAX_AUTO_RESUME_ATTEMPTS} is scheduled shortly.`,
    }, {
      phase: 'paused',
      nextAction: 'Waiting for automatic retry; you can also send continue immediately',
    });
    this.events.emitAssistantMessage(session, {
      id: `auto-resume-scheduled-${Date.now()}`,
      role: 'assistant',
      content: `AI service is temporarily busy. I will retry automatically in ${Math.ceil(waitMs / 1000)} seconds.`,
      timestamp: now(),
    });

    const timer = setTimeout(() => {
      this.retryTimers.delete(sessionId);
      const currentSession = this.store.get(sessionId);
      if (!currentSession || currentSession.aborted || currentSession.running || currentSession.activeTaskRun?.status !== 'retryable_paused') {
        return;
      }

      this.events.emitAssistantMessage(currentSession, {
        id: `auto-resume-retrying-${Date.now()}`,
        role: 'assistant',
        content: 'Retrying automatically now from the preserved task state.',
        timestamp: now(),
      });

      this.runEntry(sessionId, {
        connectionId: currentSession.connectionId,
        goal: 'continue',
        profile: currentSession.profile,
        sshHost: currentSession.sshHost,
        webContents: currentSession.webContents,
        resetPlan: false,
      }).catch((error) => this.handleFatalError(sessionId, error, true));
    }, waitMs);

    this.retryTimers.set(sessionId, timer);
  }

  private getRuntime(sessionId: string) {
    const existing = this.runtimes.get(sessionId);
    if (existing) return existing;
    const runtime = new AgentQueryRuntime(sessionId, this.sshMgr, this.store, this.events);
    this.runtimes.set(sessionId, runtime);
    return runtime;
  }

  private readSessions() {
    return (this.persistenceStore?.get('agentSessions') as any[] | undefined) || [];
  }

  private writeSessions(sessions: any[]) {
    this.persistenceStore?.set('agentSessions', sessions);
  }

  private persistRuntime(session: ReturnType<AgentSessionStore['get']>, planPhase: AgentPlanPhase | string) {
    if (!session || !this.persistenceStore) return;
    const sessions = this.readSessions();
    const existing = sessions.find((item: any) => item.id === session.id);
    if (!existing) return;
    const normalizedPlanPhase = this.normalizePlanPhase(planPhase);

    const previousRuntime = existing.runtime || {};
    const runtime: AgentSessionRuntime = {
      ...previousRuntime,
      planState: session.planState,
      planStatus: normalizedPlanPhase,
      contextWindow: session.contextWindow,
      compressedMemory: session.compressedMemory,
      compressedRunMemory: session.compressedRunMemory,
      knownProjectPaths: session.knownProjectPaths,
      taskTodos: session.taskTodos,
      memoryFiles: session.memoryFiles,
      compactState: session.compactState,
      agentModel: previousRuntime.agentModel,
      agentProfileId: previousRuntime.agentProfileId,
      activeRunId: session.activeRunId,
      activeTaskRun: session.activeTaskRun,
    };

    this.writeSessions(sessions.map((item: any) => (
      item.id === session.id
        ? {
            ...item,
            runtime,
            updatedAt: now(),
          }
        : item
    )));
  }

  private normalizePlanPhase(planPhase: AgentPlanPhase | string): AgentSessionRuntime['planStatus'] {
    const allowedPhases: AgentPlanPhase[] = [
      'idle',
      'generating',
      'executing',
      'done',
      'stopped',
      'paused',
      'blocked',
      'waiting_approval',
    ];
    return allowedPhases.includes(planPhase as AgentPlanPhase)
      ? (planPhase as AgentPlanPhase)
      : 'stopped';
  }

  private persistMessage(session: ReturnType<AgentSessionStore['get']>, message: AgentRuntimeMessage) {
    if (!session || !this.persistenceStore) return;
    const sessions = this.readSessions();
    const existing = sessions.find((item: any) => item.id === session.id);
    if (!existing) return;
    const nextMessages = [...((existing.messages as AgentRuntimeMessage[] | undefined) || []), message];
    this.writeSessions(sessions.map((item: any) => (
      item.id === session.id
        ? {
            ...item,
            messages: nextMessages,
            updatedAt: now(),
          }
        : item
    )));
  }
}
