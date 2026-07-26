#!/usr/bin/env python3
"""
Fine-tunes a small pretrained image classifier (MobileNetV3-Small) on
labeled jersey crops produced by extract_training_crops.py + label_crops.py.

This model learns ONE thing: what digit(s) are painted on a jersey crop.
Deliberately NOT "which team" or "which player" — team colors are
different every game (this week's opponent isn't next week's), so a model
trained to recognize a specific opponent's colors wouldn't generalize past
that one game. Number-to-player mapping happens separately, live, from
your team's current roster in the app (already handles roster changes
season to season on its own — nothing here needs retraining when Harper
and Zac's teammates change). That's why this only needs one trained model
that keeps working across seasons and opponents, rather than one you'd
have to redo constantly.

Usage:
    python3 train_jersey_classifier.py <crops_dir> <output_dir> [--epochs 15]

Expects <crops_dir>/labels.csv (filename,label) as written by
label_crops.py. Writes <output_dir>/jersey_classifier.pt and
<output_dir>/jersey_classes.json — point classify_jersey.py at
<output_dir> to run inference.
"""
import argparse
import csv
import json
import os
import random

import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms, models
from PIL import Image

UNREADABLE = "UNREADABLE"


def load_labeled_examples(crops_dir):
    csv_path = os.path.join(crops_dir, "labels.csv")
    if not os.path.exists(csv_path):
        return []
    examples = []
    with open(csv_path, newline="") as f:
        for row in csv.reader(f):
            if len(row) != 2:
                continue
            filename, label = row
            if label == UNREADABLE:
                continue
            examples.append((os.path.join(crops_dir, filename), label))
    return examples


class CropDataset(Dataset):
    def __init__(self, examples, class_to_idx, augment):
        self.examples = examples
        self.class_to_idx = class_to_idx
        steps = [transforms.Resize((128, 128))]
        if augment:
            steps += [
                transforms.RandomHorizontalFlip(),
                transforms.ColorJitter(brightness=0.3, contrast=0.3, saturation=0.3),
            ]
        steps += [
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ]
        self.transform = transforms.Compose(steps)

    def __len__(self):
        return len(self.examples)

    def __getitem__(self, idx):
        path, cls = self.examples[idx]
        img = Image.open(path).convert("RGB")
        return self.transform(img), self.class_to_idx[cls]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("crops_dir")
    parser.add_argument("output_dir")
    parser.add_argument("--epochs", type=int, default=15)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--val-split", type=float, default=0.15)
    parser.add_argument(
        "--min-per-class",
        type=int,
        default=4,
        help="Classes with fewer labeled examples than this are dropped (too little signal to learn from)",
    )
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)

    examples = load_labeled_examples(args.crops_dir)
    if not examples:
        print(json.dumps({"error": "No labeled examples found (missing/empty labels.csv)"}))
        return

    counts = {}
    for _, cls in examples:
        counts[cls] = counts.get(cls, 0) + 1
    kept_classes = {c for c, n in counts.items() if n >= args.min_per_class}
    dropped = {c: n for c, n in counts.items() if c not in kept_classes}
    examples = [(p, c) for p, c in examples if c in kept_classes]

    if len(kept_classes) < 2:
        print(
            json.dumps(
                {
                    "error": f"Not enough labeled classes with >= {args.min_per_class} examples each to "
                    f"train (label counts: {counts}). Label more crops per player and try again."
                }
            )
        )
        return

    classes = sorted(kept_classes)
    class_to_idx = {c: i for i, c in enumerate(classes)}

    random.seed(42)
    random.shuffle(examples)
    val_size = max(1, int(len(examples) * args.val_split))
    val_examples = examples[:val_size]
    train_examples = examples[val_size:]

    train_ds = CropDataset(train_examples, class_to_idx, augment=True)
    val_ds = CropDataset(val_examples, class_to_idx, augment=False)
    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size)

    model = models.mobilenet_v3_small(weights=models.MobileNet_V3_Small_Weights.DEFAULT)
    in_features = model.classifier[-1].in_features
    model.classifier[-1] = nn.Linear(in_features, len(classes))

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model.to(device)

    optimizer = torch.optim.Adam(model.parameters(), lr=1e-4)
    criterion = nn.CrossEntropyLoss()

    best_val_acc = 0.0
    for epoch in range(args.epochs):
        model.train()
        for images, labels in train_loader:
            images, labels = images.to(device), labels.to(device)
            optimizer.zero_grad()
            loss = criterion(model(images), labels)
            loss.backward()
            optimizer.step()

        model.eval()
        correct, total = 0, 0
        with torch.no_grad():
            for images, labels in val_loader:
                images, labels = images.to(device), labels.to(device)
                preds = model(images).argmax(dim=1)
                correct += (preds == labels).sum().item()
                total += labels.size(0)
        val_acc = correct / total if total else 0.0
        best_val_acc = max(best_val_acc, val_acc)
        print(f"epoch {epoch + 1}/{args.epochs} val_acc={val_acc:.2f}")

    torch.save(model.state_dict(), os.path.join(args.output_dir, "jersey_classifier.pt"))
    with open(os.path.join(args.output_dir, "jersey_classes.json"), "w") as f:
        json.dump({"classes": classes}, f)

    print(
        json.dumps(
            {
                "trainedClasses": classes,
                "droppedClasses": dropped,
                "trainExamples": len(train_examples),
                "valExamples": len(val_examples),
                "bestValAccuracy": round(best_val_acc, 3),
            }
        )
    )


if __name__ == "__main__":
    main()
