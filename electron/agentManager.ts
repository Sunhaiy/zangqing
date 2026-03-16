// Centralized Agent Plan State Machine — runs in the main process
// Replaces the Renderer-side runPlanLoop in AIChatPanel.tsx

import { WebContents } from 'electron';
import { callLLM, LLMProfile } from './llm.js';
import { SSHManager } from './ssh/sshManager.js';
import { AI_SYSTEM_PROMPTS } from '../src/shared/aiTypes.js';

// Mirror of src/shared/aiTypes.ts (avoid circular import between main and renderer types)
interface PlanStep {
    id: number;
    description: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
    command?: string;
    result?: string;
    error?: string;
}

interface PlanState {
    global_goal: string;
    scratchpad: string;
    plan: PlanStep[];
}

interface AgentMsg {
    id: string;
    role: 'user' | 'assistant' | 'tool';
    content: string;
    timestamp: number;
    toolCall?: { name: string; command: string; status: 'pending' | 'executed' };
    isError?: boolean;
}

interface Assessment {
    success: boolean;
    note: string;
    scratchpad_update?: string;
}

interface SessionState {
    aborted: boolean;
    planState: PlanState | null;
    webContents: WebContents;
    abortController: AbortController;
}

export class AgentManager {
    sessions = new Map<string, SessionState>();

    constructor(private sshMgr: SSHManager) {}

    // ── Push helpers ────────────────────────────────────────────────────────────

    private pushUpdate(id: string, sess: SessionState, planState: PlanState | null, planPhase: string) {
        if (!sess.webContents.isDestroyed()) {
            sess.webContents.send('agent-plan-update', { sessionId: id, planState, planPhase });
        }
    }

    private pushMsg(id: string, sess: SessionState, msg: AgentMsg) {
        if (!sess.webContents.isDestroyed()) {
            sess.webContents.send('agent-push-msg', { sessionId: id, message: msg });
        }
    }

    private updateMsg(id: string, sess: SessionState, messageId: string, updates: Partial<AgentMsg>) {
        if (!sess.webContents.isDestroyed()) {
            sess.webContents.send('agent-update-msg', { sessionId: id, messageId, updates });
        }
    }

    private injectTerminal(id: string, sess: SessionState, text: string) {
        if (!sess.webContents.isDestroyed()) {
            sess.webContents.send('terminal-data', { id, data: text });
        }
    }

    // ── SSH exec with retry + terminal injection ────────────────────────────────

