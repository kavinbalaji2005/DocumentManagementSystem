import { useState, useEffect, useRef } from "react";
import * as docx from "docx-preview";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { documentsApi, versionsApi, aiApi } from "@/api";
import { format } from "date-fns";
import {
  FileText,
  CheckCircle2,
  Download,
  ArrowLeft,
  History,
  XCircle,
  Loader2,
  Wand2,
  RefreshCw,
  Edit2,
  Save,
  RotateCcw,
  Copy,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { UploadDialog } from "@/components/layout/Dialogs";

function DocxRenderer({ url }) {
  const containerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);

    if (containerRef.current) {
      containerRef.current.innerHTML = "";
    }

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch document");
        return res.blob();
      })
      .then((blob) => {
        if (!isMounted) return;
        return docx.renderAsync(blob, containerRef.current, null, {
          className: "docx-preview-renderer",
          inWrapper: false,
          ignoreWidth: false,
          ignoreHeight: false,
        });
      })
      .then(() => {
        if (isMounted) setLoading(false);
      })
      .catch((err) => {
        if (isMounted) {
          console.error(err);
          setError("Failed to render document preview.");
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [url]);

  return (
    <div className="relative w-full flex flex-col">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/50 backdrop-blur-sm z-10 min-h-[400px]">
          <Loader2 className="w-8 h-8 animate-spin text-neutral-300" />
        </div>
      )}
      {error && (
        <div className="flex items-center justify-center text-red-500 p-8 min-h-[400px]">
          {error}
        </div>
      )}
      <div ref={containerRef} className="w-full flex flex-col" />
    </div>
  );
}

