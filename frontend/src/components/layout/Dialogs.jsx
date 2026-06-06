import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { foldersApi, documentsApi } from "@/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, Folder, Loader2, Home } from "lucide-react";

async function fetchAllFolders() {
  const queue = [null];
  const visitedParents = new Set();
  const discoveredFolderUuids = new Set();
  const folders = [];

  while (queue.length > 0) {
    const parentId = queue.shift();
    const parentKey = parentId === null ? "root" : String(parentId);
    if (visitedParents.has(parentKey)) continue;
    visitedParents.add(parentKey);

    const data =
      parentId === null
        ? await foldersApi.getRootChildren()
        : await foldersApi.getChildren(parentId);

    for (const folder of data?.folders || []) {
      if (discoveredFolderUuids.has(folder.uuid)) continue;
      discoveredFolderUuids.add(folder.uuid);
      folders.push(folder);
      queue.push(folder.uuid);
    }
  }

  return folders;
}

function flattenFoldersForPicker(folders) {
  const byParent = new Map();

  for (const folder of folders) {
    const parentKey = folder.parent_uuid ?? "root";
    if (!byParent.has(parentKey)) {
      byParent.set(parentKey, []);
    }
    byParent.get(parentKey).push(folder);
  }

  for (const entries of byParent.values()) {
    entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  const ordered = [];
  const walk = (parentKey, depth) => {
    const children = byParent.get(parentKey) || [];
    for (const child of children) {
      ordered.push({ ...child, depth });
      walk(child.uuid, depth + 1);
    }
  };

  walk("root", 0);
  return ordered;
}

function getDescendantFolderIds(folderId, folders) {
  const childrenByParent = new Map();

  for (const folder of folders) {
    const parentKey = folder.parent_uuid ?? "root";
    if (!childrenByParent.has(parentKey)) {
      childrenByParent.set(parentKey, []);
    }
    childrenByParent.get(parentKey).push(folder);
  }

  const descendants = new Set();
  const stack = [folderId];

  while (stack.length > 0) {
    const currentId = stack.pop();
    const children = childrenByParent.get(currentId) || [];
    for (const child of children) {
      if (descendants.has(child.uuid)) continue;
      descendants.add(child.uuid);
      stack.push(child.uuid);
    }
  }

  return descendants;
}

export function CreateFolderDialog({
  open,
  onOpenChange,
  parentId,
  folderPath,
}) {
  const { register, handleSubmit, reset } = useForm();
  const queryClient = useQueryClient();
  const breadcrumbText = folderPath
    ? ["Home", ...folderPath.map((f) => f.name)].join("/")
    : "Home";
  const mutation = useMutation({
    mutationFn: (data) => foldersApi.create(data.name, parentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["folders"] });
      toast({ title: "Folder created successfully" });
      onOpenChange(false);
      reset();
    },
    onError: (err) => {
      toast({
        title: "Error creating folder",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data) => {
    mutation.mutate(data);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        onOpenChange(val);
        if (!val) reset();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Folder</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-neutral-500 bg-neutral-50 p-2">
          <strong>Current Location: </strong>
          {breadcrumbText}
        </p>
        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="grid gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                {...register("name", { required: true })}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {mutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function UploadDialog({
  open,
  onOpenChange,
  folderId,
  documentId = null,
  documentName = null,
  folderPath,
  nextVersionNumber,
  allowedExtension = null,
}) {
  const [file, setFile] = useState(null);
  const [changeNote, setChangeNote] = useState("");
  const queryClient = useQueryClient();
  const breadcrumbText = folderPath
    ? ["Home", ...folderPath.map((f) => f.name)].join("/")
    : "Home";
  const isVersionUpload = Boolean(documentId);
  const normalizedAllowedExtension = allowedExtension
    ? allowedExtension.toLowerCase()
    : null;
  const acceptValue =
    normalizedAllowedExtension === ".pdf"
      ? ".pdf,application/pdf"
      : normalizedAllowedExtension === ".docx"
        ? ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : ".docx,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf";
  const helperText = isVersionUpload
    ? normalizedAllowedExtension === ".pdf"
      ? ".pdf file (Max 50MB)"
      : normalizedAllowedExtension === ".docx"
        ? ".docx file (Max 50MB)"
        : ".docx and .pdf files (Max 50MB)"
    : ".docx and .pdf files (Max 50MB)";
  const trimmedChangeNote = changeNote.trim();
  const mutation = useMutation({
    mutationFn: () =>
      documentsApi.upload(
        file,
        folderId,
        documentId,
        isVersionUpload ? trimmedChangeNote : undefined,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["folders"] });
      if (documentId) {
        queryClient.invalidateQueries({ queryKey: ["documents", documentId] });
        queryClient.invalidateQueries({
          queryKey: ["documents", documentId, "versions"],
        });
        queryClient.invalidateQueries({
          queryKey: ["documents", documentId, "audit"],
        });
      }
      toast({
        title: documentId
          ? "New version uploaded"
          : "Document uploaded successfully",
      });
      onOpenChange(false);
      setFile(null);
      setChangeNote("");
    },
    onError: (err) => {
      toast({
        title: "Upload failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        onOpenChange(val);
        if (!val) {
          setFile(null);
          setChangeNote("");
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {documentId
              ? `Upload Version ${nextVersionNumber || ""} for ${documentName}`
              : "Upload Document"}
          </DialogTitle>
        </DialogHeader>
        {!documentId && (
          <p className="text-sm text-neutral-500 bg-neutral-50 p-2">
            <strong>Current Location: </strong>
            {breadcrumbText}
          </p>
        )}
        <div className="grid gap-4 py-4">
          <div className="flex flex-col items-center justify-center w-full">
            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-neutral-300 border-dashed rounded-lg cursor-pointer bg-neutral-50 hover:bg-neutral-100">
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <svg
                  className="w-8 h-8 mb-4 text-neutral-500"
                  aria-hidden="true"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 20 16"
                >
                  <path
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M13 13h3a3 3 0 0 0 0-6h-.025A5.56 5.56 0 0 0 16 6.5 5.5 5.5 0 0 0 5.207 5.021C5.137 5.017 5.071 5 5 5a4 4 0 0 0 0 8h2.167M10 15V6m0 0L8 8m2-2 2 2"
                  />
                </svg>
                <p className="mb-2 text-sm text-neutral-500">
                  <span className="font-semibold">Click to upload</span>
                </p>
                <p className="text-xs text-neutral-500">{helperText}</p>
              </div>
              <input
                type="file"
                className="hidden"
                accept={acceptValue}
                onChange={(e) => {
                  const selected = e.target.files[0];
                  if (!selected) {
                    setFile(null);
                    return;
                  }

                  if (
                    normalizedAllowedExtension &&
                    !selected.name
                      .toLowerCase()
                      .endsWith(normalizedAllowedExtension)
                  ) {
                    toast({
                      title: "Invalid file type",
                      description: `Please upload a ${normalizedAllowedExtension} file.`,
                      variant: "destructive",
                    });
                    setFile(null);
                    return;
                  }

                  setFile(selected);
                }}
              />
            </label>
            {file && (
              <p className="mt-2 text-sm text-neutral-700">
                Selected: {file.name}
              </p>
            )}
          </div>
          {isVersionUpload && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="change-note" className="flex items-center gap-1">
                Change Note
                <span className="text-red-500">*</span>
              </Label>
              <textarea
                id="change-note"
                className="w-full text-sm border rounded-md p-2 min-h-[90px] focus:outline-none focus:ring-1 focus:ring-blue-400"
                placeholder="Describe what changed in this version"
                value={changeNote}
                onChange={(e) => setChangeNote(e.target.value)}
                required
              />
              <p className="text-[11px] text-neutral-400">
                This note will appear in version history.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={
              !file ||
              mutation.isPending ||
              (isVersionUpload && trimmedChangeNote.length === 0)
            }
          >
            {mutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {mutation.isPending ? "Uploading..." : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RenameDialog({ open, onOpenChange, item }) {
  const { register, handleSubmit, reset } = useForm();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (data) => {
      if (item.type === "folder") {
        return foldersApi.update(item.uuid, data.name, item.parent_uuid);
      } else {
        return documentsApi.update(item.uuid, data.name, item.folder_uuid);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["folders"] });
      if (item?.type === "document") {
        queryClient.invalidateQueries({ queryKey: ["documents", item.uuid] });
        queryClient.invalidateQueries({
          queryKey: ["documents", item.uuid, "audit"],
        });
      }
      toast({ title: "Renamed successfully" });
      onOpenChange(false);
    },
    onError: (err) => {
      toast({
        title: "This File Name already exists !",
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        onOpenChange(val);
        if (val) reset({ name: item?.name });
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename {item?.type}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit((data) => mutation.mutate(data))}>
          <div className="grid gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                {...register("name", { required: true })}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {mutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MoveDialog({ open, onOpenChange, item }) {
  const queryClient = useQueryClient();
  const [targetFolderId, setTargetFolderId] = useState(
    item
      ? ((item.type === "folder" ? item.parent_uuid : item.folder_uuid) ?? null)
      : null,
  );

  const { data: allFolders = [], isLoading: loadingFolders } = useQuery({
    queryKey: ["folders", "all-for-move"],
    queryFn: fetchAllFolders,
    enabled: open,
  });

  const orderedFolders = useMemo(
    () => flattenFoldersForPicker(allFolders),
    [allFolders],
  );

  const blockedFolderIds = useMemo(() => {
    if (!item || item.type !== "folder") return new Set();
    const descendants = getDescendantFolderIds(item.uuid, allFolders);
    descendants.add(item.uuid);
    return descendants;
  }, [allFolders, item]);

  const destinationFolders = useMemo(
    () => orderedFolders.filter((folder) => !blockedFolderIds.has(folder.uuid)),
    [orderedFolders, blockedFolderIds],
  );

  const currentFolderId = item
    ? ((item.type === "folder" ? item.parent_uuid : item.folder_uuid) ?? null)
    : null;
  const destinationChanged = targetFolderId !== currentFolderId;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!item) return null;
      if (item.type === "folder") {
        return foldersApi.update(item.uuid, item.name, targetFolderId);
      }
      return documentsApi.update(item.uuid, item.name, targetFolderId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["folders"] });
      if (item?.type === "document") {
        queryClient.invalidateQueries({ queryKey: ["documents", item.uuid] });
        queryClient.invalidateQueries({
          queryKey: ["documents", item.uuid, "audit"],
        });
      }
      toast({ title: "Moved successfully" });
      onOpenChange(false);
    },
    onError: (err) => {
      toast({
        title: "Move failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move {item?.type}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-sm text-neutral-600">
            Choose destination for{" "}
            <span className="font-medium text-neutral-900">{item?.name}</span>.
          </p>

          {loadingFolders ? (
            <div className="h-56 border rounded-md flex items-center justify-center text-neutral-500">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading
              folders...
            </div>
          ) : (
            <ScrollArea className="h-56 border rounded-md">
              <div className="p-2 space-y-1">
                <button
                  type="button"
                  onClick={() => setTargetFolderId(null)}
                  className={`w-full flex items-center justify-between rounded px-2 py-1.5 text-sm text-left ${targetFolderId === null
                      ? "bg-blue-50 text-blue-700"
                      : "hover:bg-neutral-100"
                    }`}
                >
                  <span className="flex items-center">
                    <Home className="w-4 h-4 mr-2" />
                    Home
                  </span>
                  {targetFolderId === null && <Check className="w-4 h-4" />}
                </button>

                {destinationFolders.map((folder) => (
                  <button
                    key={folder.uuid}
                    type="button"
                    onClick={() => setTargetFolderId(folder.uuid)}
                    className={`w-full flex items-center justify-between rounded px-2 py-1.5 text-sm text-left ${targetFolderId === folder.uuid
                        ? "bg-blue-50 text-blue-700"
                        : "hover:bg-neutral-100"
                      }`}
                    style={{ paddingLeft: `${(folder.depth + 1) * 14}px` }}
                  >
                    <span className="flex items-center">
                      <Folder className="w-4 h-4 mr-2" />
                      {folder.name}
                    </span>
                    {targetFolderId === folder.uuid && (
                      <Check className="w-4 h-4" />
                    )}
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={
              loadingFolders || mutation.isPending || !destinationChanged
            }
          >
            {mutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {mutation.isPending ? "Moving..." : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteDialog({ open, onOpenChange, item }) {
  const queryClient = useQueryClient();
  const shouldLoadPreview =
    open && item?.type === "folder" && Boolean(item?.uuid);

  const {
    data: deletePreview,
    isLoading: loadingPreview,
    isError: previewError,
  } = useQuery({
    queryKey: ["folders", item?.uuid, "delete-preview"],
    queryFn: () => foldersApi.getDeletePreview(item.uuid),
    enabled: shouldLoadPreview,
  });

  const mutation = useMutation({
    mutationFn: () => {
      if (item.type === "folder") {
        return foldersApi.delete(item.uuid);
      } else {
        return documentsApi.delete(item.uuid);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["folders"] });
      toast({ title: "Deleted successfully" });
      onOpenChange(false);
    },
    onError: (err) => {
      toast({
        title: "Error deleting",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
          <AlertDialogDescription>
            {item?.type === "folder" ? (
              <>
                This action cannot be undone.{" "}
                {loadingPreview
                  ? "Calculating the number of documents that will be deleted..."
                  : previewError
                    ? "Unable to calculate delete impact right now."
                    : `This will permanently delete this folder, ${deletePreview?.subfolder_count ?? 0} subfolders, and ${deletePreview?.document_count ?? 0} documents.`}
              </>
            ) : (
              "This action cannot be undone. This will permanently delete this document and all its versions."
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
            disabled={mutation.isPending || loadingPreview || previewError}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {mutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {mutation.isPending ? "Deleting..." : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
