/**
 * PDF 下载
 */
const createPdfBlob = (source: ArrayBuffer | Uint8Array | Blob) => {
  if (source instanceof Blob) return source
  if (source instanceof Uint8Array) return new Blob([source], { type: 'application/pdf' })
  return new Blob([new Uint8Array(source)], { type: 'application/pdf' })
}

export const downloadPDF = (src: ArrayBuffer | Uint8Array | Blob, name = 'document.pdf') => {
  const url = URL.createObjectURL(createPdfBlob(src))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export const exportAsImages = async (pdf: any, fmt: 'png' | 'jpeg' = 'png') => {
  const zip = await import('jszip').then(m => new m.default())
  for (let i = 1; i <= pdf.numPages; i++) {
    const p = await pdf.getPage(i)
    const vp = p.getViewport({ scale: 2 })
    const c = document.createElement('canvas')
    c.width = vp.width
    c.height = vp.height
    await p.render({ canvasContext: c.getContext('2d')!, viewport: vp, canvas: c }).promise
    zip.file(`page-${i}.${fmt}`, await new Promise<Blob>(r => c.toBlob(b => r(b!), `image/${fmt}`)))
  }
  const url = URL.createObjectURL(await zip.generateAsync({ type: 'blob' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'pdf-images.zip'
  a.click()
  URL.revokeObjectURL(url)
}
