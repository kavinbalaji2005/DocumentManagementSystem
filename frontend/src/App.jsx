import { Routes, Route, useParams, useNavigate } from "react-router-dom";
import { Sidebar } from "@/components/layout/Sidebar";
import { MainArea } from "@/components/layout/MainArea";
import { DocumentViewer } from "@/components/features/DocumentViewer";
import { Toaster } from "@/components/ui/toaster";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"

import { AuthProvider } from "@/context/AuthContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { LoginPage } from "@/pages/LoginPage";
import { UserManagementPage } from "@/pages/UserManagementPage";

function FileManagerView() {
  const { folderUuid } = useParams();
  const activeFolderUuid = folderUuid || null;
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
          activeFolderUuid={activeFolderUuid}
          onSelectFolder={(uuid) => navigate(uuid ? `/folder/${uuid}` : "/")}
          onSelectDocument={(uuid) => navigate(`/document/${uuid}`)}
        />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={80}>
        <MainArea
          activeFolderUuid={activeFolderUuid}
          onSelectFolder={(uuid) => navigate(uuid ? `/folder/${uuid}` : "/")}
          onSelectDocument={(uuid) => navigate(`/document/${uuid}`)}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function UserManagementView() {
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
          activeFolderUuid={null}
          onSelectFolder={(uuid) => navigate(uuid ? `/folder/${uuid}` : "/")}
          onSelectDocument={(uuid) => navigate(`/document/${uuid}`)}
        />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={80} className="flex flex-col">
        <UserManagementPage />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function DocumentViewerView() {
  const { documentUuid } = useParams();
  const navigate = useNavigate();

  const handleClose = () => {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      navigate("/", { replace: true });
    }
  };

  return (
    <DocumentViewer
      documentUuid={documentUuid}
      onClose={handleClose}
    />
  );
}

function App() {
  return (
    <AuthProvider>
      <div className="flex h-screen w-full bg-background overflow-hidden font-sans text-foreground">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          
          <Route path="/" element={<ProtectedRoute><FileManagerView /></ProtectedRoute>} />
          <Route path="/folder/:folderUuid" element={<ProtectedRoute><FileManagerView /></ProtectedRoute>} />
          <Route path="/document/:documentUuid" element={<ProtectedRoute><DocumentViewerView /></ProtectedRoute>} />
          
          <Route path="/users" element={<ProtectedRoute adminOnly={true}><UserManagementView /></ProtectedRoute>} />
        </Routes>
        <Toaster />
      </div>
    </AuthProvider>
  );
}

export default App;
