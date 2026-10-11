"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { previewYoutubeImport, importYoutubeMatches } from "@/lib/actions/youtube-import-actions";

type Video = { videoId: string; title: string; alreadyImported: boolean; selected: boolean; opponentName: string; date: string };

export function YoutubeImportForm() {
  const [url, setUrl] = useState("");
  const [videos, setVideos] = useState<Video[]>([]);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  function update(id: string, change: Partial<Video>) {
    setVideos((items) => items.map((v) => v.videoId === id ? { ...v, ...change } : v));
  }
  return (
    <section className="mt-6 rounded-xl border border-black/5 bg-white p-5">
      <h2 className="text-sm font-semibold text-navy">Import matches from YouTube</h2>
      <p className="mt-1 text-xs text-black/50">Read up to 50 playlist or channel videos. Confirm opponents and match dates before importing. Videos stay on YouTube.</p>
      <form className="mt-3 flex flex-wrap gap-3" onSubmit={(event) => {
        event.preventDefault(); setMessage(""); setVideos([]);
        startTransition(async () => {
          const result = await previewYoutubeImport(url);
          if (result.error) setMessage(result.error);
          else {
            const rows = result.videos ?? [];
            setVideos(rows.map((v) => ({ ...v, selected: false, opponentName: "", date: "" })));
            if (!rows.length) setMessage("No accessible videos found.");
          }
        });
      }}>
        <input type="url" required aria-label="YouTube playlist or channel URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="YouTube playlist or channel URL" className="min-w-0 flex-1 rounded-lg border border-black/10 px-3 py-2 text-sm" />
        <button disabled={pending} className="rounded-lg bg-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{pending ? "Working…" : "Read videos"}</button>
      </form>
      {videos.length > 0 && <form className="mt-4 space-y-3" onSubmit={(event) => {
        event.preventDefault(); setMessage("");
        startTransition(async () => {
          const result = await importYoutubeMatches(videos.filter((v) => v.selected && !v.alreadyImported).map(({ videoId, opponentName, date }) => ({ videoId, opponentName, date })));
          if (result.error) setMessage(result.error);
          else { setMessage(`Imported ${result.imported} matches; skipped ${result.skipped} existing videos.`); setVideos([]); router.refresh(); }
        });
      }}>
        {videos.map((v) => <div key={v.videoId} className="grid gap-2 rounded-lg bg-black/5 p-3 sm:grid-cols-3">
          <label className="text-sm"><input type="checkbox" disabled={pending || v.alreadyImported} checked={v.selected} onChange={(e) => update(v.videoId, { selected: e.target.checked })} className="mr-2" />{v.title}{v.alreadyImported && " (already imported)"}</label>
          <input aria-label={`Opponent for ${v.title}`} placeholder="Opponent name" required={v.selected} disabled={pending || !v.selected} value={v.opponentName} onChange={(e) => update(v.videoId, { opponentName: e.target.value })} className="rounded border border-black/10 px-3 py-2 text-sm" />
          <input aria-label={`Match date for ${v.title}`} type="date" required={v.selected} disabled={pending || !v.selected} value={v.date} onChange={(e) => update(v.videoId, { date: e.target.value })} className="rounded border border-black/10 px-3 py-2 text-sm" />
        </div>)}
        <button disabled={pending || !videos.some((v) => v.selected)} className="rounded-lg bg-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">Import selected matches</button>
      </form>}
      {message && <p role="status" className="mt-3 text-sm text-navy">{message}</p>}
    </section>
  );
}
