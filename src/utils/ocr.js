const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')
const util = require('util')

const execFileAsync = util.promisify(execFile)

const TESSDATA_DIR = process.env.FASTNET_TESSDATA_DIR || path.join(__dirname, '..', '..', 'assets', 'tessdata')
const TESS_LANGS = 'por+eng'
const OCR_MIN_CHARS = 15

let workerPromise = null
let sistemaIndisponivel = false

function limparBufferPdf(buffer) {
    try {
        const inicio = buffer.indexOf(Buffer.from('%PDF-'))
        if (inicio > 0) return buffer.subarray(inicio)
    } catch { }
    return buffer
}

async function reconhecerComSistema(buffer, psm = 6) {
    if (sistemaIndisponivel) return ''
    try {
        const tesseract = require('node-tesseract-ocr')
        const texto = await tesseract.recognize(buffer, {
            lang: TESS_LANGS,
            oem: 1,
            psm,
            load_system_dawg: '0',
            load_freq_dawg: '0'
        })
        return String(texto || '')
    } catch (err) {
        sistemaIndisponivel = true
        const motivo = String(err && err.message ? err.message : err).split('\n')[0]
        console.warn('[OCR] Tesseract do sistema indisponível, usando fallback JS:', motivo)
        return ''
    }
}

async function obterWorkerJs() {
    if (!workerPromise) {
        workerPromise = (async () => {
            const { createWorker } = require('tesseract.js')
            return createWorker(TESS_LANGS, 1, {
                langPath: TESSDATA_DIR,
                gzip: false,
                cachePath: path.join(os.tmpdir(), 'fastnet-tessdata'),
                logger: () => { }
            })
        })().catch(err => {
            workerPromise = null
            throw err
        })
    }
    return workerPromise
}

async function reconhecerComJs(buffer) {
    try {
        const worker = await obterWorkerJs()
        const resultado = await worker.recognize(buffer)
        const texto = resultado && resultado.data ? resultado.data.text : ''
        return String(texto || '')
    } catch (err) {
        const motivo = String(err && err.message ? err.message : err).split('\n')[0]
        console.error('[OCR-JS] Falha no tesseract.js:', motivo)
        return ''
    }
}

async function reconhecerImagem(buffer, { psm = 6 } = {}) {
    if (!buffer || !buffer.length) return ''

    const textoNativo = await reconhecerComSistema(buffer, psm)
    if (textoNativo.trim().length >= OCR_MIN_CHARS) return textoNativo

    const textoJs = await reconhecerComJs(buffer)
    return textoJs.trim().length > textoNativo.trim().length ? textoJs : textoNativo
}

async function extrairTextoPdf(buffer, { timeout = 30000 } = {}) {
    if (!buffer || !buffer.length) return ''

    const limpo = limparBufferPdf(buffer)
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fastnet-pdf-'))
    const tempPdf = path.join(tempDir, 'documento.pdf')

    try {
        await fs.promises.writeFile(tempPdf, limpo)

        try {
            const { stdout } = await execFileAsync('pdftotext', ['-layout', tempPdf, '-'], {
                timeout,
                maxBuffer: 20 * 1024 * 1024
            })
            const texto = String(stdout || '').trim()
            if (texto.length >= OCR_MIN_CHARS) return texto
        } catch { }

        try {
            const pdfParse = require('pdf-parse')
            const dados = await pdfParse(limpo)
            const texto = dados && dados.text ? String(dados.text).trim() : ''
            if (texto.length >= OCR_MIN_CHARS) return texto
        } catch { }

        return ''
    } finally {
        try { await fs.promises.rm(tempDir, { recursive: true, force: true }) } catch { }
    }
}

function prepararAmbienteCanvas() {
    const canvasLib = require('@napi-rs/canvas')
    if (!global.DOMMatrix && canvasLib.DOMMatrix) global.DOMMatrix = canvasLib.DOMMatrix
    if (!global.Path2D && canvasLib.Path2D) global.Path2D = canvasLib.Path2D
    if (!global.ImageData && canvasLib.ImageData) global.ImageData = canvasLib.ImageData
    return canvasLib
}

async function renderizarPdfParaImagem(buffer, { pagina = 1, escala = 2 } = {}) {
    if (!buffer || !buffer.length) return null

    const canvasLib = prepararAmbienteCanvas()
    const pdfjs = require('pdfjs-dist/legacy/build/pdf.js')
    const pdfjsDir = path.dirname(require.resolve('pdfjs-dist/package.json'))

    const documento = await pdfjs.getDocument({
        data: new Uint8Array(limparBufferPdf(buffer)),
        useSystemFonts: false,
        isEvalSupported: false,
        standardFontDataUrl: path.join(pdfjsDir, 'standard_fonts') + path.sep,
        cMapUrl: path.join(pdfjsDir, 'cmaps') + path.sep,
        cMapPacked: true
    }).promise

    try {
        const page = await documento.getPage(Math.max(1, Number(pagina) || 1))
        const viewport = page.getViewport({ scale: Math.max(1, Number(escala) || 2) })
        const canvas = canvasLib.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
        const contexto = canvas.getContext('2d')

        await page.render({ canvasContext: contexto, viewport }).promise
        return canvas.toBuffer('image/png')
    } finally {
        try { await documento.destroy() } catch { }
    }
}

async function ocrPdf(buffer, { psm = 4, escala = 2 } = {}) {
    const textoNativo = await extrairTextoPdf(buffer)
    if (textoNativo && textoNativo.trim().length >= OCR_MIN_CHARS) {
        return { texto: textoNativo, fonte: 'texto' }
    }

    const imagem = await renderizarPdfParaImagem(buffer, { escala })
    if (!imagem) return { texto: textoNativo || '', fonte: 'texto' }

    const textoOcr = await reconhecerImagem(imagem, { psm })
    return { texto: textoOcr, fonte: 'ocr' }
}

async function encerrarOcr() {
    if (!workerPromise) return
    try {
        const worker = await workerPromise
        await worker.terminate()
    } catch { }
    workerPromise = null
}

module.exports = {
    TESSDATA_DIR,
    reconhecerImagem,
    extrairTextoPdf,
    renderizarPdfParaImagem,
    ocrPdf,
    encerrarOcr
}
