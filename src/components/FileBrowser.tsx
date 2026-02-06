import { useEffect, useState } from 'react';
import { FileEntry } from '../shared/types';
import { Folder, File, ArrowLeft, RefreshCw, Upload, Download, Trash2, MoreVertical, Edit2, Plus, ArrowUp, FolderPlus, Star, Bookmark, X } from 'lucide-react';
import { FileEditor } from './FileEditor';

interface FileBrowserProps {
  connectionId: string;
}

interface ContextMenu {
  x: number;
  y: number;
  file: FileEntry;
}

export function FileBrowser({ connectionId }: FileBrowserProps) {
  const [currentPath, setCurrentPath] = useState('.');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [editingFile, setEditingFile] = useState<{ name: string, path: string, content: string } | null>(null);
  const [pathCache, setPathCache] = useState<Record<string, FileEntry[]>>({});
  const [inputPath, setInputPath] = useState('.');
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ file: string, percent: number } | null>(null);

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
    loadFiles('.', true);

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
    const name = prompt('Folder name:');
    if (name) {
      setLoading(true);
      try {
        const newPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
        await window.electron.sftpMkdir(connectionId, newPath);
        loadFiles(currentPath, true);
      } catch (e) {
        alert('Create folder failed: ' + e);
      } finally {
        setLoading(false);
      }
    }
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
    const newName = prompt('New name:', file.name);
    if (newName && newName !== file.name) {
      setLoading(true);
      try {
        const oldPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
        const newPath = currentPath === '/' ? `/${newName}` : `${currentPath}/${newName}`;
        await window.electron.sftpRename(connectionId, oldPath, newPath);
        loadFiles(currentPath, true);
      } catch (e) {
        alert('Rename failed: ' + e);
      } finally {
        setLoading(false);
      }
    }
  };

  const onContextMenu = (e: React.MouseEvent, file: FileEntry) => {
    e.preventDefault();
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
        <button onClick={handleCreateFolder} className="p-1.5 hover:bg-secondary rounded text-muted-foreground hover:text-foreground transition-colors" title="New Folder">
          <FolderPlus className="w-4 h-4" />
        </button>
        <button onClick={handleUpload} className="p-1.5 hover:bg-secondary rounded text-muted-foreground hover:text-foreground transition-colors" title="Upload">
          <Upload className="w-4 h-4" />
        </button>
      </div>

      {/* File List */}
      <div className="flex-1 overflow-auto bg-background">
        <div className="flex flex-col">
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
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-popover border border-border shadow-xl rounded py-1 z-50 w-40 text-popover-foreground"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <div className="px-3 py-1 text-xs text-muted-foreground border-b border-border mb-1 truncate">
            {contextMenu.file.name}
          </div>
          <button onClick={() => {
            if (contextMenu.file.type === '-') {
              const path = currentPath === '/' ? `/${contextMenu.file.name}` : `${currentPath}/${contextMenu.file.name}`;
              handleFileOpen(contextMenu.file, path);
              setContextMenu(null);
            }
          }} className="w-full text-left px-3 py-1.5 hover:bg-secondary flex items-center gap-2 text-sm">
            <Edit2 className="w-3 h-3" /> Edit
          </button>
          <button onClick={() => handleDownload(contextMenu.file)} className="w-full text-left px-3 py-1.5 hover:bg-secondary flex items-center gap-2 text-sm">
            <Download className="w-3 h-3" /> Download
          </button>
          <button onClick={() => handleRename(contextMenu.file)} className="w-full text-left px-3 py-1.5 hover:bg-secondary flex items-center gap-2 text-sm">
            <Edit2 className="w-3 h-3" /> Rename
          </button>
          <button onClick={() => handleDelete(contextMenu.file)} className="w-full text-left px-3 py-1.5 hover:bg-destructive/10 text-destructive flex items-center gap-2 text-sm">
            <Trash2 className="w-3 h-3" /> Delete
          </button>
        </div>
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
    </div>
  );
}
