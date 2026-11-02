import { LOCAL_ASSET_PATH } from '../editor/localImage'

/**
 * Inline every `/md-asset` picture in `root` as a `data:` URL.
 *
 * The PDF and image exports do not print the live page: the HTML is handed to
 * Edge headless through a temporary file, i.e. a `file://` origin where a
 * root-relative `/md-asset?p=…` request has no server to answer it (and, unlike
 * the print iframe, no document URL to resolve against). Rewriting the pictures
 * into the document makes the export self-contained.
 *
 * Returns how many pictures were inlined, for callers that want to warn.
 */
export async function inlineLocalImages(root: ParentNode): Promise<number> {
  const images = [...root.querySelectorAll<HTMLImageElement>(`img[src^="${LOCAL_ASSET_PATH}?"]`)]
  const hits = await Promise.all(
    images.map(async (image) => {
      const src = image.getAttribute('src')
      if (!src) return false
      try {
        const response = await fetch(src)
        if (!response.ok) return false
        image.setAttribute('src', await readAsDataUrl(await response.blob()))
        return true
      } catch (err) {
        // Keep the rest of the document printable: a picture that cannot be read
        // is dropped from the export, not fatal to it.
        console.warn('[markdown] could not inline image for export:', src, err)
        return false
      }
    }),
  )
  return hits.filter(Boolean).length
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })
}
