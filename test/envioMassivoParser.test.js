const test = require('node:test')
const assert = require('node:assert/strict')
const { parsearLista, extrairNumero, extrairPacote } = require('../src/auto/envioMassivoParser')

test('lê lista com cabeçalho, bullets e 9 dígitos', () => {
    const resultado = parsearLista([
        '📡 Envio massivo',
        '- 848346418 10gb',
        '• +258 845123456 — 30 GB',
        '84 654 3210 5GB'
    ].join('\n'))

    assert.equal(resultado.ok, true)
    assert.deepEqual(resultado.itens, [
        { numero: '848346418', pacote: '10gb' },
        { numero: '845123456', pacote: '30GB' },
        { numero: '846543210', pacote: '5GB' }
    ])
})

test('aceita pacote por preço', () => {
    const resultado = parsearLista('848346418 537mt')
    assert.equal(resultado.ok, true)
    assert.deepEqual(resultado.itens, [{ numero: '848346418', pacote: '537mt' }])
})

test('devolve erro quando falta o pacote', () => {
    const resultado = parsearLista('848346418')
    assert.equal(resultado.ok, false)
    assert.match(resultado.erros[0], /Falta o pacote/)
})

test('ignora linhas sem número', () => {
    const resultado = parsearLista('Envio Massivo\nTotal: 30GB')
    assert.equal(resultado.ok, false)
    assert.equal(resultado.itens.length, 0)
})

test('extrai número e pacote', () => {
    const numero = extrairNumero('848346418 10gb')
    assert.equal(numero.numero, '848346418')
    assert.equal(extrairPacote(numero.resto), '10gb')
})
