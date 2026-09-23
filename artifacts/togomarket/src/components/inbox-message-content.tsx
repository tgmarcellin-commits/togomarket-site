import React, { type MouseEvent } from "react";
import { FileText } from "lucide-react";

export interface InboxMessageContentData {
  content: string | null;
  fileType: string | null;
}

interface InboxMessageContentProps {
  message: InboxMessageContentData;
  fileSrc: string | null;
  onImageOpen?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

/**
 * Renders the user-visible content of an inbox message.
 *
 * The API returns a short-lived signed URL for private attachments. Keeping
 * that URL as the source/href (rather than rebuilding it from the object
 * path) lets refreshed inbox data continue to load images, audio, and PDFs.
 */
export function InboxMessageContent({
  message,
  fileSrc,
  onImageOpen,
}: InboxMessageContentProps) {
  const textContent = message.content?.trim() ?? "";

  return (
    <>
      {fileSrc && message.fileType === "image" && (
        <a
          href={fileSrc}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onImageOpen}
          onContextMenu={(event) => event.preventDefault()}
          className="block cursor-pointer"
          title="Ouvrir l’image"
        >
          <img
            src={fileSrc}
            alt="Image envoyée"
            draggable={false}
            className="max-w-[220px] max-h-[220px] object-cover block mt-1"
          />
        </a>
      )}

      {fileSrc && message.fileType === "audio" && (
        <div
          className="px-3 py-2"
          onTouchStart={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <audio
            controls
            src={fileSrc}
            className="h-10 max-w-[200px]"
            onContextMenu={(event) => event.preventDefault()}
          />
        </div>
      )}

      {fileSrc && message.fileType === "pdf" && (
        <a
          href={fileSrc}
          target="_blank"
          rel="noopener noreferrer"
          download
          className="flex items-center gap-2 px-3 py-2 cursor-pointer"
        >
          <FileText className="w-8 h-8 flex-shrink-0 opacity-80" />
          <span className="text-xs font-medium underline break-all">
            Télécharger le PDF
          </span>
        </a>
      )}

      {textContent && (
        <p className="px-3 py-2 break-words whitespace-pre-wrap">
          {message.content}
        </p>
      )}
    </>
  );
}