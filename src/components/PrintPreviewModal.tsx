import React, { useRef, useEffect } from 'react';

interface PrintPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  htmlContent?: string;
  children?: React.ReactNode;
}

export const PrintPreviewModal: React.FC<PrintPreviewModalProps> = ({
  isOpen,
  onClose,
  title,
  htmlContent,
  children
}) => {
  const printIframeRef = useRef<HTMLIFrameElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const hasPrintedRef = useRef(false);

  const getFullHtml = () => {
    if (htmlContent) {
      // Ensure size A5 is injected into htmlContent if it doesn't already have one
      if (!htmlContent.includes('@page') && !htmlContent.includes('size:')) {
        return htmlContent.replace('</head>', `
          <style>
            @media print {
              @page { size: A5 portrait; margin: 8mm; }
            }
          </style>
          </head>
        `);
      }
      return htmlContent;
    }
    const inner = contentRef.current?.innerHTML || '';
    return `
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <title>${title}</title>
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
        <script src="https://cdn.tailwindcss.com"></script>
        <style>
          body {
            font-family: 'Cairo', sans-serif;
            background-color: #ffffff;
            color: #0f172a;
            margin: 20px;
            direction: rtl;
          }
          @media print {
            @page {
              size: A5 portrait;
              margin: 8mm;
            }
            body {
              margin: 0;
              padding: 0;
              background-color: #ffffff;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .no-print { display: none !important; }
          }
        </style>
      </head>
      <body>
        <div class="p-4">
          ${inner}
        </div>
      </body>
      </html>
    `;
  };

  // Open the browser's native print dialog directly (no preview overlay).
  useEffect(() => {
    if (!isOpen) {
      hasPrintedRef.current = false;
      return;
    }
    if (hasPrintedRef.current) return;
    hasPrintedRef.current = true;

    // Small delay so offscreen children (if any) are rendered before capture.
    const prepareTimer = setTimeout(() => {
      const printFrame = printIframeRef.current;
      const fullHtml = getFullHtml();

      const finish = () => {
        onClose();
      };

      try {
        if (printFrame && printFrame.contentWindow) {
          const idoc = printFrame.contentDocument || printFrame.contentWindow.document;
          idoc.open();
          idoc.write(fullHtml);
          idoc.close();

          // Wait for fonts/Tailwind to parse before invoking the native dialog.
          setTimeout(() => {
            const win = printFrame.contentWindow;
            if (!win) {
              window.print();
              finish();
              return;
            }
            win.onafterprint = finish;
            try {
              win.focus();
              win.print();
            } catch (innerErr) {
              console.warn('Iframe print failed, trying direct window.print', innerErr);
              window.print();
            }
            // Fallback close in case onafterprint never fires (some browsers).
            setTimeout(finish, 1000);
          }, 500);
        } else {
          window.print();
          finish();
        }
      } catch (err) {
        console.warn('Writing to print iframe failed, trying direct window.print', err);
        window.print();
        finish();
      }
    }, 50);

    return () => clearTimeout(prepareTimer);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      {/* Offscreen render of children so their markup can be captured for printing */}
      {!htmlContent && children && (
        <div
          ref={contentRef}
          aria-hidden="true"
          style={{ position: 'fixed', left: '-9999px', top: 0, width: '800px' }}
        >
          {children}
        </div>
      )}

      {/* Hidden iframe used to trigger the native print dialog on the same page */}
      <iframe
        ref={printIframeRef}
        style={{ position: 'absolute', width: '0px', height: '0px', border: 'none', left: '-9999px', top: '-9999px' }}
        title="print-frame-isolated"
      />
    </>
  );
};
