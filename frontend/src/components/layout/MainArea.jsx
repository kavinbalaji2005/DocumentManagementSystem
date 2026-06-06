import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { foldersApi, searchApi } from "@/api";
import {
  Folder,
  FileText,
  MoreVertical,
  Plus,
  Upload,
  Trash2,
  Edit2,
  Loader2,
  ArrowRightLeft,
  Home,
  ChevronRight,
  Shield,
  Search,
  Lock,
  AlertTriangle,
} from "lucide-react";
import { DocxIcon } from "@/components/ui/DocxIcon";
import { PdfIcon } from "@/components/ui/PdfIcon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { formatDistanceToNow } from "date-fns";
import {
  CreateFolderDialog,
  UploadDialog,
  RenameDialog,
  MoveDialog,
  DeleteDialog,
} from "./Dialogs";
import { AccessListDialog } from "./AccessListDialog";
import { useAuth } from "@/context/AuthContext";
import { useEffect } from "react";

function SearchBar({ onSelectFolder, onSelectDocument }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (query.trim()) {
        setLoading(true);
        searchApi.query(query).then((data) => {
          setResults(data);
          setLoading(false);
        }).catch(err => {
          console.error(err);
          setLoading(false);
        });
      } else {
        setResults(null);
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [query]);

  return (
    <div className="relative ml-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          className="h-8 w-[150px] sm:w-[200px] lg:w-[300px] rounded-md border border-input bg-background pl-8 pr-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {loading && <Loader2 className="absolute right-2.5 top-2 h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {isOpen && query.trim() && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute top-full left-0 mt-1 w-[300px] lg:w-[400px] bg-popover text-popover-foreground rounded-md border shadow-md z-50 max-h-[400px] overflow-auto py-1">
            {results && results.folders.length === 0 && results.documents.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground text-center">No results found</div>
            ) : (
              <>
                {results?.folders.length > 0 && (
                  <div className="px-2 py-1.5">
                    <div className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wider">Folders</div>
                    {results.folders.map(f => (
                      <div
                        key={`f-${f.uuid}`}
                        className="flex items-center px-2 py-1.5 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
                        onClick={() => {
                          setIsOpen(false);
                          setQuery("");
                          onSelectFolder(f.uuid);
                        }}
                      >
                        <Folder className="w-4 h-4 mr-2 text-blue-500" />
                        <span className="truncate">{f.name}</span>
                      </div>
                    ))}
                  </div>
                )}
                {results?.documents.length > 0 && (
                  <div className="px-2 py-1.5">
                    <div className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wider">Documents</div>
                    {results.documents.map(d => (
                      <div
                        key={`d-${d.uuid}`}
                        className="flex items-center px-2 py-1.5 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
                        onClick={() => {
                          setIsOpen(false);
                          setQuery("");
                          onSelectDocument(d.uuid);
                        }}
                      >
                        <FileText className="w-4 h-4 mr-2 text-muted-foreground" />
                        <span className="truncate">{d.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function MainArea({ activeFolderUuid, onSelectFolder, onSelectDocument }) {
  const { isAdminOrManager } = useAuth();
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [accessListOpen, setAccessListOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);

  const queryKey = ["folders", activeFolderUuid || "root", "children"];

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () =>
      activeFolderUuid
        ? foldersApi.getChildren(activeFolderUuid)
        : foldersApi.getRootChildren(),
    retry: false,
  });

  const { data: folderPath } = useQuery({
    queryKey: ["folders", activeFolderUuid, "path"],
    queryFn: () => foldersApi.getPath(activeFolderUuid),
    enabled: !!activeFolderUuid,
    retry: false,
  });

  const currentPerms = data?.current_folder_permissions || [];
  const canCreateFolder =
    isAdminOrManager || currentPerms.includes("folder:create");
  const canUploadDoc = isAdminOrManager;

  const isUnauthorized = error && error.response?.status === 403;
  const isNotFound = error && error.response?.status === 404;

  if (isUnauthorized) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-neutral-50 dark:bg-neutral-900 min-h-[500px]">
        <div className="max-w-md w-full text-center space-y-6 bg-white dark:bg-neutral-950 p-8 rounded-xl shadow-lg border border-neutral-200 dark:border-neutral-800">
          <div className="mx-auto h-16 w-16 bg-red-100 dark:bg-red-900/30 flex items-center justify-center rounded-full text-red-600 dark:text-red-400">
            <Lock className="h-8 w-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">Unauthorized Access</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              You do not have the required permissions to access this folder. If you believe this is an error, please contact your administrator.
            </p>
          </div>
          <div className="pt-4">
            <Button onClick={() => onSelectFolder?.(null)} className="w-full">
              Go back to Home
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (isNotFound) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-neutral-50 dark:bg-neutral-900 min-h-[500px]">
        <div className="max-w-md w-full text-center space-y-6 bg-white dark:bg-neutral-950 p-8 rounded-xl shadow-lg border border-neutral-200 dark:border-neutral-800">
          <div className="mx-auto h-16 w-16 bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center rounded-full text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-8 w-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">Folder Not Found</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              The requested folder could not be located or has been deleted.
            </p>
          </div>
          <div className="pt-4">
            <Button onClick={() => onSelectFolder?.(null)} className="w-full">
              Go back to Home
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white">
        <Loader2 className="w-8 h-8 animate-spin text-neutral-300" />
      </div>
    );
  }

  const items = [
    ...(data?.folders || []).map((f) => ({ ...f, type: "folder" })),
    ...(data?.documents || []).map((d) => ({ ...d, type: "document" })),
  ];

  const handleRename = (e, item) => {
    e.stopPropagation();
    setSelectedItem(item);
    setRenameOpen(true);
  };

  const handleDelete = (e, item) => {
    e.stopPropagation();
    setSelectedItem(item);
    setDeleteOpen(true);
  };

  const handleMove = (e, item) => {
    e.stopPropagation();
    setSelectedItem(item);
    setMoveOpen(true);
  };

  const handleAccessList = (e, item) => {
    e.stopPropagation();
    setSelectedItem(item);
    setAccessListOpen(true);
  };

  const handleMoveOpenChange = (open) => {
    setMoveOpen(open);
    if (!open) {
      setSelectedItem(null);
    }
  };

  return (
    <div className="flex flex-col bg-background overflow-hidden h-full w-full">
      {/* Header toolbar */}
      <div className="h-14 border-b border-border px-4 md:px-6 flex items-center justify-between">
        <div className="flex items-center space-x-2 text-sm text-muted-foreground overflow-hidden">
          <span
            className="cursor-pointer hover:text-foreground flex items-center shrink-0"
            onClick={() => onSelectFolder(null)}
          >
            <Home className="w-4 h-4 mr-1.5" />
            <span className="hidden sm:inline">Home</span>
          </span>
          {activeFolderUuid && folderPath ? (
            folderPath.map((f, index) => (
              <div
                key={f.uuid}
                className="flex items-center space-x-2 overflow-hidden shrink-0"
              >
                <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground/50" />
                <span
                  className={`cursor-pointer hover:text-foreground truncate max-w-[150px] ${index === folderPath.length - 1 ? "text-foreground font-medium" : ""}`}
                  onClick={() => onSelectFolder(f.uuid)}
                >
                  {f.name}
                </span>
              </div>
            ))
          ) : activeFolderUuid ? (
            <div className="flex items-center space-x-2 overflow-hidden shrink-0">
              <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground/50" />
              <div className="text-foreground font-medium truncate flex items-center">
                <Loader2 className="w-3 h-3 animate-spin mr-2" /> Loading...
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex items-center space-x-2 shrink-0 ml-4">
          <SearchBar onSelectFolder={onSelectFolder} onSelectDocument={onSelectDocument} />
          {canCreateFolder && (
            <Button
              variant="default"
              size="sm"
              className="h-8"
              onClick={() => setCreateFolderOpen(true)}
            >
              <Plus className="w-4 h-4 mr-2" /> New Folder
            </Button>
          )}
          {canUploadDoc && (
            <Button
              size="sm"
              className="h-8"
              onClick={() => setUploadOpen(true)}
            >
              <Upload className="w-4 h-4 mr-2" /> Upload Document
            </Button>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-auto p-4 md:p-6">
        {items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
            <Folder className="w-16 h-16 mb-4 text-muted" />
            <p>This folder is empty</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {items.map((item) => (
              <div
                key={`${item.type}-${item.uuid}`}
                className="group border border-border rounded-lg p-4 hover:border-primary/50 hover:shadow-sm transition-all bg-card text-card-foreground flex flex-col cursor-pointer"
                onClick={() =>
                  item.type === "folder"
                    ? onSelectFolder(item.uuid)
                    : onSelectDocument(item.uuid)
                }
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="p-1 rounded-md">
                    {item.type === "folder" ? (
                      <Folder className="w-8 h-8 text-primary" />
                    ) : (item.storage_path || item.name)
                      ?.toLowerCase()
                      .endsWith(".pdf") ? (
                      <PdfIcon className="w-10 h-10" />
                    ) : (
                      <DocxIcon className="w-10 h-10" />
                    )}
                  </div>
                  {isAdminOrManager && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity -mr-2 -mt-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={(e) => handleRename(e, item)}
                        >
                          <Edit2 className="w-4 h-4 mr-2" /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => handleMove(e, item)}>
                          <ArrowRightLeft className="w-4 h-4 mr-2" /> Move
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={(e) => handleAccessList(e, item)}
                        >
                          <Shield className="w-4 h-4 mr-2" /> Access List
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-red-600 focus:bg-red-50 focus:text-red-700"
                          onClick={(e) => handleDelete(e, item)}
                        >
                          <Trash2 className="w-4 h-4 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                <h3 className="font-medium text-neutral-900 truncate mb-1">
                  {item.name}
                </h3>
                <div className="flex items-center text-xs text-neutral-500 mt-auto">
                  {item.type === "folder" ? (
                    <span>{item.child_count} items</span>
                  ) : (
                    <div className="flex flex-col gap-1 w-full">
                      <div className="flex items-center">
                        <span>v{item.current_version_number}</span>
                      </div>
                      <span className="text-[10px] text-neutral-400">
                        Updated {formatDistanceToNow(new Date(item.updated_at))}{" "}
                        ago
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <CreateFolderDialog
        open={createFolderOpen}
        onOpenChange={setCreateFolderOpen}
        parentId={activeFolderUuid}
        folderPath={folderPath}
      />
      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        folderId={activeFolderUuid}
        folderPath={folderPath}
      />
      <RenameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        item={selectedItem}
      />
      <MoveDialog
        key={selectedItem ? `${selectedItem.type}-${selectedItem.uuid}` : "none"}
        open={moveOpen}
        onOpenChange={handleMoveOpenChange}
        item={selectedItem}
      />
      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        item={selectedItem}
      />
      <AccessListDialog
        open={accessListOpen}
        onOpenChange={setAccessListOpen}
        item={selectedItem}
      />
    </div>
  );
}
