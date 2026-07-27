"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function UploadVideoForm({ matchId, hint }: { matchId: string; hint?: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setProgress(0);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/matches/${matchId}/video?filename=${encodeURIComponent(file.name)}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setProgress(null);
        router.refresh();
      } else {
        setProgress(null);
        try {
          const body = JSON.parse(xhr.responseText);
          setError(body.error ?? "Upload failed. Try again.");
        } catch {
          setError("Upload failed. Try again.");
        }
      }
    };

    xhr.onerror = () => {
      setProgress(null);
      setError("Upload failed — connection interrupted. Try again.");
    };

    xhr.send(file);
    if (inputRef.current) inputRef.current.value = "";
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
