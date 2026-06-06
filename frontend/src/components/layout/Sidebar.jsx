import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { foldersApi } from "@/api";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  Loader2,
  Home,
  LogOut,
  Users,
  KeyRound,
  Settings,
  Mail
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DocxIcon } from "@/components/ui/DocxIcon";
import { PdfIcon } from "@/components/ui/PdfIcon";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { useNavigate, useLocation } from "react-router-dom";
import { ChangePasswordDialog } from "./ChangePasswordDialog";
import { ChangeEmailDialog } from "./ChangeEmailDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function FolderNode({
  folder,
  level,
  activeFolderUuid,
  onSelectFolder,
  onSelectDocument,
}) {
  const [expanded, setExpanded] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["folders", folder.uuid, "children"],
    queryFn: () => foldersApi.getChildren(folder.uuid),
    enabled: expanded,
  });

  const handleToggle = (e) => {
    e.stopPropagation();
    setExpanded(!expanded);
  };

  const handleClick = () => {
    onSelectFolder(folder.uuid);
  };

  const isActive = activeFolderUuid === folder.uuid;

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
              key={child.uuid}
              folder={child}
              level={level + 1}
              activeFolderUuid={activeFolderUuid}
              onSelectFolder={onSelectFolder}
              onSelectDocument={onSelectDocument}
            />
          ))}
          {data?.documents.map((doc) => (
            <div
              key={doc.uuid}
              className="flex items-center py-1.5 pl-6 pr-2 rounded-md cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800 text-sm text-neutral-600 dark:text-neutral-400"
              onClick={() => onSelectDocument(doc.uuid)}
            >
              {doc.storage_path?.toLowerCase().endsWith('.pdf') || doc.name?.toLowerCase().endsWith('.pdf') ? (
                <PdfIcon className="w-4 h-4 mr-2 shrink-0" />
              ) : (
                <DocxIcon className="w-4 h-4 mr-2 shrink-0" />
              )}
              <span className="truncate">{doc.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ activeFolderUuid, onSelectFolder, onSelectDocument }) {
  const { data, isLoading } = useQuery({
    queryKey: ["folders", "root", "children"],
    queryFn: foldersApi.getRootChildren,
  });

  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const isUsersPage = location.pathname === "/users";
  const [isHomeExpanded, setIsHomeExpanded] = useState(true);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isChangeEmailOpen, setIsChangeEmailOpen] = useState(false);

  return (
    <div className="border-r border-border bg-muted/30 flex flex-col h-full w-full">
      <div className="h-14 px-4 border-b border-border flex items-center justify-between shrink-0">
        <h2 className="font-semibold text-lg tracking-tight">DMS v2.0</h2>
      </div>

      <ScrollArea className="flex-1 p-2">
        <div className="select-none">
          <div
            className={cn(
              "flex items-center py-1.5 px-2 rounded-md cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800 text-sm mb-1",
              activeFolderUuid === null && !isUsersPage &&
              "bg-neutral-100 dark:bg-neutral-800 font-medium text-neutral-900",
            )}
            onClick={() => {
              onSelectFolder?.(null);
              navigate("/");
            }}
          >
            <button
              className="w-4 h-4 mr-1 flex items-center justify-center text-neutral-500 hover:text-neutral-900"
              onClick={(e) => {
                e.stopPropagation();
                setIsHomeExpanded(!isHomeExpanded);
              }}
            >
              {isHomeExpanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
            <Home className="w-4 h-4 mr-2 text-neutral-600" />
            <span>Home</span>
          </div>

          {isHomeExpanded && (
            <div className="ml-[15px] border-l border-neutral-200 dark:border-neutral-800">
              {isLoading ? (
                <div className="pl-6 py-1 text-xs text-neutral-400 flex items-center">
                  <Loader2 className="w-3 h-3 mr-2 animate-spin" /> Loading...
                </div>
              ) : (
                <>
                  {data?.folders.map((folder) => (
                    <FolderNode
                      key={folder.uuid}
                      folder={folder}
                      level={1}
                      activeFolderUuid={activeFolderUuid}
                      onSelectFolder={onSelectFolder}
                      onSelectDocument={onSelectDocument}
                    />
                  ))}
                  {data?.documents.map((doc) => (
                    <div
                      key={doc.uuid}
                      className="flex items-center py-1.5 pl-6 pr-2 rounded-md cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800 text-sm text-neutral-600 dark:text-neutral-400"
                      onClick={() => onSelectDocument(doc.uuid)}
                    >
                      {doc.storage_path?.toLowerCase().endsWith('.pdf') || doc.name?.toLowerCase().endsWith('.pdf') ? (
                        <PdfIcon className="w-4 h-4 mr-2 shrink-0" />
                      ) : (
                        <DocxIcon className="w-4 h-4 mr-2 shrink-0" />
                      )}
                      <span className="truncate">{doc.name}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

      </ScrollArea>

      {isAdmin && (
        <div className="p-2 border-t border-border bg-background shrink-0">
          <div
            className={cn(
              "flex items-center py-1.5 px-2 rounded-md cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800 text-sm",
              isUsersPage &&
              "bg-neutral-100 dark:bg-neutral-800 font-medium text-neutral-900",
            )}
            onClick={() => navigate("/users")}
          >
            <Users className="w-4 h-4 mr-2" />
            <span>User Management</span>
          </div>
        </div>
      )}

      {/* User Profile Section */}
      {user && (
        <div className="p-4 border-t border-border bg-background flex flex-col gap-2 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex flex-col overflow-hidden">
              <span className="text-sm font-medium truncate">{user.employee_id}</span>
              <span className="text-xs text-muted-foreground">{user.role}</span>
            </div>
            <div className="flex items-center gap-1">
              {!user.is_default_admin && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Modify Account Settings"
                      className="shrink-0 h-8 w-8 text-muted-foreground hover:text-foreground"
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onClick={() => setIsChangePasswordOpen(true)} className="cursor-pointer">
                      <KeyRound className="h-4 w-4 mr-2" />
                      <span>Change Password</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setIsChangeEmailOpen(true)} className="cursor-pointer">
                      <Mail className="h-4 w-4 mr-2" />
                      <span>Change Email</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              <Button
                variant="destructive"
                title="Logout"
                onClick={logout}
                className="shrink-0 h-8 px-2"
              >
                Logout
                <LogOut className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </div>
        </div>
      )}
      <ChangePasswordDialog
        open={isChangePasswordOpen}
        onOpenChange={setIsChangePasswordOpen}
      />
      <ChangeEmailDialog
        open={isChangeEmailOpen}
        onOpenChange={setIsChangeEmailOpen}
      />
    </div>
  );
}
