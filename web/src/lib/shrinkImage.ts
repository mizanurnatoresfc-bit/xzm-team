/** A photo from a phone camera is often 4–8 MB: make it at most `max` px on the long side as a JPEG before upload.
 *  Small files and anything that is not an image go up as they are. */
export async function shrinkImage(file: File, max = 1600): Promise<File> {
  if (!file.type.startsWith('image/') || (file.size < 700_000 && max >= 1600)) return file
  try {
    const bmp = await createImageBitmap(file)
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
    if (k === 1 && file.size < 700_000) return file
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
    const blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/jpeg', 0.85))
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file
  } catch { return file }
}
