import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, Loader2, Sparkles, AlertTriangle } from 'lucide-react';
import { aiService } from '../services/aiService';
import { cn } from '../lib/utils';

interface AIPopoverProps {
    x: number;
    y: number;
    text: string;
    type: 'explain' | 'fix';
    onClose: () => void;
    onApplyFix?: (command: string) => void;
}

// Sub-component for AI content to avoid re-renders during drag
const AIResponseContent = React.memo(({
    isLoading,
    error,
    response,
    type,
    fixCommand,
    onApplyFix,
    onClose
}: {
    isLoading: boolean;
    error: string | null;
    response: string;
    type: 'explain' | 'fix';
    fixCommand: string | null;
    onApplyFix?: (cmd: string) => void;
    onClose: () => void;
}) => {
    return (
        <>
            <div className="flex-1 p-4 overflow-y-auto custom-scrollbar bg-card/50 min-h-[100px]">
                {isLoading && !response && (
                    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-3">
                        <Loader2 className="w-6 h-6 animate-spin text-primary" />
                        <span className="text-xs">AI 正在思考...</span>
                    </div>
                )}

                {error && (
                    <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs">
                        ⚠️ {error}
                    </div>
                )}

                <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                    {response}
                    {isLoading && response && (
                        <span className="inline-block w-1 h-4 bg-primary animate-pulse ml-0.5 align-middle" />
                    )}
                </div>
            </div>

            {type === 'fix' && fixCommand && !isLoading && (
                <div className="p-3 bg-muted/30 border-t border-border flex justify-end">
                    <button
                        onClick={() => {
                            onApplyFix?.(fixCommand);
                            onClose();
                        }}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-all shadow-sm"
                    >
                        <Check className="w-3.5 h-3.5" />
                        应用修复
                    </button>
                </div>
            )}
        </>
    );
});

AIResponseContent.displayName = 'AIResponseContent';

export function AIPopover({ x, y, text, type, onClose, onApplyFix }: AIPopoverProps) {
    const [response, setResponse] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [hasEntered, setHasEntered] = useState(false);

    // Initial position logic
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
                    { role: 'user' as const, content: text }
                ];

                for await (const chunk of aiService.streamComplete({ messages, temperature: 0.3 })) {
                    setResponse(prev => prev + chunk);
                    setIsLoading(false);
                }
            } catch (err: any) {
                setError(err.message || 'AI 请求失败');
            } finally {
                setIsLoading(false);
            }
        };

        fetchAI();

        // Mark animation as complete after entrance
        const timer = setTimeout(() => setHasEntered(true), 500);
        return () => clearTimeout(timer);
    }, [text, type]);

    // Drag handlers
    const handlePointerDown = (e: React.PointerEvent) => {
        // Skip if clicking on a button (like the close button)
        if ((e.target as HTMLElement).closest('button')) return;

        const target = e.currentTarget as HTMLDivElement;
        target.setPointerCapture(e.pointerId);

        setIsDragging(true);
        dragStartRef.current = {
            x: e.clientX - positionRef.current.x,
            y: e.clientY - positionRef.current.y
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
        if (isDragging) {
            document.body.style.userSelect = 'none';
        } else {
            document.body.style.userSelect = '';
        }
        return () => {
            document.body.style.userSelect = '';
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, [isDragging]);

    const extractCommand = (text: string) => {
        const match = text.match(/```bash\n([\s\S]*?)```/) || text.match(/```\n([\s\S]*?)```/);
        return match ? match[1].trim() : null;
    };

    const fixCommand = type === 'fix' ? extractCommand(response) : null;

    return createPortal(
        <>
            <div className="fixed inset-0 z-[10000]" onClick={onClose} />
            <div
                ref={containerRef}
                className={cn(
                    "fixed z-[10001] w-[350px] max-h-[450px] flex flex-col bg-card border border-border rounded-xl shadow-2xl p-0 overflow-hidden shrink-0",
                    !hasEntered && "animate-in slide-in-from-top-2 fade-in duration-300",
                    isDragging && "shadow-3xl ring-2 ring-primary/20"
                )}
                style={{
                    left: 0,
                    top: 0,
                    transform: `translate3d(${positionRef.current.x}px, ${positionRef.current.y}px, 0)`,
                    willChange: isDragging ? 'transform' : 'auto',
                    transition: isDragging ? 'none' : undefined
                }}
            >
                {/* Header - Drag handler */}
                <div
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    className={cn(
                        "px-4 py-3 flex items-center justify-between border-b border-border select-none flex-shrink-0",
                        isDragging ? "cursor-grabbing" : "cursor-grab",
                        type === 'fix' ? "bg-orange-500/10" : "bg-primary/10"
                    )}
                    style={{ touchAction: 'none' }}
                >
                    <div className="flex items-center gap-2 pointer-events-none">
                        {type === 'fix' ? (
                            <AlertTriangle className="w-4 h-4 text-orange-500" />
                        ) : (
                            <Sparkles className="w-4 h-4 text-primary" />
                        )}
                        <span className="text-sm font-semibold">
                            {type === 'fix' ? 'AI 报错分析' : 'AI 解释'}
                        </span>
                    </div>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onClose();
                        }}
                        className="p-1 hover:bg-muted rounded-full transition-colors flex-shrink-0"
                    >
                        <X className="w-4 h-4 text-muted-foreground" />
                    </button>
                </div>

                {/* Memoized Content Component to avoid heavy rendering during drag */}
                <AIResponseContent
                    isLoading={isLoading}
                    error={error}
                    response={response}
                    type={type}
                    fixCommand={fixCommand}
                    onApplyFix={onApplyFix}
                    onClose={onClose}
                />
            </div>
        </>,
        document.body
    );
}
