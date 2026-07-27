"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Small enough that a single chunk request finishes quickly even on a slow
// connection — a 683MB single-shot upload was confirmed in production to
// die partway through with a dropped connection, most likely a platform
// reverse-proxy timeout on the one long-lived request. Splitting into many
// short requests avoids that regardless of the exact cause.
const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_RETRIES_PER_CHUNK = 3;

function uploadChunk(url: string, chunk: Blob, onProgress: (loaded: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        try {
          const body = JSON.parse(xhr.responseText);
          reject(new Error(body.error ?? `Chunk upload failed (${xhr.status})`));
        } catch {
          reject(new Error(`Chunk upload failed (${xhr.status})`));
        }
      }
    };
    xhr.onerror = () => reject(new Error("Chunk upload failed — connection interrupted"));
    xhr.send(chunk);
  });
}

function makeUploadId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function UploadVideoForm({ matchId, hint }: { matchId: string; hint?: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setProgress(0);

    const uploadId = makeUploadId();
    const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    let uploadedBytes = 0;

    try {
      for (let index = 0; index < totalChunks; index++) {
        const start = index * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);
        const url = `/api/matches/${matchId}/video/chunk?uploadId=${uploadId}&index=${index}`;

        let lastErr: unknown;
        let succeeded = false;
        for (let attempt = 0; attempt < MAX_RETRIES_PER_CHUNK; attempt++) {
          try {
            await uploadChunk(url, chunk, (loaded) => {
              setProgress(Math.round(((uploadedBytes + loaded) / file.size) * 100));
            });
            succeeded = true;
            break;
          } catch (err) {
            lastErr = err;
          }
        }
        if (!succeeded) throw lastErr;

        uploadedBytes += chunk.size;
        setProgress(Math.round((uploadedBytes / file.size) * 100));
      }

      const finalizeRes = await fetch(`/api/matches/${matchId}/video/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId, totalChunks, filename: file.name }),
      });
      if (!finalizeRes.ok) {
        const body = await finalizeRes.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to finish upload.");
      }

      setProgress(null);
      router.refresh();
    } catch (err) {
      setProgress(null);
      setError(err instanceof Error ? err.message : "Upload failed. Try again.");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="rounded-xl border-2 border-dashed border-brand bg-brand/5 p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-navy">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
          >
            <path d="M12 16V4M12 4l-4 4M12 4l4 4" />
            <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-navy">Upload match video</h3>
          <p className="mt-1 text-xs text-black/60">
            {hint ??
              "Upload the game video directly instead of linking a YouTube video. Large files can take a while to upload — keep this tab open until it finishes."}
          </p>

          <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy/90 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
            Choose video file
            <input
              ref={inputRef}
              type="file"
              accept="video/*"
              onChange={handleFileChange}
              disabled={progress !== null}
              className="hidden"
            />
          </label>

          {progress !== null && (
            <div className="mt-3">
              <div className="h-2 w-full overflow-hidden rounded-full bg-white">
                <div
                  className="h-2 rounded-full bg-brand transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-1 text-xs font-medium text-navy">Uploading… {progress}%</p>
            </div>
          )}
          {error && <p className="mt-2 text-xs font-medium text-red-600">{error}</p>}
        </div>
      </div>
    </div>
  );
}
