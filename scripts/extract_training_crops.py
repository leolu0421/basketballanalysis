#!/usr/bin/env python3
"""
Extracts individual person crops from a video for building a jersey-number
training set. Unlike track_players.py, this does NOT track identity across
frames — it just grabs many diverse single crops for you to label. Run this
against your own game footage, then label the output with label_crops.py.

Safe to call multiple times into the SAME output_dir — it numbers new
crops after whatever's already there instead of overwriting. Combine that
with --start to work through a long game in batches: run once, note the
"resume with --start ..." line it prints, then run again with that value
to continue from where the last batch left off, working forward through
the whole video instead of just the first --max-crops worth from the
beginning.

Usage:
    python3 extract_training_crops.py <input_video> <output_dir> [--fps 1] [--max-crops 500] [--start 0]
"""
import argparse
import glob
import os
import re

import cv2
from ultralytics import YOLO

PERSON_CLASS_ID = 0


def next_start_index(output_dir):
    existing = glob.glob(os.path.join(output_dir, "crop_*.jpg"))
    numbers = [int(m.group(1)) for f in existing if (m := re.search(r"crop_(\d+)\.jpg$", f))]
    return (max(numbers) + 1) if numbers else 0


def format_time(seconds):
    m = int(seconds // 60)
    s = int(seconds % 60)
    return f"{m}:{s:02d}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input_video")
    parser.add_argument("output_dir")
    parser.add_argument("--fps", type=float, default=1.0, help="Sampling rate to pull crops at")
    parser.add_argument("--max-crops", type=int, default=500, help="Stop after this many NEW crops")
    parser.add_argument("--start", type=float, default=0.0, help="Video time (seconds) to start sampling from")
    parser.add_argument("--model", default="yolov8n.pt")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    model = YOLO(args.model)

    cap = cv2.VideoCapture(args.input_video)
    if not cap.isOpened():
        print(f"Could not open {args.input_video}")
        return

    video_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    stride = max(1, round(video_fps / args.fps))
    if args.start > 0:
        cap.set(cv2.CAP_PROP_POS_MSEC, args.start * 1000)

    count = 0
    frame_index = 0
    next_index = next_start_index(args.output_dir)
    last_timestamp = args.start
    reached_end = False

    while count < args.max_crops:
        ok, frame = cap.read()
        if not ok:
            reached_end = True
            break
        last_timestamp = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
        if frame_index % stride == 0:
            results = model.predict(frame, classes=[PERSON_CLASS_ID], verbose=False)
            h, w = frame.shape[:2]
            for box in results[0].boxes.xyxy.tolist():
                x1, y1, x2, y2 = box
                box_h = y2 - y1
                pad_x = (x2 - x1) * 0.15
                crop_y2 = y1 + box_h * 0.65
                cx1, cy1 = max(0, int(x1 - pad_x)), max(0, int(y1))
                cx2, cy2 = min(w, int(x2 + pad_x)), min(h, int(crop_y2))
                if cx2 <= cx1 or cy2 <= cy1:
                    continue
                crop = frame[cy1:cy2, cx1:cx2]
                if crop.shape[0] < 20 or crop.shape[1] < 20:
                    continue  # too small to be a useful training example
                path = os.path.join(args.output_dir, f"crop_{next_index:05d}.jpg")
                cv2.imwrite(path, crop)
                next_index += 1
                count += 1
                if count >= args.max_crops:
                    break
        frame_index += 1

    cap.release()
    print(f"Extracted {count} new crops to {args.output_dir} (video time {format_time(args.start)}-{format_time(last_timestamp)})")
    if not reached_end:
        print(f"Not done yet — resume with: --start {last_timestamp:.0f}")
    else:
        print("Reached the end of the video.")


if __name__ == "__main__":
    main()
