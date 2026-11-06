const test = require('node:test')
const assert = require('node:assert/strict')
const pagamentoAuto = require('../src/vendas/pagamentoAuto')

const SMS_EMOLA = 'Recebeu 7.00MT de 878665455, Sonia Jaime Macuacua as 10:33:44. Transaccao ID: E123456.1234.ABC. Conteudo:858496644. O seu novo saldo e de 199.00MT.'

test('extrai numero Vodacom do campo Conteudo com nome do cliente', () => {
    const resultado = pagamentoAuto.extrairNumeroConteudo(SMS_EMOLA)
    assert.deepEqual(resultado, { ok: true, numero: '858496644', numeros: ['858496644'] })
})

test('aceita numero Vodacom formatado com espacos', () => {
    const resultado = pagamentoAuto.extrairNumeroConteudo('Conteudo: 84 849 6644. O seu saldo e de 199.00MT.')
    assert.equal(resultado.ok, true)
    assert.equal(resultado.numero, '848496644')
})

test('rejeita Conteudo sem numero Vodacom', () => {
    const resultado = pagamentoAuto.extrairNumeroConteudo('Conteudo: A. O seu saldo e de 199.00MT.')
    assert.equal(resultado.ok, false)
    assert.equal(resultado.motivo, 'conteudo_invalido')
})

test('rejeita Conteudo com mais de um numero Vodacom', () => {
    const resultado = pagamentoAuto.extrairNumeroConteudo('Conteudo: 858496644 / 858496645.')
    assert.equal(resultado.ok, false)
    assert.equal(resultado.motivo, 'conteudo_multiplo')
    assert.equal(resultado.numeros.length, 2)
})

test('rejeita SMS sem campo Conteudo', () => {
    const resultado = pagamentoAuto.extrairNumeroConteudo('Recebeu 7.00MT de 878665455, Sonia as 10:33:44.')
    assert.equal(resultado.ok, false)
    assert.equal(resultado.motivo, 'sem_conteudo')
})

test('extrai pagador e nome do texto assinado', () => {
    const pagador = pagamentoAuto.extrairPagador(SMS_EMOLA, {})
    assert.equal(pagador.telefone, '878665455')
    assert.equal(pagador.nome, 'Sonia Jaime Macuacua')
})

test('saldo nunca e entregue automaticamente', () => {
    const resultado = pagamentoAuto.selecionarPacote([
        { tipo: 'Saldo', mb: '7', gb: 'Saldo 7MT', preco: 7 }
    ])
    assert.equal(resultado.ok, false)
    assert.equal(resultado.motivo, 'saldo')
})

test('saldo tem prioridade mesmo quando ha pacote de dados', () => {
    const resultado = pagamentoAuto.selecionarPacote([
        { tipo: 'Saldo', mb: '7', gb: 'Saldo 7MT', preco: 7 },
        { tipo: 'Diario', mb: '1024', gb: '1GB', preco: 7 }
    ])
    assert.equal(resultado.ok, false)
    assert.equal(resultado.motivo, 'saldo')
})

test('pacote unico de dados e seleccionado', () => {
    const resultado = pagamentoAuto.selecionarPacote([
        { tipo: 'Diario', mb: '1024', gb: '1GB', preco: 7 }
    ])
    assert.equal(resultado.ok, true)
    assert.equal(resultado.pacote.gb, '1GB')
})

test('valor com mais de um pacote de dados fica ambiguo', () => {
    const resultado = pagamentoAuto.selecionarPacote([
        { tipo: 'Diario', mb: '1024', gb: '1GB', preco: 7 },
        { tipo: 'Semanal', mb: '1024', gb: '1GB', preco: 7 }
    ])
    assert.equal(resultado.ok, false)
    assert.equal(resultado.motivo, 'ambiguo')
})

test('valor sem pacote fica sem_pacote', () => {
    const resultado = pagamentoAuto.selecionarPacote([])
    assert.equal(resultado.ok, false)
    assert.equal(resultado.motivo, 'sem_pacote')
})

test('chave de pagamento e estavel por central e transacao', () => {
    assert.equal(
        pagamentoAuto.chavePagamento('s2-abc123', 'e123456.1234.abc'),
        'S2-ABC123__E123456_1234_ABC'
    )
})
