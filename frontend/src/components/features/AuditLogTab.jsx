import { useQuery, useQueryClient } from "@tanstack/react-query";
import { documentsApi } from "@/api";
import { format } from "date-fns";
import { Loader2, Download, History, User } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AuditLogTab({ documentId, documentName }) {
  const queryClient = useQueryClient();
  const { data: logs, isLoading } = useQuery({
    queryKey: ["documents", documentId, "audit"],
    queryFn: () => documentsApi.getAuditLog(documentId),
    refetchInterval: 2000, // Poll every 2 seconds for real-time updates
  });

  const handleExportCsv = async () => {
    if (!logs || logs.length === 0) return;

    try {
      await documentsApi.logAuditExport(documentId);
      queryClient.invalidateQueries({ queryKey: ["documents", documentId, "audit"] });
    } catch (e) {
      console.error("Failed to log audit export:", e);
    }

    const actionMap = {
      CREATE: "Create Document",
      VERSION_UPLOAD: "Upload Version",
      UPDATE: "Update Document",
      DOWNLOAD: "Download File",
      VERSION_RESTORE: "Restore Version",
      VERSION_UPDATE: "Update Version Info",
      AI_SUMMARIZE: "AI Summarize",
      AI_REGENERATE: "Regenerate AI Summary",
      EXPORT_AUDIT: "Export Audit Log",
    };

    const headers = ["Timestamp", "User ID", "User Role", "Action", "Details"];
    const csvContent = [
      headers.join(","),
      ...logs.map((log) => {
        const timestamp = format(new Date(log.created_at), "dd/MM/yyyy HH:mm:ss");
        const userId = log.user?.employee_id || "System";
        const userRole = log.user?.role || "System";
        const action = actionMap[log.action] || log.action;
        const detailsText = formatDetails(log.action, log.details) || "";
        const details = detailsText ? `"${detailsText.replace(/"/g, '""')}"` : "";
        return `${timestamp},${userId},${userRole},${action},${details}`;
      }),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `${documentName || "document"}_audit_log.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-neutral-300" />
      </div>
    );
  }

  if (!logs || logs.length === 0) {
    return (
      <div className="p-12 text-center text-neutral-500 h-full flex flex-col items-center justify-center">
        <History className="w-12 h-12 text-neutral-300 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-neutral-900 mb-2">
          No Activity Recorded
        </h3>
        <p className="text-sm text-neutral-500">
          Audit logs for this document will appear here.
        </p>
      </div>
    );
  }

  const formatDetails = (action, details) => {
    if (action === "EXPORT_AUDIT") {
      return "Exported audit log";
    }
    if (!details) return null;
    try {
      const parsed = JSON.parse(details);
      if (action === "VERSION_UPLOAD") {
        return `Version ${parsed.version}`;
      }
      if (action === "DOWNLOAD") {
        const verStr = parsed.version ? ` (Version ${parsed.version}${parsed.version_name ? ` - ${parsed.version_name}` : ""})` : "";
        return `Downloaded: ${parsed.filename}${verStr}`;
      }
      if (action === "UPDATE") {
        const changes = [];
        if (parsed.name) changes.push(`Renamed to '${parsed.name.new}'`);
        if (parsed.folder_id) changes.push(`Moved folder`);
        return changes.join(", ");
      }
      if (action === "CREATE") {
        return `Name: ${parsed.name}`;
      }
      if (action === "AI_SUMMARIZE") {
        return `Summarized Version ${parsed.version}`;
      }
      if (action === "AI_REGENERATE") {
        return `Regenerated AI Summary for Version ${parsed.version}`;
      }
      if (action === "VERSION_RESTORE") {
        return `Restored Version ${parsed.restored_from_version} (created Version ${parsed.new_version})`;
      }
      if (action === "VERSION_UPDATE") {
        const changes = [];
        if (parsed.changes?.name) changes.push(`renamed to '${parsed.changes.name.new}'`);
        if (parsed.changes?.comment) changes.push(`updated comment`);
        return `Version ${parsed.version} updated: ${changes.join(", ")}`;
      }
      return JSON.stringify(parsed);
    } catch {
      return details;
    }
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-md shadow-sm border border-neutral-200">
      <div className="flex items-center justify-between p-4 border-b border-neutral-100 bg-neutral-50/50">
        <h3 className="font-medium flex items-center text-neutral-700">
          <History className="w-4 h-4 mr-2 text-neutral-500" /> Document Audit Log
        </h3>
        <Button onClick={handleExportCsv} variant="outline" size="sm" className="bg-white">
          <Download className="w-4 h-4 mr-2" /> Export to CSV
        </Button>
      </div>
      <div className="flex-1 overflow-auto p-0">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-neutral-500 bg-neutral-50 uppercase sticky top-0 border-b">
            <tr>
              <th className="px-6 py-3 font-semibold">Timestamp</th>
              <th className="px-6 py-3 font-semibold">User</th>
              <th className="px-6 py-3 font-semibold">Action</th>
              <th className="px-6 py-3 font-semibold">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {logs.map((log) => (
              <tr key={log.id} className="hover:bg-neutral-50/50 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap text-neutral-500">
                  {format(new Date(log.created_at), "dd/MM/yyyy h:mm a")}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="bg-blue-100 text-blue-700 p-1.5 rounded-full mr-2">
                      <User className="w-3 h-3" />
                    </div>
                    <div>
                      <div className="font-medium text-neutral-900">
                        {log.user?.employee_id || "System"}
                      </div>
                      <div className="text-[10px] text-neutral-500 uppercase tracking-wider">
                        {log.user?.role || "Automated"}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold tracking-wide ${
                    log.action === "EXPORT_AUDIT"
                      ? "bg-purple-50 text-purple-700 border border-purple-100"
                      : log.action === "DOWNLOAD"
                      ? "bg-green-50 text-green-700 border border-green-100"
                      : log.action === "CREATE"
                      ? "bg-blue-50 text-blue-700 border border-blue-100"
                      : log.action === "AI_SUMMARIZE" || log.action === "AI_REGENERATE"
                      ? "bg-indigo-50 text-indigo-700 border border-indigo-100"
                      : log.action.startsWith("VERSION_")
                      ? "bg-amber-50 text-amber-700 border border-amber-100"
                      : "bg-neutral-50 text-neutral-700 border border-neutral-200"
                  }`}>
                    {(() => {
                      const actionMap = {
                        CREATE: "Create Document",
                        VERSION_UPLOAD: "Upload Version",
                        UPDATE: "Update Document",
                        DOWNLOAD: "Download File",
                        VERSION_RESTORE: "Restore Version",
                        VERSION_UPDATE: "Update Version Info",
                        AI_SUMMARIZE: "AI Summarize",
                        AI_REGENERATE: "Regenerate AI Summary",
                        EXPORT_AUDIT: "Export Audit Log",
                      };
                      return actionMap[log.action] || log.action;
                    })()}
                  </span>
                </td>
                <td className="px-6 py-4 text-neutral-600">
                  {formatDetails(log.action, log.details)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
