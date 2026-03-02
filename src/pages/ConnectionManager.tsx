import { useState, useEffect } from 'react';
import { SSHConnection } from '../shared/types';
import { Button } from '../components/ui/button';
import { Trash2, Plus, Edit2, Server, Zap, Globe, ArrowRight, Search, Copy } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslation } from '../hooks/useTranslation';
import { Modal } from '../components/ui/modal';
import { ConnectionForm } from '../components/ConnectionForm';
import { Input } from '../components/ui/input';

interface ConnectionManagerProps {
  onConnect: (connection: SSHConnection) => void;
  onNavigate: (page: 'connections' | 'workspace' | 'settings') => void;
  activeSessions?: number;
}

export function ConnectionManager({ onConnect, onNavigate, activeSessions = 0 }: ConnectionManagerProps) {
  const [connections, setConnections] = useState<SSHConnection[]>([]);
  const [editingConnection, setEditingConnection] = useState<Partial<SSHConnection> | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const { t } = useTranslation();

  useEffect(() => {
    loadConnections();
  }, []);

  const loadConnections = async () => {
    try {
      if (!(window as any).electron) return;
      const stored = await (window as any).electron.storeGet('connections');
      if (stored) setConnections(stored);
    } catch (err) {
      console.error('Failed to load connections:', err);
    }
  };

  const handleSave = async (data: SSHConnection) => {
    const username = data.username || 'root';
    const name = data.name || (data.host ? `${username}@${data.host}` : 'New Server');
    const conn: SSHConnection = {
      ...data,
      id: data.id || Date.now().toString(),
      name,
      username,
    };
    const next = data.id
      ? connections.map(c => c.id === data.id ? conn : c)
      : [...connections, conn];
    setConnections(next);
    await (window as any).electron.storeSet('connections', next);
    setIsModalOpen(false);
    setEditingConnection(null);
  };

  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const deleteConnection = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPendingDelete(id);  // show inline confirm instead of native dialog
  };

  const confirmDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = connections.filter(c => c.id !== id);
    setConnections(next);
    await (window as any).electron.storeSet('connections', next);
    setPendingDelete(null);
  };

  const editConnection = (conn: SSHConnection, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingConnection(conn);
    setIsModalOpen(true);
  };

  const filtered = filterQuery
    ? connections.filter(c =>
      c.name.toLowerCase().includes(filterQuery.toLowerCase()) ||
      c.host.toLowerCase().includes(filterQuery.toLowerCase())
    )
    : connections;

  return (
    <div className="flex flex-col h-full bg-transparent overflow-hidden">
      {/* Toolbar */}
      <div className="shrink-0 h-10 flex items-center gap-2 px-4 border-b border-border/40">
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
          <Input
            placeholder={t('connection.name') + ' / Host...'}
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            className="h-7 pl-8 text-xs bg-secondary/30 border-border/30"
          />
        </div>
        <div className="flex-1" />
        <span className="text-[11px] text-muted-foreground/50 mr-2">
          {connections.length} {connections.length === 1 ? 'server' : 'servers'}
        </span>
        <Button
          onClick={() => { setEditingConnection({}); setIsModalOpen(true); }}
          size="sm"
          className="h-7 gap-1.5 text-xs rounded-md px-3"
        >
          <Plus className="w-3 h-3" />
          {t('connection.new')}
        </Button>
      </div>

      {/* Connection List */}
      <div className="flex-1 overflow-y-auto">
        {connections.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <div className="w-16 h-16 rounded-2xl bg-muted/50 border border-border/40 flex items-center justify-center mb-5">
              <Globe className="w-7 h-7 text-muted-foreground/25" />
            </div>
            <h3 className="text-sm font-semibold mb-1.5">没有已保存的连接</h3>
            <p className="text-xs text-muted-foreground/60 max-w-sm mb-5 leading-relaxed">
              添加你的第一个 SSH 服务器，开始远程管理。
            </p>
            <Button
              onClick={() => { setEditingConnection({}); setIsModalOpen(true); }}
              size="sm"
              className="gap-1.5 text-xs h-8 px-5 rounded-md"
            >
              <Plus className="w-3.5 h-3.5" />
              添加服务器
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <Search className="w-8 h-8 text-muted-foreground/20 mb-3" />
            <p className="text-xs text-muted-foreground/50">没有匹配 "{filterQuery}" 的连接</p>
          </div>
        ) : (
          <div className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
              {filtered.map((c, idx) => {
                const accentColors = ['#10b981', '#8b5cf6', '#3b82f6', '#f59e0b', '#f43f5e'];
                const accentHex = accentColors[idx % accentColors.length];

                // OS detection from name/host keywords
                const nameLower = (c.name + ' ' + (c.os || '')).toLowerCase();
                let osIcon = '🐧'; // default Linux
                let osName = 'Linux';
                if (nameLower.includes('ubuntu')) { osIcon = ''; osName = 'Ubuntu'; }
                else if (nameLower.includes('debian')) { osIcon = ''; osName = 'Debian'; }
                else if (nameLower.includes('centos') || nameLower.includes('rhel') || nameLower.includes('redhat')) { osIcon = ''; osName = 'CentOS'; }
                else if (nameLower.includes('alpine')) { osIcon = ''; osName = 'Alpine'; }
                else if (nameLower.includes('windows') || nameLower.includes('win')) { osIcon = ''; osName = 'Windows'; }

                // OS SVG icons
                const OsLogo = () => {
                  const size = 18;
                  if (osName === 'Ubuntu') return (
                    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" /><circle cx="12" cy="5" r="1.8" fill="#E95420" /><circle cx="6" cy="15.5" r="1.8" fill="#E95420" /><circle cx="18" cy="15.5" r="1.8" fill="#E95420" /></svg>
                  );
                  if (osName === 'Debian') return (
                    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" /><path d="M13 6c1.5.5 3 2 3.5 4s0 4-1.5 5.5-4 2-6 1-3-3-2.5-5.5S11 6 13 6z" stroke="#A80030" strokeWidth="1.5" fill="none" /></svg>
                  );
                  if (osName === 'CentOS') return (
                    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="8" height="8" rx="1" fill="#9CCD2A" opacity="0.7" /><rect x="13" y="3" width="8" height="8" rx="1" fill="#262577" opacity="0.7" /><rect x="3" y="13" width="8" height="8" rx="1" fill="#932279" opacity="0.7" /><rect x="13" y="13" width="8" height="8" rx="1" fill="#EFA724" opacity="0.7" /></svg>
                  );
                  if (osName === 'Alpine') return (
                    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M12 4L3 18h18L12 4z" stroke="#0D597F" strokeWidth="1.5" fill="#0D597F" fillOpacity="0.2" /><path d="M12 9l-4 7h8l-4-7z" fill="#0D597F" fillOpacity="0.5" /></svg>
                  );
                  if (osName === 'Windows') return (
                    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M3 12.5l7.5-1V5L3 6.5v6zm0 1l7.5 1V21L3 19.5v-6zm8.5-2l9.5-1.5V4L11.5 6v5.5zm0 3l9.5 1.5V20l-9.5-2v-5z" fill="#00A4EF" opacity="0.8" /></svg>
                  );
                  return <Server className="w-4 h-4 text-white drop-shadow-sm" />;
                };

                const copyIp = (e: React.MouseEvent) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(c.host).catch(() => { });
                };

                return (
                  <div
                    key={c.id}
                    onClick={() => onConnect(c)}
                    className="group relative rounded-xl cursor-pointer transition-all duration-300 overflow-hidden bg-card/50 backdrop-blur-sm hover:scale-[1.02] hover:shadow-xl hover:-translate-y-1"
                    style={{ border: '1px solid transparent' }}
                  >
                    {/* Flowing gradient border on hover */}
                    <div
                      className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none card-border-glow"
                      style={{ '--glow-color': accentHex } as React.CSSProperties}
                    />
                    {/* Inner background to mask the border-image */}
                    <div className="absolute inset-[1px] rounded-[11px] bg-card/90 pointer-events-none" />

                    {/* Gradient orbs */}
                    <div
                      className="absolute -top-10 -right-10 w-28 h-28 rounded-full blur-2xl opacity-0 group-hover:opacity-25 transition-opacity duration-500 pointer-events-none"
                      style={{ background: `radial-gradient(circle, ${accentHex}60, transparent)` }}
                    />

                    <div className="relative p-4">
                      {/* Row 1: OS icon + tags + actions */}
                      <div className="flex items-start justify-between mb-3">
                        {/* OS icon with glassmorphism */}
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 backdrop-blur-sm border border-white/5"
                          style={{
                            background: `linear-gradient(135deg, ${accentHex}20, ${accentHex}08)`,
                            boxShadow: `0 4px 16px ${accentHex}15`,
                          }}
                        >
                          <OsLogo />
                        </div>

                        {/* Tags */}
                        <div className="flex items-center gap-1 flex-wrap justify-end flex-1 ml-2">
                          {c.tags?.map(tag => (
                            <span
                              key={tag}
                              className="text-[8px] px-1.5 py-0.5 rounded-full font-medium uppercase tracking-wide border"
                              style={{
                                color: accentHex,
                                borderColor: `${accentHex}30`,
                                backgroundColor: `${accentHex}10`,
                              }}
                            >{tag}</span>
                          ))}
                          {/* Edit/Delete - show on hover */}
                          <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-all duration-200 ml-1">
                            <button
                              onClick={(e) => editConnection(c, e)}
                              className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-accent/80 transition-colors"
                              title={t('common.edit')}
                            >
                              <Edit2 className="w-2.5 h-2.5" />
                            </button>
                            {pendingDelete === c.id ? (
                              <div className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setPendingDelete(null); }}
                                  className="h-5 px-1 rounded text-[9px] text-muted-foreground hover:bg-accent/80 transition-colors"
                                >取消</button>
                                <button
                                  onClick={(e) => confirmDelete(c.id, e)}
                                  className="h-5 px-1 rounded text-[9px] text-destructive bg-destructive/10 hover:bg-destructive/20 transition-colors"
                                >删除</button>
                              </div>
                            ) : (
                              <button
                                onClick={(e) => deleteConnection(c.id, e)}
                                className="h-5 w-5 rounded flex items-center justify-center text-destructive/30 hover:text-destructive hover:bg-destructive/10 transition-colors"
                                title={t('common.delete')}
                              >
                                <Trash2 className="w-2.5 h-2.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Row 2: Name + breathing dot */}
                      <div className="flex items-center gap-2 mb-1.5">
                        <h3 className="text-sm font-bold truncate" title={c.name}>{c.name}</h3>
                        <div
                          className="w-2 h-2 rounded-full shrink-0 card-breathe"
                          style={{ color: accentHex, backgroundColor: accentHex }}
                        />
                      </div>

                      {/* Row 3: Host with monospace */}
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50 mb-3">
                        <span className="font-mono-code truncate">{c.username}@{c.host}</span>
                        {c.port !== 22 && (
                          <span className="text-[9px] px-1 py-px rounded font-mono-code bg-card/80" style={{ border: `1px solid ${accentHex}25` }}>:{c.port}</span>
                        )}
                      </div>

                      {/* Row 4: Quick actions (visible on hover) */}
                      <div className="flex items-center justify-between pt-2 border-t border-border/10">
                        {/* Quick actions slide in */}
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all duration-300 -translate-x-1 group-hover:translate-x-0">
                          <button
                            onClick={copyIp}
                            className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-accent/60 transition-colors"
                            title="Copy IP"
                          >
                            <Copy className="w-2.5 h-2.5" />
                            <span>IP</span>
                          </button>
                        </div>

                        {/* Connect arrow */}
                        <div
                          className="w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-300 translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100"
                          style={{ background: `linear-gradient(135deg, ${accentHex}, ${accentHex}bb)` }}
                        >
                          <ArrowRight className="w-3.5 h-3.5 text-white" />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}


            </div>
          </div>
        )}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingConnection?.id ? t('common.edit') : t('connection.new')}
      >
        <ConnectionForm
          initialData={editingConnection || {}}
          onSave={handleSave}
          onCancel={() => setIsModalOpen(false)}
        />
      </Modal>
    </div>
  );
}
