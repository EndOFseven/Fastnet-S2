const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')

process.env.FASTNET_HMAC_SECRET = 'segredo-de-teste-v2'

const assinatura = require('../src/vendas/assinaturaOficial')

const rawText = 'Recebeu 7.00MT de 878665455, Sonia Jaime Macuacua as 10:33:44. Conteudo:858496644.'

function criarRegistro(overrides = {}) {
    const registro = {
        tx_id: 'E123456.1234.ABC',
        amount_mt: 7,
        phone: '878665455',
        timestamp: 1760000000000,
        provider: 'e-Mola',
        target_phone: '858496644',
        central_code: 's2-abc123',
        raw_text: rawText,
        raw_text_hash: assinatura.hashTexto(rawText),
        ...overrides
    }
    registro.signature_v2 = crypto
        .createHmac('sha256', process.env.FASTNET_HMAC_SECRET)
        .update(assinatura.payloadOficialV2(registro))
        .digest('hex')
    return registro
}

test('normaliza telefone com e sem prefixo 258', () => {
    assert.equal(assinatura.normalizarTelefone('258858496644'), '858496644')
    assert.equal(assinatura.normalizarTelefone('+258 84 849 6644'), '848496644')
    assert.equal(assinatura.normalizarTelefone('Desconhecido'), '')
})

test('payload v2 normaliza campos e usa centavos', () => {
    const registro = criarRegistro()
    assert.equal(
        assinatura.payloadOficialV2(registro),
        `v2|E123456.1234.ABC|700|878665455|1760000000000|e-Mola|858496644|S2-ABC123|${registro.raw_text_hash}`
    )
})

test('aceita assinatura v2 valida', () => {
    assert.equal(assinatura.assinaturaV2Valida(criarRegistro()), true)
})

test('rejeita alteracao no destino assinado', () => {
    const registro = criarRegistro()
    registro.target_phone = '858496645'
    assert.equal(assinatura.assinaturaV2Valida(registro), false)
})

test('rejeita alteracao no Conteudo do SMS', () => {
    const registro = criarRegistro()
    registro.raw_text = registro.raw_text.replace('858496644', '858496645')
    assert.equal(assinatura.assinaturaV2Valida(registro), false)
})

test('rejeita alteracao no central code', () => {
    const registro = criarRegistro()
    registro.central_code = 'S2-OUTRO'
    assert.equal(assinatura.assinaturaV2Valida(registro), false)
})

test('rejeita assinatura em falta', () => {
    const registro = criarRegistro()
    registro.signature_v2 = ''
    assert.equal(assinatura.assinaturaV2Valida(registro), false)
})
