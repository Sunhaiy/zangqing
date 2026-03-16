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

export type LLMMessage = { role: string; content: string | null };

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
        if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 300)}`);
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
    if (!res.ok) throw new Error(`LLM API ${res.status}: ${text.slice(0, 300)}`);
    const data = JSON.parse(text);
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    throw new Error(`Unexpected LLM response: ${text.slice(0, 200)}`);
}

