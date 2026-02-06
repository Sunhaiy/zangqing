import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileEntry } from '../shared/types';
import { Folder, File, ArrowLeft, RefreshCw, Upload, Download, Trash2, MoreVertical, Edit2, Plus, ArrowUp, FolderPlus, Star, Bookmark, X } from 'lucide-react';
import { FileEditor } from './FileEditor';

interface FileBrowserProps {
  connectionId: string;
}

interface ContextMenu {
  x: number;
  y: number;
  file: FileEntry | null;
}

export function FileBrowser({ connectionId }: FileBrowserProps) {
  const [currentPath, setCurrentPath] = useState('/');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [editingFile, setEditingFile] = useState<{ name: string, path: string, content: string } | null>(null);
  const [pathCache, setPathCache] = useState<Record<string, FileEntry[]>>({});
  const [inputPath, setInputPath] = useState('/');
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ file: string, percent: number } | null>(null);
  const [inputDialog, setInputDialog] = useState<{
    title: string;
    message: string;
    defaultValue: string;
    onConfirm: (value: string) => void;
  } | null>(null);

  useEffect(() => {
    // Load bookmarks
    window.electron.storeGet('bookmarks').then(stored => {
      if (Array.isArray(stored)) setBookmarks(stored);
    });
  }, []);

  const toggleBookmark = (path: string) => {
    const newBookmarks = bookmarks.includes(path)
      ? bookmarks.filter(b => b !== path)
      : [...bookmarks, path];
    setBookmarks(newBookmarks);
    window.electron.storeSet('bookmarks', newBookmarks);
  };

  const loadFiles = async (path: string, force = false) => {
    // Optimistic cache hit
    if (!force && pathCache[path]) {
      setFiles(pathCache[path]);
      setCurrentPath(path);
      setInputPath(path);
      return;
    }

    setLoading(true);
    try {
      // First get absolute path if we are at .
      if (path === '.') {
        const pwd = await window.electron.getPwd(connectionId);
        path = pwd;
        if (!force && pathCache[path]) {
          setFiles(pathCache[path]);
          setCurrentPath(path);
          setInputPath(path);
          setLoading(false);
          return;
        }
      }

      const list = await window.electron.sftpList(connectionId, path);
      const newFiles = Array.isArray(list) ? list : [];
      setFiles(newFiles);
      setPathCache(prev => ({ ...prev, [path]: newFiles }));
      setCurrentPath(path);
      setInputPath(path);
    } catch (err) {
      console.error(err);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };

  const handleFileOpen = async (file: FileEntry, path: string) => {
    setLoading(true);
    try {
      const content = await window.electron.sftpReadFile(connectionId, path);
      setEditingFile({
        name: file.name,
        path: path,
        content: content
      });
    } catch (err) {
      alert('Cannot open file: ' + err);
    } finally {
      setLoading(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    for (const file of files) {
      const filePath = (file as any).path;
      if (!filePath) continue;

      setUploadProgress({ file: file.name, percent: 0 });
      try {
        await window.electron.sftpUpload(connectionId, filePath, currentPath + '/' + file.name);
      } catch (err: any) {
        alert(`Failed to upload ${file.name}: ${err.message}`);
      }
    }
    setUploadProgress(null);
    loadFiles(currentPath, true);
  };

  useEffect(() => {
    setPathCache({});
    loadFiles('/', true);

    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [connectionId]);

  const handleNavigate = (entry: FileEntry) => {
    if (entry.type === 'd') {
      const newPath = currentPath === '/' ? `/${entry.name}` : `${currentPath}/${entry.name}`;
      loadFiles(newPath);
    }
  };

  const handleUp = () => {
    if (currentPath === '/') return;
    const parts = currentPath.split('/');
    parts.pop();
    const newPath = parts.length === 1 ? '/' : parts.join('/') || '/';
    loadFiles(newPath);
  };

  const handleUpload = async () => {
    const localPath = await window.electron.openDialog();
    if (localPath) {
      setLoading(true);
      try {
        const filename = localPath.split(/[\\/]/).pop();
        const remotePath = currentPath === '/' ? `/${filename}` : `${currentPath}/${filename}`;
        await window.electron.sftpUpload(connectionId, localPath, remotePath);
        loadFiles(currentPath, true);
      } catch (e) {
        alert('Upload failed: ' + e);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleCreateFolder = async () => {
    setContextMenu(null);
    setInputDialog({
      title: 'New Folder',
      message: 'Enter folder name:',
      defaultValue: '',
      onConfirm: async (name) => {
        setLoading(true);
        try {
          const newPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
          await window.electron.sftpMkdir(connectionId, newPath);
          await loadFiles(currentPath, true);
        } catch (e) {
          alert('Create folder failed: ' + e);
        } finally {
          setLoading(false);
        }
      }
    });
  };

  const handleCreateFile = async () => {
    setContextMenu(null);
    setInputDialog({
      title: 'New File',
      message: 'Enter file name:',
      defaultValue: '',
      onConfirm: async (name) => {
        setLoading(true);
        try {
          const newPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
          await window.electron.sftpWriteFile(connectionId, newPath, '');
          await loadFiles(currentPath, true);
        } catch (e) {
          alert('Create file failed: ' + e);
        } finally {
          setLoading(false);
        }
      }
    });
  };

  const handleDelete = async (file: FileEntry) => {
    if (confirm(`Delete ${file.name}?`)) {
      setLoading(true);
      try {
        const path = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
        await window.electron.sftpDelete(connectionId, path);
        loadFiles(currentPath, true);
      } catch (e) {
        alert('Delete failed: ' + e);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleDownload = async (file: FileEntry) => {
    const localPath = await window.electron.saveDialog(file.name);
    if (localPath) {
      setLoading(true);
      try {
        const remotePath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
        await window.electron.sftpDownload(connectionId, remotePath, localPath);
        alert('Download complete');
      } catch (e) {
        alert('Download failed: ' + e);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleRename = async (file: FileEntry) => {
    setContextMenu(null);
    setInputDialog({
      title: 'Rename',
      message: `Enter new name for ${file.name}:`,
      defaultValue: file.name,
      onConfirm: async (newName) => {
        if (newName && newName !== file.name) {
          setLoading(true);
          try {
            const oldPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
            const newPath = currentPath === '/' ? `/${newName}` : `${currentPath}/${newName}`;
            await window.electron.sftpRename(connectionId, oldPath, newPath);
            await loadFiles(currentPath, true);
          } catch (e) {
            alert('Rename failed: ' + e);
          } finally {
            setLoading(false);
          }
        }
      }
    });
  };

  const onContextMenu = (e: React.MouseEvent, file: FileEntry | null = null) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, file });
  };

  return (
    <div
      className="flex flex-col h-full bg-background border-r border-border text-foreground relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-primary/20 border-2 border-dashed border-primary flex items-center justify-center pointer-events-none backdrop-blur-[1px]">
          <div className="bg-background/80 p-4 rounded-lg shadow-lg flex flex-col items-center animate-bounce">
            <Upload className="w-8 h-8 text-primary mb-2" />
            <span className="font-bold text-primary">Drop files to upload</span>
          </div>
        </div>
      )}

      {uploadProgress && (
        <div className="absolute bottom-4 right-4 z-50 bg-card border border-border shadow-lg p-3 rounded-lg flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2">
          <RefreshCw className="w-4 h-4 text-primary animate-spin" />
          <div className="text-sm">
            <div className="font-medium">Uploading...</div>
            <div className="text-xs text-muted-foreground">{uploadProgress.file}</div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="p-2 border-b border-border flex items-center gap-2 bg-card">
        <button onClick={handleUp} className="p-1.5 hover:bg-secondary rounded text-muted-foreground hover:text-foreground transition-colors" title="Up">
          <ArrowUp className="w-4 h-4" />
        </button>

        <div className="flex-1 flex items-center gap-1 bg-background border border-border rounded px-2 h-8">
          <input
            className="flex-1 bg-transparent border-none outline-none text-sm font-mono h-full"
            value={inputPath}
            onChange={(e) => setInputPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                loadFiles(inputPath);
              }
            }}
          />
          {/* Bookmark Toggle */}
          <button
            onClick={() => toggleBookmark(currentPath)}
            className={`p-1 rounded transition-colors ${bookmarks.includes(currentPath) ? 'text-yellow-500' : 'text-muted-foreground hover:text-foreground'}`}
            title="Bookmark current path"
          >
            <Star className={`w-3.5 h-3.5 ${bookmarks.includes(currentPath) ? 'fill-current' : ''}`} />
          </button>
        </div>

        {/* Bookmarks Dropdown Trigger */}
        <div className="relative group">
          <button className="p-1.5 hover:bg-secondary rounded text-muted-foreground hover:text-foreground transition-colors" title="Bookmarks">
            <Bookmark className="w-4 h-4" />
          </button>
          <div className="absolute right-0 top-full mt-1 w-48 bg-popover border border-border rounded shadow-xl hidden group-hover:block z-50">
            <div className="p-2 text-xs font-medium text-muted-foreground border-b border-border">Favorites</div>
            {bookmarks.length === 0 ? (
              <div className="p-2 text-xs text-muted-foreground italic">No bookmarks</div>
            ) : (
              bookmarks.map(path => (
                <div
                  key={path}
                  className="px-3 py-2 hover:bg-secondary cursor-pointer text-xs truncate flex justify-between items-center"
                  onClick={() => loadFiles(path)}
                >
                  <span className="truncate flex-1" title={path}>{path}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleBookmark(path); }}
                    className="text-muted-foreground hover:text-destructive ml-2"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <button onClick={() => loadFiles(currentPath, true)} className="p-1.5 hover:bg-secondary rounded text-muted-foreground hover:text-foreground transition-colors" title="Refresh">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <button onClick={handleUpload} className="p-1.5 hover:bg-secondary rounded text-muted-foreground hover:text-foreground transition-colors" title="Upload">
          <Upload className="w-4 h-4" />
        </button>
      </div>

      {/* File List */}
      <div
        className="flex-1 overflow-auto bg-background"
        onContextMenu={(e) => onContextMenu(e)}
      >
        <div className="flex flex-col min-h-full">
          {files.map((file, i) => (
            <div
              key={i}
              className="flex items-center gap-2 px-3 py-2 hover:bg-secondary cursor-pointer text-sm group transition-colors select-none"
              onClick={() => file.type === 'd' && handleNavigate(file)}
              onDoubleClick={() => {
                if (file.type === '-') {
                  const path = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
                  handleFileOpen(file, path);
                }
              }}
              onContextMenu={(e) => onContextMenu(e, file)}
            >
              {file.type === 'd' ?
                <Folder className="w-4 h-4 text-blue-400 shrink-0" /> :
                <File className="w-4 h-4 text-muted-foreground shrink-0" />
              }
              <span className="truncate flex-1 text-foreground">{file.name}</span>
              <span className="text-xs text-muted-foreground w-16 text-right tabular-nums">
                {file.type === '-' ? (file.size < 1024 ? `${file.size} B` : `${(file.size / 1024).toFixed(1)} KB`) : ''}
              </span>
            </div>
          ))}
          {/* Fill clickable space for context menu */}
          <div className="flex-1 min-h-[50px]" />
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && createPortal(
        <>
          {/* Backdrop to close menu on click outside */}
          <div
            className="fixed inset-0 z-[10002]"
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu(null);
            }}
          />
          <div
            className="fixed bg-popover border border-border shadow-xl rounded py-1 z-[10003] w-44 text-popover-foreground animate-in fade-in zoom-in-95 duration-100"
            style={{
              top: Math.min(contextMenu.y, window.innerHeight - 200),
              left: Math.min(contextMenu.x, window.innerWidth - 180)
            }}
          >
            {contextMenu.file ? (
              <>
                <div className="px-3 py-1 text-xs text-muted-foreground border-b border-border mb-1 truncate font-medium">
                  {contextMenu.file.name}
                </div>
                <button onClick={() => {
                  if (contextMenu.file?.type === '-') {
                    const path = currentPath === '/' ? `/${contextMenu.file.name}` : `${currentPath}/${contextMenu.file.name}`;
                    handleFileOpen(contextMenu.file, path);
                    setContextMenu(null);
                  }
                }} className="w-full text-left px-3 py-1.5 hover:bg-secondary flex items-center gap-2 text-sm disabled:opacity-50" disabled={contextMenu.file.type !== '-'}>
                  <Edit2 className="w-3.5 h-3.5" /> Edit
                </button>
                <button onClick={() => {
                  if (contextMenu.file) handleDownload(contextMenu.file);
                  setContextMenu(null);
                }} className="w-full text-left px-3 py-1.5 hover:bg-secondary flex items-center gap-2 text-sm">
                  <Download className="w-3.5 h-3.5" /> Download
                </button>
                <button onClick={() => {
                  if (contextMenu.file) handleRename(contextMenu.file);
                  setContextMenu(null);
                }} className="w-full text-left px-3 py-1.5 hover:bg-secondary flex items-center gap-2 text-sm">
                  <Edit2 className="w-3.5 h-3.5" /> Rename
                </button>
                <button onClick={() => {
                  if (contextMenu.file) handleDelete(contextMenu.file);
                  setContextMenu(null);
                }} className="w-full text-left px-3 py-1.5 hover:bg-destructive/10 text-destructive flex items-center gap-2 text-sm">
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
                <div className="h-px bg-border my-1" />
              </>
            ) : (
              <div className="px-3 py-1 text-xs text-muted-foreground border-b border-border mb-1 font-medium">
                Actions
              </div>
            )}

            <button onClick={handleCreateFile} className="w-full text-left px-3 py-1.5 hover:bg-secondary flex items-center gap-2 text-sm text-primary">
              <Plus className="w-3.5 h-3.5" /> New File
            </button>
            <button onClick={handleCreateFolder} className="w-full text-left px-3 py-1.5 hover:bg-secondary flex items-center gap-2 text-sm text-primary">
              <FolderPlus className="w-3.5 h-3.5" /> New Folder
            </button>
            <button onClick={() => { handleUpload(); setContextMenu(null); }} className="w-full text-left px-3 py-1.5 hover:bg-secondary flex items-center gap-2 text-sm">
              <Upload className="w-3.5 h-3.5" /> Upload File
            </button>
            <button onClick={() => { loadFiles(currentPath, true); setContextMenu(null); }} className="w-full text-left px-3 py-1.5 hover:bg-secondary flex items-center gap-2 text-sm border-t border-border mt-1 pt-2">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          </div>
        </>,
        document.body
      )}

      {/* File Editor Modal */}
      {editingFile && (
        <FileEditor
          fileName={editingFile.name}
          filePath={editingFile.path}
          initialContent={editingFile.content}
          onSave={async (newContent) => {
            await window.electron.sftpWriteFile(connectionId, editingFile.path, newContent);
          }}
          onClose={() => setEditingFile(null)}
        />
      )}
      {/* Custom Input Dialog */}
      {inputDialog && createPortal(
        <div className="fixed inset-0 z-[10010] flex items-center justify-center p-4 bg-background/40 backdrop-blur-[2px]">
          <div className="w-full max-w-sm bg-card border border-border shadow-2xl rounded-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-4 py-3 border-b border-border bg-muted/50 font-medium text-sm flex justify-between items-center">
              {inputDialog.title}
              <button onClick={() => setInputDialog(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <label className="text-sm text-muted-foreground">{inputDialog.message}</label>
              <input
                autoFocus
                className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                defaultValue={inputDialog.defaultValue}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    inputDialog.onConfirm(e.currentTarget.value);
                    setInputDialog(null);
                  } else if (e.key === 'Escape') {
                    setInputDialog(null);
                  }
                }}
                id="dialog-input"
              />
              <div className="flex justify-end gap-2 mt-2">
                <button
                  onClick={() => setInputDialog(null)}
                  className="px-4 py-2 text-sm hover:bg-secondary rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const val = (document.getElementById('dialog-input') as HTMLInputElement).value;
                    inputDialog.onConfirm(val);
                    setInputDialog(null);
                  }}
                  className="px-4 py-2 text-sm bg-primary text-primary-foreground hover:bg-primary/90 rounded transition-colors"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
