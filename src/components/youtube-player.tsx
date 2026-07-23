"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export type YoutubePlayerHandle = {
  getCurrentTime: () => number;
  seekTo: (seconds: number) => void;
};

declare global {
  interface Window {
    YT?: {
      Player: new (
        elementId: string,
        options: {
          videoId: string;
          events?: { onReady?: () => void };
        }
      ) => YTPlayerInstance;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

type YTPlayerInstance = {
  getCurrentTime: () => number;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
};

let apiPromise: Promise<void> | null = null;

function loadYoutubeApi(): Promise<void> {
  if (window.YT) return Promise.resolve();
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve) => {
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.body.appendChild(tag);
    window.onYouTubeIframeAPIReady = () => resolve();
  });

  return apiPromise;
}

export const YoutubePlayer = forwardRef<YoutubePlayerHandle, { videoId: string }>(
  function YoutubePlayer({ videoId }, ref) {
    const containerId = useRef(`yt-player-${videoId}-${Math.random().toString(36).slice(2)}`);
    const playerRef = useRef<YTPlayerInstance | null>(null);

    useEffect(() => {
      let cancelled = false;
      loadYoutubeApi().then(() => {
        if (cancelled || !window.YT) return;
        playerRef.current = new window.YT.Player(containerId.current, {
          videoId,
        });
      });
      return () => {
        cancelled = true;
      };
    }, [videoId]);

    useImperativeHandle(ref, () => ({
      getCurrentTime: () => playerRef.current?.getCurrentTime() ?? 0,
      seekTo: (seconds: number) => playerRef.current?.seekTo(seconds, true),
    }));

    return (
      <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
        <div id={containerId.current} className="h-full w-full" />
      </div>
    );
  }
);
