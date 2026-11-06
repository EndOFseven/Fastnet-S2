const test = require('node:test')
const assert = require('node:assert/strict')
const notificador = require('../src/auto/notificadorCompra')
const { formatarVolumeCurto } = require('../src/utils/volume')

const compra = {
    id: 'COMP-4814',
    pedidoNumero: 4814,
    grupoId: '120363000000000000@g.us',
    clienteId: '258843117244@s.whatsapp.net',
    clienteNome: 'Cliente',
    tipoPacote: 'Diário',
    totalMb: 30720,
    totalPartes: 3,
    partesEnviadas: 1,
    criadoEm: Date.now(),
    itens: [{ numero: '843117244', mbTotal: 30720 }],
    partes: [
        { numero: '843117244', mb: 10240, indiceItem: 1, totalItem: 3, status: 'SUCESSO' },
        { numero: '843117244', mb: 10240, indiceItem: 2, totalItem: 3, status: 'PENDENTE' },
        { numero: '843117244', mb: 10240, indiceItem: 3, totalItem: 3, status: 'PENDENTE' }
    ]
}

test('formata volume compacto', () => {
    assert.equal(formatarVolumeCurto(30720), '30GB')
    assert.equal(formatarVolumeCurto(0, true), '0GB')
    assert.equal(formatarVolumeCurto(512), '512MB')
    assert.equal(formatarVolumeCurto(1536), '1,5GB')
})

test('mensagem de pagamento confirmado tem valor total e pedido', () => {
    const texto = notificador.formatarPagamentoConfirmado(compra)
    assert.match(texto, /PAGAMENTO CONFIRMADO/)
    assert.match(texto, /30720MB ➔ 843117244/)
    assert.match(texto, /PEDIDO:\* #4814/)
})

test('pagamento confirmado edita o card de conferencia existente', async () => {
    const chamadas = []
    const sock = {
        sendMessage: async (grupoId, payload) => {
            chamadas.push({ grupoId, payload })
            return { key: { id: 'novo-card' } }
        }
    }

    const ok = await notificador.enviarPagamentoConfirmado(sock, compra, {
        editKey: { id: 'card-conferencia', remoteJid: compra.grupoId, fromMe: true }
    })

    assert.equal(ok, true)
    assert.equal(chamadas.length, 1)
    assert.equal(chamadas[0].payload.edit.id, 'card-conferencia')
    assert.match(chamadas[0].payload.text, /PAGAMENTO CONFIRMADO/)
})

test('progresso mostra parte e partes em falta', () => {
    const texto = notificador.formatarParteEnviada(compra, compra.partes[0])
    assert.match(texto, /1\/3 parte enviada/)
    assert.match(texto, /Faltam 2 partes/)
})

test('transferência completa lista as partes', () => {
    const texto = notificador.formatarTransferenciaCompleta(compra)
    assert.match(texto, /TRANSFERÊNCIA COMPLETA/)
    assert.match(texto, /3\/3 partes enviadas ➔ 843117244/)
})

test('mensagem final usa o resumo do cliente', () => {
    const texto = notificador.formatarCompraConcluida(compra, {
        hoje: { mb: 30720 },
        semana: { mb: 30720 },
        mes: { mb: 30720 },
        total: { mb: 30720 }
    })
    assert.match(texto, /COMPRA CONCLUÍDA COM SUCESSO/)
    assert.match(texto, /@258843117244/)
    assert.match(texto, /Compra:\* 30GB/)
    assert.match(texto, /Hoje: 30GB/)
    assert.match(texto, /ENTREGUE ✅/)
})

test('limites finais para pacote de 430MB', () => {
    const limites = notificador.limitesMensagensFinais({
        tipoPacote: 'Diário',
        totalMb: 430
    })
    assert.deepEqual(limites, { transferenciaCompleta: false, resumo: false })
})

test('limites finais para pacote de 10GB', () => {
    const limites = notificador.limitesMensagensFinais({
        tipoPacote: 'Diário',
        totalMb: 10240
    })
    assert.deepEqual(limites, { transferenciaCompleta: false, resumo: true })
})

test('limites finais para pacote de 19GB', () => {
    const limites = notificador.limitesMensagensFinais({
        tipoPacote: 'Diário',
        totalMb: 19456
    })
    assert.deepEqual(limites, { transferenciaCompleta: false, resumo: true })
})

test('limites finais para pacote de 20GB', () => {
    const limites = notificador.limitesMensagensFinais({
        tipoPacote: 'Diário',
        totalMb: 20480
    })
    assert.deepEqual(limites, { transferenciaCompleta: true, resumo: true })
})

test('saldo mantém as duas mensagens finais', () => {
    const limites = notificador.limitesMensagensFinais({
        tipoPacote: 'Saldo',
        totalMb: 100
    })
    assert.deepEqual(limites, { transferenciaCompleta: true, resumo: true })
    assert.equal(notificador.ehPacoteDados({ tipoPacote: 'Saldo' }), false)
})
