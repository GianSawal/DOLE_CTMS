import io
import base64
import qrcode


def generate_qr_bytes(
    text: str,
    box_size: int = 6,
    border: int = 2,
    fill_color: str = "#0305ba",
    back_color: str = "white"
) -> bytes:
    """
    Generates raw PNG bytes for a given text payload.
    Safely returns empty bytes if text is empty or None.
    """
    if not text:
        return b""

    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=box_size,
        border=border,
    )
    qr.add_data(str(text))
    qr.make(fit=True)
    img = qr.make_image(fill_color=fill_color, back_color=back_color)

    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()


def generate_qr_data_uri(
    text: str,
    box_size: int = 6,
    border: int = 2,
    fill_color: str = "#0305ba",
    back_color: str = "white"
) -> str:
    """
    Generates a base64 Data URI PNG string for a given text payload.
    Used for embedding QR codes into responsive HTML templates and thermal slips.
    Safely returns empty string if text is empty or None.
    """
    raw_bytes = generate_qr_bytes(
        text=text,
        box_size=box_size,
        border=border,
        fill_color=fill_color,
        back_color=back_color,
    )
    if not raw_bytes:
        return ""

    encoded = base64.b64encode(raw_bytes).decode("ascii")
    return f"data:image/png;base64,{encoded}"

