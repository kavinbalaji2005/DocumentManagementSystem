import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { foldersApi } from "@/api";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDistanceToNow } from "date-fns";
import {
  CreateFolderDialog,
  UploadDialog,
  RenameDialog,
  MoveDialog,
  DeleteDialog,
} from "./Dialogs";

export function MainArea({ activeFolderId, onSelectFolder, onSelectDocument }) {
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);

  const queryKey = ["folders", activeFolderId || "root", "children"];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      activeFolderId
        ? foldersApi.getChildren(activeFolderId)
        : foldersApi.getRootChildren(),
  });

  const { data: folderPath } = useQuery({
    queryKey: ["folders", activeFolderId, "path"],
    queryFn: () => foldersApi.getPath(activeFolderId),
    enabled: !!activeFolderId,
  });

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
          {activeFolderId && folderPath ? (
            folderPath.map((f, index) => (
              <div
                key={f.id}
                className="flex items-center space-x-2 overflow-hidden shrink-0"
              >
                <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground/50" />
                <span
                  className={`cursor-pointer hover:text-foreground truncate max-w-[150px] ${index === folderPath.length - 1 ? "text-foreground font-medium" : ""}`}
                  onClick={() => onSelectFolder(f.id)}
                >
                  {f.name}
                </span>
              </div>
            ))
          ) : activeFolderId ? (
            <div className="flex items-center space-x-2 overflow-hidden shrink-0">
              <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground/50" />
              <div className="text-foreground font-medium truncate flex items-center">
                <Loader2 className="w-3 h-3 animate-spin mr-2" /> Loading...
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex space-x-2 shrink-0 ml-4">
          <Button
            variant="default"
            size="sm"
            className="h-8"
            onClick={() => setCreateFolderOpen(true)}
          >
            <Plus className="w-4 h-4 mr-2" /> New Folder
          </Button>
          <Button size="sm" className="h-8" onClick={() => setUploadOpen(true)}>
            <Upload className="w-4 h-4 mr-2" /> Upload Document
          </Button>
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
                key={`${item.type}-${item.id}`}
                className="group border border-border rounded-lg p-4 hover:border-primary/50 hover:shadow-sm transition-all bg-card text-card-foreground flex flex-col cursor-pointer"
                onClick={() =>
                  item.type === "folder"
                    ? onSelectFolder(item.id)
                    : onSelectDocument(item.id)
                }
              >
                <div className="flex justify-between items-start mb-3">
                  <div
                    className={`p-2 rounded-md ${item.type === "folder" ? "bg-primary/10 text-primary" : "bg-orange-500/10 text-orange-500"}`}
                  >
                    {item.type === "folder" ? (
                      <Folder className="w-6 h-6" />
                    ) : (
                      <FileText className="w-6 h-6" />
                    )}
                  </div>
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
                      <DropdownMenuItem onClick={(e) => handleRename(e, item)}>
                        <Edit2 className="w-4 h-4 mr-2" /> Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={(e) => handleMove(e, item)}>
                        <ArrowRightLeft className="w-4 h-4 mr-2" /> Move
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-red-600 focus:bg-red-50 focus:text-red-700"
                        onClick={(e) => handleDelete(e, item)}
                      >
                        <Trash2 className="w-4 h-4 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <h3 className="font-medium text-neutral-900 truncate mb-1">
                  {item.name}
                </h3>
                <div className="flex items-center text-xs text-neutral-500 mt-auto">
                  {item.type === "folder" ? (
                    <span>{item.child_count} items</span>
                  ) : (
                    <div className="flex flex-col gap-1 w-full">
                      <div className="flex items-center justify-between">
                        <span>v{item.current_version_number}</span>
                        <span
                          className={`capitalize ${item.extraction_status === "failed" ? "text-red-500" : item.extraction_status === "pending" ? "text-amber-500" : "text-green-500"}`}
                        >
                          {item.extraction_status}
                        </span>
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
        parentId={activeFolderId}
      />
      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        folderId={activeFolderId}
      />
      <RenameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        item={selectedItem}
      />
      <MoveDialog
        key={selectedItem ? `${selectedItem.type}-${selectedItem.id}` : "none"}
        open={moveOpen}
        onOpenChange={handleMoveOpenChange}
        item={selectedItem}
      />
      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        item={selectedItem}
      />
    </div>
  );
}
