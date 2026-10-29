import { invoke } from './transport'

// Desktop API for docs editor (window.desktop)
export function createDesktopApi() {
  return {
    open: (path: string) => invoke('docs:open-path', { path }),
    save: (path: string, content: string) => invoke('docs:save', { path, content }),
    saveAs: (path: string, content: string) => invoke('docs:save-as', { path, content }),
    exportPdf: () => invoke('docs:export-pdf'),
  }
}

// Desktop API for sheets editor (window.desktopApi)
export function createDesktopApiForSheets() {
  return {
    readRange: (options: any) => invoke('workbook:read-range', options),
    save: (path: string, content: string) => invoke('workbook:save', { path, content }),
    filesRead: (path: string) => invoke('sheets:files-read', { path }),
    filesReadImage: (path: string) => invoke('sheets:files-read-image', { path }),
  }
}

// Slides API (window.slidesApi)
export function createSlidesApi() {
  return {
    open: (path: string) => invoke('slides:open-path', { path }),
    openPath: (path: string) => invoke('slides:open-path', path),
    save: (path: string, content: string) => invoke('slides:save', { path, content }),
    saveAs: (path: string, content: string) => invoke('slides:save-as', { path, content }),
    filesRead: (path: string) => invoke('slides:files-read', { path }),
    filesReadImage: (path: string) => invoke('slides:files-read-image', { path }),
  }
}

// PDF API (window.pdfApi)
export function createPdfApi() {
  return {
    readFile: (path: string) => invoke('pdf:read-file', { path }),
    save: (path: string, content: string) => invoke('pdf:save', { path, content }),
  }
}

// Markdown API (window.markdownApi)
export function createMarkdownApi() {
  return {
    readFile: (path: string) => invoke('markdown:read-file', { path }),
    save: (path: string, content: string) => invoke('markdown:save', { path, content }),
    saveImage: (path: string, content: string) => invoke('markdown:save-image', { path, content }),
    readImage: (path: string) => invoke('markdown:read-image', { path }),
  }
}

// Shell helpers
export function shellReadLocalImage(path: string) {
  return invoke('shell:read-local-image', { path })
}

export function shellOpenExternal(url: string) {
  return invoke('shell:open-external', url)
}
