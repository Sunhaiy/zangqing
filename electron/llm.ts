// Main-process LLM HTTP client
// Supports OpenAI-compatible APIs and Anthropic natively (no renderer IPC needed)
// Uses Electron's net.fetch for reliable network access from the main process

import { net } from 'electron';

export interface LLMProfile {
    provider: string;   // 'deepseek' | 'openai' | 'anthropic' | 'groq' | 'openrouter' | 'ollama' | 'qwen' | 'custom'
    apiKey: string;
    baseUrl: string;
    model: string;
}

export type LLMMessage = {
    role: string;
    content: string | null;
    tool_calls?: LLMToolCall[];
    tool_call_id?: string;
};

export interface LLMToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: object;
    };
}

export interface LLMToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

export interface LLMToolResponse {
    content: string | null;
    reasoningContent?: string | null;
    toolCalls: LLMToolCall[] | null;
    finishReason: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    modelUsed?: string;
}

export class LLMRequestError extends Error {
    status: number;
    code?: string;
    type?: string;
    requestId?: string;
    retryable: boolean;

    constructor(
        message: string,
        options: {
            status: number;
            code?: string;
            type?: string;
            requestId?: string;
            retryable?: boolean;
        },
    ) {
        super(message);
        this.name = 'LLMRequestError';
        this.status = options.status;
        this.code = options.code;
        this.type = options.type;
        this.requestId = options.requestId;
        this.retryable = Boolean(options.retryable);
    }
}

function parseLLMError(rawText: string, status: number, fallbackPrefix: string): LLMRequestError {
    try {
        const parsed = JSON.parse(rawText);
        const code = parsed?.error?.code;
        const type = parsed?.error?.type;
        const message = parsed?.error?.message;
        const requestId = parsed?.error?.request_id || parsed?.request_id;

        if (status === 429 || code === 'ServerOverloaded' || type === 'TooManyRequests') {
            const detail = message || 'AI service is temporarily overloaded.';
            const suffix = requestId ? ` Request ID: ${requestId}` : '';
            return new LLMRequestError(
                `AI 服务当前繁忙，我会保留当前上下文。请稍后重试，或直接发送“继续”让我接着当前任务恢复。${detail}${suffix}`.trim(),
                {
                    status,
                    code,
                    type,
                    requestId,
                    retryable: true,
                },
            );
        }

        if (message) {
            return new LLMRequestError(`${fallbackPrefix}: ${message}`, {
                status,
                code,
                type,
                requestId,
                retryable: status >= 500,
            });
        }
    } catch {
        // Ignore JSON parse errors and fall back to raw text.
    }

    if (status === 429) {
        return new LLMRequestError(
            'AI 服务当前繁忙，我会保留当前上下文。请稍后重试，或直接发送“继续”让我接着当前任务恢复。',
            {
                status,
                retryable: true,
            },
        );
    }

    return new LLMRequestError(`${fallbackPrefix}: ${rawText.slice(0, 300)}`, {
        status,
        retryable: status >= 500,
    });
}

export async function callLLM(
    profile: LLMProfile,
    messages: LLMMessage[],
    opts?: { temperature?: number; maxTokens?: number; signal?: AbortSignal }
): Promise<string> {
    if (!profile || !profile.baseUrl || !profile.model) {
        throw new Error(`无效的 AI 配置：缺少 baseUrl 或 model（provider=${profile?.provider}）`);
    }

    const { provider, apiKey, baseUrl, model } = profile;
    const temperature = opts?.temperature ?? 0;
    const maxTokens  = opts?.maxTokens  ?? 4096;
    const signal     = opts?.signal;

    if (provider === 'anthropic') {
        // Anthropic Messages API
        const systemMsg = messages.find(m => m.role === 'system');
        const turns = messages.filter(m => m.role !== 'system').map(m => ({
            role: m.role as 'user' | 'assistant',
            content: m.content ?? '',
        }));

        const body: Record<string, any> = {
            model,
            messages: turns,
            max_tokens: maxTokens,
        };
        if (systemMsg?.content) body.system = systemMsg.content;

        const url = `${baseUrl.replace(/\/$/, '')}/v1/messages`;
        const res = await net.fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify(body),
            signal,
        });
        const text = await res.text();
        if (!res.ok) throw parseLLMError(text, res.status, 'Anthropic API request failed');
        const data = JSON.parse(text);
        const block = data?.content?.[0];
        if (block?.type === 'text') return block.text as string;
        throw new Error(`Unexpected Anthropic response: ${text.slice(0, 200)}`);
    }

    // OpenAI-compatible (deepseek, openai, groq, openrouter, ollama, qwen, custom)
    // Mirror the same endpoint logic as aiService.getEndpoint():
    //   - already has /chat/completions → use as-is
    //   - ends with /vN (e.g. Volcengine /api/v3) → append /chat/completions
    //   - otherwise → append /v1/chat/completions
    const cleanBase = baseUrl.replace(/\/+$/, '');
    let url: string;
    if (cleanBase.endsWith('/chat/completions')) {
        url = cleanBase;
    } else if (/\/v\d+$/.test(cleanBase)) {
        url = `${cleanBase}/chat/completions`;
    } else if (provider === 'ollama') {
        url = cleanBase.endsWith('/api/chat') ? cleanBase : `${cleanBase}/api/chat`;
    } else {
        url = `${cleanBase}/v1/chat/completions`;
    }
    const body = {
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
    };

    const res = await net.fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
    });
    const text = await res.text();
    if (!res.ok) throw parseLLMError(text, res.status, 'LLM API request failed');
    const data = JSON.parse(text);
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    throw new Error(`Unexpected LLM response: ${text.slice(0, 200)}`);
}

