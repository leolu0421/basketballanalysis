#!/usr/bin/env python3
"""
Extracts individual person crops from a video for building a jersey-number
training set. Unlike track_players.py, this does NOT track identity across
frames — it just grabs many diverse single crops for you to label. Run this
against your own game footage, then label the output with label_crops.py.

Usage:
    python3 extract_training_crops.py <input_video> <output_dir> [--fps 1] [--max-crops 500]
"""
import argparse
import os

import cv2
from ultralytics import YOLO

PERSON_CLASS_ID = 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input_video")
    parser.add_argument("output_dir")
    parser.add_argument("--fps", type=float, default=1.0, help="Sampling rate to pull crops at")
    parser.add_argument("--max-crops", type=int, default=500)
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

    count = 0
    frame_index = 0
    while count < args.max_crops:
        ok, frame = cap.read()
        if not ok:
            break
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
                path = os.path.join(args.output_dir, f"crop_{count:05d}.jpg")
                cv2.imwrite(path, crop)
                count += 1
                if count >= args.max_crops:
                    break
        frame_index += 1

    cap.release()
    print(f"Extracted {count} crops to {args.output_dir}")


if __name__ == "__main__":
    main()
