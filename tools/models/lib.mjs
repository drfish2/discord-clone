// Shared helpers for the model conversion scripts.
import sharp from 'sharp';

// Downscale any texture above `max` on either axis (host requirement: <=2048).
export async function resizeTextures(doc, max = 2048) {
  for (const t of doc.getRoot().listTextures()) {
    const [w, h] = t.getSize() || [];
    if (w <= max && h <= max) continue;
    const img = t.getImage();
    const out = await sharp(img, { animated: false }).resize(max, max, { fit: 'inside' }).toBuffer();
    t.setImage(out);
    console.log('resized', t.getName(), `${w}x${h}`);
  }
}
