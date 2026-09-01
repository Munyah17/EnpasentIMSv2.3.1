/**
 * Turns the on-screen membership card into a file to print or send.
 *
 * The exported image is a rasterisation of the very DOM node being
 * previewed (components/ui/MemberCard.tsx), so what staff approve on screen
 * is exactly what the client receives — there is no second, drifting
 * definition of the card's layout.
 *
 * html2canvas and jsPDF are both heavy and both already lazy-loaded
 * elsewhere (see lib/exportUtils.ts), so they are imported on demand here
 * too rather than added to the main bundle.
 */

export type CardImageFormat = 'png' | 'jpg' | 'jpeg' | 'webp'
export type CardExportFormat = CardImageFormat | 'pdf'

export const CARD_EXPORT_FORMATS: CardExportFormat[] = ['png', 'jpg', 'jpeg', 'webp', 'pdf']

const MIME: Record<CardImageFormat, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

/** ID-1 card size in millimetres — what a card printer expects. */
const CARD_MM = { width: 85.6, height: 54 }

async function renderToCanvas(node: HTMLElement): Promise<HTMLCanvasElement> {
  // A node with no layout box (display:none, or detached) makes html2canvas
  // resolve the card's gradients against zero width, and it throws on the
  // resulting non-finite colour stops. Caught here so the failure names the
  // real cause instead of surfacing as "addColorStop … non-finite".
  if (!node.offsetWidth || !node.offsetHeight) {
    throw new Error('the card is not laid out on screen, so it cannot be rendered')
  }
  const { default: html2canvas } = await import('html2canvas')
  return html2canvas(node, {
    // The card paints its own background; a transparent one would print
    // as a white box on some viewers and black on others.
    backgroundColor: null,
    scale: 2,
    useCORS: true,
    logging: false,
  })
}

function triggerDownload(dataUrl: string, filename: string) {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
}

/**
 * Renders one or both faces of a card and saves it.
 *
 * `nodes` is given front-first. An image format writes one file per face;
 * a PDF puts each face on its own card-sized page, which is what a card
 * printer or a duplex print run wants.
 */
export async function exportCard(
  nodes: HTMLElement[],
  format: CardExportFormat,
  baseFilename: string,
): Promise<void> {
  const faces = nodes.filter(Boolean)
  if (faces.length === 0) return

  if (format === 'pdf') {
    const [{ jsPDF }, canvases] = await Promise.all([
      import('jspdf'),
      Promise.all(faces.map(renderToCanvas)),
    ])
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [CARD_MM.width, CARD_MM.height] })
    canvases.forEach((canvas, i) => {
      if (i > 0) doc.addPage([CARD_MM.width, CARD_MM.height], 'landscape')
      doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, CARD_MM.width, CARD_MM.height)
    })
    doc.save(`${baseFilename}.pdf`)
    return
  }

  const mime = MIME[format]
  for (const [i, node] of faces.entries()) {
    const canvas = await renderToCanvas(node)
    // Quality is only honoured for lossy formats; PNG ignores it.
    const dataUrl = canvas.toDataURL(mime, 0.95)
    const suffix = faces.length > 1 ? (i === 0 ? '-front' : '-back') : ''
    triggerDownload(dataUrl, `${baseFilename}${suffix}.${format}`)
  }
}

/** The card as a data URL, for attaching to an email or showing a preview. */
export async function cardToDataUrl(node: HTMLElement, format: CardImageFormat = 'png'): Promise<string> {
  const canvas = await renderToCanvas(node)
  return canvas.toDataURL(MIME[format], 0.95)
}
