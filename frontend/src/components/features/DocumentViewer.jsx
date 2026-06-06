import { useState, useEffect, useRef, useCallback } from "react";
import * as docx from "docx-preview";
import * as pdfjsLib from "pdfjs-dist";
import HtmlDiff from "htmldiff-js";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).toString();
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  documentsApi,
  versionsApi,
  aiApi,
  filesApi,
  FILE_BASE_URL,
} from "@/api";
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
  ChevronUp,
  ChevronDown,
  Lock,
  AlertTriangle,
} from "lucide-react";
import { DocxIcon } from "@/components/ui/DocxIcon";
import { PdfIcon } from "@/components/ui/PdfIcon";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { toast } from "@/hooks/use-toast";
import { UploadDialog } from "@/components/layout/Dialogs";
import { AuditLogTab } from "./AuditLogTab";
import { useAuth } from "@/context/AuthContext";

function isPdf(path) {
  return path?.toLowerCase().endsWith(".pdf");
}

function PdfRenderer({ url, onPagesReady }) {
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

    filesApi
      .getBlob(url)
      .then(async (blob) => {
        if (!isMounted) return;

        const arrayBuffer = await blob.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        if (!isMounted) return;

        const container = containerRef.current;
        if (!container) return;

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          if (!isMounted) return;

          // Use 2x scale for crisp rendering on retina displays
          const scale = 2;
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement("canvas");
          canvas.dataset.pageNumber = String(i);
          canvas.className = "pdf-page-canvas";
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          canvas.style.display = "block";

          // Add a subtle separator between pages
          if (i > 1) {
            const separator = document.createElement("div");
            separator.style.height = "2px";
            separator.style.background = "#e5e7eb";
            separator.style.margin = "0";
            container.appendChild(separator);
          }

          container.appendChild(canvas);

          const ctx = canvas.getContext("2d");
          await page.render({ canvasContext: ctx, viewport }).promise;
        }

        if (isMounted) {
          setLoading(false);
          if (onPagesReady && container) {
            const pages = Array.from(
              container.querySelectorAll(".pdf-page-canvas"),
            );
            requestAnimationFrame(() => onPagesReady(pages));
          }
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error(err);
          setError("Failed to render PDF preview.");
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

function TextDiffRenderer({
  oldVersionId,
  newVersionId,
  onLoaded,
  onPagesReady,
}) {
  const containerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);

    function splitPages(html) {
      if (!html) return [];
      const parts = html.split(/(?=<h2>Page \d+<\/h2>)/i);
      return parts.filter((p) => p.trim() !== "");
    }

    function sanitizeHtmlForDiff(html) {
      if (!html) return "";
      let normalized = html.replace(/&nbsp;/gi, " ");
      normalized = normalized.replace(/\u00a0/g, " ");
      normalized = normalized.replace(/[\r\n\t]+/g, " ");
      normalized = normalized.replace(/\s+/g, " ");
      normalized = normalized.replace(/>\s+</g, "><");
      return normalized.trim();
    }

    function postProcessDiff(diffHtml) {
      if (!diffHtml) return "";
      let cleaned = diffHtml.replace(/<ins>(?:\s|&nbsp;|\u00a0)*<\/ins>/gi, "");
      cleaned = cleaned.replace(/<del>(?:\s|&nbsp;|\u00a0)*<\/del>/gi, "");
      cleaned = cleaned.replace(
        /<ins><span[^>]*>(?:\s|&nbsp;|\u00a0)*<\/span><\/ins>/gi,
        "",
      );
      cleaned = cleaned.replace(
        /<del><span[^>]*>(?:\s|&nbsp;|\u00a0)*<\/span><\/del>/gi,
        "",
      );
      return cleaned;
    }

    Promise.all([
      versionsApi.view(oldVersionId),
      versionsApi.view(newVersionId),
    ])
      .then(([oldData, newData]) => {
        if (!isMounted) return;

        const oldHtml = oldData.extracted_html || "";
        const newHtml = newData.extracted_html || "";

        const oldPages = splitPages(oldHtml);
        const newPages = splitPages(newHtml);

        const maxPages = Math.max(oldPages.length, newPages.length);
        const computedPages = [];

        const executeDiff =
          HtmlDiff.default && typeof HtmlDiff.default.execute === "function"
            ? HtmlDiff.default.execute
            : HtmlDiff.execute;

        for (let i = 0; i < maxPages; i++) {
          const oldPageContent = oldPages[i] || "";
          const newPageContent = newPages[i] || "";

          const cleanOld = oldPageContent.replace(/<h2>Page \d+<\/h2>/i, "");
          const cleanNew = newPageContent.replace(/<h2>Page \d+<\/h2>/i, "");

          const sanitizedOld = sanitizeHtmlForDiff(cleanOld);
          const sanitizedNew = sanitizeHtmlForDiff(cleanNew);

          const diffHtml = executeDiff(sanitizedOld, sanitizedNew);
          const cleanDiffHtml = postProcessDiff(diffHtml);

          computedPages.push({
            pageNumber: i + 1,
            diffHtml: cleanDiffHtml,
          });
        }

        const fullHtml = computedPages
          .map(
            (page) => `
          <div class="w-full px-16 py-8 overflow-hidden" data-page-number="${page.pageNumber}">
            <div class="document-viewer !bg-transparent !p-0 !m-0 !border-0 !shadow-none !max-w-none !text-inherit dark:!text-neutral-300" style="font-size: 15px; line-height: 1.85;">
              ${page.diffHtml}
            </div>
            ${
              computedPages.length > 1
                ? `
              <div class="flex justify-center items-center text-xs text-neutral-400 border-t border-neutral-100 dark:border-neutral-800 pt-8 mt-12 font-sans uppercase tracking-wider select-none">
                <span>Page ${page.pageNumber} of ${computedPages.length}</span>
              </div>
            `
                : ""
            }
          </div>
        `,
          )
          .join("");

        if (containerRef.current && isMounted) {
          containerRef.current.innerHTML = fullHtml;
          setLoading(false);
          if (onPagesReady) {
            const pages = Array.from(
              containerRef.current.querySelectorAll("[data-page-number]"),
            );
            requestAnimationFrame(() => onPagesReady(pages));
          }
          if (onLoaded) {
            setTimeout(onLoaded, 100);
          }
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error(err);
          setError("Failed to compute text diff.");
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [oldVersionId, newVersionId]);

  return (
    <div className="relative w-full flex flex-col pt-0 pb-6 min-h-[500px] diff-mode-renderer">
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/50 backdrop-blur-sm z-10 min-h-[400px]">
          <Loader2 className="w-8 h-8 animate-spin text-neutral-300 mb-4" />
          <span className="text-neutral-500 font-medium">
            Computing Text Diff...
          </span>
        </div>
      )}
      {error && (
        <div className="flex items-center justify-center text-red-500 p-8 min-h-[400px]">
          {error}
        </div>
      )}
      <div
        ref={containerRef}
        className="w-full flex flex-col text-diff-container"
      />
    </div>
  );
}

function OcrRenderer({ versionId, onPagesReady }) {
  const containerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pages, setPages] = useState([]);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);
    setPages([]);

    function splitPages(html) {
      if (!html) return [];
      const parts = html.split(/(?=<h2>Page \d+<\/h2>)/i);
      return parts.filter((p) => p.trim() !== "");
    }

    versionsApi
      .view(versionId)
      .then((data) => {
        if (!isMounted) return;
        const html = data.extracted_html || "";
        const splitResult = splitPages(html);

        const computedPages = splitResult.map((pageHtml, idx) => {
          const cleanHtml = pageHtml.replace(/<h2>Page \d+<\/h2>/i, "");
          return { pageNumber: idx + 1, html: cleanHtml };
        });

        setPages(computedPages);
        setLoading(false);
      })
      .catch((err) => {
        if (isMounted) {
          console.error(err);
          setError("Failed to load OCR output.");
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [versionId]);

  useEffect(() => {
    if (!onPagesReady || loading || error || pages.length === 0) return;
    const container = containerRef.current;
    if (!container) return;

    const raf = requestAnimationFrame(() => {
      const pageEls = Array.from(
        container.querySelectorAll("[data-page-number]"),
      );
      onPagesReady(pageEls);
    });

    return () => cancelAnimationFrame(raf);
  }, [pages, loading, error, onPagesReady]);

  return (
    <div
      ref={containerRef}
      className="ocr-renderer relative w-full flex flex-col pt-0 pb-6 min-h-[500px]"
    >
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/50 backdrop-blur-sm z-10 min-h-[400px]">
          <Loader2 className="w-8 h-8 animate-spin text-neutral-300 mb-4" />
          <span className="text-neutral-500 font-medium">
            Loading OCR Output...
          </span>
        </div>
      )}
      {error && (
        <div className="flex items-center justify-center text-red-500 p-8 min-h-[400px]">
          {error}
        </div>
      )}
      {!loading &&
        !error &&
        pages.map((page) => (
          <div
            key={page.pageNumber}
            data-page-number={page.pageNumber}
            className="w-full px-16 py-8 overflow-hidden"
          >
            <div
              className="document-viewer !bg-transparent !p-0 !m-0 !border-0 !shadow-none !max-w-none !text-inherit dark:!text-neutral-300"
              style={{ fontSize: "15px", lineHeight: "1.85" }}
              dangerouslySetInnerHTML={{ __html: page.html }}
            />
            {pages.length > 1 && (
              <div className="flex justify-center items-center text-xs text-neutral-400 border-t border-neutral-100 dark:border-neutral-800 pt-8 mt-12 font-sans uppercase tracking-wider select-none">
                <span>
                  Page {page.pageNumber} of {pages.length}
                </span>
              </div>
            )}
          </div>
        ))}
    </div>
  );
}

