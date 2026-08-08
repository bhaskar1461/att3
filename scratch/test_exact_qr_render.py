import io
import math
import os
import qrcode
from PIL import Image, ImageDraw, ImageFont, ImageFilter

def draw_snist_shield_exact(draw, bbox, fill_color=(228, 85, 14), flame_color=(255, 255, 255)):
    """
    Draws the exact SNIST Flame Shield logo:
    Orange shield container with rounded top corners, smooth sides, tapered bottom,
    and 3 white curved flame swooshes ascending from bottom-left to top-right.
    """
    x0, y0, x1, y1 = bbox
    w = x1 - x0
    h = y1 - y0
    cx = x0 + w / 2

    # Smooth shield contour
    r = w * 0.22
    # Outer shield shape
    shield_pts = [
        (x0 + r, y0),
        (x1 - r, y0),
        (x1, y0 + r),
        (x1, y0 + h * 0.58),
        (cx, y1),
        (x0, y0 + h * 0.58),
        (x0, y0 + r),
    ]
    draw.polygon(shield_pts, fill=fill_color)

    # 3 Curved Flame Swooshes inside shield
    # Flame 1 (Left short flame)
    f1 = [
        (x0 + w * 0.26, y0 + h * 0.62),
        (x0 + w * 0.38, y0 + h * 0.40),
        (x0 + w * 0.46, y0 + h * 0.28),
        (x0 + w * 0.40, y0 + h * 0.46),
        (x0 + w * 0.32, y0 + h * 0.68),
    ]
    # Flame 2 (Middle tall flame)
    f2 = [
        (x0 + w * 0.42, y0 + h * 0.72),
        (x0 + w * 0.56, y0 + h * 0.35),
        (x0 + w * 0.64, y0 + h * 0.18),
        (x0 + w * 0.58, y0 + h * 0.38),
        (x0 + w * 0.48, y0 + h * 0.76),
    ]
    # Flame 3 (Right medium flame)
    f3 = [
        (x0 + w * 0.58, y0 + h * 0.75),
        (x0 + w * 0.72, y0 + h * 0.42),
        (x0 + w * 0.78, y0 + h * 0.32),
        (x0 + w * 0.74, y0 + h * 0.46),
        (x0 + w * 0.64, y0 + h * 0.78),
    ]
    
    draw.polygon(f1, fill=flame_color)
    draw.polygon(f2, fill=flame_color)
    draw.polygon(f3, fill=flame_color)


def draw_pillar_icon(draw, center_x, center_y, pillar_index, color=(228, 85, 14)):
    """
    Draws custom vector line icons for the 4 institutional pillars:
    0: Engineering Excellence (Gear / Cogwheel)
    1: Innovation & Research (Robotic Arm / Lightbulb)
    2: Academic Excellence (Mortarboard / Graduation Cap)
    3: Nurturing Tomorrow (People / Community)
    """
    cx, cy = center_x, center_y
    r = 18
    draw.ellipse([(cx - r - 6, cy - r - 6), (cx + r + 6, cy + r + 6)], outline=color, width=2)

    if pillar_index == 0:
        # Gear
        draw.ellipse([(cx - 10, cy - 10), (cx + 10, cy + 10)], outline=color, width=2)
        draw.ellipse([(cx - 4, cy - 4), (cx + 4, cy + 4)], fill=color)
        for angle in range(0, 360, 45):
            rad = math.radians(angle)
            x_out = cx + math.cos(rad) * 15
            y_out = cy + math.sin(rad) * 15
            draw.line([(cx, cy), (x_out, y_out)], fill=color, width=3)
    elif pillar_index == 1:
        # Bulb / Innovation
        draw.ellipse([(cx - 8, cy - 10), (cx + 8, cy + 4)], outline=color, width=2)
        draw.line([(cx - 5, cy + 8), (cx + 5, cy + 8)], fill=color, width=2)
        draw.line([(cx - 3, cy + 12), (cx + 3, cy + 12)], fill=color, width=2)
        draw.line([(cx, cy - 14), (cx, cy - 10)], fill=color, width=2)
    elif pillar_index == 2:
        # Graduation Cap
        cap_pts = [(cx, cy - 10), (cx + 14, cy - 2), (cx, cy + 6), (cx - 14, cy - 2)]
        draw.polygon(cap_pts, outline=color, fill=(254, 243, 235), width=2)
        draw.line([(cx - 8, cy + 2), (cx - 8, cy + 10), (cx + 8, cy + 10), (cx + 8, cy + 2)], fill=color, width=2)
        draw.line([(cx + 14, cy - 2), (cx + 14, cy + 8)], fill=color, width=2)
    elif pillar_index == 3:
        # People / Nurturing
        draw.ellipse([(cx - 8 - 3, cy - 6), (cx - 8 + 3, cy)], outline=color, width=2)
        draw.ellipse([(cx + 8 - 3, cy - 6), (cx + 8 + 3, cy)], outline=color, width=2)
        draw.ellipse([(cx - 3, cy - 10), (cx + 3, cy - 4)], outline=color, width=2)
        draw.line([(cx - 12, cy + 10), (cx - 12, cy + 4), (cx - 4, cy + 4)], fill=color, width=2)
        draw.line([(cx + 12, cy + 10), (cx + 12, cy + 4), (cx + 4, cy + 4)], fill=color, width=2)
        draw.line([(cx - 6, cy + 10), (cx - 6, cy + 2), (cx + 6, cy + 2), (cx + 6, cy + 10)], fill=color, width=2)


