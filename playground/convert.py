"""
Image Format Converter
"""
import sys
import os
from pathlib import Path
from PIL import Image


# Supported formats
FORMATS = {
    ".jpg": "JPEG",
    ".jpeg": "JPEG",
    ".png": "PNG",
    ".webp": "WEBP",
    ".bmp": "BMP",
    ".gif": "GIF",
    ".tiff": "TIFF",
    ".tif": "TIFF",
    ".ico": "ICO",
    ".jxl": "JPEGXL",
}


def convert(input_path: str, output_fmt: str, quality: int = 90) -> str:
    """Convert a single image, return output path"""
    img = Image.open(input_path)

    ext = output_fmt.lower()
    if not ext.startswith("."):
        ext = f".{ext}"

    if ext not in FORMATS:
        raise ValueError(f"Unsupported format: {ext}\nFormats: {', '.join(sorted(set(FORMATS.keys())))}")

    fmt = FORMATS[ext]
    out_path = str(Path(input_path).with_suffix(ext))

    # 保存
    save_kwargs = {}
    if fmt == "JPEG":
        img = img.convert("RGB")  # 去掉透明通道
        save_kwargs["quality"] = quality
        save_kwargs["optimize"] = True
    elif fmt == "WEBP":
        save_kwargs["quality"] = quality
    elif fmt == "PNG":
        save_kwargs["optimize"] = True

    img.save(out_path, format=fmt, **save_kwargs)
    img.close()

    # 显示结果
    in_size = os.path.getsize(input_path)
    out_size = os.path.getsize(out_path)
    ratio = out_size / in_size * 100

    return f"OK  {Path(input_path).name} -> {Path(out_path).name}  |  {in_size//1024}KB -> {out_size//1024}KB ({ratio:.0f}%)"


def main():
    print("=== Image Format Converter ===\n")

    if len(sys.argv) < 2:
        print("Usage:")
        print("  python convert.py <image> <format>")
        print("  python convert.py <img1> <img2> ... <format>")
        print()
        print("Examples:")
        print("  python convert.py photo.png jpg")
        print("  python convert.py a.png b.jpg c.bmp webp")
        print()
        print(f"Formats: {', '.join(sorted(set(FORMATS.keys())))}")
        return

    args = sys.argv[1:]
    target_fmt = args[-1].strip(".")

    # Check if last arg is a format
    if target_fmt.lower().lstrip(".") in {k.lstrip(".") for k in FORMATS}:
        files = args[:-1]
    else:
        print("ERROR: Last argument must be target format")
        print(f"Formats: {', '.join(sorted(set(FORMATS.keys())))}")
        return

    if not files:
        print("ERROR: No source images specified")
        return

    for f in files:
        if not os.path.exists(f):
            print(f"SKIP (not found): {f}")
            continue
        try:
            result = convert(f, target_fmt)
            print(result)
        except Exception as e:
            print(f"ERROR {Path(f).name}: {e}")

    print("\nDone!")


if __name__ == "__main__":
    main()
