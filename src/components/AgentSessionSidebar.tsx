import { useState, useEffect, useCallback } from 'react';
import React from 'react';
import { Plus, Trash2, MessageSquare, Clock } from 'lucide-react';
import { AgentSession } from '../shared/types';
import { useTranslation } from '../hooks/useTranslation';
import { cn } from '../lib/utils';

interface AgentSessionSidebarProps {
    profileId: string;
    currentSessionId: string | null;
    onSelectSession: (session: AgentSession) => void;
    onNewSession: () => void;
    refreshTrigger?: number;
    style?: React.CSSProperties;
    showHeader?: boolean;
}

function useRelativeTime() {
    const { t, language } = useTranslation();
    return (timestamp: number): string => {
        const diff = Date.now() - timestamp;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return t('agent.justNow');
        if (minutes < 60) return language === 'zh' ? `${minutes} 分钟前` : `${minutes}m ago`;
        if (hours < 24) return language === 'zh' ? `${hours} 小时前` : `${hours}h ago`;
        if (days === 1) return language === 'zh' ? '昨天' : 'Yesterday';
        if (days < 30) return language === 'zh' ? `${days} 天前` : `${days}d ago`;

        return new Date(timestamp).toLocaleDateString(
            language === 'zh' ? 'zh-CN' : language === 'ja' ? 'ja-JP' : language === 'ko' ? 'ko-KR' : 'en-US',
            { month: 'short', day: 'numeric' }
        );
    };
}

export function AgentSessionSidebar({
    profileId,
    currentSessionId,
    onSelectSession,
    onNewSession,
    refreshTrigger,
    style,
    showHeader = true,
}: AgentSessionSidebarProps) {
    const [sessions, setSessions] = useState<AgentSession[]>([]);
    const [pendingDelete, setPendingDelete] = useState<string | null>(null);
    const { t, language } = useTranslation();
    const relativeTime = useRelativeTime();

    const load = useCallback(async () => {
        if (!profileId) return;
        try {
            const list = await (window as any).electron.agentSessionList(profileId);
            setSessions(list || []);
        } catch {
            setSessions([]);
        }
    }, [profileId]);

    useEffect(() => { load(); }, [load, refreshTrigger]);

    const handleDelete = async (id: string, event: React.MouseEvent) => {
        event.stopPropagation();
        if (pendingDelete === id) {
            await (window as any).electron.agentSessionDelete(id);
            setSessions((prev) => prev.filter((session) => session.id !== id));
            setPendingDelete(null);
            return;
        }

        setPendingDelete(id);
        setTimeout(() => {
            setPendingDelete((prev) => (prev === id ? null : prev));
        }, 2500);
    };

    const emptyTitle = language === 'zh' ? '还没有会话' : 'No threads yet';
    const emptyText = language === 'zh'
        ? '新的任务会保存在这里，下次可以直接继续。'
        : 'New work is saved here so you can pick it back up later.';
    const recentLabel = language === 'zh' ? '最近会话' : 'Recent Threads';
    const newSessionLabel = language === 'zh' ? '新建' : 'New';

    return (
        <div
            className={cn(
                'flex h-full shrink-0 flex-col overflow-hidden bg-card',
                showHeader ? 'border-r border-border' : ''
            )}
            style={style}
        >
            {showHeader && (
                <div className="border-b border-border px-4 py-4">
                    <div className="flex items-center justify-between gap-2">
                        <div>
                            <div className="text-xs font-medium text-muted-foreground">{recentLabel}</div>
                            <div className="mt-1 text-base font-semibold text-foreground">{t('agent.sessionHistory')}</div>
                        </div>
                        <button
                            onClick={onNewSession}
                            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                            title={t('agent.newSession')}
                        >
                            <Plus className="h-4 w-4" />
                            {newSessionLabel}
                        </button>
                    </div>
                </div>
            )}

            <div className="flex-1 overflow-y-auto p-3">
                {sessions.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
                            <MessageSquare className="h-5 w-5" />
                        </div>
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
                            <p className="text-xs leading-relaxed text-muted-foreground">{emptyText}</p>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {sessions.map((session) => {
                            const firstUserMessage = session.messages.find((message) => message.role === 'user' && message.content?.trim());
                            const latestMessage = [...session.messages].reverse().find((message) => message.content?.trim());
                            const preview = (firstUserMessage?.content || latestMessage?.content || session.host || '')
                                .replace(/\s+/g, ' ')
                                .slice(0, 88);
                            const userCount = session.messages.filter((message) => message.role === 'user').length;
                            const active = currentSessionId === session.id;

                            return (
                                <div
                                    key={session.id}
                                    onClick={() => onSelectSession(session)}
                                    className={cn(
                                        'group relative flex w-full flex-col items-start gap-2 rounded-lg border px-3 py-3 text-left transition-colors',
                                        active
                                            ? 'border-primary/30 bg-accent'
                                            : 'border-border bg-background hover:bg-accent/60'
                                    )}
                                    role="button"
                                    tabIndex={0}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault();
                                            onSelectSession(session);
                                        }
                                    }}
                                >
                                    <div className="pr-8">
                                        <div className="line-clamp-1 text-sm font-medium text-foreground">
                                            {session.title || t('agent.newSession')}
                                        </div>
                                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                                            {preview}
                                        </p>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                        <span className="inline-flex items-center gap-1">
                                            <Clock className="h-3 w-3" />
                                            {relativeTime(session.updatedAt)}
                                        </span>
                                        <span className="inline-flex items-center gap-1">
                                            <MessageSquare className="h-3 w-3" />
                                            {userCount} {t('agent.messages')}
                                        </span>
                                    </div>

                                    <button
                                        onClick={(event) => handleDelete(session.id, event)}
                                        className={cn(
                                            'absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md border transition-opacity',
                                            pendingDelete === session.id
                                                ? 'border-destructive bg-destructive text-destructive-foreground opacity-100'
                                                : 'border-border bg-background text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive'
                                        )}
                                        title={pendingDelete === session.id ? t('common.confirm') : t('common.delete')}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