    private async execCommand(
        sessionId: string,
        sess: SessionState,
        command: string,
        firstRun = true,
    ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
        const MAX_RETRIES = 5;
        const RETRY_DELAY_MS = 3000;
        const isConnError = (msg: string) =>
            /not connected|no response|handshake|connection lost|ECONNRESET|ETIMEDOUT/i.test(msg);

        if (firstRun) {
            this.injectTerminal(sessionId, sess, `\r\n\x1b[36;2m[Agent] $ ${command}\x1b[0m\r\n`);
        }

        // Suppress pager programs so output always returns cleanly
        const wrapped = `PAGER=cat SYSTEMD_PAGER=cat GIT_PAGER=cat TERM=dumb ${command}`;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const result = await this.sshMgr.exec(sessionId, wrapped, 120000);
                if (result.stdout) {
                    this.injectTerminal(sessionId, sess, result.stdout.replace(/\n/g, '\r\n'));
                }
                if (result.stderr) {
                    this.injectTerminal(sessionId, sess, `\x1b[33m${result.stderr.replace(/\n/g, '\r\n')}\x1b[0m`);
                }
                this.injectTerminal(sessionId, sess, `\x1b[2m[exit ${result.exitCode}]\x1b[0m\r\n`);
                return result;
            } catch (err: any) {
                const errMsg: string = err?.message || String(err);
                if (isConnError(errMsg) && attempt < MAX_RETRIES) {
                    this.injectTerminal(sessionId, sess,
                        `\r\n\x1b[33m[Agent] 连接中断，${RETRY_DELAY_MS / 1000}s 后重试 (${attempt}/${MAX_RETRIES})...\x1b[0m\r\n`
                    );
                    await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
                    try { await this.sshMgr.reconnect(sessionId); } catch { /* ignore */ }
                    this.injectTerminal(sessionId, sess,
                        `\x1b[36;2m[Agent] $ ${command}  (重试 ${attempt + 1}/${MAX_RETRIES})\x1b[0m\r\n`
                    );
                    continue;
                }
                throw err;
            }
        }
        throw new Error('SSH exec failed after maximum retries');
    }

    // ── LLM sub-agent calls ─────────────────────────────────────────────────────

    private async plannerCall(profile: LLMProfile, goal: string, signal: AbortSignal): Promise<PlanState> {
        const content = await callLLM(profile, [
            { role: 'system', content: AI_SYSTEM_PROMPTS.planner },
            { role: 'user', content: goal },
        ], { temperature: 0.3, maxTokens: 2048, signal });
        const raw = content.trim().replace(/^```[a-z]*\n?|```$/g, '').trim();
        let state: PlanState;
        try {
            state = JSON.parse(raw) as PlanState;
        } catch {
            throw new Error(`AI 返回了无效的 JSON：${raw.slice(0, 150)}`);
        }
        if (!state.global_goal || !Array.isArray(state.plan) || state.plan.length === 0)
            throw new Error(`AI 返回的计划格式不正确：${raw.slice(0, 150)}`);
        return state;
    }

    private async executorCall(profile: LLMProfile, state: PlanState, step: PlanStep, signal: AbortSignal): Promise<string> {
        const userContent = `全局目标：${state.global_goal}\n已知信息：${state.scratchpad || '无'}\n当前子任务：${step.description}`;
        try {
            const content = await callLLM(profile, [
                { role: 'system', content: AI_SYSTEM_PROMPTS.executor },
                { role: 'user', content: userContent },
            ], { temperature: 0.2, maxTokens: 512, signal });
            return content.trim().replace(/^`{1,3}(?:bash|sh)?\n?|`{1,3}$/g, '').trim();
        } catch (err: any) {
            if (err?.name === 'AbortError') throw err;
            return `echo "执行器生成命令失败: ${step.description}"`;
        }
    }

    private async assessorCall(
        profile: LLMProfile,
        step: PlanStep,
        result: { stdout: string; stderr: string; exitCode: number },
        signal: AbortSignal,
    ): Promise<Assessment> {
        const userContent =
            `子任务：${step.description}\n` +
            `执行命令：${step.command || ''}\n` +
            `退出码：${result.exitCode}\n` +
            `stdout（前2000字）：${result.stdout.slice(0, 2000)}\n` +
            `stderr（前1000字）：${result.stderr.slice(0, 1000)}`;
        try {
            const content = await callLLM(profile, [
                { role: 'system', content: AI_SYSTEM_PROMPTS.assessor },
                { role: 'user', content: userContent },
            ], { temperature: 0.1, maxTokens: 512, signal });
            const raw = content.trim().replace(/^```[a-z]*\n?|```$/g, '').trim();
            return JSON.parse(raw);
        } catch {
            return {
                success: result.exitCode === 0,
                note: result.exitCode === 0 ? '命令执行成功' : `退出码 ${result.exitCode}`,
            };
        }
    }

    private async replannerCall(
        profile: LLMProfile,
        state: PlanState,
        failedStep: PlanStep,
        errorOutput: string,
        signal: AbortSignal,
    ): Promise<PlanState | null> {
        const userContent =
            `当前任务状态：\n${JSON.stringify(state, null, 2)}\n\n` +
            `失败步骤：${failedStep.description}\n` +
            `错误输出：${errorOutput.slice(0, 1000)}`;
        try {
            const content = await callLLM(profile, [
                { role: 'system', content: AI_SYSTEM_PROMPTS.replanner },
                { role: 'user', content: userContent },
            ], { temperature: 0.4, maxTokens: 2048, signal });
            const raw = content.trim().replace(/^```[a-z]*\n?|```$/g, '').trim();
            const newState = JSON.parse(raw) as PlanState;
            if (!newState.global_goal || !Array.isArray(newState.plan))
                throw new Error('invalid replan');
            return newState;
        } catch {
            return null;
        }
    }

    // ── Main plan loop ──────────────────────────────────────────────────────────

    private async runPlanLoop(
        sessionId: string,
        sess: SessionState,
        state: PlanState,
        profile: LLMProfile,
    ): Promise<'done' | 'stopped' | 'paused'> {
        const MAX_REPLAN = 3;
        let replanCount = 0;
        const { signal } = sess.abortController;

        const syncState = (phase = 'executing') => {
            sess.planState = state;
            this.pushUpdate(sessionId, sess, state, phase);
        };

        while (!sess.aborted) {
            const step = state.plan.find(p => p.status === 'pending');
            if (!step) break;

            // 1. Mark in_progress
            step.status = 'in_progress';
            syncState();

            // 2. Executor generates command
            const command = await this.executorCall(profile, state, step, signal);
            if (sess.aborted) break;

            // 3. Detect __ASK_USER__ signal — pause and ask user
            if (command.startsWith('__ASK_USER__:')) {
                const question = command.slice('__ASK_USER__:'.length).trim();
                const askMsg: AgentMsg = {
                    id: `plan-ask-${Date.now()}`,
                    role: 'assistant',
                    content: question,
                    timestamp: Date.now(),
                };
                this.pushMsg(sessionId, sess, askMsg);
                syncState('paused');
                return 'paused';
            }

            step.command = command;
            syncState();

            // 4. Inject tool-call message into chat
            const callMsgId = `plan-call-${Date.now()}`;
            const callMsg: AgentMsg = {
                id: callMsgId,
                role: 'assistant',
                content: step.description,
                timestamp: Date.now(),
                toolCall: { name: 'execute_ssh_command', command, status: 'pending' },
            };
            this.pushMsg(sessionId, sess, callMsg);

            // 5. Execute SSH command
            let result: { stdout: string; stderr: string; exitCode: number };
            try {
                result = await this.execCommand(sessionId, sess, command);
            } catch (err: any) {
                step.status = 'failed';
                step.error = `SSH 执行失败: ${err?.message || err}`;
                this.updateMsg(sessionId, sess, callMsgId, {
                    toolCall: { name: 'execute_ssh_command', command, status: 'executed' },
                });
                const errMsg: AgentMsg = {
                    id: `plan-result-${Date.now()}`,
                    role: 'tool',
                    content: step.error,
                    timestamp: Date.now(),
                    toolCall: { name: 'execute_ssh_command', command, status: 'executed' },
                    isError: true,
                };
                this.pushMsg(sessionId, sess, errMsg);
                break;
            }

            if (sess.aborted) break;

            // 6. Update call message to 'executed' + push result
            this.updateMsg(sessionId, sess, callMsgId, {
                toolCall: { name: 'execute_ssh_command', command, status: 'executed' },
            });
            const resultContent = [result.stdout, result.stderr].filter(Boolean).join('\n').trim() || '(无输出)';
            const resultMsg: AgentMsg = {
                id: `plan-result-${Date.now()}`,
                role: 'tool',
                content: resultContent,
                timestamp: Date.now(),
                toolCall: { name: 'execute_ssh_command', command, status: 'executed' },
            };
            this.pushMsg(sessionId, sess, resultMsg);

            // 7. Assessor evaluates
            const assessment = await this.assessorCall(profile, step, result, signal);
            if (sess.aborted) break;

            if (assessment.success) {
                step.status = 'completed';
                step.result = assessment.note;
                if (assessment.scratchpad_update) {
                    state.scratchpad = [state.scratchpad, assessment.scratchpad_update].filter(Boolean).join('\n');
                }
                replanCount = 0;
                syncState();
            } else {
                step.status = 'failed';
                step.error = assessment.note;
                replanCount++;

                if (replanCount > MAX_REPLAN) {
                    syncState();
                    break;
                }

                const replanNoteMsg: AgentMsg = {
                    id: `plan-replan-${Date.now()}`,
                    role: 'assistant',
                    content: `步骤失败，正在重新规划：${assessment.note}`,
                    timestamp: Date.now(),
                };
                this.pushMsg(sessionId, sess, replanNoteMsg);

                const newState = await this.replannerCall(profile, state, step, result.stderr || result.stdout, signal);
                if (!newState) { syncState(); break; }
                state = { ...newState, plan: newState.plan.map(p => ({ ...p })) };
                syncState();
            }
        }

        const hasPending = state.plan.some(p => p.status === 'pending' || p.status === 'in_progress');
        const finalPhase = hasPending ? 'stopped' : 'done';
        sess.planState = state;
        this.pushUpdate(sessionId, sess, state, finalPhase);
        return finalPhase;
    }

    // ── Public API ──────────────────────────────────────────────────────────────

    startPlan(sessionId: string, goal: string, profile: LLMProfile, webContents: WebContents, sshHost = ''): void {
        this.stop(sessionId); // abort any currently running session

        // Inject SSH session context into the goal so the planner knows it's already connected
        const contextualGoal = sshHost
            ? `[系统背景：当前已通过 SSH 成功连接到服务器 "${sshHost}"，可以直接执行命令，无需询问 SSH 连接信息（IP、用户名、密码等）]\n\n用户任务：${goal}`
            : goal;

        const abortController = new AbortController();
        const sess: SessionState = { aborted: false, planState: null, webContents, abortController };
        this.sessions.set(sessionId, sess);

        // Fire-and-forget: plan loop runs async, pushes events to renderer
        (async () => {
            try {
                this.pushUpdate(sessionId, sess, null, 'generating');
                const state = await this.plannerCall(profile, contextualGoal, abortController.signal);
                if (sess.aborted) return;

                sess.planState = state;
                this.pushUpdate(sessionId, sess, state, 'executing');
                await this.runPlanLoop(sessionId, sess, state, profile);
            } catch (err: any) {
                if ((err as any)?.name === 'AbortError') return; // user stopped, no error message needed
                console.error(`[AgentManager] startPlan error (${sessionId}):`, err);
                this.pushMsg(sessionId, sess, {
                    id: `plan-err-${Date.now()}`,
                    role: 'assistant',
                    content: `❌ 计划模式出错：${err?.message || String(err)}`,
                    timestamp: Date.now(),
                    isError: true,
                });
                this.pushUpdate(sessionId, sess, sess.planState, 'stopped');
            }
        })();
    }

    stop(sessionId: string): void {
        const sess = this.sessions.get(sessionId);
        if (sess) {
            sess.aborted = true;
            sess.abortController.abort(); // immediately cancel any in-flight LLM request
            this.pushUpdate(sessionId, sess, sess.planState, 'stopped');
        }
    }

    resume(sessionId: string, userInput: string, webContents: WebContents, profile: LLMProfile): void {
        const sess = this.sessions.get(sessionId);
        const state = sess?.planState;
        if (!sess || !state) return;

        // Update webContents (tab switch) and reset abort state with a fresh controller
        sess.webContents = webContents;
        sess.aborted = false;
        sess.abortController = new AbortController();

        // Mark the 'ask' step completed and inject user's answer into scratchpad
        const askStep = state.plan.find(p => p.status === 'in_progress');
        if (askStep) {
            askStep.status = 'completed';
            askStep.result = `用户提供: ${userInput}`;
        }
        state.scratchpad = [state.scratchpad, `用户提供: ${userInput}`].filter(Boolean).join('\n');

        this.pushUpdate(sessionId, sess, state, 'executing');

        (async () => {
            try {
                await this.runPlanLoop(sessionId, sess, state, profile);
            } catch (err: any) {
                if ((err as any)?.name === 'AbortError') return;
                console.error(`[AgentManager] resume error (${sessionId}):`, err);
                this.pushMsg(sessionId, sess, {
                    id: `plan-err-${Date.now()}`,
                    role: 'assistant',
                    content: `❌ 计划模式出错：${err?.message || String(err)}`,
                    timestamp: Date.now(),
                    isError: true,
                });
                this.pushUpdate(sessionId, sess, sess.planState, 'stopped');
            }
        })();
    }

    cleanup(sessionId: string): void {
        const sess = this.sessions.get(sessionId);
        if (sess) {
            sess.aborted = true;
            sess.abortController.abort();
        }
        this.sessions.delete(sessionId);
    }
}