export async function callLLMWithTools(
    profile: LLMProfile,
    messages: LLMMessage[],
    tools: LLMToolDefinition[],
    opts?: { temperature?: number; maxTokens?: number; signal?: AbortSignal },
): Promise<LLMToolResponse> {
    if (!profile || !profile.baseUrl || !profile.model) {
        throw new Error(`Invalid AI config: missing baseUrl or model (provider=${profile?.provider})`);
    }

    const { provider, apiKey, baseUrl, model } = profile;
    const temperature = opts?.temperature ?? 0.2;
    const maxTokens = opts?.maxTokens ?? 2048;
    const signal = opts?.signal;

    if (provider === 'anthropic') {
        throw new Error('Anthropic tool calling is not implemented in the main-process runtime yet');
    }

    const cleanBase = baseUrl.replace(/\/+$/, '');
    let url: string;
    if (cleanBase.endsWith('/chat/completions')) {
        url = cleanBase;
    } else if (/\/v\d+$/.test(cleanBase)) {
        url = `${cleanBase}/chat/completions`;
    } else if (provider === 'ollama') {
        url = cleanBase.endsWith('/api/chat') ? cleanBase : `${cleanBase}/api/chat`;
    } else {
        url = `${cleanBase}/v1/chat/completions`;
    }

    const body: Record<string, any> = provider === 'ollama'
        ? {
            model,
            messages,
            stream: false,
            tools,
        }
        : {
            model,
            messages,
            temperature,
            max_tokens: maxTokens,
            stream: false,
            tools,
        };

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
    };
    if (provider === 'openrouter') {
        headers['HTTP-Referer'] = 'https://sshtool.app';
        headers['X-Title'] = 'SSH Tool';
    }

    const res = await net.fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
    });
    const text = await res.text();

    if (!res.ok) {
        try {
            const errorJson = JSON.parse(text);
            const failedGeneration = errorJson?.error?.failed_generation;
            if (errorJson?.error?.code === 'tool_use_failed' && failedGeneration) {
                const funcMatch = failedGeneration.match(/<function=(\w+)>([\s\S]*)/);
                if (funcMatch) {
                    return {
                        content: null,
                        toolCalls: [{
                            id: `call_${Date.now()}`,
                            type: 'function',
                            function: {
                                name: funcMatch[1],
                                arguments: funcMatch[2].trim(),
                            },
                        }],
                        finishReason: 'tool_calls',
                        modelUsed: model,
                    };
                }
            }
        } catch {
            // fall through to standard error
        }
        throw parseLLMError(text, res.status, 'LLM API request failed');
    }

    const data = JSON.parse(text);
    const choice = data?.choices?.[0];
    const message = choice?.message;
    const usage = data?.usage ? {
        promptTokens: data.usage.prompt_tokens ?? 0,
        completionTokens: data.usage.completion_tokens ?? 0,
        totalTokens: data.usage.total_tokens ?? 0,
    } : undefined;

    if (message?.tool_calls?.length) {
        return {
            content: message.content || null,
            reasoningContent: message.reasoning_content || null,
            toolCalls: message.tool_calls,
            finishReason: choice?.finish_reason || 'tool_calls',
            usage,
            modelUsed: model,
        };
    }

    const content = message?.content || '';
    const funcMatch = content.match(/<function=(\w+)>([\s\S]*?)(?:<\/function>|$)/);
    if (funcMatch) {
        return {
            content: null,
            toolCalls: [{
                id: `call_${Date.now()}`,
                type: 'function',
                function: {
                    name: funcMatch[1],
                    arguments: funcMatch[2].trim(),
                },
            }],
            finishReason: 'tool_calls',
            usage,
            modelUsed: model,
        };
    }

    return {
        content: content || null,
        reasoningContent: message?.reasoning_content || null,
        toolCalls: null,
        finishReason: choice?.finish_reason || 'stop',
        usage,
        modelUsed: model,
    };
}

