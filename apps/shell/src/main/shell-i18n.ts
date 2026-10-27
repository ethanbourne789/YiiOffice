/// The main process's own UI language: the locale table for every string the
/// shell shows (menus, dialogs, toasts) plus the `tm()` accessor that resolves
/// it against the current language.
///
/// Persisted in userData/app-settings.json so the editor modules can read the
/// same file for their own i18n; YIIOFFICE_LANG overrides it for tests.

import { app } from 'electron'
import { createI18n, isLang, normalizeLang, setUiLang, type Lang } from '@yiioffice/i18n'
import { readAppSettings, writeAppSettingThen } from './app-settings'
import { APP_SETTINGS_PATH } from './shell-state'

let uiLang: Lang | null = null

export function currentLang(): Lang {
  if (uiLang) return uiLang
  if (process.env.YIIOFFICE_LANG) {
    uiLang = normalizeLang(process.env.YIIOFFICE_LANG)
    setUiLang(uiLang)
    return uiLang
  }
  const saved = readAppSettings(APP_SETTINGS_PATH()).language
  if (isLang(saved)) uiLang = saved
  uiLang ??= normalizeLang(app.getLocale())
  setUiLang(uiLang)
  return uiLang
}

export function persistLang(lang: Lang): void {
  // write first: app-settings.json can be unwritable, and a language committed to
  // memory before the write survives only until the next launch
  writeAppSettingThen(APP_SETTINGS_PATH(), 'language', lang, (persisted) => {
    uiLang = persisted
    setUiLang(persisted)
  })
}

