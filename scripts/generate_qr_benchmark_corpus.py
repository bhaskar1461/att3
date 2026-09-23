"""
SNIST ERP — QR Benchmark Corpus Generator (Week 6: Part D)
Generates 50+ standardized synthetic QR test images across 6 degradation categories:
- sharp (10 samples)
- blurry (10 samples, sigma 1.5–3.5)
- small (10 samples, 180–320px in lecture hall 1080p frame)
- occluded (10 samples, 10–25% center/corner/edge masking)
- low_light (6 samples, low contrast + Poisson/Gaussian sensor noise)
- glare (4 samples, specular projector hotspot washout bloom)

All use real short-token payload format: ?s=<CROCKFORD_8>&v=<STEP>
"""

import os
import json
import random
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance
import qrcode
from qrcode.constants import ERROR_CORRECT_M, ERROR_CORRECT_H

# Pinned random seed for 100% reproducible benchmark generation
random.seed(42)
np.random.seed(42)

CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

def generate_short_payload(seq_num: int) -> str:
    code = "".join(random.choice(CROCKFORD_ALPHABET) for _ in range(8))
    step = 500000 + seq_num
    return f"?s={code}&v={step}"

def make_base_qr_img(payload: str, size: int = 500, error_correction=ERROR_CORRECT_M) -> Image.Image:
    qr = qrcode.QRCode(
        version=None,
        error_correction=error_correction,
        box_size=10,
        border=4,
    )
    qr.add_data(payload)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    return img.resize((size, size), Image.Resampling.NEAREST)

def apply_blur(img: Image.Image, sigma: float) -> Image.Image:
    return img.filter(ImageFilter.GaussianBlur(radius=sigma))

def apply_small_frame(img: Image.Image, qr_size: int, frame_w: int = 1920, frame_h: int = 1080) -> Image.Image:
    # 1080p background simulating classroom wall/projector environment
    canvas = Image.new("RGB", (frame_w, frame_h), (210, 212, 215))
    # Draw faint projector frame boundary
    draw = ImageDraw.Draw(canvas)
    proj_box = [int(frame_w * 0.2), int(frame_h * 0.1), int(frame_w * 0.8), int(frame_h * 0.9)]
    draw.rectangle(proj_box, fill=(245, 246, 248), outline=(180, 180, 180), width=3)
    
    # Place scaled QR in the center of projector screen
    scaled_qr = img.resize((qr_size, qr_size), Image.Resampling.BILINEAR)
    pos_x = (frame_w - qr_size) // 2
    pos_y = (frame_h - qr_size) // 2
    canvas.paste(scaled_qr, (pos_x, pos_y))
    return canvas

def apply_occlusion(img: Image.Image, pct: float, occlude_type: str = "center") -> Image.Image:
    res = img.copy()
    w, h = res.size
    draw = ImageDraw.Draw(res)
    
    side = int(math.sqrt(w * h * pct))
    if occlude_type == "center":
        x1 = (w - side) // 2
        y1 = (h - side) // 2
        draw.rectangle([x1, y1, x1 + side, y1 + side], fill="black")
    elif occlude_type == "corner":
        # Bottom-right corner (leaving top 3 finders intact)
        x1 = w - side - 20
        y1 = h - side - 20
        draw.rectangle([x1, y1, x1 + side, y1 + side], fill="white")
    elif occlude_type == "cross":
        # Cross sticker
        bar_w = int(w * 0.08)
        draw.rectangle([(w - bar_w) // 2, 40, (w + bar_w) // 2, h - 40], fill="black")
    return res

def apply_low_light_noise(img: Image.Image, brightness: float, noise_sigma: float) -> Image.Image:
    enhancer = ImageEnhance.Brightness(img)
    dimmed = enhancer.enhance(brightness)
    
    arr = np.array(dimmed, dtype=np.float32)
    noise = np.random.normal(0, noise_sigma, arr.shape)
    noisy_arr = np.clip(arr + noise, 0, 255).astype(np.uint8)
    return Image.fromarray(noisy_arr)

def apply_glare(img: Image.Image, center_x_ratio: float, center_y_ratio: float, radius: int) -> Image.Image:
    res = img.copy()
    w, h = res.size
    cx = int(w * center_x_ratio)
    cy = int(h * center_y_ratio)
    
    # Create radial alpha mask for glare hotspot
    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)
    for r in range(radius, 0, -2):
        alpha = int(255 * ((radius - r) / radius) ** 1.5)
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=alpha)
    
    white_overlay = Image.new("RGB", (w, h), (255, 255, 255))
    return Image.composite(white_overlay, res, mask)