function DocxRenderer({ url, onPagesReady }) {
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

    filesApi
      .getBlob(url)
      .then((blob) => {
        if (!isMounted) return;
        return docx.renderAsync(blob, containerRef.current, null, {
          className: "docx-viewer",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          ignoreLastRenderedPageBreak: false,
        });
      })
      .then(() => {
        if (isMounted) {
          if (containerRef.current) {
            // Fix bullet characters
            containerRef.current.innerHTML =
              containerRef.current.innerHTML.replace(
                /[\uf0b7\uf0a7\uf0d8\uf0fc]/g,
                "•",
              );

            // Inject visual page break dividers between page sections
            const wrapper =
              containerRef.current.querySelector(".docx-viewer-wrapper") ||
              containerRef.current.querySelector(".docx-wrapper") ||
              containerRef.current;

            let pages = wrapper.querySelectorAll(
              ".docx-viewer-page, .docx-page, .docx-page-wrapper, .docx-page-section",
            );

            if (pages.length === 0) {
              pages = wrapper.querySelectorAll("section");
            }

            for (let i = 1; i < pages.length; i++) {
              const divider = document.createElement("div");
              pages[i].parentNode.insertBefore(divider, pages[i]);
            }

            const pageList = pages.length ? Array.from(pages) : [wrapper];

            pageList.forEach((page, index) => {
              if (page && page.dataset) {
                page.dataset.pageNumber = String(index + 1);
              }
            });

            if (onPagesReady) {
              requestAnimationFrame(() => onPagesReady(pageList));
            }
          }
          setLoading(false);
        }
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

function DocxDiffRenderer({ oldUrl, newUrl, onLoaded, onPagesReady }) {
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

    Promise.all([filesApi.getBlob(oldUrl), filesApi.getBlob(newUrl)])
      .then(async ([oldBlob, newBlob]) => {
        if (!isMounted) return;

        // Render both docs WITHOUT page breaks for clean diffing
        const oldDiv = document.createElement("div");
        const newDiv = document.createElement("div");

        await Promise.all([
          docx.renderAsync(oldBlob, oldDiv, null, {
            className: "docx-preview-renderer",
            inWrapper: false,
            ignoreWidth: false,
            ignoreHeight: false,
            breakPages: false,
          }),
          docx.renderAsync(newBlob, newDiv, null, {
            className: "docx-preview-renderer",
            inWrapper: false,
            ignoreWidth: false,
            ignoreHeight: false,
            breakPages: false,
          }),
        ]);

        if (!isMounted) return;

        const oldHtml = oldDiv.innerHTML.replace(
          /[\uf0b7\uf0a7\uf0d8\uf0fc]/g,
          "•",
        );
        const newHtml = newDiv.innerHTML.replace(
          /[\uf0b7\uf0a7\uf0d8\uf0fc]/g,
          "•",
        );

        const executeDiff =
          HtmlDiff.default && typeof HtmlDiff.default.execute === "function"
            ? HtmlDiff.default.execute
            : HtmlDiff.execute;

        const diffHtml = executeDiff(oldHtml, newHtml);

        // Now render the NEW doc WITH page breaks to find page boundary positions
        const newPagesDiv = document.createElement("div");
        await docx.renderAsync(newBlob, newPagesDiv, null, {
          className: "docx-viewer",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          ignoreLastRenderedPageBreak: false,
        });

        const pages = newPagesDiv.querySelectorAll(
          ".docx-viewer-page, .docx-page, .docx-page-wrapper, section",
        );
        const pageBreakTexts = [];
        for (let i = 1; i < pages.length; i++) {
          // Get the first meaningful text node on each page (after page 1)
          const firstEl = pages[i].querySelector(
            "p, h1, h2, h3, h4, h5, h6, table, li",
          );
          if (firstEl) {
            const text = firstEl.textContent.trim().substring(0, 60);
            if (text) pageBreakTexts.push(text);
          }
        }

        if (containerRef.current && isMounted) {
          containerRef.current.innerHTML = diffHtml;
          const pageAnchors = [];

          const firstAnchor = document.createElement("div");
          firstAnchor.dataset.pageNumber = "1";
          firstAnchor.className = "docx-diff-page-anchor";
          containerRef.current.prepend(firstAnchor);
          pageAnchors.push(firstAnchor);

          // Inject page break dividers by finding matching text positions
          if (pageBreakTexts.length > 0) {
            const allElements = containerRef.current.querySelectorAll(
              "p, h1, h2, h3, h4, h5, h6, table, li",
            );
            let breakIdx = 0;
            for (const el of allElements) {
              if (breakIdx >= pageBreakTexts.length) break;
              const elText = el.textContent.trim().substring(0, 60);
              if (elText && elText === pageBreakTexts[breakIdx]) {
                const divider = document.createElement("div");
                el.parentNode.insertBefore(divider, el);

                const anchor = document.createElement("div");
                anchor.dataset.pageNumber = String(breakIdx + 2);
                anchor.className = "docx-diff-page-anchor";
                el.parentNode.insertBefore(anchor, el);
                pageAnchors.push(anchor);
                breakIdx++;
              }
            }
          }

          if (onPagesReady) {
            requestAnimationFrame(() =>
              onPagesReady(
                pageAnchors.length ? pageAnchors : [containerRef.current],
              ),
            );
          }
        }

        if (isMounted) {
          setLoading(false);
          if (onLoaded) {
            setTimeout(onLoaded, 100);
          }
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error(err);
          setError("Failed to compute visual diff.");
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [oldUrl, newUrl]);

  return (
    <div className="relative w-full flex flex-col diff-mode-renderer">
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/50 backdrop-blur-sm z-10 min-h-[400px]">
          <Loader2 className="w-8 h-8 animate-spin text-neutral-300 mb-4" />
          <span className="text-neutral-500 font-medium">
            Computing High-Fidelity Diff...
          </span>
        </div>
      )}
      {error && (
        <div className="flex items-center justify-center text-red-500 p-8 min-h-[400px]">
          {error}
        </div>
      )}
      <div
        ref={containerRef}
        className="w-full flex flex-col docx-diff-container"
      />
    </div>
  );
}

export function DocumentViewer({ documentUuid, onClose }) {
  const queryClient = useQueryClient();
  const { isAdmin, isAdminOrManager } = useAuth();
  const [activeVersionId, setActiveVersionId] = useState(null);
  const [viewMode, setViewMode] = useState("normal"); // 'normal' | 'diff'
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editingVersionId, setEditingVersionId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editComment, setEditComment] = useState("");
  const [restoreTargetVersion, setRestoreTargetVersion] = useState(null);

  const [totalDiffs, setTotalDiffs] = useState(0);
  const [currentDiffIndex, setCurrentDiffIndex] = useState(-1);
  const diffContainerRef = useRef(null);
  const diffElementsRef = useRef([]);

  const mainAreaRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const pageIndicatorRef = useRef(null);
  const pageElementsRef = useRef([]);
  const pageOffsetsRef = useRef([]);
  const scrollRafRef = useRef(null);
  const scrollHideTimeoutRef = useRef(null);
  const isScrollableRef = useRef(false);
  const [pageIndicator, setPageIndicator] = useState({ current: 0, total: 0 });
  const [indicatorTop, setIndicatorTop] = useState(0);
  const [isScrolling, setIsScrolling] = useState(false);
  const [isScrollable, setIsScrollable] = useState(false);

  const handleDiffLoaded = useCallback(() => {
    if (!diffContainerRef.current) return;
    const elements = Array.from(
      diffContainerRef.current.querySelectorAll("ins, del"),
    );
    const visibleElements = elements.filter((el) => {
      const rect = el.getBoundingClientRect();
      return (
        rect.width > 0 || rect.height > 0 || el.textContent.trim().length > 0
      );
    });

    diffElementsRef.current = visibleElements;
    setTotalDiffs(visibleElements.length);
    setCurrentDiffIndex(visibleElements.length > 0 ? 0 : -1);
  }, []);

  const handleNextDiff = useCallback(() => {
    if (diffElementsRef.current.length === 0) return;
    setCurrentDiffIndex((prev) => (prev + 1) % diffElementsRef.current.length);
  }, []);

  const handlePrevDiff = useCallback(() => {
    if (diffElementsRef.current.length === 0) return;
    setCurrentDiffIndex(
      (prev) =>
        (prev - 1 + diffElementsRef.current.length) %
        diffElementsRef.current.length,
    );
  }, []);

  const updatePageIndicator = useCallback(() => {
    const container = scrollContainerRef.current;
    const mainArea = mainAreaRef.current;
    const totalPages = pageElementsRef.current.length;

    if (!container || !mainArea || totalPages === 0) return;

    const containerRect = container.getBoundingClientRect();
    const mainRect = mainArea.getBoundingClientRect();
    const scrollable = container.scrollHeight - container.clientHeight;
    const canScroll = scrollable > 2;
    if (isScrollableRef.current !== canScroll) {
      isScrollableRef.current = canScroll;
      setIsScrollable(canScroll);
    }
    const progress = scrollable > 0 ? container.scrollTop / scrollable : 0;

    const indicatorHeight = pageIndicatorRef.current?.offsetHeight || 28;
    const topMin = containerRect.top - mainRect.top + 6;
    const topMax =
      containerRect.top -
      mainRect.top +
      containerRect.height -
      indicatorHeight -
      6;
    const computedTop =
      topMax > topMin ? topMin + (topMax - topMin) * progress : topMin;

    const offsets = pageOffsetsRef.current;
    const targetPosition = container.scrollTop + container.clientHeight / 2;
    let currentIndex = 0;

    if (offsets.length > 0) {
      let low = 0;
      let high = offsets.length - 1;
      let best = 0;

      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (offsets[mid] <= targetPosition) {
          best = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      currentIndex = best;
    }

    const currentPage = Math.min(totalPages, Math.max(1, currentIndex + 1));

    setIndicatorTop(computedTop);
    setPageIndicator((prev) =>
      prev.current === currentPage && prev.total === totalPages
        ? prev
        : { current: currentPage, total: totalPages },
    );
  }, []);

  const rebuildPageMetrics = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || pageElementsRef.current.length === 0) return;

    const containerRect = container.getBoundingClientRect();
    pageOffsetsRef.current = pageElementsRef.current.map((el) => {
      const rect = el.getBoundingClientRect();
      return rect.top - containerRect.top + container.scrollTop;
    });

    updatePageIndicator();
  }, [updatePageIndicator]);

  const handlePagesReady = useCallback(
    (elements) => {
      pageElementsRef.current = elements || [];
      pageOffsetsRef.current = [];
      const totalPages = pageElementsRef.current.length;
      setPageIndicator({ current: totalPages > 0 ? 1 : 0, total: totalPages });

      requestAnimationFrame(() => {
        rebuildPageMetrics();
      });
    },
    [rebuildPageMetrics],
  );

  // Reset diff scanning state when document or active version changes or viewMode changes
  useEffect(() => {
    setTotalDiffs(0);
    setCurrentDiffIndex(-1);
    diffElementsRef.current = [];
  }, [activeVersionId, viewMode]);

  useEffect(() => {
    pageElementsRef.current = [];
    pageOffsetsRef.current = [];
    setPageIndicator({ current: 0, total: 0 });
    setIndicatorTop(0);
    isScrollableRef.current = false;
    setIsScrollable(false);
    setIsScrolling(false);
  }, [activeVersionId, viewMode]);

  const handleScroll = useCallback(() => {
    if (scrollHideTimeoutRef.current) {
      clearTimeout(scrollHideTimeoutRef.current);
    }

    setIsScrolling(true);
    scrollHideTimeoutRef.current = setTimeout(() => {
      setIsScrolling(false);
    }, 800);

    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      updatePageIndicator();
    });
  }, [updatePageIndicator]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
      if (scrollHideTimeoutRef.current) {
        clearTimeout(scrollHideTimeoutRef.current);
        scrollHideTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      rebuildPageMetrics();
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [rebuildPageMetrics]);

  // Effect to handle visual highlighting and scrolling
  useEffect(() => {
    const elements = diffElementsRef.current;
    if (
      currentDiffIndex >= 0 &&
      currentDiffIndex < elements.length &&
      viewMode === "diff"
    ) {
      const activeEl = elements[currentDiffIndex];

      // Remove focus class from all elements
      elements.forEach((el) => {
        el.classList.remove("active-diff-highlight");
      });

      // Add focus class to active element
      activeEl.classList.add("active-diff-highlight");

      // Scroll element into view smoothly
      activeEl.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [currentDiffIndex, viewMode]);

  // Keyboard navigation shortcuts
  useEffect(() => {
    if (viewMode !== "diff" || totalDiffs <= 0) return;

    const handleKeyDown = (e) => {
      // Disable shortcuts when user is typing in a form input
      if (
        document.activeElement.tagName === "INPUT" ||
        document.activeElement.tagName === "TEXTAREA" ||
        document.activeElement.isContentEditable
      ) {
        return;
      }

      if (e.key === "n" || e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        handleNextDiff();
      } else if (e.key === "p" || e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        handlePrevDiff();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [viewMode, totalDiffs, handleNextDiff, handlePrevDiff]);

  // Fetch document metadata
  const { data: document, isLoading: docLoading, error: docError } = useQuery({
    queryKey: ["documents", documentUuid],
    queryFn: () => documentsApi.get(documentUuid),
    retry: false,
  });

  // Effective permissions for the current user on this document
  const perms = document?.effective_permissions || [];

  // Fetch versions
  const { data: versions, isLoading: versionsLoading, error: versionsError } = useQuery({
    queryKey: ["documents", documentUuid, "versions"],
    queryFn: () => documentsApi.getVersions(documentUuid),
    enabled: !!document,
    retry: false,
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
        const newestVersion = [...versions].sort(
          (a, b) => b.version_number - a.version_number,
        )[0];
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
  const {
    data: diffContent,
    isLoading: diffLoading,
    isError: diffError,
    error: diffQueryError,
  } = useQuery({
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
          queryKey: ["documents", documentUuid, "versions"],
        });
        queryClient.invalidateQueries({ queryKey: ["documents", documentUuid] });
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [activeVersion?.status, documentUuid, queryClient]);

  // Handle Restore
  const restoreMutation = useMutation({
    mutationFn: (id) => versionsApi.restore(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents", documentUuid] });
      queryClient.invalidateQueries({
        queryKey: ["documents", documentUuid, "versions"],
      });
      queryClient.invalidateQueries({
        queryKey: ["documents", documentUuid, "audit"],
      });
      setRestoreTargetVersion(null);
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
        queryKey: ["documents", documentUuid, "versions"],
      });
      queryClient.invalidateQueries({
        queryKey: ["documents", documentUuid, "audit"],
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

  const updateVersionMutation = useMutation({
    mutationFn: ({ id, name, comment }) =>
      versionsApi.update(id, { name, comment }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["documents", documentUuid, "versions"],
      });
      queryClient.invalidateQueries({
        queryKey: ["documents", documentUuid, "audit"],
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

  const isUnauthorized = 
    (docError && docError.response?.status === 403) || 
    (versionsError && versionsError.response?.status === 403);
    
  const isNotFound = 
    (docError && docError.response?.status === 404) || 
    (versionsError && versionsError.response?.status === 404);

  if (isUnauthorized) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-neutral-50 dark:bg-neutral-900 min-h-[600px]">
        <div className="max-w-md w-full text-center space-y-6 bg-white dark:bg-neutral-950 p-8 rounded-xl shadow-lg border border-neutral-200 dark:border-neutral-800">
          <div className="mx-auto h-16 w-16 bg-red-100 dark:bg-red-900/30 flex items-center justify-center rounded-full text-red-600 dark:text-red-400">
            <Lock className="h-8 w-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">Unauthorized Access</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              You do not have the required permissions to view this document. If you believe this is an error, please contact your administrator.
            </p>
          </div>
          <div className="pt-4">
            <Button onClick={onClose} className="w-full">
              Return to Workspace
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (isNotFound || (docError && !docLoading)) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-neutral-50 dark:bg-neutral-900 min-h-[600px]">
        <div className="max-w-md w-full text-center space-y-6 bg-white dark:bg-neutral-950 p-8 rounded-xl shadow-lg border border-neutral-200 dark:border-neutral-800">
          <div className="mx-auto h-16 w-16 bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center rounded-full text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-8 w-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">Document Not Found</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              The requested document could not be located, has been deleted, or you lack permissions.
            </p>
          </div>
          <div className="pt-4">
            <Button onClick={onClose} className="w-full">
              Return to Workspace
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (docLoading || versionsLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-neutral-300" />
      </div>
    );
  }

  const hasDiff = activeVersion?.version_number > 1;
  const showPageIndicator =
    viewMode === "normal" ||
    viewMode === "ocr" ||
    (viewMode === "diff" && isPdf(activeVersion?.storage_path));
  const versionUploadExtension = activeVersion?.storage_path
    ? isPdf(activeVersion.storage_path)
      ? ".pdf"
      : ".docx"
    : null;

  const handleDownload = async () => {
    if (!activeVersion) return;
    try {
      const url = `${FILE_BASE_URL}/${activeVersion.storage_path}`;
      const ext = isPdf(activeVersion.storage_path) ? ".pdf" : ".docx";
      const baseName =
        document?.name?.replace(/\.(docx|pdf)$/i, "") ||
        `version_${activeVersion.version_number}`;
      const filename = `${baseName}${ext}`;
      await filesApi.downloadFile(url, filename);
    } catch (err) {
      toast({
        title: "Download failed",
        description: "Could not download the file.",
        variant: "destructive",
      });
    }
  };

  const contentWidthClass = viewMode === "audit" ? "max-w-full" : "max-w-4xl";

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
            {isPdf(activeVersion?.storage_path) ? (
              <PdfIcon className="w-5 h-5 mr-2 shrink-0" />
            ) : (
              <DocxIcon className="w-5 h-5 mr-2 shrink-0" />
            )}
            <h1 className="font-semibold text-lg">{document?.name}</h1>
          </div>
        </div>

        <div className="flex space-x-2">
          {perms.includes("document:download") && (
            <Button
              variant="default"
              size="sm"
              onClick={handleDownload}
              disabled={!activeVersion || activeVersion.status !== "success"}
            >
              <Download className="w-4 h-4 mr-2" /> Download Version{" "}
              {activeVersion?.version_number}
            </Button>
          )}
          {perms.includes("version:create") && (
            <Button size="sm" onClick={() => setUploadOpen(true)}>
              <RefreshCw className="w-4 h-4 mr-2" /> Update Version
            </Button>
          )}
        </div>
      </div>

      <div ref={mainAreaRef} className="flex-1 flex overflow-hidden relative">
        {/* Main Content Area */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-auto bg-neutral-100 p-8"
        >
          <div className={`${contentWidthClass} mx-auto w-full mb-4`}>
            <Tabs
              value={viewMode}
              onValueChange={setViewMode}
              className="w-fit"
            >
              {(() => {
                const isPdfDoc = isPdf(activeVersion?.storage_path);
                let cols = 2;
                if (isPdfDoc) cols++;
                if (isAdmin) cols++;
                const colsClass = {
                  2: "grid-cols-2",
                  3: "grid-cols-3",
                  4: "grid-cols-4",
                }[cols];
                return (
                  <TabsList className={`grid w-full ${colsClass}`}>
                    <TabsTrigger value="normal">Normal View</TabsTrigger>
                    <TabsTrigger value="diff" disabled={!hasDiff}>
                      Diff View
                    </TabsTrigger>
                    {isPdfDoc && (
                      <TabsTrigger value="ocr">OCR View</TabsTrigger>
                    )}
                    {isAdmin && (
                      <TabsTrigger value="audit">Audit Log</TabsTrigger>
                    )}
                  </TabsList>
                );
              })()}
            </Tabs>
          </div>

          <div
            className={`${contentWidthClass} mx-auto w-full bg-white shadow-sm border border-neutral-200 rounded-md min-h-[800px] flex flex-col relative`}
          >
            {viewMode === "audit" ? (
              <AuditLogTab
                documentUuid={documentUuid}
                documentName={document?.name}
              />
            ) : (
              <>
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

                {activeVersion?.status === "success" &&
                  viewMode === "normal" && (
                    <div className="w-full flex-1">
                      {isPdf(activeVersion?.storage_path) ? (
                        <PdfRenderer
                          url={`${FILE_BASE_URL}/${activeVersion.storage_path}`}
                          onPagesReady={handlePagesReady}
                        />
                      ) : (
                        <DocxRenderer
                          url={`${FILE_BASE_URL}/${activeVersion.storage_path}`}
                          onPagesReady={handlePagesReady}
                        />
                      )}
                    </div>
                  )}

                {activeVersion?.status === "success" && viewMode === "ocr" && (
                  <div className="w-full flex-1">
                    <OcrRenderer
                      versionId={activeVersion.id}
                      onPagesReady={handlePagesReady}
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
                            <Wand2 className="w-4 h-4 mr-2" /> AI Diff Summary
                            for Version {previousVersion?.version_number} &rarr;{" "}
                            {activeVersion?.version_number}
                          </div>
                          {(() => {
                            const hasChanges =
                              diffContent?.stats &&
                              ((diffContent.stats.added_chars || 0) > 0 ||
                                (diffContent.stats.removed_chars || 0) > 0 ||
                                (diffContent.stats.modified_blocks || 0) > 0 ||
                                (diffContent.stats.added_blocks || 0) > 0 ||
                                (diffContent.stats.removed_blocks || 0) > 0);

                            // Hide button entirely if user can't summarize
                            if (!perms.includes("ai:diff_summary")) return null;

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
                            <div className="flex justify-between items-end mt-2">
                              {perms.includes("version:create") &&
                                activeVersion?.version_number ===
                                  document?.current_version_number && (
                                  <Button
                                    size="xs"
                                    variant="ghost"
                                    className="h-7 text-xs text-blue-700 hover:bg-blue-100/50 hover:text-blue-800"
                                    onClick={() =>
                                      handleTransferToComment(
                                        diffContent.ai_summary,
                                      )
                                    }
                                  >
                                    <Copy className="w-3 h-3 mr-2" /> Use as
                                    Change Note
                                  </Button>
                                )}
                              {diffContent.stats?.ai_prompt_tokens !==
                                undefined && (
                                <span className="text-xs text-blue-400/80 italic font-medium pr-2 pb-1">
                                  * Costed {diffContent.stats.ai_prompt_tokens}{" "}
                                  Input tokens and{" "}
                                  {diffContent.stats.ai_completion_tokens}{" "}
                                  Output tokens
                                </span>
                              )}
                            </div>
                          </>
                        ) : perms.includes("ai:diff_summary") ? (
                          <p className="text-sm text-blue-600/70 italic">
                            Click generate to get an AI summary of what changed
                            in this version.
                          </p>
                        ) : (
                          <p className="text-sm text-blue-600/70 italic">
                            No AI summary has been generated for this version
                            yet.
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
                                {diffQueryError?.response?.data?.error ||
                                  diffQueryError?.message ||
                                  "An error occurred while computing the differences."}
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
                                The comparison is being calculated. This may
                                take a moment.
                              </p>
                            </div>
                          );
                        }

                        return (
                          <div ref={diffContainerRef} className="w-full flex-1">
                            {isPdf(activeVersion?.storage_path) ? (
                              <TextDiffRenderer
                                oldVersionId={previousVersion?.id}
                                newVersionId={activeVersion?.id}
                                onLoaded={handleDiffLoaded}
                                onPagesReady={handlePagesReady}
                              />
                            ) : (
                              <DocxDiffRenderer
                                oldUrl={`${FILE_BASE_URL}/${previousVersion?.storage_path}`}
                                newUrl={`${FILE_BASE_URL}/${activeVersion?.storage_path}`}
                                onLoaded={handleDiffLoaded}
                                onPagesReady={handlePagesReady}
                              />
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
              </>
            )}
          </div>

          {/* Bottom spacing */}
          <div className="h-12 shrink-0"></div>
        </div>

        {/* Sidebar: Version History */}
        {viewMode !== "audit" && (
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
                            Change Note
                          </label>
                          <textarea
                            className="w-full text-xs border rounded p-1.5 min-h-[60px] focus:outline-none focus:ring-1 focus:ring-blue-400"
                            value={editComment}
                            onChange={(e) => setEditComment(e.target.value)}
                            placeholder="Describe what changed in this version"
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
                            {perms.includes("version:create") &&
                              v.version_number ===
                                document?.current_version_number && (
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
                              )}
                          </div>
                          <div className="text-[10px] text-neutral-400 flex items-center">
                            {format(
                              new Date(v.created_at),
                              "dd/MM/yyyy h:mm a",
                            )}
                          </div>
                        </div>

                        <div className="mb-2">
                          <div className="text-[10px] uppercase font-bold text-neutral-400 mb-1">
                            Change Note
                          </div>
                          <div className="text-xs text-neutral-600 bg-neutral-50 p-2 rounded border border-neutral-100 version-comment-markdown">
                            {v.comment ? (
                              <ReactMarkdown>{v.comment}</ReactMarkdown>
                            ) : (
                              <span className="italic text-neutral-400">
                                No change note provided.
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex justify-between items-center mt-3">
                          <div className="text-[10px] text-neutral-400 font-mono">
                            v{v.version_number} •{" "}
                            {(v.file_size / 1024).toFixed(1)} KB
                          </div>
                          <div className="flex gap-1">
                            {/* Restore: only for non-current versions */}
                            {perms.includes("version:create") &&
                              v.version_number !==
                                document?.current_version_number &&
                              v.status === "success" && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 text-neutral-500"
                                  title="Restore"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setRestoreTargetVersion(v);
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
        )}

        {showPageIndicator && pageIndicator.total > 0 && isScrollable && (
          <div
            ref={pageIndicatorRef}
            className={`absolute z-40 right-[332px] pointer-events-none transition-opacity duration-200 ${isScrolling ? "opacity-100" : "opacity-0"}`}
            style={{ top: indicatorTop }}
            aria-hidden="true"
          >
            <div className="rounded-full bg-white/90 border border-neutral-200 shadow-md px-2.5 py-1 text-[11px] font-semibold text-neutral-700">
              Page {pageIndicator.current} of {pageIndicator.total}
            </div>
          </div>
        )}

        {/* Floating Vertical Diff Navigation Pill */}
        {viewMode === "diff" && totalDiffs > 0 && (
          <div className="absolute right-[344px] top-1/2 -translate-y-1/2 z-30 flex flex-col items-center bg-white/95 dark:bg-neutral-900/95 backdrop-blur-md shadow-2xl rounded-full border border-neutral-200/80 dark:border-neutral-800/80 p-2.5 gap-2.5 transition-all duration-300 hover:shadow-neutral-300/50 hover:border-neutral-300/80">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100/80 dark:text-neutral-400 dark:hover:text-neutral-100 dark:hover:bg-neutral-800/80 transition-all active:scale-95"
              onClick={handlePrevDiff}
              title="Previous Change (k or ArrowUp)"
            >
              <ChevronUp className="w-5 h-5" />
            </Button>
            <div className="flex flex-col items-center select-none font-sans px-1">
              <span className="text-[11px] font-bold text-neutral-800 dark:text-neutral-200 tracking-wider">
                {currentDiffIndex + 1}
              </span>
              <div className="w-4 h-px bg-neutral-200 dark:bg-neutral-700 my-0.5" />
              <span className="text-[10px] text-neutral-400 dark:text-neutral-500 font-semibold">
                {totalDiffs}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100/80 dark:text-neutral-400 dark:hover:text-neutral-100 dark:hover:bg-neutral-800/80 transition-all active:scale-95"
              onClick={handleNextDiff}
              title="Next Change (j or ArrowDown)"
            >
              <ChevronDown className="w-5 h-5" />
            </Button>
          </div>
        )}
      </div>

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        documentId={documentUuid}
        documentName={document?.name}
        allowedExtension={versionUploadExtension}
        nextVersionNumber={
          document?.current_version_number
            ? document.current_version_number + 1
            : null
        }
      />

      <AlertDialog
        open={Boolean(restoreTargetVersion)}
        onOpenChange={(open) => {
          if (!open) setRestoreTargetVersion(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this version?</AlertDialogTitle>
            <AlertDialogDescription>
              This will create a new latest version from{" "}
              {restoreTargetVersion
                ? `Version ${restoreTargetVersion.version_number}`
                : "this version"}
              . Existing versions will remain unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoreMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (!restoreTargetVersion) return;
                restoreMutation.mutate(restoreTargetVersion.id);
              }}
              disabled={restoreMutation.isPending}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {restoreMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {restoreMutation.isPending ? "Restoring..." : "Restore version"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