const tMain = createI18n({
  zh: {
    dlgAddFolderRoot: '添加文件夹到首页',
    watchdogTitle: '文档占用资源过高',
    watchdogBody:
      '“{title}” 已持续数分钟占用大量内存或 CPU（内存 {memory} MB，CPU {cpu}%）。可以继续等待，或关闭这个文档（有未保存的改动会先询问是否保存）。诊断信息已记录。', // public-hygiene: allow
    watchdogWait: '继续等待',
    watchdogClose: '关闭文档',
    errFolderRootUnusable: '无法读取所选文件夹',
    menuFile: '文件',
    menuSectionNew: '新建',
    menuOpenInNewWindow: '在新窗口中打开',
    menuNewDoc: 'Docs',
    menuNewSheet: 'Sheets',
    untitledSheet: '未命名表格',
    untitledDoc: '未命名文档',
    untitledDeck: '未命名演示文稿',
    untitledMarkdown: '未命名 Markdown',
    untitledPdf: '未命名 PDF',
    menuNewSlide: 'Slides',
    menuNewMarkdown: 'Markdown',
    menuNewPdf: 'PDF',
    menuExportPdf: '导出为 PDF…',
    menuExportImages: '导出为图片…',
    menuOpenInDocs: '转换为 Docs 文档并打开',
    menuPrint: '打印…',
    menuOpen: '打开…',
    menuSave: '保存',
    menuSaveAs: '另存为…',
    menuClose: '关闭',
    menuEdit: '编辑',
    menuWindow: '窗口',
    menuHome: '首页',
    backToHome: '返回首页',
    dlgOpenTitle: '打开文件',
    filterSupported: '支持的文件',
    filterWord: 'Word 文档',
    filterExcel: 'Excel 工作簿',
    filterPpt: 'PowerPoint 演示文稿',
    filterMarkdown: '文本文件 (Markdown, TXT, JSON)',
    filterPdf: 'PDF 文档',
    errBadArgs: '参数无效',
    errBadName: '文件名不合法',
    errBadExtension: '这个扩展名不受支持，改了文件就打不开了',
    errMissing: '文件不存在',
    errExists: '同名文件已存在',
    errRenameFailed: '重命名失败',
    errPdfSaveAsFailed: '另存为 PDF 失败',
    errNewTabFailed: '新建文档失败',
    errDuplicateFailed: '复制文件失败',
    errReplaceTrashFailed: '原文件无法放入回收站，已保留为 .yiioffice-replaced- 副本',
    errUnsupportedExt: '暂不支持 .{ext} 类型',
    copySuffix: '副本',
    menuHelp: '帮助',
    thirdPartyNotices: '第三方软件声明',
    menuExportDocx: '导出为 Word…',
    btnCancel: '取消',
    pdfDocxFailedMsg: '导出为 Word 失败',
    pdfDocxBusyMsg: '正在转换中，请等待当前导出完成。',
    menuExportPptx: '导出为 PPT…',
    pdfPptxFailedMsg: '导出为 PPT 失败',
    pdfPptxBusyMsg: '正在转换中，请等待当前导出完成。',
    pdfPptxLocalScannedDetail: '本地转换已按图片保真导出各页，幻灯片中的文字不可编辑。',
    menuExportXlsx: '导出为 Excel…',
    pdfXlsxFailedMsg: '导出为 Excel 失败',
    pdfXlsxBusyMsg: '正在转换中，请等待当前导出完成。',
    pdfXlsxLocalScannedDetail: '扫描页无法转换为单元格，对应工作表中已写入提示行。',
    pdfXlsxLocalSkippedMsg: '部分页面未转换为单元格',
    pdfXlsxLocalSkippedDetail: '第 {pages} 页无法转换为单元格，对应工作表中已写入提示行。',
    pdfDocxLocalScannedMsg: '检测到扫描件',
    pdfDocxLocalScannedDetail: '本地转换已按图片保真导出各页，未能识别出可编辑的文本。',
    pdfDocxLocalDegradedMsg: '部分页面已按图片导出',
    pdfDocxLocalDegradedDetail: '第 {pages} 页版面无法可靠重建，已按整页图片保真导出。',
    pdfDocxLocalOcrMsg: '扫描页已转换为可编辑文本',
    pdfDocxLocalOcrDetail:
      '第 {pages} 页为扫描件，已通过本地 OCR 识别为可编辑文字，建议校对识别结果。',
    pdfDocxLocalEncryptedDetail: '此 PDF 已加密，未提供正确的密码，无法转换。',
    pdfDocxLocalUnsupportedEncDetail: '该文件使用证书加密或不支持的加密方式，无法转换。',
    pdfPwdTitle: '输入密码',
    pdfPwdPrompt: '此 PDF 已加密，请输入打开密码：',
    pdfPwdRetryPrompt: '密码不正确，请重试。',
    pdfPwdOk: '确定',
    pdfPwdVerifying: '正在验证密码…',
    pdfPwdLabel: '密码',
    pdfPwdPlaceholder: '输入打开密码',
    pdfPwdShow: '显示密码',
    pdfPwdHide: '隐藏密码',
    pdfDocxLocalCorruptDetail: '文件已损坏或不是有效的 PDF，无法转换。',
    dlgPickSaveDir: '选择默认保存位置',
    errSaveDirUnusable: '所选文件夹不可写，无法用作默认保存位置',
  },
  en: {
    dlgAddFolderRoot: 'Add Folder to Home',
    watchdogTitle: 'Document is using too many resources',
    watchdogBody:
      '"{title}" has been using a lot of memory or CPU for several minutes ({memory} MB, {cpu}% CPU). You can keep waiting, or close the document (you will be asked to save unsaved changes first). Diagnostics have been recorded.',
    watchdogWait: 'Keep Waiting',
    watchdogClose: 'Close Document',
    errFolderRootUnusable: 'The selected folder cannot be read',
    menuFile: 'File',
    menuSectionNew: 'New',
    menuOpenInNewWindow: 'Open in New Window',
    menuNewDoc: 'Docs',
    menuNewSheet: 'Sheets',
    untitledSheet: 'Untitled Spreadsheet',
    untitledDoc: 'Untitled Document',
    untitledDeck: 'Untitled Presentation',
    untitledMarkdown: 'Untitled Markdown',
    untitledPdf: 'Untitled PDF',
    menuNewSlide: 'Slides',
    menuNewMarkdown: 'Markdown',
    menuNewPdf: 'PDF',
    menuExportPdf: 'Export as PDF…',
    menuExportImages: 'Export as Images…',
    menuOpenInDocs: 'Convert and Open in Docs',
    menuPrint: 'Print…',
    menuOpen: 'Open…',
    menuSave: 'Save',
    menuSaveAs: 'Save As…',
    menuClose: 'Close',
    menuEdit: 'Edit',
    menuWindow: 'Window',
    menuHome: 'Home',
    backToHome: 'Back to Home',
    dlgOpenTitle: 'Open File',
    filterSupported: 'Supported Files',
    filterWord: 'Word Documents',
    filterExcel: 'Excel Workbooks',
    filterPpt: 'PowerPoint Presentations',
    filterMarkdown: 'Text Files (Markdown, TXT, JSON)',
    filterPdf: 'PDF Documents',
    errBadArgs: 'Invalid arguments',
    errBadName: 'Invalid file name',
    errBadExtension: 'That extension is not supported, and the file would no longer open',
    errMissing: 'File not found',
    errExists: 'A file with that name already exists',
    errRenameFailed: 'Rename failed',
    errPdfSaveAsFailed: 'Could not save the PDF copy',
    errNewTabFailed: 'Could not create the new document',
    errDuplicateFailed: 'Could not duplicate the file',
    errReplaceTrashFailed:
      'The replaced file could not be sent to the Recycle Bin; it was kept as a .yiioffice-replaced- copy',
    errUnsupportedExt: '.{ext} files are not supported',
    copySuffix: 'copy',
    menuHelp: 'Help',
    thirdPartyNotices: 'Third-Party Notices',
    menuExportDocx: 'Export as Word…',
    btnCancel: 'Cancel',
    pdfDocxFailedMsg: 'Export as Word failed',
    pdfDocxBusyMsg: 'A Word export is already in progress. Please wait for it to finish.',
    menuExportPptx: 'Export as PowerPoint…',
    pdfPptxFailedMsg: 'Export as PowerPoint failed',
    pdfPptxBusyMsg: 'An export is already in progress. Please wait for it to finish.',
    pdfPptxLocalScannedDetail:
      'Each page was exported as a full-page image; the text on the slides is not editable.',
    menuExportXlsx: 'Export as Excel…',
    pdfXlsxFailedMsg: 'Export as Excel failed',
    pdfXlsxBusyMsg: 'An export is already in progress. Please wait for it to finish.',
    pdfXlsxLocalScannedDetail:
      "Scanned pages cannot be converted to cells; each page's worksheet carries a notice row instead.",
    pdfXlsxLocalSkippedMsg: 'Some pages were not converted to cells',
    pdfXlsxLocalSkippedDetail:
      'Pages {pages} could not be converted to cells; their worksheets carry a notice row instead.',
    pdfDocxLocalScannedMsg: 'Scanned document detected',
    pdfDocxLocalScannedDetail:
      'The pages were exported as images to preserve their appearance; no editable text could be recognized.',
    pdfDocxLocalDegradedMsg: 'Some pages were exported as images',
    pdfDocxLocalDegradedDetail:
      'Page(s) {pages} could not be reliably reconstructed and were exported as full-page images.',
    pdfDocxLocalOcrMsg: 'Scanned pages converted to editable text',
    pdfDocxLocalOcrDetail:
      'Page(s) {pages} were scans; their text was recovered with on-device OCR. Please proofread the result.',
    pdfDocxLocalEncryptedDetail:
      'This PDF is encrypted and could not be opened without the correct password.',
    pdfDocxLocalUnsupportedEncDetail:
      'This PDF uses certificate-based or otherwise unsupported encryption and cannot be converted.',
    pdfPwdTitle: 'Enter Password',
    pdfPwdPrompt: 'This PDF is encrypted. Enter the password to open it:',
    pdfPwdRetryPrompt: 'Incorrect password. Please try again.',
    pdfPwdOk: 'OK',
    pdfPwdVerifying: 'Verifying password…',
    pdfPwdLabel: 'Password',
    pdfPwdPlaceholder: 'Enter the open password',
    pdfPwdShow: 'Show password',
    pdfPwdHide: 'Hide password',
    pdfDocxLocalCorruptDetail: 'The file is damaged or not a valid PDF and cannot be converted.',
    dlgPickSaveDir: 'Choose Default Save Location',
    errSaveDirUnusable:
      'The selected folder is not writable and cannot be used as the default save location',
  },
})

export const tm = (key: Parameters<typeof tMain>[1], params?: Parameters<typeof tMain>[2]) =>
  tMain(currentLang(), key, params)
