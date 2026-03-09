import { useState, useEffect, useRef, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { X, Save, Loader2, FileCode, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from './ui/button';
import { useThemeStore } from '../store/themeStore';

interface FileEditorProps {
    fileName: string;
    filePath: string;
    initialContent: string;
    onSave: (content: string) => Promise<void>;
    onClose: () => void;
}

export function FileEditor({ fileName, filePath, initialContent, onSave, onClose }: FileEditorProps) {
    const [content, setContent] = useState(initialContent);
    const [isSaving, setIsSaving] = useState(false);
    const [isDirty, setIsDirty] = useState(false);
    const [isMaximized, setIsMaximized] = useState(false);
    const { baseThemeId } = useThemeStore();

    const windowRef = useRef<HTMLDivElement>(null);
    const isDragging = useRef(false);
    const dragStart = useRef({ mx: 0, my: 0, tx: 0, ty: 0 });
    const pos = useRef({ x: 0, y: 0 });
    const W = 920, H = 620;

    // Center window on mount via transform (GPU-accelerated, no layout reflow)
    useEffect(() => {
        const x = Math.round((window.innerWidth - W) / 2);
        const y = Math.round((window.innerHeight - H) / 2);
        pos.current = { x, y };
        if (windowRef.current) {
            windowRef.current.style.transform = `translate(${x}px,${y}px)`;
        }
    }, []);

    const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (isMaximized) return;
        isDragging.current = true;
        dragStart.current = { mx: e.clientX, my: e.clientY, tx: pos.current.x, ty: pos.current.y };
        e.preventDefault();
    }, [isMaximized]);

    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            if (!isDragging.current || !windowRef.current) return;
            const x = Math.max(0, Math.min(window.innerWidth - W, dragStart.current.tx + e.clientX - dragStart.current.mx));
            const y = Math.max(0, Math.min(window.innerHeight - 40, dragStart.current.ty + e.clientY - dragStart.current.my));
            pos.current = { x, y };
            windowRef.current.style.transform = `translate(${x}px,${y}px)`;
        };
        const onUp = () => { isDragging.current = false; };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    }, []);

    const handleEditorChange = (value: string | undefined) => {
        if (value !== undefined) {
            setContent(value);
            setIsDirty(value !== initialContent);
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await onSave(content);
            setIsDirty(false);
        } catch (error) {
            alert('Failed to save file: ' + error);
        } finally {
            setIsSaving(false);
        }
    };

    // Keyboard shortcut for Ctrl+S
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                handleSave();
            }
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [content]);

    const getLanguage = (filename: string) => {
        const ext = filename.split('.').pop()?.toLowerCase();
        switch (ext) {
            case 'js': return 'javascript';
            case 'ts': return 'typescript';
            case 'json': return 'json';
            case 'html': return 'html';
            case 'css': return 'css';
            case 'md': return 'markdown';
            case 'py': return 'python';
            case 'sh': return 'shell';
            case 'yml':
            case 'yaml': return 'yaml';
            case 'xml': return 'xml';
            case 'sql': return 'sql';
            case 'java': return 'java';
            case 'go': return 'go';
            case 'c':
            case 'cpp': return 'cpp';
            case 'conf':
            case 'nginx': return 'shell';
            default: return 'plaintext';
        }
    };

    const windowStyle: React.CSSProperties = isMaximized
        ? { position: 'fixed', inset: 0, borderRadius: 0 }
        : { position: 'fixed', left: 0, top: 0, width: W, height: H, willChange: 'transform' };

    return (
        <>
            {/* Semi-transparent backdrop */}
            <div
                className="fixed inset-0 z-[45] bg-black/25 backdrop-blur-[1px]"
                onClick={onClose}
            />

            {/* Floating Editor Window */}
            <div
                ref={windowRef}
                className="z-[50] flex flex-col bg-background border border-border rounded-xl shadow-2xl overflow-hidden"
                style={windowStyle}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Title bar (drag handle) */}
                <div
                    className="flex items-center justify-between px-3 py-2 bg-card border-b border-border cursor-move select-none shrink-0"
                    onMouseDown={onMouseDown}
                    onDoubleClick={() => setIsMaximized(v => !v)}
                >
                    <div className="flex items-center gap-2 overflow-hidden min-w-0">
                        <FileCode className="w-4 h-4 text-primary shrink-0" />
                        <div className="flex flex-col min-w-0">
                            <span className="text-xs font-medium flex items-center gap-1.5 leading-tight">
                                {fileName}
                                {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 shrink-0" title="未保存" />}
                            </span>
                            <span className="text-[10px] text-muted-foreground truncate max-w-[500px] leading-tight">{filePath}</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-2" onMouseDown={e => e.stopPropagation()}>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleSave}
                            disabled={isSaving || !isDirty}
                            className="gap-1.5 h-7 text-xs px-2"
                        >
                            {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                            保存
                        </Button>
                        <button
                            onClick={() => setIsMaximized(v => !v)}
                            className="p-1.5 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                            title={isMaximized ? '还原' : '最大化'}
                        >
                            {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                        </button>
                        <button
                            onClick={onClose}
                            className="p-1.5 rounded hover:bg-destructive/15 hover:text-destructive transition-colors text-muted-foreground"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>

                {/* Monaco Editor */}
                <div className="flex-1 w-full min-h-0 relative">
                    <Editor
                        height="100%"
                        defaultLanguage={getLanguage(fileName)}
                        defaultValue={initialContent}
                        theme={baseThemeId === 'light' ? 'light' : 'vs-dark'}
                        value={content}
                        onChange={handleEditorChange}
                        options={{
                            minimap: { enabled: false },
                            fontSize: 13,
                            fontFamily: '"Fira Code", "Cascadia Code", monospace',
                            scrollBeyondLastLine: false,
                            automaticLayout: true,
                            padding: { top: 12 },
                            lineNumbersMinChars: 3,
                        }}
                    />
                </div>
            </div>
        </>
    );
}
