import io
import os
import json
import base64
import zipfile
import qrcode
from PIL import Image, ImageDraw, ImageFont
from typing import Dict, Any, List, Optional

from app.core.security import (
    generate_encrypted_qr_payload, 
    generate_encrypted_qr_payload_v2,
    decrypt_and_validate_qr_payload
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
    def generate_student_qr_code(
        student_id: int, 
        roll_number: str, 
        student_name: str = "",
        department: str = "",
        use_v2: bool = True,
        as_base64: bool = True
    ) -> str:
        """
        Generates ultra-compact V2 payload, applies High Error Correction (Level H), 
        embeds SNIST center branding, and renders a high-res 600x750 student pass card.
        """
        if use_v2:
            qr_payload = generate_encrypted_qr_payload_v2(student_id, roll_number)
        else:
            payload_dict = generate_encrypted_qr_payload(student_id, roll_number)
            qr_payload = QRService._compact_payload(payload_dict)

        # Generate QR matrix with ERROR_CORRECT_H (30% error correction capacity)
        qr = qrcode.QRCode(
            version=None,
            error_correction=qrcode.constants.ERROR_CORRECT_H,
            box_size=14,
            border=3,
        )
        qr.add_data(qr_payload)
        qr.make(fit=True)

        qr_raw_img = qr.make_image(fill_color="#15347e", back_color="white").convert('RGB')
        qr_branded_img = QRService._add_center_snist_badge(qr_raw_img)

        # Build Premium Student Pass Card Canvas (600 x 750 px)
        card_width = 600
        card_height = 750
        card = Image.new('RGB', (card_width, card_height), color=(255, 255, 255))
        draw = ImageDraw.Draw(card)

        # Top Header Banner - SNIST Deep Navy
        draw.rectangle([(0, 0), (card_width, 85)], fill=(21, 52, 126))
        draw.rectangle([(0, 85), (card_width, 90)], fill=(234, 88, 12)) # Orange Accent Bar

        try:
            font_header = ImageFont.truetype("arialbd.ttf", 20)
            font_sub_header = ImageFont.truetype("arial.ttf", 13)
            font_title = ImageFont.truetype("arialbd.ttf", 22)
            font_sub = ImageFont.truetype("arial.ttf", 15)
        except IOError:
            font_header = ImageFont.load_default()
            font_sub_header = ImageFont.load_default()
            font_title = ImageFont.load_default()
            font_sub = ImageFont.load_default()

        draw.text((card_width // 2, 30), "SREENIDHI INSTITUTE OF SCIENCE & TECH", fill=(255, 255, 255), font=font_header, anchor="mm")
        draw.text((card_width // 2, 60), "OFFICIAL DIGITAL ATTENDANCE PASS", fill=(254, 215, 170), font=font_sub_header, anchor="mm")

        # QR Code Frame (occupies ~80% of card width = 480x480)
        qr_display_size = 480
        qr_resized = qr_branded_img.resize((qr_display_size, qr_display_size), Image.Resampling.NEAREST)
        x_offset = (card_width - qr_display_size) // 2
        card.paste(qr_resized, (x_offset, 110))

        # Bottom Info Box
        banner_y = 605
        draw.rounded_rectangle([(25, banner_y), (card_width - 25, card_height - 25)], radius=14, outline=(226, 232, 240), fill=(248, 250, 252), width=2)
        
        draw.text((45, banner_y + 18), f"ROLL NO: {roll_number.upper()}", fill=(15, 23, 42), font=font_title)
        if student_name:
            draw.text((45, banner_y + 52), f"STUDENT: {student_name[:32]}", fill=(51, 65, 85), font=font_sub)
        if department:
            draw.text((45, banner_y + 78), f"DEPT: {department.upper()}", fill=(71, 85, 105), font=font_sub)
        
        # Security Verification Badge
        draw.rectangle([(card_width - 220, banner_y + 75), (card_width - 45, banner_y + 105)], fill=(234, 88, 12))
        draw.text((card_width - 132, banner_y + 90), "V2 SECURE ENCRYPTED", fill=(255, 255, 255), font=font_sub_header, anchor="mm")

        # Output to buffer
        buffer = io.BytesIO()
        card.save(buffer, format="PNG", quality=95)
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

