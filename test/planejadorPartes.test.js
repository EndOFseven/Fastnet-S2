const test = require('node:test')
const assert = require('node:assert/strict')
const { planejarPartes, totalDasPartes } = require('../src/auto/planejadorPartes')

test('30GB divide em 3 partes de 10GB', () => {
    assert.deepEqual(planejarPartes(30 * 1024), [10240, 10240, 10240])
    assert.equal(totalDasPartes(planejarPartes(30 * 1024)), 30720)
})

test('200GB divide em 20 partes de 10GB', () => {
    const partes = planejarPartes(200 * 1024)
    assert.equal(partes.length, 20)
    assert.ok(partes.every(p => p === 10240))
})

test('pacote pequeno fica numa única parte', () => {
    assert.deepEqual(planejarPartes(100), [100])
    assert.deepEqual(planejarPartes(5120), [5120])
})

test('pacote quebrado preserva o total', () => {
    const partes = planejarPartes(25 * 1024)
    assert.deepEqual(partes, [10240, 10240, 5120])
    assert.equal(totalDasPartes(partes), 25 * 1024)
})

test('valor inválido não gera partes', () => {
    assert.deepEqual(planejarPartes(0), [])
    assert.deepEqual(planejarPartes(-10), [])
    assert.deepEqual(planejarPartes('abc'), [])
})
