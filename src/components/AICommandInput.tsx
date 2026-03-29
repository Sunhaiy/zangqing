import { KeyboardEvent, useRef, useState } from 'react';
import { Loader2, Send, Sparkles, Terminal } from 'lucide-react';
import { aiService } from '../services/aiService';
import { useSettingsStore } from '../store/settingsStore';
import { cn } from '../lib/utils';
import { useTranslation } from '../hooks/useTranslation';

interface AICommandInputProps {
    onCommandGenerated: (command: string) => void;
    currentPath?: string;
    className?: string;
}

export function AICommandInput({ onCommandGenerated, currentPath, className }: AICommandInputProps) {
    const { t } = useTranslation();
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [generatedCommand, setGeneratedCommand] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const { aiSendShortcut } = useSettingsStore();

    const handleGenerate = async () => {
        if (!input.trim()) return;

        if (!aiService.isConfigured()) {
            setError(t('aiCommandInput.configureApi'));
            return;
        }

        setIsLoading(true);
        setError(null);
        setGeneratedCommand(null);

        try {
            const command = await aiService.textToCommand(input, currentPath);
            setGeneratedCommand(command);
        } catch (err: any) {
            setError(err?.message || t('aiCommandInput.generateFailed'));
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        const isSendTriggered = aiSendShortcut === 'ctrlEnter'
            ? e.key === 'Enter' && e.ctrlKey
            : e.key === 'Enter' && !e.ctrlKey;

        if (isSendTriggered) {
            e.preventDefault();
            handleGenerate();
        } else if (e.key === 'Escape') {
            setGeneratedCommand(null);
            setError(null);
        }
    };

    const handleAcceptCommand = () => {
        if (!generatedCommand) return;
        onCommandGenerated(generatedCommand);
        setInput('');
        setGeneratedCommand(null);
    };

    const handleClear = () => {
        setInput('');
        setGeneratedCommand(null);
        setError(null);
        inputRef.current?.focus();
    };

    return (
        <div
            className={cn(
                'flex flex-col gap-1.5 rounded-lg border border-primary/20 bg-background/95 p-2 shadow-md',
                'animate-in slide-in-from-bottom-2 duration-200',
                className,
            )}
        >
            <div className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
                <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={t('aiCommandInput.placeholder')}
                    className="flex-1 border-none bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
                    disabled={isLoading}
                />
                <button
                    onClick={handleGenerate}
                    disabled={isLoading || !input.trim()}
                    className={cn(
                        'rounded-md p-1 transition-colors',
                        isLoading ? 'text-muted-foreground' : 'text-primary hover:bg-primary/20',
                    )}
                    title={aiSendShortcut === 'ctrlEnter' ? t('aiCommandInput.generateTitleCtrlEnter') : t('aiCommandInput.generateTitleEnter')}
                >
                    {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                </button>
            </div>

            {generatedCommand && (
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 p-1.5">
                    <Terminal className="h-3.5 w-3.5 flex-shrink-0 text-green-500" />
                    <code className="scrollbar-hide flex-1 overflow-x-auto whitespace-nowrap font-mono text-[12px] text-foreground">
                        {generatedCommand}
                    </code>
                    <button
                        onClick={handleAcceptCommand}
                        className="rounded bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                        {t('aiCommandInput.insert')}
                    </button>
                    <button
                        onClick={handleClear}
                        className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                        {t('aiCommandInput.retry')}
                    </button>
                </div>
            )}

            {error && (
                <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-1.5 text-[11px] text-destructive">
                    <span>{error}</span>
                </div>
            )}
        </div>
    );
}
