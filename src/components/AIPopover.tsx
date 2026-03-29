import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, Loader2, Sparkles, X } from 'lucide-react';
import { aiService } from '../services/aiService';
import { cn } from '../lib/utils';
import { useTranslation } from '../hooks/useTranslation';

interface AIPopoverProps {
    x: number;
    y: number;
    text: string;
    type: 'explain' | 'fix';
    onClose: () => void;
    onApplyFix?: (command: string) => void;
}

const AIResponseContent = React.memo(({
    isLoading,
    error,
    response,
    type,
    fixCommand,
    onApplyFix,
    onClose,
    labels,
}: {
    isLoading: boolean;
    error: string | null;
    response: string;
    type: 'explain' | 'fix';
    fixCommand: string | null;
    onApplyFix?: (cmd: string) => void;
    onClose: () => void;
    labels: {
        thinking: string;
        applyFix: string;
    };
}) => (
    <>
        <div className="flex-1 overflow-y-auto bg-card/50 p-4 custom-scrollbar min-h-[100px]">
            {isLoading && !response && (
                <div className="flex flex-col items-center justify-center gap-3 py-8 text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <span className="text-xs">{labels.thinking}</span>
                </div>
            )}

            {error && (
                <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                    {error}
                </div>
            )}

            <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                {response}
                {isLoading && response && (
                    <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-primary align-middle" />
                )}
            </div>
        </div>

        {type === 'fix' && fixCommand && !isLoading && (
            <div className="flex justify-end border-t border-border bg-muted/30 p-3">
                <button
                    onClick={() => {
                        onApplyFix?.(fixCommand);
                        onClose();
                    }}
                    className="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-all hover:bg-primary/90"
                >
                    <Check className="h-3.5 w-3.5" />
                    {labels.applyFix}
                </button>
            </div>
        )}
    </>
));

AIResponseContent.displayName = 'AIResponseContent';

export function AIPopover({ x, y, text, type, onClose, onApplyFix }: AIPopoverProps) {
    const { t } = useTranslation();
    const [response, setResponse] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [hasEntered, setHasEntered] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const positionRef = useRef({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const dragStartRef = useRef({ x: 0, y: 0 });
    const rafRef = useRef<number>();

    useEffect(() => {
        const popoverWidth = 350;
        const padding = 20;
        const initialX = Math.min(x, window.innerWidth - popoverWidth - padding);
        const initialY = Math.min(y, window.innerHeight - 350 - padding);

        positionRef.current = { x: initialX, y: initialY };
        if (containerRef.current) {
            containerRef.current.style.transform = `translate3d(${initialX}px, ${initialY}px, 0)`;
        }
    }, [x, y]);

    useEffect(() => {
        const fetchAI = async () => {
            setIsLoading(true);
            setResponse('');
            setError(null);

            try {
                const promptType = type === 'explain' ? 'explainCommand' : 'errorAnalysis';
                const messages = [
                    { role: 'system' as const, content: (await import('../shared/aiTypes')).AI_SYSTEM_PROMPTS[promptType] },
                    { role: 'user' as const, content: text },
                ];

                for await (const chunk of aiService.streamComplete({ messages, temperature: 0.3 })) {
                    setResponse((prev) => prev + chunk);
                    setIsLoading(false);
                }
            } catch (err: any) {
                setError(err?.message || t('aiPopover.requestFailed'));
            } finally {
                setIsLoading(false);
            }
        };

        fetchAI();
        const timer = window.setTimeout(() => setHasEntered(true), 500);
        return () => window.clearTimeout(timer);
    }, [text, type, t]);

    const handlePointerDown = (e: React.PointerEvent) => {
        if ((e.target as HTMLElement).closest('button')) return;

        const target = e.currentTarget as HTMLDivElement;
        target.setPointerCapture(e.pointerId);
        setIsDragging(true);
        dragStartRef.current = {
            x: e.clientX - positionRef.current.x,
            y: e.clientY - positionRef.current.y,
        };
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!isDragging || !containerRef.current) return;

        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
            if (!containerRef.current) return;
            const newX = e.clientX - dragStartRef.current.x;
            const newY = e.clientY - dragStartRef.current.y;
            positionRef.current = { x: newX, y: newY };
            containerRef.current.style.transform = `translate3d(${newX}px, ${newY}px, 0)`;
        });
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        const target = e.currentTarget as HTMLDivElement;
        target.releasePointerCapture(e.pointerId);
        setIsDragging(false);

        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        if (containerRef.current) {
            containerRef.current.style.transform = `translate3d(${positionRef.current.x}px, ${positionRef.current.y}px, 0)`;
        }
    };

    useEffect(() => {
        document.body.style.userSelect = isDragging ? 'none' : '';
        return () => {
            document.body.style.userSelect = '';
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, [isDragging]);

    const extractCommand = (content: string) => {
        const fencedMatch = content.match(/```bash\n([\s\S]*?)```/) || content.match(/```\n([\s\S]*?)```/);
        if (fencedMatch) return fencedMatch[1].trim();

        const inlineMatch = content.match(/`([^`\n]+)`/);
        if (inlineMatch) return inlineMatch[1].trim();

        const plainText = content.trim();
        if (plainText && !plainText.includes('\n') && !plainText.startsWith('AI ')) {
            return plainText;
        }

        return null;
    };

    const fixCommand = type === 'fix' ? extractCommand(response) : null;

    return createPortal(
        <>
            <div className="fixed inset-0 z-[10000]" onClick={onClose} />
            <div
                ref={containerRef}
                className={cn(
                    'fixed z-[10001] flex max-h-[450px] w-[350px] shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card p-0 shadow-2xl',
                    !hasEntered && 'animate-in slide-in-from-top-2 fade-in duration-300',
                    isDragging && 'ring-2 ring-primary/20 shadow-3xl',
                )}
                style={{
                    left: 0,
                    top: 0,
                    transform: `translate3d(${positionRef.current.x}px, ${positionRef.current.y}px, 0)`,
                    willChange: isDragging ? 'transform' : 'auto',
                    transition: isDragging ? 'none' : undefined,
                }}
            >
                <div
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    className={cn(
                        'flex shrink-0 select-none items-center justify-between border-b border-border px-4 py-3',
                        isDragging ? 'cursor-grabbing' : 'cursor-grab',
                        type === 'fix' ? 'bg-orange-500/10' : 'bg-primary/10',
                    )}
                    style={{ touchAction: 'none' }}
                >
                    <div className="pointer-events-none flex items-center gap-2">
                        {type === 'fix' ? (
                            <AlertTriangle className="h-4 w-4 text-orange-500" />
                        ) : (
                            <Sparkles className="h-4 w-4 text-primary" />
                        )}
                        <span className="text-sm font-semibold">
                            {type === 'fix' ? t('aiPopover.titleFix') : t('aiPopover.titleExplain')}
                        </span>
                    </div>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onClose();
                        }}
                        className="flex-shrink-0 rounded-full p-1 transition-colors hover:bg-muted"
                    >
                        <X className="h-4 w-4 text-muted-foreground" />
                    </button>
                </div>

                <AIResponseContent
                    isLoading={isLoading}
                    error={error}
                    response={response}
                    type={type}
                    fixCommand={fixCommand}
                    onApplyFix={onApplyFix}
                    onClose={onClose}
                    labels={{
                        thinking: t('aiPopover.thinking'),
                        applyFix: t('aiPopover.applyFix'),
                    }}
                />
            </div>
        </>,
        document.body,
    );
}