def generate_benchmark_corpus():
    out_dirs = [
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures", "qr_benchmark")),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "fixtures", "qr_benchmark"))
    ]
    for d in out_dirs:
        os.makedirs(d, exist_ok=True)
        
    fixtures = []
    fixture_idx = 1
    
    # 1. Sharp / Ideal (10 samples)
    print("Generating category: Sharp (10 samples)...")
    for i in range(1, 11):
        payload = generate_short_payload(fixture_idx)
        img = make_base_qr_img(payload, size=512)
        fname = f"sharp_{i:02d}.png"
        for d in out_dirs:
            img.save(os.path.join(d, fname))
        fixtures.append({
            "id": f"sharp_{i:02d}",
            "filename": fname,
            "category": "sharp",
            "payload": payload,
            "params": {"size": 512},
            "expected_valid": True,
            "target_eval": "baseline_fast"
        })
        fixture_idx += 1
        
    # 2. Blurry (10 samples, sigma 1.5 to 3.5)
    print("Generating category: Blurry (10 samples)...")
    sigmas = [1.5, 1.7, 1.9, 2.1, 2.3, 2.5, 2.7, 2.9, 3.2, 3.5]
    for i, s in enumerate(sigmas, 1):
        payload = generate_short_payload(fixture_idx)
        # 220px represents realistic optical preview QR scale in classroom phone capture
        base = make_base_qr_img(payload, size=220)
        blurred = apply_blur(base, sigma=s)
        fname = f"blurry_{i:02d}.png"
        for d in out_dirs:
            blurred.save(os.path.join(d, fname))
        fixtures.append({
            "id": f"blurry_{i:02d}",
            "filename": fname,
            "category": "blurry",
            "payload": payload,
            "params": {"sigma": s, "size": 220},
            "expected_valid": True,
            "target_eval": "wasm_advantage_heavy"
        })
        fixture_idx += 1

    # 3. Small / Distant in 1080p frame (10 samples, 180px to 320px)
    print("Generating category: Small / Distant (10 samples)...")
    sizes = [320, 300, 280, 260, 240, 220, 200, 190, 185, 180]
    for i, sz in enumerate(sizes, 1):
        payload = generate_short_payload(fixture_idx)
        base = make_base_qr_img(payload, size=512)
        small_scene = apply_small_frame(base, qr_size=sz, frame_w=1920, frame_h=1080)
        fname = f"small_{i:02d}.png"
        for d in out_dirs:
            small_scene.save(os.path.join(d, fname))
        fixtures.append({
            "id": f"small_{i:02d}",
            "filename": fname,
            "category": "small",
            "payload": payload,
            "params": {"effective_qr_px": sz, "frame": "1920x1080"},
            "expected_valid": True,
            "target_eval": "wasm_distance_gate"
        })
        fixture_idx += 1

    # 4. Occluded / Damaged (10 samples, 10% to 25% masking, higher error correction)
    print("Generating category: Occluded (10 samples)...")
    occlusions = [
        (0.10, "center"), (0.12, "center"), (0.15, "center"), (0.18, "center"), (0.22, "center"),
        (0.10, "corner"), (0.15, "corner"), (0.20, "corner"), (0.25, "corner"), (0.15, "cross")
    ]
    for i, (pct, otype) in enumerate(occlusions, 1):
        payload = generate_short_payload(fixture_idx)
        # Using High error correction so code is theoretically recoverable
        base = make_base_qr_img(payload, size=512, error_correction=ERROR_CORRECT_H)
        occluded = apply_occlusion(base, pct=pct, occlude_type=otype)
        fname = f"occluded_{i:02d}.png"
        for d in out_dirs:
            occluded.save(os.path.join(d, fname))
        fixtures.append({
            "id": f"occluded_{i:02d}",
            "filename": fname,
            "category": "occluded",
            "payload": payload,
            "params": {"masked_pct": pct, "pattern": otype, "ec_level": "H"},
            "expected_valid": True,
            "target_eval": "reed_solomon_robustness"
        })
        fixture_idx += 1

    # 5. Low-Light / Sensor Noise (6 samples)
    print("Generating category: Low Light & Noise (6 samples)...")
    low_lights = [
        (0.45, 12.0), (0.40, 15.0), (0.35, 18.0),
        (0.30, 22.0), (0.25, 25.0), (0.20, 30.0)
    ]
    for i, (br, nsigma) in enumerate(low_lights, 1):
        payload = generate_short_payload(fixture_idx)
        base = make_base_qr_img(payload, size=512)
        noisy = apply_low_light_noise(base, brightness=br, noise_sigma=nsigma)
        fname = f"low_light_{i:02d}.png"
        for d in out_dirs:
            noisy.save(os.path.join(d, fname))
        fixtures.append({
            "id": f"low_light_{i:02d}",
            "filename": fname,
            "category": "low_light",
            "payload": payload,
            "params": {"brightness": br, "noise_sigma": nsigma},
            "expected_valid": True,
            "target_eval": "binarizer_contrast_recovery"
        })
        fixture_idx += 1

    # 6. Glare / Projector Washout (4 samples)
    print("Generating category: Glare Washout (4 samples)...")
    glares = [
        (0.40, 0.40, 90),
        (0.50, 0.50, 110),
        (0.60, 0.40, 120),
        (0.45, 0.55, 130)
    ]
    for i, (gx, gy, grad) in enumerate(glares, 1):
        payload = generate_short_payload(fixture_idx)
        base = make_base_qr_img(payload, size=512, error_correction=ERROR_CORRECT_H)
        glared = apply_glare(base, gx, gy, grad)
        fname = f"glare_{i:02d}.png"
        for d in out_dirs:
            glared.save(os.path.join(d, fname))
        fixtures.append({
            "id": f"glare_{i:02d}",
            "filename": fname,
            "category": "glare",
            "payload": payload,
            "params": {"center": [gx, gy], "radius": grad, "ec_level": "H"},
            "expected_valid": True,
            "target_eval": "specular_bloom_recovery"
        })
    # 7. 15-Meter Hall Room Extreme Range (10 samples)
    print("Generating category: 15-Meter Hall Extreme Range (10 samples)...")
    hall_configs = [
        # (distance_m, screen_qr_cm, simulated_px_in_1080p, defocus_sigma)
        (10.0, 100, 150, 0.4),
        (10.0, 80, 120, 0.5),
        (12.0, 100, 125, 0.6),
        (12.0, 80, 100, 0.7),
        (14.0, 120, 130, 0.7),
        (14.0, 100, 108, 0.8),
        (15.0, 120, 120, 0.8),
        (15.0, 100, 100, 0.9),
        (15.0, 80, 80, 1.0),
        (15.0, 60, 60, 1.1),
    ]
    for i, (dist_m, scr_cm, eff_px, dsigma) in enumerate(hall_configs, 1):
        payload = generate_short_payload(fixture_idx)
        base = make_base_qr_img(payload, size=512)
        scene = apply_small_frame(base, qr_size=eff_px, frame_w=1920, frame_h=1080)
        if dsigma > 0:
            scene = scene.filter(ImageFilter.GaussianBlur(radius=dsigma))
        fname = f"hall_15m_{i:02d}.png"
        for d in out_dirs:
            scene.save(os.path.join(d, fname))
        fixtures.append({
            "id": f"hall_15m_{i:02d}",
            "filename": fname,
            "category": "hall_15m",
            "payload": payload,
            "params": {
                "distance_m": dist_m,
                "projected_qr_cm": scr_cm,
                "effective_px_in_1080p": eff_px,
                "blur_sigma": dsigma,
                "frame": "1920x1080"
            },
            "expected_valid": True,
            "target_eval": "long_range_optical_limit"
        })
        fixture_idx += 1

    manifest = {
        "version": "1.1",
        "description": "SNIST ERP Synthetic QR Benchmark Corpus (Week 7: 15m Hall Range Extension)",
        "total_fixtures": len(fixtures),
        "categories": {
            "sharp": 10,
            "blurry": 10,
            "small": 10,
            "occluded": 10,
            "low_light": 6,
            "glare": 4,
            "hall_15m": 10
        },
        "fixtures": fixtures
    }
    
    for d in out_dirs:
        mpath = os.path.join(d, "manifest.json")
        with open(mpath, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)
        print(f"Saved manifest to {mpath}")
        
    print(f"Successfully generated {len(fixtures)} benchmark fixtures in {out_dirs[0]} and {out_dirs[1]}")

if __name__ == "__main__":
    generate_benchmark_corpus()