def generate_exact_snist_qr_perfect(
    payload_str: str = "V2|1|21CS001|EXP123|MAC123",
    output_path: str = "exact_snist_qr_perfect.png"
):
    W, H = 1000, 1000
    canvas = Image.new("RGB", (W, H), (255, 255, 255))
    draw = ImageDraw.Draw(canvas)

    ORANGE = (228, 85, 14)      # SNIST Vibrant Institutional Orange #E4550E
    DARK_BG = (26, 26, 26)       # Dark Charcoal #1A1A1A
    BLACK = (12, 12, 12)
    WHITE = (255, 255, 255)
    GRAY_TEXT = (80, 80, 80)
    LIGHT_BG = (253, 240, 233)  # Soft background tint

    # 1. Tech Circuit / Corner Geometric Accents
    # Top-Left corner slash lines
    draw.polygon([(0, 0), (240, 0), (0, 240)], fill=LIGHT_BG)
    draw.line([(0, 240), (240, 0)], fill=ORANGE, width=4)
    draw.line([(0, 210), (210, 0)], fill=ORANGE, width=2)
    
    # Bottom-Right corner slash lines
    draw.polygon([(W, H - 280), (W, H), (W - 280, H)], fill=LIGHT_BG)
    draw.line([(W - 280, H), (W, H - 280)], fill=ORANGE, width=4)
    draw.line([(W - 250, H), (W, H - 250)], fill=ORANGE, width=2)

    # Circuit node lines (Top Right background decoration)
    draw.line([(W - 180, 40), (W - 40, 40)], fill=(230, 230, 230), width=2)
    draw.line([(W - 120, 40), (W - 80, 80), (W - 20, 80)], fill=(230, 230, 230), width=2)
    draw.ellipse([(W - 44, 36), (W - 36, 44)], fill=ORANGE)
    draw.ellipse([(W - 24, 76), (W - 16, 84)], fill=ORANGE)

    # 2. Header Brand Section
    try:
        font_title = ImageFont.truetype("arialbd.ttf", 52)
        font_sub1 = ImageFont.truetype("arialbd.ttf", 16)
        font_sub2 = ImageFont.truetype("arialbd.ttf", 16)
        font_url = ImageFont.truetype("arialbd.ttf", 32)
        font_footer1 = ImageFont.truetype("arialbd.ttf", 13)
        font_footer2 = ImageFont.truetype("arialbd.ttf", 13)
        font_bar = ImageFont.truetype("arialbd.ttf", 20)
    except IOError:
        font_title = ImageFont.load_default()
        font_sub1 = ImageFont.load_default()
        font_sub2 = ImageFont.load_default()
        font_url = ImageFont.load_default()
        font_footer1 = ImageFont.load_default()
        font_footer2 = ImageFont.load_default()
        font_bar = ImageFont.load_default()

    # Center Brand Header Block
    start_x = (W - 410) // 2
    shield_box = (start_x, 26, start_x + 85, 118)
    draw_snist_shield_exact(draw, shield_box, fill_color=ORANGE, flame_color=WHITE)

    text_x = start_x + 102
    draw.text((text_x, 44), "SNIST", fill=BLACK, font=font_title, anchor="lm")
    draw.text((text_x, 86), "SREENIDHI INSTITUTE OF", fill=ORANGE, font=font_sub1, anchor="lm")
    draw.text((text_x, 106), "SCIENCE AND TECHNOLOGY", fill=ORANGE, font=font_sub2, anchor="lm")

    # 3. Main QR Container Card
    card_margin = 170
    card_top = 145
    card_width = 660
    card_height = 660
    card_bbox = [(card_margin, card_top), (card_margin + card_width, card_top + card_height)]

    # Soft Card Drop Shadow
    shadow_box = [(card_margin + 4, card_top + 6), (card_margin + card_width + 4, card_top + card_height + 6)]
    draw.rounded_rectangle(shadow_box, radius=40, fill=(215, 215, 215))

    # White Card Container with Orange Border
    draw.rounded_rectangle(card_bbox, radius=40, fill=WHITE, outline=ORANGE, width=10)

    # 4. Generate High Error-Correction QR Matrix
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=1,
        border=0
    )
    qr.add_data(payload_str)
    qr.make(fit=True)

    matrix = qr.get_matrix()
    modules_count = len(matrix)

    qr_render_size = 520
    module_size = qr_render_size / modules_count

    qr_img = Image.new("RGBA", (qr_render_size, qr_render_size), (255, 255, 255, 0))
    qr_draw = ImageDraw.Draw(qr_img)

    # Reserve Center Logo area (~22% of matrix width)
    center_mod_size = int(modules_count * 0.22)
    mod_start = (modules_count - center_mod_size) // 2
    mod_end = mod_start + center_mod_size

    def is_finder(r, c):
        if r < 7 and c < 7: return True
        if r < 7 and c >= modules_count - 7: return True
        if r >= modules_count - 7 and c < 7: return True
        return False

    # Draw data modules as smooth rounded black dots
    for r in range(modules_count):
        for c in range(modules_count):
            if is_finder(r, c):
                continue
            if mod_start <= r < mod_end and mod_start <= c < mod_end:
                continue

            if matrix[r][c]:
                mx0 = c * module_size
                my0 = r * module_size
                mx1 = mx0 + module_size
                my1 = my0 + module_size
                qr_draw.rounded_rectangle([(mx0 + 0.5, my0 + 0.5), (mx1 - 0.5, my1 - 0.5)], radius=module_size * 0.35, fill=BLACK)

    # Draw Customized Orange Finder Pattern Eyes (Top-Left, Top-Right, Bottom-Left)
    finder_coords = [
        (0, 0),
        (0, modules_count - 7),
        (modules_count - 7, 0)
    ]

    for fr, fc in finder_coords:
        fx0 = fc * module_size
        fy0 = fr * module_size
        fx1 = fx0 + 7 * module_size
        fy1 = fy0 + 7 * module_size

        # Outer Orange Frame (7x7 modules)
        qr_draw.rounded_rectangle([(fx0, fy0), (fx1, fy1)], radius=module_size * 2.0, fill=ORANGE)

        # Inner White Cutout (5x5 modules)
        ix0 = fx0 + module_size
        iy0 = fy0 + module_size
        ix1 = fx1 - module_size
        iy1 = fy1 - module_size
        qr_draw.rounded_rectangle([(ix0, iy0), (ix1, iy1)], radius=module_size * 1.4, fill=WHITE)

        # Center Black Eye Dot (3x3 modules)
        cx0 = fx0 + 2 * module_size
        cy0 = fy0 + 2 * module_size
        cx1 = fx1 - 2 * module_size
        cy1 = fy1 - 2 * module_size
        qr_draw.rounded_rectangle([(cx0, cy0), (cx1, cy1)], radius=module_size * 0.9, fill=BLACK)

    # Center Logo Badge inside QR Code
    center_px = mod_start * module_size
    center_size_px = center_mod_size * module_size
    c_box = [(center_px, center_px), (center_px + center_size_px, center_px + center_size_px)]

    qr_draw.rounded_rectangle(c_box, radius=18, fill=WHITE, outline=(235, 235, 235), width=2)

    # Draw Shield inside center badge
    inner_shield = [
        center_px + center_size_px * 0.20,
        center_px + center_size_px * 0.16,
        center_px + center_size_px * 0.80,
        center_px + center_size_px * 0.84
    ]
    draw_snist_shield_exact(
        qr_draw,
        (inner_shield[0], inner_shield[1], inner_shield[2], inner_shield[3]),
        fill_color=ORANGE,
        flame_color=WHITE
    )

    # Paste QR image onto card
    qr_x = card_margin + (card_width - qr_render_size) // 2
    qr_y = card_top + 25
    canvas.paste(qr_img, (qr_x, qr_y), qr_img)

    # 5. Bottom Dark Pill Banner inside QR Card Container
    banner_y = card_top + card_height - 86
    banner_h = 76

    # Dark Charcoal Pill Background for website URL
    pill_box = [(card_margin + 12, banner_y), (card_margin + card_width - 100, banner_y + banner_h)]
    draw.rounded_rectangle(pill_box, radius=38, fill=DARK_BG)

    # Globe Icon (Left inside dark pill)
    globe_cx = card_margin + 54
    globe_cy = banner_y + banner_h / 2
    draw.ellipse([(globe_cx - 24, globe_cy - 24), (globe_cx + 24, globe_cy + 24)], fill=ORANGE)
    draw.ellipse([(globe_cx - 15, globe_cy - 15), (globe_cx + 15, globe_cy + 15)], outline=WHITE, width=2)
    draw.line([(globe_cx - 15, globe_cy), (globe_cx + 15, globe_cy)], fill=WHITE, width=2)
    draw.line([(globe_cx, globe_cy - 15), (globe_cx, globe_cy + 15)], fill=WHITE, width=2)

    # URL Text `sreenidhi.edu.in`
    draw.text((card_margin + 94, banner_y + banner_h / 2), "sreenidhi.edu.in", fill=WHITE, font=font_url, anchor="lm")

    # Right Orange Chevron Shape
    chev_pts = [
        (card_margin + card_width - 110, banner_y),
        (card_margin + card_width - 10, banner_y),
        (card_margin + card_width - 10, banner_y + banner_h),
        (card_margin + card_width - 145, banner_y + banner_h),
    ]
    draw.polygon(chev_pts, fill=ORANGE)

    # White Right Arrow Chevron '>'
    arr_cx = card_margin + card_width - 52
    arr_cy = banner_y + banner_h / 2
    draw.line([(arr_cx - 8, arr_cy - 12), (arr_cx + 6, arr_cy), (arr_cx - 8, arr_cy + 12)], fill=WHITE, width=5)

    # 6. Bottom Institutional 4 Pillars Section
    p_y = card_top + card_height + 25
    pillar_w = W / 4

    pillars = [
        ("ENGINEERING", "EXCELLENCE"),
        ("INNOVATION", "& RESEARCH"),
        ("ACADEMIC", "EXCELLENCE"),
        ("NURTURING", "TOMORROW")
    ]

    for idx, (line1, line2) in enumerate(pillars):
        px = idx * pillar_w + pillar_w / 2
        draw_pillar_icon(draw, px, p_y + 22, idx, color=ORANGE)

        draw.text((px, p_y + 54), line1, fill=BLACK, font=font_footer1, anchor="mm")
        draw.text((px, p_y + 70), line2, fill=BLACK, font=font_footer2, anchor="mm")

        # Divider line between pillars
        if idx < 3:
            div_x = (idx + 1) * pillar_w
            draw.line([(div_x, p_y + 10), (div_x, p_y + 70)], fill=(225, 225, 225), width=1)

    # 7. Bottom Solid Orange Bar
    bar_y = H - 55
    draw.rectangle([(0, bar_y), (W, H)], fill=ORANGE)
    draw.text((W // 2, bar_y + 28), "///   LEARN   •   INNOVATE   •   EXCEL   ///", fill=WHITE, font=font_bar, anchor="mm")

    canvas.save(output_path, quality=95)
    print(f"Generated perfect SNIST QR poster at: {output_path}")

if __name__ == "__main__":
    generate_exact_snist_qr_perfect()
