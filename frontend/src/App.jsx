import { Routes, Route, useParams, useNavigate } from "react-router-dom";
import { Sidebar } from "@/components/layout/Sidebar";
import { MainArea } from "@/components/layout/MainArea";
import { DocumentViewer } from "@/components/features/DocumentViewer";
import { Toaster } from "@/components/ui/toaster";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"

function FileManagerView() {
  const { folderId } = useParams();
  const activeFolderId = folderId ? parseInt(folderId, 10) : null;
  const navigate = useNavigate();

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full w-full">
      <ResizablePanel
        defaultSize={20}
        minSize={15}
        maxSize={30}
        collapsible={false}
        collapsedSize={0}>
        <Sidebar
          activeFolderId={activeFolderId}
          onSelectFolder={(id) => navigate(id ? `/folder/${id}` : "/")}
          onSelectDocument={(id) => navigate(`/document/${id}`)}
        />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={80}>
        <MainArea
          activeFolderId={activeFolderId}
          onSelectFolder={(id) => navigate(id ? `/folder/${id}` : "/")}
          onSelectDocument={(id) => navigate(`/document/${id}`)}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function DocumentViewerView() {
  const { documentId } = useParams();
  const navigate = useNavigate();

  return (
    <DocumentViewer
      documentId={parseInt(documentId, 10)}
      onClose={() => navigate(-1)}
    />
  );
}

function App() {
  return (
    <div className="flex h-screen w-full bg-background overflow-hidden font-sans text-foreground">
      <Routes>
        <Route path="/" element={<FileManagerView />} />
        <Route path="/folder/:folderId" element={<FileManagerView />} />
        <Route path="/document/:documentId" element={<DocumentViewerView />} />
      </Routes>
      <Toaster />
    </div>
  );
}

export default App;
