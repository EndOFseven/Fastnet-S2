const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const VERSAO = 'v1'
const ARQUIVO_SEGREDO = path.join(__dirname, '../../data/hmac_oficial.key')

let segredoCache = null

function carregarSegredo() {
    if (segredoCache !== null) return segredoCache
    const env = String(process.env.FASTNET_HMAC_SECRET || '').trim()
    if (env) {
        segredoCache = env
        return segredoCache
    }
    try {
        segredoCache = fs.readFileSync(ARQUIVO_SEGREDO, 'utf8').trim()
    } catch {
        segredoCache = ''
    }
    if (!segredoCache) {
        console.warn('[HMAC] Segredo ausente: comprovantes oficiais não serão aceites até configurar data/hmac_oficial.key')
    }
    return segredoCache
}

function payloadOficial(dados) {
    const tx = String(dados?.tx_id || '')
    const cents = Math.round(Number(dados?.amount_mt) * 100)
    const phone = String(dados?.phone ?? '')
    const timestamp = Number(dados?.timestamp) || 0
    const provider = String(dados?.provider ?? '')
    return `${VERSAO}|${tx}|${cents}|${phone}|${timestamp}|${provider}`
}

function assinaturaValida(dados) {
    if (!dados || typeof dados !== 'object') return false
    const segredo = carregarSegredo()
    if (!segredo) return false
    const recebida = String(dados.signature || '').trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(recebida)) return false
    const esperada = crypto.createHmac('sha256', segredo).update(payloadOficial(dados)).digest()
    const buf = Buffer.from(recebida, 'hex')
    return buf.length === esperada.length && crypto.timingSafeEqual(buf, esperada)
}

module.exports = {
    VERSAO,
    payloadOficial,
    assinaturaValida,
    carregarSegredo
}
