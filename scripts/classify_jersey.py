#!/usr/bin/env python3
"""
Runs the trained jersey classifier (see train_jersey_classifier.py) on one
or more crop images and prints JSON predictions. Used by the Node pipeline
as the primary jersey-ID signal when a trained model is present at
<model_dir>, falling back to Claude vision otherwise (see pipeline.ts).

Usage:
    python3 classify_jersey.py <model_dir> <crop_path> [<crop_path> ...]
"""
import argparse
import json
import os
import sys

import torch
import torch.nn.functional as F
from torchvision import transforms, models
from PIL import Image


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("model_dir")
    parser.add_argument("crops", nargs="+")
    args = parser.parse_args()

    classes_path = os.path.join(args.model_dir, "jersey_classes.json")
    weights_path = os.path.join(args.model_dir, "jersey_classifier.pt")
    if not os.path.exists(classes_path) or not os.path.exists(weights_path):
        print(json.dumps({"error": f"No trained model found in {args.model_dir}"}))
        sys.exit(1)

    with open(classes_path) as f:
        classes = json.load(f)["classes"]

    model = models.mobilenet_v3_small()
    in_features = model.classifier[-1].in_features
    model.classifier[-1] = torch.nn.Linear(in_features, len(classes))
    model.load_state_dict(torch.load(weights_path, map_location="cpu"))
    model.eval()

    transform = transforms.Compose(
        [
            transforms.Resize((128, 128)),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ]
    )

    predictions = []
    with torch.no_grad():
        for crop_path in args.crops:
            img = Image.open(crop_path).convert("RGB")
            tensor = transform(img).unsqueeze(0)
            probs = F.softmax(model(tensor), dim=1)[0]
            top_idx = int(torch.argmax(probs))
            predictions.append(
                {
                    "crop": crop_path,
                    "label": classes[top_idx],
                    "confidence": round(float(probs[top_idx]), 3),
                }
            )

    print(json.dumps({"predictions": predictions}))


if __name__ == "__main__":
    main()
