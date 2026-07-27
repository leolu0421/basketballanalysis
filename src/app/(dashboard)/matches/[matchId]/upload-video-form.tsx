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
    <div className="rounded-xl border border-black/5 bg-white p-4">
      <h3 className="text-sm font-semibold text-navy">Upload match video</h3>
      <p className="mt-1 text-xs text-black/50">
        {hint ??
          "Upload the game video directly instead of linking a YouTube video. Large files can take a while to upload — keep this tab open until it finishes."}
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        onChange={handleFileChange}
        disabled={progress !== null}
        className="mt-3 text-sm"
      />
      {progress !== null && (
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/5">
            <div
              className="h-1.5 rounded-full bg-brand transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-black/40">Uploading… {progress}%</p>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
