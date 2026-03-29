import { useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertCircle,
    Container,
    FileText,
    HardDrive,
    Layers,
    Package,
    Pause,
    Play,
    RefreshCw,
    RotateCw,
    Search,
    Square,
    Terminal,
    Trash2,
    X,
} from 'lucide-react';
import { useTranslation } from '../hooks/useTranslation';

interface DockerContainer {
    id: string;
    name: string;
    image: string;
    status: string;
    state: string;
    ports: string;
    composeProject: string;
}

interface DockerImage {
    id: string;
    repository: string;
    tag: string;
    size: string;
    created: string;
}

interface DockerManagerProps {
    connectionId: string;
}

type TabId = 'containers' | 'images' | 'prune';
type ContainerFilter = 'all' | 'running' | 'stopped';

export function DockerManager({ connectionId }: DockerManagerProps) {
    const [tab, setTab] = useState<TabId>('containers');
    const { t } = useTranslation();

    const tabs: { id: TabId; label: string; icon: any }[] = [
        { id: 'containers', label: t('docker.containers'), icon: Container },
        { id: 'images', label: t('docker.images'), icon: Package },
        { id: 'prune', label: t('docker.prune'), icon: Trash2 },
    ];

    return (
        <div className="flex h-full flex-col bg-transparent text-foreground">
            <div className="flex border-b border-border bg-muted/30">
                {tabs.map((item) => (
                    <button
                        key={item.id}
                        onClick={() => setTab(item.id)}
                        className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors ${
                            tab === item.id
                                ? 'border-b-2 border-primary bg-primary/5 text-primary'
                                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                        }`}
                    >
                        <item.icon className="h-3.5 w-3.5" />
                        {item.label}
                    </button>
                ))}
            </div>

            <div className="flex-1 overflow-hidden">
                {tab === 'containers' && <ContainersTab connectionId={connectionId} />}
                {tab === 'images' && <ImagesTab connectionId={connectionId} />}
                {tab === 'prune' && <PruneTab connectionId={connectionId} />}
            </div>
        </div>
    );
}

function ContainersTab({ connectionId }: { connectionId: string }) {
    const { t } = useTranslation();
    const [containers, setContainers] = useState<DockerContainer[]>([]);
    const [loading, setLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<ContainerFilter>('all');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [actionMsg, setActionMsg] = useState<string | null>(null);
    const [pendingConfirm, setPendingConfirm] = useState<string | null>(null);

    const actionLabels: Record<string, string> = {
        start: t('dockerManager.start'),
        stop: t('dockerManager.stop'),
        restart: t('dockerManager.restart'),
        pause: t('dockerManager.pause'),
        unpause: t('dockerManager.resume'),
        remove: t('dockerManager.remove'),
    };

    const fetchContainers = async () => {
        setLoading(true);
        setError(null);
        try {
            const list = await (window as any).electron.getDockerContainers(connectionId);
            setContainers(list);
        } catch (err: any) {
            setError(err?.message || t('dockerManager.fetchContainersFailed'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchContainers();
        const interval = window.setInterval(fetchContainers, 8000);
        return () => window.clearInterval(interval);
    }, [connectionId]);

    const handleAction = async (containerId: string, action: string) => {
        setActionLoading(containerId);
        setActionMsg(null);
        try {
            await (window as any).electron.dockerAction(connectionId, containerId, action);
            setActionMsg(`${t('dockerManager.actionSucceeded')}: ${actionLabels[action] || action} ${containerId.substring(0, 12)}`);
            window.setTimeout(() => setActionMsg(null), 3000);
            await fetchContainers();
        } catch (err: any) {
            setError(`${t('dockerManager.actionFailed')}: ${err?.message || action}`);
        } finally {
            setActionLoading(null);
        }
    };

    const handleExec = (containerId: string) => {
        (window as any).electron?.writeTerminal(connectionId, `docker exec -it ${containerId} /bin/sh\n`);
    };

    const composeProjects = useMemo(() => {
        const projects = new Map<string, DockerContainer[]>();
        containers.forEach((container) => {
            if (!container.composeProject) return;
            const group = projects.get(container.composeProject) || [];
            group.push(container);
            projects.set(container.composeProject, group);
        });
        return projects;
    }, [containers]);

    const filtered = useMemo(() => {
        let list = containers;
        if (filter === 'running') list = list.filter((item) => item.state?.toLowerCase() === 'running');
        if (filter === 'stopped') list = list.filter((item) => item.state?.toLowerCase() !== 'running');
        if (searchTerm) {
            const keyword = searchTerm.toLowerCase();
            list = list.filter((item) =>
                item.name.toLowerCase().includes(keyword) || item.image.toLowerCase().includes(keyword),
            );
        }
        return list;
    }, [containers, filter, searchTerm]);

    const counts = useMemo(() => ({
        all: containers.length,
        running: containers.filter((item) => item.state?.toLowerCase() === 'running').length,
        stopped: containers.filter((item) => item.state?.toLowerCase() !== 'running').length,
    }), [containers]);

    const filterLabel = (value: ContainerFilter) => {
        if (value === 'running') return t('dockerManager.running');
        if (value === 'stopped') return t('dockerManager.stopped');
        return t('dockerManager.all');
    };

    const getStateColor = (state: string) => {
        const normalized = state?.toLowerCase();
        if (normalized === 'running') return 'bg-green-500';
        if (normalized === 'paused') return 'bg-yellow-500';
        if (normalized === 'exited') return 'bg-muted-foreground/50';
        return 'bg-red-400';
    };

    const getStateBadge = (state: string) => {
        const normalized = state?.toLowerCase();
        if (normalized === 'running') return 'bg-green-500/15 text-green-500';
        if (normalized === 'paused') return 'bg-yellow-500/15 text-yellow-500';
        return 'bg-muted text-muted-foreground';
    };

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 border-b border-border/50 p-3">
                <div className="flex overflow-hidden rounded-md bg-secondary/50 text-[11px]">
                    {(['all', 'running', 'stopped'] as ContainerFilter[]).map((value) => (
                        <button
                            key={value}
                            onClick={() => setFilter(value)}
                            className={`px-2.5 py-1 transition-colors ${
                                filter === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'
                            }`}
                        >
                            {filterLabel(value)}
                            <span className="ml-1 opacity-60">{counts[value]}</span>
                        </button>
                    ))}
                </div>

                <div className="relative flex-1">
                    <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                    <input
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder={t('dockerManager.searchContainers')}
                        className="w-full rounded-md border border-transparent bg-secondary/50 py-1 pl-7 pr-2 text-[11px] outline-none focus:border-primary/50"
                    />
                </div>

                <button onClick={fetchContainers} className="rounded p-1.5 transition-colors hover:bg-secondary" title={t('dockerManager.refresh')}>
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {error && (
                <div className="mx-3 mt-2 flex items-center gap-2 rounded-md bg-destructive/10 p-2.5 text-[11px] text-destructive">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    {error}
                    <button onClick={() => setError(null)} className="ml-auto">
                        <X className="h-3 w-3" />
                    </button>
                </div>
            )}

            {actionMsg && (
                <div className="mx-3 mt-2 rounded-md bg-green-500/10 p-2 font-mono text-[11px] text-green-500">
                    {actionMsg}
                </div>
            )}

            {composeProjects.size > 0 && (
                <div className="flex flex-wrap gap-1.5 px-3 pt-2">
                    {Array.from(composeProjects.entries()).map(([project, projectContainers]) => {
                        const running = projectContainers.filter((item) => item.state?.toLowerCase() === 'running').length;
                        return (
                            <div key={project} className="flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2 py-0.5 font-mono text-[10px] text-blue-400">
                                <Layers className="h-3 w-3" />
                                {project}
                                <span className="opacity-60">{running}/{projectContainers.length}</span>
                            </div>
                        );
                    })}
                </div>
            )}

            <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {filtered.length === 0 && !loading && !error && (
                    <div className="py-8 text-center text-xs text-muted-foreground opacity-70">
                        <Container className="mx-auto mb-2 h-8 w-8 opacity-30" />
                        {t('dockerManager.noContainers')}
                    </div>
                )}

                {filtered.map((container) => (
                    <div key={container.id} className="overflow-hidden rounded-lg border border-border bg-card/50 transition-colors hover:border-primary/30">
                        <div className="p-3">
                            <div className="mb-1.5 flex items-start justify-between">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 truncate text-xs font-medium">
                                        <div className={`h-2 w-2 shrink-0 rounded-full ${getStateColor(container.state)}`} />
                                        {container.name}
                                        {container.composeProject && (
                                            <span className="rounded bg-blue-500/10 px-1.5 py-0 font-mono text-[9px] text-blue-400">
                                                {container.composeProject}
                                            </span>
                                        )}
                                    </div>
                                    <div className="ml-4 mt-0.5 truncate text-[10px] text-muted-foreground">
                                        {container.image}
                                    </div>
                                </div>
                                <span className={`ml-2 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${getStateBadge(container.state)}`}>
                                    {container.state || 'unknown'}
                                </span>
                            </div>

                            <div className="mt-2 space-y-1.5">
                                <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground/60">
                                    <span>{container.id.substring(0, 12)}</span>
                                    {container.ports && <span className="truncate" title={container.ports}>Ports: {container.ports}</span>}
                                </div>

                                <div className="flex flex-wrap items-center gap-0.5">
                                    <button
                                        onClick={() => setExpandedId(expandedId === container.id ? null : container.id)}
                                        className={`rounded p-1 transition-colors ${
                                            expandedId === container.id ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-secondary'
                                        }`}
                                        title={t('dockerManager.logs')}
                                    >
                                        <FileText className="h-3.5 w-3.5" />
                                    </button>

                                    <button
                                        onClick={() => handleExec(container.id)}
                                        disabled={container.state?.toLowerCase() !== 'running'}
                                        className="rounded p-1 text-muted-foreground transition-colors hover:bg-purple-500/10 hover:text-purple-400 disabled:opacity-20"
                                        title={t('dockerManager.exec')}
                                    >
                                        <Terminal className="h-3.5 w-3.5" />
                                    </button>

                                    <button
                                        onClick={() => handleAction(container.id, 'start')}
                                        disabled={Boolean(actionLoading) || container.state?.toLowerCase() === 'running'}
                                        className="rounded p-1 text-muted-foreground transition-colors hover:bg-green-500/10 hover:text-green-500 disabled:opacity-20"
                                        title={t('dockerManager.start')}
                                    >
                                        <Play className="h-3.5 w-3.5" />
                                    </button>

                                    {container.state?.toLowerCase() === 'paused' ? (
                                        <button
                                            onClick={() => handleAction(container.id, 'unpause')}
                                            disabled={Boolean(actionLoading)}
                                            className="rounded p-1 text-muted-foreground transition-colors hover:bg-yellow-500/10 hover:text-yellow-500 disabled:opacity-20"
                                            title={t('dockerManager.resume')}
                                        >
                                            <Play className="h-3.5 w-3.5" />
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => handleAction(container.id, 'pause')}
                                            disabled={Boolean(actionLoading) || container.state?.toLowerCase() !== 'running'}
                                            className="rounded p-1 text-muted-foreground transition-colors hover:bg-yellow-500/10 hover:text-yellow-500 disabled:opacity-20"
                                            title={t('dockerManager.pause')}
                                        >
                                            <Pause className="h-3.5 w-3.5" />
                                        </button>
                                    )}

                                    <button
                                        onClick={() => handleAction(container.id, 'restart')}
                                        disabled={Boolean(actionLoading)}
                                        className="rounded p-1 text-muted-foreground transition-colors hover:bg-blue-500/10 hover:text-blue-500 disabled:opacity-20"
                                        title={t('dockerManager.restart')}
                                    >
                                        <RotateCw className={`h-3.5 w-3.5 ${actionLoading === container.id ? 'animate-spin' : ''}`} />
                                    </button>

                                    <button
                                        onClick={() => handleAction(container.id, 'stop')}
                                        disabled={Boolean(actionLoading) || container.state?.toLowerCase() !== 'running'}
                                        className="rounded p-1 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-20"
                                        title={t('dockerManager.stop')}
                                    >
                                        <Square className="h-3.5 w-3.5 fill-current" />
                                    </button>

                                    {pendingConfirm === container.id ? (
                                        <>
                                            <button
                                                onClick={() => setPendingConfirm(null)}
                                                className="rounded p-1 text-[10px] text-muted-foreground transition-colors hover:bg-secondary"
                                            >
                                                {t('dockerManager.cancel')}
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setPendingConfirm(null);
                                                    handleAction(container.id, 'remove');
                                                }}
                                                className="rounded bg-destructive/10 p-1 text-[10px] text-destructive transition-colors hover:bg-destructive/20"
                                            >
                                                {t('dockerManager.confirm')}
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            onClick={() => setPendingConfirm(container.id)}
                                            disabled={Boolean(actionLoading)}
                                            className="rounded p-1 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-20"
                                            title={t('dockerManager.remove')}
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {expandedId === container.id && (
                            <LogViewer connectionId={connectionId} containerId={container.id} containerName={container.name} />
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

function LogViewer({ connectionId, containerId, containerName }: { connectionId: string; containerId: string; containerName: string }) {
    const { t } = useTranslation();
    const [logs, setLogs] = useState('');
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const logRef = useRef<HTMLDivElement>(null);

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const text = await (window as any).electron.dockerLogs(connectionId, containerId, 300);
            setLogs(text);
            window.setTimeout(() => logRef.current?.scrollTo(0, logRef.current!.scrollHeight), 50);
        } catch {
            setLogs(t('dockerManager.fetchLogsFailed'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLogs();
    }, [containerId]);

    const lines = logs.split('\n');
    const filteredLines = searchTerm
        ? lines.filter((line) => line.toLowerCase().includes(searchTerm.toLowerCase()))
        : lines;

    const highlightSearch = (line: string) => {
        if (!searchTerm) return line;
        const idx = line.toLowerCase().indexOf(searchTerm.toLowerCase());
        if (idx === -1) return line;
        return (
            <>
                {line.slice(0, idx)}
                <span className="rounded bg-yellow-500/30 px-0.5 text-yellow-200">
                    {line.slice(idx, idx + searchTerm.length)}
                </span>
                {line.slice(idx + searchTerm.length)}
            </>
        );
    };

    return (
        <div className="border-t border-border bg-background/80">
            <div className="flex items-center gap-2 border-b border-border/50 bg-muted/30 px-3 py-1.5">
                <FileText className="h-3 w-3 text-muted-foreground" />
                <span className="font-mono text-[10px] text-muted-foreground">{containerName} {t('dockerManager.logs')}</span>
                <div className="relative flex-1">
                    <Search className="absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/50" />
                    <input
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder={t('common.search')}
                        className="w-full rounded border border-transparent bg-secondary/50 py-0.5 pl-6 pr-2 text-[10px] outline-none focus:border-primary/50"
                    />
                </div>
                <button onClick={fetchLogs} className="rounded p-1 hover:bg-secondary" title={t('dockerManager.refresh')}>
                    <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            <div ref={logRef} className="scrollbar-hide h-[200px] overflow-y-auto p-2 font-mono text-[10px] leading-[1.6] text-muted-foreground">
                {filteredLines.map((line, index) => (
                    <div key={index} className="whitespace-pre-wrap break-all px-1 hover:bg-muted/30">
                        {highlightSearch(line)}
                    </div>
                ))}
                {loading && (
                    <div className="py-4 text-center text-muted-foreground/50 animate-pulse">
                        {t('dockerManager.loading')}
                    </div>
                )}
            </div>
        </div>
    );
}

function ImagesTab({ connectionId }: { connectionId: string }) {
    const { t } = useTranslation();
    const [images, setImages] = useState<DockerImage[]>([]);
    const [loading, setLoading] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const fetchImages = async () => {
        setLoading(true);
        setError(null);
        try {
            const list = await (window as any).electron.dockerImages(connectionId);
            setImages(list);
        } catch (err: any) {
            setError(err?.message || t('common.error'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchImages();
    }, [connectionId]);

    const handleDelete = async (imageId: string) => {
        setDeleting(imageId);
        try {
            await (window as any).electron.dockerRemoveImage(connectionId, imageId);
            await fetchImages();
        } catch (err: any) {
            setError(err?.message || t('common.error'));
        } finally {
            setDeleting(null);
        }
    };

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-border/50 p-3">
                <div className="flex items-center gap-2 text-xs">
                    <Package className="h-4 w-4 text-blue-400" />
                    <span className="font-medium">{t('docker.images')}</span>
                    <span className="rounded-full bg-secondary px-1.5 text-[10px] text-muted-foreground">{images.length}</span>
                </div>
                <button onClick={fetchImages} className="rounded p-1.5 transition-colors hover:bg-secondary" title={t('dockerManager.refresh')}>
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {error && (
                <div className="mx-3 mt-2 flex items-center gap-2 rounded-md bg-destructive/10 p-2 text-[11px] text-destructive">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {error}
                </div>
            )}

            <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {images.map((image) => (
                    <div key={image.id} className="rounded-lg border border-border bg-card/50 p-3 transition-colors hover:border-primary/30">
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                                <div className="truncate font-mono text-xs text-foreground/90">
                                    {image.repository}<span className="text-muted-foreground">:{image.tag}</span>
                                </div>
                                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground/60">
                                    <span className="font-mono">{image.size}</span>
                                    <span>{image.created}</span>
                                    <span className="font-mono">{image.id.substring(0, 12)}</span>
                                </div>
                            </div>
                            <button
                                onClick={() => handleDelete(image.id)}
                                disabled={Boolean(deleting)}
                                className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-20"
                                title={t('dockerManager.remove')}
                            >
                                <Trash2 className={`h-3.5 w-3.5 ${deleting === image.id ? 'animate-spin' : ''}`} />
                            </button>
                        </div>
                    </div>
                ))}

                {images.length === 0 && !loading && (
                    <div className="py-8 text-center text-xs text-muted-foreground opacity-70">
                        <Package className="mx-auto mb-2 h-8 w-8 opacity-30" />
                        {t('docker.noDockerHint')}
                    </div>
                )}
            </div>
        </div>
    );
}

function PruneTab({ connectionId }: { connectionId: string }) {
    const { t } = useTranslation();
    const [diskUsage, setDiskUsage] = useState('');
    const [loading, setLoading] = useState(false);
    const [pruneResult, setPruneResult] = useState<string | null>(null);
    const [pruning, setPruning] = useState<string | null>(null);

    const fetchDiskUsage = async () => {
        setLoading(true);
        try {
            const text = await (window as any).electron.dockerDiskUsage(connectionId);
            setDiskUsage(text);
        } catch {
            setDiskUsage(t('dockerManager.diskUsageFailed'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDiskUsage();
    }, [connectionId]);

    const handlePrune = async (type: string) => {
        setPruning(type);
        setPruneResult(null);
        try {
            const result = await (window as any).electron.dockerPrune(connectionId, type);
            setPruneResult(result);
            await fetchDiskUsage();
        } catch (err: any) {
            setPruneResult(`${t('common.error')}: ${err?.message || type}`);
        } finally {
            setPruning(null);
        }
    };

    const pruneActions = [
        { type: 'containers', label: t('dockerManager.pruneContainers'), icon: Container, color: 'text-muted-foreground hover:bg-secondary', desc: 'docker container prune' },
        { type: 'images', label: t('dockerManager.pruneImages'), icon: Package, color: 'text-muted-foreground hover:bg-secondary', desc: 'docker image prune -a' },
        { type: 'volumes', label: t('dockerManager.pruneVolumes'), icon: HardDrive, color: 'text-muted-foreground hover:bg-secondary', desc: 'docker volume prune' },
        { type: 'system', label: t('dockerManager.pruneSystem'), icon: Trash2, color: 'text-muted-foreground hover:bg-secondary', desc: 'docker system prune -af --volumes' },
    ];

    return (
        <div className="flex h-full flex-col">
            <div className="border-b border-border/50 p-3">
                <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-medium">
                        <HardDrive className="h-4 w-4 text-amber-400" />
                        {t('docker.stats')}
                    </div>
                    <button onClick={fetchDiskUsage} className="rounded p-1 hover:bg-secondary" title={t('dockerManager.refresh')}>
                        <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
                <pre className="overflow-x-auto whitespace-pre rounded-md bg-secondary/30 p-2 font-mono text-[10px] leading-[1.5] text-muted-foreground">
                    {loading ? t('common.loading') : (diskUsage || t('common.loading'))}
                </pre>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {pruneActions.map((action) => (
                    <button
                        key={action.type}
                        onClick={() => handlePrune(action.type)}
                        disabled={Boolean(pruning)}
                        className={`w-full rounded-lg border border-border bg-card/50 p-3 text-left transition-all disabled:opacity-40 ${action.color}`}
                    >
                        <div className="flex items-center gap-3">
                            <action.icon className={`h-5 w-5 shrink-0 ${pruning === action.type ? 'animate-pulse' : ''}`} />
                            <div className="min-w-0">
                                <div className="text-xs font-medium">{action.label}</div>
                                <div className="font-mono text-[10px] text-muted-foreground/60">{action.desc}</div>
                            </div>
                        </div>
                    </button>
                ))}
            </div>

            {pruneResult && (
                <div className="border-t border-border p-3">
                    <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-[10px] font-medium text-muted-foreground">{t('docker.prune')}</span>
                        <button onClick={() => setPruneResult(null)} className="rounded p-0.5 hover:bg-secondary">
                            <X className="h-3 w-3" />
                        </button>
                    </div>
                    <pre className="max-h-[150px] overflow-x-auto overflow-y-auto whitespace-pre rounded-md bg-secondary/30 p-2 font-mono text-[10px] leading-[1.5] text-green-400/80">
                        {pruneResult}
                    </pre>
                </div>
            )}
        </div>
    );
}
