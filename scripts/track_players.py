#!/usr/bin/env python3
"""
Tracks people through a short video clip and crops the torso region of each
tracked player at a few sample points, so a jersey number is readable at
higher resolution than a full-court frame would give.

This does NOT identify who a player is — it only keeps a consistent track_id
for "the same person" across the clip using motion + appearance (ByteTrack,
built into ultralytics' YOLO .track()). Jersey number / team identification
still happens downstream (currently: Claude vision reading the cropped
images this script produces).

Usage:
    python3 track_players.py <input_video> <output_dir> [--fps 5] [--start 0] [--end -1]

Writes <output_dir>/tracks.json:
{
  "tracks": [
    {
      "trackId": 3,
      "crops": ["<output_dir>/track_3_0.jpg", ...],
      "boxCount": 12
    },
    ...
  ]
}
"""
import argparse
import json
import os
import sys

import cv2
from ultralytics import YOLO

PERSON_CLASS_ID = 0  # COCO class 0 = person
CROPS_PER_TRACK = 3


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input_video")
    parser.add_argument("output_dir")
    parser.add_argument("--fps", type=float, default=5.0, help="Sampling rate within the clip")
    parser.add_argument("--start", type=float, default=0.0, help="Clip start time in seconds")
    parser.add_argument("--end", type=float, default=-1.0, help="Clip end time in seconds (-1 = end of video)")
    parser.add_argument("--model", default="yolov8n.pt", help="Ultralytics model weights")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)

    cap = cv2.VideoCapture(args.input_video)
    if not cap.isOpened():
        print(json.dumps({"error": f"Could not open video: {args.input_video}"}))
        sys.exit(1)

    video_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    end_time = args.end if args.end >= 0 else total_frames / video_fps
    start_frame = int(args.start * video_fps)
    end_frame = min(int(end_time * video_fps), total_frames)
    frame_stride = max(1, round(video_fps / args.fps))

    model = YOLO(args.model)

    tracks = {}  # trackId -> list of (frame_index, x1, y1, x2, y2)

    frame_index = start_frame
    cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
    while frame_index < end_frame:
        ok, frame = cap.read()
        if not ok:
            break
        if (frame_index - start_frame) % frame_stride == 0:
            results = model.track(
                frame, persist=True, classes=[PERSON_CLASS_ID], verbose=False
            )
            if results and results[0].boxes is not None and results[0].boxes.id is not None:
                boxes = results[0].boxes
                for box, track_id in zip(boxes.xyxy.tolist(), boxes.id.tolist()):
                    x1, y1, x2, y2 = box
                    tracks.setdefault(int(track_id), []).append(
                        (frame_index, frame, x1, y1, x2, y2)
                    )
        frame_index += 1

    cap.release()

    output_tracks = []
    for track_id, entries in tracks.items():
        # Spread crop samples evenly across the track's lifetime rather than
        # bunching them at the start.
        step = max(1, len(entries) // CROPS_PER_TRACK)
        sampled = entries[::step][:CROPS_PER_TRACK]

        crop_paths = []
        for i, (_, frame, x1, y1, x2, y2) in enumerate(sampled):
            h, w = frame.shape[:2]
            # Bias the crop toward the upper half of the bounding box, where
            # a jersey number usually sits, and pad slightly for context.
            box_h = y2 - y1
            pad_x = (x2 - x1) * 0.15
            crop_y2 = y1 + box_h * 0.65
            cx1 = max(0, int(x1 - pad_x))
            cy1 = max(0, int(y1))
            cx2 = min(w, int(x2 + pad_x))
            cy2 = min(h, int(crop_y2))
            if cx2 <= cx1 or cy2 <= cy1:
                continue
            crop = frame[cy1:cy2, cx1:cx2]
            crop_path = os.path.join(args.output_dir, f"track_{track_id}_{i}.jpg")
            cv2.imwrite(crop_path, crop)
            crop_paths.append(crop_path)

        if crop_paths:
            output_tracks.append(
                {"trackId": track_id, "crops": crop_paths, "boxCount": len(entries)}
            )

    with open(os.path.join(args.output_dir, "tracks.json"), "w") as f:
        json.dump({"tracks": output_tracks}, f)

    print(json.dumps({"trackCount": len(output_tracks)}))


if __name__ == "__main__":
    main()
