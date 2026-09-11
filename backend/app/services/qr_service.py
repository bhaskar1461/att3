import io
import os
import json
import math
import base64
import zipfile
import qrcode
from PIL import Image, ImageDraw, ImageFont
from typing import Dict, Any, List, Optional

from datetime import datetime
from app.core.security import (
    generate_encrypted_qr_payload, 
    generate_encrypted_qr_payload_v2,
    decrypt_and_validate_qr_payload,
    get_server_ist_date
)
from app.core.config import settings

class QRService:
    @staticmethod
    def _compact_payload(payload_dict: Dict[str, Any]) -> str:
        """
        Creates a compact QR string from V1 encrypted payload.
        Format: SNIST|studentId|rollNumber|encryptedToken|checksum|timestamp
        """
        parts = [
            "SNIST",
            str(payload_dict["studentId"]),
            payload_dict["rollNumber"],
            payload_dict["encryptedToken"],
            payload_dict["checksum"],
            str(payload_dict["t"])
        ]
        return "|".join(parts)

    @staticmethod
    def _expand_compact_payload(compact_str: str) -> str:
        parts = compact_str.split("|")
        if len(parts) == 6 and parts[0] == "SNIST":
            payload = {
                "studentId": int(parts[1]),
                "rollNumber": parts[2],
                "encryptedToken": parts[3],
                "checksum": parts[4],
                "t": int(parts[5])
            }
            return json.dumps(payload)
        return compact_str

    @staticmethod
    def _add_center_snist_badge(qr_img: Image.Image) -> Image.Image:
        """
        Embeds an official SNIST center badge overlay into the high-error-correction QR code.
        """
        qr_rgba = qr_img.convert("RGBA")
        w, h = qr_rgba.size
        
        # Badge takes ~20% of total QR size
        badge_size = int(w * 0.20)
        x = (w - badge_size) // 2
        y = (h - badge_size) // 2
        
        badge = Image.new("RGBA", (badge_size, badge_size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(badge)
        
        # White background box with SNIST orange border
        draw.rounded_rectangle(
            [(0, 0), (badge_size - 1, badge_size - 1)], 
            radius=max(6, int(badge_size * 0.2)), 
            fill=(255, 255, 255, 255), 
            outline=(234, 88, 12, 255), 
            width=3
        )
        
        try:
            font_badge = ImageFont.truetype("arialbd.ttf", int(badge_size * 0.28))
        except IOError:
            try:
                font_badge = ImageFont.truetype("arial.ttf", int(badge_size * 0.28))
            except IOError:
                font_badge = ImageFont.load_default()
            
        # Centered SNIST text in navy blue
        draw.text((badge_size // 2, badge_size // 2), "SNIST", fill=(21, 52, 126, 255), font=font_badge, anchor="mm")
        
        qr_rgba.paste(badge, (x, y), badge)
        return qr_rgba.convert("RGB")

    @staticmethod
    def _draw_snist_shield_exact(draw: ImageDraw.ImageDraw, bbox: tuple, fill_color=(228, 85, 14), flame_color=(255, 255, 255)):
        x0, y0, x1, y1 = bbox
        w = x1 - x0
        h = y1 - y0
        cx = x0 + w / 2

        r = w * 0.22
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

        f1 = [
            (x0 + w * 0.26, y0 + h * 0.62),
            (x0 + w * 0.38, y0 + h * 0.40),
            (x0 + w * 0.46, y0 + h * 0.28),
            (x0 + w * 0.40, y0 + h * 0.46),
            (x0 + w * 0.32, y0 + h * 0.68),
        ]
        f2 = [
            (x0 + w * 0.42, y0 + h * 0.72),
            (x0 + w * 0.56, y0 + h * 0.35),
            (x0 + w * 0.64, y0 + h * 0.18),
            (x0 + w * 0.58, y0 + h * 0.38),
            (x0 + w * 0.48, y0 + h * 0.76),
        ]
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

    @staticmethod
    def _draw_pillar_icon(draw: ImageDraw.ImageDraw, center_x: float, center_y: float, pillar_index: int, color=(228, 85, 14)):
        cx, cy = center_x, center_y
        r = 18
        draw.ellipse([(cx - r - 6, cy - r - 6), (cx + r + 6, cy + r + 6)], outline=color, width=2)

        if pillar_index == 0:
            draw.ellipse([(cx - 10, cy - 10), (cx + 10, cy + 10)], outline=color, width=2)
            draw.ellipse([(cx - 4, cy - 4), (cx + 4, cy + 4)], fill=color)
            for angle in range(0, 360, 45):
                rad = math.radians(angle)
                x_out = cx + math.cos(rad) * 15
                y_out = cy + math.sin(rad) * 15
                draw.line([(cx, cy), (x_out, y_out)], fill=color, width=3)
        elif pillar_index == 1:
            draw.ellipse([(cx - 8, cy - 10), (cx + 8, cy + 4)], outline=color, width=2)
            draw.line([(cx - 5, cy + 8), (cx + 5, cy + 8)], fill=color, width=2)
            draw.line([(cx - 3, cy + 12), (cx + 3, cy + 12)], fill=color, width=2)
            draw.line([(cx, cy - 14), (cx, cy - 10)], fill=color, width=2)
        elif pillar_index == 2:
            cap_pts = [(cx, cy - 10), (cx + 14, cy - 2), (cx, cy + 6), (cx - 14, cy - 2)]
            draw.polygon(cap_pts, outline=color, fill=(254, 243, 235), width=2)
            draw.line([(cx - 8, cy + 2), (cx - 8, cy + 10), (cx + 8, cy + 10), (cx + 8, cy + 2)], fill=color, width=2)
            draw.line([(cx + 14, cy - 2), (cx + 14, cy + 8)], fill=color, width=2)
        elif pillar_index == 3:
            draw.ellipse([(cx - 8 - 3, cy - 6), (cx - 8 + 3, cy)], outline=color, width=2)
            draw.ellipse([(cx + 8 - 3, cy - 6), (cx + 8 + 3, cy)], outline=color, width=2)
            draw.ellipse([(cx - 3, cy - 10), (cx + 3, cy - 4)], outline=color, width=2)
            draw.line([(cx - 12, cy + 10), (cx - 12, cy + 4), (cx - 4, cy + 4)], fill=color, width=2)
            draw.line([(cx + 12, cy + 10), (cx + 12, cy + 4), (cx + 4, cy + 4)], fill=color, width=2)
            draw.line([(cx - 6, cy + 10), (cx - 6, cy + 2), (cx + 6, cy + 2), (cx + 6, cy + 10)], fill=color, width=2)

    @staticmethod
    def generate_student_qr_code(
        student_id: int, 
        roll_number: str, 
        student_name: str = "",
        department: str = "",
        attendance_date: Optional[str] = None,
        use_v2: bool = True,
        as_base64: bool = True
    ) -> str:
        """
        Generates official SNIST QR poster card with ultra-compact date-bound V2 payload,
        customized orange finder patterns, center SNIST flame logo, and visible date badge.
        """
        if not attendance_date:
            attendance_date = get_server_ist_date()

        if use_v2:
            qr_payload = generate_encrypted_qr_payload_v2(student_id, roll_number, attendance_date=attendance_date)
        else:
            payload_dict = generate_encrypted_qr_payload(student_id, roll_number, attendance_date=attendance_date)
            qr_payload = QRService._compact_payload(payload_dict)

        W, H = 1000, 1000
        canvas = Image.new("RGB", (W, H), (255, 255, 255))
        draw = ImageDraw.Draw(canvas)

        ORANGE = (228, 85, 14)
        DARK_BG = (26, 26, 26)
        BLACK = (12, 12, 12)
        WHITE = (255, 255, 255)
        LIGHT_BG = (253, 240, 233)

        # 1. Corner Tech Slash Accents
        draw.polygon([(0, 0), (240, 0), (0, 240)], fill=LIGHT_BG)
        draw.line([(0, 240), (240, 0)], fill=ORANGE, width=4)
        draw.line([(0, 210), (210, 0)], fill=ORANGE, width=2)
        
        draw.polygon([(W, H - 280), (W, H), (W - 280, H)], fill=LIGHT_BG)
        draw.line([(W - 280, H), (W, H - 280)], fill=ORANGE, width=4)
        draw.line([(W - 250, H), (W, H - 250)], fill=ORANGE, width=2)

        # Circuit node decor
        draw.line([(W - 180, 40), (W - 40, 40)], fill=(230, 230, 230), width=2)
        draw.line([(W - 120, 40), (W - 80, 80), (W - 20, 80)], fill=(230, 230, 230), width=2)
        draw.ellipse([(W - 44, 36), (W - 36, 44)], fill=ORANGE)
        draw.ellipse([(W - 24, 76), (W - 16, 84)], fill=ORANGE)

        # 2. Typography
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
        QRService._draw_snist_shield_exact(draw, shield_box, fill_color=ORANGE, flame_color=WHITE)

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

        shadow_box = [(card_margin + 4, card_top + 6), (card_margin + card_width + 4, card_top + card_height + 6)]
        draw.rounded_rectangle(shadow_box, radius=40, fill=(215, 215, 215))
        draw.rounded_rectangle(card_bbox, radius=40, fill=WHITE, outline=ORANGE, width=10)

        # 4. QR Code Matrix Generation with Quiet Zone & High Contrast
        qr = qrcode.QRCode(
            version=None,
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=1,
            border=4
        )
        qr.add_data(qr_payload)
        qr.make(fit=True)

        matrix = qr.get_matrix()
        modules_count = len(matrix)

        qr_render_size = 520
        module_size = qr_render_size / modules_count

        qr_img = Image.new("RGBA", (qr_render_size, qr_render_size), (255, 255, 255, 255))
        qr_draw = ImageDraw.Draw(qr_img)

        center_mod_size = int(modules_count * 0.16)
        mod_start = (modules_count - center_mod_size) // 2
        mod_end = mod_start + center_mod_size

        def is_finder(r, c):
            if r < 7 and c < 7: return True
            if r < 7 and c >= modules_count - 7: return True
            if r >= modules_count - 7 and c < 7: return True
            return False

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
                    qr_draw.rectangle([(mx0, my0), (mx1, my1)], fill=BLACK)

        finder_coords = [
            (0, 0),
            (0, modules_count - 7),
            (modules_count - 7, 0)
        ]

        # Standard High-Contrast Black & White Finder Patterns
        for fr, fc in finder_coords:
            fx0 = fc * module_size
            fy0 = fr * module_size
            fx1 = fx0 + 7 * module_size
            fy1 = fy0 + 7 * module_size

            qr_draw.rectangle([(fx0, fy0), (fx1, fy1)], fill=BLACK)

            ix0 = fx0 + module_size
            iy0 = fy0 + module_size
            ix1 = fx1 - module_size
            iy1 = fy1 - module_size
            qr_draw.rectangle([(ix0, iy0), (ix1, iy1)], fill=WHITE)

            cx0 = fx0 + 2 * module_size
            cy0 = fy0 + 2 * module_size
            cx1 = fx1 - 2 * module_size
            cy1 = fy1 - 2 * module_size
            qr_draw.rectangle([(cx0, cy0), (cx1, cy1)], fill=BLACK)

        center_px = mod_start * module_size
        center_size_px = center_mod_size * module_size
        c_box = [(center_px, center_px), (center_px + center_size_px, center_px + center_size_px)]

        qr_draw.rounded_rectangle(c_box, radius=8, fill=WHITE, outline=(220, 220, 220), width=2)

        inner_shield = [
            center_px + center_size_px * 0.20,
            center_px + center_size_px * 0.16,
            center_px + center_size_px * 0.80,
            center_px + center_size_px * 0.84
        ]
        QRService._draw_snist_shield_exact(
            qr_draw,
            (inner_shield[0], inner_shield[1], inner_shield[2], inner_shield[3]),
            fill_color=ORANGE,
            flame_color=WHITE
        )

        qr_x = card_margin + (card_width - qr_render_size) // 2
        qr_y = card_top + 20
        canvas.paste(qr_img, (qr_x, qr_y), qr_img)

        # 4b. Draw Visibly Displayed Attendance Date below QR Code
        try:
            font_date = ImageFont.truetype("arialbd.ttf", 26)
        except IOError:
            font_date = ImageFont.load_default()

        try:
            dt_obj = datetime.strptime(attendance_date, "%Y-%m-%d")
            formatted_date_str = dt_obj.strftime("%d %b %Y").upper()
        except Exception:
            formatted_date_str = str(attendance_date).upper()

        date_y = qr_y + qr_render_size + 8
        draw.text((W // 2, date_y), formatted_date_str, fill=ORANGE, font=font_date, anchor="mm")

        # 5. Bottom Dark Pill Banner inside QR Card Container
        banner_y = card_top + card_height - 86
        banner_h = 76

        pill_box = [(card_margin + 12, banner_y), (card_margin + card_width - 100, banner_y + banner_h)]
        draw.rounded_rectangle(pill_box, radius=38, fill=DARK_BG)

        globe_cx = card_margin + 54
        globe_cy = banner_y + banner_h / 2
        draw.ellipse([(globe_cx - 24, globe_cy - 24), (globe_cx + 24, globe_cy + 24)], fill=ORANGE)
        draw.ellipse([(globe_cx - 15, globe_cy - 15), (globe_cx + 15, globe_cy + 15)], outline=WHITE, width=2)
        draw.line([(globe_cx - 15, globe_cy), (globe_cx + 15, globe_cy)], fill=WHITE, width=2)
        draw.line([(globe_cx, globe_cy - 15), (globe_cx, globe_cy + 15)], fill=WHITE, width=2)

        draw.text((card_margin + 94, banner_y + banner_h / 2), "sreenidhi.edu.in", fill=WHITE, font=font_url, anchor="lm")

        chev_pts = [
            (card_margin + card_width - 110, banner_y),
            (card_margin + card_width - 10, banner_y),
            (card_margin + card_width - 10, banner_y + banner_h),
            (card_margin + card_width - 145, banner_y + banner_h),
        ]
        draw.polygon(chev_pts, fill=ORANGE)

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
            QRService._draw_pillar_icon(draw, px, p_y + 22, idx, color=ORANGE)

            draw.text((px, p_y + 54), line1, fill=BLACK, font=font_footer1, anchor="mm")
            draw.text((px, p_y + 70), line2, fill=BLACK, font=font_footer2, anchor="mm")

            if idx < 3:
                div_x = (idx + 1) * pillar_w
                draw.line([(div_x, p_y + 10), (div_x, p_y + 70)], fill=(225, 225, 225), width=1)

        # 7. Bottom Solid Orange Bar
        bar_y = H - 55
        draw.rectangle([(0, bar_y), (W, H)], fill=ORANGE)
        draw.text((W // 2, bar_y + 28), "///   LEARN   •   INNOVATE   •   EXCEL   ///", fill=WHITE, font=font_bar, anchor="mm")

        # Output to buffer
        buffer = io.BytesIO()
        canvas.save(buffer, format="PNG", quality=95)
        buffer.seek(0)
        img_bytes = buffer.getvalue()

        if as_base64:
            b64_str = base64.b64encode(img_bytes).decode('utf-8')
            return f"data:image/png;base64,{b64_str}"
        return img_bytes

    @staticmethod
    def validate_scanned_qr(qr_string: str) -> Dict[str, Any]:
        """
        Validates QR payload across V2, V1 compact, and JSON formats.
        """
        return decrypt_and_validate_qr_payload(qr_string)

    @classmethod
    def generate_bulk_qr_zip(cls, student_list: List[Dict[str, Any]]) -> bytes:
        """
        Generates a zip file containing QR pass cards for multiple students.
        """
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            for s in student_list:
                s_id = s.get("id", 0)
                roll = s.get("roll_number", "UNKNOWN")
                name = s.get("name", "")
                dept = s.get("department", "")
                img_bytes = cls.generate_student_qr_code(s_id, roll, name, dept, as_base64=False)
                zip_file.writestr(f"QR_{roll}.png", img_bytes)
        zip_buffer.seek(0)
        return zip_buffer.getvalue()

    @staticmethod
    def generate_pure_qr_code(
        student_id: int, 
        roll_number: str, 
        attendance_date: Optional[str] = None,
        as_base64: bool = True
    ) -> str:
        """
        Generates a pure, high-contrast black & white QR code matrix optimized specifically for 
        instant camera detection on student mobile screens (no poster graphics or center logo overwriting).
        """
        if not attendance_date:
            attendance_date = get_server_ist_date()

        qr_payload = generate_encrypted_qr_payload_v2(student_id, roll_number, attendance_date=attendance_date)

        qr = qrcode.QRCode(
            version=None,
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=12,
            border=4
        )
        qr.add_data(qr_payload)
        qr.make(fit=True)

        img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
        
        buffer = io.BytesIO()
        img.save(buffer, format="PNG", quality=100)
        buffer.seek(0)
        img_bytes = buffer.getvalue()

        if as_base64:
            b64_str = base64.b64encode(img_bytes).decode('utf-8')
            return f"data:image/png;base64,{b64_str}"
        return img_bytes

    @staticmethod
    def generate_projector_qr_code(
        payload: str,
        as_base64: bool = True
    ) -> str:
        """
        Generates an extra-large, ultra-high-contrast QR matrix specifically designed for
        lecture hall projectors and long-distance smartphone camera scanning.
        """
        qr = qrcode.QRCode(
            version=None,
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=28,
            border=4
        )
        qr.add_data(payload)
        qr.make(fit=True)

        img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
        
        buffer = io.BytesIO()
        img.save(buffer, format="PNG", quality=100)
        buffer.seek(0)
        img_bytes = buffer.getvalue()

        if as_base64:
            b64_str = base64.b64encode(img_bytes).decode('utf-8')
            return f"data:image/png;base64,{b64_str}"
        return img_bytes




