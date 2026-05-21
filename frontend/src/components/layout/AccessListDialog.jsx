import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usersApi, foldersApi, documentsApi } from "@/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { Loader2, Shield, Check } from "lucide-react";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

const FOLDER_PRIVILEGES = [
  { key: "document:view", label: "View", group: "Document" },
  { key: "document:create", label: "Upload", group: "Document" },
  { key: "document:download", label: "Download", group: "Document" },
  {
    key: "version:create",
    label: "Upload/Restore Versions",
    group: "Document",
  },
  { key: "ai:diff_summary", label: "AI Diff Summary", group: "AI Tools" },
];

const DOCUMENT_PRIVILEGES = [
  { key: "document:view", label: "View Document", group: "Document" },
  { key: "document:download", label: "Download", group: "Document" },
  { key: "version:create", label: "Upload/Restore Versions", group: "Version" },
  { key: "ai:diff_summary", label: "AI Diff Summary", group: "AI Tools" },
];

const EMPTY_ARRAY = [];

export function AccessListDialog({ open, onOpenChange, item }) {
  const queryClient = useQueryClient();
  const resourceType = item?.type === "folder" ? "folder" : "document";
  const resourceId = item?.id;
  const privileges =
    resourceType === "folder" ? FOLDER_PRIVILEGES : DOCUMENT_PRIVILEGES;

  // Fetch employees only
  const { data: allUsers, isLoading: loadingUsers } = useQuery({
    queryKey: ["auth", "users"],
    queryFn: usersApi.getAll,
    enabled: open,
  });

  const employees = useMemo(
    () =>
      (allUsers || EMPTY_ARRAY)
        .filter((u) => u.role === "Employee")
        .sort((a, b) => a.employee_id.localeCompare(b.employee_id)),
    [allUsers],
  );

  // Fetch current permissions
  const { data: currentPerms, isLoading: loadingPerms } = useQuery({
    queryKey: [resourceType, resourceId, "permissions"],
    queryFn: () =>
      resourceType === "folder"
        ? foldersApi.getPermissions(resourceId)
        : documentsApi.getPermissions(resourceId),
    enabled: open && !!resourceId,
  });

  // Local state for editing
  const [permMap, setPermMap] = useState({});

  // Sync from server data when it arrives
  useEffect(() => {
    if (!loadingPerms && currentPerms) {
      const map = {};
      for (const perm of currentPerms) {
        map[perm.user_id] = new Set(perm.privileges || []);
      }
      setPermMap(map);
    }
  }, [currentPerms, loadingPerms]);

  const togglePrivilege = (userId, privilege) => {
    setPermMap((prev) => {
      const next = { ...prev };
      const current = new Set(next[userId] || []);
      if (current.has(privilege)) {
        current.delete(privilege);
        if (privilege === "document:view") {
          current.clear();
        }
      } else {
        current.add(privilege);
      }
      next[userId] = current;
      return next;
    });
  };

  const toggleAllForUser = (userId) => {
    setPermMap((prev) => {
      const next = { ...prev };
      const current = new Set(next[userId] || []);
      const allChecked = privileges.every((p) => current.has(p.key));
      if (allChecked) {
        next[userId] = new Set();
      } else {
        next[userId] = new Set(privileges.map((p) => p.key));
      }
      return next;
    });
  };

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: () => {
      const permissions = employees.map((emp) => ({
        user_id: emp.id,
        privileges: Array.from(permMap[emp.id] || []),
      }));
      return resourceType === "folder"
        ? foldersApi.setPermissions(resourceId, permissions)
        : documentsApi.setPermissions(resourceId, permissions);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [resourceType, resourceId, "permissions"],
      });
      toast({ title: "Permissions saved successfully" });
      onOpenChange(false);
    },
    onError: (err) =>
      toast({
        title: "Failed to save permissions",
        description: err.message,
        variant: "destructive",
      }),
  });

  const isLoading = loadingUsers || loadingPerms;

  // Group privileges by group
  const grouped = useMemo(() => {
    const groups = {};
    for (const p of privileges) {
      if (!groups[p.group]) groups[p.group] = [];
      groups[p.group].push(p);
    }
    return groups;
  }, [privileges]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            Access List - {item?.name}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground mt-1">
            Set per-employee privileges for this {resourceType}. Auto applies to
            all subfolders and documents if any.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center min-h-[200px]">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : employees.length === 0 ? (
          <div className="flex-1 flex items-center justify-center min-h-[200px] text-muted-foreground">
            No employees found. Create employees in User Management first.
          </div>
        ) : (
          <ScrollArea className="flex-1 max-h-[55vh]">
            <div className="w-full min-w-max">
              <table className="w-full text-sm border-separate border-spacing-0">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-muted/80 backdrop-blur-sm">
                    <th className="text-left px-3 py-2.5 font-medium text-muted-foreground border-b whitespace-nowrap sticky left-0 bg-muted/80 z-20">
                      Employee
                    </th>
                    <th className="px-2 py-2.5 font-medium text-muted-foreground border-b text-center whitespace-nowrap">
                      All
                    </th>
                    {Object.entries(grouped).map(([group, privs]) =>
                      privs.map((p) => (
                        <th
                          key={p.key}
                          className="px-2 py-2.5 font-medium text-muted-foreground border-b text-center"
                        >
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60">
                              {p.group}
                            </span>
                            <span className="text-[11px] whitespace-nowrap">
                              {p.label
                                .replace(p.group + " ", "")
                                .replace("View Folder", "View")
                                .replace("View Document", "View")}
                            </span>
                          </div>
                        </th>
                      )),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp, idx) => {
                    const userPrivs = permMap[emp.id] || new Set();
                    const allChecked = privileges.every((p) =>
                      userPrivs.has(p.key),
                    );
                    return (
                      <tr
                        key={emp.id}
                        className={`${
                          idx % 2 === 0 ? "bg-background" : "bg-muted/20"
                        }`}
                      >
                        <td className="px-3 py-2.5 font-medium border-b whitespace-nowrap sticky left-0 bg-inherit z-10">
                          <div className="flex flex-col">
                            <span>{emp.employee_id}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {emp.role}
                            </span>
                          </div>
                        </td>
                        <td className="px-2 py-2.5 border-b text-center">
                          <button
                            type="button"
                            onClick={() => toggleAllForUser(emp.id)}
                            className={`w-5 h-5 rounded border-2 flex items-center justify-center mx-auto transition-colors ${
                              allChecked
                                ? "bg-primary border-primary text-primary-foreground"
                                : "border-muted-foreground/30 hover:border-primary/50"
                            }`}
                          >
                            {allChecked && <Check className="w-3 h-3" />}
                          </button>
                        </td>
                        {Object.entries(grouped).map(([group, privs]) =>
                          privs.map((p) => {
                            const isDisabled = p.key !== "document:view" && !userPrivs.has("document:view");
                            return (
                              <td
                                key={p.key}
                                className="px-2 py-2.5 border-b text-center"
                              >
                                <button
                                  type="button"
                                  onClick={() => togglePrivilege(emp.id, p.key)}
                                  disabled={isDisabled}
                                  className={`w-5 h-5 rounded border-2 flex items-center justify-center mx-auto transition-colors ${
                                    isDisabled 
                                      ? "border-muted-foreground/20 bg-muted/50 cursor-not-allowed opacity-50" 
                                      : userPrivs.has(p.key)
                                        ? "bg-primary border-primary text-primary-foreground"
                                        : "border-muted-foreground/30 hover:border-primary/50"
                                  }`}
                                >
                                  {userPrivs.has(p.key) && (
                                    <Check className="w-3 h-3" />
                                  )}
                                </button>
                              </td>
                            );
                          }),
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        )}

        <DialogFooter className="mt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={isLoading || saveMutation.isPending}
          >
            {saveMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {saveMutation.isPending ? "Saving..." : "Save Permissions"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
