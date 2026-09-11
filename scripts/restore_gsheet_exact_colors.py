import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.services.gsheets_service import GoogleSheetsService
from app.core.config import settings

def hex_to_rgb(hex_str: str):
    h = hex_str.lstrip('#').upper()
    if len(h) == 8: # ARGB
        h = h[2:]
    return {
        "red": int(h[0:2], 16) / 255.0,
        "green": int(h[2:4], 16) / 255.0,
        "blue": int(h[4:6], 16) / 255.0
    }

def restore_exact_formatting():
    creds = settings.GOOGLE_CREDENTIALS_FILE or os.path.join(BACKEND_DIR, "credentials.json")
    sheet_id = "1CDeeivsdptGtgJpgK6XN9o6AKqy6HAIucv45D0Os6ZY"

    print(f"Connecting to Google Sheet {sheet_id}...")
    client = GoogleSheetsService._get_client(creds)
    sh = client.open_by_key(sheet_id)
    ws = sh.worksheet("CSE-CS")
    sheet_meta_id = ws.id

    vals = ws.get_all_values()
    num_rows = len(vals)
    num_cols = max(len(r) for r in vals)
    print(f"Sheet dimensions: {num_rows} rows x {num_cols} columns")

    # Locate Total column index in Row 6 (vals[5])
    total_col_idx = num_cols - 1
    for c_idx in range(4, len(vals[5])):
        if str(vals[5][c_idx]).strip().lower() == "total":
            total_col_idx = c_idx
            break

    # Exact colors from original college template
    c_row1 = hex_to_rgb("C6D9F0") # Soft pastel blue
    c_row2 = hex_to_rgb("FDE9D9") # Soft peach
    c_row3 = hex_to_rgb("DAEEF3") # Soft cyan
    c_row4 = hex_to_rgb("B8CCE4") # Soft blue
    c_row5_left = hex_to_rgb("FDE9D9") # Soft peach
    c_row5_dates = hex_to_rgb("A4C2F4") # Soft periwinkle/blue
    c_yellow = hex_to_rgb("FFFF00") # Bright yellow (SNO, ROLL NO, NAME, GENDER, Total)
    c_sec_blue = hex_to_rgb("A4C2F4") # Soft blue for Section column
    c_white = {"red": 1.0, "green": 1.0, "blue": 1.0}
    c_black = {"red": 0.0, "green": 0.0, "blue": 0.0}

    # Date header colors matching exact date ranges
    c_soft_yellow = hex_to_rgb("FFF2CC")
    c_soft_green = hex_to_rgb("B6D7A8")
    c_soft_teal = hex_to_rgb("A2C4C9")
    c_soft_cyan = hex_to_rgb("D0E0E3")

    requests = []

    # 1. Unmerge any accidental full-width row 1-5 merges, then merge A1:E1, A2:E2, A3:E3, A4:E4, A5:E5
    requests.append({
        "unmergeCells": {
            "range": {
                "sheetId": sheet_meta_id,
                "startRowIndex": 0,
                "endRowIndex": 5,
                "startColumnIndex": 0,
                "endColumnIndex": num_cols
            }
        }
    })

    # Merge A1:E1, A2:E2, A3:E3, A4:E4, A5:E5 (only within frozen columns A-E to respect freeze boundaries!)
    for r in range(5):
        requests.append({
            "mergeCells": {
                "range": {
                    "sheetId": sheet_meta_id,
                    "startRowIndex": r,
                    "endRowIndex": r + 1,
                    "startColumnIndex": 0,
                    "endColumnIndex": 5
                },
                "mergeType": "MERGE_ALL"
            }
        })

    # Row 1 format: A1:E1 Soft pastel blue, black bold text
    requests.append({
        "repeatCell": {
            "range": {"sheetId": sheet_meta_id, "startRowIndex": 0, "endRowIndex": 1, "startColumnIndex": 0, "endColumnIndex": 5},
            "cell": {
                "userEnteredFormat": {
                    "backgroundColor": c_row1,
                    "textFormat": {"bold": True, "fontSize": 12, "foregroundColor": c_black, "fontFamily": "Calibri"},
                    "horizontalAlignment": "CENTER",
                    "verticalAlignment": "MIDDLE"
                }
            },
            "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
        }
    })
    # Row 1 background for remaining columns F+: white/clear
    requests.append({
        "repeatCell": {
            "range": {"sheetId": sheet_meta_id, "startRowIndex": 0, "endRowIndex": 1, "startColumnIndex": 5, "endColumnIndex": num_cols},
            "cell": {
                "userEnteredFormat": {
                    "backgroundColor": c_white,
                    "textFormat": {"foregroundColor": c_black}
                }
            },
            "fields": "userEnteredFormat(backgroundColor,textFormat)"
        }
    })

    # Row 2 format: A2:E2 Soft peach, black bold text
    requests.append({
        "repeatCell": {
            "range": {"sheetId": sheet_meta_id, "startRowIndex": 1, "endRowIndex": 2, "startColumnIndex": 0, "endColumnIndex": 5},
            "cell": {
                "userEnteredFormat": {
                    "backgroundColor": c_row2,
                    "textFormat": {"bold": True, "fontSize": 11, "foregroundColor": c_black, "fontFamily": "Calibri"},
                    "horizontalAlignment": "CENTER",
                    "verticalAlignment": "MIDDLE"
                }
            },
            "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
        }
    })
    requests.append({
        "repeatCell": {
            "range": {"sheetId": sheet_meta_id, "startRowIndex": 1, "endRowIndex": 2, "startColumnIndex": 5, "endColumnIndex": num_cols},
            "cell": {"userEnteredFormat": {"backgroundColor": c_white}},
            "fields": "userEnteredFormat(backgroundColor)"
        }
    })

    # Row 3 format: A3:E3 Soft cyan, black bold text
    requests.append({
        "repeatCell": {
            "range": {"sheetId": sheet_meta_id, "startRowIndex": 2, "endRowIndex": 3, "startColumnIndex": 0, "endColumnIndex": 5},
            "cell": {
                "userEnteredFormat": {
                    "backgroundColor": c_row3,
                    "textFormat": {"bold": True, "fontSize": 11, "foregroundColor": c_black, "fontFamily": "Calibri"},
                    "horizontalAlignment": "CENTER",
                    "verticalAlignment": "MIDDLE"
                }
            },
            "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
        }
    })
    requests.append({
        "repeatCell": {
            "range": {"sheetId": sheet_meta_id, "startRowIndex": 2, "endRowIndex": 3, "startColumnIndex": 5, "endColumnIndex": num_cols},
            "cell": {"userEnteredFormat": {"backgroundColor": c_white}},
            "fields": "userEnteredFormat(backgroundColor)"
        }
    })

    # Row 4 format: A4:E4 Soft blue, black bold text
    requests.append({
        "repeatCell": {
            "range": {"sheetId": sheet_meta_id, "startRowIndex": 3, "endRowIndex": 4, "startColumnIndex": 0, "endColumnIndex": 5},
            "cell": {
                "userEnteredFormat": {
                    "backgroundColor": c_row4,
                    "textFormat": {"bold": True, "fontSize": 10, "foregroundColor": c_black, "fontFamily": "Calibri"},
                    "horizontalAlignment": "CENTER",
                    "verticalAlignment": "MIDDLE",
                    "wrapStrategy": "WRAP"
                }
            },
            "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)"
        }
    })
    # Row 4 Conducted periods (Col F onwards): white background, centered bold black text
    requests.append({
        "repeatCell": {
            "range": {"sheetId": sheet_meta_id, "startRowIndex": 3, "endRowIndex": 4, "startColumnIndex": 5, "endColumnIndex": num_cols},
            "cell": {
                "userEnteredFormat": {
                    "backgroundColor": c_white,
                    "textFormat": {"bold": True, "fontSize": 10, "foregroundColor": c_black, "fontFamily": "Calibri"},
                    "horizontalAlignment": "CENTER",
                    "verticalAlignment": "MIDDLE"
                }
            },
            "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
        }
    })

    # Row 5 format: A5:E5 Soft peach, black bold text
    requests.append({
        "repeatCell": {
            "range": {"sheetId": sheet_meta_id, "startRowIndex": 4, "endRowIndex": 5, "startColumnIndex": 0, "endColumnIndex": 5},
            "cell": {
                "userEnteredFormat": {
                    "backgroundColor": c_row5_left,
                    "textFormat": {"bold": True, "fontSize": 10, "foregroundColor": c_black, "fontFamily": "Calibri"},
                    "horizontalAlignment": "CENTER",
                    "verticalAlignment": "MIDDLE"
                }
            },
            "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
        }
    })
    # Row 5 Col F onwards: Soft periwinkle/blue background (#A4C2F4)
    requests.append({
        "repeatCell": {
            "range": {"sheetId": sheet_meta_id, "startRowIndex": 4, "endRowIndex": 5, "startColumnIndex": 5, "endColumnIndex": num_cols},
            "cell": {
                "userEnteredFormat": {
                    "backgroundColor": c_row5_dates,
                    "textFormat": {"bold": True, "fontSize": 10, "foregroundColor": c_black}
                }
            },
            "fields": "userEnteredFormat(backgroundColor,textFormat)"
        }
    })

    # Row 6 Headers:
    # Col A-D (SNO, ROLL NO, NAME, GENDER): BRIGHT YELLOW (#FFFF00), black bold
    requests.append({
        "repeatCell": {
            "range": {"sheetId": sheet_meta_id, "startRowIndex": 5, "endRowIndex": 6, "startColumnIndex": 0, "endColumnIndex": 4},
            "cell": {
                "userEnteredFormat": {
                    "backgroundColor": c_yellow,
                    "textFormat": {"bold": True, "fontSize": 10, "foregroundColor": c_black, "fontFamily": "Calibri"},
                    "horizontalAlignment": "CENTER",
                    "verticalAlignment": "MIDDLE"
                }
            },
            "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
        }
    })

    # Col E (SECTION): SOFT BLUE (#A4C2F4), black bold
    requests.append({
        "repeatCell": {
            "range": {"sheetId": sheet_meta_id, "startRowIndex": 5, "endRowIndex": 6, "startColumnIndex": 4, "endColumnIndex": 5},
            "cell": {
                "userEnteredFormat": {
                    "backgroundColor": c_sec_blue,
                    "textFormat": {"bold": True, "fontSize": 10, "foregroundColor": c_black, "fontFamily": "Calibri"},
                    "horizontalAlignment": "CENTER",
                    "verticalAlignment": "MIDDLE"
                }
            },
            "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
        }
    })

    # Date headers (Col F onwards up to Total):
    # June dates: soft yellow/green
    # July dates: soft green
    # 07/09/2026: Soft green (#B6D7A8)
    # Total: Bright yellow (#FFFF00)
    row6 = vals[5]
    for c_idx in range(5, num_cols):
        h_val = str(row6[c_idx]).strip().upper() if c_idx < len(row6) else ""
        if "TOTAL" in h_val:
            bg = c_yellow
        elif any(k in h_val for k in ["27/07", "28/07", "29/07", "22/06", "23/06", "24/06", "07/09"]):
            bg = c_soft_green
        elif any(k in h_val for k in ["29/06", "30/06", "01/07"]):
            bg = c_soft_teal
        elif any(k in h_val for k in ["14/07", "15/07"]):
            bg = c_soft_cyan
        else:
            bg = c_soft_yellow

        requests.append({
            "repeatCell": {
                "range": {"sheetId": sheet_meta_id, "startRowIndex": 5, "endRowIndex": 6, "startColumnIndex": c_idx, "endColumnIndex": c_idx + 1},
                "cell": {
                    "userEnteredFormat": {
                        "backgroundColor": bg,
                        "textFormat": {"bold": True, "fontSize": 10, "foregroundColor": c_black, "fontFamily": "Calibri"},
                        "horizontalAlignment": "CENTER",
                        "verticalAlignment": "MIDDLE"
                    }
                },
                "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
            }
        })

    # Student Data Rows (Rows 7 onwards):
    # Col A (SNO): white, centered, black text
    requests.append({
        "repeatCell": {
            "range": {"sheetId": sheet_meta_id, "startRowIndex": 6, "endRowIndex": num_rows, "startColumnIndex": 0, "endColumnIndex": 1},
            "cell": {
                "userEnteredFormat": {
                    "backgroundColor": c_white,
                    "textFormat": {"bold": False, "fontSize": 10, "foregroundColor": c_black, "fontFamily": "Calibri"},
                    "horizontalAlignment": "CENTER",
                    "verticalAlignment": "MIDDLE"
                }
            },
            "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
        }
    })

    # Col B (ROLL NO): white, centered, black text
    requests.append({
        "repeatCell": {
            "range": {"sheetId": sheet_meta_id, "startRowIndex": 6, "endRowIndex": num_rows, "startColumnIndex": 1, "endColumnIndex": 2},
            "cell": {
                "userEnteredFormat": {
                    "backgroundColor": c_white,
                    "textFormat": {"bold": False, "fontSize": 10, "foregroundColor": c_black, "fontFamily": "Calibri"},
                    "horizontalAlignment": "CENTER",
                    "verticalAlignment": "MIDDLE"
                }
            },
            "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
        }
    })

    # Col C (NAME): white, LEFT-ALIGNED, black text
    requests.append({
        "repeatCell": {
            "range": {"sheetId": sheet_meta_id, "startRowIndex": 6, "endRowIndex": num_rows, "startColumnIndex": 2, "endColumnIndex": 3},
            "cell": {
                "userEnteredFormat": {
                    "backgroundColor": c_white,
                    "textFormat": {"bold": False, "fontSize": 10, "foregroundColor": c_black, "fontFamily": "Calibri"},
                    "horizontalAlignment": "LEFT",
                    "verticalAlignment": "MIDDLE"
                }
            },
            "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
        }
    })

    # Col D (GENDER): white, centered, black text
    requests.append({
        "repeatCell": {
            "range": {"sheetId": sheet_meta_id, "startRowIndex": 6, "endRowIndex": num_rows, "startColumnIndex": 3, "endColumnIndex": 4},
            "cell": {
                "userEnteredFormat": {
                    "backgroundColor": c_white,
                    "textFormat": {"bold": False, "fontSize": 10, "foregroundColor": c_black, "fontFamily": "Calibri"},
                    "horizontalAlignment": "CENTER",
                    "verticalAlignment": "MIDDLE"
                }
            },
            "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
        }
    })

    # Col E (SECTION): Soft blue (#A4C2F4), centered, black text
    requests.append({
        "repeatCell": {
            "range": {"sheetId": sheet_meta_id, "startRowIndex": 6, "endRowIndex": num_rows, "startColumnIndex": 4, "endColumnIndex": 5},
            "cell": {
                "userEnteredFormat": {
                    "backgroundColor": c_sec_blue,
                    "textFormat": {"bold": False, "fontSize": 10, "foregroundColor": c_black, "fontFamily": "Calibri"},
                    "horizontalAlignment": "CENTER",
                    "verticalAlignment": "MIDDLE"
                }
            },
            "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
        }
    })

    # Date Columns & Total for student rows: white background, centered, black text
    requests.append({
        "repeatCell": {
            "range": {"sheetId": sheet_meta_id, "startRowIndex": 6, "endRowIndex": num_rows, "startColumnIndex": 5, "endColumnIndex": num_cols},
            "cell": {
                "userEnteredFormat": {
                    "backgroundColor": c_white,
                    "textFormat": {"bold": False, "fontSize": 10, "foregroundColor": c_black, "fontFamily": "Calibri"},
                    "horizontalAlignment": "CENTER",
                    "verticalAlignment": "MIDDLE"
                }
            },
            "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
        }
    })

    # Clean borders across entire table
    requests.append({
        "updateBorders": {
            "range": {"sheetId": sheet_meta_id, "startRowIndex": 0, "endRowIndex": num_rows, "startColumnIndex": 0, "endColumnIndex": num_cols},
            "top": {"style": "SOLID", "width": 1, "color": {"red": 0.4, "green": 0.4, "blue": 0.4}},
            "bottom": {"style": "SOLID", "width": 1, "color": {"red": 0.4, "green": 0.4, "blue": 0.4}},
            "left": {"style": "SOLID", "width": 1, "color": {"red": 0.4, "green": 0.4, "blue": 0.4}},
            "right": {"style": "SOLID", "width": 1, "color": {"red": 0.4, "green": 0.4, "blue": 0.4}},
            "innerHorizontal": {"style": "SOLID", "width": 1, "color": {"red": 0.7, "green": 0.7, "blue": 0.7}},
            "innerVertical": {"style": "SOLID", "width": 1, "color": {"red": 0.7, "green": 0.7, "blue": 0.7}}
        }
    })

    # Border box around Row 4 Total cell (conducated periods count box)
    requests.append({
        "updateBorders": {
            "range": {"sheetId": sheet_meta_id, "startRowIndex": 3, "endRowIndex": 4, "startColumnIndex": total_col_idx, "endColumnIndex": total_col_idx + 1},
            "top": {"style": "SOLID", "width": 2, "color": {"red": 0.0, "green": 0.0, "blue": 0.0}},
            "bottom": {"style": "SOLID", "width": 2, "color": {"red": 0.0, "green": 0.0, "blue": 0.0}},
            "left": {"style": "SOLID", "width": 2, "color": {"red": 0.0, "green": 0.0, "blue": 0.0}},
            "right": {"style": "SOLID", "width": 2, "color": {"red": 0.0, "green": 0.0, "blue": 0.0}}
        }
    })

    # Column Widths
    requests.append({"updateDimensionProperties": {"range": {"sheetId": sheet_meta_id, "dimension": "COLUMNS", "startIndex": 0, "endIndex": 1}, "properties": {"pixelSize": 55}, "fields": "pixelSize"}})
    requests.append({"updateDimensionProperties": {"range": {"sheetId": sheet_meta_id, "dimension": "COLUMNS", "startIndex": 1, "endIndex": 2}, "properties": {"pixelSize": 110}, "fields": "pixelSize"}})
    requests.append({"updateDimensionProperties": {"range": {"sheetId": sheet_meta_id, "dimension": "COLUMNS", "startIndex": 2, "endIndex": 3}, "properties": {"pixelSize": 300}, "fields": "pixelSize"}})
    requests.append({"updateDimensionProperties": {"range": {"sheetId": sheet_meta_id, "dimension": "COLUMNS", "startIndex": 3, "endIndex": 4}, "properties": {"pixelSize": 90}, "fields": "pixelSize"}})
    requests.append({"updateDimensionProperties": {"range": {"sheetId": sheet_meta_id, "dimension": "COLUMNS", "startIndex": 4, "endIndex": 5}, "properties": {"pixelSize": 90}, "fields": "pixelSize"}})
    requests.append({"updateDimensionProperties": {"range": {"sheetId": sheet_meta_id, "dimension": "COLUMNS", "startIndex": 5, "endIndex": num_cols}, "properties": {"pixelSize": 75}, "fields": "pixelSize"}})

    # Row Heights
    requests.append({"updateDimensionProperties": {"range": {"sheetId": sheet_meta_id, "dimension": "ROWS", "startIndex": 0, "endIndex": 1}, "properties": {"pixelSize": 43}, "fields": "pixelSize"}})
    requests.append({"updateDimensionProperties": {"range": {"sheetId": sheet_meta_id, "dimension": "ROWS", "startIndex": 1, "endIndex": 2}, "properties": {"pixelSize": 50}, "fields": "pixelSize"}})
    requests.append({"updateDimensionProperties": {"range": {"sheetId": sheet_meta_id, "dimension": "ROWS", "startIndex": 2, "endIndex": 3}, "properties": {"pixelSize": 47}, "fields": "pixelSize"}})
    requests.append({"updateDimensionProperties": {"range": {"sheetId": sheet_meta_id, "dimension": "ROWS", "startIndex": 3, "endIndex": 4}, "properties": {"pixelSize": 77}, "fields": "pixelSize"}})
    requests.append({"updateDimensionProperties": {"range": {"sheetId": sheet_meta_id, "dimension": "ROWS", "startIndex": 4, "endIndex": 5}, "properties": {"pixelSize": 37}, "fields": "pixelSize"}})
    requests.append({"updateDimensionProperties": {"range": {"sheetId": sheet_meta_id, "dimension": "ROWS", "startIndex": 5, "endIndex": 6}, "properties": {"pixelSize": 43}, "fields": "pixelSize"}})
    requests.append({"updateDimensionProperties": {"range": {"sheetId": sheet_meta_id, "dimension": "ROWS", "startIndex": 6, "endIndex": num_rows}, "properties": {"pixelSize": 21}, "fields": "pixelSize"}})

    print(f"Executing batch update with {len(requests)} formatting operations...")
    res = sh.batch_update({"requests": requests})
    print("[+] Successfully restored exact college template formatting to Google Sheet!")

if __name__ == "__main__":
    restore_exact_formatting()
