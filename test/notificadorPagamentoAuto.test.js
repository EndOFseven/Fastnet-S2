const test = require('node:test')
const assert = require('node:assert/strict')
const notificador = require('../src/auto/notificadorCompra')

const compra = {
    id: 'COMP-5000',
    pedidoNumero: 5000,
    grupoId: '120363000000000000@g.us',
    clienteId: '258878665455@s.whatsapp.net',
    clienteNome: 'Sonia Jaime Macuacua',
    tipoPacote: 'Diario',
    totalMb: 1024,
    totalPartes: 1,
    partesEnviadas: 0,
    criadoEm: Date.now(),
    itens: [{ numero: '858496644', mbTotal: 1024 }],
    pagamento: {
        sistema: 'e-Mola',
        valor: 7,
        pagadorNome: 'Sonia Jaime Macuacua',
        pagadorTelefone: '878665455',
        targetPhone: '858496644',
        txId: 'E123456.1234.ABC',
        recebidoEm: Date.now()
    }
}

test('card confirmado mostra dados do pagamento e-Mola', () => {
    const texto = notificador.formatarPagamentoConfirmado(compra)
    assert.match(texto, /PAGAMENTO:/)
    assert.match(texto, /Operadora: e-Mola/)
    assert.match(texto, /Valor: 7,00 MT/)
    assert.match(texto, /Pagador: Sonia Jaime Macuacua/)
    assert.match(texto, /Destino: \+258 85 849 6644/)
    assert.match(texto, /Transacao: E123456\.1234\.ABC/)
})

test('card aguardando tambem mostra dados do pagamento', () => {
    const texto = notificador.formatarAguardando(compra, 'Sem capacidade')
    assert.match(texto, /PAGAMENTO:/)
    assert.match(texto, /Transacao: E123456\.1234\.ABC/)
})

test('alerta automatico explica o motivo e como resolver', () => {
    const texto = notificador.formatarAlertaPagamentoAuto({
        motivo: 'saldo',
        oficial: {
            tx_id: 'E123456.1234.ABC',
            provider: 'e-Mola',
            amount_mt: 7,
            timestamp: Date.now(),
            target_phone: '858496644'
        },
        conteudo: { numeros: ['858496644'] },
        pagador: { nome: 'Sonia', telefone: '878665455' }
    })
    assert.match(texto, /ALERTA - PAGAMENTO AUTOMATICO/)
    assert.match(texto, /valor corresponde a saldo/)
    assert.match(texto, /Conteudo: 858496644/)
    assert.match(texto, /enviarauto/)
})

test('alerta de app antigo pede actualizacao 2.3.28', () => {
    const texto = notificador.formatarAlertaPagamentoAuto({
        motivo: 'app_antigo',
        oficial: { tx_id: 'E1' }
    })
    assert.match(texto, /2\.3\.28/)
})
