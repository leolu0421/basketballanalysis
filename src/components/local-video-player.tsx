"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import type { YoutubePlayerHandle } from "./youtube-player";

export const LocalVideoPlayer = forwardRef<YoutubePlayerHandle, { matchId: string }>(
  function LocalVideoPlayer({ matchId }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null);

    useImperativeHandle(ref, () => ({
      getCurrentTime: () => videoRef.current?.currentTime ?? 0,
      seekTo: (seconds: number) => {
        if (videoRef.current) videoRef.current.currentTime = seconds;
      },
    }));

    return (
      <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
        <video
          ref={videoRef}
          src={`/api/matches/${matchId}/video`}
          controls
          className="h-full w-full"
        />
      </div>
    );
  }
);