export function DocumentViewer({ documentId, onClose }) {
  const queryClient = useQueryClient();
  const [activeVersionId, setActiveVersionId] = useState(null);
  const [viewMode, setViewMode] = useState("normal"); // 'normal' | 'diff'
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editingVersionId, setEditingVersionId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editComment, setEditComment] = useState("");

  // Fetch document metadata
  const { data: document, isLoading: docLoading } = useQuery({
    queryKey: ["documents", documentId],
    queryFn: () => documentsApi.get(documentId),
  });

  // Fetch versions
  const { data: versions, isLoading: versionsLoading } = useQuery({
    queryKey: ["documents", documentId, "versions"],
    queryFn: () => documentsApi.getVersions(documentId),
  });

  // Set initial active version when versions load, and auto-select new versions
  const prevVersionCountRef = useRef(versions?.length || 0);
  useEffect(() => {
    if (versions && versions.length > 0) {
      if (!activeVersionId) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setActiveVersionId(versions[0].id);
      } else if (versions.length > prevVersionCountRef.current) {
        // A new version was added (via upload/restore), auto-select the newest one
        const newestVersion = [...versions].sort((a, b) => b.version_number - a.version_number)[0];
        if (newestVersion) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setActiveVersionId(newestVersion.id);
        }
      }
    }
    prevVersionCountRef.current = versions?.length || 0;
  }, [versions, activeVersionId]);

  const activeVersion =
    versions?.find((v) => v.id === activeVersionId) || versions?.[0];
  const previousVersion = versions?.find(
    (v) => v.version_number === (activeVersion?.version_number ?? 0) - 1,
  );
  const compareFromVersionId = previousVersion?.id ?? null;

  // Fetch diff content
  const { data: diffContent, isLoading: diffLoading, isError: diffError, error: diffQueryError } = useQuery({
    queryKey: ["versions", compareFromVersionId, activeVersion?.id, "diff"],
    queryFn: () => versionsApi.diff(compareFromVersionId, activeVersion?.id),
    enabled:
      !!activeVersion?.id &&
      !!compareFromVersionId &&
      viewMode === "diff" &&
      activeVersion.version_number > 1,
  });

  // Check if we need to poll for extraction completion
  useEffect(() => {
    if (
      activeVersion?.status === "pending" ||
      activeVersion?.status === "processing"
    ) {
      const interval = setInterval(() => {
        queryClient.invalidateQueries({
          queryKey: ["documents", documentId, "versions"],
        });
        queryClient.invalidateQueries({ queryKey: ["documents", documentId] });
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [activeVersion?.status, documentId, queryClient]);

  // Handle Restore
  const restoreMutation = useMutation({
    mutationFn: (id) => versionsApi.restore(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents", documentId] });
      queryClient.invalidateQueries({
        queryKey: ["documents", documentId, "versions"],
      });
      toast({
        title: "Version restored",
        description:
          "A new version has been created from the restored content.",
      });
    },
    onError: (err) =>
      toast({
        title: "Restore failed",
        description: err.message,
        variant: "destructive",
      }),
  });

  // AI Summarization
  const summarizeMutation = useMutation({
    mutationFn: (id) => aiApi.summarizeDiff(id),
    onSuccess: () => {
      // Invalidate the diff query to refetch the latest summary from backend
      queryClient.invalidateQueries({
        queryKey: ["versions", compareFromVersionId, activeVersion?.id, "diff"],
      });

      // Also invalidate versions to update the version card
      queryClient.invalidateQueries({
        queryKey: ["documents", documentId, "versions"],
      });

      toast({ title: "Summary generated" });
    },
    onError: (err) =>
      toast({
        title: "Summarization failed",
        description: err.message,
        variant: "destructive",
      }),
  });

  // Update Version (Name/Comment)
  const updateVersionMutation = useMutation({
    mutationFn: ({ id, name, comment }) =>
      versionsApi.update(id, { name, comment }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["documents", documentId, "versions"],
      });
      setEditingVersionId(null);
      toast({ title: "Version updated" });
    },
    onError: (err) =>
      toast({
        title: "Update failed",
        description: err.message,
        variant: "destructive",
      }),
  });

  const startEditing = (version) => {
    setEditingVersionId(version.id);
    setEditName(version.name || `Version ${version.version_number}`);
    setEditComment(version.comment || "");
  };

  const handleTransferToComment = (summary) => {
    if (!activeVersion) return;
    setEditingVersionId(activeVersion.id);
    setEditName(
      activeVersion.name || `Version ${activeVersion.version_number}`,
    );
    setEditComment(summary);
    toast({ title: "Summary copied to comment box" });
  };

  if (docLoading || versionsLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-neutral-300" />
      </div>
    );
  }

  const hasDiff = activeVersion?.version_number > 1;

  const handleDownload = () => {
    if (!activeVersion) return;
    window.location.href = `http://localhost:5000/files/${activeVersion.storage_path}`;
  };

  return (
    <div className="flex-1 flex flex-col bg-neutral-100 overflow-hidden">
      {/* Header */}
      <div className="h-14 border-b border-neutral-200 bg-white px-6 flex items-center justify-between shrink-0">
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="-ml-2 mr-2"
          >
            <ArrowLeft className="w-4 h-4 " />
          </Button>
          <div className="flex items-center">
            <FileText className="w-5 h-5 text-neutral-500 mr-2" />
            <h1 className="font-semibold text-lg">{document?.name}</h1>
          </div>
        </div>

        <div className="flex space-x-2">
          <Button
            variant="default"
            size="sm"
            onClick={handleDownload}
            disabled={!activeVersion || activeVersion.status !== "success"}
          >
            <Download className="w-4 h-4 mr-2" /> Download Version
          </Button>
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <RefreshCw className="w-4 h-4 mr-2" /> Update Version
          </Button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Main Content Area */}
        <div className="flex-1 overflow-auto bg-neutral-100 p-8">
          <div className="max-w-4xl mx-auto w-full flex justify-between items-center mb-4">
            <Tabs
              value={viewMode}
              onValueChange={setViewMode}
              className="w-[300px]"
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="normal">Normal View</TabsTrigger>
                <TabsTrigger value="diff" disabled={!hasDiff}>
                  Diff View
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="flex items-center text-sm text-neutral-500 bg-white px-3 py-1.5 rounded-full shadow-sm border border-neutral-200">
              <span className="font-medium mr-2">
                Version {activeVersion?.version_number}
              </span>
              {activeVersion?.status === "success" && (
                <CheckCircle2 className="w-4 h-4 text-green-500" />
              )}
              {(activeVersion?.status === "pending" ||
                activeVersion?.status === "processing") && (
                <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />
              )}
              {activeVersion?.status === "failed" && (
                <XCircle className="w-4 h-4 text-red-500" />
              )}
            </div>
          </div>

          <div className="max-w-4xl mx-auto w-full bg-white shadow-sm border border-neutral-200 rounded-md min-h-[800px] flex flex-col relative">
            {diffLoading && viewMode === "diff" ? (
              <div className="absolute inset-0 flex items-center justify-center bg-white/50 backdrop-blur-sm z-10">
                <Loader2 className="w-8 h-8 animate-spin text-neutral-300" />
              </div>
            ) : null}

            {activeVersion?.status === "failed" && (
              <div className="p-12 text-center text-neutral-500">
                <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-neutral-900 mb-2">
                  Extraction Failed
                </h3>
                <p className="text-sm bg-neutral-50 p-4 rounded text-left overflow-auto whitespace-pre-wrap font-mono">
                  {activeVersion.error_message}
                </p>
              </div>
            )}

            {activeVersion?.status === "pending" ||
            activeVersion?.status === "processing" ? (
              <div className="p-12 text-center text-neutral-500 h-full flex flex-col items-center justify-center">
                <Loader2 className="w-12 h-12 text-blue-400 mx-auto mb-4 animate-spin" />
                <h3 className="text-lg font-medium text-neutral-900 mb-2">
                  Processing Document
                </h3>
                <p className="text-sm text-neutral-500">
                  Extracting content and computing diffs...
                </p>
              </div>
            ) : null}

            {activeVersion?.status === "success" && viewMode === "normal" && (
              <div className="w-full flex-1">
                <DocxRenderer
                  url={`http://localhost:5001/files/${activeVersion.storage_path}`}
                />
              </div>
            )}

            {activeVersion?.status === "success" &&
              viewMode === "diff" &&
              hasDiff && (
                <div className="flex flex-col">
                  {/* AI Summary Banner */}
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-100 p-4">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center text-blue-800 font-medium mb-2">
                        <Wand2 className="w-4 h-4 mr-2" /> AI Summary of Changes
                      </div>
                      {(() => {
                        const hasChanges =
                          diffContent?.stats &&
                          ((diffContent.stats.added_chars || 0) > 0 ||
                            (diffContent.stats.removed_chars || 0) > 0 ||
                            (diffContent.stats.modified_blocks || 0) > 0 ||
                            (diffContent.stats.added_blocks || 0) > 0 ||
                            (diffContent.stats.removed_blocks || 0) > 0);

                        return (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="bg-white/80 hover:bg-white"
                            onClick={() =>
                              summarizeMutation.mutate(activeVersion.id)
                            }
                            disabled={
                              summarizeMutation.isPending || !hasChanges
                            }
                            title={
                              !hasChanges
                                ? "No changes detected to summarize"
                                : ""
                            }
                          >
                            {summarizeMutation.isPending ? (
                              <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                            ) : diffContent?.ai_summary ? (
                              <RefreshCw className="w-3 h-3 mr-2" />
                            ) : null}
                            {diffContent?.ai_summary
                              ? "Regenerate"
                              : "Generate Summary"}
                          </Button>
                        );
                      })()}
                    </div>
                    {diffContent?.ai_summary ? (
                      <>
                        <div className="text-sm text-blue-900 leading-relaxed markdown-summary mb-3">
                          <ReactMarkdown>
                            {diffContent.ai_summary}
                          </ReactMarkdown>
                        </div>
                        <Button
                          size="xs"
                          variant="ghost"
                          className="h-7 text-xs text-blue-700 hover:bg-blue-100/50 hover:text-blue-800"
                          onClick={() =>
                            handleTransferToComment(diffContent.ai_summary)
                          }
                        >
                          <Copy className="w-3 h-3 mr-2" /> Use as Comment
                        </Button>
                      </>
                    ) : (
                      <p className="text-sm text-blue-600/70 italic">
                        Click generate to get an AI summary of what changed in
                        this version.
                      </p>
                    )}
                  </div>

                  {(() => {
                    const hasChanges =
                      diffContent?.stats &&
                      ((diffContent.stats.added_chars || 0) > 0 ||
                        (diffContent.stats.removed_chars || 0) > 0 ||
                        (diffContent.stats.modified_blocks || 0) > 0 ||
                        (diffContent.stats.added_blocks || 0) > 0 ||
                        (diffContent.stats.removed_blocks || 0) > 0);

                    if (!diffLoading && diffContent && !hasChanges) {
                      return (
                        <div className="p-12 text-center text-neutral-500 h-full flex flex-col items-center justify-center">
                          <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-4" />
                          <h3 className="text-lg font-medium text-neutral-900 mb-2">
                            No Changes Detected
                          </h3>
                        </div>
                      );
                    }

                    if (!diffLoading && diffError) {
                      return (
                        <div className="p-12 text-center text-neutral-500 h-full flex flex-col items-center justify-center">
                          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
                          <h3 className="text-lg font-medium text-red-900 mb-2">
                            Comparison Failed
                          </h3>
                          <p className="text-sm text-red-500">
                            {diffQueryError?.response?.data?.error || diffQueryError?.message || "An error occurred while computing the differences."}
                          </p>
                        </div>
                      );
                    }

                    if (!diffLoading && !diffContent) {
                      return (
                        <div className="p-12 text-center text-neutral-500 h-full flex flex-col items-center justify-center">
                          <Loader2 className="w-12 h-12 text-blue-400 mx-auto mb-4 animate-spin" />
                          <h3 className="text-lg font-medium text-neutral-900 mb-2">
                            Processing Diff
                          </h3>
                          <p className="text-sm text-neutral-500">
                            The comparison is being calculated. This may take a
                            moment.
                          </p>
                        </div>
                      );
                    }

                    return (
                      <div
                        className="document-viewer diff-mode font-serif text-[14px] leading-[1.8] text-[#1a1a1a]"
                        dangerouslySetInnerHTML={{
                          __html: diffContent?.diff_html || "",
                        }}
                      />
                    );
                  })()}
                </div>
              )}
          </div>

          {/* Bottom spacing */}
          <div className="h-12 shrink-0"></div>
        </div>

        {/* Sidebar: Version History */}
        <div className="w-80 border-l border-neutral-200 bg-white flex flex-col shrink-0">
          <div className="p-4 border-b border-neutral-200 flex items-center justify-between">
            <h2 className="font-semibold flex items-center">
              <History className="w-4 h-4 mr-2 text-neutral-500" />
              Version History
            </h2>
            <span className="text-xs bg-neutral-100 text-neutral-600 px-2 py-0.5 rounded-full font-medium">
              {versions?.length} versions
            </span>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-3 space-y-2">
              {versions?.map((v) => (
                <div
                  key={v.id}
                  onClick={() => setActiveVersionId(v.id)}
                  className={`p-3 rounded-lg border cursor-pointer transition-all ${
                    activeVersionId === v.id
                      ? "border-blue-500 bg-blue-50/50 shadow-sm"
                      : "border-neutral-200 hover:border-neutral-300 bg-white"
                  }`}
                >
                  {editingVersionId === v.id ? (
                    <div
                      className="space-y-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-neutral-400">
                          Name
                        </label>
                        <input
                          autoFocus
                          className="w-full text-sm font-medium border-b border-blue-300 focus:outline-none bg-transparent py-0.5"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-neutral-400">
                          Comment
                        </label>
                        <textarea
                          className="w-full text-xs border rounded p-1.5 min-h-[60px] focus:outline-none focus:ring-1 focus:ring-blue-400"
                          value={editComment}
                          onChange={(e) => setEditComment(e.target.value)}
                          placeholder="Add notes about this version..."
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="h-7 px-3 text-xs"
                          onClick={() =>
                            updateVersionMutation.mutate({
                              id: v.id,
                              name: editName,
                              comment: editComment,
                            })
                          }
                          disabled={updateVersionMutation.isPending}
                        >
                          {updateVersionMutation.isPending ? (
                            <Loader2 className="w-3 h-3 animate-spin mr-2" />
                          ) : (
                            <Save className="w-3 h-3 mr-2" />
                          )}
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-3 text-xs"
                          onClick={() => setEditingVersionId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between items-start mb-1">
                        <div className="font-medium text-sm flex items-center group">
                          {v.name || `Version ${v.version_number}`}
                          {v.version_number ===
                            document?.current_version_number && (
                            <span className="ml-2 text-[10px] uppercase tracking-wider font-bold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded">
                              Current
                            </span>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 ml-1"
                            onClick={(e) => {
                              e.stopPropagation();
                              startEditing(v);
                            }}
                          >
                            <Edit2 className="w-3 h-3 text-neutral-400" />
                          </Button>
                        </div>
                        <div className="text-[10px] text-neutral-400 flex items-center">
                          {format(new Date(v.created_at), "MMM d, h:mm a")}
                        </div>
                      </div>

                      {v.comment && (
                        <div className="text-xs text-neutral-600 bg-neutral-50 p-2 rounded border border-neutral-100 mb-2 italic">
                          {v.comment}
                        </div>
                      )}

                      <div className="flex justify-between items-center mt-3">
                        <div className="text-[10px] text-neutral-400 font-mono">
                          v{v.version_number} •{" "}
                          {(v.file_size / 1024).toFixed(1)} KB
                        </div>
                        <div className="flex gap-1">
                          {/* Restore: only for non-current versions */}
                          {v.version_number !==
                            document?.current_version_number &&
                            v.status === "success" && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 text-neutral-500"
                                title="Restore"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (confirm("Restore this version?")) {
                                    restoreMutation.mutate(v.id);
                                  }
                                }}
                                disabled={restoreMutation.isPending}
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </Button>
                            )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      </div>

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        documentId={documentId}
        documentName={document?.name}
      />
    </div>
  );
}
