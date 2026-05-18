import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { foldersApi } from "@/api";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FileText,
  Loader2,
  Home,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DocxIcon } from "@/components/ui/DocxIcon";

function FolderNode({
  folder,
  level,
  activeFolderId,
  onSelectFolder,
  onSelectDocument,
}) {
  const [expanded, setExpanded] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["folders", folder.id, "children"],
    queryFn: () => foldersApi.getChildren(folder.id),
    enabled: expanded,
  });

  const handleToggle = (e) => {
    e.stopPropagation();
    setExpanded(!expanded);
  };

  const handleClick = () => {
    onSelectFolder(folder.id);
  };

  const isActive = activeFolderId === folder.id;

  return (
    <div className="select-none">
      <div
        className={cn(
          "flex items-center py-1.5 px-2 rounded-md cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800 text-sm",
          isActive &&
            "bg-neutral-100 dark:bg-neutral-800 font-medium text-neutral-900",
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={handleClick}
      >
        <button
          className="w-4 h-4 mr-1 flex items-center justify-center text-neutral-500 hover:text-neutral-900"
          onClick={handleToggle}
        >
          {folder.child_count > 0 ? (
            expanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )
          ) : (
            <span className="w-3.5 h-3.5" />
          )}
        </button>
        <Folder className="w-4 h-4 mr-2 text-blue-500" />
        <span className="truncate">{folder.name}</span>
      </div>

      {expanded && (
        <div className="ml-[15px] border-l border-neutral-200 dark:border-neutral-800">
          {isLoading && (
            <div className="pl-6 py-1 text-xs text-neutral-400 flex items-center">
              <Loader2 className="w-3 h-3 mr-2 animate-spin" /> Loading...
            </div>
          )}
          {data?.folders.map((child) => (
            <FolderNode
              key={child.id}
              folder={child}
              level={level + 1}
              activeFolderId={activeFolderId}
              onSelectFolder={onSelectFolder}
              onSelectDocument={onSelectDocument}
            />
          ))}
          {data?.documents.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center py-1.5 pl-6 pr-2 rounded-md cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800 text-sm text-neutral-600 dark:text-neutral-400"
              onClick={() => onSelectDocument(doc.id)}
            >
              <DocxIcon className="w-4 h-4 mr-2 shrink-0" />
              <span className="truncate">{doc.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ activeFolderId, onSelectFolder, onSelectDocument }) {
  const { data, isLoading } = useQuery({
    queryKey: ["folders", "root", "children"],
    queryFn: foldersApi.getRootChildren,
  });

  return (
    <div className="border-r border-border bg-muted/30 flex flex-col h-full w-full">
      <div className="h-14 px-4 border-b border-border flex items-center justify-between shrink-0">
        <h2 className="font-semibold text-lg tracking-tight">DMS</h2>
      </div>

      <ScrollArea className="flex-1 p-2">
        <div
          className={cn(
            "flex items-center py-1.5 px-2 rounded-md cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800 text-sm mb-1",
            activeFolderId === null &&
              "bg-neutral-100 dark:bg-neutral-800 font-medium text-neutral-900",
          )}
          onClick={() => onSelectFolder(null)}
        >
          <span className="w-4 h-4 mr-1" />
          <Home className="w-4 h-4 mr-2 text-neutral-600" />
          <span>Home</span>
        </div>

        {isLoading ? (
          <div className="p-4 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-neutral-400" />
          </div>
        ) : (
          <>
            {data?.folders.map((folder) => (
              <FolderNode
                key={folder.id}
                folder={folder}
                level={0}
                activeFolderId={activeFolderId}
                onSelectFolder={onSelectFolder}
                onSelectDocument={onSelectDocument}
              />
            ))}
            {data?.documents.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center py-1.5 px-2 rounded-md cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800 text-sm text-neutral-600 dark:text-neutral-400 ml-5"
                onClick={() => onSelectDocument(doc.id)}
              >
                <DocxIcon className="w-4 h-4 mr-2 shrink-0" />
                <span className="truncate">{doc.name}</span>
              </div>
            ))}
          </>
        )}
      </ScrollArea>
    </div>
  );
}
