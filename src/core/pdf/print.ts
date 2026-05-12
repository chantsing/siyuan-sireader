/**
 * PDF 打印
 */
const createPdfBlob = (source: ArrayBuffer | Uint8Array | Blob) => {
  if (source instanceof Blob) return source
  if (source instanceof Uint8Array) return new Blob([source], { type: 'application/pdf' })
  return new Blob([new Uint8Array(source)], { type: 'application/pdf' })
}

export const printPDF = async (source: ArrayBuffer | Uint8Array | Blob) => {
  const url = URL.createObjectURL(createPdfBlob(source))
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none'
  frame.src = url

  const cleanup = () => {
    frame.remove()
    URL.revokeObjectURL(url)
  }

  frame.onload = () => {
    const win = frame.contentWindow
    if (!win) return cleanup()
    setTimeout(() => {
      try {
        win.focus()
        win.print()
      } finally {
        setTimeout(cleanup, 1000)
      }
    }, 200)
  }

  frame.onerror = cleanup
  document.body.appendChild(frame)
}
