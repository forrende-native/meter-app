from PIL import Image, ImageDraw, ImageFont
import os
os.makedirs("D:/HermesWorkspace/meter-app/icons", exist_ok=True)
for size in (192, 512):
    img = Image.new("RGB", (size, size), "#1565c0")
    d = ImageDraw.Draw(img)
    text = "M"
    try:
        font = ImageFont.truetype("arialbd.ttf", int(size*0.55))
    except Exception:
        font = ImageFont.load_default()
    bbox = d.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    d.text(((size - w) / 2 - bbox[0], (size - h) / 2 - bbox[1]), text, fill="white", font=font)
    img.save(f"D:/HermesWorkspace/meter-app/icons/icon-{size}.png")
print("done")
